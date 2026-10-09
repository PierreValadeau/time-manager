import { describe, expect, it } from 'vitest';
import {
  periodKey,
  sessionMinutes,
  sessionStatus,
  summarizeSessions,
  type ClockSession,
  type SummaryOptions,
} from '../../../src/services/hours.service';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-10-07T12:00:00Z');

const session = (clockIn: string, clockOut: string | null): ClockSession => ({
  clockIn: new Date(clockIn),
  clockOut: clockOut ? new Date(clockOut) : null,
});

const options = (overrides: Partial<SummaryOptions> = {}): SummaryOptions => ({
  groupBy: 'day',
  timezone: TZ,
  now: NOW,
  anomalyThresholdHours: 14,
  ...overrides,
});

describe('sessionMinutes', () => {
  it('rounds each session down to the minute', () => {
    // 1 h 59 min 59 s → 119 minutes
    expect(sessionMinutes(session('2026-10-05T07:00:00Z', '2026-10-05T08:59:59Z'), NOW)).toBe(119);
  });

  it('counts an open session until now', () => {
    expect(sessionMinutes(session('2026-10-07T10:30:00Z', null), NOW)).toBe(90);
  });

  it('is not affected by the switch to winter time', () => {
    // Night of 24-25 October 2026: local 03:00 goes back to 02:00
    // 00:00 → 06:00 Paris time = 7 real hours, not 6
    const s = session('2026-10-24T22:00:00Z', '2026-10-25T05:00:00Z');
    expect(sessionMinutes(s, NOW)).toBe(7 * 60);
  });

  it('is not affected by the switch to summer time', () => {
    // Night of 28-29 March 2026: local 02:00 jumps to 03:00
    const s = session('2026-03-28T23:00:00Z', '2026-03-29T05:00:00Z');
    expect(sessionMinutes(s, NOW)).toBe(6 * 60);
  });
});

describe('sessionStatus', () => {
  it('returns closed for a finished session', () => {
    expect(sessionStatus(session('2026-10-05T07:00:00Z', '2026-10-05T15:00:00Z'), NOW, 14)).toBe('closed');
  });

  it('returns open for a session open for less than 14 h', () => {
    expect(sessionStatus(session('2026-10-07T07:00:00Z', null), NOW, 14)).toBe('open');
  });

  it('returns anomaly for a session open for more than 14 h', () => {
    expect(sessionStatus(session('2026-10-06T21:59:00Z', null), NOW, 14)).toBe('anomaly');
  });

  it('returns open for a session open for exactly 14 h', () => {
    // The contract says "more than 14 hours": 14 h sharp is still open
    expect(sessionStatus(session('2026-10-06T22:00:00Z', null), NOW, 14)).toBe('open');
  });
});

describe('periodKey', () => {
  it('uses the local day, not the UTC day', () => {
    // 23:30 UTC on the 5th = 01:30 in Paris on the 6th
    expect(periodKey(new Date('2026-10-05T23:30:00Z'), 'day', TZ)).toBe('2026-10-06');
  });

  it('returns the ISO week, which starts on Monday', () => {
    expect(periodKey(new Date('2026-10-05T08:00:00Z'), 'week', TZ)).toBe('2026-W41'); // Monday
    expect(periodKey(new Date('2026-10-11T20:00:00Z'), 'week', TZ)).toBe('2026-W41'); // Sunday
    expect(periodKey(new Date('2026-10-12T08:00:00Z'), 'week', TZ)).toBe('2026-W42'); // next Monday
  });

  it('uses the ISO year at the turn of the year', () => {
    // Friday 1 January 2027 belongs to week 53 of 2026
    expect(periodKey(new Date('2027-01-01T10:00:00Z'), 'week', TZ)).toBe('2026-W53');
  });

  it('throws on an invalid timezone', () => {
    expect(() => periodKey(new Date('2026-10-05T08:00:00Z'), 'day', 'Europe/Pariss')).toThrow();
  });
});

