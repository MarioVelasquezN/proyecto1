/**
 * Controller-level tests for OrdersController.
 *
 * These tests verify the HTTP contract and guard enforcement using
 * overrideGuard() so they run without a real database or JWT infrastructure.
 * The guard mock faithfully reads the @Roles() metadata from each handler,
 * which means the tests break if the decorator is ever removed.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import * as request from 'supertest';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/enums/role.enum';
import { OrderStatus } from './enums/order-status.enum';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// ── helpers ───────────────────────────────────────────────────────────────────

// currentUser is set per-test so each scenario can supply a different identity.
let currentUser: JwtPayload;

const adminUser = (): JwtPayload => ({
  sub: 1, email: 'admin@example.com', role: Role.Admin,
});
const regularUser = (): JwtPayload => ({
  sub: 2, email: 'user@example.com', role: Role.User,
});

// Injects the current user into the request (replacing real JWT verification).
const jwtGuardMock = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  },
};

// Reads @Roles() metadata directly from the handler so the test is coupled to
// the real decorator, not to a hard-coded role list in the mock.
const rolesGuardMock = {
  canActivate: (ctx: ExecutionContext) => {
    const required: Role[] = Reflect.getMetadata('roles', ctx.getHandler()) ?? [];
    if (!required.length) return true;
    if (!required.includes(currentUser.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  },
};

// ── mock service ──────────────────────────────────────────────────────────────

const makeOrder = (status = 'pending') => ({
  id: 1,
  userId: 1,
  total: 100,
  status,
  createdAt: new Date(),
  items: [],
});

const mockOrdersService = {
  create: jest.fn().mockResolvedValue(makeOrder()),
  findAll: jest.fn().mockResolvedValue([makeOrder()]),
  findOne: jest.fn().mockResolvedValue(makeOrder()),
  updateStatus: jest.fn().mockResolvedValue(makeOrder('paid')),
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('OrdersController', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: mockOrdersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuardMock)
      .overrideGuard(RolesGuard)
      .useValue(rolesGuardMock)
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    jest.clearAllMocks();
    mockOrdersService.updateStatus.mockResolvedValue(makeOrder('paid'));
    mockOrdersService.findAll.mockResolvedValue([makeOrder()]);
    mockOrdersService.findOne.mockResolvedValue(makeOrder());
    mockOrdersService.create.mockResolvedValue(makeOrder());
  });

  afterEach(() => app.close());

  // ── PATCH /orders/:id/status ──────────────────────────────────────────────

  describe('PATCH /orders/:id/status', () => {
    // ── admin puede cambiar estado ───────────────────────────────────────────

    it('admin puede cambiar estado → 200 con la orden actualizada', async () => {
      currentUser = adminUser();

      const res = await request(app.getHttpServer())
        .patch('/orders/1/status')
        .send({ status: OrderStatus.Paid })
        .expect(200);

      expect(res.body.status).toBe('paid');
      expect(mockOrdersService.updateStatus).toHaveBeenCalledWith(1, {
        status: OrderStatus.Paid,
      });
    });

    it('admin puede usar cualquier status válido del enum', async () => {
      currentUser = adminUser();

      for (const status of Object.values(OrderStatus)) {
        mockOrdersService.updateStatus.mockResolvedValue(makeOrder(status));

        const res = await request(app.getHttpServer())
          .patch('/orders/1/status')
          .send({ status })
          .expect(200);

        expect(res.body.status).toBe(status);
      }
    });

    // ── user no admin es bloqueado ───────────────────────────────────────────

    it('user no admin es bloqueado → 403', async () => {
      currentUser = regularUser();

      await request(app.getHttpServer())
        .patch('/orders/1/status')
        .send({ status: OrderStatus.Paid })
        .expect(403);
    });

    it('servicio no se invoca cuando el guard rechaza al usuario', async () => {
      currentUser = regularUser();

      await request(app.getHttpServer())
        .patch('/orders/1/status')
        .send({ status: OrderStatus.Paid });

      expect(mockOrdersService.updateStatus).not.toHaveBeenCalled();
    });

    it('status inválido en body → 400 (ValidationPipe activo)', async () => {
      currentUser = adminUser();

      await request(app.getHttpServer())
        .patch('/orders/1/status')
        .send({ status: 'shipped' })
        .expect(400);
    });

    it('id no numérico → 400 (ParseIntPipe)', async () => {
      currentUser = adminUser();

      await request(app.getHttpServer())
        .patch('/orders/abc/status')
        .send({ status: OrderStatus.Paid })
        .expect(400);
    });
  });

  // ── GET /orders ───────────────────────────────────────────────────────────

  describe('GET /orders', () => {
    it('usuario autenticado puede listar órdenes → 200', async () => {
      currentUser = regularUser();

      const res = await request(app.getHttpServer())
        .get('/orders')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(mockOrdersService.findAll).toHaveBeenCalledWith(currentUser);
    });
  });

  // ── GET /orders/:id ───────────────────────────────────────────────────────

  describe('GET /orders/:id', () => {
    it('usuario autenticado puede obtener una orden → 200', async () => {
      currentUser = regularUser();

      const res = await request(app.getHttpServer())
        .get('/orders/1')
        .expect(200);

      expect(res.body.id).toBe(1);
      expect(mockOrdersService.findOne).toHaveBeenCalledWith(1, currentUser);
    });
  });

  // ── POST /orders ──────────────────────────────────────────────────────────

  describe('POST /orders', () => {
    it('usuario autenticado puede crear una orden → 201', async () => {
      currentUser = regularUser();

      await request(app.getHttpServer())
        .post('/orders')
        .send({ items: [{ productId: 1, quantity: 2 }] })
        .expect(201);

      expect(mockOrdersService.create).toHaveBeenCalledWith(
        { items: [{ productId: 1, quantity: 2 }] },
        currentUser.sub,
      );
    });

    it('body vacío (sin items) → 400', async () => {
      currentUser = regularUser();

      await request(app.getHttpServer())
        .post('/orders')
        .send({})
        .expect(400);
    });
  });
});
