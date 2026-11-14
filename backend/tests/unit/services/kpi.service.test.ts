import { describe, expect, it } from 'vitest';
import type { ClockSession } from '../../../src/services/hours.service';
import {
  aggregateOvertime,
  aggregatePunctuality,
  completeWeeks,
  computeOvertime,
  computePunctuality,
  punctualityRate,
  type OvertimeOptions,
  type PunctualityOptions,
} from '../../../src/services/kpi.service';

const TZ = 'Europe/Paris';
const NOW = new Date('2026-11-03T12:00:00Z');

const session = (clockIn: string, clockOut: string | null): ClockSession => ({
  clockIn: new Date(clockIn),
  clockOut: clockOut ? new Date(clockOut) : null,
});

// Closed session of `minutes` from clockIn
const worked = (clockIn: string, minutes: number): ClockSession => ({
  clockIn: new Date(clockIn),
  clockOut: new Date(new Date(clockIn).getTime() + minutes * 60_000),
});

// One session per date, from 07:00 UTC
const days = (dates: string[], minutes: number): ClockSession[] =>
  dates.map((date) => worked(`${date}T07:00:00Z`, minutes));

// Monday to Friday of three ISO weeks of October 2026
const W41 = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const W42 = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
const W43 = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];

const punctualityOptions = (overrides: Partial<PunctualityOptions> = {}): PunctualityOptions => ({
  timezone: TZ,
  workdayStartMinutes: 540, // 09:00
  lateToleranceMinutes: 5,
  ...overrides,
});

const overtimeOptions = (overrides: Partial<OvertimeOptions> = {}): OvertimeOptions => ({
  from: '2026-10-01',
  to: '2026-10-31',
  timezone: TZ,
  now: NOW,
  anomalyThresholdHours: 14,
  weeklyReferenceMinutes: 2100, // 35 h
  ...overrides,
});

describe('punctualityRate', () => {
  it('returns a percentage with one decimal', () => {
    expect(punctualityRate(32, 35)).toBe(91.4);
  });

  it('rounds an exact half up', () => {
    // 50.25 %: dividing first would give 50.2
    expect(punctualityRate(201, 400)).toBe(50.3);
  });

  it('returns 100 and 0 at the bounds', () => {
    expect(punctualityRate(20, 20)).toBe(100);
    expect(punctualityRate(0, 20)).toBe(0);
  });

  it('returns null when no day was worked', () => {
    expect(punctualityRate(0, 0)).toBeNull();
  });
});