describe('summarizeSessions', () => {
  it('adds up several sessions on the same day', () => {
    const result = summarizeSessions(
      [
        session('2026-10-05T07:00:00Z', '2026-10-05T11:00:00Z'), // 240
        session('2026-10-05T12:00:00Z', '2026-10-05T15:30:00Z'), // 210
      ],
      options(),
    );
    expect(result.totalMinutes).toBe(450);
    expect(result.periods).toEqual([
      {
        period: '2026-10-05',
        workedMinutes: 450,
        firstClockIn: new Date('2026-10-05T07:00:00Z'),
        lastClockOut: new Date('2026-10-05T15:30:00Z'),
        sessions: 2,
      },
    ]);
  });

  it('rounds each session before summing', () => {
    // 2 sessions of 30 min 40 s: 30 + 30 = 60, not floor(61 min 20 s) = 61
    const result = summarizeSessions(
      [
        session('2026-10-05T07:00:00Z', '2026-10-05T07:30:40Z'),
        session('2026-10-05T08:00:00Z', '2026-10-05T08:30:40Z'),
      ],
      options(),
    );
    expect(result.totalMinutes).toBe(60);
  });

  it('assigns a session spanning midnight to its clock-in day', () => {
    // 22:00 → 02:00 Paris time
    const result = summarizeSessions([session('2026-10-05T20:00:00Z', '2026-10-06T00:00:00Z')], options());
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ period: '2026-10-05', workedMinutes: 240 });
  });

  it('keeps a Sunday-night session spanning midnight in its clock-in week', () => {
    // Sunday 22:00 → Monday 02:00 Paris time
    const result = summarizeSessions(
      [session('2026-10-11T20:00:00Z', '2026-10-12T00:00:00Z')],
      options({ groupBy: 'week' }),
    );
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ period: '2026-W41', workedMinutes: 240 });
  });

  it('groups by ISO week', () => {
    const result = summarizeSessions(
      [
        session('2026-10-05T07:00:00Z', '2026-10-05T15:00:00Z'), // Monday W41
        session('2026-10-09T07:00:00Z', '2026-10-09T15:00:00Z'), // Friday W41
        session('2026-10-12T07:00:00Z', '2026-10-12T15:00:00Z'), // Monday W42
      ],
      options({ groupBy: 'week' }),
    );
    expect(result.periods.map((p) => [p.period, p.workedMinutes, p.sessions])).toEqual([
      ['2026-W41', 960, 2],
      ['2026-W42', 480, 1],
    ]);
    expect(result.totalMinutes).toBe(1440);
  });

  it('leaves anomaly sessions out of the totals', () => {
    const result = summarizeSessions(
      [
        session('2026-10-05T07:00:00Z', null), // open for 2 days → anomaly
        session('2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'),
      ],
      options(),
    );
    expect(result.totalMinutes).toBe(480);
    expect(result.periods.map((p) => p.period)).toEqual(['2026-10-06']);
  });

  it('counts an open session until now, with no clock-out', () => {
    const result = summarizeSessions([session('2026-10-07T08:00:00Z', null)], options());
    expect(result.periods[0]).toMatchObject({ workedMinutes: 240, lastClockOut: null, sessions: 1 });
  });

  it('returns no period for a day without clocking', () => {
    const result = summarizeSessions(
      [
        session('2026-10-05T07:00:00Z', '2026-10-05T15:00:00Z'),
        session('2026-10-07T07:00:00Z', '2026-10-07T11:00:00Z'),
      ],
      options(),
    );
    expect(result.periods.map((p) => p.period)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('sorts periods chronologically, whatever the session order', () => {
    const result = summarizeSessions(
      [
        session('2026-10-07T07:00:00Z', '2026-10-07T08:00:00Z'),
        session('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z'),
      ],
      options(),
    );
    expect(result.periods.map((p) => p.period)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('returns an empty summary with no session', () => {
    expect(summarizeSessions([], options())).toEqual({ totalMinutes: 0, periods: [] });
  });
});
