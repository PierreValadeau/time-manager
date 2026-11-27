import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import prisma from '../../../src/lib/prisma';
import { hashPassword, verifyPassword } from '../../../src/lib/password';
import { verifyAccessToken } from '../../../src/lib/jwt';
import {
  login, refresh, logout, getMe, changePassword, forgotPassword, resetPassword,
} from '../../../src/services/auth.service';
import { userSelect } from '../../../src/services/user.service';
import { sendResetLink } from '../../../src/services/mail.service';

// No database: Prisma is mocked. bcrypt and the mail are mocked too.
// $transaction runs its callback with the same mocked client as tx
vi.mock('../../../src/lib/prisma', () => {
  const db = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    passwordResetToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return { default: db };
});
vi.mock('../../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('dummy-hash'),
  verifyPassword: vi.fn(),
}));
vi.mock('../../../src/services/mail.service', () => ({
  sendSetupLink: vi.fn(),
  sendResetLink: vi.fn(),
}));


const findUniqueMock = prisma.user.findUnique as unknown as Mock;
const createTokenMock = prisma.refreshToken.create as unknown as Mock;
const findTokenMock = prisma.refreshToken.findUnique as unknown as Mock;
const revokeTokenMock = prisma.refreshToken.updateMany as unknown as Mock;
const verifyPasswordMock = verifyPassword as unknown as Mock;
const hashPasswordMock = hashPassword as unknown as Mock;
const updateUserMock = prisma.user.update as unknown as Mock;
const findResetMock = prisma.passwordResetToken.findUnique as unknown as Mock;
const updateResetMock = prisma.passwordResetToken.updateMany as unknown as Mock;
const createResetMock = prisma.passwordResetToken.create as unknown as Mock;
const transactionMock = prisma.$transaction as unknown as Mock;
const sendResetLinkMock = sendResetLink as unknown as Mock;

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

describe('changePassword', () => {
  const change = { currentPassword: 'old-password', newPassword: 'new-password-12' };
  const sessionError = { status: 401, code: 'UNAUTHENTICATED', message: 'Session absente ou expirée' };
  const wrongPasswordError = { status: 401, code: 'UNAUTHENTICATED', message: 'Mot de passe actuel incorrect' };

  const expectNoWrite = () => {
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    findUniqueMock.mockResolvedValue({ passwordHash: 'real-hash', deletedAt: null });
    revokeTokenMock.mockResolvedValue({ count: 2 });
  });

  describe('failures', () => {
    it('answers 401 when the user no longer exists, and writes nothing', async () => {
      findUniqueMock.mockResolvedValue(null);
      await expect(changePassword('001', change)).rejects.toMatchObject(sessionError);
      expectNoWrite();
    });

    it('answers 401 for a soft-deleted user, and writes nothing', async () => {
      findUniqueMock.mockResolvedValue({ passwordHash: null, deletedAt: new Date() });
      await expect(changePassword('001', change)).rejects.toMatchObject(sessionError);
      expectNoWrite();
    });

    it('answers 401 for an account without a password (Microsoft-only), without comparing', async () => {
      findUniqueMock.mockResolvedValue({ passwordHash: null, deletedAt: null });
      await expect(changePassword('001', change)).rejects.toMatchObject(wrongPasswordError);
      expect(verifyPasswordMock).not.toHaveBeenCalled();
      expectNoWrite();
    });

    it('answers 401 when the current password is wrong, without hashing or writing', async () => {
      verifyPasswordMock.mockResolvedValue(false);
      await expect(changePassword('001', change)).rejects.toMatchObject(wrongPasswordError);
      expect(hashPasswordMock).not.toHaveBeenCalled();
      expectNoWrite();
    });

    it('lets an error inside the transaction propagate', async () => {
      createTokenMock.mockRejectedValueOnce(new Error('insert failed'));
      await expect(changePassword('001', change)).rejects.toThrow('insert failed');
    });
  });

  describe('success', () => {
    it('reads only the password hash and deletedAt of the caller', async () => {
      await changePassword('001', change);
      expect(findUniqueMock.mock.lastCall![0]).toEqual({
        where: { id: '001' },
        select: { passwordHash: true, deletedAt: true },
      });
    });

    it('checks the current password against the stored hash and hashes the new one', async () => {
      await changePassword('001', change);
      expect(verifyPasswordMock).toHaveBeenCalledWith('old-password', 'real-hash');
      expect(hashPasswordMock).toHaveBeenCalledWith('new-password-12');
    });

    it('stores the new hash, revokes every active refresh token, then issues a new one, in this order', async () => {
      await changePassword('001', change);

      expect(updateUserMock.mock.lastCall![0]).toEqual({ where: { id: '001' }, data: { passwordHash: 'dummy-hash' } });
      const { where, data } = revokeTokenMock.mock.lastCall![0];
      expect(where).toEqual({ userId: '001', revokedAt: null });
      expect(data.revokedAt).toBeInstanceOf(Date);

      // Revoking after issuing would revoke the new token too
      const [update] = updateUserMock.mock.invocationCallOrder;
      const [revoke] = revokeTokenMock.mock.invocationCallOrder;
      const [create] = createTokenMock.mock.invocationCallOrder;
      expect(update).toBeLessThan(revoke);
      expect(revoke).toBeLessThan(create);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns the raw refresh token; only its SHA-256 hash is stored, valid 7 days', async () => {
      const { refreshToken } = await changePassword('001', change);
      const { data } = createTokenMock.mock.lastCall![0];
      expect(typeof refreshToken).toBe('string');
      expect(data.userId).toBe('001');
      expect(data.tokenHash).toBe(sha256(refreshToken));
      expect(data.expiresAt.getTime() - Date.now()).toBeCloseTo(7 * 24 * 3600 * 1000, -4);
    });
  });
});

