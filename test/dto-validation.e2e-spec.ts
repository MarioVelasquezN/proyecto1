/**
 * DTO Validation E2E — campos numéricos
 *
 * Verifica, sobre el servidor real con ValidationPipe activo, que:
 *   1. Strings numéricos se convierten a number antes de la validación (@Type).
 *   2. Valores inválidos (negativos, decimales donde se espera entero, cero
 *      donde se espera positivo) devuelven 400 con mensaje preciso.
 *   3. Campos extra son rechazados por forbidNonWhitelisted (whitelist).
 *
 * Nota: PATCH /products/:id no está implementado en el controller actual;
 * los tests de coerción de ese endpoint se añadirán cuando exista la ruta.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

// ── helpers ───────────────────────────────────────────────────────────────────

function post(app: INestApplication, path: string, token: string) {
  return (body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
}

// Asserts that a 400 body contains the expected validation message.
function expectMessage(body: { message: string | string[] }, fragment: string) {
  const msgs = Array.isArray(body.message) ? body.message : [body.message];
  const found = msgs.some((m) => m.includes(fragment));
  if (!found) {
    throw new Error(
      `Expected message containing "${fragment}", got: ${JSON.stringify(msgs)}`,
    );
  }
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('DTO Validation — campos numéricos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let categoryId: number;

  // ── setup global ─────────────────────────────────────────────────────────

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);

    // Admin: register → promote → login
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'admin@val.com', password: 'Admin1234!', name: 'Admin' });
    await prisma.user.update({
      where: { email: 'admin@val.com' },
      data: { role: Role.Admin },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@val.com', password: 'Admin1234!' });
    adminToken = adminLogin.body.accessToken;

    // User: register (token comes from registration)
    const userReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@val.com', password: 'User1234!', name: 'User' });
    userToken = userReg.body.accessToken;

    // Shared category for all product tests
    const catRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Validation Category' });
    categoryId = catRes.body.id;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  // ── POST /products ────────────────────────────────────────────────────────

  describe('POST /products — validación de campos numéricos', () => {
    const validPayload = () => ({
      name: 'Laptop Pro',
      price: 1299.99,
      stock: 10,
      categoryId,
    });

    beforeEach(async () => {
      await prisma.product.deleteMany();
    });

    // ── coerción string → number ──────────────────────────────────────────

    it('201 — acepta price, stock y categoryId enviados como strings numéricos', async () => {
      const res = await post(app, '/products', adminToken)({
        name: 'Laptop Pro',
        price: '1299.99',
        stock: '10',
        categoryId: String(categoryId),
      }).expect(201);

      // Verifica que los valores llegan al recurso como números, no strings
      expect(res.body.price).toBe(1299.99);
      expect(typeof res.body.price).toBe('number');
      expect(res.body.stock).toBe(10);
      expect(typeof res.body.stock).toBe('number');
    });

    it('201 — acepta price como entero string ("100")', async () => {
      await post(app, '/products', adminToken)({
        ...validPayload(),
        price: '100',
      }).expect(201);
    });

    it('201 — acepta stock = 0 (sin stock inicial)', async () => {
      await post(app, '/products', adminToken)({
        ...validPayload(),
        stock: '0',
      }).expect(201);
    });

    // ── whitelist — campos extra rechazados ───────────────────────────────

    it('400 — campo extra rechazado (forbidNonWhitelisted)', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        campoHack: 'inyección',
      }).expect(400);

      expectMessage(res.body, 'should not exist');
    });

    it('400 — intento de inyectar createdById es rechazado', async () => {
      await post(app, '/products', adminToken)({
        ...validPayload(),
        createdById: 99,
      }).expect(400);
    });

    // ── price — debe ser número positivo ─────────────────────────────────

    it('400 — price negativo → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        price: -5,
      }).expect(400);

      expectMessage(res.body, 'price must be a positive number');
    });

    it('400 — price = 0 (no positivo)', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        price: 0,
      }).expect(400);

      expectMessage(res.body, 'price must be a positive number');
    });

    it('400 — price como string no numérico ("abc") → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        price: 'abc',
      }).expect(400);

      expectMessage(res.body, 'price must be a positive number');
    });

    it('400 — price ausente → "price is required"', async () => {
      const { price: _, ...noPrice } = validPayload();
      const res = await post(app, '/products', adminToken)(noPrice).expect(400);

      expectMessage(res.body, 'price is required');
    });

    // ── stock — debe ser entero >= 0 ──────────────────────────────────────

    it('400 — stock negativo → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        stock: -3,
      }).expect(400);

      expectMessage(res.body, 'stock must be an integer >= 0');
    });

    it('400 — stock decimal (1.5) → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        stock: 1.5,
      }).expect(400);

      expectMessage(res.body, 'stock must be an integer >= 0');
    });

    it('400 — stock ausente → "stock is required"', async () => {
      const { stock: _, ...noStock } = validPayload();
      const res = await post(app, '/products', adminToken)(noStock).expect(400);

      expectMessage(res.body, 'stock is required');
    });

    // ── categoryId — debe ser entero positivo ─────────────────────────────

    it('400 — categoryId = 0 → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        categoryId: 0,
      }).expect(400);

      expectMessage(res.body, 'categoryId must be a positive integer');
    });

    it('400 — categoryId negativo → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        categoryId: -1,
      }).expect(400);

      expectMessage(res.body, 'categoryId must be a positive integer');
    });

    it('400 — categoryId decimal (1.5) → mensaje exacto', async () => {
      const res = await post(app, '/products', adminToken)({
        ...validPayload(),
        categoryId: 1.5,
      }).expect(400);

      expectMessage(res.body, 'categoryId must be a positive integer');
    });

    it('400 — categoryId ausente → "categoryId is required"', async () => {
      const { categoryId: _, ...noCat } = validPayload();
      const res = await post(app, '/products', adminToken)(noCat).expect(400);

      expectMessage(res.body, 'categoryId is required');
    });
  });

  // ── POST /cart/add ────────────────────────────────────────────────────────

  describe('POST /cart/add — validación de campos numéricos', () => {
    let productId: number;

    beforeAll(async () => {
      const res = await post(app, '/products', adminToken)({
        name: 'Cart Test Product',
        price: 49.99,
        stock: 20,
        categoryId,
      });
      productId = res.body.id;
    });

    beforeEach(async () => {
      // Clear cart between tests so additions don't accumulate
      await prisma.cartItem.deleteMany();
    });

    const cartPayload = () => ({ productId, quantity: 2 });

    // ── coerción string → number ──────────────────────────────────────────

    it('200 — acepta productId y quantity como strings numéricos', async () => {
      const res = await post(app, '/cart/add', userToken)({
        productId: String(productId),
        quantity: '2',
      }).expect(200);

      // Cart item tiene productId y quantity como números
      const item = res.body.items?.find(
        (i: { productId: number }) => i.productId === productId,
      );
      expect(item).toBeDefined();
      expect(typeof item.productId).toBe('number');
      expect(typeof item.quantity).toBe('number');
    });

    it('200 — acepta quantity = 1 (mínimo positivo)', async () => {
      await post(app, '/cart/add', userToken)({
        productId: String(productId),
        quantity: '1',
      }).expect(200);
    });

    // ── whitelist ─────────────────────────────────────────────────────────

    it('400 — campo extra rechazado', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        descuento: 0.5,
      }).expect(400);

      expectMessage(res.body, 'should not exist');
    });

    // ── productId — debe ser entero positivo ──────────────────────────────

    it('400 — productId = 0 → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        productId: 0,
      }).expect(400);

      expectMessage(res.body, 'productId must be a positive integer');
    });

    it('400 — productId negativo → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        productId: -1,
      }).expect(400);

      expectMessage(res.body, 'productId must be a positive integer');
    });

    it('400 — productId decimal (2.5) → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        productId: 2.5,
      }).expect(400);

      expectMessage(res.body, 'productId must be a positive integer');
    });

    it('400 — productId ausente → "productId is required"', async () => {
      const res = await post(app, '/cart/add', userToken)({
        quantity: 2,
      }).expect(400);

      expectMessage(res.body, 'productId is required');
    });

    // ── quantity — debe ser entero positivo ───────────────────────────────

    it('400 — quantity = 0 → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        quantity: 0,
      }).expect(400);

      expectMessage(res.body, 'quantity must be a positive integer');
    });

    it('400 — quantity negativa → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        quantity: -3,
      }).expect(400);

      expectMessage(res.body, 'quantity must be a positive integer');
    });

    it('400 — quantity decimal (1.5) → mensaje exacto', async () => {
      const res = await post(app, '/cart/add', userToken)({
        ...cartPayload(),
        quantity: 1.5,
      }).expect(400);

      expectMessage(res.body, 'quantity must be a positive integer');
    });

    it('400 — quantity ausente → "quantity is required"', async () => {
      const res = await post(app, '/cart/add', userToken)({
        productId,
      }).expect(400);

      expectMessage(res.body, 'quantity is required');
    });
  });

  // ── POST /checkout ────────────────────────────────────────────────────────

  describe('POST /checkout', () => {
    let checkoutProductId: number;

    beforeAll(async () => {
      const res = await post(app, '/products', adminToken)({
        name: 'Checkout Product',
        price: 19.99,
        stock: 30,
        categoryId,
      });
      checkoutProductId = res.body.id;
    });

    beforeEach(async () => {
      await prisma.cartItem.deleteMany();
    });

    // ── whitelist ─────────────────────────────────────────────────────────

    it('400 — campo extra en body es rechazado (whitelist)', async () => {
      const res = await post(app, '/checkout', userToken)({
        couponCode: 'SAVE10',
        extraField: 'hack',
      }).expect(400);

      expectMessage(res.body, 'should not exist');
    });

    it('400 — múltiples campos extra son rechazados', async () => {
      await post(app, '/checkout', userToken)({
        price: 0,
        productId: 1,
      }).expect(400);
    });

    // ── checkout con carrito vacío ─────────────────────────────────────────
    //    La validación pasa (400 viene del servicio, no del pipe)

    it('4xx — body vacío: ValidationPipe pasa (CheckoutDto sin campos obligatorios)', async () => {
      const res = await post(app, '/checkout', userToken)({});
      // ValidationPipe allows empty body (all fields optional).
      // Service may return 400 (empty cart), but not a pipe validation error.
      expect(res.status).not.toBe(400);
      if (res.status === 400) {
        // If 400, it must NOT be a whitelist/type error
        const msgs = Array.isArray(res.body.message)
          ? res.body.message
          : [res.body.message];
        expect(msgs.every((m: string) => !m.includes('should not exist'))).toBe(true);
      }
    });

    // ── checkout completo con producto en carrito ──────────────────────────

    it('201 — checkout con producto en carrito y sin cupón', async () => {
      // Add product to cart
      await post(app, '/cart/add', userToken)({
        productId: checkoutProductId,
        quantity: 1,
      }).expect(200);

      const res = await post(app, '/checkout', userToken)({}).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('pending');
      expect(typeof res.body.total).toBe('number');
      expect(res.body.total).toBeCloseTo(19.99);
    });

    it('201 — checkout acepta couponCode como string válido', async () => {
      // Create a coupon
      await prisma.coupon.create({
        data: {
          code: 'TEST10',
          percentage: 10,
          expiresAt: new Date(Date.now() + 86_400_000),
          isActive: true,
        },
      });

      await post(app, '/cart/add', userToken)({
        productId: checkoutProductId,
        quantity: 2,
      }).expect(200);

      const res = await post(app, '/checkout', userToken)({
        couponCode: 'TEST10',
      }).expect(201);

      // 10% discount on 2 × 19.99 = 39.98 → total = 35.98
      expect(res.body.total).toBeCloseTo(35.98, 1);
    });
  });
});
