import { describe, it, expect, afterEach, vi } from 'vitest';
import { anomalyThresholdHours, appTimezone } from '../../../src/lib/config';

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
