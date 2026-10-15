import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, REFRESH_TOKEN_TTL_MS } from '../../../src/lib/token'; 

const token = 'testtestetstest'; 

describe('hashToken', () => {
    it('returns the same hash for the same token', () => {
        expect(hashToken(token)).toBe(hashToken(token)); 
    }); 

    it('returns a 64-character hex string', () => {
        expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/); 
    }); 

    it('returns different hashes for different tokens', () => {
        expect(hashToken(token)).not.toBe(hashToken('anothertestetstets')); 
    })

    it('does not return the raw token', () => {
        expect(hashToken(token)).not.toBe(token); 
    }); 

    it('mathes the SHA-256 of "abc"', () => {
        expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); //took it here: https://voltaire.tevm.sh/crypto/sha256/test-vectors
    }); 
}); 

describe('generateToken', () => {
    it('returns a url safe token of 43 chars', () => {
        expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/); 
    });

    it('returns a different token on each call', () => {
        expect(generateToken()).not.toBe(generateToken()); 
    });
}); 

describe('REFRESH_TOKEN_TTL_MS', () => {
    it('lasts 7 days', () => {
        expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000); 
    }); 
}); 