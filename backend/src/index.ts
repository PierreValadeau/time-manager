import 'dotenv/config';
import app from './app';
import { anomalyThresholdHours, appTimezone } from './lib/config';

// Fail fast: an invalid setting stops the start instead of failing every request that reads it
anomalyThresholdHours();
appTimezone();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API sur le port ${port}`));
