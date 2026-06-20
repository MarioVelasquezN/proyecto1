import { LoggerMiddleware } from './logger.middleware';

describe('LoggerMiddleware (no-op stub)', () => {
  it('llama a next() y no lanza errores', () => {
    const middleware = new LoggerMiddleware();
    const next = jest.fn();
    middleware.use({} as any, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
