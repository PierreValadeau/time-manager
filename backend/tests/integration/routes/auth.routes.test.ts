import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import jwt from 'jsonwebtoken'; 
import { verifyPassword } from '../../../src/lib/password';
import { verifyAccessToken, signAccessToken } from '../../../src/lib/jwt';
import { hashToken } from '../../../src/lib/token';
import { authLimiter } from '../../../src/middlewares/rateLimit';

// Integration test: the real app over HTTP, with only the database and bcrypt mocked
vi.mock('../../../src/lib/prisma', () => {
  const db = {
    user: { findUnique: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));
  return { default: db };
});
vi.mock('../../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('dummy-hash'),
  verifyPassword: vi.fn(),
}));

// Only authLimiter is bypassed: it would block this file after 5 logins. It is tested in rateLimit.test.ts.
// A spy, so the tests can check which routes go through it
vi.mock('../../../src/middlewares/rateLimit', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/middlewares/rateLimit')>()),
  authLimiter: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));


const findUniqueMock = prisma.user.findUnique as unknown as Mock;
const findTokenMock = prisma.refreshToken.findUnique as unknown as Mock;
const revokeTokenMock = prisma.refreshToken.updateMany as unknown as Mock;
const verifyPasswordMock = verifyPassword as unknown as Mock;

const SECRET = 'test-secret-that-is-at-least-32-characters';
const input = { email: 'test.testy@trinity.com', password: 'secret' };
const dbUser = {
  id: '001', firstName: 'Test', lastName: 'Testy', email: input.email,
  phoneNumber: null, role: 'employee',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  memberships: [{ team: { id: 't1', name: 'Team A' } }],
  passwordHash: 'real-hash', deletedAt: null,
};


let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JWT_SECRET', SECRET);
  findUniqueMock.mockResolvedValue(dbUser);
  verifyPasswordMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// POST /api/v1/auth/login over HTTP
const login = async (payload: unknown) => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, cookies: res.headers.getSetCookie(), body: await res.json() };
};

