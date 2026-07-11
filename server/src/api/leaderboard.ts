import express from 'express';
import appService from '../services/AppService';
import { logger, LogEvent } from '../util/logger';

const app = express();

// Public global-ladder leaderboard (GitHub #151): the top rated bots across all
// users. Unauthenticated by design — it's a spectating surface (linked from the
// main nav, visible logged-out) and exposes only bot name, owner display name,
// and record, never source. Covered by the broad apiRateLimit mounted on /api.
app.get('/api/leaderboard', async (req, res) => {
  try {
    const entries = await appService.getLeaderboard(20);
    res.json(entries);
  } catch (err) {
    logger.error(
      { event: LogEvent.HTTP_ERROR, err },
      'failed to build leaderboard'
    );
    res.status(500).json({ error: 'Failed to load leaderboard.' });
  }
});

export default app;
