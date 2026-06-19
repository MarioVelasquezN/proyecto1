import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Role } from '../src/auth/enums/role.enum';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-cleaner';

const BASE_USER = {
  email: 'alice@example.com',
  password: 'Password1!',
  name: 'Alice',
};

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // ── POST /auth/register ───────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('201 — crea usuario y retorna access token, refresh token y user sin password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(BASE_USER)
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.user).toMatchObject({ email: BASE_USER.email, name: BASE_USER.name });
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('409 — email duplicado', async () => {
      await request(app.getHttpServer()).post('/auth/register').send(BASE_USER);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(BASE_USER)
        .expect(409);

      expect(res.body.message).toMatch(/email/i);
    });

    it('400 — email inválido', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...BASE_USER, email: 'not-an-email' })
        .expect(400);
    });

    it('400 — password demasiado corta (< 8 chars)', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...BASE_USER, password: 'short' })
        .expect(400);
    });

    it('400 — campo name ausente', async () => {
      const { name: _, ...noName } = BASE_USER;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(noName)
        .expect(400);
    });

    it('400 — campo extra rechazado (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...BASE_USER, role: 'admin' })
        .expect(400);
    });
  });

  // ── POST /auth/login ──────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer()).post('/auth/register').send(BASE_USER);
    });

    it('200 — retorna accessToken y refreshToken con credenciales correctas', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: BASE_USER.email, password: BASE_USER.password })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).not.toHaveProperty('password');
    });

    it('401 — contraseña incorrecta', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: BASE_USER.email, password: 'WrongPass!' })
        .expect(401);
    });

    it('401 — usuario inexistente', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: BASE_USER.password })
        .expect(401);
    });

    it('previene enumeración de usuarios — mismo mensaje para contraseña incorrecta y usuario inexistente', async () => {
      const [wrongPass, noUser] = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: BASE_USER.email, password: 'wrong' }),
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'ghost@example.com', password: 'any' }),
      ]);

      expect(wrongPass.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(wrongPass.body.message).toBe(noUser.body.message);
    });
  });

  // ── GET /auth/me ──────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(BASE_USER);
      accessToken = res.body.accessToken;
    });

    it('200 — retorna payload JWT con token válido', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ email: BASE_USER.email, role: Role.User });
      expect(res.body).toHaveProperty('sub');
    });

    it('401 — sin header Authorization', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('401 — token malformado', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer this.is.not.valid')
        .expect(401);
    });
  });

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    let firstRefreshToken: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(BASE_USER);
      firstRefreshToken = res.body.refreshToken;
    });

    it('200 — retorna nuevos accessToken y refreshToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(typeof res.body.accessToken).toBe('string');
    });

    it('el nuevo refreshToken difiere del anterior (rotación real)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);

      expect(res.body.refreshToken).not.toBe(firstRefreshToken);
    });

    it('401 — token viejo deja de funcionar tras rotar', async () => {
      // Rotate: first token gets stamped usedAt
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);

      // Reuse → 401
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);
    });

    it('detectar reuso revoca TODAS las sesiones del usuario', async () => {
      // Second session (login creates a fresh token independent of firstRefreshToken)
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: BASE_USER.email, password: BASE_USER.password });
      const secondRefreshToken = loginRes.body.refreshToken;

      // Rotate firstRefreshToken once (valid)
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken });

      // Reuse firstRefreshToken → triggers full revocation
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);

      // secondRefreshToken must also be dead (all sessions revoked)
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: secondRefreshToken })
        .expect(401);
    });

    it('401 — token completamente inválido', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
    });

    it('400 — body vacío (campo requerido ausente)', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({})
        .expect(400);
    });
  });
});
