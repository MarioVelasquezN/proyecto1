/**
 * Tests de concurrencia: protección de stock contra overselling.
 *
 * El mecanismo que evita stock negativo es el guard atómico en checkout.service.ts:
 *
 *   UPDATE product SET stock = stock - qty
 *   WHERE id = ? AND stock >= qty   ← condición atómica en InnoDB
 *
 * Si la condición no se cumple, `count === 0` y la transacción aborta con 409.
 * MySQL serializa los writes a la misma fila, así que es imposible que dos
 * transacciones decrementanten el stock por debajo de cero simultáneamente.
 *
 * Promise.all con supertest inicia N peticiones HTTP en vuelo al mismo tiempo.
 * El event loop de Node.js las procesa de forma concurrente vía I/O async,
 * lo que genera competencia real entre transacciones en el servidor MySQL.
 */
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

// ── helpers ───────────────────────────────────────────────────────────────────

const ADMIN = {
  email: 'concurrency-admin@store.com',
  password: 'Admin1234!',
  name: 'Admin',
};

/** Registra un usuario y devuelve su access token. */
async function registerBuyer(
  app: INestApplication,
  index: number,
  prefix = 'buyer',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      email: `${prefix}${index}@concurrency-test.com`,
      password: 'Test1234!',
      name: `${prefix} ${index}`,
    });
  return res.body.accessToken;
}

/** Añade un producto al carrito de un usuario. */
async function addToCart(
  app: INestApplication,
  token: string,
  productId: number,
  quantity: number,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/cart/add')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('Concurrencia: protección de stock (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);

    // Admin
    await request(app.getHttpServer()).post('/auth/register').send(ADMIN);
    await prisma.user.update({
      where: { email: ADMIN.email },
      data: { role: Role.Admin },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });
    adminToken = loginRes.body.accessToken;

    // Categoría compartida entre escenarios
    const catRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Concurrency Tests' });
    categoryId = catRes.body.id;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  // ── Escenario 1: 1 unidad por compra, demanda 2× la oferta ────────────────

  describe('Escenario 1 — demand 2× supply: 1 unidad por compra', () => {
    const STOCK = 5;
    const N_BUYERS = 10;
    const QTY_EACH = 1;

    let productId: number;
    let buyerTokens: string[];

    beforeAll(async () => {
      // Producto con stock limitado
      const prodRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Limited Edition Sneakers',
          price: 199.99,
          stock: STOCK,
          categoryId,
        });
      productId = prodRes.body.id;

      // Crear compradores y llenar sus carritos secuencialmente
      // (bcrypt es CPU-bound; la secuencia evita saturar el thread pool)
      buyerTokens = [];
      for (let i = 0; i < N_BUYERS; i++) {
        const token = await registerBuyer(app, i, 'sneaker-buyer');
        await addToCart(app, token, productId, QTY_EACH);
        buyerTokens.push(token);
      }
    });

    it('no hay overselling: exactamente STOCK órdenes exitosas', async () => {
      const results = await Promise.all(
        buyerTokens.map((token) =>
          request(app.getHttpServer())
            .post('/checkout')
            .set('Authorization', `Bearer ${token}`)
            .send({}),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      // Exactamente STOCK compras pueden materializarse
      expect(successes.length).toBe(STOCK);

      // El resto falla con 409 Conflict — nunca con 200 o 500
      expect(conflicts.length).toBe(N_BUYERS - STOCK);

      // No debe haber ningún código inesperado
      const unexpected = results.filter(
        (r) => r.status !== 201 && r.status !== 409,
      );
      expect(unexpected).toHaveLength(0);
    });

    it('stock final es exactamente 0 — nunca fue negativo', async () => {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      expect(product!.stock).toBe(0);
      expect(product!.stock).toBeGreaterThanOrEqual(0);
    });

    it('las órdenes en BD coinciden con las unidades consumidas', async () => {
      const orders = await prisma.order.findMany({
        where: { items: { some: { productId } } },
        include: { items: true },
      });

      // Número de órdenes == stock consumido
      expect(orders.length).toBe(STOCK);

      // Suma de unidades en órdenes == stock inicial
      const totalUnits = orders.reduce(
        (sum, o) =>
          sum + o.items.reduce((s, item) => s + item.quantity, 0),
        0,
      );
      expect(totalUnits).toBe(STOCK * QTY_EACH);
    });
  });

  // ── Escenario 2: múltiples unidades por compra ────────────────────────────

  describe('Escenario 2 — qty > 1: 3 unidades por compra, stock no divisible exacto', () => {
    const STOCK = 9;
    const QTY_EACH = 3;
    const N_BUYERS = 5;
    // floor(9 / 3) = 3 órdenes exitosas; stock restante = 0
    const EXPECTED_SUCCESSES = Math.floor(STOCK / QTY_EACH);

    let productId: number;
    let buyerTokens: string[];

    beforeAll(async () => {
      const prodRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Bundle Pack (qty=3)',
          price: 49.99,
          stock: STOCK,
          categoryId,
        });
      productId = prodRes.body.id;

      buyerTokens = [];
      for (let i = 0; i < N_BUYERS; i++) {
        const token = await registerBuyer(app, i, 'bundle-buyer');
        await addToCart(app, token, productId, QTY_EACH);
        buyerTokens.push(token);
      }
    });

    it('no hay overselling con compras de múltiples unidades', async () => {
      const results = await Promise.all(
        buyerTokens.map((token) =>
          request(app.getHttpServer())
            .post('/checkout')
            .set('Authorization', `Bearer ${token}`)
            .send({}),
        ),
      );

      const successes = results.filter((r) => r.status === 201).length;
      const conflicts = results.filter((r) => r.status === 409).length;

      expect(successes).toBe(EXPECTED_SUCCESSES); // 3
      expect(conflicts).toBe(N_BUYERS - EXPECTED_SUCCESSES); // 2
    });

    it('stock restante nunca es negativo', async () => {
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      const expectedRemaining = STOCK - EXPECTED_SUCCESSES * QTY_EACH; // 9 - 9 = 0
      expect(product!.stock).toBe(expectedRemaining);
      expect(product!.stock).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Escenario 3: stock exacto agotado (edge case) ─────────────────────────

  describe('Escenario 3 — stock exacto: demanda == supply', () => {
    const STOCK = 4;
    const N_BUYERS = 4; // Exactamente igual al stock
    const QTY_EACH = 1;

    let productId: number;
    let buyerTokens: string[];

    beforeAll(async () => {
      const prodRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Exact Match Item',
          price: 29.99,
          stock: STOCK,
          categoryId,
        });
      productId = prodRes.body.id;

      buyerTokens = [];
      for (let i = 0; i < N_BUYERS; i++) {
        const token = await registerBuyer(app, i, 'exact-buyer');
        await addToCart(app, token, productId, QTY_EACH);
        buyerTokens.push(token);
      }
    });

    it('cuando demand == supply: todos los compradores tienen éxito y stock = 0', async () => {
      const results = await Promise.all(
        buyerTokens.map((token) =>
          request(app.getHttpServer())
            .post('/checkout')
            .set('Authorization', `Bearer ${token}`)
            .send({}),
        ),
      );

      const successes = results.filter((r) => r.status === 201).length;
      const conflicts = results.filter((r) => r.status === 409).length;

      expect(successes).toBe(STOCK); // todos tienen éxito
      expect(conflicts).toBe(0); // nadie es rechazado

      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      expect(product!.stock).toBe(0);
    });
  });
});
