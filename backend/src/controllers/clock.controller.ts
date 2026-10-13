import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { anomalyThresholdHours, appTimezone } from '../lib/config';
import type { ClockHistoryQuery } from '../schemas/clock.schema';
import {
  authorizeClockRead,
  getCurrentSession,
  listSessions,
  toggleClock,
} from '../services/clock.service';

// POST /clocks
export const toggleClockHandler: RequestHandler = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');
  }
  // The body is ignored: the time is the server's, never the client's
  const { action, session } = await toggleClock(req.user.id, new Date(), anomalyThresholdHours());
  res.status(action === 'clockIn' ? 201 : 200).json(session);
};

// GET /users/:id/clocks/current
export const getCurrentClockHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');
  }
  const userId = await authorizeClockRead(req.user, req.params.id);
  const session = await getCurrentSession(userId, new Date(), anomalyThresholdHours());
  res.json(session);
};

// GET /users/:id/clocks
export const listClocksHandler: RequestHandler<{ id: string }> = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');
  }
  const userId = await authorizeClockRead(req.user, req.params.id);
  // Parsed by validate() with clockHistoryQuerySchema: Express cannot type that itself
  const filters = req.query as unknown as ClockHistoryQuery;
  const result = await listSessions(userId, filters, {
    now: new Date(),
    anomalyThresholdHours: anomalyThresholdHours(),
    timezone: appTimezone(),
  });
  res.json(result);
};
