import express from 'express';
import { VERSION } from '../util/version';
import { collectMetrics } from '../util/metrics';

const app = express();

// Health check. Includes the deployed server version so a deploy can be validated
// at a glance (curl /health) — it's the quickest way to confirm which build is
// actually live behind the load balancer.
//
// It also carries lightweight operational gauges (arena/isolate counts, busiest
// arena's tick time, process memory) via collectMetrics — deliberately O(arenas)
// reads of already-maintained fields plus one process.memoryUsage() call, cheap
// enough to run on every frequent ALB health check with no heavy per-request work.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptimeSec: Math.round(process.uptime()),
    metrics: collectMetrics(),
  });
});

export default app;
