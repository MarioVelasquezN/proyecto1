import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { AuditInterceptor, sanitizeBody } from './audit.interceptor';
import { AuditService } from './audit.service';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildContext(
  method: string,
  url: string,
  body: object = {},
  user?: { sub: number; email: string; role: string },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        originalUrl: url,
        body,
        user,
      }),
    }),
  } as unknown as ExecutionContext;
}

function callHandler(value: unknown = {}): CallHandler {
  return { handle: () => of(value) };
}

// ── sanitizeBody (unidad pura) ────────────────────────────────────────────────

describe('sanitizeBody()', () => {
  it('reemplaza password por [REDACTED]', () => {
    const result = sanitizeBody({ email: 'a@a.com', password: 'secret123' });
    expect(result!.password).toBe('[REDACTED]');
    expect(result!.email).toBe('a@a.com');
  });

  it('reemplaza todos los campos sensibles conocidos', () => {
    const body = {
      password: 'x',
      currentPassword: 'y',
      newPassword: 'z',
      token: 'tok',
      refreshToken: 'ref',
      accessToken: 'acc',
      secret: 'shhh',
      name: 'visible',
    };

    const result = sanitizeBody(body)!;

    for (const key of ['password', 'currentPassword', 'newPassword', 'token', 'refreshToken', 'accessToken', 'secret']) {
      expect(result[key]).toBe('[REDACTED]');
    }
    expect(result.name).toBe('visible');
  });

  it('sanitiza recursivamente objetos anidados', () => {
    const body = { user: { password: 'nested', role: 'admin' } };
    const result = sanitizeBody(body) as any;
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.role).toBe('admin');
  });

  it('retorna null cuando el body no es un objeto plano', () => {
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(undefined)).toBeNull();
    expect(sanitizeBody('string')).toBeNull();
    expect(sanitizeBody([1, 2, 3])).toBeNull();
  });

  it('preserva campos no sensibles sin modificar', () => {
    const body = { name: 'Widget', price: 9.99, stock: 5 };
    expect(sanitizeBody(body)).toEqual(body);
  });
});

// ── AuditInterceptor ──────────────────────────────────────────────────────────

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let logMock: jest.Mock;

  beforeEach(() => {
    logMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: logMock } as unknown as AuditService;
    interceptor = new AuditInterceptor(auditService);
  });

  // ── Requisito 1: se registra un log en POST /products ──────────────────────

  describe('se registra un log en POST /products', () => {
    it('llama a AuditService.log con userId, method, endpoint y body sanitizado', async () => {
      const user = { sub: 7, email: 'admin@store.com', role: 'admin' };
      const body = { name: 'Widget', price: 9.99, stock: 10, categoryId: 1 };
      const ctx = buildContext('POST', '/products', body, user);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      expect(logMock).toHaveBeenCalledTimes(1);
      expect(logMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '7',
          method: 'POST',
          endpoint: '/products',
          body: { name: 'Widget', price: 9.99, stock: 10, categoryId: 1 },
        }),
      );
    });

    it('incluye un timestamp de tipo Date', async () => {
      const ctx = buildContext('POST', '/products', {}, { sub: 1, email: 'a@a.com', role: 'admin' });

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const { timestamp } = logMock.mock.calls[0][0];
      expect(timestamp).toBeInstanceOf(Date);
    });

    it('usa "anonymous" cuando la petición no tiene JWT', async () => {
      const ctx = buildContext('POST', '/auth/register', { email: 'x@x.com', name: 'X' });

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      expect(logMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'anonymous' }),
      );
    });
  });

  // ── Requisito 2: no se registra información sensible ──────────────────────

  describe('no se registra información sensible', () => {
    it('redacta password en el body antes de persistir', async () => {
      const body = { email: 'user@example.com', password: 'SuperSecret1!', name: 'User' };
      const ctx = buildContext('POST', '/auth/register', body);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const logged = logMock.mock.calls[0][0].body;
      expect(logged.password).toBe('[REDACTED]');
      expect(logged.email).toBe('user@example.com');
    });

    it('redacta refreshToken en el body', async () => {
      const body = { refreshToken: 'abc123secret' };
      const ctx = buildContext('POST', '/auth/refresh', body);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      expect(logMock.mock.calls[0][0].body.refreshToken).toBe('[REDACTED]');
    });

    it('redacta todos los campos sensibles en una sola petición', async () => {
      const body = {
        password: 'p',
        accessToken: 'at',
        refreshToken: 'rt',
        email: 'visible@test.com',
      };
      const ctx = buildContext('POST', '/auth/login', body);

      await lastValueFrom(interceptor.intercept(ctx, callHandler()));

      const logged = logMock.mock.calls[0][0].body;
      expect(logged.password).toBe('[REDACTED]');
      expect(logged.accessToken).toBe('[REDACTED]');
      expect(logged.refreshToken).toBe('[REDACTED]');
      expect(logged.email).toBe('visible@test.com');
    });
  });

  // ── Requisito 3: interceptor funciona globalmente ─────────────────────────

  describe('interceptor funciona globalmente', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'registra auditoría para %s (todos los métodos mutables)',
      async (method) => {
        const ctx = buildContext(method, '/products/1', {}, { sub: 1, email: 'a@a.com', role: 'admin' });

        await lastValueFrom(interceptor.intercept(ctx, callHandler()));

        expect(logMock).toHaveBeenCalledTimes(1);
        expect(logMock.mock.calls[0][0].method).toBe(method);
      },
    );

    it('NO registra auditoría para GET (solo lectura)', async () => {
      const ctx = buildContext('GET', '/products');

      await lastValueFrom(interceptor.intercept(ctx, callHandler([])));

      expect(logMock).not.toHaveBeenCalled();
    });

    it('registra la auditoría incluso cuando el handler lanza un error', async () => {
      const ctx = buildContext('POST', '/products', { name: 'X' }, { sub: 1, email: 'a@a.com', role: 'admin' });
      const errorHandler: CallHandler = {
        handle: () => throwError(() => new Error('DB error')),
      };

      // El observable lanzará el error pero el log debe ocurrir de todas formas
      await lastValueFrom(
        interceptor.intercept(ctx, errorHandler),
      ).catch(() => {});

      expect(logMock).toHaveBeenCalledTimes(1);
    });

    it('no propaga errores del AuditService al caller', async () => {
      logMock.mockRejectedValue(new Error('Audit DB down'));
      const ctx = buildContext('DELETE', '/products/5', {}, { sub: 1, email: 'a@a.com', role: 'admin' });

      // La petición no debe fallar por culpa del audit
      await expect(
        lastValueFrom(interceptor.intercept(ctx, callHandler())),
      ).resolves.toBeDefined();
    });
  });
});
