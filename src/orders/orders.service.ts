import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '../auth/enums/role.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStatus } from './enums/order-status.enum';

// Valid state-machine transitions. Anything not listed here is forbidden.
//   pending  → paid | cancelled
//   paid     → delivered
//   cancelled / delivered are terminal — no further transitions allowed.
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.Pending]: [OrderStatus.Paid, OrderStatus.Cancelled],
  [OrderStatus.Paid]: [OrderStatus.Delivered],
  [OrderStatus.Cancelled]: [],
  [OrderStatus.Delivered]: [],
};

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

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

      // Decrement each product's stock atomically.
      // The WHERE stock >= quantity guard is a second safety net against the
      // TOCTOU race condition: if a concurrent transaction consumed units
      // between the read above and this update, count will be 0 and we abort.
      for (const item of dto.items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });

        if (updated.count === 0) {
          throw new ConflictException(
            `Insufficient stock for product ${item.productId} (concurrent update)`,
          );
        }
      }

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
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];

    if (!allowed.includes(to)) {
      throw new UnprocessableEntityException(
        `Invalid transition: '${from}' → '${to}'. ` +
          `Allowed from '${from}': ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
      );
    }

    return this.prisma.order.update({
      where: { id },
      data: { status: to },
      select: ORDER_SELECT,
    });
  }
}
