import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import prisma from '../../../src/lib/prisma';
import { verifyPassword } from '../../../src/lib/password';
import { verifyAccessToken } from '../../../src/lib/jwt';
import { login } from '../../../src/services/auth.service';

// No database: Prisma is mocked. bcrypt is mocked too
vi.mock('../../../src/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() }, refreshToken: { create: vi.fn() } },
}));
vi.mock('../../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('dummy-hash'),
  verifyPassword: vi.fn(),
}));

const findUniqueMock = prisma.user.findUnique as unknown as Mock;
const createTokenMock = prisma.refreshToken.create as unknown as Mock;
const verifyPasswordMock = verifyPassword as unknown as Mock;

const input = { email: 'test.testy@trinity.com', password: 'secret' };
const dbUser = {
  id: '001', firstName: 'Test', lastName: 'Testy', email: input.email,
  phoneNumber: null, role: 'employee',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  memberships: [{ team: { id: 't1', name: 'Team A' } }],
  passwordHash: 'real-hash', deletedAt: null,
};


beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', 'test-secret-that-is-at-least-32-characters');
  findUniqueMock.mockResolvedValue(dbUser);
  verifyPasswordMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('login: success', () => {
  it('returns the full profile without passwordHash or deletedAt', async () => {
    const { user } = await login(input);
    expect(user).toEqual({ 
      id: '001', firstName: 'Test', lastName: 'Testy', email: input.email,
      phoneNumber: null, role: 'employee',
      createdAt: dbUser.createdAt, updatedAt: dbUser.updatedAt,
      teams: [{ id: 't1', name: 'Team A' }],
     });
  });

  it('signs an access token for this user and role', async () => {
    const { accessToken } = await login(input);
    expect(verifyAccessToken(accessToken)).toEqual({ id: '001', role: 'employee' });
  });

  it('stores only the SHA-256 hash of the refresh token, valid 7 days', async () => {
    const { refreshToken } = await login(input);
    const { data } = createTokenMock.mock.lastCall![0];
    expect(data.tokenHash).toBe(crypto.createHash('sha256').update(refreshToken).digest('hex'));
    expect(data.tokenHash).not.toBe(refreshToken);
    expect(data.expiresAt.getTime() - Date.now()).toBeCloseTo(7 * 24 * 3600 * 1000, -4);
  });
});

describe('login: failures', () => {
  it.each([
    ['unknown email', () => findUniqueMock.mockResolvedValue(null)],
    ['deleted account', () => findUniqueMock.mockResolvedValue({ ...dbUser, deletedAt: new Date() })],
    ['password not set yet', () => findUniqueMock.mockResolvedValue({ ...dbUser, passwordHash: null })],
    ['wrong password', () => verifyPasswordMock.mockResolvedValue(false)],
  ])('answers the same 401 for %s and issues no token', async (_label, setup) => {
    setup();
    await expect(login(input)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it('still runs a bcrypt compare when the email is unknown (timing)', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(login(input)).rejects.toThrow();
    expect(verifyPasswordMock).toHaveBeenCalledWith('secret', 'dummy-hash');
  });
});
