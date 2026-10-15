import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { createUser } from '../../../src/services/user.service';
import { sendSetupLink } from '../../../src/services/mail.service';

// Real database, only the mailer is mocked
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn() }));

const admin = { id: 'admin-id', role: 'admin' as const };
const input = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com', role: 'employee' as const };

beforeEach(() => {
  vi.stubEnv('FRONTEND_URL', 'http://front.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('createUser (PostgreSQL)', () => {
  it('stores the user and the hash of the token sent in the link', async () => {
    const user = await createUser(admin, input);

    const link = vi.mocked(sendSetupLink).mock.calls[0][1];
    const token = new URL(link).searchParams.get('token')!;
    const stored = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });

    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(stored[0].usedAt).toBeNull();
  });

  it('turns the unique violation on email into a 409', async () => {
    await createUser(admin, input);

    const err = await createUser(admin, input).catch(e => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await prisma.user.count()).toBe(1);
  });
});
