import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import { generateToken, hashToken, REFRESH_TOKEN_TTL_MS } from '../../../src/lib/token';
import { hashPassword, verifyPassword } from '../../../src/lib/password';
import {
  changePassword, forgotPassword, login, logout, refresh, resetPassword,
} from '../../../src/services/auth.service';
import { createUser } from '../../../src/services/user.service';
import { sendResetLink, sendSetupLink } from '../../../src/services/mail.service';

// Real database. generateToken is wrapped in a spy (real implementation by default)
// so one test can force a hash collision and make the insert fail
vi.mock('../../../src/lib/token', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/token')>();
  return { ...actual, generateToken: vi.fn(actual.generateToken) };
});
// The mailer is mocked so the tests can read the links it would send
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn(), sendResetLink: vi.fn() }));

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

describe('changePassword (PostgreSQL)', () => {
  const OLD = 'old-password-12';
  const NEW = 'new-password-12';
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // The seeded user gets a real bcrypt hash, a second active session and a token revoked yesterday
  const seedAccount = async () => {
    const { user, token } = await seed();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(OLD) } });
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken('other-device'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken('revoked-yesterday'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), revokedAt: yesterday },
    });
    return { user, token };
  };

  const storedHash = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash!;

  it('revokes every active token and keeps the date of a token revoked earlier', async () => {
    const { user, token } = await seedAccount();

    await changePassword(user.id, { currentPassword: OLD, newPassword: NEW });

    for (const old of [token, 'other-device']) {
      const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(old) } });
      expect(row!.revokedAt).toBeInstanceOf(Date);
    }
    const earlier = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken('revoked-yesterday') } });
    expect(earlier!.revokedAt).toEqual(yesterday);
  });

  it('leaves exactly one active token: the one it returns', async () => {
    const { user } = await seedAccount();

    const { refreshToken } = await changePassword(user.id, { currentPassword: OLD, newPassword: NEW });

    const active = await prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
    expect(active).toHaveLength(1);
    expect(active[0].tokenHash).toBe(hashToken(refreshToken));
    await expect(refresh(refreshToken)).resolves.toBeDefined();
  });

  it('stores a hash that accepts the new password and refuses the old one', async () => {
    const { user } = await seedAccount();

    await changePassword(user.id, { currentPassword: OLD, newPassword: NEW });

    const hash = await storedHash(user.id);
    expect(await verifyPassword(NEW, hash)).toBe(true);
    expect(await verifyPassword(OLD, hash)).toBe(false);
  });

  it('changes nothing when the current password is wrong', async () => {
    const { user } = await seedAccount();
    const before = await storedHash(user.id);

    await expect(changePassword(user.id, { currentPassword: 'wrong-password', newPassword: NEW }))
      .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });

    expect(await storedHash(user.id)).toBe(before);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(2);
  });

  it('rolls everything back when the new token cannot be stored', async () => {
    const { user, token } = await seedAccount();
    const before = await storedHash(user.id);
    // The "new" token is an existing one: its hash is already stored, the insert hits the unique constraint
    vi.mocked(generateToken).mockReturnValueOnce(token);

    await expect(changePassword(user.id, { currentPassword: OLD, newPassword: NEW })).rejects.toThrow();

    expect(await storedHash(user.id)).toBe(before);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(2);
  });

  it('does not touch the sessions of another user', async () => {
    const { user } = await seedAccount();
    const other = await prisma.user.create({
      data: { firstName: 'Other', lastName: 'User', email: 'other.user@trinity.com' },
    });
    await prisma.refreshToken.create({
      data: { userId: other.id, tokenHash: hashToken('other-user-token'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });

    await changePassword(user.id, { currentPassword: OLD, newPassword: NEW });

    await expect(refresh('other-user-token')).resolves.toBeDefined();
  });
});

