import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { RemoveFromCartDto } from './dto/remove-from-cart.dto';

export interface CheckoutCartItem {
  productId: number;
  quantity: number;
  product: { id: number; price: number; stock: number };
}

export interface CheckoutCart {
  id: number;
  items: CheckoutCartItem[];
}

const CART_SELECT = {
  id: true,
  userId: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      product: { select: { id: true, name: true, price: true } },
    },
    orderBy: { id: 'asc' as const },
  },
} as const;

function computeTotal(
  items: Array<{ quantity: number; product: { price: number } }>,
): number {
  return items.reduce((sum, item) => sum + item.quantity * item.product.price, 0);
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async add(dto: AddToCartDto, userId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${dto.productId} not found`);
    }

    // Auto-create the cart on the user's first add.
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });

    // Upsert the item: create on first add, replace quantity on subsequent adds.
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: dto.productId } },
      create: { cartId: cart.id, productId: dto.productId, quantity: dto.quantity },
      update: { quantity: dto.quantity },
    });

    return this.getCartForUser(userId);
  }

  async get(userId: number) {
    return this.getCartForUser(userId);
  }

  async remove(dto: RemoveFromCartDto, userId: number) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!cart) {
      throw new NotFoundException('Cart is empty');
    }

    const deleted = await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productId: dto.productId },
    });

    if (deleted.count === 0) {
      throw new NotFoundException(`Product ${dto.productId} not found in cart`);
    }

    return this.getCartForUser(userId);
  }

  async getForCheckout(userId: number): Promise<CheckoutCart | null> {
    return this.prisma.cart.findUnique({
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
  }

  async clear(cartId: number, tx: Prisma.TransactionClient): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
  }

  private async getCartForUser(userId: number) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: CART_SELECT,
    });

    if (!cart) {
      return { userId, items: [], total: 0 };
    }

    return { ...cart, total: computeTotal(cart.items) };
  }
}
