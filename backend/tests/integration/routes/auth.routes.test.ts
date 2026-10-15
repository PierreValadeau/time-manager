import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from '../../../src/app';
import prisma from '../../../src/lib/prisma';
import { verifyPassword } from '../../../src/lib/password';
import { verifyAccessToken } from '../../../src/lib/jwt';

// Integration test: the real app over HTTP, with only the database and bcrypt mocked
vi.mock('../../../src/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() }, refreshToken: { create: vi.fn() } },
}));
vi.mock('../../../src/lib/password', () => ({
  hashPassword: vi.fn().mockResolvedValue('dummy-hash'),
  verifyPassword: vi.fn(),
}));

// Only authLimiter is bypassed: it would block this file after 5 logins. It is tested in rateLimit.test.ts
vi.mock('../../../src/middlewares/rateLimit', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../src/middlewares/rateLimit')>()),
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));


const findUniqueMock = prisma.user.findUnique as unknown as Mock;
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
