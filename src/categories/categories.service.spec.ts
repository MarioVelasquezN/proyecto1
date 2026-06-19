import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

const prismaMock = {
  category: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('crea una categoría válida', async () => {
      prismaMock.category.create.mockResolvedValue({ id: 1, name: 'Electronics' });

      const result = await service.create({ name: 'Electronics' });

      expect(result).toEqual({ id: 1, name: 'Electronics' });
      expect(prismaMock.category.create).toHaveBeenCalledWith({
        data: { name: 'Electronics' },
        select: { id: true, name: true },
      });
    });

    it('lanza ConflictException cuando el nombre ya existe (P2002)', async () => {
      prismaMock.category.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create({ name: 'Electronics' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('relanza errores desconocidos sin modificarlos', async () => {
      const dbError = new Error('Connection lost');
      prismaMock.category.create.mockRejectedValue(dbError);

      await expect(service.create({ name: 'Test' })).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('findAll', () => {
    it('lista categorías ordenadas por nombre', async () => {
      const categories = [
        { id: 2, name: 'Books' },
        { id: 1, name: 'Electronics' },
      ];
      prismaMock.category.findMany.mockResolvedValue(categories);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(prismaMock.category.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
    });

    it('retorna arreglo vacío cuando no hay categorías', async () => {
      prismaMock.category.findMany.mockResolvedValue([]);

      expect(await service.findAll()).toEqual([]);
    });
  });
});
