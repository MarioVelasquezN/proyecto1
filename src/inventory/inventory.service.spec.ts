import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';

// $transaction mock: executes the callback passing itself as `tx`.
// This mirrors Prisma interactive transactions — the callback receives
// the same mock object so tx.product.* calls hit the same jest.fn()s.
const prismaMock = {
  $transaction: jest.fn((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock)),
  product: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    jest.clearAllMocks();
    // Restore $transaction default after clearAllMocks resets it
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock),
    );
  });

  // ─── reduce correctamente stock ────────────────────────────────────────────

  describe('decrease — caso exitoso', () => {
    it('reduce correctamente el stock y retorna el producto actualizado', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findUnique.mockResolvedValue({
        id: 1,
        name: 'Laptop',
        stock: 15,
        category: { id: 1, name: 'Electronics' },
      });

      const result = await service.decrease({ productId: 1, quantity: 5 });

      expect(result).toMatchObject({ id: 1, name: 'Laptop', stock: 15 });
    });

    it('llama a updateMany con el decremento correcto', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findUnique.mockResolvedValue({
        id: 1,
        name: 'Laptop',
        stock: 10,
        category: { id: 1, name: 'Electronics' },
      });

      await service.decrease({ productId: 1, quantity: 5 });

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 5 } },
        data: { stock: { decrement: 5 } },
      });
    });
  });

  // ─── no permite stock negativo ─────────────────────────────────────────────

  describe('decrease — stock insuficiente', () => {
    it('no permite stock negativo — lanza ConflictException', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.product.findUnique.mockResolvedValue({ id: 1, stock: 3 });

      await expect(
        service.decrease({ productId: 1, quantity: 10 }),
      ).rejects.toThrow(ConflictException);
    });

    it('el mensaje incluye el stock disponible y la cantidad solicitada', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.product.findUnique.mockResolvedValue({ id: 1, stock: 3 });

      await expect(
        service.decrease({ productId: 1, quantity: 10 }),
      ).rejects.toThrow(/Requested: 10.*available: 3/);
    });

    it('nunca llama findUnique para el producto actualizado si la compra falla', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.product.findUnique.mockResolvedValue({ id: 1, stock: 2 });

      await expect(
        service.decrease({ productId: 1, quantity: 5 }),
      ).rejects.toThrow(ConflictException);

      // findUnique se llama solo UNA vez (para leer el stock disponible),
      // nunca la segunda vez (para retornar el producto actualizado).
      expect(prismaMock.product.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  // ─── falla si producto no existe ───────────────────────────────────────────

  describe('decrease — producto inexistente', () => {
    it('falla si producto no existe — lanza NotFoundException', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(
        service.decrease({ productId: 999, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('el mensaje incluye el id del producto no encontrado', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(
        service.decrease({ productId: 999, quantity: 1 }),
      ).rejects.toThrow('999');
    });
  });

  // ─── validar concurrencia básica ───────────────────────────────────────────

  describe('concurrencia', () => {
    it('updateMany incluye WHERE stock >= quantity — garantía atómica contra race conditions', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.product.findUnique.mockResolvedValue({
        id: 1,
        name: 'Widget',
        stock: 5,
        category: { id: 1, name: 'Tools' },
      });

      await service.decrease({ productId: 1, quantity: 3 });

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stock: { gte: 3 } }),
        }),
      );
    });

    it('dos compras simultáneas del mismo stock: la segunda retorna ConflictException', async () => {
      // Simula: stock=5, dos requests piden 5 unidades.
      // La primera llega primero a la BD (count:1), la segunda ya no encuentra
      // stock suficiente (count:0) y recibe ConflictException.
      prismaMock.product.updateMany
        .mockResolvedValueOnce({ count: 1 }) // primera compra: éxito
        .mockResolvedValueOnce({ count: 0 }); // segunda compra: stock agotado

      prismaMock.product.findUnique
        .mockResolvedValueOnce({ id: 1, name: 'Widget', stock: 0, category: { id: 1, name: 'T' } }) // post 1ra compra
        .mockResolvedValueOnce({ id: 1, stock: 0 }); // stock leído en la 2da compra (para el error)

      const first = await service.decrease({ productId: 1, quantity: 5 });
      expect(first).toMatchObject({ stock: 0 });

      await expect(
        service.decrease({ productId: 1, quantity: 5 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('retorna el inventario de todos los productos con categoría', async () => {
      const products = [
        { id: 1, name: 'Laptop', stock: 10, category: { id: 1, name: 'Electronics' } },
        { id: 2, name: 'Mouse', stock: 0, category: { id: 1, name: 'Electronics' } },
      ];
      prismaMock.product.findMany.mockResolvedValue(products);

      const result = await service.getStatus();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('stock');
      expect(result[0]).toHaveProperty('category');
    });

    it('retorna arreglo vacío cuando no hay productos', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      expect(await service.getStatus()).toEqual([]);
    });

    it('consulta ordenada por nombre ascendente', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      await service.getStatus();
      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });
  });
});
