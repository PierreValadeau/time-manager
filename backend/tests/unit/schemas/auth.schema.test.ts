import { describe, it, expect } from 'vitest'; 
import { changePasswordSchema, loginSchema, passwordSchema } from '../../../src/schemas/auth.schema';

const valid = { email: 'test@trinity.com', password: 'secret' }; 

describe('loginSchema', () => {
    it('lowercases and trims the email', () => {
        expect(loginSchema.parse({...valid, email: '   tesT@trinity.com '}).email).toBe('test@trinity.com');
    }); 

    it.each([
        ['an invalid email', { ...valid, email: 'not-an-email' }], 
        ['an empty password', { ...valid, password: '' }], 
        ['a password over 128 characters', { ...valid, password: 'a'.repeat(129) }],
        ['a missing field', { email: valid.email }],
    ])('rejects %s', (_label, input) => {
        expect(loginSchema.safeParse(input).success).toBe(false);
    });
});

// Contract, section 3: a new password has at least 12 characters (128 max, like the login)
describe('passwordSchema', () => {
    it.each([
        ['exactly 12 characters', 'a'.repeat(12)],
        ['exactly 128 characters', 'a'.repeat(128)],
    ])('accepts %s', (_label, password) => {
        expect(passwordSchema.safeParse(password).success).toBe(true);
    });

    it.each([
        ['11 characters', 'a'.repeat(11)],
        ['129 characters', 'a'.repeat(129)],
    ])('rejects %s', (_label, password) => {
        expect(passwordSchema.safeParse(password).success).toBe(false);
    });

    it('keeps leading and trailing spaces: they are part of the password', () => {
        const password = `  ${'a'.repeat(12)}  `;
        expect(passwordSchema.parse(password)).toBe(password);
    });
});

describe('changePasswordSchema', () => {
    const validChange = { currentPassword: 'secret', newPassword: 'a'.repeat(12) };

    it('accepts a short current password: a wrong one must give 401, not 400', () => {
        expect(changePasswordSchema.safeParse(validChange).success).toBe(true);
    });

    it.each([
        ['an empty current password', { ...validChange, currentPassword: '' }],
        ['a new password under 12 characters', { ...validChange, newPassword: 'a'.repeat(11) }],
        ['a missing currentPassword', { newPassword: validChange.newPassword }],
        ['a missing newPassword', { currentPassword: validChange.currentPassword }],
    ])('rejects %s', (_label, input) => {
        expect(changePasswordSchema.safeParse(input).success).toBe(false);
    });
});