describe('forgotPassword', () => {
  const forgot = { email: input.email };

  // The raw token only exists in the link given to the mail
  const sentToken = () => new URL(sendResetLinkMock.mock.lastCall![1]).searchParams.get('token')!;

  const expectNothingDone = () => {
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateResetMock).not.toHaveBeenCalled();
    expect(createResetMock).not.toHaveBeenCalled();
    expect(sendResetLinkMock).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    vi.stubEnv('FRONTEND_URL', 'http://front.test');
    findUniqueMock.mockResolvedValue({ id: '001', email: input.email, deletedAt: null });
    updateResetMock.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('failures', () => {
    it('throws before reading anything when FRONTEND_URL is missing', async () => {
      vi.stubEnv('FRONTEND_URL', undefined);
      await expect(forgotPassword(forgot)).rejects.toThrow('FRONTEND_URL');
      expect(findUniqueMock).not.toHaveBeenCalled();
      expectNothingDone();
    });

    it('resolves silently for an unknown email: no write, no mail', async () => {
      findUniqueMock.mockResolvedValue(null);
      await expect(forgotPassword(forgot)).resolves.toBeUndefined();
      expectNothingDone();
    });

    it('resolves silently for an anonymized account: no write, no mail', async () => {
      findUniqueMock.mockResolvedValue({ id: '001', email: input.email, deletedAt: new Date() });
      await expect(forgotPassword(forgot)).resolves.toBeUndefined();
      expectNothingDone();
    });

    it('lets an error inside the transaction propagate, and sends no mail', async () => {
      createResetMock.mockRejectedValueOnce(new Error('insert failed'));
      await expect(forgotPassword(forgot)).rejects.toThrow('insert failed');
      expect(sendResetLinkMock).not.toHaveBeenCalled();
    });

    // The 202 is already sent: nobody would receive the error
    it('resolves when the mail fails, and logs the user id but never the token', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      sendResetLinkMock.mockRejectedValueOnce(new Error('smtp down'));

      await expect(forgotPassword(forgot)).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('001'), expect.any(Error));
      expect(JSON.stringify(error.mock.calls)).not.toContain(sentToken());
    });
  });

  describe('success', () => {
    it('reads only the id, the email and deletedAt, never the password hash', async () => {
      await forgotPassword(forgot);
      expect(findUniqueMock.mock.lastCall![0]).toEqual({
        where: { email: input.email },
        select: { id: true, email: true, deletedAt: true },
      });
    });

    it('invalidates every unused link before creating the new one, in one transaction', async () => {
      await forgotPassword(forgot);

      const { where, data } = updateResetMock.mock.lastCall![0];
      expect(where).toEqual({ userId: '001', usedAt: null });
      expect(data.usedAt).toBeInstanceOf(Date);

      const [invalidate] = updateResetMock.mock.invocationCallOrder;
      const [create] = createResetMock.mock.invocationCallOrder;
      expect(invalidate).toBeLessThan(create);
      expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('stores only the SHA-256 hash of the token sent in the link, valid 15 minutes', async () => {
      await forgotPassword(forgot);
      const { data } = createResetMock.mock.lastCall![0];
      expect(data.userId).toBe('001');
      expect(data.tokenHash).toBe(sha256(sentToken()));
      expect(data.expiresAt.getTime() - Date.now()).toBeCloseTo(15 * 60 * 1000, -4);
    });

    it('sends the reset link to the account email after the transaction', async () => {
      await forgotPassword(forgot);

      expect(sendResetLinkMock).toHaveBeenCalledWith(
        input.email,
        `http://front.test/reset-password?token=${sentToken()}`,
      );
      // No link may leave before it is stored
      const [create] = createResetMock.mock.invocationCallOrder;
      const [send] = sendResetLinkMock.mock.invocationCallOrder;
      expect(create).toBeLessThan(send);
    });
  });
});

