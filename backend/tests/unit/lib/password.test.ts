import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/lib/password';

let hash: string;
const password = 'TestMotDePasseFort2027?';
//the hash password isn't the password 

beforeAll(async () => {
    hash = await hashPassword(password);
});

describe('hash the password', () => {
    it('does not return the real password', () => {
        expect(hash).not.toBe(password);
    });

    it('verifies the correct password', async () => {
        expect(await verifyPassword(password, hash)).toBe(true); 
    });

    it('rejects a wrong password', async () => {
        expect(await verifyPassword('WrongPass2025!', hash)).toBe(false);
    });
});
