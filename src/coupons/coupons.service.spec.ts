import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../prisma/prisma.service';

// ── fixtures ──────────────────────────────────────────────────────────────────

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const makeDto = (overrides = {}) => ({
  code: 'SAVE20',
  percentage: 20,
  expiresAt: FUTURE_DATE,
  ...overrides,
});

const makeCoupon = (overrides = {}) => ({
  id: 1,
  code: 'SAVE20',
  percentage: 20,
  expiresAt: new Date(FUTURE_DATE),
  isActive: true,
  createdAt: new Date(),
  ...overrides,
});

// ── mock ──────────────────────────────────────────────────────────────────────

const prismaMock = {
  coupon: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CouponsService', () => {
  let service: CouponsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<CouponsService>(CouponsService);
    jest.clearAllMocks();

    prismaMock.coupon.create.mockResolvedValue(makeCoupon());
    prismaMock.coupon.findMany.mockResolvedValue([makeCoupon()]);
  });

  describe('create', () => {
    it('crea y retorna el cupón', async () => {
      const result = await service.create(makeDto());

      expect(prismaMock.coupon.create).toHaveBeenCalledWith({
        data: {
          code: 'SAVE20',
          percentage: 20,
          expiresAt: new Date(FUTURE_DATE),
          isActive: true,
        },
      });
      expect(result.code).toBe('SAVE20');
      expect(result.percentage).toBe(20);
    });

    it('isActive es true por defecto si no se especifica', async () => {
      await service.create(makeDto());

      expect(prismaMock.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('respeta isActive:false cuando se proporciona', async () => {
      await service.create(makeDto({ isActive: false }));

      expect(prismaMock.coupon.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('lanza ConflictException si el código ya existe (P2002)', async () => {
      prismaMock.coupon.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.create(makeDto())).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('retorna lista de cupones ordenada por createdAt desc', async () => {
      const result = await service.findAll();

      expect(prismaMock.coupon.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].code).toBe('SAVE20');
    });
  });
});
