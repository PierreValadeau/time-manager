import { Router } from 'express';
import { correctClockHandler, toggleClockHandler } from '../controllers/clock.controller';
import { authenticate, requireRole } from '../middlewares/auth';
import { userLimiter } from '../middlewares/rateLimit';
import validate from '../middlewares/validate';
import { correctClockSchema } from '../schemas/clock.schema';
import { idParamSchema } from '../schemas/common.schema';

const router = Router();

// Contract, section 6: employees and managers clock; the admin never does
router.post('/', authenticate, requireRole('employee', 'manager'), toggleClockHandler);

// Contract, section 6: manager of the employee or admin.
router.put(
  '/:id',
  authenticate,
  userLimiter,
  requireRole('manager', 'admin'),
  validate({ params: idParamSchema, body: correctClockSchema }),
  correctClockHandler
);

export default router;
