import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../../../src/lib/prisma';
import AppError from '../../../src/errors/AppError';
import { correctClock, getClockSummary, toggleClock } from '../../../src/services/clock.service';

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

describe('correctClock (PostgreSQL)', () => {
  const NOW = new Date('2026-10-07T16:00:00Z');
  let manager: { id: string; role: 'manager' };
  let correction: { clockIn: Date; clockOut: Date; reason: string };

  beforeEach(async () => {
    const nadia = await prisma.user.create({
      data: { firstName: 'Nadia', lastName: 'Benali', email: 'nadia.benali@trinity.com', role: 'manager' },
    });
    await prisma.team.create({
      data: { name: 'Support N1', managerId: nadia.id, members: { create: { userId } } },
    });
    manager = { id: nadia.id, role: 'manager' };
    correction = {
      clockIn: new Date('2026-10-06T07:00:00Z'),
      clockOut: new Date('2026-10-06T22:00:00Z'),
      reason: 'Oubli de pointage au départ',
    };
  });

  // Forgotten clock-out: clocked in Monday 07:00, closed by the clock-in of Tuesday 08:00
  const forgottenSession = async () => {
    await toggleClock(userId, new Date('2026-10-06T07:00:00Z'), THRESHOLD_HOURS);
    await toggleClock(userId, new Date('2026-10-07T08:00:00Z'), THRESHOLD_HOURS);
    return prisma.clock.findFirstOrThrow({ where: { userId, clockIn: new Date('2026-10-06T07:00:00Z') } });
  };

  it('fixes a forgotten clock-out: stored, and counted in the summary even beyond 14 h', async () => {
    const forgotten = await forgottenSession();
    const summaryOf = () =>
      getClockSummary(
        userId,
        { from: '2026-10-06', to: '2026-10-06', groupBy: 'day' },
        { now: NOW, anomalyThresholdHours: THRESHOLD_HOURS, timezone: 'Europe/Paris' }
      );
    expect((await summaryOf()).totalMinutes).toBe(0);

    // 15 h of work: more than the threshold, but corrected by a manager
    const session = await correctClock(manager, forgotten.id, correction, NOW, THRESHOLD_HOURS);

    expect(session).toMatchObject({ id: forgotten.id, status: 'closed', workedMinutes: 900 });
    expect(await prisma.clock.findUniqueOrThrow({ where: { id: forgotten.id } })).toMatchObject({
      clockIn: correction.clockIn,
      clockOut: correction.clockOut,
      correctedById: manager.id,
      correctionReason: correction.reason,
    });
    expect((await summaryOf()).totalMinutes).toBe(900);
  });

  it('answers 409 and changes nothing when the correction overlaps the next session', async () => {
    const forgotten = await forgottenSession();

    // The open session started Tuesday 08:00
    await expect(
      correctClock(manager, forgotten.id, { ...correction, clockOut: new Date('2026-10-07T08:00:01Z') }, NOW, THRESHOLD_HOURS)
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await prisma.clock.findUniqueOrThrow({ where: { id: forgotten.id } })).toMatchObject({
      clockOut: new Date('2026-10-07T08:00:00Z'),
      correctedById: null,
    });
  });

  it('accepts a correction that ends exactly when the next session starts', async () => {
    const forgotten = await forgottenSession();

    const session = await correctClock(
      manager,
      forgotten.id,
      { ...correction, clockOut: new Date('2026-10-07T08:00:00Z') },
      NOW,
      THRESHOLD_HOURS
    );
    expect(session.status).toBe('closed');
  });

  it('closes an open session, after which the next POST /clocks clocks in', async () => {
    const open = await toggleClock(userId, new Date('2026-10-07T08:00:00Z'), THRESHOLD_HOURS);

    await correctClock(
      manager,
      open.session.id,
      { ...correction, clockIn: new Date('2026-10-07T08:00:00Z'), clockOut: new Date('2026-10-07T12:00:00Z') },
      NOW,
      THRESHOLD_HOURS
    );
    const next = await toggleClock(userId, NOW, THRESHOLD_HOURS);

    expect(next.action).toBe('clockIn');
    expect(await prisma.clock.count({ where: { userId, clockOut: null } })).toBe(1);
  });

  it('never lets two concurrent corrections overlap each other', async () => {
    // Two closed sessions of Monday, each corrected to cover the whole afternoon at the same time
    const morning = await prisma.clock.create({
      data: { userId, clockIn: new Date('2026-10-05T08:00:00Z'), clockOut: new Date('2026-10-05T12:00:00Z') },
    });
    const evening = await prisma.clock.create({
      data: { userId, clockIn: new Date('2026-10-05T18:00:00Z'), clockOut: new Date('2026-10-05T20:00:00Z') },
    });
    const afternoon = {
      clockIn: new Date('2026-10-05T13:00:00Z'),
      clockOut: new Date('2026-10-05T17:00:00Z'),
      reason: 'Après-midi oublié',
    };

    const results = await Promise.allSettled([
      correctClock(manager, morning.id, afternoon, NOW, THRESHOLD_HOURS),
      correctClock(manager, evening.id, afternoon, NOW, THRESHOLD_HOURS),
    ]);

    // The lock on the employee serializes them: the second one sees the first and answers 409
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});
