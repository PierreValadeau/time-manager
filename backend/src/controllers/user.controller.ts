import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { createUser, listUsers, getUser, updateUser } from '../services/user.service';
import type { ListUsersQuery, UpdateUserInput } from '../schemas/user.schema';

// POST /users
export const createUserHandler: RequestHandler = async (req, res) => {
  // Set by authenticate; checked again so a route mounted without it fails closed
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }
  const user = await createUser(req.user, req.body);
  res.status(201).json(user);
};

// GET /users
export const listUsersHandler: RequestHandler = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }

  const query = req.query as unknown as ListUsersQuery; 
  res.json(await listUsers(req.user, query));
};

// GET /users/:id
export const getUserHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }

  const user = await getUser(req.user, req.params.id);
  res.json(user);
};

// PUT /users/:id
export const updateUserHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }

  const input = req.body as UpdateUserInput;
  res.json(await updateUser(req.user, req.params.id, input));
};
