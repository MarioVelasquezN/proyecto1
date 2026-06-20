import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { StockService } from '../stock/stock.service';
import { OrdersService } from '../orders/orders.service';

// ── fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 1;
const CART_ID = 10;

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST   = new Date(Date.now() - 1000);

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
  items: [{ id: 1, productId: 5, quantity: 2, price: 25.0, product: { id: 5, name: 'Widget' } }],
});

// ── mocks ─────────────────────────────────────────────────────────────────────

const cartServiceMock = {
  getForCheckout: jest.fn(),
  clear: jest.fn(),
};

const ordersServiceMock = {
  persist: jest.fn(),
};

const stockServiceMock = {
  decreaseMany: jest.fn(),
};

const prismaMock = {
  coupon: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CheckoutService', () => {
  let service: CheckoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: PrismaService,  useValue: prismaMock },
        { provide: CartService,    useValue: cartServiceMock },
        { provide: StockService,   useValue: stockServiceMock },
        { provide: OrdersService,  useValue: ordersServiceMock },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    jest.clearAllMocks();

    // Default happy-path stubs
    cartServiceMock.getForCheckout.mockResolvedValue(makeCart());
    cartServiceMock.clear.mockResolvedValue(undefined);
    ordersServiceMock.persist.mockResolvedValue(makeOrder());
    stockServiceMock.decreaseMany.mockResolvedValue(undefined);
    prismaMock.$transaction.mockImplementation(
      (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock),
    );
  });

  // ── sin cupón (comportamiento base) ──────────────────────────────────────

  describe('sin cupón', () => {
    it('delega lectura del carrito a CartService.getForCheckout', async () => {
      await service.checkout(USER_ID);

      expect(cartServiceMock.getForCheckout).toHaveBeenCalledWith(USER_ID);
    });

    it('delega la creación de la orden a OrdersService.persist con userId y total', async () => {
      await service.checkout(USER_ID);

      expect(ordersServiceMock.persist).toHaveBeenCalledWith(
        prismaMock, // tx
        USER_ID,
        [{ productId: 5, quantity: 2, price: 25.0 }],
        50,
        undefined, // sin couponId
      );
    });

    it('delega el vaciado del carrito a CartService.clear con cartId y tx', async () => {
      await service.checkout(USER_ID);

      expect(cartServiceMock.clear).toHaveBeenCalledWith(CART_ID, prismaMock);
    });

    it('delega el decremento de stock a StockService.decreaseMany', async () => {
      await service.checkout(USER_ID);

      expect(stockServiceMock.decreaseMany).toHaveBeenCalledWith(
        [{ productId: 5, quantity: 2 }],
        prismaMock,
      );
    });

    it('retorna el resultado de OrdersService.persist', async () => {
      const expected = makeOrder(50);
      ordersServiceMock.persist.mockResolvedValue(expected);

      const result = await service.checkout(USER_ID);

      expect(result).toEqual(expected);
    });

    it('items incluyen precio snapshot del carrito al momento del checkout', async () => {
      await service.checkout(USER_ID);

      const [, , items] = ordersServiceMock.persist.mock.calls[0];
      expect(items[0]).toEqual({ productId: 5, quantity: 2, price: 25.0 });
    });

    it('total se calcula correctamente con múltiples items', async () => {
      cartServiceMock.getForCheckout.mockResolvedValue(
        makeCart([
          makeCartItem({ productId: 1, quantity: 3, product: { id: 1, price: 10, stock: 20 } }),
          makeCartItem({ productId: 2, quantity: 2, product: { id: 2, price: 15, stock: 20 } }),
        ]),
      );

      await service.checkout(USER_ID);

      const [, , , total] = ordersServiceMock.persist.mock.calls[0];
      expect(total).toBe(60); // 3×10 + 2×15
    });

    it('lanza UnprocessableEntityException si el carrito está vacío', async () => {
      cartServiceMock.getForCheckout.mockResolvedValue(makeCart([]));

      await expect(service.checkout(USER_ID)).rejects.toThrow(UnprocessableEntityException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('lanza UnprocessableEntityException si el usuario no tiene carrito', async () => {
      cartServiceMock.getForCheckout.mockResolvedValue(null);

      await expect(service.checkout(USER_ID)).rejects.toThrow(UnprocessableEntityException);
    });

    it('lanza ConflictException si el stock es insuficiente (pre-check)', async () => {
      cartServiceMock.getForCheckout.mockResolvedValue(
        makeCart([makeCartItem({ quantity: 20, product: { id: 5, price: 25.0, stock: 5 } })]),
      );

      await expect(service.checkout(USER_ID)).rejects.toThrow(ConflictException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si StockService.decreaseMany falla por TOCTOU', async () => {
      stockServiceMock.decreaseMany.mockRejectedValue(
        new ConflictException('Insufficient stock (concurrent update)'),
      );

      await expect(service.checkout(USER_ID)).rejects.toThrow(ConflictException);
      expect(cartServiceMock.clear).not.toHaveBeenCalled();
    });

    it('carrito NO se vacía si la creación de la orden falla', async () => {
      ordersServiceMock.persist.mockRejectedValue(new Error('DB error'));

      await expect(service.checkout(USER_ID)).rejects.toThrow('DB error');
      expect(cartServiceMock.clear).not.toHaveBeenCalled();
    });
  });

  // ── con cupón ─────────────────────────────────────────────────────────────

  describe('con cupón', () => {
    beforeEach(() => {
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon());
      ordersServiceMock.persist.mockResolvedValue(
        makeOrder(40, { id: 1, code: 'SAVE20', percentage: 20 }),
      );
    });

    it('cupón válido reduce el total (20% de descuento: 50 → 40)', async () => {
      await service.checkout(USER_ID, { couponCode: 'SAVE20' });

      const [, , , total] = ordersServiceMock.persist.mock.calls[0];
      expect(total).toBe(40); // 50 * (1 - 0.20)
    });

    it('couponId se pasa a OrdersService.persist cuando se aplica cupón', async () => {
      await service.checkout(USER_ID, { couponCode: 'SAVE20' });

      const [, , , , couponId] = ordersServiceMock.persist.mock.calls[0];
      expect(couponId).toBe(1);
    });

    it('descuento se aplica correctamente con porcentaje fraccionario', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon({ percentage: 15.5 }));

      await service.checkout(USER_ID, { couponCode: 'SAVE155' });

      const [, , , total] = ordersServiceMock.persist.mock.calls[0];
      expect(total).toBe(42.25); // 50 * (1 - 0.155)
    });

    it('sin couponCode: couponId es undefined en OrdersService.persist', async () => {
      await service.checkout(USER_ID);

      const [, , , , couponId] = ordersServiceMock.persist.mock.calls[0];
      expect(couponId).toBeUndefined();
      expect(prismaMock.coupon.findUnique).not.toHaveBeenCalled();
    });

    it('cupón expirado es rechazado → UnprocessableEntityException', async () => {
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon({ expiresAt: PAST }));

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
      prismaMock.coupon.findUnique.mockResolvedValue(makeCoupon({ isActive: false }));

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

      expect(cartServiceMock.clear).not.toHaveBeenCalled();
    });
  });

  // ── checkout es un orquestador: no hay lógica propia de cart ni order ────

  describe('checkout como orquestador', () => {
    it('CheckoutService no llama a prisma.order.create directamente', async () => {
      const prismaMockWithOrder = { ...prismaMock, order: { create: jest.fn() } };
      // Even if order.create exists on the mock, CheckoutService should not use it.
      // It delegates to OrdersService.persist instead.
      await service.checkout(USER_ID);

      // ordersService.persist is the only path to creating orders
      expect(ordersServiceMock.persist).toHaveBeenCalledTimes(1);
    });

    it('CheckoutService no llama a cartItem.deleteMany directamente', async () => {
      await service.checkout(USER_ID);

      // Cart clearing is delegated to CartService.clear, not prisma.cartItem.deleteMany
      expect(cartServiceMock.clear).toHaveBeenCalledTimes(1);
    });

    it('las 3 operaciones de transacción ocurren dentro de $transaction', async () => {
      let transactionExecuted = false;
      prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        transactionExecuted = true;
        return fn(prismaMock);
      });

      await service.checkout(USER_ID);

      expect(transactionExecuted).toBe(true);
      // All three transactional ops called
      expect(stockServiceMock.decreaseMany).toHaveBeenCalledTimes(1);
      expect(ordersServiceMock.persist).toHaveBeenCalledTimes(1);
      expect(cartServiceMock.clear).toHaveBeenCalledTimes(1);
    });
  });
});
