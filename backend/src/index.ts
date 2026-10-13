import 'dotenv/config';
import app from './app';
import { anomalyThresholdHours } from './lib/config';

// Fail fast: an invalid ANOMALY_THRESHOLD_HOURS stops the start instead of failing every POST /clocks
anomalyThresholdHours();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API sur le port ${port}`));
