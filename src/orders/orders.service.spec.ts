import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { OrderStateMachine } from './order-state-machine';
import { Role } from '../auth/enums/role.enum';
import { OrderStatus } from './enums/order-status.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// ── mocks ─────────────────────────────────────────────────────────────────────

// Stock operations are now delegated to StockService.
// OrdersService no longer calls product.updateMany directly.
const stockServiceMock = {
  decreaseMany: jest.fn(),
};

const prismaMock = {
  $transaction: jest.fn(),
  order: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
};

// ── fixtures ──────────────────────────────────────────────────────────────────

const userPayload = (override: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 1,
  email: 'user@example.com',
  role: Role.User,
  ...override,
});

const adminPayload = (): JwtPayload =>
  userPayload({ sub: 99, email: 'admin@example.com', role: Role.Admin });

// Products include stock so the service can validate availability
const mockProducts = [
  { id: 1, price: 100.0, stock: 10 },
  { id: 2, price: 50.0, stock: 5 },
];

const makeOrder = (override: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 1,
  total: 200.0,
  status: 'pending',
  createdAt: new Date(),
  items: [
    {
      id: 1,
      productId: 1,
      quantity: 2,
      price: 100.0,
      product: { id: 1, name: 'Widget' },
    },
  ],
  ...override,
});

