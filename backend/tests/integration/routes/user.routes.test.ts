import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/client';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { sendSetupLink } from '../../../src/services/mail.service';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

// Integration test: the real app (middlewares, route, controller, service) over HTTP,
// with only the database and the mailer mocked
vi.mock('../../../src/lib/prisma', () => ({ default: {
  user: { create: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  team: { findMany: vi.fn() },
  // isManagerOfEmployee (scope.service)
  teamMember: { findFirst: vi.fn() },
} }));
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn() }));

const createMock = prisma.user.create as unknown as Mock;
const sendSetupLinkMock = sendSetupLink as unknown as Mock;
const findUsersMock = prisma.user.findMany as unknown as Mock; 
const countUsersMock = prisma.user.count as unknown as Mock; 
const findTeamsMock = prisma.team.findMany as unknown as Mock;
const findUserMock = prisma.user.findUnique as unknown as Mock;
const updateMock = prisma.user.update as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;
const SECRET = 'test-secret-that-is-at-least-32-characters';
const body = { firstName: 'Jean', lastName: 'Dupont', email: 'Jean.Dupont@Trinity.com' };

const dbUser = (role: 'employee' | 'manager') => ({
  id: 'new-user-id',
  firstName: 'Jean',
  lastName: 'Dupont',
  email: 'jean.dupont@trinity.com',
  phoneNumber: null,
  role,
  createdAt: new Date('2026-10-09T08:00:00Z'),
  updatedAt: new Date('2026-10-09T08:00:00Z'),
  memberships: [],
});

const listedUser = (id: string, teamIds: string[] = []) => ({
  ...dbUser('employee'),
  id,
  email: `${id}@trinity.com`,
  memberships: teamIds.map(teamId => ({ team: { id: teamId, name: `Team ${teamId}` } })),
});

