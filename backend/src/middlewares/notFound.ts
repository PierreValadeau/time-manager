import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';

const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} introuvable`));
};

export default notFound;