// ── suite ─────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockService, useValue: stockServiceMock },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);

    jest.clearAllMocks();
    // $transaction forwards its callback using the same mock object as `tx`
    prismaMock.$transaction.mockImplementation(
      (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock),
    );
    // Default: StockService.decreaseMany succeeds
    stockServiceMock.decreaseMany.mockResolvedValue(undefined);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    // ── orden se crea correctamente ──────────────────────────────────────────

    it('orden se crea correctamente con productos y stock suficiente', async () => {
      prismaMock.product.findMany.mockResolvedValue(mockProducts);
      const expected = makeOrder({ total: 250.0 });
      prismaMock.order.create.mockResolvedValue(expected);

      const result = await service.create(
        { items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }] },
        1,
      );

      expect(result).toEqual(expected);
      expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
    });

    it('persiste userId, total e items en la llamada a Prisma', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 30.0, stock: 20 }]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ total: 90.0 }));

      await service.create({ items: [{ productId: 1, quantity: 3 }] }, 7);

      expect(prismaMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 7,
            total: 90.0,
            items: {
              create: [{ productId: 1, quantity: 3, price: 30.0 }],
            },
          }),
        }),
      );
    });

    // ── total se calcula bien ────────────────────────────────────────────────

    it('total se calcula bien: suma de precio × cantidad de cada item', async () => {
      // product1: 100 × 2 = 200 | product2: 50 × 3 = 150 | total = 350
      prismaMock.product.findMany.mockResolvedValue([
        { id: 1, price: 100.0, stock: 10 },
        { id: 2, price: 50.0, stock: 10 },
      ]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ total: 350.0 }));

      await service.create(
        { items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }] },
        1,
      );

      expect(prismaMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ total: 350.0 }),
        }),
      );
    });

    it('total correcto con un solo item', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 29.99, stock: 10 }]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ total: 89.97 }));

      await service.create({ items: [{ productId: 1, quantity: 3 }] }, 1);

      expect(prismaMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ total: 89.97 }),
        }),
      );
    });

    it('precio en OrderItem es snapshot del producto al momento de la compra', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 99.99, stock: 10 }]);
      prismaMock.order.create.mockResolvedValue(makeOrder());

      await service.create({ items: [{ productId: 1, quantity: 1 }] }, 1);

      const createArgs = prismaMock.order.create.mock.calls[0][0];
      expect(createArgs.data.items.create[0].price).toBe(99.99);
    });

    // ── falla si no hay stock ────────────────────────────────────────────────

    it('falla si no hay stock → ConflictException', async () => {
      // stock=2, quantity=5
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 2 }]);

      await expect(
        service.create({ items: [{ productId: 1, quantity: 5 }] }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('mensaje de error incluye cuánto hay disponible', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 3 }]);

      const error = await service
        .create({ items: [{ productId: 1, quantity: 10 }] }, 1)
        .catch((e) => e);

      expect(error.message).toMatch(/requested.*10/i);
      expect(error.message).toMatch(/available.*3/i);
    });

    it('falla si stock es exactamente 0', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 0 }]);

      await expect(
        service.create({ items: [{ productId: 1, quantity: 1 }] }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('acepta orden cuando stock es exactamente igual a la cantidad pedida', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 3 }]);
      prismaMock.order.create.mockResolvedValue(makeOrder({ total: 30.0 }));

      await expect(
        service.create({ items: [{ productId: 1, quantity: 3 }] }, 1),
      ).resolves.toBeDefined();
    });

    it('falla en el primer item con stock insuficiente sin tocar los demás', async () => {
      prismaMock.product.findMany.mockResolvedValue([
        { id: 1, price: 10.0, stock: 1 }, // stock insuficiente
        { id: 2, price: 20.0, stock: 100 },
      ]);

      await expect(
        service.create(
          { items: [{ productId: 1, quantity: 5 }, { productId: 2, quantity: 1 }] },
          1,
        ),
      ).rejects.toThrow(ConflictException);

      // Validation failed before reaching StockService — no decrement attempted
      expect(stockServiceMock.decreaseMany).not.toHaveBeenCalled();
    });

    it('no se crea la orden si hay stock insuficiente', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 0 }]);

      await expect(
        service.create({ items: [{ productId: 1, quantity: 1 }] }, 1),
      ).rejects.toThrow();

      expect(prismaMock.order.create).not.toHaveBeenCalled();
    });

    it('falla si StockService.decreaseMany lanza por carrera concurrente', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 5 }]);
      // Concurrent tx consumed the stock between our findMany and decreaseMany
      stockServiceMock.decreaseMany.mockRejectedValue(
        new ConflictException('Insufficient stock for product 1 (concurrent update)'),
      );

      await expect(
        service.create({ items: [{ productId: 1, quantity: 3 }] }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('delega el decremento de stock a StockService.decreaseMany con los items correctos', async () => {
      prismaMock.product.findMany.mockResolvedValue(mockProducts);
      prismaMock.order.create.mockResolvedValue(makeOrder());

      await service.create(
        { items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }] },
        1,
      );

      expect(stockServiceMock.decreaseMany).toHaveBeenCalledWith(
        [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }],
        prismaMock, // tx recibido de $transaction
      );
    });

    // ── validación de existencia ─────────────────────────────────────────────

    it('lanza NotFoundException si un producto no existe', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);

      await expect(
        service.create({ items: [{ productId: 999, quantity: 1 }] }, 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('no toca el stock ni crea la orden si un producto no existe', async () => {
      prismaMock.product.findMany.mockResolvedValue([]);

      await expect(
        service.create({ items: [{ productId: 999, quantity: 1 }] }, 1),
      ).rejects.toThrow();

      expect(stockServiceMock.decreaseMany).not.toHaveBeenCalled();
      expect(prismaMock.order.create).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException aunque otros productos del pedido existan', async () => {
      prismaMock.product.findMany.mockResolvedValue([{ id: 1, price: 10.0, stock: 10 }]);

      await expect(
        service.create(
          { items: [{ productId: 1, quantity: 1 }, { productId: 999, quantity: 1 }] },
          1,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── persist ───────────────────────────────────────────────────────────────

  describe('persist', () => {
    const persistItems = [
      { productId: 1, quantity: 2, price: 100.0 },
      { productId: 2, quantity: 1, price: 50.0 },
    ];

    it('orders pueden crearse sin checkout: persist llama tx.order.create directamente', async () => {
      const txMock = { order: { create: jest.fn().mockResolvedValue(makeOrder({ total: 250.0 })) } } as any;

      await service.persist(txMock, 7, persistItems, 250.0);

      expect(txMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 7,
            total: 250.0,
            items: { create: persistItems },
          }),
        }),
      );
    });

    it('persist sin couponId no incluye couponId en el data', async () => {
      const txMock = { order: { create: jest.fn().mockResolvedValue(makeOrder()) } } as any;

      await service.persist(txMock, 1, persistItems, 150.0);

      const { data } = txMock.order.create.mock.calls[0][0];
      expect(data.couponId).toBeUndefined();
    });

    it('persist con couponId incluye couponId en el data', async () => {
      const txMock = { order: { create: jest.fn().mockResolvedValue(makeOrder()) } } as any;

      await service.persist(txMock, 1, persistItems, 120.0, 5);

      const { data } = txMock.order.create.mock.calls[0][0];
      expect(data.couponId).toBe(5);
    });

    it('persist retorna lo que devuelve tx.order.create', async () => {
      const expected = makeOrder({ total: 100 });
      const txMock = { order: { create: jest.fn().mockResolvedValue(expected) } } as any;

      const result = await service.persist(txMock, 1, persistItems, 100.0);

      expect(result).toEqual(expected);
    });

    it('persist no valida stock ni llama a StockService (esa responsabilidad es del caller)', async () => {
      const txMock = { order: { create: jest.fn().mockResolvedValue(makeOrder()) } } as any;

      await service.persist(txMock, 1, persistItems, 150.0);

      expect(stockServiceMock.decreaseMany).not.toHaveBeenCalled();
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('usuario normal solo ve sus propias órdenes → filtra por userId', async () => {
      prismaMock.order.findMany.mockResolvedValue([makeOrder()]);

      await service.findAll(userPayload({ sub: 7 }));

      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 7 } }),
      );
    });

    it('admin ve todas las órdenes sin filtro de userId', async () => {
      prismaMock.order.findMany.mockResolvedValue([makeOrder(), makeOrder({ id: 2, userId: 5 })]);

      await service.findAll(adminPayload());

      expect(prismaMock.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('retorna el array que devuelve Prisma', async () => {
      const orders = [makeOrder(), makeOrder({ id: 2 })];
      prismaMock.order.findMany.mockResolvedValue(orders);

      const result = await service.findAll(userPayload());

      expect(result).toEqual(orders);
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('retorna la orden si pertenece al usuario autenticado', async () => {
      const order = makeOrder({ userId: 1 });
      prismaMock.order.findUnique.mockResolvedValue(order);

      const result = await service.findOne(1, userPayload({ sub: 1 }));

      expect(result).toEqual(order);
    });

    it('admin puede ver la orden de cualquier usuario', async () => {
      const order = makeOrder({ userId: 42 });
      prismaMock.order.findUnique.mockResolvedValue(order);

      const result = await service.findOne(1, adminPayload());

      expect(result).toEqual(order);
    });

    it('lanza NotFoundException si la orden pertenece a otro usuario (validar relación user-order)', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ userId: 99 }));

      await expect(
        service.findOne(1, userPayload({ sub: 1 })),
      ).rejects.toThrow(NotFoundException);
    });

    it('usa NotFoundException (no ForbiddenException) para no revelar que la orden existe', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ userId: 99 }));

      const error = await service.findOne(1, userPayload({ sub: 1 })).catch((e) => e);

      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('lanza NotFoundException si la orden no existe en BD', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999, userPayload())).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    // ── admin puede cambiar estado (transiciones válidas) ────────────────────

    it('admin puede cambiar estado: pending → paid', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'pending' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'paid' }));

      const result = await service.updateStatus(1, { status: OrderStatus.Paid });

      expect(result.status).toBe('paid');
      expect(prismaMock.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: OrderStatus.Paid },
        }),
      );
    });

    it('pending → cancelled (transición válida)', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'pending' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'cancelled' }));

      const result = await service.updateStatus(1, { status: OrderStatus.Cancelled });
      expect(result.status).toBe('cancelled');
      expect(prismaMock.order.update).toHaveBeenCalledTimes(1);
    });

    it('paid → delivered (transición válida)', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'paid' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'delivered' }));

      const result = await service.updateStatus(1, { status: OrderStatus.Delivered });
      expect(result.status).toBe('delivered');
    });

    // ── transición inválida rechazada ────────────────────────────────────────

    it.each([
      ['paid',      OrderStatus.Pending,   'retroceso no permitido'],
      ['paid',      OrderStatus.Cancelled, 'paid no puede cancelarse'],
      ['delivered', OrderStatus.Paid,      'estado terminal'],
      ['delivered', OrderStatus.Pending,   'estado terminal'],
      ['delivered', OrderStatus.Cancelled, 'estado terminal'],
      ['cancelled', OrderStatus.Paid,      'estado terminal'],
      ['cancelled', OrderStatus.Pending,   'estado terminal'],
    ] as const)(
      "transición inválida '%s' → '%s' lanza UnprocessableEntityException (%s)",
      async (from, to, _label) => {
        prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: from }));

        await expect(
          service.updateStatus(1, { status: to }),
        ).rejects.toThrow(UnprocessableEntityException);

        // La orden NO se persiste cuando la transición es inválida
        expect(prismaMock.order.update).not.toHaveBeenCalled();
      },
    );

    it('mensaje de error describe origen y destino de la transición inválida', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'paid' }));

      const error = await service
        .updateStatus(1, { status: OrderStatus.Pending })
        .catch((e) => e);

      expect(error.message).toMatch(/paid/);
      expect(error.message).toMatch(/pending/);
    });

    it('estado terminal cancelled no permite ninguna transición', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'cancelled' }));

      await expect(
        service.updateStatus(1, { status: OrderStatus.Paid }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('estado terminal delivered no permite ninguna transición', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'delivered' }));

      await expect(
        service.updateStatus(1, { status: OrderStatus.Pending }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    // ── no hay lógica de estado fuera de state machine ──────────────────────

    it('delega la validación de transición a OrderStateMachine.transition', async () => {
      const spy = jest.spyOn(OrderStateMachine, 'transition');
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'pending' }));
      prismaMock.order.update.mockResolvedValue(makeOrder({ status: 'paid' }));

      await service.updateStatus(1, { status: OrderStatus.Paid });

      expect(spy).toHaveBeenCalledWith(OrderStatus.Pending, OrderStatus.Paid);
      spy.mockRestore();
    });

    it('transición inválida lanzada por OrderStateMachine se propaga al caller', async () => {
      prismaMock.order.findUnique.mockResolvedValue(makeOrder({ status: 'delivered' }));

      await expect(
        service.updateStatus(1, { status: OrderStatus.Pending }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(prismaMock.order.update).not.toHaveBeenCalled();
    });

    // ── orden inexistente ────────────────────────────────────────────────────

    it('lanza NotFoundException si la orden no existe', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(999, { status: OrderStatus.Paid }),
      ).rejects.toThrow(NotFoundException);
    });

    it('no intenta actualizar si la orden no existe', async () => {
      prismaMock.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(999, { status: OrderStatus.Paid }),
      ).rejects.toThrow();

      expect(prismaMock.order.update).not.toHaveBeenCalled();
    });
  });

  // ── Validación de DTOs ────────────────────────────────────────────────────

  describe('CreateOrderDto — validación', () => {
    it('crear orden vacía (items: []) → error ArrayMinSize(1)', async () => {
      const dto = plainToInstance(CreateOrderDto, { items: [] });
      const errors = await validate(dto);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('items');
    });

    it('items ausente → error de validación', async () => {
      const errors = await validate(plainToInstance(CreateOrderDto, {}));
      expect(errors.length).toBeGreaterThan(0);
    });

    it('item con productId no entero → error', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        items: [{ productId: 'abc', quantity: 1 }],
      });
      const errors = await validate(dto, { validationError: { target: false } });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('item con quantity = 0 → error IsPositive', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, quantity: 0 }],
      });
      const errors = await validate(dto, { validationError: { target: false } });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('item con quantity negativa → error IsPositive', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, quantity: -3 }],
      });
      const errors = await validate(dto, { validationError: { target: false } });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('items con datos válidos → sin errores', async () => {
      const dto = plainToInstance(CreateOrderDto, {
        items: [{ productId: 1, quantity: 2 }, { productId: 3, quantity: 1 }],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('UpdateOrderStatusDto — validar estados permitidos', () => {
    it.each(Object.values(OrderStatus))('estado válido "%s" es aceptado', async (status) => {
      const errors = await validate(plainToInstance(UpdateOrderStatusDto, { status }));
      expect(errors).toHaveLength(0);
    });

    it('estado inválido "shipped" → error', async () => {
      const errors = await validate(
        plainToInstance(UpdateOrderStatusDto, { status: 'shipped' }),
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('status');
    });

    it('estado "PENDING" en mayúsculas → error (solo acepta minúsculas DB-compatibles)', async () => {
      const errors = await validate(
        plainToInstance(UpdateOrderStatusDto, { status: 'PENDING' }),
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it('status ausente → error', async () => {
      const errors = await validate(plainToInstance(UpdateOrderStatusDto, {}));
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
