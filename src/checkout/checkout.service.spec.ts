import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../prisma/prisma.service';

// ── fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 1;
const CART_ID = 10;

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 1000);

const makeCartItem = (overrides: Record<string, unknown> = {}) => ({
  productId: 5,
  quantity: 2,
  product: { id: 5, price: 25.0, stock: 10 },
  ...overrides,
});

const makeCart = (items = [makeCartItem()]) => ({ id: CART_ID, items });

const makeCoupon = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  percentage: 20,
  expiresAt: FUTURE,
  isActive: true,
  ...overrides,
});

const makeOrder = (total = 50, coupon: Record<string, unknown> | null = null) => ({
  id: 1,
  userId: USER_ID,
  total,
  status: 'pending',
  createdAt: new Date(),
  coupon,
  items: [
    {
      id: 1,
      productId: 5,
      quantity: 2,
      price: 25.0,
      product: { id: 5, name: 'Widget' },
    },
  ],
});

// ── mock ──────────────────────────────────────────────────────────────────────

const prismaMock = {
  cart: { findUnique: jest.fn() },
  coupon: { findUnique: jest.fn() },
  product: { updateMany: jest.fn() },
  order: { create: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CheckoutService', () => {
  let service: CheckoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    jest.clearAllMocks();

    prismaMock.cart.findUnique.mockResolvedValue(makeCart());
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.order.create.mockResolvedValue(makeOrder());
    prismaMock.cartItem.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock),
    );
  });

  // ── sin cupón (comportamiento base) ──────────────────────────────────────

  describe('sin cupón', () => {
    it('carrito se convierte en orden con total correcto', async () => {
      const result = await service.checkout(USER_ID);

      expect(prismaMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: USER_ID, total: 50 }),
        }),
      );
      expect(result.total).toBe(50);
    });

    it('carrito queda vacío: cartItem.deleteMany se llama con el cartId', async () => {
      await service.checkout(USER_ID);

      expect(prismaMock.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: CART_ID },
      });
    });

    it('stock se reduce con WHERE stock >= quantity', async () => {
      await service.checkout(USER_ID);

      expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 5, stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });
    });

    it('items incluyen precio snapshot en el momento del checkout', async () => {
      await service.checkout(USER_ID);

      const { data } = prismaMock.order.create.mock.calls[0][0];
      expect(data.items.create[0]).toEqual({ productId: 5, quantity: 2, price: 25.0 });
    });

    it('total se calcula correctamente con múltiples items', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(
        makeCart([
          makeCartItem({ productId: 1, quantity: 3, product: { id: 1, price: 10, stock: 20 } }),
          makeCartItem({ productId: 2, quantity: 2, product: { id: 2, price: 15, stock: 20 } }),
        ]),
      );
      prismaMock.order.create.mockResolvedValue(makeOrder(60));

      await service.checkout(USER_ID);

      const { data } = prismaMock.order.create.mock.calls[0][0];
      expect(data.total).toBe(60); // 3×10 + 2×15
    });

    it('lanza UnprocessableEntityException si el carrito está vacío', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(makeCart([]));

      await expect(service.checkout(USER_ID)).rejects.toThrow(UnprocessableEntityException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('lanza UnprocessableEntityException si el usuario no tiene carrito', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(null);

      await expect(service.checkout(USER_ID)).rejects.toThrow(UnprocessableEntityException);
    });

    it('lanza ConflictException si el stock es insuficiente', async () => {
      prismaMock.cart.findUnique.mockResolvedValue(
        makeCart([makeCartItem({ quantity: 20, product: { id: 5, price: 25.0, stock: 5 } })]),
      );

      await expect(service.checkout(USER_ID)).rejects.toThrow(ConflictException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('lanza ConflictException por TOCTOU cuando updateMany retorna count:0', async () => {
      prismaMock.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.checkout(USER_ID)).rejects.toThrow(ConflictException);
      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('carrito NO se vacía si la creación de la orden falla', async () => {
      prismaMock.order.create.mockRejectedValue(new Error('DB error'));

      await expect(service.checkout(USER_ID)).rejects.toThrow('DB error');
      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ── con cupón ─────────────────────────────────────────────────────────────

  describe('con cupón', () => {
    beforeEach(() => {
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon());
      prismaMock.order.create.mockResolvedValue(
        makeOrder(40, { id: 1, code: 'SAVE20', percentage: 20 }),
      );
    });

    it('cupón válido reduce el total (20% de descuento: 50 → 40)', async () => {
      const result = await service.checkout(USER_ID, { couponCode: 'SAVE20' });

      const { data } = prismaMock.order.create.mock.calls[0][0];
      expect(data.total).toBe(40); // 50 * (1 - 0.20)
      expect(result.total).toBe(40);
    });

    it('couponId se guarda en la orden cuando se aplica cupón', async () => {
      await service.checkout(USER_ID, { couponCode: 'SAVE20' });

      const { data } = prismaMock.order.create.mock.calls[0][0];
      expect(data.couponId).toBe(1);
    });

    it('descuento se aplica correctamente con porcentaje fraccionario', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon({ percentage: 15.5 }));

      await service.checkout(USER_ID, { couponCode: 'SAVE155' });

      const { data } = prismaMock.order.create.mock.calls[0][0];
      // 50 * (1 - 0.155) = 50 * 0.845 = 42.25
      expect(data.total).toBe(42.25);
    });

    it('sin couponCode: couponId no se incluye en la orden', async () => {
      await service.checkout(USER_ID);

      const { data } = prismaMock.order.create.mock.calls[0][0];
      expect(data.couponId).toBeUndefined();
      expect(prismaMock.coupon.findUnique).not.toHaveBeenCalled();
    });

    it('cupón expirado es rechazado → UnprocessableEntityException', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(
        makeCoupon({ expiresAt: PAST }),
      );

      await expect(
        service.checkout(USER_ID, { couponCode: 'OLD20' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('cupón no encontrado → NotFoundException', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(USER_ID, { couponCode: 'NOEXIST' }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('cupón inactivo → UnprocessableEntityException', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(
        makeCoupon({ isActive: false }),
      );

      await expect(
        service.checkout(USER_ID, { couponCode: 'INACTIVE' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('error en cupón no vacía el carrito', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(null);

      await expect(
        service.checkout(USER_ID, { couponCode: 'NOEXIST' }),
      ).rejects.toThrow();

      expect(prismaMock.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });
});
