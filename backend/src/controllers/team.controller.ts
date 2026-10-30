import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { createTeam } from '../services/team.service';

// POST /teams
export const createTeamHandler: RequestHandler = async (req, res) => {
  // Set by authenticate; checked again so a route mounted without it fails closed
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }
  const team = await createTeam(req.user, req.body);
  res.status(201).json(team);
};
