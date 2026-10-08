import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '../lib/jwt';

// Contract, section 1: the session lives in an httpOnly cookie, never in an Authorization header
export const authenticate: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[ACCESS_TOKEN_COOKIE];
  const user = typeof token === 'string' ? verifyAccessToken(token) : null;

  if (!user) {
    next(new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée'));
    return;
  }

  req.user = user;
  next();
};
