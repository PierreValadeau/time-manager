import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import AppError from '../errors/AppError';

// 5 tentatives par 15 minutes et par IP (contrat, section 3) : login et mot de passe oublié
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'RATE_LIMITED', 'Trop de tentatives, réessayez plus tard'));
  },
});

// Authenticated API routes: 120 requests per minute and per user. Placed after authenticate,
// so the key is the user, not the IP: employees of the same office share one IP.
export const USER_LIMIT_PER_MINUTE = 120;

export const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: USER_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
  handler: (_req, _res, next) => {
    next(new AppError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez dans une minute'));
  },
});

// Every /api/v1 route, before authenticate: 1000 requests per minute and per IP. Generous on
// purpose: a whole office can share one IP.
export const API_LIMIT_PER_MINUTE = 1000;

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: API_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'RATE_LIMITED', 'Trop de requêtes, réessayez dans une minute'));
  },
});
