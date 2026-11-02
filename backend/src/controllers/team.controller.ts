import type { RequestHandler } from 'express';
import type { ListTeamsQuery } from '../schemas/team.schema';
import AppError from '../errors/AppError';
import { createTeam, listTeams, getTeam } from '../services/team.service';

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

//GET /teams/:id
export const getTeamHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentification requise'); 
  }

  res.json(await getTeam(req.user, req.params.id)); 
}; 
