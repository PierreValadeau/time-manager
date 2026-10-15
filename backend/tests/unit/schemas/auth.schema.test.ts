import { describe, it, expect } from 'vitest'; 
import { loginSchema } from '../../../src/schemas/auth.schema'; 

const valid = { email: 'test@trinity.com', password: 'secret' }; 

describe('loginSchema', () => {
    it('lowercases and trims the email', () => {
        expect(loginSchema.parse({...valid, email: '   tesT@trinity.com '}).email).toBe('test@trinity.com');
    }); 

    it.each([
        ['an invalid email', { ...valid, email: 'not-an-email' }], 
        ['an empty password', { ...valid, password: '' }], 
        ['a password oven 128 charachers', { ...valid, password: 'a'.repeat(129) }], 
        ['a missing field', { email: valid.email }], 
    ])('rejects %s', (_label, input) => {
        expect(loginSchema.safeParse(input).success).toBe(false);
    });
}); 