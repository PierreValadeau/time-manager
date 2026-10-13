import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { Prisma } from '@prisma/client';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { toggleClock, toSessionDto } from '../../../src/services/clock.service';

// No database: the transaction runs its callback on the same mocked client
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
