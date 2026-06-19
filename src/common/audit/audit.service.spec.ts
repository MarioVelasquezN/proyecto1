import { Test, TestingModule } from '@nestjs/testing';
import { AuditService, AuditEntry } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

const prismaMock = {
  auditLog: {
    create: jest.fn(),
  },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  describe('log()', () => {
    it('persiste el registro en BD con todos los campos', async () => {
      const entry: AuditEntry = {
        userId: '42',
        method: 'POST',
        endpoint: '/products',
        body: { name: 'Widget', price: 9.99 },
        timestamp: new Date('2025-01-01T00:00:00Z'),
      };

      await service.log(entry);

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: '42',
          method: 'POST',
          endpoint: '/products',
          body: JSON.stringify({ name: 'Widget', price: 9.99 }),
          timestamp: entry.timestamp,
        },
      });
    });

    it('persiste null en body cuando no hay payload', async () => {
      await service.log({
        userId: 'anonymous',
        method: 'DELETE',
        endpoint: '/products/1',
        body: null,
        timestamp: new Date(),
      });

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ body: null }) }),
      );
    });

    it('serializa el body como JSON string', async () => {
      const body = { items: [{ id: 1, qty: 2 }], couponCode: 'SAVE10' };

      await service.log({
        userId: '1',
        method: 'POST',
        endpoint: '/checkout',
        body,
        timestamp: new Date(),
      });

      const saved = prismaMock.auditLog.create.mock.calls[0][0].data.body;
      expect(typeof saved).toBe('string');
      expect(JSON.parse(saved)).toEqual(body);
    });

    it('usa el userId "anonymous" cuando la petición no está autenticada', async () => {
      await service.log({
        userId: 'anonymous',
        method: 'POST',
        endpoint: '/auth/register',
        body: { email: 'x@x.com' },
        timestamp: new Date(),
      });

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'anonymous' }),
        }),
      );
    });
  });
});
