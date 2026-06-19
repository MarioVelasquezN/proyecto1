import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

describe('Products & Categories (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let categoryId: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);

    // Create regular user (bcrypt runs once here, not per test)
    const userRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Password1!', name: 'Regular User' });
    userToken = userRes.body.accessToken;

    // Create admin: register first, then promote role, then re-login to get admin JWT
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'admin@example.com', password: 'Password1!', name: 'Admin User' });
    await prisma.user.update({
      where: { email: 'admin@example.com' },
      data: { role: Role.Admin },
    });
    const adminLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'Password1!' });
    adminToken = adminLoginRes.body.accessToken;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    // Reset only products and categories between tests (users are expensive to recreate)
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();

    // Recreate the base category every test so tests start clean
    const catRes = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Electronics' });
    categoryId = catRes.body.id;
  });

  // ── GET /categories ───────────────────────────────────────────────────────

  describe('GET /categories', () => {
    it('200 — retorna lista de categorías', async () => {
      const res = await request(app.getHttpServer())
        .get('/categories')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer()).get('/categories').expect(401);
    });
  });

  // ── POST /categories ──────────────────────────────────────────────────────

  describe('POST /categories', () => {
    it('201 — admin crea categoría', async () => {
      const res = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Books' })
        .expect(201);

      expect(res.body).toMatchObject({ name: 'Books' });
      expect(res.body).toHaveProperty('id');
    });

    it('403 — usuario normal no puede crear categoría', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Forbidden Cat' })
        .expect(403);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .send({ name: 'Unauth Cat' })
        .expect(401);
    });

    it('400 — nombre vacío', async () => {
      await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' })
        .expect(400);
    });
  });

  // ── GET /products ─────────────────────────────────────────────────────────

  describe('GET /products', () => {
    it('200 — retorna { data, meta } paginado', async () => {
      const res = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it('200 — data incluye producto creado por admin', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Laptop', price: 999.99, stock: 5, categoryId });

      const res = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.data.some((p: { name: string }) => p.name === 'Laptop')).toBe(true);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer()).get('/products').expect(401);
    });
  });

  // ── POST /products ────────────────────────────────────────────────────────

  describe('POST /products', () => {
    const payload = () => ({
      name: 'Test Laptop',
      description: 'A powerful machine',
      price: 1299.99,
      stock: 15,
      categoryId,
    });

    it('201 — admin crea producto con todos los campos', async () => {
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload())
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Test Laptop',
        price: 1299.99,
        stock: 15,
      });
      expect(res.body).toHaveProperty('id');
      expect(res.body.category).toMatchObject({ id: categoryId, name: 'Electronics' });
    });

    it('201 — admin crea producto sin description (opcional)', async () => {
      const { description: _, ...noDesc } = payload();
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noDesc)
        .expect(201);

      expect(res.body.description).toBeNull();
    });

    it('403 — usuario normal no puede crear producto', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${userToken}`)
        .send(payload())
        .expect(403);
    });

    it('401 — sin autenticación', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .send(payload())
        .expect(401);
    });

    it('400 — categoryId inexistente', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload(), categoryId: 99999 })
        .expect(400);
    });

    it('400 — precio negativo', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload(), price: -1 })
        .expect(400);
    });

    it('400 — stock negativo', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...payload(), stock: -5 })
        .expect(400);
    });

    it('400 — nombre ausente', async () => {
      const { name: _, ...noName } = payload();
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(noName)
        .expect(400);
    });
  });
});
