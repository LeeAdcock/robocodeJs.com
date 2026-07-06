import express from 'express';
import { VERSION } from '../util/version';

const app = express();

// Health check. Includes the deployed server version so a deploy can be validated
// at a glance (curl /health) — it's the quickest way to confirm which build is
// actually live behind the load balancer.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION });
});

export default app;
