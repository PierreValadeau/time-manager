import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth';
import validate from '../middlewares/validate';
import { createUserSchema, listUsersQuerySchema } from '../schemas/user.schema';
import { createUserHandler, getUserHandler, listUsersHandler } from '../controllers/user.controller';
import { userLimiter } from '../middlewares/rateLimit';
import { userIdParamSchema } from '../schemas/common.schema';

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

// Contract, section 4: managers and the admin; employees get 403 before the query is read
router.get(
  '/', 
  authenticate, 
  requireRole('manager', 'admin'), 
  validate({ query: listUsersQuerySchema }), 
  listUsersHandler,
);

// Contract, section 4: self, a manager or the admin; the scope is checked in the service
router.get(
  '/:id',
  authenticate,
  userLimiter,
  validate({ params: userIdParamSchema }),
  getUserHandler,
);

export default router;