const getUsers = async (role: 'employee' | 'manager' | 'admin' | null, search = '') => {
  const headers: Record<string, string> = {}; 
  if (role) {
    headers.cookie = `${ACCESS_TOKEN_COOKIE} = ${signAccessToken({ id: `${role}-id`, role })}`; 
  }
  const res = await fetch(`${baseUrl}/api/v1/users${search}`, { headers }); 
  return { status: res.status, body: await res.json() }; 
}

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', SECRET);
  vi.stubEnv('FRONTEND_URL', 'http://front.test');
  createMock.mockResolvedValue(dbUser('employee'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// POST /api/v1/users as the given role (or without session)
const postUser = async (role: 'employee' | 'manager' | 'admin' | null, payload: unknown = body) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) {
    headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ id: `${role}-id`, role })}`;
  }
  const res = await fetch(`${baseUrl}/api/v1/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('POST /api/v1/users: access', () => {
  it('answers 401 without session', async () => {
    const res = await postUser(null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('answers 403 to an employee', async () => {
    const res = await postUser('employee');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('checks the role before the body (403, not 400, for an employee with an invalid body)', async () => {
    expect((await postUser('employee', {})).status).toBe(403);
  });
});

describe('POST /api/v1/users: validation', () => {
  it('answers 400 with the field in error', async () => {
    const res = await postUser('manager', { ...body, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'email' })],
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('refuses the admin role (400)', async () => {
    expect((await postUser('admin', { ...body, role: 'admin' })).status).toBe(400);
  });
});

describe('POST /api/v1/users: creation', () => {
  it('lets a manager create an employee and returns the reduced profile (201)', async () => {
    const res = await postUser('manager');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'new-user-id', firstName: 'Jean', lastName: 'Dupont', role: 'employee' });
    expect(createMock.mock.lastCall![0].data).toMatchObject({
      email: 'jean.dupont@trinity.com',
      role: 'employee',
    });
  });

  it('forbids a manager to create a manager (403)', async () => {
    const res = await postUser('manager', { ...body, role: 'manager' });
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('lets the admin create a manager and returns the full profile (201)', async () => {
    createMock.mockResolvedValue(dbUser('manager'));
    const res = await postUser('admin', { ...body, role: 'manager', phoneNumber: '+33612345678' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'new-user-id',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@trinity.com',
      phoneNumber: null,
      role: 'manager',
      teams: [],
      createdAt: '2026-10-09T08:00:00.000Z',
      updatedAt: '2026-10-09T08:00:00.000Z',
    });
  });

  it('sends the setup link to the new user, never in the response', async () => {
    const res = await postUser('manager');

    expect(sendSetupLinkMock).toHaveBeenCalledWith('jean.dupont@trinity.com', expect.stringContaining('token='));
    expect(JSON.stringify(res.body)).not.toContain('token');
  });

  it('answers 409 when the email is already taken', async () => {
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    );
    const res = await postUser('manager');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('GET /api/v1/users', () => {
  beforeEach(() => {
    findUsersMock.mockResolvedValue([]);
    countUsersMock.mockResolvedValue(0);
    findTeamsMock.mockResolvedValue([]);
  });

  it('answers 401 without session', async () => {
    expect((await getUsers(null)).status).toBe(401);
  });

  it('answers 403 to an employee', async () => {
    expect((await getUsers('employee')).status).toBe(403);
    expect(findUsersMock).not.toHaveBeenCalled();
  });

  it('uses page 1 and limit 20 by default', async () => {
    const res = await getUsers('admin');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 0 });
  });

  it('answers 400 for an unknown role', async () => {
    expect((await getUsers('admin', '?role=boss')).status).toBe(400);
  });

  it('answers 400 when teamId is not a UUID', async () => {
    expect((await getUsers('admin', '?teamId=abc')).status).toBe(400);
  });

  it('answers 400 above the maximum limit of 100', async () => {
    expect((await getUsers('admin', '?limit=101')).status).toBe(400);
  });

  it('hides the email of users outside the manager teams', async () => {
    findUsersMock.mockResolvedValue([listedUser('outsider', ['other-team'])]);
    const res = await getUsers('manager');
    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('email');
    expect(res.body.data[0]).not.toHaveProperty('phoneNumber');
  });
});

// GET and PUT /api/v1/users/:id. The caller of role X has the id "X-id" (see signAccessToken below);
// targets need real UUID v4 ids, or validate() answers 400
const OTHER_ID = 'c0ffee00-0000-4000-8000-000000000001';
const MISSING_ID = 'c0ffee00-0000-4000-8000-000000000404';
const FULL_PROFILE_KEYS = ['createdAt', 'email', 'firstName', 'id', 'lastName', 'phoneNumber', 'role', 'teams', 'updatedAt'];

// A stored user, as Prisma returns it (findUnique and update)
const storedUser = (id: string) => ({ ...dbUser('employee'), id, email: `${id}@trinity.com` });

const cookieFor = (role: 'employee' | 'manager' | 'admin') =>
  `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ id: `${role}-id`, role })}`;

const getUserById = async (role: 'employee' | 'manager' | 'admin' | null, id: string) => {
  const headers: Record<string, string> = role ? { cookie: cookieFor(role) } : {};
  const res = await fetch(`${baseUrl}/api/v1/users/${id}`, { headers });
  return { status: res.status, body: await res.json() };
};

const putUser = async (role: 'employee' | 'manager' | 'admin' | null, id: string, payload: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) headers.cookie = cookieFor(role);
  const res = await fetch(`${baseUrl}/api/v1/users/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('GET and PUT /api/v1/users/:id', () => {
  beforeEach(() => {
    // Every UUID but MISSING_ID exists; nobody is a member of the manager's teams
    findUserMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === MISSING_ID ? null : storedUser(where.id),
    );
    updateMock.mockImplementation(async ({ where }: { where: { id: string } }) => storedUser(where.id));
    findMembershipMock.mockResolvedValue(null);
  });

  describe('GET /api/v1/users/:id', () => {
    it('answers 401 without session', async () => {
      const res = await getUserById(null, 'me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('answers 400 when the id is neither "me" nor a UUID v4, before any lookup', async () => {
      const res = await getUserById('admin', 'not-a-uuid');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'id' }] });
      expect(findUserMock).not.toHaveBeenCalled();
    });

    it('gives an employee their own full profile through "me", without the password hash', async () => {
      const res = await getUserById('employee', 'me');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(FULL_PROFILE_KEYS);
      expect(findUserMock.mock.lastCall![0].where.id).toBe('employee-id');
    });

    it("answers 403 to an employee reading someone else's account", async () => {
      const res = await getUserById('employee', OTHER_ID);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('gives a manager only the reduced profile of a user outside their teams', async () => {
      const res = await getUserById('manager', OTHER_ID);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: OTHER_ID, firstName: 'Jean', lastName: 'Dupont', role: 'employee' });
    });

    it('answers 404 in the contract error format for a missing account', async () => {
      const res = await getUserById('admin', MISSING_ID);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    });
  });

  describe('PUT /api/v1/users/:id', () => {
    const payload = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com' };

    it('answers 401 without session', async () => {
      const res = await putUser(null, 'me', payload);
      expect(res.status).toBe(401);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('reports an invalid id and an invalid body in the same 400', async () => {
      const res = await putUser('admin', 'not-a-uuid', { ...payload, email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((detail: { field: string }) => detail.field)).toEqual(
        expect.arrayContaining(['id', 'email']),
      );
    });

    it('refuses the admin role with a 400, before any lookup', async () => {
      const res = await putUser('admin', OTHER_ID, { ...payload, role: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'role' })]);
      expect(findUserMock).not.toHaveBeenCalled();
    });

    it('refuses an empty phone number (null clears it)', async () => {
      const res = await putUser('employee', 'me', { ...payload, phoneNumber: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'phoneNumber' })]);
    });

    it("validates the body before the scope: 400, not 403, for an employee on someone else's account", async () => {
      expect((await putUser('employee', OTHER_ID, {})).status).toBe(400);
    });

    it('lets an employee edit their own account through "me" and returns the full profile', async () => {
      const res = await putUser('employee', 'me', { ...payload, email: '  Jean.DUPONT@Trinity.com ' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(FULL_PROFILE_KEYS);
      expect(updateMock.mock.lastCall![0]).toMatchObject({
        where: { id: 'employee-id' },
        data: { email: 'jean.dupont@trinity.com' },
      });
    });

    it('never writes the fields the body must not change', async () => {
      await putUser('admin', OTHER_ID, { ...payload, passwordHash: 'hash', deletedAt: null, id: OTHER_ID });
      expect(updateMock.mock.lastCall![0].data).toEqual(payload);
    });

    it("answers 403 to a manager changing a member's role, without writing", async () => {
      findMembershipMock.mockResolvedValue({ teamId: 'my-team' });
      const res = await putUser('manager', OTHER_ID, { ...payload, role: 'manager' });

      expect(res.status).toBe(403);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('answers 409 when the email is already taken', async () => {
      updateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        }),
      );
      const res = await putUser('admin', OTHER_ID, payload);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('answers 400 to a JSON body sent without the JSON content type', async () => {
      const res = await fetch(`${baseUrl}/api/v1/users/me`, {
        method: 'PUT',
        headers: { cookie: cookieFor('employee') },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});