describe('computePunctuality', () => {
  // Before 25 October 2026, Paris is UTC+2: 09:05 local = 07:05 UTC
  it('counts an arrival at 09:05 as on time, tolerance included', () => {
    const result = computePunctuality(
      [session('2026-10-05T07:05:00Z', '2026-10-05T15:00:00Z')],
      punctualityOptions(),
    );
    expect(result).toEqual({
      workedDays: 1,
      punctualDays: 1,
      rate: 100,
      days: [{ day: '2026-10-05', firstClockIn: new Date('2026-10-05T07:05:00Z'), punctual: true }],
    });
  });

  it('counts an arrival at 09:06 as late', () => {
    const result = computePunctuality([session('2026-10-05T07:06:00Z', null)], punctualityOptions());
    expect(result).toMatchObject({ workedDays: 1, punctualDays: 0, rate: 0 });
  });

  it('truncates the seconds: 09:05:59 is still on time', () => {
    const result = computePunctuality([session('2026-10-05T07:05:59Z', null)], punctualityOptions());
    expect(result.days[0].punctual).toBe(true);
  });

  it('uses the first clock-in of the day, not the one after lunch', () => {
    const result = computePunctuality(
      [
        session('2026-10-05T06:50:00Z', '2026-10-05T10:00:00Z'), // 08:50
        session('2026-10-05T11:30:00Z', '2026-10-05T15:00:00Z'), // 13:30
      ],
      punctualityOptions(),
    );
    expect(result.days).toEqual([
      { day: '2026-10-05', firstClockIn: new Date('2026-10-05T06:50:00Z'), punctual: true },
    ]);
  });

  it('finds the first clock-in whatever the session order, and sorts days', () => {
    const result = computePunctuality(
      [
        session('2026-10-06T07:00:00Z', null),
        session('2026-10-05T11:30:00Z', '2026-10-05T15:00:00Z'), // 13:30
        session('2026-10-05T07:20:00Z', '2026-10-05T10:00:00Z'), // 09:20, late
      ],
      punctualityOptions(),
    );
    expect(result.days.map((d) => [d.day, d.firstClockIn, d.punctual])).toEqual([
      ['2026-10-05', new Date('2026-10-05T07:20:00Z'), false],
      ['2026-10-06', new Date('2026-10-06T07:00:00Z'), true],
    ]);
  });

  it('uses the local day, not the UTC day', () => {
    // 23:30 UTC on the 5th = 01:30 in Paris on the 6th
    const result = computePunctuality([session('2026-10-05T23:30:00Z', null)], punctualityOptions());
    expect(result.days).toEqual([
      { day: '2026-10-06', firstClockIn: new Date('2026-10-05T23:30:00Z'), punctual: true },
    ]);
  });

  it('follows summer time: 09:05 local is 07:05 UTC after 29 March', () => {
    const onTime = computePunctuality([session('2026-03-30T07:05:00Z', null)], punctualityOptions());
    const late = computePunctuality([session('2026-03-30T07:06:00Z', null)], punctualityOptions());
    expect(onTime.days[0].punctual).toBe(true);
    expect(late.days[0].punctual).toBe(false);
  });

  it('follows winter time: 09:05 local is 08:05 UTC after 25 October', () => {
    const onTime = computePunctuality([session('2026-10-26T08:05:00Z', null)], punctualityOptions());
    const late = computePunctuality([session('2026-10-26T08:06:00Z', null)], punctualityOptions());
    expect(onTime.days[0].punctual).toBe(true);
    expect(late.days[0].punctual).toBe(false);
  });

  it('counts a session spanning midnight for its clock-in day only', () => {
    const result = computePunctuality(
      [
        session('2026-10-05T20:00:00Z', '2026-10-06T00:00:00Z'), // 22:00 → 02:00
        session('2026-10-06T07:00:00Z', '2026-10-06T15:00:00Z'), // 09:00
      ],
      punctualityOptions(),
    );
    expect(result.days.map((d) => [d.day, d.firstClockIn, d.punctual])).toEqual([
      ['2026-10-05', new Date('2026-10-05T20:00:00Z'), false],
      ['2026-10-06', new Date('2026-10-06T07:00:00Z'), true],
    ]);
  });

  it('counts the arrival of an anomaly session, unlike the hours summary', () => {
    const result = computePunctuality(
      [
        session('2026-10-05T07:00:00Z', '2026-10-06T06:30:00Z'), // forgotten, closed the next morning
        session('2026-10-06T06:30:00Z', null), // still open for days
      ],
      punctualityOptions(),
    );
    expect(result).toMatchObject({ workedDays: 2, punctualDays: 2, rate: 100 });
  });

  it('counts the arrival of a session still open', () => {
    const result = computePunctuality([session('2026-10-05T07:30:00Z', null)], punctualityOptions());
    expect(result).toMatchObject({ workedDays: 1, punctualDays: 0, rate: 0 });
  });

  it('only counts days with a clock-in in the denominator', () => {
    const result = computePunctuality(
      [session('2026-10-05T07:00:00Z', null), session('2026-10-07T07:30:00Z', null)],
      punctualityOptions(),
    );
    expect(result).toMatchObject({ workedDays: 2, punctualDays: 1, rate: 50 });
  });

  it('returns a null rate with no session', () => {
    expect(computePunctuality([], punctualityOptions())).toEqual({
      workedDays: 0,
      punctualDays: 0,
      rate: null,
      days: [],
    });
  });

  it('reads a custom start time and a zero tolerance', () => {
    const options = punctualityOptions({ workdayStartMinutes: 480, lateToleranceMinutes: 0 }); // 08:00
    const onTime = computePunctuality([session('2026-10-05T06:00:30Z', null)], options); // 08:00:30
    const late = computePunctuality([session('2026-10-05T06:01:00Z', null)], options); // 08:01
    expect(onTime.days[0].punctual).toBe(true);
    expect(late.days[0].punctual).toBe(false);
  });
});

