import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DecreaseStockDto } from './dto/decrease-stock.dto';

const STOCK_SELECT = {
  id: true,
  name: true,
  stock: true,
  category: { select: { id: true, name: true } },
} as const;

export interface StockItem {
  productId: number;
  quantity: number;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically decrements stock for multiple products inside a
   * caller-managed transaction. Pass the `tx` received from `$transaction`.
   *
   * Throws ConflictException on insufficient stock (TOCTOU guard).
   * Throws NotFoundException if a product doesn't exist.
   * Any exception causes the caller's transaction to roll back.
   */
  async decreaseMany(
    items: StockItem[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const item of items) {
      await this.decreaseOne(tx, item.productId, item.quantity);
    }
  }

  /**
   * Decrements stock for a single product, managing its own transaction.
   * Used by the /inventory/decrease API endpoint.
   */
  async decrease(dto: DecreaseStockDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.decreaseOne(tx, dto.productId, dto.quantity);
      return tx.product.findUnique({
        where: { id: dto.productId },
        select: STOCK_SELECT,
      });
    });
  }

  async getStatus() {
    return this.prisma.product.findMany({
      select: STOCK_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  // Single atomic UPDATE with WHERE stock >= quantity.
  // InnoDB row-lock ensures no two concurrent transactions both succeed
  // when stock is exactly enough for only one of them.
  private async decreaseOne(
    tx: Prisma.TransactionClient,
    productId: number,
    quantity: number,
  ): Promise<void> {
    const updated = await tx.product.updateMany({
      where: { id: productId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });

    if (updated.count === 0) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, stock: true },
      });

      if (!product) {
        throw new NotFoundException(`Product ${productId} not found`);
      }

      throw new ConflictException(
        `Insufficient stock for product ${productId}. ` +
          `Requested: ${quantity}, available: ${product.stock}`,
      );
    }
  }
}
