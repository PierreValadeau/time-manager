import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import { toggleClockHandler } from '../controllers/clock.controller';

const router = Router();

// Contract, section 6: employees and managers clock; the admin never does
router.post('/', authenticate, requireRole('employee', 'manager'), toggleClockHandler);

export default router;
