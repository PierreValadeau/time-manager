import { describe, it, expect } from 'vitest';
import { correctClockSchema, MAX_REASON_LENGTH } from '../../../src/schemas/clock.schema';

const valid = {
  clockIn: '2026-10-05T07:00:00Z',
  clockOut: '2026-10-05T15:30:00Z',
  reason: 'Oubli de pointage au départ',
};

// Returns the fields in error, to check WHICH field is rejected
const failingFields = (input: unknown) => {
  const result = correctClockSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'));
};

describe('correctClockSchema', () => {
  it('parses the dates into Date objects and trims the reason', () => {
    const data = correctClockSchema.parse({ ...valid, reason: '  Oubli  ' });
    expect(data).toEqual({
      clockIn: new Date('2026-10-05T07:00:00Z'),
      clockOut: new Date('2026-10-05T15:30:00Z'),
      reason: 'Oubli',
    });
  });

  it('accepts an offset and milliseconds', () => {
    const data = correctClockSchema.parse({ ...valid, clockIn: '2026-10-05T09:00:00.250+02:00' });
    expect(data.clockIn).toEqual(new Date('2026-10-05T07:00:00.250Z'));
  });

  it.each(['clockIn', 'clockOut', 'reason'])('requires %s', field => {
    const input: Record<string, string> = { ...valid };
    delete input[field];
    expect(failingFields(input)).toContain(field);
  });

  it('refuses a null clockOut: a correction closes the session', () => {
    expect(failingFields({ ...valid, clockOut: null })).toContain('clockOut');
  });

  it.each(['', '   '])('refuses a blank reason (%j)', reason => {
    expect(failingFields({ ...valid, reason })).toEqual(['reason']);
  });

  it('refuses a reason that is too long', () => {
    expect(failingFields({ ...valid, reason: 'a'.repeat(MAX_REASON_LENGTH + 1) })).toEqual(['reason']);
    expect(failingFields({ ...valid, reason: 'a'.repeat(MAX_REASON_LENGTH) })).toEqual([]);
  });

  it.each(['2026-10-05', '2026-10-05T07:00:00', 'yesterday', 1759647600000])(
    'refuses a clockIn that is not an ISO instant (%j)',
    clockIn => {
      expect(failingFields({ ...valid, clockIn })).toEqual(['clockIn']);
    }
  );

  it('refuses a clockOut before the clockIn', () => {
    expect(failingFields({ ...valid, clockOut: '2026-10-05T06:59:59Z' })).toEqual(['clockOut']);
  });

  it('refuses a clockOut equal to the clockIn', () => {
    expect(failingFields({ ...valid, clockOut: valid.clockIn })).toEqual(['clockOut']);
  });

  it('accepts a session longer than the anomaly threshold', () => {
    expect(failingFields({ ...valid, clockOut: '2026-10-06T01:00:00Z' })).toEqual([]);
  });
});
