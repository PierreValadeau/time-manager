import { describe, it, expect } from 'vitest';
import { userIdParamSchema } from '../../../src/schemas/common.schema';

// UUID v4 from the contract (section 4) and a UUID v1 (time-based, 3rd group starts with 1)
const UUID_V4 = '8a1f6c2e-3b4d-4e5f-9a6b-7c8d9e0f1a2b';
const UUID_V1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// /users/:id and /users/:id/clocks...
describe('userIdParamSchema', () => {
  it('accepts the "me" alias', () => {
    expect(userIdParamSchema.parse({ id: 'me' })).toEqual({ id: 'me' });
  });

  it('accepts a UUID v4', () => {
    expect(userIdParamSchema.parse({ id: UUID_V4 })).toEqual({ id: UUID_V4 });
  });

  it.each([
    ['the alias in upper case', 'ME'],
    ['the alias in French', 'moi'],
    ['the alias with a space', ' me'],
    ['a UUID of another version', UUID_V1],
    ['a random string', 'not-a-uuid'],
    ['an empty string', ''],
  ])('rejects %s', (_label, id) => {
    const result = userIdParamSchema.safeParse({ id });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.path.join('.'))).toContain('id');
  });
});
