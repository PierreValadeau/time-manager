import { afterAll, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';

// Every test starts from empty tables: refuse anything but a dedicated test database
const databaseName = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid').pathname.slice(1);
if (!databaseName.endsWith('_test')) {
  throw new Error(`DB tests truncate every table: DATABASE_URL must target a *_test database, got "${databaseName}"`);
}

// Every table of the schema except Prisma's migration history, read once from the database
// so a new model is emptied too
let tables: string | undefined;

beforeEach(async () => {
  if (!tables) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
    tables = rows.map(({ tablename }) => `"${tablename}"`).join(', ');
  }
  if (tables) await prisma.$executeRawUnsafe(`TRUNCATE ${tables} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
