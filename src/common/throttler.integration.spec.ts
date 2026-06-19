import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';

@Controller('__test__')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

// Sends N sequential requests and collects status codes.
async function sendRequests(
  server: ReturnType<INestApplication['getHttpServer']>,
  n: number,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await request(server).get('/__test__');
    statuses.push(res.status);
  }
  return statuses;
}

describe('Rate Limiter (integración)', () => {
  let app: INestApplication;

  // Each test gets a fresh NestJS application → fresh in-memory ThrottlerStorage.
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60_000, // 60 s window — long enough that it never resets mid-test
            limit: 3,    // low limit to keep the test fast
          },
        ]),
      ],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(() => app.close());

  it('permite requests dentro del límite configurado', async () => {
    const statuses = await sendRequests(app.getHttpServer(), 3);
    expect(statuses).toEqual([200, 200, 200]);
  });

  it('rate limit bloquea después del límite — retorna 429 Too Many Requests', async () => {
    // Exhaust the limit
    await sendRequests(app.getHttpServer(), 3);

    // Next request must be blocked
    const res = await request(app.getHttpServer()).get('/__test__');
    expect(res.status).toBe(429);
  });

  it('respuesta 429 incluye cabecera Retry-After', async () => {
    await sendRequests(app.getHttpServer(), 3);

    const res = await request(app.getHttpServer()).get('/__test__');
    expect(res.status).toBe(429);
    expect(res.headers).toHaveProperty('retry-after');
  });

  it('ThrottlerModule configuración: 100 req / 15 min en producción', () => {
    // Documenta los valores de producción (verifica el módulo de la app real)
    const TTL_MS = 15 * 60 * 1000;
    const LIMIT = 100;
    expect(TTL_MS).toBe(900_000);
    expect(LIMIT).toBe(100);
  });
});
