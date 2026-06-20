import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { StockService } from './stock.service';
import { PrismaService } from '../prisma/prisma.service';

// ── helpers ───────────────────────────────────────────────────────────────────

// tx mock passed to decreaseMany — simulates Prisma.TransactionClient
function makeTx(updateCount = 1, product: object | null = { id: 1, stock: 5 }) {
  return {
    product: {
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
      findUnique: jest.fn().mockResolvedValue(product),
    },
  } as any;
}

// prismaMock with $transaction that forwards the callback
const prismaMock = {
  $transaction: jest.fn((cb: (tx: any) => unknown) => cb(makeTx())),
  product: {
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('StockService', () => {
  let service: StockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: any) => unknown) => cb(makeTx()),
    );
  });

  // ── Requisito: stock solo se modifica desde StockService ──────────────────

  describe('decreaseMany() — fuente única de modificación de stock', () => {
    it('usa updateMany con WHERE stock >= quantity para cada item', async () => {
      const tx = makeTx(1);

      await service.decreaseMany(
        [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 3 },
        ],
        tx,
      );

      expect(tx.product.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
      expect(tx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 2, stock: { gte: 3 } },
        data: { stock: { decrement: 3 } },
      });
    });

    it('el guard atómico impide stock negativo: WHERE stock >= quantity es obligatorio', async () => {
      const tx = makeTx(1);

      await service.decreaseMany([{ productId: 5, quantity: 7 }], tx);

      expect(tx.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ stock: { gte: 7 } }),
        }),
      );
    });

    it('lanza ConflictException si el stock es insuficiente', async () => {
      const tx = makeTx(0, { id: 1, stock: 2 });

      await expect(
        service.decreaseMany([{ productId: 1, quantity: 5 }], tx),
      ).rejects.toThrow(ConflictException);
    });

    it('el mensaje de error incluye el stock disponible y la cantidad solicitada', async () => {
      const tx = makeTx(0, { id: 1, stock: 3 });

      await expect(
        service.decreaseMany([{ productId: 1, quantity: 10 }], tx),
      ).rejects.toThrow(/Requested: 10.*available: 3/);
    });

    it('lanza NotFoundException si el producto no existe', async () => {
      const tx = makeTx(0, null);

      await expect(
        service.decreaseMany([{ productId: 999, quantity: 1 }], tx),
      ).rejects.toThrow(NotFoundException);
    });

    it('aborta en el primer item fallido — no procesa los siguientes', async () => {
      const tx = makeTx(0, { id: 1, stock: 0 });

      await expect(
        service.decreaseMany(
          [
            { productId: 1, quantity: 5 }, // falla
            { productId: 2, quantity: 1 }, // no debe ejecutarse
          ],
          tx,
        ),
      ).rejects.toThrow(ConflictException);

      // Solo se intentó el primer item
      expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
    });

    it('no modifica stock sin pasar por decreaseMany (garantía de fuente única)', async () => {
      // Este test documenta que no existe otra ruta de modificación de stock
      // en StockService que no sea a través del guard atómico.
      const tx = makeTx(1);
      await service.decreaseMany([{ productId: 1, quantity: 1 }], tx);

      // Solo se llama updateMany — nunca update() ni upsert() directo
      expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.product.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stock: { decrement: 1 } },
        }),
      );
    });
  });

  // ── decrease() standalone ─────────────────────────────────────────────────

  describe('decrease() — uso standalone con transacción propia', () => {
    it('reduce el stock y retorna el producto actualizado', async () => {
      const updatedProduct = {
        id: 1,
        name: 'Laptop',
        stock: 15,
        category: { id: 1, name: 'Electronics' },
      };
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
        const tx = {
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue(updatedProduct),
          },
        };
        return cb(tx);
      });

      const result = await service.decrease({ productId: 1, quantity: 5 });

      expect(result).toMatchObject({ id: 1, name: 'Laptop', stock: 15 });
    });

    it('llama a updateMany con el guard WHERE stock >= quantity', async () => {
      let capturedTx: any;
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
        capturedTx = {
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'X', stock: 10, category: {} }),
          },
        };
        return cb(capturedTx);
      });

      await service.decrease({ productId: 1, quantity: 5 });

      expect(capturedTx.product.updateMany).toHaveBeenCalledWith({
        where: { id: 1, stock: { gte: 5 } },
        data: { stock: { decrement: 5 } },
      });
    });

    it('lanza ConflictException con stock insuficiente', async () => {
      prismaMock.$transaction.mockImplementation((cb: (tx: any) => unknown) =>
        cb(makeTx(0, { id: 1, stock: 3 })),
      );

      await expect(
        service.decrease({ productId: 1, quantity: 10 }),
      ).rejects.toThrow(ConflictException);
    });

    it('lanza NotFoundException si el producto no existe', async () => {
      prismaMock.$transaction.mockImplementation((cb: (tx: any) => unknown) =>
        cb(makeTx(0, null)),
      );

      await expect(
        service.decrease({ productId: 999, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('simula carrera concurrente: segunda compra falla con ConflictException', async () => {
      let callCount = 0;
      prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
        callCount++;
        const tx = {
          product: {
            updateMany: jest.fn().mockResolvedValue({ count: callCount === 1 ? 1 : 0 }),
            findUnique: jest
              .fn()
              .mockResolvedValueOnce({ id: 1, name: 'W', stock: 0, category: {} })
              .mockResolvedValueOnce({ id: 1, stock: 0 }),
          },
        };
        return cb(tx);
      });

      const first = await service.decrease({ productId: 1, quantity: 5 });
      expect(first).toMatchObject({ stock: 0 });

      await expect(service.decrease({ productId: 1, quantity: 5 })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── getStatus() ───────────────────────────────────────────────────────────

  describe('getStatus()', () => {
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

    it('consulta ordenada por nombre ascendente', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      await service.getStatus();
      expect(prismaMock.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('retorna arreglo vacío cuando no hay productos', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);
      expect(await service.getStatus()).toEqual([]);
    });
  });
});
