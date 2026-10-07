import rateLimit from 'express-rate-limit';
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
