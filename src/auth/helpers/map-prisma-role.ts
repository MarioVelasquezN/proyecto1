import { Role as PrismaRole } from '@prisma/client';
import { Role } from '../enums/role.enum';

// Prisma generates its own Role enum from schema.prisma that is structurally
// identical to our app Role enum but TypeScript treats them as incompatible types.
//
// RULE: every place that reads `user.role` from a Prisma query result and assigns
// it to a typed AppRole field (JwtPayload, UserResponseDto, etc.) MUST pass through
// this function. Direct assignment of PrismaRole → AppRole is a compile error.
export function mapPrismaRole(role: PrismaRole): Role {
  switch (role) {
    case PrismaRole.user:  return Role.User;
    case PrismaRole.admin: return Role.Admin;
    default:
      // Exhaustiveness guard: if the schema adds a new role value and Prisma
      // regenerates, this will throw at runtime until the case is added here.
      throw new Error(`Unknown Prisma role: ${role as string}`);
  }
}
