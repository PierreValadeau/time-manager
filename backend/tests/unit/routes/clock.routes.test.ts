import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';
import { userLimiter } from '../../../src/middlewares/rateLimit';

// The real app (middlewares, route, controller, service), with the database mocked
vi.mock('../../../src/lib/prisma', () => {
  const client = {
    clock: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return { default: client };
});

const findFirstMock = prisma.clock.findFirst as unknown as Mock;
const updateManyMock = prisma.clock.updateMany as unknown as Mock;
const createMock = prisma.clock.create as unknown as Mock;
const findClockMock = prisma.clock.findUnique as unknown as Mock;
const updateMock = prisma.clock.update as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;
const queryRawMock = prisma.$queryRaw as unknown as Mock;

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

// PUT /clocks/:id. Camille is in Nadia's team; Bruno is in no team of Nadia's
const CAMILLE = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const NADIA = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const CAMILLE_CLOCK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRUNO_CLOCK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NADIA_CLOCK = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNKNOWN_CLOCK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const OWNERS: Record<string, string> = { [CAMILLE_CLOCK]: CAMILLE, [BRUNO_CLOCK]: BRUNO, [NADIA_CLOCK]: NADIA };

type Caller = { id: string; role: 'employee' | 'manager' | 'admin' } | null;
const camille: Caller = { id: CAMILLE, role: 'employee' };
const nadia: Caller = { id: NADIA, role: 'manager' };
const admin: Caller = { id: ADMIN, role: 'admin' };

const correction = {
  clockIn: '2026-10-06T07:00:00Z',
  clockOut: '2026-10-06T15:30:00Z',
  reason: 'Oubli de pointage au départ',
};

const putClock = async (caller: Caller, id: string, payload: unknown = correction) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (caller) headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken(caller)}`;
  const res = await fetch(`${baseUrl}/api/v1/clocks/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
};

describe('PUT /api/v1/clocks/:id', () => {
  beforeEach(async () => {
    await Promise.all([CAMILLE, NADIA, ADMIN].map(id => userLimiter.resetKey(`user:${id}`)));
    findClockMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      OWNERS[where.id] ? { userId: OWNERS[where.id] } : null
    );
    findMembershipMock.mockImplementation(
      async ({ where }: { where: { userId: string; team: { managerId: string } } }) =>
        // Nadia manages Camille's team but is a member of no team herself
        where.userId === CAMILLE && where.team.managerId === NADIA ? { teamId: 'team-id' } : null
    );
    findFirstMock.mockResolvedValue(null);
    queryRawMock.mockResolvedValue([]);
    updateMock.mockImplementation(async ({ where, data }) => ({
      ...dbClock(OWNERS[where.id], data.clockIn),
      id: where.id,
      ...data,
    }));
  });

  it('answers 401 without session', async () => {
    const res = await putClock(null, CAMILLE_CLOCK);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 403 to an employee, without any lookup, even on an unknown session', async () => {
    for (const id of [CAMILLE_CLOCK, UNKNOWN_CLOCK]) {
      const res = await putClock(camille, id);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // Even with an invalid body: the role is checked first
    expect((await putClock(camille, CAMILLE_CLOCK, {})).status).toBe(403);
    expect(findClockMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lets the manager of the employee correct, and stores author and reason', async () => {
    const res = await putClock(nadia, CAMILLE_CLOCK);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: CAMILLE_CLOCK,
      userId: CAMILLE,
      clockIn: correction.clockIn.replace('Z', '.000Z'),
      clockOut: correction.clockOut.replace('Z', '.000Z'),
      workedMinutes: 510,
      status: 'closed',
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: CAMILLE_CLOCK },
      data: {
        clockIn: new Date(correction.clockIn),
        clockOut: new Date(correction.clockOut),
        correctedById: NADIA,
        correctionReason: correction.reason,
      },
    });
  });

  it('lets the admin correct any session, a manager\'s included', async () => {
    const res = await putClock(admin, NADIA_CLOCK);
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correctedById: ADMIN }) }));
  });

  it('answers 403 to a manager outside the teams of the employee', async () => {
    const res = await putClock(nadia, BRUNO_CLOCK);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lets a manager correct their own session, even outside any team', async () => {
    const res = await putClock(nadia, NADIA_CLOCK);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(NADIA);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correctedById: NADIA }) })
    );
  });

  it('answers 404 for an unknown session', async () => {
    const res = await putClock(nadia, UNKNOWN_CLOCK);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 400 for an id that is not a UUID', async () => {
    const res = await putClock(nadia, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'id', issue: 'invalid_format' }]);
  });

  it.each([
    ['missing', { clockIn: correction.clockIn, clockOut: correction.clockOut }],
    ['blank', { ...correction, reason: '   ' }],
  ])('answers 400 when the reason is %s', async (_case, payload) => {
    const res = await putClock(nadia, CAMILLE_CLOCK, payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'reason' })]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['before', '2026-10-06T06:00:00Z'],
    ['equal to', correction.clockIn],
  ])('answers 400 when clockOut is %s clockIn', async (_case, clockOut) => {
    const res = await putClock(nadia, CAMILLE_CLOCK, { ...correction, clockOut });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'clockOut', issue: 'custom' }]);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('answers 400 when clockOut is null: a correction closes the session', async () => {
    const res = await putClock(nadia, CAMILLE_CLOCK, { ...correction, clockOut: null });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'clockOut' })]);
  });

  it('answers 400 when clockOut is in the future (server time)', async () => {
    const res = await putClock(nadia, CAMILLE_CLOCK, {
      ...correction,
      clockIn: '2026-10-07T08:00:00Z',
      clockOut: '2026-10-07T16:00:01Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'clockOut', issue: 'too_big' }],
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('answers 409 when the session would overlap another one', async () => {
    findFirstMock.mockResolvedValue({ id: 'other-clock' });

    const res = await putClock(nadia, CAMILLE_CLOCK);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('turns a forgotten session into a closed one counted in full, even beyond 14 h', async () => {
    const res = await putClock(nadia, CAMILLE_CLOCK, { ...correction, clockOut: '2026-10-06T22:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'closed', workedMinutes: 900 });
  });
});
