import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { createUser, listUsers } from '../../../src/services/user.service';
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

describe('listUsers (PostgreSQL)', () => {
  it('searches case-insensitively, filters on team and skips anonymized accounts', async () => {
    const manager = await prisma.user.create({ data: { firstName: 'Nadia', lastName: 'Benali', email: 'nadia@trinity.com', role: 'manager' } });
    const camille = await prisma.user.create({ data: { firstName: 'Camille', lastName: 'Durand', email: 'camille@trinity.com' } });
    await prisma.user.create({ data: { firstName: 'Paul', lastName: 'Durand', email: 'paul@trinity.com', deletedAt: new Date() } });
    const team = await prisma.team.create({
      data: { name: 'Team A', managerId: manager.id, members: { create: { userId: camille.id } } },
    });

    const result = await listUsers(admin, { page: 1, limit: 20, search: 'DUR', teamId: team.id });

    expect(result.data.map(user => user.id)).toEqual([camille.id]);
    expect(result.meta.total).toBe(1);
  });
});

