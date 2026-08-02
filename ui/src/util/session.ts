import axios from 'axios';
import type User from '../types/user';

// Establish (or silently refresh) the browser session from a Google credential.
// POSTs the credential to /api/session — the server verifies it and sets the
// HttpOnly `auth` cookie (the id token itself, ~1h TTL) — then loads the
// signed-in user (whoami → full profile). Shared by the initial sign-in and the
// background refresh so both establish the session identically. Resolves with
// the loaded User; rejects if any step fails (the caller decides whether that is
// worth surfacing — an interactive sign-in alerts, a background refresh stays
// quiet).
export const establishSession = async (credential: string): Promise<User> => {
  await axios.post('/api/session', { credential });
  const whoami = await axios.get('/api/user');
  const full = await axios.get(`/api/user/${whoami.data.id}`);
  return full.data as User;
};

// Decide what to do after a periodic session probe (`GET /api/user`) settles.
//
// A single failure must NOT sign the user out: it can be a transient network
// blip, a server 500 that deliberately leaves the cookie intact (see the auth
// middleware — a DB error is a 500, not a 401, and keeps the session), or the
// brief window while a silent token refresh is in flight. Only `threshold`
// consecutive failures clear the UI session; any success resets the count. This
// replaces the old poll that nuked the session on the very first failure.
export const nextSessionProbeState = (
  prevFailures: number,
  ok: boolean,
  threshold = 2
): { failures: number; clear: boolean } => {
  if (ok) return { failures: 0, clear: false };
  const failures = prevFailures + 1;
  return { failures, clear: failures >= threshold };
};
