import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
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

// Role check, always mounted after authenticate: router.post('/', authenticate, requireRole('manager', 'admin'), ...)
// It only checks the role: scope rules ("self", "manager of the team"...) are in services/scope.service.ts
export const requireRole = (...roles: UserRole[]): RequestHandler => {
  // requireRole() with no role would silently lock the route for everyone
  if (roles.length === 0) {
    throw new Error('requireRole() needs at least one role');
  }

  return (req, _res, next) => {
    // Mounted without authenticate: fail closed
    if (!req.user) {
      next(new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'Droits insuffisants pour cette action'));
      return;
    }
    next();
  };
};
