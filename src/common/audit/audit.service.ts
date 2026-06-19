import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  userId: string;
  method: string;
  endpoint: string;
  body: Record<string, unknown> | null;
  timestamp: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.userId,
        method: entry.method,
        endpoint: entry.endpoint,
        body: entry.body !== null ? JSON.stringify(entry.body) : null,
        timestamp: entry.timestamp,
      },
    });
  }
}