describe('resetPassword', () => {
  const reset = { token: 'raw-reset-token', newPassword: 'new-password-12' };
  const invalidLinkError = {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Lien invalide ou expiré',
    details: [{ field: 'token', issue: 'invalid' }],
  };
  const validRow = () => ({
    id: 'r1', userId: '001', usedAt: null,
    expiresAt: new Date(Date.now() + 60 * 1000),
    user: { deletedAt: null },
  });

  beforeEach(() => {
    findResetMock.mockResolvedValue(validRow());
    updateResetMock.mockResolvedValue({ count: 1 });
    revokeTokenMock.mockResolvedValue({ count: 2 });
  });

  describe('failures', () => {
    it.each([
      ['an unknown token', null],
      ['a link already used', { ...validRow(), usedAt: new Date() }],
      ['an expired link', { ...validRow(), expiresAt: new Date(Date.now() - 1000) }],
      ['an anonymized account', { ...validRow(), user: { deletedAt: new Date() } }],
    ])('answers 400 for %s, without hashing or opening a transaction', async (_label, row) => {
      findResetMock.mockResolvedValue(row);
      await expect(resetPassword(reset)).rejects.toMatchObject(invalidLinkError);
      expect(hashPasswordMock).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    // Two concurrent resets with the same link: the loser finds usedAt already set
    it('answers 400 when the link is consumed meanwhile, and writes nothing else', async () => {
      updateResetMock.mockResolvedValueOnce({ count: 0 });

      await expect(resetPassword(reset)).rejects.toMatchObject(invalidLinkError);

      expect(updateResetMock).toHaveBeenCalledTimes(1);
      expect(updateUserMock).not.toHaveBeenCalled();
      expect(revokeTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('looks the link up by the SHA-256 hash of the token, never the raw token', async () => {
      await resetPassword(reset);
      expect(findResetMock.mock.lastCall![0]).toEqual({
        where: { tokenHash: sha256(reset.token) },
        include: { user: { select: { deletedAt: true } } },
      });
    });

    it('hashes the new password before opening the transaction', async () => {
      await resetPassword(reset);
      expect(hashPasswordMock).toHaveBeenCalledWith(reset.newPassword);
      const [hash] = hashPasswordMock.mock.invocationCallOrder;
      const [transaction] = transactionMock.mock.invocationCallOrder;
      expect(hash).toBeLessThan(transaction);
    });

    it('consumes the link, invalidates the others, stores the hash and revokes every session, in this order', async () => {
      await resetPassword(reset);

      const [consume, others] = updateResetMock.mock.calls.map(call => call[0]);
      expect(consume.where).toEqual({ id: 'r1', usedAt: null });
      expect(consume.data.usedAt).toBeInstanceOf(Date);
      expect(others.where).toEqual({ userId: '001', usedAt: null });
      expect(others.data.usedAt).toBeInstanceOf(Date);
      expect(updateUserMock.mock.lastCall![0]).toEqual({ where: { id: '001' }, data: { passwordHash: 'dummy-hash' } });
      expect(revokeTokenMock.mock.lastCall![0].where).toEqual({ userId: '001', revokedAt: null });

      // Consuming first: the link keeps its own date instead of being caught by the second filter
      const [consumeOrder, othersOrder] = updateResetMock.mock.invocationCallOrder;
      const [update] = updateUserMock.mock.invocationCallOrder;
      const [revoke] = revokeTokenMock.mock.invocationCallOrder;
      expect(consumeOrder).toBeLessThan(othersOrder);
      expect(othersOrder).toBeLessThan(update);
      expect(update).toBeLessThan(revoke);
      expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('issues no refresh token and returns nothing: the user logs in again', async () => {
      await expect(resetPassword(reset)).resolves.toBeUndefined();
      expect(createTokenMock).not.toHaveBeenCalled();
    });
  });
});
