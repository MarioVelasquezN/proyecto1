import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

const INITIAL_STOCK = 20;

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userToken: string;
  let productId: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);

    // Regular user for auth
    const userRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Password1!', name: 'User' });
    userToken = userRes.body.accessToken;

    // Admin to create fixtures
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'admin@example.com', password: 'Password1!', name: 'Admin' });
    await prisma.user.update({
      where: { email: 'admin@example.com' },
      data: { role: Role.Admin },
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'Password1!' });
    const adminToken = adminLoginRes.body.accessToken;

    // Category + product
    const catRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Gadgets' });
    const categoryId = catRes.body.id;

    const prodRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Widget', price: 49.99, stock: INITIAL_STOCK, categoryId });
    productId = prodRes.body.id;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    // Reset stock before each test for full isolation
    await prisma.product.update({
      where: { id: productId },
      data: { stock: INITIAL_STOCK },
    });
  });

  // ── GET /inventory/status ─────────────────────────────────────────────────

  describe('GET /inventory/status', () => {
    it('200 — retorna array con stock de todos los productos', async () => {
      const res = await request(app.getHttpServer())
        .get('/inventory/status')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const widget = res.body.find((p: { name: string }) => p.name === 'Widget');
      expect(widget).toBeDefined();
      expect(widget.stock).toBe(INITIAL_STOCK);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer()).get('/inventory/status').expect(401);
    });
  });

  // ── POST /inventory/decrease ──────────────────────────────────────────────

  describe('POST /inventory/decrease', () => {
    it('200 — disminuye el stock correctamente', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 3 })
        .expect(200);

      expect(res.body.stock).toBe(INITIAL_STOCK - 3);
    });

    it('stock en BD refleja el decremento', async () => {
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 5 });

      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.stock).toBe(INITIAL_STOCK - 5);
    });

    it('200 — agota el stock exacto (cantidad = stock disponible)', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: INITIAL_STOCK })
        .expect(200);

      expect(res.body.stock).toBe(0);
    });

    it('409 — stock insuficiente', async () => {
      const res = await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: INITIAL_STOCK + 1 })
        .expect(409);

      expect(res.body.message).toMatch(/insufficient|stock/i);
    });

    it('409 — no permite que el stock sea negativo', async () => {
      // Exhaust all stock
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: INITIAL_STOCK });

      // Try to decrease again → conflict
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 1 })
        .expect(409);

      // Verify stock is still 0, not negative
      const product = await prisma.product.findUnique({ where: { id: productId } });
      expect(product!.stock).toBe(0);
    });

    it('404 — producto inexistente', async () => {
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: 99999, quantity: 1 })
        .expect(404);
    });

    it('400 — quantity debe ser positivo', async () => {
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: 0 })
        .expect(400);
    });

    it('400 — quantity negativo rechazado', async () => {
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId, quantity: -5 })
        .expect(400);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer())
        .post('/inventory/decrease')
        .send({ productId, quantity: 1 })
        .expect(401);
    });
  });
});
