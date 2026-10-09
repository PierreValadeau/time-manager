import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import errorHandler from './middlewares/errorHandler';
import notFound from './middlewares/notFound';

const app = express();

app.use(helmet());
app.use(express.json());
// Fills req.cookies, where authenticate reads the access token
app.use(cookieParser());

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Toujours en dernier : 404 puis gestionnaire d'erreurs
app.use(notFound);
app.use(errorHandler);

export default app;
