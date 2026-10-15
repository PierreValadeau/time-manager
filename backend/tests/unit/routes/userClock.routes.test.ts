import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UserRole } from '@prisma/client';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';
import { apiLimiter, USER_LIMIT_PER_MINUTE, userLimiter } from '../../../src/middlewares/rateLimit';

// The real app (middlewares, routes, controllers, services), with the database mocked
vi.mock('../../../src/lib/prisma', () => ({
  default: {
    user: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    clock: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

const findUserMock = prisma.user.findUnique as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;
const findFirstMock = prisma.clock.findFirst as unknown as Mock;
const findManyMock = prisma.clock.findMany as unknown as Mock;
const countMock = prisma.clock.count as unknown as Mock;

const SECRET = 'test-secret-that-is-at-least-32-characters';
const NOW = new Date('2026-10-07T16:00:00Z');

// Camille is in Nadia's team; Bruno is in no team of Nadia's
const CAMILLE = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const NADIA = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const UNKNOWN = '55555555-5555-4555-8555-555555555555';

const dbClock = (id: string, clockIn: string, clockOut: string | null = null) => ({
  id,
  userId: CAMILLE,
  clockIn: new Date(clockIn),
  clockOut: clockOut ? new Date(clockOut) : null,
  correctedById: null,
  correctionReason: null,
  createdAt: new Date(clockIn),
  updatedAt: new Date(clockIn),
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

beforeEach(async () => {
  vi.clearAllMocks();
  // The limiter keeps its counters across tests: every test starts with a fresh quota
  await Promise.all([CAMILLE, BRUNO, NADIA, ADMIN].map(id => userLimiter.resetKey(`user:${id}`)));
  await apiLimiter.resetKey('127.0.0.1');
  // Only Date is faked: timers stay real so fetch and the server keep working
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubEnv('JWT_SECRET', SECRET);
  vi.stubEnv('APP_TIMEZONE', 'Europe/Paris');
  findUserMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === UNKNOWN ? null : { id: where.id }
  );
  findMembershipMock.mockImplementation(
    async ({ where }: { where: { userId: string; team: { managerId: string } } }) =>
      where.userId === CAMILLE && where.team.managerId === NADIA ? { teamId: 'team-id' } : null
  );
  findFirstMock.mockResolvedValue(null);
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Caller = { id: string; role: UserRole } | null;

const camille: Caller = { id: CAMILLE, role: 'employee' };
const bruno: Caller = { id: BRUNO, role: 'employee' };
const nadia: Caller = { id: NADIA, role: 'manager' };
const admin: Caller = { id: ADMIN, role: 'admin' };

const get = async (caller: Caller, path: string) => {
  const headers: Record<string, string> = {};
  if (caller) headers.cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken(caller)}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, { headers });
  return { status: res.status, body: await res.json() };
};

describe('GET /users/:id/clocks/current and /users/:id/clocks: access', () => {
  const paths = (id: string) => [
    `/users/${id}/clocks/current`,
    `/users/${id}/clocks`,
    `/users/${id}/clocks/summary?from=2026-10-05&to=2026-10-11`,
  ];

  it.each(paths(CAMILLE))('answers 401 without session (%s)', async (path) => {
    const res = await get(null, path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(paths(CAMILLE))('lets an employee read their own clocks (%s)', async (path) => {
    expect((await get(camille, path)).status).toBe(200);
  });

  it('resolves the "me" alias to the caller', async () => {
    expect((await get(camille, '/users/me/clocks/current')).status).toBe(200);
    expect((await get(camille, '/users/me/clocks')).status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { userId: CAMILLE, clockOut: null } });
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: CAMILLE, clockIn: undefined } }));
  });

  it.each(paths(CAMILLE))('answers 403 to another employee, without any lookup (%s)', async (path) => {
    const res = await get(bruno, path);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it.each(paths(CAMILLE))('lets the manager of the employee read (%s)', async (path) => {
    expect((await get(nadia, path)).status).toBe(200);
  });

  it.each(paths(BRUNO))('answers 403 to a manager outside their teams (%s)', async (path) => {
    const res = await get(nadia, path);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(paths(UNKNOWN))('answers 404 for an unknown user (%s)', async (path) => {
    const res = await get(nadia, path);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(paths(UNKNOWN))('answers 404 to the admin for an unknown user (%s)', async (path) => {
    const res = await get(admin, path);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it.each(paths(NADIA))('lets a manager read their own clocks, without any lookup (%s)', async (path) => {
    expect((await get(nadia, path)).status).toBe(200);
    expect(findUserMock).not.toHaveBeenCalled();
    expect(findMembershipMock).not.toHaveBeenCalled();
  });

  it.each(paths(BRUNO))('lets the admin read anyone (%s)', async (path) => {
    expect((await get(admin, path)).status).toBe(200);
  });

  it.each(paths('not-a-uuid'))('answers 400 on an invalid id (%s)', async (path) => {
    const res = await get(camille, path);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /users/:id/clocks/current', () => {
  it('answers null without an open session', async () => {
    const res = await get(camille, `/users/${CAMILLE}/clocks/current`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(findFirstMock).toHaveBeenCalledWith({ where: { userId: CAMILLE, clockOut: null } });
  });

  it('answers the open session', async () => {
    findFirstMock.mockResolvedValue(dbClock('open-id', '2026-10-07T07:00:00Z'));

    const res = await get(camille, `/users/${CAMILLE}/clocks/current`);

    expect(res.body).toEqual({
      id: 'open-id',
      userId: CAMILLE,
      clockIn: '2026-10-07T07:00:00.000Z',
      clockOut: null,
      workedMinutes: null,
      status: 'open',
    });
  });

  it('flags a forgotten session as anomaly, so the front offers to clock in', async () => {
    findFirstMock.mockResolvedValue(dbClock('old-id', '2026-10-06T07:00:00Z'));
    const res = await get(camille, `/users/${CAMILLE}/clocks/current`);
    expect(res.body).toMatchObject({ id: 'old-id', status: 'anomaly' });
  });
});

describe('GET /users/:id/clocks', () => {
  it('answers a paginated list, most recent first, with the defaults', async () => {
    findManyMock.mockResolvedValue([
      dbClock('b', '2026-10-07T07:00:00Z'),
      dbClock('a', '2026-10-06T07:00:00Z', '2026-10-06T15:30:00Z'),
    ]);
    countMock.mockResolvedValue(2);

    const res = await get(camille, `/users/${CAMILLE}/clocks`);

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
    expect(res.body.data.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
      ['b', 'open'],
      ['a', 'closed'],
    ]);
    expect(res.body.data[1].workedMinutes).toBe(510);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: CAMILLE, clockIn: undefined },
      orderBy: [{ clockIn: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
  });

  it('applies page and limit', async () => {
    countMock.mockResolvedValue(45);
    const res = await get(camille, `/users/${CAMILLE}/clocks?page=3&limit=10`);
    expect(res.body.meta).toEqual({ page: 3, limit: 10, total: 45 });
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it('filters on local days from and to, both inclusive', async () => {
    await get(camille, `/users/${CAMILLE}/clocks?from=2026-10-05&to=2026-10-11`);

    // Paris is UTC+2 in October: the local day starts at 22:00 UTC the day before
    const range = { gte: new Date('2026-10-04T22:00:00Z'), lt: new Date('2026-10-11T22:00:00Z') };
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: CAMILLE, clockIn: range } }));
    expect(countMock).toHaveBeenCalledWith({ where: { userId: CAMILLE, clockIn: range } });
  });

  it('filters on the status computed by sessionStatus', async () => {
    findManyMock.mockResolvedValue([
      dbClock('open', '2026-10-07T07:00:00Z'),
      dbClock('closed', '2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'),
      dbClock('forgotten', '2026-10-05T07:00:00Z', '2026-10-06T06:00:00Z'),
    ]);

    const res = await get(nadia, `/users/${CAMILLE}/clocks?status=anomaly`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual(['forgotten']);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    // Every matching row is read, then paginated in memory
    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: CAMILLE, clockIn: undefined },
      orderBy: [{ clockIn: 'desc' }, { id: 'desc' }],
    });
    expect(countMock).not.toHaveBeenCalled();
  });

  it.each([
    ['open', ['open']],
    ['closed', ['closed']],
  ])('filters on status=%s', async (status, ids) => {
    findManyMock.mockResolvedValue([
      dbClock('open', '2026-10-07T07:00:00Z'),
      dbClock('closed', '2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'),
      dbClock('forgotten', '2026-10-05T07:00:00Z', '2026-10-06T06:00:00Z'),
    ]);
    const res = await get(camille, `/users/${CAMILLE}/clocks?status=${status}`);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual(ids);
  });

  it('combines status with from and to, reading the whole range without skip nor take', async () => {
    await get(camille, `/users/${CAMILLE}/clocks?status=anomaly&from=2026-10-05&to=2026-10-11&page=2`);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        userId: CAMILLE,
        clockIn: { gte: new Date('2026-10-04T22:00:00Z'), lt: new Date('2026-10-11T22:00:00Z') },
      },
      orderBy: [{ clockIn: 'desc' }, { id: 'desc' }],
    });
  });

  it.each([
    ['from=2026-10-11&to=2026-10-05', 'to'],
    ['from=05/10/2026', 'from'],
    ['to=2026-02-30', 'to'],
    ['status=late', 'status'],
    ['limit=101', 'limit'],
    ['page=0', 'page'],
  ])('answers 400 on invalid query %s', async (query, field) => {
    const res = await get(camille, `/users/${CAMILLE}/clocks?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe('GET /users/:id/clocks/summary', () => {
  const summary = (query: string) => get(camille, `/users/me/clocks/summary?${query}`);

  it('answers the summary of the contract, grouped by local day by default', async () => {
    findManyMock.mockResolvedValue([
      dbClock('a', '2026-10-05T07:00:00Z', '2026-10-05T11:00:00Z'), // 240
      dbClock('b', '2026-10-05T12:00:00Z', '2026-10-05T15:30:00Z'), // 210
      dbClock('c', '2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'), // 480
    ]);

    const res = await summary('from=2026-10-05&to=2026-10-11');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: CAMILLE,
      from: '2026-10-05',
      to: '2026-10-11',
      groupBy: 'day',
      totalMinutes: 930,
      periods: [
        {
          period: '2026-10-05',
          workedMinutes: 450,
          firstClockIn: '2026-10-05T07:00:00.000Z',
          lastClockOut: '2026-10-05T15:30:00.000Z',
          sessions: 2,
          status: 'closed',
        },
        {
          period: '2026-10-06',
          workedMinutes: 480,
          firstClockIn: '2026-10-06T07:00:00.000Z',
          lastClockOut: '2026-10-06T15:00:00.000Z',
          sessions: 1,
          status: 'closed',
        },
      ],
    });
  });

  it('reads the sessions whose clock-in falls in the local days, oldest first', async () => {
    await summary('from=2026-10-05&to=2026-10-11');
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        userId: CAMILLE,
        clockIn: { gte: new Date('2026-10-04T22:00:00Z'), lt: new Date('2026-10-11T22:00:00Z') },
      },
      select: { clockIn: true, clockOut: true, correctedById: true },
      orderBy: { clockIn: 'asc' },
    });
  });

  it('groups by ISO week', async () => {
    findManyMock.mockResolvedValue([
      dbClock('a', '2026-10-05T07:00:00Z', '2026-10-05T15:00:00Z'),
      dbClock('b', '2026-10-12T07:00:00Z', '2026-10-12T15:00:00Z'),
    ]);
    const res = await summary('from=2026-10-05&to=2026-10-18&groupBy=week');
    expect(res.body.groupBy).toBe('week');
    expect(res.body.periods.map((p: { period: string }) => p.period)).toEqual(['2026-W41', '2026-W42']);
  });

  it('counts an open session until now and flags its period as open', async () => {
    findManyMock.mockResolvedValue([dbClock('open', '2026-10-07T12:00:00Z')]); // NOW = 16:00Z
    const res = await summary('from=2026-10-07&to=2026-10-07');
    expect(res.body.totalMinutes).toBe(240);
    expect(res.body.periods[0]).toMatchObject({ workedMinutes: 240, lastClockOut: null, status: 'open' });
  });

  it('leaves anomaly sessions out of the totals', async () => {
    findManyMock.mockResolvedValue([
      dbClock('forgotten', '2026-10-05T07:00:00Z', '2026-10-06T06:00:00Z'),
      dbClock('ok', '2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'),
    ]);
    const res = await summary('from=2026-10-05&to=2026-10-11');
    expect(res.body.totalMinutes).toBe(480);
    expect(res.body.periods.map((p: { period: string }) => p.period)).toEqual(['2026-10-06']);
  });

  it('answers an empty summary without sessions', async () => {
    const res = await summary('from=2026-10-05&to=2026-10-11');
    expect(res.body).toMatchObject({ totalMinutes: 0, periods: [] });
  });

  it('accepts 366 days, both bounds included (a leap year)', async () => {
    expect((await summary('from=2028-01-01&to=2028-12-31')).status).toBe(200);
  });

  it.each([
    ['to=2026-10-11', 'from'],
    ['from=2026-10-05', 'to'],
    ['from=2026-10-11&to=2026-10-05', 'to'],
    ['from=2026-01-01&to=2027-01-02', 'to'], // 367 days, both bounds included
    ['from=2026-10-05&to=2026-10-11&groupBy=month', 'groupBy'],
    ['from=2026-10-05T00:00:00Z&to=2026-10-11', 'from'],
  ])('answers 400 on invalid query %s', async (query, field) => {
    const res = await summary(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe('GET /users/:id/clocks...: rate limiting', () => {
  it('answers 429 RATE_LIMITED past the limit for the same user, on every clock read route', async () => {
    for (let i = 0; i < USER_LIMIT_PER_MINUTE; i++) {
      expect((await get(camille, '/users/me/clocks/current')).status).toBe(200);
    }
    const res = await get(camille, '/users/me/clocks/summary?from=2026-10-05&to=2026-10-11');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Another user keeps their own quota
    expect((await get(bruno, '/users/me/clocks/current')).status).toBe(200);
  });
});
