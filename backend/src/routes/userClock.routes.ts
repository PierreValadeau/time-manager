import { Router } from 'express';
import { getCurrentClockHandler, listClocksHandler } from '../controllers/clock.controller';
import { authenticate } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { clockHistoryQuerySchema, userIdParamSchema } from '../schemas/clock.schema';

// Mounted on /users/:id/clocks: mergeParams exposes the parent :id here
const router = Router({ mergeParams: true });

// Contract, section 6: self, manager of the employee or admin.
router.get(
  '/current',
  authenticate,
  validate({ params: userIdParamSchema }),
  getCurrentClockHandler
);

router.get(
  '/',
  authenticate,
  validate({ params: userIdParamSchema, query: clockHistoryQuerySchema }),
  listClocksHandler
);

export default router;
