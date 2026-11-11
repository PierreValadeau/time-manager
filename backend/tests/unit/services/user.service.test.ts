import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../../../src/lib/prisma';
import { hashToken } from '../../../src/lib/token';
import { sendSetupLink } from '../../../src/services/mail.service';
import { createUser, getUser, listUsers, updateUser, userSelect } from '../../../src/services/user.service';
import type { Caller } from '../../../src/services/scope.service';
import type { CreateUserInput } from '../../../src/schemas/user.schema';

// No database: Prisma and the mailer are replaced by mocks. scope.service stays real:
// teamMember.findFirst is the query behind isManagerOfEmployee
vi.mock('../../../src/lib/prisma', () => ({
  default: {
    user: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    team: { findMany: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
}));
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn() }));

const createMock = prisma.user.create as unknown as Mock;
const sendSetupLinkMock = sendSetupLink as unknown as Mock;
const findUsersMock = prisma.user.findMany as unknown as Mock; 
const countUsersMock = prisma.user.count as unknown as Mock 
const findTeamsMock = prisma.team.findMany as unknown as Mock;
const findUserMock = prisma.user.findUnique as unknown as Mock;
const updateMock = prisma.user.update as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;

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

// A row as Prisma returns it with userSelect
const listedUser = (id: string, teamIds: string[] = []) => ({
  ...dbUser,
  id, 
  email: `${id}@trinity.com`,
  memberships: teamIds.map(teamId => ({ team: { id: teamId, name: `Team ${teamId}` } })),
});


// Prisma error for a unique constraint violation on the given column
const uniqueViolation = (column: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [column] },
  });

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
    createMock.mockRejectedValue(uniqueViolation('email'));
    await expect(createUser(admin, input)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(sendSetupLinkMock).not.toHaveBeenCalled();
  });

  it('does not answer 409 for a unique violation on another column', async () => {
    const error = uniqueViolation('token_hash');
    createMock.mockRejectedValue(error);
    await expect(createUser(admin, input)).rejects.toBe(error);
  });

  it('rethrows unexpected database errors', async () => {
    createMock.mockRejectedValue(new Error('database down'));
    await expect(createUser(admin, input)).rejects.toThrow('database down');
  });
});

describe('createUser: configuration', () => {
  it.each([
    ['missing', ''],
    ['not a URL', 'front.test'],
  ])('fails before writing anything when FRONTEND_URL is %s', async (_label, value) => {
    vi.stubEnv('FRONTEND_URL', value);
    await expect(createUser(admin, input)).rejects.toThrow('FRONTEND_URL');
    expect(createMock).not.toHaveBeenCalled();
    expect(sendSetupLinkMock).not.toHaveBeenCalled();
  });

  it('does not double the slash when FRONTEND_URL ends with one', async () => {
    vi.stubEnv('FRONTEND_URL', 'http://front.test/');
    await createUser(admin, input);
    expect(sendSetupLinkMock.mock.lastCall![1]).toMatch(/^http:\/\/front\.test\/reset-password\?token=/);
  });
});

