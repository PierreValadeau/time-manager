import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { createUserSchema, updateUserSchema } from '../../../src/schemas/user.schema';

const valid = { firstName: 'Jean', lastName: 'Dupont', email: 'jean.dupont@trinity.com' };

// Returns the fields in error, to check WHICH field is rejected
const failingFields = (input: unknown, schema: z.ZodType = createUserSchema) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'));
};

describe('createUserSchema', () => {
  it('defaults role to employee', () => {
    expect(createUserSchema.parse(valid).role).toBe('employee');
  });

  it('lowercases and trims the email', () => {
    const data = createUserSchema.parse({ ...valid, email: '  Jean.DUPONT@Trinity.com ' });
    expect(data.email).toBe('jean.dupont@trinity.com');
  });

  it('trims first and last names', () => {
    const data = createUserSchema.parse({ ...valid, firstName: ' Jean ', lastName: ' Dupont ' });
    expect(data).toMatchObject({ firstName: 'Jean', lastName: 'Dupont' });
  });

  it('strips a password sent at creation', () => {
    const data = createUserSchema.parse({ ...valid, password: 'secret' });
    expect(data).not.toHaveProperty('password');
  });

  it.each(['employee', 'manager'])('accepts role %s', role => {
    expect(createUserSchema.parse({ ...valid, role }).role).toBe(role);
  });

  it('accepts an E.164 phone number', () => {
    expect(createUserSchema.parse({ ...valid, phoneNumber: '+33612345678' }).phoneNumber)
      .toBe('+33612345678');
  });

  it.each([
    ['the admin role', { role: 'admin' }, 'role'],
    ['an unknown role', { role: 'superuser' }, 'role'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['an email longer than 255 chars', { email: `${'a'.repeat(250)}@x.com` }, 'email'],
    ['a blank first name', { firstName: '   ' }, 'firstName'],
    ['a last name longer than 100 chars', { lastName: 'a'.repeat(101) }, 'lastName'],
    ['a non-E.164 phone number', { phoneNumber: '06 12 34 56 78' }, 'phoneNumber'],
    ['a phone number with more than 15 digits', { phoneNumber: '+3361234567890123' }, 'phoneNumber'],
  ])('rejects %s', (_label, override, field) => {
    expect(failingFields({ ...valid, ...override })).toContain(field);
  });

  it('reports every missing required field', () => {
    expect(failingFields({})).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email']));
  });
});

// PUT /users/:id: same fields as the creation, but role and phoneNumber may be left out
describe('updateUserSchema', () => {
  it('has no default role: a missing role must leave the current one untouched', () => {
    expect(updateUserSchema.parse(valid)).not.toHaveProperty('role');
  });

  it.each(['employee', 'manager'])('accepts role %s', role => {
    expect(updateUserSchema.parse({ ...valid, role }).role).toBe(role);
  });

  it('leaves out a missing phone number, so the stored one is kept', () => {
    expect(updateUserSchema.parse(valid)).not.toHaveProperty('phoneNumber');
  });

  it('accepts a null phone number, to clear it', () => {
    expect(updateUserSchema.parse({ ...valid, phoneNumber: null }).phoneNumber).toBeNull();
  });

  it('accepts an E.164 phone number', () => {
    expect(updateUserSchema.parse({ ...valid, phoneNumber: '+33612345678' }).phoneNumber)
      .toBe('+33612345678');
  });

  it('lowercases and trims the email, like the creation', () => {
    const data = updateUserSchema.parse({ ...valid, email: '  Jean.DUPONT@Trinity.com ' });
    expect(data.email).toBe('jean.dupont@trinity.com');
  });

  it('strips the fields an update must never write', () => {
    const data = updateUserSchema.parse({
      ...valid,
      id: '8a1f6c2e-3b4d-4e5f-9a6b-7c8d9e0f1a2b',
      passwordHash: '$2b$12$hash',
      microsoftId: 'microsoft-id',
      deletedAt: '2026-10-05T08:00:00Z',
    });
    expect(Object.keys(data).sort()).toEqual(['email', 'firstName', 'lastName']);
  });

  it.each([
    ['the admin role', { role: 'admin' }, 'role'],
    ['an unknown role', { role: 'superuser' }, 'role'],
    ['a non-E.164 phone number', { phoneNumber: '06 12 34 56 78' }, 'phoneNumber'],
    ['an empty phone number (null clears it)', { phoneNumber: '' }, 'phoneNumber'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['a blank first name', { firstName: '   ' }, 'firstName'],
  ])('rejects %s', (_label, override, field) => {
    expect(failingFields({ ...valid, ...override }, updateUserSchema)).toContain(field);
  });

  it('requires every editable field (PUT, contract section 1)', () => {
    expect(failingFields({}, updateUserSchema)).toEqual(
      expect.arrayContaining(['firstName', 'lastName', 'email']),
    );
  });
});
