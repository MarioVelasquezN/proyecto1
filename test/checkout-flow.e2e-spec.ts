/**
 * Flujo end-to-end completo de checkout:
 *   register → login → catálogo → búsqueda avanzada →
 *   carrito (add / get / update / remove) →
 *   checkout → orden creada, carrito vacío, stock reducido →
 *   checkout con cupón → descuento aplicado →
 *   validación de errores (401, 404, 409, 422, 400)
 *
 * Los `it()` son secuenciales e interdependientes dentro de cada sección.
 * Cada sección construye sobre el estado de la anterior. Esto es intencional
 * para probar el flujo real de usuario en condiciones de producción.
 */
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

// ── constantes del flujo ──────────────────────────────────────────────────────

const ADMIN = { email: 'checkout-admin@store.com', password: 'Admin1234!', name: 'Store Admin' };
const USER  = { email: 'checkout-buyer@store.com', password: 'Buyer1234!', name: 'Buyer' };

const PRODUCT_NAME = 'Tablet Galaxy Pro';
const PRICE        = 29.99;
const STOCK        = 15;
const QTY          = 3;
const SUBTOTAL     = parseFloat((PRICE * QTY).toFixed(2)); // 89.97

const COUPON_CODE  = 'SAVE25';
const COUPON_PCT   = 25;
const COUPON_QTY   = 2;
const COUPON_SUBTOTAL = parseFloat((PRICE * COUPON_QTY).toFixed(2)); // 59.98
// 59.98 × (1 − 0.25) = 44.985 → round → 44.99
const COUPON_TOTAL = parseFloat(
  (Math.round(COUPON_SUBTOTAL * (1 - COUPON_PCT / 100) * 100) / 100).toFixed(2),
);

// ── suite ─────────────────────────────────────────────────────────────────────

