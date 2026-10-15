import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  API_LIMIT_PER_MINUTE,
  apiLimiter,
  USER_LIMIT_PER_MINUTE,
  userLimiter,
} from '../../../src/middlewares/rateLimit';
import AppError from '../../../src/errors/AppError';
import errorHandler from '../../../src/middlewares/errorHandler';

// A fake authenticate: the x-user header plays the role of the access token
const buildApp = () => {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.header('x-user');
    if (id) req.user = { id, role: 'employee' };
    next();
  });
  app.get('/', userLimiter, (_req, res) => {
    res.json({ ok: true });
  });
  // apiLimiter runs before authentication: here every request is refused with 401
  app.get('/private', apiLimiter, (_req, _res, next) => {
    next(new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée'));
  });
  app.use(errorHandler);
  return app;
};

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = buildApp().listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await Promise.all(['user:alice', 'user:bob'].map(key => userLimiter.resetKey(key)));
});

const get = async (user?: string) => {
  const res = await fetch(baseUrl, { headers: user ? { 'x-user': user } : {} });
  return { status: res.status, headers: res.headers, body: await res.json() };
};

// Uses up the quota of a user (or of the IP without user)
const exhaust = async (user?: string) => {
  for (let i = 0; i < USER_LIMIT_PER_MINUTE; i++) {
    expect((await get(user)).status).toBe(200);
  }
};

describe('userLimiter', () => {
  it('answers 429 RATE_LIMITED once a user exceeds the limit', async () => {
    await exhaust('alice');

    const res = await get('alice');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('counts each user separately, even from the same IP', async () => {
    await exhaust('alice');
    expect((await get('alice')).status).toBe(429);
    expect((await get('bob')).status).toBe(200);
  });

  it('falls back to the IP without a user', async () => {
    await exhaust();
    expect((await get()).status).toBe(429);
    // A logged-in user from the same IP is not affected
    expect((await get('bob')).status).toBe(200);
  });
});

describe('apiLimiter', () => {
  it('limits requests per IP before authentication, even unauthenticated ones', async () => {
    for (let i = 0; i < API_LIMIT_PER_MINUTE; i++) {
      expect((await fetch(`${baseUrl}/private`)).status).toBe(401);
    }
    const res = await fetch(`${baseUrl}/private`);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe('RATE_LIMITED');
  });
});
