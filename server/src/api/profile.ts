import express from 'express';
import achievementService from '../services/AchievementService';
import { ACHIEVEMENTS } from '../util/achievements';
import auth from '../middleware/auth';
import { logger, LogEvent } from '../util/logger';
import type { Request } from 'express';
import type User from '../types/user';

const app = express();

// The signed-in user's own achievement profile (GitHub #121): the badge catalog,
// which of them they've unlocked, and their lifetime counters.
//
// Own-profile-only, and that falls out of the shape rather than a check: the route
// takes NO :userId param and reads the actor from their session, so there is no way
// to ask for someone else's profile and no authz decision to get wrong. Badges are
// a private retention surface — the public ranking data lives at /api/leaderboard.
//
// It sits at /api/profile rather than under /api/user because api/user.ts declares
// /api/user/:userId, which would capture a sibling path and try to load a user
// named "profile". Being under /api it still picks up the broad apiRateLimit.
//
// The whole CATALOG is served, not just the unlocked ids, so the UI holds zero
// per-badge knowledge: adding a badge stays a one-line server edit, and the page
// can render locked badges and progress bars (the actual retention hook) with no
// further round trip.
app.get('/api/profile', auth(true), async (req, res) => {
  try {
    // auth(true) guarantees a user; it also already carries the display fields, so
    // the profile needs no account lookup of its own.
    const user = (req as Request & { user: User }).user;
    const userId = user.getId();

    const [unlocked, counters] = await Promise.all([
      achievementService.getForUser(userId),
      achievementService.getCounters(userId),
    ]);

    res.json({
      user: { name: user.getName(), picture: user.getPicture() },
      catalog: ACHIEVEMENTS.map((a) => ({
        id: a.id,
        scope: a.scope,
        name: a.name,
        description: a.description,
        icon: a.icon,
        // Present only on counter badges — the UI uses the pair to draw progress
        // toward a locked one. `test` predicates are functions and stay server-side.
        counter: a.counter,
        threshold: a.threshold,
      })),
      unlocked: unlocked.map((u) => ({
        id: u.achievementId,
        appId: u.appId,
        unlockedTimestamp: u.unlockedTimestamp,
      })),
      counters,
    });
  } catch (err) {
    logger.error(
      { event: LogEvent.HTTP_ERROR, err },
      'failed to build profile'
    );
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

export default app;
