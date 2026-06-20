import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// Logging is now handled by LoggingInterceptor (src/common/logging/logging.interceptor.ts).
// This stub keeps existing imports compiling.
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    next();
  }
}