describe('forgotPassword and resetPassword (PostgreSQL)', () => {
  const OLD = 'old-password-12';
  const NEW = 'new-password-12';
  const email = 'test.testy@trinity.com';
  const invalidLink = { status: 400, code: 'VALIDATION_ERROR', message: 'Lien invalide ou expiré' };

  // The seeded user gets a real bcrypt hash and a second active session
  const seedAccount = async () => {
    const { user, token } = await seed();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(OLD) } });
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken('other-device'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    return { user, token };
  };

  // Calls forgotPassword and returns the raw token of the link it sent
  const requestLink = async () => {
    await forgotPassword({ email });
    const link = vi.mocked(sendResetLink).mock.lastCall![1];
    return new URL(link).searchParams.get('token')!;
  };

  // A reset link written straight to the database
  const insertLink = (userId: string, token: string, expiresAt: Date) =>
    prisma.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });

  const storedHash = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash!;

  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'http://front.test');
  });

  it('lets the user log in with the new password and refuses the old one', async () => {
    await seedAccount();
    const token = await requestLink();

    await resetPassword({ token, newPassword: NEW });

    await expect(login({ email, password: NEW })).resolves.toBeDefined();
    await expect(login({ email, password: OLD })).rejects.toMatchObject({ status: 401 });
  });

  it('accepts a link only once', async () => {
    const { user } = await seedAccount();
    const token = await requestLink();
    await resetPassword({ token, newPassword: NEW });

    await expect(resetPassword({ token, newPassword: 'third-password-12' })).rejects.toMatchObject(invalidLink);

    expect(await verifyPassword(NEW, await storedHash(user.id))).toBe(true);
  });

  it('refuses an expired link and changes nothing', async () => {
    const { user } = await seedAccount();
    await insertLink(user.id, 'expired-link', new Date(Date.now() - 1000));
    const before = await storedHash(user.id);

    await expect(resetPassword({ token: 'expired-link', newPassword: NEW })).rejects.toMatchObject(invalidLink);

    expect(await storedHash(user.id)).toBe(before);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(2);
  });

  it('revokes every session of the account, and only of this account', async () => {
    const { user, token: session } = await seedAccount();
    const other = await prisma.user.create({
      data: { firstName: 'Other', lastName: 'User', email: 'other.user@trinity.com' },
    });
    await prisma.refreshToken.create({
      data: { userId: other.id, tokenHash: hashToken('other-user-token'), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    const token = await requestLink();

    await resetPassword({ token, newPassword: NEW });

    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    await expect(refresh(session)).rejects.toMatchObject({ status: 401 });
    await expect(refresh('other-user-token')).resolves.toBeDefined();
  });

  it('keeps only the latest link working and leaves the date of a link used earlier', async () => {
    const { user } = await seedAccount();
    const usedEarlier = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken('used-earlier'), expiresAt: new Date(), usedAt: usedEarlier },
    });
    const first = await requestLink();
    const second = await requestLink();

    await expect(resetPassword({ token: first, newPassword: NEW })).rejects.toMatchObject(invalidLink);
    await expect(resetPassword({ token: second, newPassword: NEW })).resolves.toBeUndefined();

    const earlier = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken('used-earlier') } });
    expect(earlier!.usedAt).toEqual(usedEarlier);
  });

  it('invalidates the other open links of the account', async () => {
    const { user } = await seedAccount();
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
    await insertLink(user.id, 'link-a', inOneHour);
    await insertLink(user.id, 'link-b', inOneHour);

    await resetPassword({ token: 'link-a', newPassword: NEW });

    await expect(resetPassword({ token: 'link-b', newPassword: 'third-password-12' })).rejects.toMatchObject(invalidLink);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  // Both calls may pass the lookup; inside the transactions, PostgreSQL locks the row
  // and only one update still finds usedAt null
  it('lets only one of two concurrent resets with the same link succeed', async () => {
    const { user } = await seedAccount();
    const token = await requestLink();
    const passwords = ['first-password-12', 'second-password-12'];

    const results = await Promise.allSettled(passwords.map(newPassword => resetPassword({ token, newPassword })));

    const winners = results.flatMap((result, i) => (result.status === 'fulfilled' ? [passwords[i]] : []));
    const losers = results.filter(result => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject(invalidLink);
    expect(await verifyPassword(winners[0], await storedHash(user.id))).toBe(true);
  });

  // Ticket, criterion 4: the account setup link goes through the reset mechanism (contract, section 3)
  it('lets a new employee set a first password with the setup link, then log in', async () => {
    const employee = await createUser(
      { id: 'admin-id', role: 'admin' },
      { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com', role: 'employee' },
    );
    const link = vi.mocked(sendSetupLink).mock.lastCall![1];
    const token = new URL(link).searchParams.get('token')!;

    await resetPassword({ token, newPassword: NEW });

    const session = await login({ email: employee.email, password: NEW });
    expect(session.user.id).toBe(employee.id);
  });
});
