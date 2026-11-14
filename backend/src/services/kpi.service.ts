import { DateTime } from 'luxon';
import { periodKey, summarizeSessions, type ClockSession } from './hours.service';

export type PunctualityOptions = {
  timezone: string;
  workdayStartMinutes: number;
  lateToleranceMinutes: number;
};

export type PunctualityDay = {
  day: string;
  firstClockIn: Date;
  punctual: boolean;
};

export type PunctualityCounts = {
  workedDays: number;
  punctualDays: number;
};

export type Punctuality = PunctualityCounts & {
  rate: number | null;
  days: PunctualityDay[];
};

export type OvertimeOptions = {
  from: string;
  to: string;
  timezone: string;
  now: Date;
  anomalyThresholdHours: number;
  weeklyReferenceMinutes: number;
};

export type WeekOvertime = {
  week: string;
  workedMinutes: number;
  overtimeMinutes: number;
};

export type Overtime = {
  overtimeMinutes: number | null;
  weeks: WeekOvertime[];
};

export type CompleteWeek = {
  week: string;
  start: Date;
  end: Date; // exclusive
};

// One decimal, null when no day was worked
export function punctualityRate(punctualDays: number, workedDays: number): number | null {
  if (workedDays === 0) return null;
  // Multiply first to keep exact halves (201/400 -> 50.3)
  return Math.round((punctualDays * 1000) / workedDays) / 10;
}

// Contract, section 7. Anomaly and open sessions count: the arrival is still real
export function computePunctuality(sessions: ClockSession[], options: PunctualityOptions): Punctuality {
  const { timezone, workdayStartMinutes, lateToleranceMinutes } = options;
  const deadline = workdayStartMinutes + lateToleranceMinutes;
  const firstByDay = new Map<string, Date>();

  for (const session of sessions) {
    const day = periodKey(session.clockIn, 'day', timezone);
    const current = firstByDay.get(day);
    if (!current || session.clockIn < current) firstByDay.set(day, session.clockIn);
  }

  const days = [...firstByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, firstClockIn]) => {
      // Local wall clock, seconds ignored
      const local = DateTime.fromJSDate(firstClockIn, { zone: timezone });
      return { day, firstClockIn, punctual: local.hour * 60 + local.minute <= deadline };
    });

  const punctualDays = days.filter((d) => d.punctual).length;
  return {
    workedDays: days.length,
    punctualDays,
    rate: punctualityRate(punctualDays, days.length),
    days,
  };
}

// ISO weeks entirely inside [from, to] and, with endedBy, finished by then
export function completeWeeks(from: string, to: string, timezone: string, endedBy?: Date): CompleteWeek[] {
  const first = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const last = DateTime.fromISO(to, { zone: timezone });
  if (!first.isValid || !last.isValid) throw new Error(`Invalid date or timezone: ${from}, ${to}`);
  const endExclusive = last.plus({ days: 1 }).startOf('day');

  let monday = first.weekday === 1 ? first : first.plus({ weeks: 1 }).startOf('week');
  const weeks: CompleteWeek[] = [];
  while (monday.plus({ weeks: 1 }) <= endExclusive) {
    const next = monday.plus({ weeks: 1 });
    if (endedBy && next.toJSDate() > endedBy) break;
    const start = monday.toJSDate();
    weeks.push({ week: periodKey(start, 'week', timezone), start, end: next.toJSDate() });
    monday = next;
  }
  return weeks;
}

// Contract, section 7. Only complete, finished weeks without an open session
export function computeOvertime(sessions: ClockSession[], options: OvertimeOptions): Overtime {
  const { from, to, timezone, now, anomalyThresholdHours, weeklyReferenceMinutes } = options;
  const weeks = completeWeeks(from, to, timezone, now);
  const summary = summarizeSessions(sessions, { groupBy: 'week', timezone, now, anomalyThresholdHours });
  const byWeek = new Map(summary.periods.map((p) => [p.period, p]));

  const counted: WeekOvertime[] = [];
  for (const { week } of weeks) {
    const period = byWeek.get(week);
    if (period?.status === 'open') continue;
    const workedMinutes = period?.workedMinutes ?? 0;
    const overtimeMinutes = Math.max(0, workedMinutes - weeklyReferenceMinutes);
    counted.push({ week, workedMinutes, overtimeMinutes });
  }

  return {
    overtimeMinutes: counted.length ? counted.reduce((sum, w) => sum + w.overtimeMinutes, 0) : null,
    weeks: counted,
  };
}

// Rate from summed days, not an average of rates
export function aggregatePunctuality(
  items: PunctualityCounts[]
): PunctualityCounts & { rate: number | null } {
  const workedDays = items.reduce((sum, i) => sum + i.workedDays, 0);
  const punctualDays = items.reduce((sum, i) => sum + i.punctualDays, 0);
  return { workedDays, punctualDays, rate: punctualityRate(punctualDays, workedDays) };
}

export function aggregateOvertime(items: { overtimeMinutes: number | null }[]): number | null {
  const values = items.map((i) => i.overtimeMinutes).filter((v): v is number => v !== null);
  return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
}
