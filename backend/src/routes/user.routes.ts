import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { createUserSchema } from '../schemas/user.schema';
import { createUserHandler } from '../controllers/user.controller';

const router = Router();

// Contract, section 4: managers and the admin create accounts.
// Order matters: 401 (no session) before 403 (wrong role) before 400 (invalid body)
router.post(
  '/',
  authenticate,
  requireRole('manager', 'admin'),
  validate({ body: createUserSchema }),
  createUserHandler,
);

export default router;
