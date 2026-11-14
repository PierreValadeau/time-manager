import 'dotenv/config';
import app from './app';
import {
  anomalyThresholdHours,
  appTimezone,
  lateToleranceMinutes,
  weeklyReferenceMinutes,
  workdayStartMinutes,
} from './lib/config';

// Fail fast: an invalid setting stops the start instead of failing every request that reads it
anomalyThresholdHours();
appTimezone();
workdayStartMinutes();
lateToleranceMinutes();
weeklyReferenceMinutes();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API sur le port ${port}`));
