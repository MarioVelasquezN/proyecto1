import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsDto } from './dto/get-products.dto';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  price: true,
  stock: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, createdById: number) {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });

    if (!category) {
      throw new BadRequestException(`Category ${dto.categoryId} not found`);
    }

    return this.prisma.product.create({
      data: { ...dto, createdById },
      select: PRODUCT_SELECT,
    });
  }

  async findAll(dto: GetProductsDto = {}) {
    const { search, categoryId, sortBy, sortOrder, page = 1, limit = 10 } = dto;

    const where = {
      ...(search ? { name: { contains: search } } : {}),
      ...(categoryId ? { categoryId } : {}),
    };

    const orderBy = sortBy
      ? { [sortBy]: sortOrder ?? 'asc' }
      : { createdAt: 'desc' as const };

    const [total, data] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
