import { Router } from 'express';
import { authLimiter } from '../middlewares/rateLimit';
import validate from '../middlewares/validate';
import { loginSchema } from '../schemas/auth.schema';
import { loginHandler } from '../controllers/auth.controller';

const router = Router();

// Contract, section 1: public route, no authenticate.
// Order matters: 429 (too many attempts) before 400 (invalid body) before 401 (wrong credentials)
router.post('/login', authLimiter, validate({ body: loginSchema }), loginHandler);

export default router;
