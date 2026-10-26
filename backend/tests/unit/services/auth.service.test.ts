import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import prisma from '../../../src/lib/prisma';
import { verifyPassword } from '../../../src/lib/password';
import { verifyAccessToken } from '../../../src/lib/jwt';
import { login, refresh, logout, getMe } from '../../../src/services/auth.service';
import { userSelect } from '../../../src/services/user.service'; 

// No database: Prisma is mocked. bcrypt is mocked too.
// $transaction runs its callback with the same mocked client as tx
vi.mock('../../../src/lib/prisma', () => {
  const db = {
    user: { findUnique: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return { default: db };
});
vi.mock('../../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('dummy-hash'),
  verifyPassword: vi.fn(),
}));


const findUniqueMock = prisma.user.findUnique as unknown as Mock;
const createTokenMock = prisma.refreshToken.create as unknown as Mock;
const findTokenMock = prisma.refreshToken.findUnique as unknown as Mock;
const revokeTokenMock = prisma.refreshToken.updateMany as unknown as Mock;
const verifyPasswordMock = verifyPassword as unknown as Mock;

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

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
    expect(data.tokenHash).toBe(sha256(refreshToken));
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

const oldToken = 'old-refresh-token';
const tokenRow = {
  id: 'rt1', userId: '001', tokenHash: sha256(oldToken),
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000), revokedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  user: { id: '001', role: 'employee', deletedAt: null },
};

describe('refresh: success', () => {
  beforeEach(() => {
    findTokenMock.mockResolvedValue(tokenRow);
    revokeTokenMock.mockResolvedValue({ count: 1 });
  });

  it('looks the token up by its SHA-256 hash, never in clear', async () => {
    await refresh(oldToken);
    expect(findTokenMock.mock.lastCall![0].where).toEqual({ tokenHash: sha256(oldToken) });
  });

  it('signs an access token for the owner of the token and their role', async () => {
    const { accessToken } = await refresh(oldToken);
    expect(verifyAccessToken(accessToken)).toEqual({ id: '001', role: 'employee' });
  });

  it('revokes the old token only if it is still unrevoked', async () => {
    await refresh(oldToken);
    const { where, data } = revokeTokenMock.mock.lastCall![0];
    expect(where).toEqual({ id: 'rt1', revokedAt: null });
    expect(data.revokedAt).toBeInstanceOf(Date);
  });

  it('issues a new refresh token, stored as a hash, valid 7 days', async () => {
    const { refreshToken } = await refresh(oldToken);
    const { data } = createTokenMock.mock.lastCall![0];
    expect(refreshToken).not.toBe(oldToken);
    expect(data.userId).toBe('001');
    expect(data.tokenHash).toBe(sha256(refreshToken));
    expect(data.expiresAt.getTime() - Date.now()).toBeCloseTo(7 * 24 * 3600 * 1000, -4);
  });

  it('revokes and issues inside one transaction', async () => {
    await refresh(oldToken);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('refresh: failures', () => {
  beforeEach(() => {
    findTokenMock.mockResolvedValue(tokenRow);
    revokeTokenMock.mockResolvedValue({ count: 1 });
  });

  it.each([
    ['a missing cookie', undefined],
    ['a non-string cookie', 42],
  ])('answers 401 for %s without querying the database', async (_label, token) => {
    await expect(refresh(token)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(findTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown token', () => findTokenMock.mockResolvedValue(null)],
    ['a revoked token', () => findTokenMock.mockResolvedValue({ ...tokenRow, revokedAt: new Date() })],
    ['an expired token', () => findTokenMock.mockResolvedValue({ ...tokenRow, expiresAt: new Date(Date.now() - 1000) })],
    ['a deleted account', () => findTokenMock.mockResolvedValue({ ...tokenRow, user: { ...tokenRow.user, deletedAt: new Date() } })],
  ])('answers the same 401 for %s and neither revokes nor issues', async (_label, setup) => {
    setup();
    await expect(refresh(oldToken)).rejects.toMatchObject({
      status: 401, code: 'UNAUTHENTICATED', message: 'Session absente ou expirée',
    });
    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it('answers 401 and issues nothing when a concurrent refresh revoked the token first', async () => {
    revokeTokenMock.mockResolvedValue({ count: 0 });
    await expect(refresh(oldToken)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(createTokenMock).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('revokes the token by its hash, only if it is still unrevoked', async ()  => {
    revokeTokenMock.mockResolvedValue({ count: 1 }); 
    await logout(oldToken); 
    const { where, data } = revokeTokenMock.mock.lastCall![0]; 
    expect(where).toEqual({ tokenHash: sha256(oldToken), revokedAt: null }); 
    expect(data.revokedAt).toBeInstanceOf(Date); 
  }); 

  it('does nothing without a cookie, and does not throw', async () => {
    await expect(logout(undefined)).resolves.toBeUndefined(); 
    expect(revokeTokenMock).not.toHaveBeenCalled(); 
  }); 

  it('does not throw for an unknown or already revoked token', async () => {
    revokeTokenMock.mockResolvedValue({ count: 0 }); 
    await expect(logout(oldToken)).resolves.toBeUndefined(); 
    expect(revokeTokenMock).toHaveBeenCalledTimes(1); 
  }); 
}); 

describe('getMe', () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({ ...dbUser, passwordHash: undefined }); 
  }); 

  it('returns the full profile with teams without deletedAt', async () => {
    const profile = await getMe('001'); 
    expect(profile).toEqual({
      id: '001', firstName: 'Test', lastName: 'Testy', email: input.email,
      phoneNumber: null, role: 'employee',
      createdAt: dbUser.createdAt, updatedAt: dbUser.updatedAt,
      teams: [{ id: 't1', name: 'Team A' }],
    }); 
    expect(profile).not.toHaveProperty('deletedAt'); 
  }); 

  it('looks the user up by id and never selects the password hash', async () => {
    await getMe('001'); 
    const { where, select } = findUniqueMock.mock.lastCall![0]; 
    expect(where).toEqual({ id: '001' }); 
    expect(select).toEqual({ ...userSelect, deletedAt: true }); 
    expect(select.passwordHash).toBeUndefined(); 
  }); 

  it('answers 401 when the user no longer exists', async () => {
    findUniqueMock.mockResolvedValue(null); 
    await expect(getMe('001')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: 'Session absente ou expirée' }); 
  }); 

  it('answers 401 for a soft-deleted user', async () => {
    findUniqueMock.mockResolvedValue({ ...dbUser, passwordHash: undefined, deletedAt: new Date() }); 
    await expect(getMe('001')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: 'Session absente ou expirée' })
  })
})
