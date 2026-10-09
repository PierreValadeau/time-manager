import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Prisma } from '@prisma/client';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { sendSetupLink } from '../../../src/services/mail.service';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

// The real app (middlewares, route, controller, service), with the database and the mailer mocked
vi.mock('../../../src/lib/prisma', () => ({ default: { user: { create: vi.fn() } } }));
vi.mock('../../../src/services/mail.service', () => ({ sendSetupLink: vi.fn() }));

const createMock = prisma.user.create as unknown as Mock;
const sendSetupLinkMock = sendSetupLink as unknown as Mock;

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
      }),
    );
    const res = await postUser('manager');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});
