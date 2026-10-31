import environmentService from '../services/EnvironmentService';
import homeService from '../services/HomeService';
import { forwardMetrics } from './forwarded';

// Point-in-time operational gauges shared by the /health endpoint and the
// periodic metrics log heartbeat. Deliberately cheap — one O(arenas)
// EnvironmentService.metrics() pass over already-maintained fields plus a single
// process.memoryUsage() read — so it's safe to call on every (frequent) ALB
// health check as well as on the interval.
const MB = 1024 * 1024;

export const collectMetrics = () => {
  const mem = process.memoryUsage();
  return {
    ...environmentService.metrics(),
    ...homeService.metrics(),
    ...forwardMetrics(),
    rssMB: Math.round(mem.rss / MB),
    heapUsedMB: Math.round(mem.heapUsed / MB),
  };
};
