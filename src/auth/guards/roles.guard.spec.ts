import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

const mockReflector = { getAllAndOverride: jest.fn() };

const buildContext = (userRole?: Role): ExecutionContext => {
  const req = { user: userRole ? { sub: 1, email: 'u@e.com', role: userRole } : undefined };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    jest.clearAllMocks();
  });

  describe('rutas sin restricción de rol', () => {
    it('permite acceso cuando la ruta no tiene @Roles()', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      expect(guard.canActivate(buildContext(Role.User))).toBe(true);
    });
  });

  describe('ruta solo para admin', () => {
    beforeEach(() => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.Admin]);
    });

    it('admin sí puede acceder — retorna true', () => {
      expect(guard.canActivate(buildContext(Role.Admin))).toBe(true);
    });

    it('usuario normal no puede crear productos — lanza ForbiddenException', () => {
      expect(() => guard.canActivate(buildContext(Role.User))).toThrow(
        ForbiddenException,
      );
    });

    it('acceso denegado retorna 403', () => {
      expect.assertions(2);
      try {
        guard.canActivate(buildContext(Role.User));
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getStatus()).toBe(403);
      }
    });

    it('lanza ForbiddenException si no hay usuario en el request (token no verificado antes)', () => {
      expect(() => guard.canActivate(buildContext())).toThrow(ForbiddenException);
    });
  });

  describe('ROLES_KEY metadata', () => {
    it('llama a Reflector con la clave correcta', () => {
      mockReflector.getAllAndOverride.mockReturnValue([Role.Admin]);
      const ctx = buildContext(Role.Admin);
      guard.canActivate(ctx);
      expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
        ROLES_KEY,
        expect.any(Array),
      );
    });
  });
});