describe('createUser: mail failure', () => {
  it('still returns the created user when the link cannot be sent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendSetupLinkMock.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(createUser(admin, input)).resolves.toMatchObject({ id: 'new-user-id' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('never logs the token when the link cannot be sent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendSetupLinkMock.mockRejectedValueOnce(new Error('SMTP down'));

    await createUser(admin, input);
    const token = sentLink().searchParams.get('token')!;
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);
    consoleError.mockRestore();
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

    expect(tokenHash).toBe(hashToken(token));
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

describe('listUsers', () => {
  const query = { page: 1, limit: 20 };

  beforeEach(() => {
    findUsersMock.mockResolvedValue([]);
    countUsersMock.mockResolvedValue(0);
    findTeamsMock.mockResolvedValue([]);
  });

  const lastWhere = () => findUsersMock.mock.lastCall![0].where;

  it('never returns anonymized accounts', async () => {
    await listUsers(admin, query);
    expect(lastWhere()).toMatchObject({ deletedAt: null });
  });

  it('filters on role and team', async () => {
    await listUsers(admin, { ...query, role: 'manager', teamId: 'team-id' });
    expect(lastWhere()).toMatchObject({ role: 'manager', memberships: { some: { teamId: 'team-id' } } });
  });

  it('searches first name, last name and email, case-insensitive', async () => {
    await listUsers(admin, { ...query, search: 'dur' });
    expect(lastWhere().OR).toEqual([
      { firstName: { contains: 'dur', mode: 'insensitive' } },
      { lastName: { contains: 'dur', mode: 'insensitive' } },
      { email: { contains: 'dur', mode: 'insensitive' } },
    ]);
  });

  it('counts with the same filter as the page', async () => {
    await listUsers(admin, { ...query, role: 'employee' });
    expect(countUsersMock).toHaveBeenCalledWith({ where: lastWhere() });
  });

  it('skips the previous pages', async () => {
    await listUsers(admin, { page: 3, limit: 10 });
    expect(findUsersMock.mock.lastCall![0]).toMatchObject({ skip: 20, take: 10 });
  });

  it('returns the full profile of everyone to the admin', async () => {
    findUsersMock.mockResolvedValue([listedUser('u1')]);
    const { data } = await listUsers(admin, query);
    expect(data[0]).toHaveProperty('email');
    expect(findTeamsMock).not.toHaveBeenCalled();
  });

  it('gives a manager the full profile of their members, the reduced one for others', async () => {
    findTeamsMock.mockResolvedValue([{ id: 'my-team' }]);
    findUsersMock.mockResolvedValue([listedUser('member', ['my-team']), listedUser('outsider', ['other-team'])]);

    const { data } = await listUsers(manager, query);

    expect(data[0]).toHaveProperty('email');
    expect(data[1]).toEqual({ id: 'outsider', firstName: 'Jean', lastName: 'Dupont', role: 'employee' });
  });

  it("looks up the manager's teams once, whatever the page size", async () => {
    findUsersMock.mockResolvedValue([listedUser('a'), listedUser('b'), listedUser('c')]);
    await listUsers(manager, query);
    expect(findTeamsMock).toHaveBeenCalledTimes(1);
    expect(findTeamsMock).toHaveBeenCalledWith({ where: { managerId: 'manager-id' }, select: { id: true } });
  });

  it('gives a manager their own full profile', async () => {
    findUsersMock.mockResolvedValue([listedUser('manager-id')]);
    const { data } = await listUsers(manager, query);
    expect(data[0]).toHaveProperty('email');
  });

  it('returns the pagination meta', async () => {
    countUsersMock.mockResolvedValue(42);
    const result = await listUsers(admin, { page: 2, limit: 10 });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 42 });
  });
});

