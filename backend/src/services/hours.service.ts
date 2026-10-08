import { DateTime } from 'luxon';

export type ClockSession = {
  clockIn: Date;
  clockOut: Date | null;
};

export type SessionStatus = 'open' | 'closed' | 'anomaly';
export type GroupBy = 'day' | 'week';

export type PeriodSummary = {
  period: string;
  workedMinutes: number;
  firstClockIn: Date;
  lastClockOut: Date | null;
  sessions: number;
};

export type HoursSummary = {
  totalMinutes: number;
  periods: PeriodSummary[];
};

export type SummaryOptions = {
  groupBy: GroupBy;
  timezone: string;
  now: Date;
  anomalyThresholdHours: number;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

// A session still open past the threshold means a forgotten clock-out
export function sessionStatus(
  session: ClockSession,
  now: Date,
  anomalyThresholdHours: number
): SessionStatus {
  if (session.clockOut) return 'closed';
  const openFor = now.getTime() - session.clockIn.getTime();
  return openFor > anomalyThresholdHours * MS_PER_HOUR ? 'anomaly' : 'open';
}

// Duration rounded down to the minute; an open session counts until `now`.
export function sessionMinutes(session: ClockSession, now: Date): number {
  const end = session.clockOut ?? now;
  const ms = end.getTime() - session.clockIn.getTime();
  return Math.max(0, Math.floor(ms / MS_PER_MINUTE));
}

// Local day (YYYY-MM-DD) or ISO week (YYYY-Www, starting Monday) of the clock-in
export function periodKey(date: Date, groupBy: GroupBy, timezone: string): string {
  const local = DateTime.fromJSDate(date, { zone: timezone });
  return groupBy === 'day' ? local.toISODate()! : local.toFormat("kkkk-'W'WW");
}

export function summarizeSessions(sessions: ClockSession[], options: SummaryOptions): HoursSummary {
  const { groupBy, timezone, now, anomalyThresholdHours } = options;
  const byPeriod = new Map<string, PeriodSummary>();

  for (const session of sessions) {
    if (sessionStatus(session, now, anomalyThresholdHours) === 'anomaly') continue;

    // The whole session belongs to the day (or week) of its clock-in
    const key = periodKey(session.clockIn, groupBy, timezone);
    const minutes = sessionMinutes(session, now);
    const current = byPeriod.get(key);

    if (!current) {
      byPeriod.set(key, {
        period: key,
        workedMinutes: minutes,
        firstClockIn: session.clockIn,
        lastClockOut: session.clockOut,
        sessions: 1,
      });
      continue;
    }

    current.workedMinutes += minutes;
    current.sessions += 1;
    if (session.clockIn < current.firstClockIn) current.firstClockIn = session.clockIn;
    if (session.clockOut && (!current.lastClockOut || session.clockOut > current.lastClockOut)) {
      current.lastClockOut = session.clockOut;
    }
  }

  const periods = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const totalMinutes = periods.reduce((sum, p) => sum + p.workedMinutes, 0);
  return { totalMinutes, periods };
}
