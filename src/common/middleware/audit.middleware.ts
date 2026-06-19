// Audit logic moved to AuditInterceptor + AuditService (src/common/audit/).
// This stub is kept so any existing import doesn't break compilation.
// Safe to delete once all references are removed.
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    next();
  }
}
