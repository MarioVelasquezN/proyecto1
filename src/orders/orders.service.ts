import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '../auth/enums/role.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from './enums/order-status.enum';
import { OrderStateMachine } from './order-state-machine';

const ORDER_SELECT = {
  id: true,
  userId: true,
  total: true,
  status: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      price: true,
      product: { select: { id: true, name: true } },
    },
  },
} as const;

// Extended select used by the checkout path — includes applied coupon.
const ORDER_FULL_SELECT = {
  ...ORDER_SELECT,
  coupon: { select: { id: true, code: true, percentage: true } },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async create(dto: CreateOrderDto, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const productIds = dto.items.map((i) => i.productId);

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, price: true, stock: true },
      });

      const productMap = new Map(products.map((p) => [p.id, p]));

      // Validate the entire order upfront before touching any stock, so the
      // caller receives a single descriptive error instead of a partial failure.
      for (const item of dto.items) {
        const product = productMap.get(item.productId);

        if (!product) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }

        if (product.stock < item.quantity) {
          throw new ConflictException(
            `Insufficient stock for product ${item.productId}. ` +
              `Requested: ${item.quantity}, available: ${product.stock}`,
          );
        }
      }

      // Price is snapshotted at purchase time so historical totals stay correct
      // even if a product's price is updated later.
      const total = dto.items.reduce(
        (sum, item) => sum + productMap.get(item.productId)!.price * item.quantity,
        0,
      );

      // Atomic stock decrement via StockService (TOCTOU guard included).
      // If a concurrent transaction consumed stock between the findMany above
      // and this call, StockService will throw ConflictException and roll back.
      await this.stockService.decreaseMany(dto.items, tx);

      return tx.order.create({
        data: {
          userId,
          total,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: productMap.get(item.productId)!.price,
            })),
          },
        },
        select: ORDER_SELECT,
      });
    });
  }

  async findAll(user: JwtPayload) {
    // Admins see every order; regular users only see their own.
    const where = user.role === Role.Admin ? {} : { userId: user.sub };
    return this.prisma.order.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: ORDER_SELECT,
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    // Return NotFoundException (not Forbidden) so the API doesn't reveal
    // that an order belonging to someone else exists.
    if (user.role !== Role.Admin && order.userId !== user.sub) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    return order;
  }

  async persist(
    tx: Prisma.TransactionClient,
    userId: number,
    items: Array<{ productId: number; quantity: number; price: number }>,
    total: number,
    couponId?: number,
  ) {
    return tx.order.create({
      data: {
        userId,
        total,
        ...(couponId !== undefined && { couponId }),
        items: { create: items },
      },
      select: ORDER_FULL_SELECT,
    });
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const from = order.status as OrderStatus;
    const to = dto.status;

    OrderStateMachine.transition(from, to);

    return this.prisma.order.update({
      where: { id },
      data: { status: to },
      select: ORDER_SELECT,
    });
  }
}
