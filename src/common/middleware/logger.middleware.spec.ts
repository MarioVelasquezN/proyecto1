import { Logger } from '@nestjs/common';
import { LoggerMiddleware } from './logger.middleware';

type FinishCb = () => void;

const buildMocks = (statusCode = 200) => {
  let finishCb: FinishCb | undefined;

  const req = { method: 'GET', originalUrl: '/health' } as any;
  const res = {
    statusCode,
    on: jest.fn((event: string, cb: FinishCb) => {
      if (event === 'finish') finishCb = cb;
    }),
  } as any;
  const next = jest.fn();

  const trigger = () => finishCb?.();

  return { req, res, next, trigger };
};

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    middleware = new LoggerMiddleware();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('llama a next() inmediatamente', () => {
    const { req, res, next } = buildMocks();
    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('logs se generan correctamente', () => {
    it('genera log con método, ruta, status y tiempo al completar respuesta (2xx)', () => {
      const { req, res, next, trigger } = buildMocks(200);
      req.method = 'GET';
      req.originalUrl = '/health';

      middleware.use(req, res, next);
      trigger();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/health 200 \+\d+ms/),
      );
    });

    it('usa warn para respuestas 4xx', () => {
      const { req, res, next, trigger } = buildMocks(404);
      req.method = 'GET';
      req.originalUrl = '/missing';

      middleware.use(req, res, next);
      trigger();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('404'),
      );
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('usa error para respuestas 5xx', () => {
      const { req, res, next, trigger } = buildMocks(500);
      req.method = 'POST';
      req.originalUrl = '/crash';

      middleware.use(req, res, next);
      trigger();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('500'),
      );
    });

    it('incluye el tiempo de respuesta en milisegundos', () => {
      const { req, res, next, trigger } = buildMocks(201);
      middleware.use(req, res, next);
      trigger();

      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\+\d+ms/));
    });

    it('NO genera log si la respuesta no hace finish', () => {
      const { req, res, next } = buildMocks();
      middleware.use(req, res, next);
      // trigger NOT called
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
