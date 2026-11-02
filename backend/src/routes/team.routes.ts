import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { idParamSchema } from '../schemas/common.schema';
import { createTeamSchema, listTeamsQuerySchema, updateTeamSchema } from '../schemas/team.schema';
import { createTeamHandler, getTeamHandler, listTeamsHandler, updateTeamHandler, deleteTeamHandler } from '../controllers/team.controller';

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

router.put(
  '/:id', 
  authenticate, 
  requireRole('manager', 'admin'), 
  validate({ params: idParamSchema, body: updateTeamSchema }), 
  updateTeamHandler,
); 

router.delete(
  '/:id', 
  authenticate, 
  requireRole('manager', 'admin'), 
  validate({ params: idParamSchema }), 
  deleteTeamHandler,
)

export default router;
