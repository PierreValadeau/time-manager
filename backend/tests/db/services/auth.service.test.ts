import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import { generateToken, hashToken, REFRESH_TOKEN_TTL_MS } from '../../../src/lib/token';
import { logout, refresh } from '../../../src/services/auth.service';

// Real database. generateToken is wrapped in a spy (real implementation by default)
// so one test can force a hash collision and make the insert fail
vi.mock('../../../src/lib/token', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/token')>();
  return { ...actual, generateToken: vi.fn(actual.generateToken) };
});

// A user with one valid refresh token, written straight to the database
const seed = async () => {
  const user = await prisma.user.create({
    data: { firstName: 'Test', lastName: 'Testy', email: 'test.testy@trinity.com' },
  });
  const token = 'seeded-refresh-token';
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
  });
  return { user, token };
};

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', 'test-secret-that-is-at-least-32-characters');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('refresh (PostgreSQL)', () => {
  it('rotates: the old token is revoked, the new one is stored as a hash and works', async () => {
    const { user, token } = await seed();

    const { refreshToken } = await refresh(token);

    const rows = await prisma.refreshToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.tokenHash === hashToken(token))!.revokedAt).toBeInstanceOf(Date);
    expect(rows.find(r => r.tokenHash === hashToken(refreshToken))!.revokedAt).toBeNull();
    // Only hashes in the table, never a token in clear
    for (const row of rows) expect([token, refreshToken]).not.toContain(row.tokenHash);

    await expect(refresh(refreshToken)).resolves.toBeDefined();
  });

  it('refuses the old token once it has been used', async () => {
    const { token } = await seed();
    await refresh(token);

    await expect(refresh(token)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    const { user, token } = await seed();

    const results = await Promise.allSettled([refresh(token), refresh(token)]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });

  it('rolls the revocation back when the new token cannot be stored', async () => {
    const { user, token } = await seed();
    // The "new" token is the old one: its hash already exists, the insert hits the unique constraint
    vi.mocked(generateToken).mockReturnValueOnce(token);

    await expect(refresh(token)).rejects.toThrow();

    const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revokedAt).toBeNull();
  });

  it('refuses the token of a soft-deleted user', async () => {
    const { user, token } = await seed();
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    await expect(refresh(token)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('logout (PostgreSQL)', () => {
  it('revokes the token: a refresh with it is refused afterwards', async () => {
    const { token } = await seed();

    await logout(token);

    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(row!.revokedAt).toBeInstanceOf(Date);
    await expect(refresh(token)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('is idempotent: a second logout keeps the first revocation date', async () => {
    const { token } = await seed();

    await logout(token);
    const first = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    await logout(token);
    const second = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });

    expect(second!.revokedAt).toEqual(first!.revokedAt);
  });

  it('only revokes the given token, not the other sessions of the user', async () => {
    const { user, token } = await seed();
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken('other-device'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });

    await logout(token);

    await expect(refresh('other-device')).resolves.toBeDefined();
  });
});
