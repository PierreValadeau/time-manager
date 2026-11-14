import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  anomalyThresholdHours,
  appTimezone,
  lateToleranceMinutes,
  weeklyReferenceMinutes,
  workdayStartMinutes,
} from '../../../src/lib/config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('anomalyThresholdHours', () => {
  it('defaults to 14 h, as in the contract, when the variable is missing', () => {
    vi.stubEnv('ANOMALY_THRESHOLD_HOURS', undefined);
    expect(anomalyThresholdHours()).toBe(14);
  });

  it('defaults to 14 h when the variable is empty', () => {
    vi.stubEnv('ANOMALY_THRESHOLD_HOURS', '');
    expect(anomalyThresholdHours()).toBe(14);
  });

  it('reads ANOMALY_THRESHOLD_HOURS', () => {
    vi.stubEnv('ANOMALY_THRESHOLD_HOURS', '10');
    expect(anomalyThresholdHours()).toBe(10);
  });

  it.each(['abc', '0', '-3'])('throws on an invalid value (%s)', (value) => {
    vi.stubEnv('ANOMALY_THRESHOLD_HOURS', value);
    expect(() => anomalyThresholdHours()).toThrow('ANOMALY_THRESHOLD_HOURS');
  });
});

describe('appTimezone', () => {
  it('defaults to Europe/Paris, as in the contract', () => {
    vi.stubEnv('APP_TIMEZONE', undefined);
    expect(appTimezone()).toBe('Europe/Paris');
    vi.stubEnv('APP_TIMEZONE', '');
    expect(appTimezone()).toBe('Europe/Paris');
  });

  it('reads APP_TIMEZONE', () => {
    vi.stubEnv('APP_TIMEZONE', 'America/Montreal');
    expect(appTimezone()).toBe('America/Montreal');
  });

  it('throws on an unknown timezone', () => {
    vi.stubEnv('APP_TIMEZONE', 'Mars/Olympus');
    expect(() => appTimezone()).toThrow('APP_TIMEZONE');
  });
});

describe('workdayStartMinutes', () => {
  it('defaults to 09:00, as in the contract', () => {
    vi.stubEnv('WORKDAY_START', undefined);
    expect(workdayStartMinutes()).toBe(540);
    vi.stubEnv('WORKDAY_START', '');
    expect(workdayStartMinutes()).toBe(540);
  });

  it('reads WORKDAY_START as minutes since midnight', () => {
    vi.stubEnv('WORKDAY_START', '08:30');
    expect(workdayStartMinutes()).toBe(510);
    vi.stubEnv('WORKDAY_START', '00:00');
    expect(workdayStartMinutes()).toBe(0);
    vi.stubEnv('WORKDAY_START', '23:59');
    expect(workdayStartMinutes()).toBe(1439);
  });

  it.each(['9:00', '24:00', '09:60', '09:00:00', '0900', 'abc'])('throws on an invalid value (%s)', (value) => {
    vi.stubEnv('WORKDAY_START', value);
    expect(() => workdayStartMinutes()).toThrow('WORKDAY_START');
  });
});

describe('lateToleranceMinutes', () => {
  it('defaults to 5 minutes, as in the contract', () => {
    vi.stubEnv('LATE_TOLERANCE_MINUTES', undefined);
    expect(lateToleranceMinutes()).toBe(5);
    vi.stubEnv('LATE_TOLERANCE_MINUTES', '');
    expect(lateToleranceMinutes()).toBe(5);
  });

  it('reads LATE_TOLERANCE_MINUTES, 0 included', () => {
    vi.stubEnv('LATE_TOLERANCE_MINUTES', '10');
    expect(lateToleranceMinutes()).toBe(10);
    vi.stubEnv('LATE_TOLERANCE_MINUTES', '0');
    expect(lateToleranceMinutes()).toBe(0);
  });

  it.each(['abc', '-1', '2.5', ' ', '1e1', '1440'])('throws on an invalid value (%s)', (value) => {
    vi.stubEnv('LATE_TOLERANCE_MINUTES', value);
    expect(() => lateToleranceMinutes()).toThrow('LATE_TOLERANCE_MINUTES');
  });
});

describe('weeklyReferenceMinutes', () => {
  it('defaults to 35 h, as in the contract, returned in minutes', () => {
    vi.stubEnv('WEEKLY_REFERENCE_HOURS', undefined);
    expect(weeklyReferenceMinutes()).toBe(2100);
    vi.stubEnv('WEEKLY_REFERENCE_HOURS', '');
    expect(weeklyReferenceMinutes()).toBe(2100);
  });

  it('reads WEEKLY_REFERENCE_HOURS, half hours included', () => {
    vi.stubEnv('WEEKLY_REFERENCE_HOURS', '39');
    expect(weeklyReferenceMinutes()).toBe(2340);
    vi.stubEnv('WEEKLY_REFERENCE_HOURS', '37.5');
    expect(weeklyReferenceMinutes()).toBe(2250);
  });

  it.each(['abc', '0', '-35', '169', '35.33', ' ', '3.5e1'])('throws on an invalid value (%s)', (value) => {
    vi.stubEnv('WEEKLY_REFERENCE_HOURS', value);
    expect(() => weeklyReferenceMinutes()).toThrow('WEEKLY_REFERENCE_HOURS');
  });
});