describe('completeWeeks', () => {
  it('returns the ISO weeks entirely inside October 2026', () => {
    // 1 October is a Thursday, 31 October a Saturday
    expect(completeWeeks('2026-10-01', '2026-10-31', TZ).map((w) => w.week)).toEqual([
      '2026-W41',
      '2026-W42',
      '2026-W43',
    ]);
  });

  it('keeps a period of exactly Monday to Sunday', () => {
    expect(completeWeeks('2026-10-05', '2026-10-11', TZ)).toEqual([
      { week: '2026-W41', start: new Date('2026-10-04T22:00:00Z'), end: new Date('2026-10-11T22:00:00Z') },
    ]);
  });

  it('returns no week for a period shorter than 7 days', () => {
    expect(completeWeeks('2026-10-05', '2026-10-10', TZ)).toEqual([]);
  });

  it('returns no week for 7 days not starting on a Monday', () => {
    expect(completeWeeks('2026-10-06', '2026-10-12', TZ)).toEqual([]);
  });

  it('returns no week when from is after to', () => {
    expect(completeWeeks('2026-10-31', '2026-10-01', TZ)).toEqual([]);
  });

  it('uses local midnights across the switch to summer time', () => {
    // Week 13 of 2026 ends on Sunday 29 March, a 23-hour day
    expect(completeWeeks('2026-03-23', '2026-03-29', TZ)).toEqual([
      { week: '2026-W13', start: new Date('2026-03-22T23:00:00Z'), end: new Date('2026-03-29T22:00:00Z') },
    ]);
  });

  it('uses local midnights across the switch to winter time', () => {
    // Week 43 of 2026 ends on Sunday 25 October, a 25-hour day
    expect(completeWeeks('2026-10-19', '2026-10-25', TZ)).toEqual([
      { week: '2026-W43', start: new Date('2026-10-18T22:00:00Z'), end: new Date('2026-10-25T23:00:00Z') },
    ]);
  });

  it('leaves out a week not finished at endedBy', () => {
    // NOW is Tuesday 3 November, in week 45
    expect(completeWeeks('2026-11-02', '2026-11-08', TZ, NOW)).toEqual([]);
  });

  it('keeps a week ending exactly at endedBy', () => {
    // Monday 9 November 00:00 in Paris
    const endedBy = new Date('2026-11-08T23:00:00Z');
    expect(completeWeeks('2026-11-02', '2026-11-08', TZ, endedBy).map((w) => w.week)).toEqual(['2026-W45']);
  });

  it('uses the ISO year at the turn of the year', () => {
    expect(completeWeeks('2026-12-28', '2027-01-03', TZ).map((w) => w.week)).toEqual(['2026-W53']);
  });

  it('throws on an invalid date', () => {
    expect(() => completeWeeks('2026-13-01', '2026-10-31', TZ)).toThrow();
  });

  it('throws on an invalid timezone', () => {
    expect(() => completeWeeks('2026-10-01', '2026-10-31', 'Mars/Olympus')).toThrow();
  });

  it('gives the first ISO week of the next year to late December days', () => {
    expect(completeWeeks('2025-12-29', '2026-01-04', TZ).map((w) => w.week)).toEqual(['2026-W01']);
  });
});

