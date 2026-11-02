import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/client';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

// with only the database mocked
vi.mock('../../../src/lib/prisma', () => ({
  default: { 
    user: { findUnique: vi.fn() }, 
    team: { create: vi.fn(),  findMany: vi.fn(), count: vi.fn() } },
}));

const findUserMock = prisma.user.findUnique as unknown as Mock;
const createTeamMock = prisma.team.create as unknown as Mock;
const findTeamsMock = prisma.team.findMany as unknown as Mock;
const countTeamsMock = prisma.team.count as unknown as Mock;

const SECRET = 'test-secret-that-is-at-least-32-characters';
// Zod expects a real UUID v4 for managerId
const OTHER_MANAGER_ID = '3f1c2b9e-8a4d-4c6e-9b2a-1d5e7f8a9b0c';
const body = { name: 'Team A' };

const dbTeam = {
  id: 'team-id',
  name: 'Team A',
  description: null,
  createdAt: new Date('2026-10-30T08:00:00Z'),
  updatedAt: new Date('2026-10-30T08:00:00Z'),
  manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
  members: [],
};

// A row as findMany returns it with teamListSelect: _count instead of members
const dbListTeam = {
  id: 'team-id',
  name: 'Team A',
  description: null,
  createdAt: new Date('2026-10-30T08:00:00Z'),
  updatedAt: new Date('2026-10-30T08:00:00Z'),
  manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
  _count: { members: 3 },
};



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
  findUserMock.mockResolvedValue({ role: 'manager', deletedAt: null });
  createTeamMock.mockResolvedValue(dbTeam);
  findTeamsMock.mockResolvedValue([dbListTeam]);
  countTeamsMock.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// POST /api/v1/teams as the given role (or without session)
const postTeam = async (role: 'employee' | 'manager' | 'admin' | null, payload: unknown = body) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) {
    headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ id: `${role}-id`, role })}`;
  }
  const res = await fetch(`${baseUrl}/api/v1/teams`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

const getTeams = async (role: 'employee' | 'manager' | 'admin' | null, query = '') => {
  const headers: Record<string, string> = {};
  if (role) {
    headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ id: `${role}-id`, role })}`;
  }
  const res = await fetch(`${baseUrl}/api/v1/teams${query}`, { headers });
  return { status: res.status, body: await res.json() };
};


describe('POST /api/v1/teams: access', () => {
  it('answers 401 without session', async () => {
    const res = await postTeam(null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it('answers 403 to an employee', async () => {
    const res = await postTeam('employee');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it('checks the role before the body (403, not 400, for an employee with an invalid body)', async () => {
    expect((await postTeam('employee', {})).status).toBe(403);
  });
});

describe('POST /api/v1/teams: validation', () => {
  it('answers 400 when the name is missing', async () => {
    const res = await postTeam('manager', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'name' })],
    });
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it('answers 400 when managerId is not a UUID', async () => {
    const res = await postTeam('admin', { ...body, managerId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'managerId' })]);
  });

  it('answers 400 when the admin sends no managerId', async () => {
    const res = await postTeam('admin');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'managerId' })]);
    expect(createTeamMock).not.toHaveBeenCalled();
  });

  it('answers 400 when managerId is not an active manager', async () => {
    findUserMock.mockResolvedValue({ role: 'employee', deletedAt: null });
    const res = await postTeam('admin', { ...body, managerId: OTHER_MANAGER_ID });
    expect(res.status).toBe(400);
    expect(createTeamMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/teams: creation', () => {
  it('lets a manager create a team they manage (201)', async () => {
    const res = await postTeam('manager');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
        id: 'team-id',
        name: 'Team A',
        description: null,
        manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
        members: [],
        createdAt: '2026-10-30T08:00:00.000Z',
        updatedAt: '2026-10-30T08:00:00.000Z',
    });

    expect(createTeamMock.mock.lastCall![0].data).toEqual({ name: 'Team A', managerId: 'manager-id' });
  });

  it('lets the admin create a team for another manager (201)', async () => {
    const res = await postTeam('admin', { ...body, managerId: OTHER_MANAGER_ID });
    expect(res.status).toBe(201);
    expect(createTeamMock.mock.lastCall![0].data.managerId).toBe(OTHER_MANAGER_ID);
  });

  it('trims the name before saving it', async () => {
    await postTeam('manager', { name: '  Team A  ' });
    expect(createTeamMock.mock.lastCall![0].data.name).toBe('Team A');
  });

  it('answers 409 when the name is already taken', async () => {
    createTeamMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['name'] },
      }),
    );
    const res = await postTeam('manager');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

// Arguments passed to prisma.team.findMany on the last call
const findManyArgs = () => findTeamsMock.mock.lastCall![0];

describe('GET /api/v1/teams: access', () => {
  it('answers 401 without session', async () => {
    const res = await getTeams(null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(findTeamsMock).not.toHaveBeenCalled();
  });

  it('lets an employee list teams, filtered on their memberships (200)', async () => {
    const res = await getTeams('employee');
    expect(res.status).toBe(200);
    expect(findManyArgs().where).toEqual({ members: { some: { userId: 'employee-id' } } });
  });

  it('does not filter for a manager (200)', async () => {
    const res = await getTeams('manager');
    expect(res.status).toBe(200);
    expect(findManyArgs().where).toEqual({});
  });
});

describe('GET /api/v1/teams: response', () => {
  it('answers with the paginated format of the contract', async () => {
    const res = await getTeams('admin');
    expect(res.body).toEqual({
      data: [
        {
          id: 'team-id',
          name: 'Team A',
          description: null,
          manager: { id: 'manager-id', firstName: 'Nadia', lastName: 'Benali' },
          memberCount: 3,
          createdAt: '2026-10-30T08:00:00.000Z',
          updatedAt: '2026-10-30T08:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
  });
});

describe('GET /api/v1/teams: query', () => {
  it('uses page 1 and limit 20 by default', async () => {
    await getTeams('admin');
    expect(findManyArgs()).toMatchObject({ skip: 0, take: 20 });
  });

  it('turns page and limit into numbers and skips the previous pages', async () => {
    const res = await getTeams('admin', '?page=3&limit=5');
    expect(findManyArgs()).toMatchObject({ skip: 10, take: 5 });
    expect(res.body.meta).toMatchObject({ page: 3, limit: 5 });
  });

  it('searches the name, trimmed and case-insensitive', async () => {
    await getTeams('admin', '?search=%20sup%20');
    expect(findManyArgs().where).toEqual({ name: { contains: 'sup', mode: 'insensitive' } });
  });

  it('answers 400 above the maximum limit of 100', async () => {
    const res = await getTeams('admin', '?limit=500');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'limit' })]);
    expect(findTeamsMock).not.toHaveBeenCalled();
  });

  it('answers 400 for page 0', async () => {
    expect((await getTeams('admin', '?page=0')).status).toBe(400);
  });

  it('answers 400 for an empty search', async () => {
    expect((await getTeams('admin', '?search=')).status).toBe(400);
  });
});

