import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

const MUTABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Keys whose values must never appear in audit records.
const SENSITIVE_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
]);

export function sanitizeBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeBody(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!MUTABLE_METHODS.has(request.method)) {
      return next.handle();
    }

    const timestamp = new Date();
    const userId =
      (request.user as JwtPayload | undefined)?.sub?.toString() ?? 'anonymous';
    const method = request.method;
    const endpoint = request.originalUrl;
    const body = sanitizeBody(request.body);

    return next.handle().pipe(
      // finalize runs on both complete and error — audit failures must never
      // bubble up to the caller, so we swallow them with .catch.
      finalize(() => {
        this.auditService
          .log({ userId, method, endpoint, body, timestamp })
          .catch(() => {});
      }),
    );
  }
}
