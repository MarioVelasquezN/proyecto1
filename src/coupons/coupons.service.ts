import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCouponDto) {
    try {
      return await this.prisma.coupon.create({
        data: {
          code: dto.code,
          percentage: dto.percentage,
          expiresAt: new Date(dto.expiresAt),
          isActive: dto.isActive ?? true,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`Coupon code '${dto.code}' already exists`);
      }
      throw e;
    }
  }

  findAll() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
