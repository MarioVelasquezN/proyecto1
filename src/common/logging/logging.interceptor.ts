import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export interface LogEntry {
  method: string;
  endpoint: string;
  statusCode: number;
  responseTime: number; // ms
  userId: string;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl } = request;
    // request.user is populated by JwtAuthGuard before interceptors run.
    const userId =
      ((request as Request & { user?: JwtPayload }).user)?.sub?.toString() ?? 'anonymous';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          // Happy path: status code is set on the response by NestJS
          const response = context.switchToHttp().getResponse<Response>();
          this.writeLog(method, originalUrl, response.statusCode, Date.now() - start, userId);
        },
        error: (err: unknown) => {
          // Exception path: extract status from the thrown exception.
          // NestJS exception filters convert these to HTTP responses AFTER
          // the interceptor chain, so we read the code from the exception itself.
          const statusCode =
            err instanceof HttpException ? err.getStatus() : 500;
          this.writeLog(method, originalUrl, statusCode, Date.now() - start, userId);
        },
      }),
    );
  }

  private writeLog(
    method: string,
    endpoint: string,
    statusCode: number,
    responseTime: number,
    userId: string,
  ): void {
    const entry: LogEntry = { method, endpoint, statusCode, responseTime, userId };
    // Structured JSON — machine-parseable and human-readable.
    // request.body is intentionally excluded to prevent sensitive data leaks.
    const message = JSON.stringify(entry);

    if (statusCode >= 500) {
      this.logger.error(message);
    } else if (statusCode >= 400) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
