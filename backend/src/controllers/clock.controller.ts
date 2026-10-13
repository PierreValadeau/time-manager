import type { RequestHandler } from 'express';
import AppError from '../errors/AppError';
import { anomalyThresholdHours } from '../lib/config';
import { toggleClock } from '../services/clock.service';

// POST /clocks
export const toggleClockHandler: RequestHandler = async (req, res) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session absente ou expirée');
  }
  // The body is ignored: the time is the server's, never the client's
  const { action, session } = await toggleClock(req.user.id, new Date(), anomalyThresholdHours());
  res.status(action === 'clockIn' ? 201 : 200).json(session);
};
