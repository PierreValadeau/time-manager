import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { toggleClock } from '../../../src/services/clock.service';

const THRESHOLD_HOURS = 14;
let userId: string;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com' },
  });
  userId = user.id;
});

describe('toggleClock (PostgreSQL)', () => {
  it('opens then closes a session', async () => {
    const opened = await toggleClock(userId, new Date('2026-10-07T08:00:00Z'), THRESHOLD_HOURS);
    const closed = await toggleClock(userId, new Date('2026-10-07T12:00:00Z'), THRESHOLD_HOURS);

    expect(opened.action).toBe('clockIn');
    expect(closed).toMatchObject({ action: 'clockOut', session: { workedMinutes: 240, status: 'closed' } });
    expect(await prisma.clock.count({ where: { userId, clockOut: null } })).toBe(0);
  });

  it('closes a forgotten session and opens a new one', async () => {
    await toggleClock(userId, new Date('2026-10-06T08:00:00Z'), THRESHOLD_HOURS);
    const next = await toggleClock(userId, new Date('2026-10-07T08:00:00Z'), THRESHOLD_HOURS);

    expect(next.action).toBe('clockIn');
    expect(await prisma.clock.count({ where: { userId } })).toBe(2);
    expect(await prisma.clock.count({ where: { userId, clockOut: null } })).toBe(1);
  });

  it('never leaves two open sessions under concurrent clock-ins', async () => {
    // A double click: two requests a millisecond apart
    const results = await Promise.allSettled([
      toggleClock(userId, new Date('2026-10-07T08:00:00.000Z'), THRESHOLD_HOURS),
      toggleClock(userId, new Date('2026-10-07T08:00:00.001Z'), THRESHOLD_HOURS),
    ]);

    // Either the second request saw the first session, or the unique index rejected it as a 409
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(AppError);
        expect(result.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
      }
    }
    expect(await prisma.clock.count({ where: { userId, clockOut: null } })).toBeLessThanOrEqual(1);
  });

  it('refuses to close a session opened after its now', async () => {
    // Deterministic replay of the race: this request read now at 08:00:00.000, then a
    // concurrent one opened a session at 08:00:00.001 before its transaction started
    const later = await prisma.clock.create({
      data: { userId, clockIn: new Date('2026-10-07T08:00:00.001Z') },
    });

    await expect(
      toggleClock(userId, new Date('2026-10-07T08:00:00.000Z'), THRESHOLD_HOURS)
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    // Untouched: no clock-out before the clock-in (CHECK clocks_out_after_in)
    expect(await prisma.clock.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({
      clockOut: null,
    });
  });
});

describe('clocks constraints', () => {
  it('rejects a clock-out before the clock-in', async () => {
    await expect(
      prisma.clock.create({
        data: { userId, clockIn: new Date('2026-10-07T12:00:00Z'), clockOut: new Date('2026-10-07T08:00:00Z') },
      })
    ).rejects.toThrow(/clocks_out_after_in/);
  });

  it('rejects a second open session for the same user', async () => {
    await prisma.clock.create({ data: { userId, clockIn: new Date('2026-10-07T08:00:00Z') } });

    await expect(
      prisma.clock.create({ data: { userId, clockIn: new Date('2026-10-07T09:00:00Z') } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
