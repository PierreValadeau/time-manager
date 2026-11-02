import type { RequestHandler } from 'express';
import type { ListTeamsQuery } from '../schemas/team.schema';
import AppError from '../errors/AppError';
import { createTeam, listTeams } from '../services/team.service';

// POST /teams
export const createTeamHandler: RequestHandler = async (req, res) => {
  // Set by authenticate; checked again so a route mounted without it fails closed
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise');
  }
  const team = await createTeam(req.user, req.body);
  res.status(201).json(team);
};

//GET /teams
export const listTeamsHandler: RequestHandler = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise'); 
  }

  //parsed by validate() with ListTeamsQuerySchema -> clock.controller.ts:62 
  const query = req.query as unknown as ListTeamsQuery; 
  res.json(await listTeams(req.user, query)); 
}; 
