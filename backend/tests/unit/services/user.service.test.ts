import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../../../src/lib/prisma';
import { sendSetupLink } from '../../../src/services/mail.service';
import { createUser } from '../../../src/services/user.service';
import type { Caller } from '../../../src/services/scope.service';
import type { CreateUserInput } from '../../../src/schemas/user.schema';

// No database: Prisma and the mailer are replaced by mocks
vi.mock('../../../src/lib/prisma', () => ({ default: { user: { create: vi.fn() } } }));
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn() }));

const createMock = prisma.user.create as unknown as Mock;
const sendSetupLinkMock = sendSetupLink as unknown as Mock;

const admin: Caller = { id: 'admin-id', role: 'admin' };
const manager: Caller = { id: 'manager-id', role: 'manager' };
const employee: Caller = { id: 'employee-id', role: 'employee' };

const input: CreateUserInput = {
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean.dupont@trinity.com',
  role: 'employee',
};

const dbUser = {
  id: 'new-user-id',
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean.dupont@trinity.com',
  phoneNumber: null,
  role: 'employee',
  createdAt: new Date('2026-10-07T10:00:00Z'),
  updatedAt: new Date('2026-10-07T10:00:00Z'),
  memberships: [],
};

// Data passed to prisma.user.create on the last call
const createdData = () => createMock.mock.lastCall![0].data;
// Link passed to the mailer on the last call
const sentLink = () => new URL(sendSetupLinkMock.mock.lastCall![1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FRONTEND_URL', 'http://front.test');
  createMock.mockResolvedValue(dbUser);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('createUser: role rules', () => {
  it.each([
    ['an admin', 'employee', admin],
    ['an admin', 'manager', admin],
    ['a manager', 'employee', manager],
  ] as const)('lets %s create a user with role %s', async (_label, role, actor) => {
    await createUser(actor, { ...input, role });
    expect(createdData().role).toBe(role);
  });

  it.each([
    ['a manager', 'manager', manager],
    ['an employee', 'employee', employee],
    ['an employee', 'manager', employee],
  ] as const)('forbids %s to create a user with role %s (403)', async (_label, role, actor) => {
    await expect(createUser(actor, { ...input, role })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(sendSetupLinkMock).not.toHaveBeenCalled();
  });
});

describe('createUser: persistence', () => {
  it('saves the validated fields', async () => {
    await createUser(admin, { ...input, phoneNumber: '+33612345678' });
    expect(createdData()).toMatchObject({ ...input, phoneNumber: '+33612345678' });
  });

  it('never sets a password', async () => {
    await createUser(admin, input);
    expect(createdData()).not.toHaveProperty('passwordHash');
  });

  it('returns 409 when the email is already taken', async () => {
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(createUser(admin, input)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(sendSetupLinkMock).not.toHaveBeenCalled();
  });

  it('rethrows unexpected database errors', async () => {
    createMock.mockRejectedValue(new Error('database down'));
    await expect(createUser(admin, input)).rejects.toThrow('database down');
  });
});

describe('createUser: setup link', () => {
  it('sends the link to the new user', async () => {
    await createUser(admin, input);
    expect(sendSetupLinkMock).toHaveBeenCalledWith('jean.dupont@trinity.com', expect.any(String));
    expect(sentLink().origin + sentLink().pathname).toBe('http://front.test/reset-password');
  });

  it('stores only the SHA-256 hash of the token sent in the link', async () => {
    await createUser(admin, input);
    const token = sentLink().searchParams.get('token')!;
    const { tokenHash } = createdData().passwordResetTokens.create;

    expect(tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).not.toBe(token);
  });

  it('generates a different token for each user', async () => {
    await createUser(admin, input);
    const first = createdData().passwordResetTokens.create.tokenHash;
    await createUser(admin, input);
    expect(createdData().passwordResetTokens.create.tokenHash).not.toBe(first);
  });

  it('makes the link expire after 72 hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));

    await createUser(admin, input);

    expect(createdData().passwordResetTokens.create.expiresAt).toEqual(
      new Date('2026-10-10T10:00:00Z'),
    );
  });
});

describe('createUser: response', () => {
  it('returns the full profile to an admin', async () => {
    const user = await createUser(admin, input);
    expect(user).toEqual({
      id: 'new-user-id',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@trinity.com',
      phoneNumber: null,
      role: 'employee',
      teams: [],
      createdAt: dbUser.createdAt,
      updatedAt: dbUser.updatedAt,
    });
  });

  it('maps memberships to teams in the full profile', async () => {
    createMock.mockResolvedValue({
      ...dbUser,
      memberships: [{ team: { id: 'team-id', name: 'Support N1' } }],
    });
    const user = await createUser(admin, input);
    expect(user).toMatchObject({ teams: [{ id: 'team-id', name: 'Support N1' }] });
    expect(user).not.toHaveProperty('memberships');
  });

  it('returns the reduced profile to a manager', async () => {
    const user = await createUser(manager, input);
    expect(user).toEqual({ id: 'new-user-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' });
  });
});