const logout = async (cookieHeader?: string) => {
  const res = await fetch(`${baseUrl}/api/v1/auth/logout`, {
    method: 'POST',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return { status: res.status, cookies: res.headers.getSetCookie(), text: await res.text() };
};

// GET /api/v1/auth/me over HTTP, with the given Cookie header (if any)
const me = async (cookieHeader?: string) => {
  const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return { status: res.status, cookies: res.headers.getSetCookie(), body: await res.json() };
};


const isCleared = (c: string | undefined) => /Expires=Thu, 01 Jan 1970/.test(c ?? '');


const cookie = (cookies: string[], name: string) => cookies.find(c => c.startsWith(`${name}=`));

describe('POST /api/v1/auth/login: success', () => {
  it('answers 200 with the profile and no token in the body', async () => {
    const res = await login({ email: 'Jean.Dupont@Trinity.com', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: '001', firstName: 'Test', lastName: 'Testy',
      email: 'test.testy@trinity.com', phoneNumber: null, role: 'employee',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      teams: [{ id: 't1', name: 'Team A' }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/token|hash/i);
  });

  it('looks the user up with the normalized email', async () => {
    await login({ email: '  test.Testy@Trinity.com ', password: 'secret' });
    expect(findUniqueMock.mock.lastCall![0].where).toEqual({ email: 'test.testy@trinity.com' });
  });

  it('sets both cookies as httpOnly, Secure and SameSite=Strict', async () => {
    const { cookies } = await login({ email: dbUser.email, password: 'secret' });
    const access = cookie(cookies, 'access_token');
    const refresh = cookie(cookies, 'refresh_token');

    for (const c of [access, refresh]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/SameSite=Strict/);
    }
    expect(access).toMatch(/Max-Age=900/);
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refresh).toMatch(/Max-Age=604800/);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('sets an access token that authenticate accepts', async () => {
    const { cookies } = await login({ email: dbUser.email, password: 'secret' });
    const token = cookie(cookies, 'access_token')!.split(';')[0].split('=')[1];
    expect(verifyAccessToken(token)).toEqual({ id: '001', role: 'employee' });
  });

  it('goes through authLimiter', async () => {
    await login(input); 
    expect(authLimiter).toHaveBeenCalled(); 
  })
});

describe('POST /api/v1/auth/login: failures', () => {
  it('answers 400 on an invalid body, before touching the database', async () => {
    const res = await login({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('answers the same 401 for a wrong password and an unknown email, without cookies', async () => {
    verifyPasswordMock.mockResolvedValue(false);
    const wrongPassword = await login({ email: dbUser.email, password: 'wrong' });

    findUniqueMock.mockResolvedValue(null);
    const unknownEmail = await login({ email: 'nobody@trinity.com', password: 'secret' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.cookies).toHaveLength(0);
    }
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});

// POST /api/v1/auth/refresh over HTTP, with the given Cookie header (if any)
const refresh = async (cookieHeader?: string) => {
  const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  return { status: res.status, cookies: res.headers.getSetCookie(), text: await res.text() };
};

const tokenRow = {
  id: 'rt1', userId: '001', tokenHash: hashToken('old-token'),
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000), revokedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  user: { id: '001', role: 'employee', deletedAt: null },
};

describe('POST /api/v1/auth/refresh: success', () => {
  beforeEach(() => {
    findTokenMock.mockResolvedValue(tokenRow);
    revokeTokenMock.mockResolvedValue({ count: 1 });
  });

  it('answers 204 with an empty body', async () => {
    const res = await refresh('refresh_token=old-token');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  it('reads the refresh_token cookie and looks it up by its hash', async () => {
    await refresh('refresh_token=old-token');
    expect(findTokenMock.mock.lastCall![0].where).toEqual({ tokenHash: hashToken('old-token') });
  });

  it('sets both cookies again, with the same attributes as login', async () => {
    const { cookies } = await refresh('refresh_token=old-token');
    const access = cookie(cookies, 'access_token');
    const newRefresh = cookie(cookies, 'refresh_token');

    for (const c of [access, newRefresh]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/SameSite=Strict/);
    }
    expect(access).toMatch(/Max-Age=900/);
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(newRefresh).toMatch(/Max-Age=604800/);
    expect(newRefresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(newRefresh).not.toMatch(/^refresh_token=old-token;/);
  });

  it('sets an access token that authenticate accepts', async () => {
    const { cookies } = await refresh('refresh_token=old-token');
    const token = cookie(cookies, 'access_token')!.split(';')[0].split('=')[1];
    expect(verifyAccessToken(token)).toEqual({ id: '001', role: 'employee' });
  });

  it('works without an access token: no authenticate on this route', async () => {
    const res = await refresh('refresh_token=old-token');
    expect(res.status).toBe(204);
  });

  it('does not go through authLimiter, shared with login and keyed by IP', async () => {
    await refresh('refresh_token=old-token');
    expect(authLimiter).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/refresh: failures', () => {
  it('answers 401 without cookies when no refresh_token cookie is sent', async () => {
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Session absente ou expirée' });
    expect(res.cookies).toHaveLength(0);
    expect(findTokenMock).not.toHaveBeenCalled();
  });

  it('answers 401 without cookies for an unknown token', async () => {
    findTokenMock.mockResolvedValue(null);
    const res = await refresh('refresh_token=unknown');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error.code).toBe('UNAUTHENTICATED');
    expect(res.cookies).toHaveLength(0);
  });
});

describe('POST /api/v1/auth/logout', () => {
  beforeEach(() => {
    revokeTokenMock.mockResolvedValue({ count: 1 });  
  });

  it('answers 204 and revokes the token by its hash', async () => {
    const res = await logout('refresh_token=old-token');   

    expect(res.status).toBe(204);                          
    expect(res.text).toBe('');
    expect(revokeTokenMock.mock.lastCall![0].where)
      .toEqual({ tokenHash: hashToken('old-token'), revokedAt: null });
  });

  it('clears both cookies on their own path', async () => {
    const res = await logout('refresh_token=old-token');
    const access = cookie(res.cookies, 'access_token'); 
    const refreshCookie = cookie(res.cookies, 'refresh_token');
    
    expect(isCleared(access)).toBe(true);
    expect(isCleared(refreshCookie)).toBe(true);
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('answers 204 and clears the cookies even without a cookie', async () => {
    const res = await logout();

    expect(res.status).toBe(204);
    expect(isCleared(cookie(res.cookies, 'access_token'))).toBe(true);
    expect(isCleared(cookie(res.cookies, 'refresh_token'))).toBe(true);
    expect(revokeTokenMock).not.toHaveBeenCalled();
  });

  it('does not go through authLimiter, shared with login and keyed by IP', async () => {
    await logout('refresh_token=old-token');
    expect(authLimiter).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/auth/me', () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({ ...dbUser, passwordHash: undefined });
  });

  it('answers 200 with the full profile and no secret in the body', async () => {
    const token = signAccessToken({ id: '001', role: 'employee' });
    const res = await me(`access_token=${token}`);
    expect(res.status).toBe(200); 
    expect(res.body).toEqual({
      id: '001', firstName: 'Test', lastName: 'Testy',
      email: 'test.testy@trinity.com', phoneNumber: null, role: 'employee',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      teams: [{ id: 't1', name: 'Team A' }],
    });
    
    expect(JSON.stringify(res.body)).not.toMatch(/token|hash|deletedAt/i); 
  });

  it('looks up the user from the token, not from the request', async () => {
    const token = signAccessToken({ id: '001', role: 'employee' });
    await me(`access_token=${token}`);
    expect(findUniqueMock.mock.lastCall![0].where)
      .toEqual({ id: '001' }); 
  });

  it('answers 401 without an access token, before touching the database', async () => {
    const res = await me();
    expect(res.status).toBe(401); 
    expect(res.body.error.code).toBe('UNAUTHENTICATED'); 
    expect(findUniqueMock).not.toHaveBeenCalled(); 
  });

  it('answers 401 for an expired access token', async () => {
    const expired = jwt.sign({ role: 'employee' }, SECRET, { subject: '001', expiresIn: -10, algorithm: 'HS256' });
    const res = await me(`access_token=${expired}`); 
    expect(res.status).toBe(401); 
    expect(findUniqueMock).not.toHaveBeenCalled(); 
  });

  it('answers 401 for a token signed with another secret', async () => {
    const forged = jwt.sign({ role: 'admin' }, 'another-secret-that-is-at-least-32-chars', { subject: '001', algorithm: 'HS256' });
    const res = await me(`access_token=${forged}`); 
    expect(res.status).toBe(401); 
    expect(findUniqueMock).not.toHaveBeenCalled(); 
  });

  it('answers 401 when the account was deleted after the token was issued', async () => {
    findUniqueMock.mockResolvedValue({ ...dbUser, passwordHash: undefined, deletedAt: new Date() });
    const token = signAccessToken({ id: '001', role: 'employee' });
    const res = await me(`access_token=${token}`); 
    expect(res.status).toBe(401); 
  });

  it('does not touch the cookies', async () => {
    const token = signAccessToken({ id: '001', role: 'employee' });
    const res = await me(`access_token=${token}`);
    expect(res.cookies.length).toBe(0); 
  });
});