describe('Checkout Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminToken: string;
  let userToken: string;
  let categoryId: number;
  let productId: number;
  let orderId: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanDatabase(app);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  // ── Paso 1: Usuarios ──────────────────────────────────────────────────────

  it('Paso 1a — admin se registra como usuario normal', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(ADMIN)
      .expect(201);

    expect(res.body.user.role).toBe(Role.User);
  });

  it('Paso 1b — admin es promovido a rol admin (operación interna)', async () => {
    await prisma.user.update({
      where: { email: ADMIN.email },
      data: { role: Role.Admin },
    });
    const user = await prisma.user.findUnique({ where: { email: ADMIN.email } });
    expect(user!.role).toBe(Role.Admin);
  });

  it('Paso 1c — admin hace login y obtiene token con rol admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password })
      .expect(200);

    adminToken = res.body.accessToken;
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(me.body.role).toBe(Role.Admin);
  });

  it('Paso 1d — usuario comprador se registra', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(USER)
      .expect(201);

    expect(res.body.user.role).toBe(Role.User);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('Paso 1e — usuario comprador hace login', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: USER.email, password: USER.password })
      .expect(200);

    userToken = res.body.accessToken;
    expect(userToken).toBeTruthy();
  });

  // ── Paso 2: Catálogo ──────────────────────────────────────────────────────

  it('Paso 2a — admin crea categoría "Tablets"', async () => {
    const res = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Tablets' })
      .expect(201);

    categoryId = res.body.id;
    expect(res.body.name).toBe('Tablets');
  });

  it('Paso 2b — admin crea producto con stock y precio definidos', async () => {
    const res = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: PRODUCT_NAME,
        description: 'A fast Android tablet',
        price: PRICE,
        stock: STOCK,
        categoryId,
      })
      .expect(201);

    productId = res.body.id;
    expect(res.body.stock).toBe(STOCK);
    expect(res.body.price).toBe(PRICE);
    expect(res.body.category.id).toBe(categoryId);
  });

  // ── Paso 3: Búsqueda avanzada en productos ────────────────────────────────

  it('Paso 3a — GET /products retorna { data, meta } con paginación', async () => {
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
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('Paso 3b — búsqueda por nombre devuelve resultados correctos', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: 'Tablet' })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      res.body.data.every((p: { name: string }) => p.name.includes('Tablet')),
    ).toBe(true);
  });

  it('Paso 3c — filtro por categoryId devuelve solo productos de esa categoría', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ categoryId })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      res.body.data.every(
        (p: { category: { id: number } }) => p.category.id === categoryId,
      ),
    ).toBe(true);
  });

  it('Paso 3d — search + categoryId combinados filtran correctamente', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ search: 'Tablet', categoryId })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const found = res.body.data.find(
      (p: { name: string }) => p.name === PRODUCT_NAME,
    );
    expect(found).toBeDefined();
  });

  it('Paso 3e — sortBy=price&sortOrder=asc ordena de menor a mayor precio', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ sortBy: 'price', sortOrder: 'asc' })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const prices = res.body.data.map((p: { price: number }) => p.price);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  it('Paso 3f — paginación: page=1&limit=1 retorna exactamente 1 item', async () => {
    const res = await request(app.getHttpServer())
      .get('/products')
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.limit).toBe(1);
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });

  // ── Paso 4: Carrito ───────────────────────────────────────────────────────

  it('Paso 4a — POST /cart/add añade producto al carrito', async () => {
    const res = await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: QTY })
      .expect(201);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].productId).toBe(productId);
    expect(res.body.items[0].quantity).toBe(QTY);
  });

  it('Paso 4b — GET /cart devuelve items y total calculado', async () => {
    const res = await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBeCloseTo(SUBTOTAL, 2);
    expect(res.body.items[0].product).toMatchObject({ id: productId, name: PRODUCT_NAME });
  });

  it('Paso 4c — POST /cart/add mismo producto reemplaza la cantidad (SET, no acumula)', async () => {
    const newQty = 10;
    const res = await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: newQty })
      .expect(201);

    expect(res.body.items[0].quantity).toBe(newQty); // SET: 10, no 3+10=13
  });

  it('Paso 4d — DELETE /cart/remove elimina el item del carrito', async () => {
    const res = await request(app.getHttpServer())
      .delete('/cart/remove')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId })
      .expect(200);

    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('Paso 4e — re-añadir producto al carrito para el checkout', async () => {
    const res = await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: QTY })
      .expect(201);

    expect(res.body.items[0].quantity).toBe(QTY);
  });

  // ── Paso 5: Checkout (flujo completo exitoso) ─────────────────────────────

  it('Paso 5a — POST /checkout convierte el carrito en una orden', async () => {
    const res = await request(app.getHttpServer())
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(201);

    orderId = res.body.id;
    expect(orderId).toBeDefined();
    expect(res.body.userId).toBeDefined();
    expect(res.body.coupon).toBeNull();
  });

  it('Paso 5b — la orden tiene total correcto (QTY × PRICE)', async () => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.total).toBeCloseTo(SUBTOTAL, 2);
  });

  it('Paso 5c — la orden tiene status pending', async () => {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('pending');
  });

  it('Paso 5d — la orden contiene los items con precio snapshot', async () => {
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe(productId);
    expect(items[0].quantity).toBe(QTY);
    expect(items[0].price).toBeCloseTo(PRICE, 2);
  });

  it('Paso 5e — GET /cart queda vacío después del checkout', async () => {
    const res = await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('Paso 5f — stock del producto se redujo en QTY', async () => {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(STOCK - QTY); // 15 - 3 = 12
  });

  // ── Paso 6: Checkout con cupón ────────────────────────────────────────────

  it('Paso 6a — admin crea cupón de descuento activo', async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app.getHttpServer())
      .post('/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: COUPON_CODE, percentage: COUPON_PCT, expiresAt: futureDate })
      .expect(201);

    expect(res.body.code).toBe(COUPON_CODE);
    expect(res.body.percentage).toBe(COUPON_PCT);
    expect(res.body.isActive).toBe(true);
  });

  it('Paso 6b — usuario añade producto al carrito para checkout con cupón', async () => {
    const res = await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: COUPON_QTY })
      .expect(201);

    expect(res.body.items[0].quantity).toBe(COUPON_QTY);
    expect(res.body.total).toBeCloseTo(COUPON_SUBTOTAL, 2);
  });

  it('Paso 6c — POST /checkout con cupón aplica el descuento al total', async () => {
    const res = await request(app.getHttpServer())
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ couponCode: COUPON_CODE })
      .expect(201);

    expect(res.body.total).toBeCloseTo(COUPON_TOTAL, 2);
    expect(res.body.total).toBeLessThan(COUPON_SUBTOTAL);
  });

  it('Paso 6d — la respuesta del checkout incluye los datos del cupón aplicado', async () => {
    // Most recent order for this user
    const order = await prisma.order.findFirst({
      where: { id: { gt: orderId } },
      include: { coupon: true },
    });

    expect(order!.coupon).toBeDefined();
    expect(order!.coupon!.code).toBe(COUPON_CODE);
    expect(order!.coupon!.percentage).toBe(COUPON_PCT);
  });

  it('Paso 6e — stock se redujo en COUPON_QTY unidades adicionales', async () => {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(STOCK - QTY - COUPON_QTY); // 15 - 3 - 2 = 10
  });

  it('Paso 6f — GET /cart vacío después del checkout con cupón', async () => {
    const res = await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(0);
  });

  // ── Validación de errores ─────────────────────────────────────────────────
  // Stock actual tras los checkouts anteriores: 15 - 3 - 2 = 10

  it('Error 1 — POST /checkout con carrito vacío → 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(422);

    expect(res.body.message).toMatch(/empty/i);
  });

  it('Error 2 — POST /cart/add con producto inexistente → 404', async () => {
    await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId: 99999, quantity: 1 })
      .expect(404);
  });

  it('Error 3 — POST /checkout con cupón expirado → 422', async () => {
    // Añadir item al carrito (actualmente vacío)
    await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 1 });

    // Admin crea cupón ya expirado
    const pastDate = new Date(Date.now() - 1000).toISOString();
    await request(app.getHttpServer())
      .post('/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'OLDCOUPON', percentage: 10, expiresAt: pastDate });

    const res = await request(app.getHttpServer())
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ couponCode: 'OLDCOUPON' })
      .expect(422);

    expect(res.body.message).toMatch(/expired/i);
  });

  it('Error 4 — POST /checkout con stock insuficiente → 409', async () => {
    // Actualizar cantidad en carrito a más de lo disponible (SET semántico)
    // El carrito tiene qty=1 del error 3 (checkout falló, no se vació)
    await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 9999 }); // SET: reemplaza qty a 9999

    const res = await request(app.getHttpServer())
      .post('/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(409);

    expect(res.body.message).toMatch(/stock/i);

    // El carrito NO se vacía si el checkout falla
    const cart = await request(app.getHttpServer())
      .get('/cart')
      .set('Authorization', `Bearer ${userToken}`);
    expect(cart.body.items).toHaveLength(1);
  });

  it('Error 5 — GET /cart sin autenticación → 401', async () => {
    await request(app.getHttpServer()).get('/cart').expect(401);
  });

  it('Error 6 — POST /checkout sin autenticación → 401', async () => {
    await request(app.getHttpServer())
      .post('/checkout')
      .send({})
      .expect(401);
  });

  it('Error 7 — POST /cart/add sin autenticación → 401', async () => {
    await request(app.getHttpServer())
      .post('/cart/add')
      .send({ productId, quantity: 1 })
      .expect(401);
  });

  it('Error 8 — GET /products con sortBy inválido → 400', async () => {
    await request(app.getHttpServer())
      .get('/products')
      .query({ sortBy: 'invalid_field' })
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);
  });

  it('Error 9 — POST /cart/add con quantity=0 → 400', async () => {
    await request(app.getHttpServer())
      .post('/cart/add')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 0 })
      .expect(400);
  });

  it('Error 10 — usuario normal no puede crear cupones → 403', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    await request(app.getHttpServer())
      .post('/coupons')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ code: 'HACK50', percentage: 50, expiresAt: futureDate })
      .expect(403);
  });
});
