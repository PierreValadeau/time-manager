import { IANAZone } from 'luxon';

// Contract, section 9: a session open longer than this is a forgotten clock-out (anomaly)
export function anomalyThresholdHours(): number {
  const raw = process.env.ANOMALY_THRESHOLD_HOURS;
  if (raw === undefined || raw === '') return 14;

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('ANOMALY_THRESHOLD_HOURS must be a positive number');
  }
  return hours;
}

// Contract, section 9: hours are stored in UTC, days and weeks are local to this timezone
export function appTimezone(): string {
  const zone = process.env.APP_TIMEZONE || 'Europe/Paris';
  if (!IANAZone.isValidZone(zone)) {
    throw new Error('APP_TIMEZONE must be a valid IANA timezone, e.g. Europe/Paris');
  }
  return zone;
}

// Expected start of the workday, local time HH:mm, as minutes since midnight
export function workdayStartMinutes(): number {
  const raw = process.env.WORKDAY_START;
  if (raw === undefined || raw === '') return 9 * 60;

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!match) throw new Error('WORKDAY_START must be a local time HH:mm, e.g. 09:00');
  return Number(match[1]) * 60 + Number(match[2]);
}

// Expected tolerance for late arrivals, in minutes
export function lateToleranceMinutes(): number {
  const raw = process.env.LATE_TOLERANCE_MINUTES;
  if (raw === undefined || raw === '') return 5;

  // Digits only: Number() accepts ' ' and '1e1'
  const minutes = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) {
    throw new Error('LATE_TOLERANCE_MINUTES must be an integer from 0 to 1439');
  }
  return minutes;
}

// Weekly reference duration, read in hours and returned in minutes
export function weeklyReferenceMinutes(): number {
  const raw = process.env.WEEKLY_REFERENCE_HOURS;
  if (raw === undefined || raw === '') return 35 * 60;

  const hours = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  // Whole minutes only: 37.5 ok, 35.33 not
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168 || !Number.isInteger(hours * 60)) {
    throw new Error(
      'WEEKLY_REFERENCE_HOURS must be a positive number of hours, at most 168, in whole minutes (e.g. 37.5)'
    );
  }
  return hours * 60;
}
