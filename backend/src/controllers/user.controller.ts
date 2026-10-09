import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { createUser } from '../services/user.service';

// POST /users
export const createUserHandler: RequestHandler = async (req, res) => {
  // Set by authenticate; checked again so a route mounted without it fails closed
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }
  const user = await createUser(req.user, req.body);
  res.status(201).json(user);
};
