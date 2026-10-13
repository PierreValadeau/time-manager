import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

// The real app (middlewares, route, controller, service), with the database mocked
vi.mock('../../../src/lib/prisma', () => {
  const client = {
    clock: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return { default: client };
});

const findFirstMock = prisma.clock.findFirst as unknown as Mock;
const updateManyMock = prisma.clock.updateMany as unknown as Mock;
const createMock = prisma.clock.create as unknown as Mock;

const SECRET = 'test-secret-that-is-at-least-32-characters';
const NOW = new Date('2026-10-07T16:00:00Z');

const dbClock = (userId: string, clockIn: Date) => ({
  id: 'clock-id',
  userId,
  clockIn,
  clockOut: null,
  correctedById: null,
  correctionReason: null,
  createdAt: clockIn,
  updatedAt: clockIn,
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
  // Only Date is faked: timers stay real so fetch and the server keep working
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubEnv('JWT_SECRET', SECRET);
  findFirstMock.mockResolvedValue(null);
  updateManyMock.mockResolvedValue({ count: 1 });
  createMock.mockImplementation(({ data }) => Promise.resolve(dbClock(data.userId, data.clockIn)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// POST /api/v1/clocks as the given role (or without session)
const postClock = async (role: 'employee' | 'manager' | 'admin' | null, payload?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (role) {
    headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ id: `${role}-id`, role })}`;
  }
  const res = await fetch(`${baseUrl}/api/v1/clocks`, {
    method: 'POST',
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('POST /api/v1/clocks: access', () => {
  it('answers 401 without session', async () => {
    const res = await postClock(null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('answers 403 to the admin, who never clocks', async () => {
    const res = await postClock('admin');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each(['employee', 'manager'] as const)('lets a %s clock', async (role) => {
    const res = await postClock(role);
    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/clocks: toggle', () => {
  it('answers 201 with the new session when clocking in', async () => {
    const res = await postClock('employee');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'clock-id',
      userId: 'employee-id',
      clockIn: NOW.toISOString(),
      clockOut: null,
      workedMinutes: null,
      status: 'open',
    });
  });

  it('answers 200 with the closed session when clocking out', async () => {
    findFirstMock.mockResolvedValue(dbClock('employee-id', new Date('2026-10-07T08:00:00Z')));

    const res = await postClock('employee');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clockOut: NOW.toISOString(), workedMinutes: 480, status: 'closed' });
  });

  it('ignores a time sent by the client', async () => {
    const res = await postClock('employee', { clockIn: '2020-01-01T00:00:00Z', userId: 'someone-else' });

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith({ data: { userId: 'employee-id', clockIn: NOW } });
  });

  it('reads the anomaly threshold from ANOMALY_THRESHOLD_HOURS', async () => {
    vi.stubEnv('ANOMALY_THRESHOLD_HOURS', '6');
    // Open for 8 h: a forgotten session with a threshold of 6 h, so a new clock-in
    findFirstMock.mockResolvedValue(dbClock('employee-id', new Date('2026-10-07T08:00:00Z')));

    const res = await postClock('employee');

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalled();
  });

  it('answers 409 when a concurrent request got there first', async () => {
    findFirstMock.mockResolvedValue(dbClock('employee-id', new Date('2026-10-07T08:00:00Z')));
    updateManyMock.mockResolvedValue({ count: 0 });

    const res = await postClock('employee');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});
