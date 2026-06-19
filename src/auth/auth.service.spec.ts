import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from './enums/role.enum';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockUsersService = {
  create: jest.fn(),
  findByEmail: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-access-token'),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-access-secret'),
};

const prismaMock = {
  refreshToken: {
    create: jest.fn().mockResolvedValue({ id: 1 }),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    delete: jest.fn().mockResolvedValue({ id: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

// ── fixtures ─────────────────────────────────────────────────────────────────

const dbUser = {
  id: 1,
  email: 'user@example.com',
  password: '$2b$10$placeholder-hash',
  name: 'Test User',
  role: Role.User,
  createdAt: new Date(),
};

const makeStoredToken = (overrides: Partial<{
  usedAt: Date | null;
  expiresAt: Date;
}> = {}) => ({
  id: 10,
  token: 'opaque-refresh-token-hex',
  userId: dbUser.id,
  usedAt: null,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  user: { id: dbUser.id, email: dbUser.email, role: dbUser.role },
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    mockJwtService.sign.mockReturnValue('signed-access-token');
    prismaMock.refreshToken.create.mockResolvedValue({ id: 1 });
    prismaMock.refreshToken.update.mockResolvedValue({ id: 1 });
    prismaMock.refreshToken.delete.mockResolvedValue({ id: 1 });
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
  });

  // ── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('retorna accessToken, refreshToken y user sin password en éxito', async () => {
      mockUsersService.findByEmail.mockResolvedValue(dbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login({ email: dbUser.email, password: 'correct' });

      expect(result.accessToken).toBe('signed-access-token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
      expect(result.user).toMatchObject({ id: 1, email: dbUser.email });
      expect(result.user).not.toHaveProperty('password');
    });

    it('persiste el refresh token en BD en cada login', async () => {
      mockUsersService.findByEmail.mockResolvedValue(dbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.login({ email: dbUser.email, password: 'correct' });

      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: dbUser.id }),
      });
    });

    it('lanza UnauthorizedException cuando la contraseña es incorrecta', async () => {
      mockUsersService.findByEmail.mockResolvedValue(dbUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(
        service.login({ email: dbUser.email, password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException cuando el usuario no existe (mismo error, previene enumeración)', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── register ───────────────────────────────────────────────────────────────

  describe('register', () => {
    it('crea usuario vía UsersService y retorna tokens', async () => {
      const created = { id: 2, email: 'new@example.com', name: 'New', role: Role.User, createdAt: new Date() };
      mockUsersService.create.mockResolvedValue(created);

      const result = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New',
      });

      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('accessToken');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.user).toMatchObject({ id: 2, email: 'new@example.com' });
      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('refresh token genera nuevo access token y nuevo refresh token', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(makeStoredToken());

      const result = await service.refresh('opaque-refresh-token-hex');

      // Retorna nuevo par de tokens
      expect(result.accessToken).toBe('signed-access-token');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);

      // Marca el token antiguo como usado (rotación)
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: makeStoredToken().id },
        data: { usedAt: expect.any(Date) },
      });

      // Persiste el nuevo refresh token
      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('el nuevo refresh token es diferente al anterior', async () => {
      const oldToken = 'opaque-refresh-token-hex';
      prismaMock.refreshToken.findUnique.mockResolvedValue(makeStoredToken());

      const result = await service.refresh(oldToken);

      expect(result.refreshToken).not.toBe(oldToken);
    });

    // ── token viejo deja de funcionar si rota ────────────────────────────────

    it('token viejo deja de funcionar si rota — detecta reuso y lanza UnauthorizedException', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        makeStoredToken({ usedAt: new Date() }),
      );

      await expect(service.refresh('already-used-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('detectar reuso revoca TODAS las sesiones del usuario', async () => {
      const usedToken = makeStoredToken({ usedAt: new Date() });
      prismaMock.refreshToken.findUnique.mockResolvedValue(usedToken);

      await expect(service.refresh('already-used-token')).rejects.toThrow();

      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: usedToken.userId },
      });
    });

    it('no emite nuevos tokens cuando se detecta reuso', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(
        makeStoredToken({ usedAt: new Date() }),
      );

      await expect(service.refresh('used-token')).rejects.toThrow();

      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });

    // ── otros casos de error ─────────────────────────────────────────────────

    it('lanza UnauthorizedException si el token no existe en BD', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException y borra el token si está expirado', async () => {
      const expiredToken = makeStoredToken({
        expiresAt: new Date(Date.now() - 1_000),
      });
      prismaMock.refreshToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.refresh(expiredToken.token)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prismaMock.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: expiredToken.id },
      });
    });
  });
});
