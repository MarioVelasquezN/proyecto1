/**
 * Flujo completo end-to-end:
 *   register → login → crear categoría → crear producto →
 *   consultar productos → validar roles → compra (decrease stock) →
 *   inventario actualizado → rotar refresh token → invalidar token viejo
 *
 * Los `it()` son secuenciales e interdependientes: cada uno construye sobre el estado
 * del anterior. Esto es intencional para probar el flujo real de usuario.
 */
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

describe('Flujo completo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // State que se va construyendo a lo largo del flujo
  let adminToken: string;
  let userToken: string;
  let userRefreshToken: string;
  let oldUserRefreshToken: string; // guardado antes de rotar, para el test de invalidación
  let categoryId: number;
  let productId: number;
  const INITIAL_STOCK = 50;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  // ── Paso 1: Admin ─────────────────────────────────────────────────────────

  it('Paso 1a — admin se registra como usuario normal', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'admin@store.com', password: 'Admin1234!', name: 'Store Admin' })
      .expect(201);

    expect(res.body.user.email).toBe('admin@store.com');
    expect(res.body.user.role).toBe(Role.User); // Empieza como user
  });

  it('Paso 1b — promueve cuenta a admin (operación interna)', async () => {
    await prisma.user.update({
      where: { email: 'admin@store.com' },
      data: { role: Role.Admin },
    });

    const user = await prisma.user.findUnique({ where: { email: 'admin@store.com' } });
    expect(user!.role).toBe(Role.Admin);
  });

  it('Paso 1c — admin hace login y obtiene token con rol admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@store.com', password: 'Admin1234!' })
      .expect(200);

    adminToken = res.body.accessToken;
    expect(adminToken).toBeTruthy();

    // Verifica que el JWT payload tiene role=admin
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(meRes.body.role).toBe(Role.Admin);
  });

  // ── Paso 2: Catálogo ──────────────────────────────────────────────────────

  it('Paso 2a — admin crea categoría "Electrónica"', async () => {
    const res = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Electrónica' })
      .expect(201);

    categoryId = res.body.id;
    expect(res.body.name).toBe('Electrónica');
  });

  it('Paso 2b — admin crea producto en esa categoría', async () => {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Laptop Pro X',
        description: 'High-performance laptop',
        price: 1499.99,
        stock: INITIAL_STOCK,
        categoryId,
      })
      .expect(201);

    productId = res.body.id;
    expect(res.body.stock).toBe(INITIAL_STOCK);
    expect(res.body.category.id).toBe(categoryId);
  });

  // ── Paso 3: Usuario normal ────────────────────────────────────────────────

  it('Paso 3a — usuario normal se registra', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'buyer@example.com', password: 'Buyer1234!', name: 'Buyer' })
      .expect(201);

    expect(res.body.user.role).toBe(Role.User);
  });

  it('Paso 3b — usuario normal hace login', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'buyer@example.com', password: 'Buyer1234!' })
      .expect(200);

    userToken = res.body.accessToken;
    userRefreshToken = res.body.refreshToken;
    expect(userToken).toBeTruthy();
    expect(userRefreshToken).toBeTruthy();
  });

  // ── Paso 4: Consultas ─────────────────────────────────────────────────────

  it('Paso 4a — usuario normal puede ver categorías', async () => {
    const res = await request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.some((c: { name: string }) => c.name === 'Electrónica')).toBe(true);
  });

  it('Paso 4b — usuario normal puede listar productos', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const laptop = res.body.data.find((p: { name: string }) => p.name === 'Laptop Pro X');
    expect(laptop).toBeDefined();
    expect(laptop.stock).toBe(INITIAL_STOCK);
    expect(laptop.price).toBe(1499.99);
  });

  // ── Paso 5: Validación de roles ───────────────────────────────────────────

  it('Paso 5a — usuario normal NO puede crear categorías → 403', async () => {
    await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Forbidden' })
      .expect(403);
  });

  it('Paso 5b — usuario normal NO puede crear productos → 403', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Hack', price: 1, stock: 1, categoryId })
      .expect(403);
  });

  it('Paso 5c — endpoints protegidos rechazan petición sin token → 401', async () => {
    await Promise.all([
      request(app.getHttpServer()).get('/products').expect(401),
      request(app.getHttpServer()).get('/categories').expect(401),
      request(app.getHttpServer()).get('/inventory/status').expect(401),
    ]);
  });

  // ── Paso 6: Compra (disminución de stock) ─────────────────────────────────

  it('Paso 6a — usuario realiza compra de 3 unidades', async () => {
    const res = await request(app.getHttpServer())
      .post('/inventory/decrease')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 3 })
      .expect(200);

    expect(res.body.stock).toBe(INITIAL_STOCK - 3);
  });

  it('Paso 6b — inventario refleja el stock actualizado', async () => {
    const res = await request(app.getHttpServer())
      .get('/inventory/status')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const laptop = res.body.find((p: { name: string }) => p.name === 'Laptop Pro X');
    expect(laptop.stock).toBe(INITIAL_STOCK - 3);
  });

  it('Paso 6c — no se puede comprar más de lo disponible', async () => {
    await request(app.getHttpServer())
      .post('/inventory/decrease')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 99999 })
      .expect(409);
  });

  // ── Paso 7: Rotación de refresh token ─────────────────────────────────────

  it('Paso 7a — usuario rota su refresh token', async () => {
    oldUserRefreshToken = userRefreshToken; // guardar antes de rotar

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: userRefreshToken })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.refreshToken).not.toBe(oldUserRefreshToken);

    userToken = res.body.accessToken;
    userRefreshToken = res.body.refreshToken;
  });

  it('Paso 7b — token viejo deja de funcionar tras rotar', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: oldUserRefreshToken })
      .expect(401);
  });

  it('Paso 7c — nuevo access token sigue dando acceso a recursos protegidos', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
  });
});
