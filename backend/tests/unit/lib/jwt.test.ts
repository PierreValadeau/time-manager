import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken } from '../../../src/lib/jwt';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const user = { id: '8a1f6c2e-3b4d-4e5f-9a6b-7c8d9e0f1a2b', role: 'manager' as const };

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('signAccessToken / verifyAccessToken', () => {
  it('returns the user id and role from a token it signed', () => {
    expect(verifyAccessToken(signAccessToken(user))).toEqual(user);
  });

  it('puts the user id in the standard "sub" claim', () => {
    expect(jwt.decode(signAccessToken(user))).toMatchObject({ sub: user.id, role: 'manager' });
  });

  it('keeps the token valid just before 15 minutes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const token = signAccessToken(user);

    vi.setSystemTime(new Date('2026-10-07T10:14:59Z'));
    expect(verifyAccessToken(token)).toEqual(user);
  });

  it('rejects the token once 15 minutes have passed', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const token = signAccessToken(user);

    vi.setSystemTime(new Date('2026-10-07T10:15:01Z'));
    expect(verifyAccessToken(token)).toBeNull();
  });
});

describe('verifyAccessToken: forged tokens', () => {
  it('rejects a token signed with another secret', () => {
    const token = jwt.sign({ role: 'admin' }, 'another-secret-that-is-at-least-32-chars', { subject: user.id });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token whose role was changed after signing', () => {
    const [header, , signature] = signAccessToken(user).split('.');
    const tampered = `${header}.${base64url({ sub: user.id, role: 'admin' })}.${signature}`;
    expect(verifyAccessToken(tampered)).toBeNull();
  });

  it('rejects an unsigned token (alg "none")', () => {
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: user.id, role: 'admin' })}.`;
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token signed with another algorithm', () => {
    const token = jwt.sign({ role: 'admin' }, SECRET, { subject: user.id, algorithm: 'HS512' });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token with an unknown role', () => {
    const token = jwt.sign({ role: 'superuser' }, SECRET, { subject: user.id });
    expect(verifyAccessToken(token)).toBeNull();
  });

  it('rejects a token without a subject', () => {
    const token = jwt.sign({ role: 'manager' }, SECRET);
    expect(verifyAccessToken(token)).toBeNull();
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects the malformed token "%s"', token => {
    expect(verifyAccessToken(token)).toBeNull();
  });
});

describe('JWT_SECRET configuration', () => {
  it.each([
    ['missing', undefined],
    ['too short', 'short-secret'],
  ])('refuses to sign or verify when the secret is %s', (_label, secret) => {
    vi.stubEnv('JWT_SECRET', secret);
    expect(() => signAccessToken(user)).toThrow('JWT_SECRET');
    expect(() => verifyAccessToken('any.token.value')).toThrow('JWT_SECRET');
  });
});
