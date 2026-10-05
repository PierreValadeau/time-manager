
import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API sur le port ${port}`));
