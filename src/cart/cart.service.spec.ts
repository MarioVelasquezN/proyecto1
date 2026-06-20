import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CartService } from './cart.service';
import { PrismaService } from '../prisma/prisma.service';

// ── fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 1;
const CART_ID = 10;
const PRODUCT_ID = 5;

const mockProduct = { id: PRODUCT_ID };
const mockCart = { id: CART_ID };

const makeCartItem = (quantity = 2) => ({
  id: 1,
  productId: PRODUCT_ID,
  quantity,
  product: { id: PRODUCT_ID, name: 'Widget', price: 25.0 },
});

const makeFullCart = (items = [makeCartItem()]) => ({
  id: CART_ID,
  userId: USER_ID,
  updatedAt: new Date('2026-01-01'),
  items,
});

// ── mock ──────────────────────────────────────────────────────────────────────

const prismaMock = {
  product: { findUnique: jest.fn() },
  cart: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  cartItem: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    jest.clearAllMocks();

    // Defaults — overridden per test when needed.
    prismaMock.product.findUnique.mockResolvedValue(mockProduct);
    prismaMock.cart.upsert.mockResolvedValue(mockCart);
    prismaMock.cartItem.upsert.mockResolvedValue(makeCartItem());
    prismaMock.cartItem.deleteMany.mockResolvedValue({ count: 1 });
  });

  // ── add ───────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('agregar item al carrito: crea CartItem y retorna el carrito con total', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(makeFullCart());

      const result = await service.add({ productId: PRODUCT_ID, quantity: 2 }, USER_ID);

      expect(prismaMock.product.findUnique).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        select: { id: true },
      });
      expect(prismaMock.cart.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        create: { userId: USER_ID },
        update: {},
        select: { id: true },
      });
      expect(prismaMock.cartItem.upsert).toHaveBeenCalledWith({
        where: { cartId_productId: { cartId: CART_ID, productId: PRODUCT_ID } },
        create: { cartId: CART_ID, productId: PRODUCT_ID, quantity: 2 },
        update: { quantity: 2 },
      });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(50); // 2 × 25.00
    });

    it('actualizar cantidad: si el producto ya está en el carrito, reemplaza la cantidad', async () => {
      // Item previously had quantity 2; user sends quantity 5.
      prismaMock.cart.findUnique.mockResolvedValue(makeFullCart([makeCartItem(5)]));

      const result = await service.add({ productId: PRODUCT_ID, quantity: 5 }, USER_ID);

      expect(prismaMock.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { quantity: 5 } }),
      );
      expect(result.items[0].quantity).toBe(5);
      expect(result.total).toBe(125); // 5 × 25.00
    });

    it('lanza NotFoundException si el producto no existe', async () => {
      prismaMock.product.findUnique.mockResolvedValue(null);

      await expect(
        service.add({ productId: 99, quantity: 1 }, USER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.cart.upsert).not.toHaveBeenCalled();
      expect(prismaMock.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('auto-crea el Cart si el usuario no tiene uno (carrito devuelto vacío)', async () => {
      // After upsert cart + cartItem, the findUnique for getCartForUser returns empty.
      prismaMock.cart.findUnique.mockResolvedValue(null);

      const result = await service.add({ productId: PRODUCT_ID, quantity: 1 }, USER_ID);

      expect(prismaMock.cart.upsert).toHaveBeenCalled();
      expect(result).toEqual({ userId: USER_ID, items: [], total: 0 });
    });
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('retorna el carrito con items y total calculado', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(makeFullCart());

      const result = await service.get(USER_ID);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBeCloseTo(50);
    });

    it('retorna carrito vacío si el usuario no tiene un Cart', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(null);

      const result = await service.get(USER_ID);

      expect(result).toEqual({ userId: USER_ID, items: [], total: 0 });
    });

    it('el total suma precio × cantidad de cada item', async () => {
      const items = [
        { id: 1, productId: 1, quantity: 3, product: { id: 1, name: 'A', price: 10 } },
        { id: 2, productId: 2, quantity: 2, product: { id: 2, name: 'B', price: 15 } },
      ];
      prismaMock.cart.findUnique.mockResolvedValue(makeFullCart(items));

      const result = await service.get(USER_ID);

      expect(result.total).toBe(60); // 3×10 + 2×15
    });
  });

  // ── getForCheckout ────────────────────────────────────────────────────────

  describe('getForCheckout', () => {
    it('retorna el carrito con id, items, precio y stock del producto', async () => {
      const checkoutCart = {
        id: CART_ID,
        items: [
          { productId: PRODUCT_ID, quantity: 2, product: { id: PRODUCT_ID, price: 25.0, stock: 10 } },
        ],
      };
      prismaMock.cart.findUnique.mockResolvedValue(checkoutCart);

      const result = await service.getForCheckout(USER_ID);

      expect(prismaMock.cart.findUnique).toHaveBeenCalledWith({
        where: { userId: USER_ID },
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
      expect(result).toEqual(checkoutCart);
    });

    it('retorna null si el usuario no tiene carrito', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(null);

      const result = await service.getForCheckout(USER_ID);

      expect(result).toBeNull();
    });

    it('cart funciona independiente: CartService no depende de OrdersService ni CheckoutService', () => {
      // CartService solo necesita PrismaService — verifiable inspeccionando el módulo de test.
      // El módulo se compila sin inyectar OrdersService ni CheckoutService.
      expect(service).toBeDefined();
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('llama a tx.cartItem.deleteMany con el cartId correcto', async () => {
      const txMock = { cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) } } as any;

      await service.clear(CART_ID, txMock);

      expect(txMock.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: CART_ID } });
    });

    it('no lanza error si el carrito ya estaba vacío (count 0)', async () => {
      const txMock = { cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } } as any;

      await expect(service.clear(CART_ID, txMock)).resolves.toBeUndefined();
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('eliminar item: elimina CartItem y retorna carrito actualizado', async () => {
      prismaMock.cart.findUnique
        .mockResolvedValueOnce(mockCart)                    // lookup for remove
        .mockResolvedValueOnce(makeFullCart([]));           // getCartForUser after delete

      const result = await service.remove({ productId: PRODUCT_ID }, USER_ID);

      expect(prismaMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: CART_ID, productId: PRODUCT_ID },
      });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('lanza NotFoundException si el usuario no tiene ningún cart', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(null);

      await expect(
        service.remove({ productId: PRODUCT_ID }, USER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el producto no está en el carrito', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(mockCart);
      prismaMock.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.remove({ productId: 99 }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
