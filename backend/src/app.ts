import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import errorHandler from './middlewares/errorHandler';
import notFound from './middlewares/notFound';
import { apiLimiter } from './middlewares/rateLimit';
import clockRoutes from './routes/clock.routes';
import userRoutes from './routes/user.routes';
import userClockRoutes from './routes/userClock.routes';
import authRoutes from './routes/auth.routes'; 

const app = express();

app.use(helmet());
app.use(express.json());
// Fills req.cookies, where authenticate reads the access token
app.use(cookieParser());

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// CodeQL requires a limiter in front of authenticate
app.use('/api/v1', apiLimiter);

app.use('/api/v1/users', userRoutes);
app.use('/api/v1/clocks', clockRoutes);
app.use('/api/v1/users/:id/clocks', userClockRoutes);
app.use('/api/v1/auth', authRoutes); 

// Toujours en dernier : 404 puis gestionnaire d'erreurs
app.use(notFound);
app.use(errorHandler);

export default app;
