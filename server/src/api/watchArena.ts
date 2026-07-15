import express from 'express';
import { resolvePublicArena } from '../middleware/resource';
import { getStatus, getSummary, getMatchStatus, events } from './arena';

// PUBLIC spectator routes: view a live arena by its UUID alone, with NO
// authentication and NO ownership check — the arena UUID acts as a bearer
// capability handed out via the UI "Share" button (see ui .../watch/:arenaId).
//
// These reuse the exact same read-only handlers as the owner-facing arena routes
// (arena.ts), which already depend only on the resolved arena (scopedArena) and
// never read the requesting user. The only difference is resolvePublicArena,
// which resolves by arenaId without tying it to a :userId. This router is mounted
// OUTSIDE the `/api/user` auth gate in index.ts, so anonymous visitors reach it;
// it still sits under the general `/api` apiRateLimit.
//
// Deliberately mounted here: the private, owner-only surfaces — bot console logs
// (`/logs`) and every mutation (pause/resume/restart/speed/seed, roster edits) —
// are NOT exposed. Spectators can watch, not control or read private output.
const app = express();

// Live status snapshot (positions, health, bot names, owner userIds — no source).
app.get('/api/arena/:arenaId', resolvePublicArena, getStatus);

// SSE stream of game events. The shared `events` handler removes its env listener
// on request close, so a spectator disconnecting cleans up after itself.
app.get('/api/arena/:arenaId/events', resolvePublicArena, events);

// Outcome-oriented match summary (leaderboard/winner/eliminations).
app.get('/api/arena/:arenaId/summary', resolvePublicArena, getSummary);

// Lightweight match status (decided flag, winner, coarse standings).
app.get('/api/arena/:arenaId/match-status', resolvePublicArena, getMatchStatus);

export default app;