describe('computeOvertime', () => {
  it('counts the minutes beyond the weekly reference', () => {
    // 4 × 7 h + 9 h = 37 h in week 41
    const sessions = [...days(W41.slice(0, 4), 420), worked('2026-10-09T07:00:00Z', 540)];
    expect(computeOvertime(sessions, overtimeOptions())).toEqual({
      overtimeMinutes: 120,
      weeks: [
        { week: '2026-W41', workedMinutes: 2220, overtimeMinutes: 120 },
        { week: '2026-W42', workedMinutes: 0, overtimeMinutes: 0 },
        { week: '2026-W43', workedMinutes: 0, overtimeMinutes: 0 },
      ],
    });
  });

  it('returns 0 for a week at or below the reference', () => {
    const result = computeOvertime(days(W41, 420), overtimeOptions()); // exactly 35 h
    expect(result.overtimeMinutes).toBe(0);
    expect(result.weeks[0]).toEqual({ week: '2026-W41', workedMinutes: 2100, overtimeMinutes: 0 });
  });

  it('sums the weeks, a short week not offsetting a long one', () => {
    const sessions = [
      ...days(W41, 444), // 37 h → 120
      ...days(W42, 360), // 30 h → 0, not -300
      ...days(W43, 432), // 36 h → 60
    ];
    expect(computeOvertime(sessions, overtimeOptions()).overtimeMinutes).toBe(180);
  });

  it('ignores partial weeks at the edges of the period, without prorating', () => {
    const sessions = [
      ...days(['2026-10-01', '2026-10-02'], 720), // Thursday and Friday of week 40
      ...days(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'], 600), // week 44
    ];
    const result = computeOvertime(sessions, overtimeOptions());
    expect(result.overtimeMinutes).toBe(0);
    expect(result.weeks.map((w) => w.week)).toEqual(['2026-W41', '2026-W42', '2026-W43']);
  });

  it('returns null when the period holds no complete week', () => {
    const sessions = days(['2026-10-01', '2026-10-02'], 720);
    const result = computeOvertime(sessions, overtimeOptions({ to: '2026-10-04' }));
    expect(result).toEqual({ overtimeMinutes: null, weeks: [] });
  });

  it('leaves out the current week, not finished yet', () => {
    // NOW is Tuesday 3 November: 12 h on Monday does not count yet
    const result = computeOvertime(
      [worked('2026-11-02T07:00:00Z', 720)],
      overtimeOptions({ from: '2026-11-02', to: '2026-11-08' }),
    );
    expect(result).toEqual({ overtimeMinutes: null, weeks: [] });
  });

  it('counts a finished week whose open session became an anomaly', () => {
    // Open since Sunday 22:00, now Tuesday 13 October 14:00 in Paris: 40 h, left out like any anomaly
    const now = new Date('2026-10-13T12:00:00Z');
    const sessions = [...days(W41, 480), session('2026-10-11T20:00:00Z', null)];
    const result = computeOvertime(sessions, overtimeOptions({ from: '2026-10-05', to: '2026-10-11', now }));
    expect(result).toEqual({
      overtimeMinutes: 300,
      weeks: [{ week: '2026-W41', workedMinutes: 2400, overtimeMinutes: 300 }],
    });
  });

  it('skips a finished week still containing an open session', () => {
    // Monday 12 October 01:00 in Paris, open since Sunday 22:00: 3 h, not an anomaly yet
    const now = new Date('2026-10-11T23:00:00Z');
    const sessions = [...days(W41, 480), session('2026-10-11T20:00:00Z', null)];
    const result = computeOvertime(sessions, overtimeOptions({ from: '2026-10-05', to: '2026-10-11', now }));
    expect(result).toEqual({ overtimeMinutes: null, weeks: [] });
  });

  it('leaves anomaly sessions out', () => {
    const sessions = [
      ...days(W41, 420),
      session('2026-10-10T07:00:00Z', '2026-10-11T07:00:00Z'), // forgotten on Saturday, 24 h
    ];
    const result = computeOvertime(sessions, overtimeOptions());
    expect(result.weeks[0]).toEqual({ week: '2026-W41', workedMinutes: 2100, overtimeMinutes: 0 });
  });

  it('keeps a Sunday-night session in its clock-in week', () => {
    const sessions = [
      ...days(W41, 420),
      session('2026-10-11T20:00:00Z', '2026-10-12T00:00:00Z'), // Sunday 22:00 → Monday 02:00
    ];
    const result = computeOvertime(sessions, overtimeOptions());
    expect(result.weeks.slice(0, 2)).toEqual([
      { week: '2026-W41', workedMinutes: 2340, overtimeMinutes: 240 },
      { week: '2026-W42', workedMinutes: 0, overtimeMinutes: 0 },
    ]);
  });

  it('counts real durations in the week of the switch to winter time', () => {
    const sessions = [
      ...days(W43, 420),
      session('2026-10-24T22:00:00Z', '2026-10-25T05:00:00Z'), // 00:00 → 06:00 local = 7 h
    ];
    const result = computeOvertime(sessions, overtimeOptions({ from: '2026-10-19', to: '2026-10-25' }));
    expect(result).toEqual({
      overtimeMinutes: 420,
      weeks: [{ week: '2026-W43', workedMinutes: 2520, overtimeMinutes: 420 }],
    });
  });

  it('counts real durations in the week of the switch to summer time', () => {
    const sessions = [
      ...days(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'], 420),
      session('2026-03-28T23:00:00Z', '2026-03-29T05:00:00Z'), // 00:00 → 07:00 local = 6 h
    ];
    const result = computeOvertime(sessions, overtimeOptions({ from: '2026-03-23', to: '2026-03-29' }));
    expect(result).toEqual({
      overtimeMinutes: 360,
      weeks: [{ week: '2026-W13', workedMinutes: 2460, overtimeMinutes: 360 }],
    });
  });

  it('returns 0 for a complete week without any session', () => {
    expect(computeOvertime([], overtimeOptions({ from: '2026-10-05', to: '2026-10-11' }))).toEqual({
      overtimeMinutes: 0,
      weeks: [{ week: '2026-W41', workedMinutes: 0, overtimeMinutes: 0 }],
    });
  });

  it('reads a custom weekly reference', () => {
    // 40 h against 37.5 h
    const result = computeOvertime(days(W41, 480), overtimeOptions({ weeklyReferenceMinutes: 2250 }));
    expect(result.overtimeMinutes).toBe(150);
  });
});

describe('aggregatePunctuality', () => {
  it('recomputes the rate from summed days, not from averaged rates', () => {
    // 10 / 11 = 90.9 %, while the average of 100 % and 90 % would be 95 %
    expect(
      aggregatePunctuality([
        { workedDays: 1, punctualDays: 1 },
        { workedDays: 10, punctualDays: 9 },
      ]),
    ).toEqual({ workedDays: 11, punctualDays: 10, rate: 90.9 });
  });

  it('returns a null rate when nobody worked', () => {
    expect(aggregatePunctuality([{ workedDays: 0, punctualDays: 0 }])).toEqual({
      workedDays: 0,
      punctualDays: 0,
      rate: null,
    });
    expect(aggregatePunctuality([]).rate).toBeNull();
  });
});

describe('aggregateOvertime', () => {
  it('sums the users, ignoring those without a value', () => {
    const items = [{ overtimeMinutes: 120 }, { overtimeMinutes: null }, { overtimeMinutes: 0 }];
    expect(aggregateOvertime(items)).toBe(120);
  });

  it('returns null when no user has a value', () => {
    expect(aggregateOvertime([{ overtimeMinutes: null }, { overtimeMinutes: null }])).toBeNull();
    expect(aggregateOvertime([])).toBeNull();
  });
});