describe('getUser', () => {
  const reduced = (id: string) => ({ id, firstName: 'Jean', lastName: 'Dupont', role: 'employee' });

  // findUnique returns the requested user, with no team; nobody is a member of the manager's teams
  beforeEach(() => {
    findUserMock.mockImplementation(async ({ where }: { where: { id: string } }) => listedUser(where.id));
    findMembershipMock.mockResolvedValue(null);
  });

  describe('access', () => {
    it('resolves "me" to the caller and returns their full profile', async () => {
      const user = await getUser(employee, 'me');

      expect(findUserMock.mock.lastCall![0].where.id).toBe('employee-id');
      expect(user).toHaveProperty('email', 'employee-id@trinity.com');
    });

    it("forbids an employee to read a colleague's account, without querying the database", async () => {
      await expect(getUser(employee, 'colleague-id')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      expect(findUserMock).not.toHaveBeenCalled();
    });

    it('answers 403, not 404, to an employee asking for an unknown account', async () => {
      findUserMock.mockResolvedValue(null);
      await expect(getUser(employee, 'unknown-id')).rejects.toMatchObject({ status: 403 });
    });

    it.each([
      ['a manager', manager],
      ['the admin', admin],
    ])('answers 404 to %s for a missing or anonymized account', async (_label, actor) => {
      findUserMock.mockResolvedValue(null);
      await expect(getUser(actor, 'gone-id')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('lookup', () => {
    it('skips anonymized accounts and reads through userSelect', async () => {
      await getUser(admin, 'user-id');
      expect(findUserMock).toHaveBeenCalledWith({
        where: { id: 'user-id', deletedAt: null },
        select: userSelect,
      });
    });

    it('never reads the password hash', () => {
      expect(userSelect).not.toHaveProperty('passwordHash');
    });
  });

  describe('profile', () => {
    it('gives the admin the full profile of anyone, without looking up teams', async () => {
      const user = await getUser(admin, 'user-id');

      expect(user).toHaveProperty('email');
      expect(findMembershipMock).not.toHaveBeenCalled();
    });

    it('gives a manager the full profile of a member of their teams, with the teams', async () => {
      findUserMock.mockResolvedValue(listedUser('member-id', ['my-team']));
      findMembershipMock.mockResolvedValue({ teamId: 'my-team' });

      const user = await getUser(manager, 'member-id');

      expect(user).toMatchObject({ email: 'member-id@trinity.com', teams: [{ id: 'my-team', name: 'Team my-team' }] });
      expect(user).not.toHaveProperty('memberships');
      expect(findMembershipMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'member-id', team: { managerId: 'manager-id' } } }),
      );
    });

    it('gives a manager only the reduced profile of a user outside their teams', async () => {
      expect(await getUser(manager, 'outsider-id')).toEqual(reduced('outsider-id'));
    });

    it('gives a manager their own full profile, without looking up teams', async () => {
      const user = await getUser(manager, 'me');

      expect(user).toHaveProperty('email', 'manager-id@trinity.com');
      expect(findMembershipMock).not.toHaveBeenCalled();
    });
  });
});

describe('updateUser', () => {
  // Current role of each target, as the lookup (select: { role: true }) returns it
  const ROLES: Record<string, 'employee' | 'manager' | 'admin'> = {
    'employee-id': 'employee',
    'member-id': 'employee',
    'outsider-id': 'employee',
    'manager-id': 'manager',
    'other-manager-id': 'manager',
    'admin-id': 'admin',
    // seedAdmin upserts on ADMIN_EMAIL: a second admin is possible
    'other-admin-id': 'admin',
  };

  // A valid body, as validate() leaves it: no role and no phoneNumber
  const input = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com' };

  // Rejects with a 403 and writes nothing
  const expectForbidden = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(updateMock).not.toHaveBeenCalled();
  };

  const updatedId = () => updateMock.mock.lastCall![0].where.id;
  const writtenData = () => updateMock.mock.lastCall![0].data;

  beforeEach(() => {
    findUserMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      ROLES[where.id] ? { role: ROLES[where.id] } : null,
    );
    updateMock.mockImplementation(async ({ where }: { where: { id: string } }) => listedUser(where.id));
    findMembershipMock.mockResolvedValue(null);
  });

  describe('access', () => {
    it('resolves "me" and lets an employee edit their own account', async () => {
      await updateUser(employee, 'me', input);
      expect(updatedId()).toBe('employee-id');
    });

    it("forbids an employee to edit a colleague's account, without querying the database", async () => {
      await expectForbidden(updateUser(employee, 'member-id', input));
      expect(findUserMock).not.toHaveBeenCalled();
    });

    it('answers 403, not 404, to an employee targeting an unknown account', async () => {
      await expectForbidden(updateUser(employee, 'unknown-id', input));
    });

    it.each([
      ['a manager', manager],
      ['the admin', admin],
    ])('answers 404 to %s for a missing or anonymized account, without writing', async (_label, actor) => {
      await expect(updateUser(actor, 'unknown-id', input)).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      });
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('only reads the current role of a non-anonymized target', async () => {
      await updateUser(admin, 'member-id', input);
      expect(findUserMock).toHaveBeenCalledWith({
        where: { id: 'member-id', deletedAt: null },
        select: { role: true },
      });
    });

    it('lets a manager edit a member of their teams', async () => {
      findMembershipMock.mockResolvedValue({ teamId: 'my-team' });
      await updateUser(manager, 'member-id', input);
      expect(updatedId()).toBe('member-id');
    });

    it('forbids a manager to edit a user outside their teams', async () => {
      await expectForbidden(updateUser(manager, 'outsider-id', input));
    });

    it('forbids a manager to edit another manager, even one who is a member of their team', async () => {
      // Would let the manager through if the role of the target were not checked first
      findMembershipMock.mockResolvedValue({ teamId: 'my-team' });

      await expectForbidden(updateUser(manager, 'other-manager-id', input));
      expect(findMembershipMock).not.toHaveBeenCalled();
    });

    it('forbids a manager to edit the admin account', async () => {
      await expectForbidden(updateUser(manager, 'admin-id', input));
    });

    it('lets a manager edit their own account, without looking up teams', async () => {
      await updateUser(manager, 'me', input);

      expect(updatedId()).toBe('manager-id');
      expect(findMembershipMock).not.toHaveBeenCalled();
    });

    it('lets the admin edit a manager', async () => {
      await updateUser(admin, 'other-manager-id', input);
      expect(updatedId()).toBe('other-manager-id');
    });
  });

  describe('role', () => {
    it('accepts an unchanged role from anyone, so the whole profile can be sent back', async () => {
      await updateUser(employee, 'me', { ...input, role: 'employee' });
      expect(writtenData().role).toBe('employee');
    });

    it('forbids an employee to promote themselves', async () => {
      await expectForbidden(updateUser(employee, 'me', { ...input, role: 'manager' }));
    });

    it('forbids a manager to change the role of a member of their teams', async () => {
      findMembershipMock.mockResolvedValue({ teamId: 'my-team' });
      await expectForbidden(updateUser(manager, 'member-id', { ...input, role: 'manager' }));
    });

    it('forbids a manager to demote themselves', async () => {
      await expectForbidden(updateUser(manager, 'me', { ...input, role: 'employee' }));
    });

    it('lets the admin promote an employee to manager', async () => {
      await updateUser(admin, 'member-id', { ...input, role: 'manager' });
      expect(writtenData().role).toBe('manager');
    });

    it('lets the admin demote a manager to employee', async () => {
      await updateUser(admin, 'other-manager-id', { ...input, role: 'employee' });
      expect(writtenData().role).toBe('employee');
    });

    it('forbids the admin to change their own role', async () => {
      await expectForbidden(updateUser(admin, 'me', { ...input, role: 'employee' }));
    });

    it("forbids the admin to change another admin account's role", async () => {
      await expectForbidden(updateUser(admin, 'other-admin-id', { ...input, role: 'employee' }));
    });

    it('lets the admin edit their own profile when the role is left out', async () => {
      await updateUser(admin, 'me', input);
      expect(updatedId()).toBe('admin-id');
    });
  });

  describe('persistence', () => {
    it('writes the validated body as is: a missing phone number or role is left untouched', async () => {
      await updateUser(admin, 'member-id', input);
      expect(writtenData()).toEqual(input);
    });

    it('writes a null phone number, to clear it', async () => {
      await updateUser(admin, 'member-id', { ...input, phoneNumber: null });
      expect(writtenData()).toHaveProperty('phoneNumber', null);
    });

    it('reads the updated row through userSelect', async () => {
      await updateUser(admin, 'member-id', input);
      expect(updateMock.mock.lastCall![0].select).toBe(userSelect);
    });

    it('returns the full profile in the contract format', async () => {
      updateMock.mockResolvedValue(listedUser('member-id', ['my-team']));

      expect(await updateUser(admin, 'member-id', input)).toEqual({
        id: 'member-id',
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'member-id@trinity.com',
        phoneNumber: null,
        role: 'employee',
        teams: [{ id: 'my-team', name: 'Team my-team' }],
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt,
      });
    });

    it('returns 409 when the email is already taken', async () => {
      updateMock.mockRejectedValue(uniqueViolation('email'));
      await expect(updateUser(admin, 'member-id', input)).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
    });

    it.each([
      ['a unique violation on another column', uniqueViolation('microsoft_id')],
      ['an unexpected database error', new Error('database down')],
    ])('rethrows %s unchanged', async (_label, error) => {
      updateMock.mockRejectedValue(error);
      await expect(updateUser(admin, 'member-id', input)).rejects.toBe(error);
    });
  });
});

