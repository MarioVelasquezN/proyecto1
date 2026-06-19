// E2E tests use a dedicated database so they never interfere with unit test fixtures.
// Run `prisma migrate deploy` against this URL before executing the suite:
//   DATABASE_URL=mysql://test:test@localhost:3306/testdb_e2e npx prisma migrate deploy
process.env.DATABASE_URL = 'mysql://test:test@localhost:3306/testdb_e2e';
process.env.PORT = '3002';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32-chars-long!!';
