import express from 'express';
import appService from '../services/AppService';
import userService from '../services/UserService';
import { isUuid } from '../util/uuid';
import { publicOwnerName } from '../util/displayName';
import { sourceVersion } from '../util/sourceVersion';

// PUBLIC read-only view of an app whose owner made it public (GitHub #117):
// name, owner display name, ranked record, and the SOURCE. No authentication —
// this powers the /app/:appId page linked from the global rankings and from an
// arena roster, both of which are visible logged-out. It is the one place
// source leaves the owner gate, and it does so only on the owner's say-so:
// anything not flagged public is indistinguishable from a missing app (404),
// so the route cannot be used to probe which private ids exist.
//
// Mounted at /api/public (index.ts) rather than under /api/app, which is gated
// to signed-in users for the add-by-reference metadata lookup. Read-only: every
// write stays under the owner-gated /api/user tree.
const app = express();

app.get('/api/public/app/:appId', async (req, res) => {
  // Public, guessable URL: a mangled link should land on the friendly not-found
  // page, not a 400 body — so a non-UUID id is simply "not found" here.
  const appId = req.params.appId as string;
  const target = isUuid(appId) ? await appService.get(appId) : undefined;
  if (!target || !target.isPublic()) {
    res.status(404);
    res.send('Invalid app id');
    return;
  }
  const owner = await userService.get(target.getUserId());
  const games = target.getRatingGames();
  const wins = target.getRatingWins();
  res.json({
    id: target.getId(),
    name: target.getName(),
    // Abbreviated + profanity-checked, exactly as the rankings board shows it.
    // The owner's userId, email, and avatar are deliberately not included.
    ownerName: publicOwnerName(owner?.getName()),
    rating: Math.round(target.getRating()),
    games,
    wins,
    source: target.getSource(),
    // Content fingerprint of this source (the same `version` the MCP tools and
    // arena status report), so a reader can tell which revision they're seeing.
    version: sourceVersion(target.getSource()),
  });
});

export default app;
