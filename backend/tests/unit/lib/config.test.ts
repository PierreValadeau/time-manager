import { describe, it, expect, afterEach, vi } from 'vitest';
import { anomalyThresholdHours } from '../../../src/lib/config';

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
