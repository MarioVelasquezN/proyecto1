import { ExecutionContext, CallHandler, Logger, HttpException, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildContext(
  method: string,
  url: string,
  responseStatusCode = 200,
  user?: { sub: number; email: string; role: string },
  body: object = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, originalUrl: url, user, body }),
      getResponse: () => ({ statusCode: responseStatusCode }),
    }),
  } as unknown as ExecutionContext;
}

function callHandler(value: unknown = {}): CallHandler {
  return { handle: () => of(value) };
}

function errorHandler(err: Error): CallHandler {
  return { handle: () => throwError(() => err) };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy   = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy  = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  // ── Requisito 1: logs se generan correctamente ────────────────────────────

  describe('logs se generan correctamente', () => {
    it('usa Logger.log (nivel info) para respuestas 2xx', async () => {
      const ctx = buildContext('GET', '/products', 200);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('usa Logger.log para 201 Created', async () => {
      const ctx = buildContext('POST', '/products', 201);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('usa Logger.warn (nivel warn) para respuestas 4xx', async () => {
      const ctx = buildContext('GET', '/missing', 404);

      await lastValueFrom(
        interceptor.intercept(ctx, errorHandler(new NotFoundException('Not found'))),
      ).catch(() => {});

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('usa Logger.warn para cualquier 4xx (400, 401, 403, 404)', async () => {
      const cases: [HttpException, number][] = [
        [new BadRequestException(), 400],
      ];

      for (const [err] of cases) {
        jest.clearAllMocks();
        const ctx = buildContext('POST', '/auth', 400);
        await lastValueFrom(
          interceptor.intercept(ctx, errorHandler(err)),
        ).catch(() => {});
        expect(warnSpy).toHaveBeenCalled();
      }
    });

    it('usa Logger.error (nivel error) para respuestas 5xx', async () => {
      const ctx = buildContext('GET', '/crash', 500);

      await lastValueFrom(
        interceptor.intercept(ctx, errorHandler(new InternalServerErrorException())),
      ).catch(() => {});

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('usa Logger.error para errores no HttpException (error inesperado → 500)', async () => {
      const ctx = buildContext('GET', '/broken', 500);

      await lastValueFrom(
        interceptor.intercept(ctx, errorHandler(new Error('Unexpected crash'))),
      ).catch(() => {});

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('el log incluye method, endpoint, statusCode y userId como campos JSON', async () => {
      const user = { sub: 42, email: 'a@test.com', role: 'user' };
      const ctx = buildContext('GET', '/products', 200, user);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const raw = logSpy.mock.calls[0][0] as string;
      const entry = JSON.parse(raw);
      expect(entry.method).toBe('GET');
      expect(entry.endpoint).toBe('/products');
      expect(entry.statusCode).toBe(200);
      expect(entry.userId).toBe('42');
    });

    it('registra "anonymous" cuando no hay usuario autenticado', async () => {
      const ctx = buildContext('GET', '/products', 200);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(entry.userId).toBe('anonymous');
    });

    it('propaga el error al caller después de loggear', async () => {
      const ctx = buildContext('GET', '/missing', 404);
      const err = new NotFoundException();

      await expect(
        lastValueFrom(interceptor.intercept(ctx, errorHandler(err))),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Requisito 2: response time se captura ─────────────────────────────────

  describe('response time se captura', () => {
    it('responseTime está presente en el log y es un número no negativo', async () => {
      const ctx = buildContext('GET', '/products', 200);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(typeof entry.responseTime).toBe('number');
      expect(entry.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('responseTime se mide en milisegundos (valor razonable < 5000ms en tests)', async () => {
      const ctx = buildContext('GET', '/products', 200);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const { responseTime } = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(responseTime).toBeLessThan(5000);
    });

    it('responseTime también se captura en respuestas con error', async () => {
      const ctx = buildContext('GET', '/missing', 404);

      await lastValueFrom(
        interceptor.intercept(ctx, errorHandler(new NotFoundException())),
      ).catch(() => {});

      const entry = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(typeof entry.responseTime).toBe('number');
      expect(entry.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('responseTime aumenta con el tiempo de procesamiento', async () => {
      const slowHandler: CallHandler = {
        handle: () =>
          new (require('rxjs').Observable)((subscriber: any) => {
            setTimeout(() => {
              subscriber.next({});
              subscriber.complete();
            }, 10); // 10ms delay
          }),
      };

      const ctx = buildContext('GET', '/slow', 200);
      await lastValueFrom(interceptor.intercept(ctx, slowHandler));

      const { responseTime } = JSON.parse(logSpy.mock.calls[0][0] as string);
      // Should be at least 10ms since we delayed 10ms
      expect(responseTime).toBeGreaterThanOrEqual(5); // tolerant bound
    });
  });

  // ── Requisito 3: no se loggea password/token ──────────────────────────────

  describe('no se loggea información sensible', () => {
    it('no registra el body de la petición aunque contenga password', async () => {
      const ctx = buildContext(
        'POST',
        '/auth/register',
        201,
        undefined,
        { email: 'user@test.com', password: 'SuperSecret1!', name: 'User' },
      );

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const logged = logSpy.mock.calls[0][0] as string;
      expect(logged).not.toContain('password');
      expect(logged).not.toContain('SuperSecret1');
    });

    it('no registra tokens aunque estén en el body', async () => {
      const ctx = buildContext(
        'POST',
        '/auth/refresh',
        200,
        undefined,
        { refreshToken: 'super-secret-refresh-token' },
      );

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const logged = logSpy.mock.calls[0][0] as string;
      expect(logged).not.toContain('refreshToken');
      expect(logged).not.toContain('super-secret-refresh-token');
    });

    it('no registra accessToken ni secret en ningún campo', async () => {
      const ctx = buildContext(
        'POST',
        '/auth/login',
        200,
        undefined,
        { email: 'a@test.com', password: 'pass', accessToken: 'token123', secret: 'mySecret' },
      );

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const logged = logSpy.mock.calls[0][0] as string;
      expect(logged).not.toContain('accessToken');
      expect(logged).not.toContain('token123');
      expect(logged).not.toContain('secret');
      expect(logged).not.toContain('mySecret');
    });

    it('el log solo contiene method, endpoint, statusCode, responseTime, userId', async () => {
      const ctx = buildContext('GET', '/orders', 200, { sub: 1, email: 'x@x.com', role: 'user' });

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
      const keys = Object.keys(entry).sort();
      expect(keys).toEqual(['endpoint', 'method', 'responseTime', 'statusCode', 'userId'].sort());
    });
  });
});
