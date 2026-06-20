import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StockService } from '../stock/stock.service';
import { OrdersService } from '../orders/orders.service';
import { CheckoutDto } from './dto/checkout.dto';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly stockService: StockService,
    private readonly ordersService: OrdersService,
  ) {}

  async checkout(userId: number, dto: CheckoutDto = {}) {
    const cart = await this.cartService.getForCheckout(userId);

    if (!cart || cart.items.length === 0) {
      throw new UnprocessableEntityException('Cart is empty');
    }

    // Pre-check stock outside the transaction for descriptive error messages.
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
      await this.stockService.decreaseMany(
        cart.items.map(({ productId, quantity }) => ({ productId, quantity })),
        tx,
      );

      const order = await this.ordersService.persist(
        tx,
        userId,
        cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.product.price,
        })),
        total,
        coupon?.id,
      );

      await this.cartService.clear(cart.id, tx);

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
