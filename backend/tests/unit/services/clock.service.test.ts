import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import {
  authorizeClockRead,
  clockInRange,
  getClockSummary,
  listSessions,
  toggleClock,
  toSessionDto,
} from '../../../src/services/clock.service';

// No database: the transaction runs its callback on the same mocked client
vi.mock('../../../src/lib/prisma', () => {
  const client = {
    clock: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return { default: client };
});

const findFirstMock = prisma.clock.findFirst as unknown as Mock;
const updateManyMock = prisma.clock.updateMany as unknown as Mock;
const createMock = prisma.clock.create as unknown as Mock;
const findManyMock = prisma.clock.findMany as unknown as Mock;
const countMock = prisma.clock.count as unknown as Mock;
const findUserMock = prisma.user.findUnique as unknown as Mock;
const findMembershipMock = prisma.teamMember.findFirst as unknown as Mock;

const NOW = new Date('2026-10-07T16:00:00Z');
const USER_ID = 'user-id';

const clock = (clockIn: string, clockOut: string | null = null) => ({
  id: 'clock-id',
  userId: USER_ID,
  clockIn: new Date(clockIn),
  clockOut: clockOut ? new Date(clockOut) : null,
  correctedById: null,
  correctionReason: null,
  createdAt: new Date(clockIn),
  updatedAt: new Date(clockIn),
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

beforeEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 1 });
  createMock.mockImplementation(({ data }) => Promise.resolve({ ...clock(data.clockIn.toISOString()), id: 'new-id' }));
});

