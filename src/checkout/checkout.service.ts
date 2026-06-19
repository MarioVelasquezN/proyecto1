import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';

const CHECKOUT_ORDER_SELECT = {
  id: true,
  userId: true,
  total: true,
  status: true,
  createdAt: true,
  coupon: { select: { id: true, code: true, percentage: true } },
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
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async checkout(userId: number, dto: CheckoutDto = {}) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            product: { select: { id: true, price: true, stock: true } },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new UnprocessableEntityException('Cart is empty');
    }

    // Pre-check stock for descriptive error messages before touching any data.
    for (const item of cart.items) {
      if (item.product.stock < item.quantity) {
        throw new ConflictException(
          `Insufficient stock for product ${item.productId}. ` +
            `Requested: ${item.quantity}, available: ${item.product.stock}`,
        );
      }
    }

    // Validate coupon before opening the transaction to surface errors early.
    const coupon = dto.couponCode
      ? await this.validateCoupon(dto.couponCode)
      : null;

    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.quantity * item.product.price,
      0,
    );

    const total = coupon
      ? Math.round(subtotal * (1 - coupon.percentage / 100) * 100) / 100
      : subtotal;

    return this.prisma.$transaction(async (tx) => {
      // Atomic guard — second layer against TOCTOU race conditions.
      for (const item of cart.items) {
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

      const order = await tx.order.create({
        data: {
          userId,
          total,
          ...(coupon && { couponId: coupon.id }),
          items: {
            create: cart.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.product.price,
            })),
          },
        },
        select: CHECKOUT_ORDER_SELECT,
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return order;
    });
  }

  private async validateCoupon(
    code: string,
  ): Promise<{ id: number; percentage: number }> {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
      select: { id: true, percentage: true, expiresAt: true, isActive: true },
    });

    if (!coupon) {
      throw new NotFoundException(`Coupon '${code}' not found`);
    }
    if (!coupon.isActive) {
      throw new UnprocessableEntityException(`Coupon '${code}' is not active`);
    }
    if (coupon.expiresAt < new Date()) {
      throw new UnprocessableEntityException(`Coupon '${code}' has expired`);
    }

    return { id: coupon.id, percentage: coupon.percentage };
  }
}
