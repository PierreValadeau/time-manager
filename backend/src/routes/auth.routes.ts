import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authLimiter, userLimiter, forgotPasswordLimiter } from '../middlewares/rateLimit';
import validate from '../middlewares/validate';
import { changePasswordSchema, forgotPasswordSchema, loginSchema } from '../schemas/auth.schema';
import { changePasswordHandler, forgotPasswordHandler, loginHandler, logoutHandler, meHandler, refreshHandler } from '../controllers/auth.controller';

const router = Router();

// Contract, section 1: public route, no authenticate.
// Order matters: 429 (too many attempts) before 400 (invalid body) before 401 (wrong credentials)
router.post('/login', authLimiter, validate({ body: loginSchema }), loginHandler);

router.post('/refresh', refreshHandler); 

//No authenticate: logging out must work even with an expired access token
router.post('/logout', logoutHandler);

router.get('/me', authenticate, userLimiter, meHandler);

router.put('/password', authenticate, userLimiter, validate({ body: changePasswordSchema }), changePasswordHandler);

router.post('/password/forgot', forgotPasswordLimiter, validate({ body: forgotPasswordSchema }), forgotPasswordHandler);

export default router;
