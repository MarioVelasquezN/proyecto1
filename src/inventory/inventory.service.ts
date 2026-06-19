import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DecreaseStockDto } from './dto/decrease-stock.dto';

const STOCK_SELECT = {
  id: true,
  name: true,
  stock: true,
  category: { select: { id: true, name: true } },
} as const;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async decrease(dto: DecreaseStockDto) {
    return this.prisma.$transaction(async (tx) => {
      // Single atomic UPDATE with WHERE stock >= quantity.
      // This prevents the TOCTOU race condition: two concurrent requests
      // that both read stock=5 cannot both decrement if only one unit is left,
      // because the DB row lock ensures only one UPDATE succeeds.
      const updated = await tx.product.updateMany({
        where: { id: dto.productId, stock: { gte: dto.quantity } },
        data: { stock: { decrement: dto.quantity } },
      });

      if (updated.count === 0) {
        const product = await tx.product.findUnique({
          where: { id: dto.productId },
          select: { id: true, stock: true },
        });

        if (!product) {
          throw new NotFoundException(`Product ${dto.productId} not found`);
        }

        throw new ConflictException(
          `Insufficient stock. Requested: ${dto.quantity}, available: ${product.stock}`,
        );
      }

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
}
