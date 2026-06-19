import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockCategory = { id: 1, name: 'Electronics' };

const validDto = {
  name: 'Laptop Pro',
  description: 'High-end laptop',
  price: 1299.99,
  stock: 20,
  categoryId: 1,
};

const makeProduct = (overrides = {}) => ({
  id: 1,
  name: 'Laptop Pro',
  description: 'High-end laptop',
  price: 1299.99,
  stock: 20,
  category: mockCategory,
  createdAt: new Date(),
  ...overrides,
});

// ── mock ──────────────────────────────────────────────────────────────────────

const prismaMock = {
  category: { findUnique: jest.fn() },
  product: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    jest.clearAllMocks();

    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany.mockResolvedValue([]);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('crea un producto válido cuando la categoría existe', async () => {
      prismaMock.category.findUnique.mockResolvedValue(mockCategory);
      prismaMock.product.create.mockResolvedValue(makeProduct());

      const result = await service.create(validDto, 1);

      expect(prismaMock.category.findUnique).toHaveBeenCalledWith({
        where: { id: validDto.categoryId },
      });
      expect(result).toMatchObject({
        id: 1,
        name: validDto.name,
        price: validDto.price,
        stock: validDto.stock,
        category: { id: 1, name: 'Electronics' },
      });
    });

    it('el resultado no expone createdById', async () => {
      prismaMock.category.findUnique.mockResolvedValue(mockCategory);
      prismaMock.product.create.mockResolvedValue(makeProduct());

      const result = await service.create(validDto, 1);

      expect(result).not.toHaveProperty('createdById');
    });

    it('lanza BadRequestException cuando categoryId no existe', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);

      await expect(service.create(validDto, 1)).rejects.toThrow(BadRequestException);
    });

    it('BadRequestException incluye el id de la categoría inválida', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);

      await expect(service.create({ ...validDto, categoryId: 99 }, 1)).rejects.toThrow('99');
    });

    it('no llama a product.create si la categoría no existe', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);

      await expect(service.create(validDto, 1)).rejects.toThrow();

      expect(prismaMock.product.create).not.toHaveBeenCalled();
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(() => {
      prismaMock.product.count.mockResolvedValue(2);
      prismaMock.product.findMany.mockResolvedValue([
        makeProduct({ id: 1 }),
        makeProduct({ id: 2, name: 'Mouse' }),
      ]);
    });

    // ── respuesta con metadata ────────────────────────────────────────────

    it('retorna { data, meta } con los productos y la metadata de paginación', async () => {
      const result = await service.findAll();

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('meta');
      expect(result.data).toHaveLength(2);
      expect(result.meta).toMatchObject({ total: 2, page: 1, limit: 10, totalPages: 1 });
    });

    it('los items de data incluyen categoría anidada y stock', async () => {
      const result = await service.findAll();

      expect(result.data[0]).toHaveProperty('category');
      expect(result.data[0]).toHaveProperty('stock');
    });

    it('data es arreglo vacío y total es 0 cuando no hay productos', async () => {
      prismaMock.product.count.mockResolvedValue(0);
      prismaMock.product.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    // ── búsqueda por nombre ───────────────────────────────────────────────

    it('búsqueda devuelve resultados correctos: pasa contains al WHERE', async () => {
      prismaMock.product.count.mockResolvedValue(1);
      prismaMock.product.findMany.mockResolvedValue([makeProduct()]);

      await service.findAll({ search: 'laptop' });

      const expectedWhere = { name: { contains: 'laptop' } };
      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prismaMock.product.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('sin search no añade filtro name al WHERE', async () => {
      await service.findAll({});

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    // ── filtro por categoría ──────────────────────────────────────────────

    it('filtro por categoryId: pasa categoryId al WHERE', async () => {
      await service.findAll({ categoryId: 3 });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { categoryId: 3 } }),
      );
    });

    // ── filtros combinados ────────────────────────────────────────────────

    it('filtros combinados: search + categoryId se aplican juntos', async () => {
      await service.findAll({ search: 'cable', categoryId: 2 });

      const expectedWhere = { name: { contains: 'cable' }, categoryId: 2 };
      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prismaMock.product.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    // ── ordenamiento ──────────────────────────────────────────────────────

    it('sin sortBy usa orderBy createdAt desc por defecto', async () => {
      await service.findAll({});

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('sortBy price asc ordena por precio ascendente', async () => {
      await service.findAll({ sortBy: 'price', sortOrder: 'asc' });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { price: 'asc' } }),
      );
    });

    it('sortBy stock desc ordena por stock descendente', async () => {
      await service.findAll({ sortBy: 'stock', sortOrder: 'desc' });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { stock: 'desc' } }),
      );
    });

    it('sortBy sin sortOrder usa asc como dirección por defecto', async () => {
      await service.findAll({ sortBy: 'price' });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { price: 'asc' } }),
      );
    });

    // ── paginación ────────────────────────────────────────────────────────

    it('page 1 limit 10 usa skip 0 take 10 por defecto', async () => {
      await service.findAll({});

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(prismaMock.product.count).toHaveBeenCalledTimes(1);
    });

    it('page 2 limit 5 usa skip 5 take 5', async () => {
      await service.findAll({ page: 2, limit: 5 });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('page 3 limit 10 usa skip 20', async () => {
      await service.findAll({ page: 3, limit: 10 });

      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('meta.totalPages se calcula correctamente: ceil(23/10) = 3', async () => {
      prismaMock.product.count.mockResolvedValue(23);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.meta.totalPages).toBe(3);
    });

    it('meta.totalPages es 0 cuando total es 0', async () => {
      prismaMock.product.count.mockResolvedValue(0);

      const result = await service.findAll();

      expect(result.meta.totalPages).toBe(0);
    });

    it('meta refleja los parámetros enviados', async () => {
      prismaMock.product.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 3, limit: 15 });

      expect(result.meta).toMatchObject({ page: 3, limit: 15, total: 50, totalPages: 4 });
    });
  });
});
