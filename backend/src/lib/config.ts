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
