import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/client';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

// Integration test: the real app (middlewares, route, controller, service) over HTTP,
// with only the database mocked
vi.mock('../../../src/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() }, team: { create: vi.fn() } },
}));

const findUserMock = prisma.user.findUnique as unknown as Mock;
const createTeamMock = prisma.team.create as unknown as Mock;

const SECRET = 'test-secret-that-is-at-least-32-characters';
// Zod expects a real UUID v4 for managerId
const OTHER_MANAGER_ID = '3f1c2b9e-8a4d-4c6e-9b2a-1d5e7f8a9b0c';
const body = { name: 'Team A' };

const dbTeam = {
  id: 'team-id',
  name: 'Team A',
  description: null,
  managerId: 'manager-id',
  createdAt: new Date('2026-10-30T08:00:00Z'),
  updatedAt: new Date('2026-10-30T08:00:00Z'),
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
      ...dbTeam,
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
