import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import AppError from '../../../src/errors/AppError';
import errorHandler from '../../../src/middlewares/errorHandler';
import { authenticate } from '../../../src/middlewares/auth';
import { ACCESS_TOKEN_COOKIE, signAccessToken } from '../../../src/lib/jwt';

const SECRET = 'test-secret-that-is-at-least-32-characters';
const user = { id: '8a1f6c2e-3b4d-4e5f-9a6b-7c8d9e0f1a2b', role: 'employee' as const };

// Runs the middleware on a fake request and returns what it did
const run = (req: Partial<Request>) => {
  const next = vi.fn();
  authenticate(req as Request, {} as Response, next);
  return { req, next };
};

const expectUnauthenticated = (next: ReturnType<typeof vi.fn>) => {
  expect(next).toHaveBeenCalledOnce();
  const err = next.mock.calls[0][0];
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
};

beforeEach(() => {
  vi.stubEnv('JWT_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('authenticate', () => {
  it('sets req.user from a valid access token cookie', () => {
    const { req, next } = run({ cookies: { [ACCESS_TOKEN_COOKIE]: signAccessToken(user) } });

    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a request without cookie (401)', () => {
    const { req, next } = run({ cookies: {} });
    expectUnauthenticated(next);
    expect(req.user).toBeUndefined();
  });

  it('rejects a request when cookies were not parsed (401)', () => {
    expectUnauthenticated(run({}).next);
  });

  it('rejects an invalid token (401)', () => {
    expectUnauthenticated(run({ cookies: { [ACCESS_TOKEN_COOKIE]: 'not-a-jwt' } }).next);
  });

  it('rejects a token signed with another secret (401)', () => {
    const forged = jwt.sign({ role: 'admin' }, 'another-secret-that-is-at-least-32-chars', { subject: user.id });
    expectUnauthenticated(run({ cookies: { [ACCESS_TOKEN_COOKIE]: forged } }).next);
  });

  it('rejects an expired token (401)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    const token = signAccessToken(user);
    vi.setSystemTime(new Date('2026-10-07T10:16:00Z'));

    expectUnauthenticated(run({ cookies: { [ACCESS_TOKEN_COOKIE]: token } }).next);
  });

  it('rejects a cookie that is not a string (401)', () => {
    expectUnauthenticated(run({ cookies: { [ACCESS_TOKEN_COOKIE]: { forged: true } } }).next);
  });

  it('ignores a token sent in the Authorization header (cookie only)', () => {
    const { next } = run({
      cookies: {},
      headers: { authorization: `Bearer ${signAccessToken(user)}` },
    });
    expectUnauthenticated(next);
  });

  it('lets a configuration error surface instead of answering 401', () => {
    vi.stubEnv('JWT_SECRET', '');
    expect(() => run({ cookies: { [ACCESS_TOKEN_COOKIE]: 'any' } })).toThrow('JWT_SECRET');
  });
});

// A real Express app, to check the middleware works with cookie-parser and the error handler
describe('authenticate in an Express app', () => {
  const request = async (cookie?: string) => {
    const app = express();
    app.use(cookieParser());
    app.get('/protected', authenticate, (req, res) => {
      res.json(req.user);
    });
    app.use(errorHandler);

    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/protected`, {
        headers: cookie ? { cookie } : {},
      });
      return { status: res.status, body: await res.json() };
    } finally {
      server.close();
    }
  };

  it('answers 200 with the user when the cookie holds a valid token', async () => {
    const res = await request(`${ACCESS_TOKEN_COOKIE}=${signAccessToken(user)}`);
    expect(res).toEqual({ status: 200, body: user });
  });

  it('answers 401 with the contract error format without cookie', async () => {
    const res = await request();
    expect(res).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Session absente ou expirée' } },
    });
  });
});
