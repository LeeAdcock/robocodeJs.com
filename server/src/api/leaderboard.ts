import express from 'express';
import appService from '../services/AppService';
import auth from '../middleware/auth';
import { logger, LogEvent } from '../util/logger';
import type { Request } from 'express';
import type User from '../types/user';

const app = express();

// Public global-ladder leaderboard (GitHub #151): the top rated bots across all
// users. Public by design — it's a spectating surface (linked from the main
// nav, visible logged-out) and exposes only bot name, owner display name, and
// record, never source. Each row carries an opaque `id` (sha256 of the app id)
// for the UI to key/color on; the REAL `appId` is included ONLY on rows the
// viewer owns, so the board never leaks other users' app ids. Optional auth
// (auth(false)) resolves a logged-in viewer from their cookie — anonymous
// otherwise. Covered by the broad apiRateLimit mounted on /api.
app.get('/api/leaderboard', auth(false), async (req, res) => {
  try {
    const viewerId = (req as Request & { user?: User }).user?.getId();
    const entries = await appService.getLeaderboard(20, viewerId);
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
