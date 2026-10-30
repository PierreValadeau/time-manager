import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { createTeamSchema } from '../schemas/team.schema';
import { createTeamHandler } from '../controllers/team.controller';

const router = Router();

router.post(
  '/',
  authenticate,
  requireRole('manager', 'admin'),
  validate({ body: createTeamSchema }),
  createTeamHandler,
);

export default router;
