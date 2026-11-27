import { describe, it, expect } from 'vitest'; 
import {
    changePasswordSchema,
    forgotPasswordSchema,
    loginSchema,
    passwordSchema,
    resetPasswordSchema,
} from '../../../src/schemas/auth.schema';

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

describe('forgotPasswordSchema', () => {
    // Same normalization as the login: otherwise a mistyped case would never find the account
    it('lowercases and trims the email', () => {
        expect(forgotPasswordSchema.parse({ email: '  Jean@Mail.COM ' }).email).toBe('jean@mail.com');
    });

    it.each([
        ['a missing email', {}],
        ['an invalid email', { email: 'not-an-email' }],
    ])('rejects %s on the email field', (_label, input) => {
        const result = forgotPasswordSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['email']);
    });
});

describe('resetPasswordSchema', () => {
    const validReset = { token: 'a'.repeat(43), newPassword: 'a'.repeat(12) };

    it.each([
        ['a token from generateToken', validReset],
        ['a 256-character token', { ...validReset, token: 'a'.repeat(256) }],
        // Validity is checked by the service, so an unknown link gets "Lien invalide ou expiré"
        ['a short but non-empty token', { ...validReset, token: 'abc' }],
    ])('accepts %s', (_label, input) => {
        expect(resetPasswordSchema.safeParse(input).success).toBe(true);
    });

    it.each([
        ['an empty token', { ...validReset, token: '' }, 'token'],
        ['a 257-character token', { ...validReset, token: 'a'.repeat(257) }, 'token'],
        ['a missing token', { newPassword: validReset.newPassword }, 'token'],
        ['a new password under 12 characters', { ...validReset, newPassword: 'a'.repeat(11) }, 'newPassword'],
        ['a missing newPassword', { token: validReset.token }, 'newPassword'],
    ])('rejects %s on the %s field', (_label, input, field) => {
        const result = resetPasswordSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual([field]);
    });
});
