import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';

const mockJwtService = { verify: jest.fn() };
const mockConfigService = { get: jest.fn().mockReturnValue('test-secret') };

const buildContext = (authHeader?: string): ExecutionContext => {
  const req: Record<string, any> = {
    headers: { authorization: authHeader },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as ExecutionContext;
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-secret');
  });

  it('rejects request with no Authorization header (simula endpoint protegido sin token)', () => {
    expect(() => guard.canActivate(buildContext())).toThrow(UnauthorizedException);
  });

  it('rejects request with malformed Authorization header (no "Bearer" prefix)', () => {
    expect(() => guard.canActivate(buildContext('Token abc123'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects request with an expired or invalid token', () => {
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    expect(() => guard.canActivate(buildContext('Bearer expired.token'))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows request with valid token and attaches payload to request', () => {
    const payload = { sub: 1, email: 'user@example.com' };
    mockJwtService.verify.mockReturnValue(payload);

    const req: Record<string, any> = {
      headers: { authorization: 'Bearer valid.token.here' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req['user']).toEqual(payload);
  });
});
