import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authLimiter, userLimiter } from '../middlewares/rateLimit';
import validate from '../middlewares/validate';
import { loginSchema } from '../schemas/auth.schema';
import { loginHandler, logoutHandler, meHandler, refreshHandler } from '../controllers/auth.controller';

const router = Router();

// Contract, section 1: public route, no authenticate.
// Order matters: 429 (too many attempts) before 400 (invalid body) before 401 (wrong credentials)
router.post('/login', authLimiter, validate({ body: loginSchema }), loginHandler);

router.post('/refresh', refreshHandler); 

//No authenticate: logging out must work even with an expired access token
router.post('/logout', logoutHandler);

router.get('/me', authenticate, userLimiter, meHandler);


export default router;
