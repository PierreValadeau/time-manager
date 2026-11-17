import { describe, it, expect } from 'vitest';
import { escapeLike } from '../../../src/lib/escapeLike';

describe('escapeLike', () => {
  it.each([
    ['_', '\\_'],
    ['%', '\\%'],
    ['\\', '\\\\'],
  ])('escapes %s', (value, expected) => {
    expect(escapeLike(value)).toBe(expected);
  });

  it('escapes every special character once, wherever it is', () => {
    expect(escapeLike('a_b%c\\d__')).toBe('a\\_b\\%c\\\\d\\_\\_');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Durand-Lefèvre @trinity.com')).toBe('Durand-Lefèvre @trinity.com');
  });
});
