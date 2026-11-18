import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { createUser, getUser, listUsers, updateUser } from '../../../src/services/user.service';
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

  it('returns each namesake exactly once when paging through them, ordered by id', async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const user = await prisma.user.create({
        data: { firstName: 'Camille', lastName: 'Durand', email: `camille${n}@trinity.com` },
      });
      ids.push(user.id);
    }

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const { data } = await listUsers(admin, { page, limit: 1 });
      seen.push(...data.map(user => user.id));
    }

    // UUIDs are lowercase hex of the same shape: string order matches PostgreSQL's uuid order
    expect(seen).toEqual([...ids].sort());
  });

  describe('search with LIKE wildcards', () => {
    const setup = async () => {
      const jeanLuc = await prisma.user.create({
        data: { firstName: 'Jean_Luc', lastName: 'Martin', email: 'jl@trinity.com' },
      });
      await prisma.user.create({ data: { firstName: 'Camille', lastName: 'Durand', email: 'camille@trinity.com' } });
      return { jeanLuc };
    };

    it('matches _ literally, not as any character', async () => {
      const { jeanLuc } = await setup();

      const result = await listUsers(admin, { page: 1, limit: 20, search: '_' });

      expect(result.data.map(user => user.id)).toEqual([jeanLuc.id]);
      expect(result.meta.total).toBe(1);
    });

    it('matches % literally, so it finds nobody when no name contains it', async () => {
      await setup();

      const result = await listUsers(admin, { page: 1, limit: 20, search: '%' });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('search on email (data minimization)', () => {
    // Worst case: "x9q" only appears in the email, never in the names
    const setup = async () => {
      const nadia = await prisma.user.create({
        data: { firstName: 'Nadia', lastName: 'Benali', email: 'nadia@trinity.com', role: 'manager' },
      });
      const outsider = await prisma.user.create({
        data: { firstName: 'Camille', lastName: 'Durand', email: 'x9q.camille@trinity.com' },
      });
      return { manager: { id: nadia.id, role: 'manager' as const }, outsider };
    };

    it('never lets a manager find someone outside their teams by a fragment of their email', async () => {
      const { manager } = await setup();

      const result = await listUsers(manager, { page: 1, limit: 20, search: 'x9q' });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('lets the admin find the same user by a fragment of their email', async () => {
      const { outsider } = await setup();

      const result = await listUsers(admin, { page: 1, limit: 20, search: 'x9q' });

      expect(result.data.map(user => user.id)).toEqual([outsider.id]);
    });

    it('still lets a manager find someone outside their teams by name, with the reduced profile', async () => {
      const { manager, outsider } = await setup();

      const result = await listUsers(manager, { page: 1, limit: 20, search: 'durand' });

      expect(result.data).toEqual([{ id: outsider.id, firstName: 'Camille', lastName: 'Durand', role: 'employee' }]);
    });
  });
});

// What the mocks cannot prove: the unique constraint, how Prisma treats undefined and null,
// the deletedAt filter next to the id in findUnique, and the real team membership query
describe('updateUser (PostgreSQL)', () => {
  const body = (email: string) => ({ firstName: 'Jean', lastName: 'Dupont', email });
  const stored = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  it("turns another user's email into a 409 and leaves the account unchanged", async () => {
    await prisma.user.create({ data: body('taken@trinity.com') });
    const user = await prisma.user.create({ data: body('jean@trinity.com') });

    const err = await updateUser(admin, user.id, body('taken@trinity.com')).catch(e => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect((await stored(user.id)).email).toBe('jean@trinity.com');
  });

  it('accepts a user sending back their own email', async () => {
    const user = await prisma.user.create({ data: body('jean@trinity.com') });

    await updateUser(admin, user.id, { ...body('jean@trinity.com'), firstName: 'Jeanne' });

    expect((await stored(user.id)).firstName).toBe('Jeanne');
  });

  it('keeps the stored phone number when the body leaves it out', async () => {
    const user = await prisma.user.create({ data: { ...body('jean@trinity.com'), phoneNumber: '+33612345678' } });

    await updateUser(admin, user.id, { ...body('jean@trinity.com'), lastName: 'Durand' });

    expect(await stored(user.id)).toMatchObject({ lastName: 'Durand', phoneNumber: '+33612345678' });
  });

  it('clears the phone number when the body sends null', async () => {
    const user = await prisma.user.create({ data: { ...body('jean@trinity.com'), phoneNumber: '+33612345678' } });

    await updateUser(admin, user.id, { ...body('jean@trinity.com'), phoneNumber: null });

    expect((await stored(user.id)).phoneNumber).toBeNull();
  });

  it("keeps a manager's role when the admin edits the profile without a role", async () => {
    const manager = await prisma.user.create({ data: { ...body('nadia@trinity.com'), role: 'manager' } });

    await updateUser(admin, manager.id, { ...body('nadia@trinity.com'), firstName: 'Nadia' });

    expect((await stored(manager.id)).role).toBe('manager');
  });

  it('answers 404 for an anonymized account, in GET and in PUT', async () => {
    const gone = await prisma.user.create({ data: { ...body('gone@trinity.com'), deletedAt: new Date() } });

    await expect(getUser(admin, gone.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateUser(admin, gone.id, body('gone@trinity.com'))).rejects.toMatchObject({ status: 404 });
  });

  it('lets a manager read another manager of their team, but never edit them', async () => {
    const nadia = await prisma.user.create({ data: { ...body('nadia@trinity.com'), role: 'manager' } });
    const paul = await prisma.user.create({ data: { ...body('paul@trinity.com'), role: 'manager' } });
    await prisma.team.create({
      data: { name: 'Support N1', managerId: nadia.id, members: { create: { userId: paul.id } } },
    });
    const caller = { id: nadia.id, role: 'manager' as const };

    // The real membership query sees Paul in Nadia's team: full profile
    expect(await getUser(caller, paul.id)).toMatchObject({
      email: 'paul@trinity.com',
      teams: [{ name: 'Support N1' }],
    });

    await expect(updateUser(caller, paul.id, { ...body('paul@trinity.com'), lastName: 'Renamed' })).rejects.toMatchObject({
      status: 403,
    });
    expect((await stored(paul.id)).lastName).toBe('Dupont');
  });

  it("never lets a manager change the email of an admin who is a member of their team", async () => {
    const nadia = await prisma.user.create({ data: { ...body('nadia@trinity.com'), role: 'manager' } });
    const root = await prisma.user.create({ data: { ...body('root@trinity.com'), role: 'admin' } });
    // Created directly: the membership routes are not on this branch
    await prisma.team.create({
      data: { name: 'Support N1', managerId: nadia.id, members: { create: { userId: root.id } } },
    });
    const caller = { id: nadia.id, role: 'manager' as const };

    // Account takeover attempt: a new email, then "forgot password" on it
    await expect(updateUser(caller, root.id, body('nadia.perso@trinity.com'))).rejects.toMatchObject({
      status: 403,
    });
    expect((await stored(root.id)).email).toBe('root@trinity.com');
  });

  it('lets the admin send back their own profile with role admin', async () => {
    const root = await prisma.user.create({ data: { ...body('root@trinity.com'), role: 'admin' } });
    const caller = { id: root.id, role: 'admin' as const };

    await updateUser(caller, 'me', { ...body('root@trinity.com'), phoneNumber: '+33612345678', role: 'admin' });

    expect(await stored(root.id)).toMatchObject({ role: 'admin', phoneNumber: '+33612345678' });
  });

  it('never lets the admin promote an employee to admin', async () => {
    const jean = await prisma.user.create({ data: body('jean@trinity.com') });

    await expect(updateUser(admin, jean.id, { ...body('jean@trinity.com'), role: 'admin' })).rejects.toMatchObject({
      status: 400,
    });
    expect((await stored(jean.id)).role).toBe('employee');
  });

  it('never rewrites an account anonymized between the lookup and the update (404)', async () => {
    const gone = await prisma.user.create({
      data: { firstName: 'Utilisateur', lastName: 'supprimé', email: 'deleted-1@trinity.invalid', deletedAt: new Date() },
    });
    // The lookup ran before the anonymization: it still saw an active employee
    const lookup = vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({ role: 'employee' } as never);

    await expect(updateUser(admin, gone.id, body('jean@trinity.com'))).rejects.toMatchObject({ status: 404 });
    expect(await stored(gone.id)).toMatchObject({ lastName: 'supprimé', email: 'deleted-1@trinity.invalid' });
    lookup.mockRestore();
  });
});

