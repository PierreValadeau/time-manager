import { afterAll, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';

// Every test starts from empty tables: refuse anything but a dedicated test database
const databaseName = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid').pathname.slice(1);
if (!databaseName.endsWith('_test')) {
  throw new Error(`DB tests truncate every table: DATABASE_URL must target a *_test database, got "${databaseName}"`);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, teams, team_members, clocks, refresh_tokens, password_reset_tokens CASCADE'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