describe('toggleClock', () => {
  it('clocks in at server time without an open session', async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await toggleClock(USER_ID, NOW, 14);

    expect(createMock).toHaveBeenCalledWith({ data: { userId: USER_ID, clockIn: NOW } });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(result.action).toBe('clockIn');
    expect(result.session).toMatchObject({ id: 'new-id', clockIn: NOW, clockOut: null, workedMinutes: null, status: 'open' });
  });

  it('clocks out the open session at server time', async () => {
    findFirstMock.mockResolvedValue(clock('2026-10-07T07:00:00Z'));

    const result = await toggleClock(USER_ID, NOW, 14);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'clock-id', clockOut: null },
      data: { clockOut: NOW },
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(result.action).toBe('clockOut');
    expect(result.session).toMatchObject({ clockOut: NOW, workedMinutes: 540, status: 'closed' });
  });

  it('only looks for an open session of the caller', async () => {
    findFirstMock.mockResolvedValue(null);
    await toggleClock(USER_ID, NOW, 14);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { userId: USER_ID, clockOut: null } });
  });

  it('closes a forgotten session and clocks in, so the employee is not blocked', async () => {
    // Open since yesterday morning: more than 14 h
    findFirstMock.mockResolvedValue(clock('2026-10-06T07:00:00Z'));

    const result = await toggleClock(USER_ID, NOW, 14);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'clock-id', clockOut: null },
      data: { clockOut: NOW },
    });
    expect(createMock).toHaveBeenCalledWith({ data: { userId: USER_ID, clockIn: NOW } });
    expect(result.action).toBe('clockIn');
    expect(result.session.status).toBe('open');
  });

  it('uses the given anomaly threshold', async () => {
    // Open for 9 h: anomaly with a threshold of 8 h
    findFirstMock.mockResolvedValue(clock('2026-10-07T07:00:00Z'));
    const result = await toggleClock(USER_ID, NOW, 8);
    expect(result.action).toBe('clockIn');
  });

  it('answers 409 when a concurrent request closed the session first', async () => {
    findFirstMock.mockResolvedValue(clock('2026-10-07T07:00:00Z'));
    updateManyMock.mockResolvedValue({ count: 0 });

    const error = await toggleClock(USER_ID, NOW, 14).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('answers 409 when a concurrent request opened a session first', async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockRejectedValue(uniqueViolation());

    await expect(toggleClock(USER_ID, NOW, 14)).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('lets other database errors through', async () => {
    const dbDown = new Error('connection lost');
    findFirstMock.mockRejectedValue(dbDown);
    await expect(toggleClock(USER_ID, NOW, 14)).rejects.toBe(dbDown);
  });
});

describe('toSessionDto', () => {
  it('returns the session object of the contract, without internal fields', () => {
    const dto = toSessionDto(clock('2026-10-07T07:00:00Z', '2026-10-07T15:30:59Z'), NOW, 14);
    expect(dto).toEqual({
      id: 'clock-id',
      userId: USER_ID,
      clockIn: new Date('2026-10-07T07:00:00Z'),
      clockOut: new Date('2026-10-07T15:30:59Z'),
      workedMinutes: 510,
      status: 'closed',
    });
  });

  it('has no worked minutes for an anomaly', () => {
    const dto = toSessionDto(clock('2026-10-05T07:00:00Z', '2026-10-06T07:00:00Z'), NOW, 14);
    expect(dto).toMatchObject({ status: 'anomaly', workedMinutes: null });
  });
});

describe('authorizeClockRead', () => {
  it('resolves "me" to the caller without any lookup', async () => {
    await expect(authorizeClockRead({ id: USER_ID, role: 'employee' }, 'me')).resolves.toBe(USER_ID);
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('refuses an employee on someone else before any lookup', async () => {
    await expect(authorizeClockRead({ id: 'other-id', role: 'employee' }, USER_ID)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(findUserMock).not.toHaveBeenCalled();
  });

  it('answers 404 before 403 for an unknown user', async () => {
    findUserMock.mockResolvedValue(null);
    await expect(authorizeClockRead({ id: 'manager-id', role: 'manager' }, USER_ID)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(findMembershipMock).not.toHaveBeenCalled();
  });

  it('lets the manager of the employee through, and no other manager', async () => {
    findUserMock.mockResolvedValue({ id: USER_ID });
    findMembershipMock.mockResolvedValueOnce({ teamId: 'team-id' }).mockResolvedValueOnce(null);

    await expect(authorizeClockRead({ id: 'manager-id', role: 'manager' }, USER_ID)).resolves.toBe(USER_ID);
    await expect(authorizeClockRead({ id: 'other-manager', role: 'manager' }, USER_ID)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('lets the admin read any existing user', async () => {
    findUserMock.mockResolvedValue({ id: USER_ID });
    await expect(authorizeClockRead({ id: 'admin-id', role: 'admin' }, USER_ID)).resolves.toBe(USER_ID);
  });
});

describe('clockInRange', () => {
  it('has no filter without from nor to', () => {
    expect(clockInRange(undefined, undefined, 'Europe/Paris')).toBeUndefined();
  });

  it('turns local days into UTC bounds, to inclusive', () => {
    expect(clockInRange('2026-10-05', '2026-10-05', 'Europe/Paris')).toEqual({
      gte: new Date('2026-10-04T22:00:00Z'),
      lt: new Date('2026-10-05T22:00:00Z'),
    });
  });

  it('follows the DST change: the last Sunday of October lasts 25 h in Paris', () => {
    const range = clockInRange('2026-10-25', '2026-10-25', 'Europe/Paris');
    expect(range).toEqual({ gte: new Date('2026-10-24T22:00:00Z'), lt: new Date('2026-10-25T23:00:00Z') });
  });

  it('accepts a single bound', () => {
    expect(clockInRange('2026-12-01', undefined, 'Europe/Paris')).toEqual({ gte: new Date('2026-11-30T23:00:00Z') });
    expect(clockInRange(undefined, '2026-12-01', 'UTC')).toEqual({ lt: new Date('2026-12-02T00:00:00Z') });
  });
});

describe('listSessions', () => {
  const options = { now: NOW, anomalyThresholdHours: 14, timezone: 'Europe/Paris' };

  it('paginates in the database without a status filter', async () => {
    findManyMock.mockResolvedValue([clock('2026-10-07T07:00:00Z', '2026-10-07T12:00:00Z')]);
    countMock.mockResolvedValue(21);

    const result = await listSessions(USER_ID, { page: 2, limit: 20 }, options);

    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, clockIn: undefined },
      orderBy: [{ clockIn: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(result.meta).toEqual({ page: 2, limit: 20, total: 21 });
    expect(result.data[0]).toMatchObject({ status: 'closed', workedMinutes: 300 });
  });

  it('filters on the status, then paginates in memory', async () => {
    findManyMock.mockResolvedValue([
      { ...clock('2026-10-07T07:00:00Z', '2026-10-07T12:00:00Z'), id: 'c3' },
      { ...clock('2026-10-06T07:00:00Z', '2026-10-06T12:00:00Z'), id: 'c2' },
      { ...clock('2026-10-04T07:00:00Z', '2026-10-05T07:00:00Z'), id: 'anomaly' },
      { ...clock('2026-10-03T07:00:00Z', '2026-10-03T12:00:00Z'), id: 'c1' },
    ]);

    const result = await listSessions(USER_ID, { status: 'closed', page: 2, limit: 2 }, options);

    expect(result.data.map(s => s.id)).toEqual(['c1']);
    expect(result.meta).toEqual({ page: 2, limit: 2, total: 3 });
    expect(countMock).not.toHaveBeenCalled();
  });

  it('keeps a long corrected session out of the anomalies', async () => {
    findManyMock.mockResolvedValue([
      { ...clock('2026-10-04T07:00:00Z', '2026-10-05T07:00:00Z'), correctedById: 'manager-id' },
    ]);
    const result = await listSessions(USER_ID, { status: 'anomaly', page: 1, limit: 20 }, options);
    expect(result.meta.total).toBe(0);
  });
});

describe('getClockSummary', () => {
  const options = { now: NOW, anomalyThresholdHours: 14, timezone: 'Europe/Paris' };

  it('summarizes the sessions of the local days and echoes the query', async () => {
    findManyMock.mockResolvedValue([
      clock('2026-10-05T07:00:00Z', '2026-10-05T15:00:00Z'),
      clock('2026-10-07T12:00:00Z'), // open, 240 min until NOW
    ]);

    const result = await getClockSummary(USER_ID, { from: '2026-10-05', to: '2026-10-11', groupBy: 'week' }, options);

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        clockIn: { gte: new Date('2026-10-04T22:00:00Z'), lt: new Date('2026-10-11T22:00:00Z') },
      },
      select: { clockIn: true, clockOut: true, correctedById: true },
      orderBy: { clockIn: 'asc' },
    });
    expect(result).toMatchObject({
      userId: USER_ID,
      from: '2026-10-05',
      to: '2026-10-11',
      groupBy: 'week',
      totalMinutes: 720,
      periods: [{ period: '2026-W41', workedMinutes: 720, sessions: 2, status: 'open' }],
    });
  });

  it('counts a corrected long session', async () => {
    findManyMock.mockResolvedValue([
      { ...clock('2026-10-05T07:00:00Z', '2026-10-05T23:00:00Z'), correctedById: 'manager-id' },
    ]);
    const result = await getClockSummary(USER_ID, { from: '2026-10-05', to: '2026-10-05', groupBy: 'day' }, options);
    expect(result.totalMinutes).toBe(960);
  });
});
