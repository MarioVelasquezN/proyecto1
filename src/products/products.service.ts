import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
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

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_SELECT,
    });

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }

  async update(id: number, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    if (dto.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) {
        throw new BadRequestException(`Category ${dto.categoryId} not found`);
      }
    }

    return this.prisma.product.update({
      where: { id },
      data: dto,
      select: PRODUCT_SELECT,
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    try {
      return await this.prisma.product.delete({
        where: { id },
        select: PRODUCT_SELECT,
      });
    } catch {
      throw new ConflictException(
        `Product ${id} cannot be deleted because it has associated orders or cart items`,
      );
    }
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
