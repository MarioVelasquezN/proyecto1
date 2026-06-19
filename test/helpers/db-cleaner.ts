import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';

// Delete in FK-safe order so no referential-integrity violation occurs.
// The dependency graph (child → parent) determines the sequence:
//
//   CartItem  → Cart → User
//   CartItem  → Product
//   OrderItem → Order → User
//   OrderItem → Order → Coupon (nullable, but Restrict by default in MySQL)
//   OrderItem → Product
//   Product   → User, Category
//   RefreshToken → User
export async function cleanDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  // AuditLog has no FKs — can be deleted at any point.
  await prisma.auditLog.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.product.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.category.deleteMany();
}
