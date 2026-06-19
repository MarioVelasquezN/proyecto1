// AuditMiddleware is now a no-op stub.
// Audit logic lives in AuditInterceptor — see src/common/audit/audit.interceptor.spec.ts.
import { AuditMiddleware } from './audit.middleware';

describe('AuditMiddleware (stub)', () => {
  let middleware: AuditMiddleware;

  beforeEach(() => {
    middleware = new AuditMiddleware();
  });

  it('pasa el control a next() sin ejecutar ninguna lógica de auditoría', () => {
    const next = jest.fn();
    middleware.use({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
