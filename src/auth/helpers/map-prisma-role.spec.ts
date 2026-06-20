import { Role as PrismaRole } from '@prisma/client';
import { Role } from '../enums/role.enum';
import { mapPrismaRole } from './map-prisma-role';

describe('mapPrismaRole', () => {
  describe('transiciones válidas', () => {
    it('mapea PrismaRole.user → Role.User', () => {
      expect(mapPrismaRole(PrismaRole.user)).toBe(Role.User);
    });

    it('mapea PrismaRole.admin → Role.Admin', () => {
      expect(mapPrismaRole(PrismaRole.admin)).toBe(Role.Admin);
    });

    it('el valor devuelto es el string correcto para Role.User', () => {
      expect(mapPrismaRole(PrismaRole.user)).toBe('user');
    });

    it('el valor devuelto es el string correcto para Role.Admin', () => {
      expect(mapPrismaRole(PrismaRole.admin)).toBe('admin');
    });
  });

  describe('role desconocido', () => {
    it('lanza Error si recibe un role que no existe en el enum', () => {
      expect(() => mapPrismaRole('superadmin' as PrismaRole)).toThrow(Error);
    });

    it('el mensaje de error incluye el valor desconocido', () => {
      expect(() => mapPrismaRole('superadmin' as PrismaRole)).toThrow('superadmin');
    });
  });

  describe('simetría con AppRole', () => {
    it('todos los valores de PrismaRole tienen un mapeo definido', () => {
      for (const prismaRoleValue of Object.values(PrismaRole)) {
        expect(() => mapPrismaRole(prismaRoleValue)).not.toThrow();
      }
    });

    it('todos los mapeos producen un valor del enum AppRole', () => {
      const appRoleValues = new Set(Object.values(Role));
      for (const prismaRoleValue of Object.values(PrismaRole)) {
        expect(appRoleValues.has(mapPrismaRole(prismaRoleValue))).toBe(true);
      }
    });
  });
});
