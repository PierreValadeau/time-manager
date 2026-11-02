import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { idParamSchema } from '../schemas/common.schema';
import { createTeamSchema, listTeamsQuerySchema } from '../schemas/team.schema';
import { createTeamHandler, getTeamHandler, listTeamsHandler } from '../controllers/team.controller';

const router = Router();

router.post(
  '/',
  authenticate,
  requireRole('manager', 'admin'),
  validate({ body: createTeamSchema }),
  createTeamHandler,
);

router.get('/', authenticate, validate({ query: listTeamsQuerySchema }), listTeamsHandler); 

router.get('/:id', authenticate, validate({ params: idParamSchema}), getTeamHandler); 

export default router;
