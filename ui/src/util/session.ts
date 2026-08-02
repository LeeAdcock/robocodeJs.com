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

// --- Deliberate sign-out ------------------------------------------------
//
// `auto_select: true` lets Google re-issue a credential with no user action,
// which is what makes the silent refresh possible — but it also means One Tap
// will happily sign a user straight back in the moment after they log out
// (Google's documented "UX dead loop"). `disableAutoSelect()` alone did not
// hold in practice, so we keep our own record of an intentional sign-out and
// refuse automatic credentials while it is set.
//
// Persisted in localStorage so it survives a page reload — an auto-select can
// fire on load, not just from our refresh timer. Every access is wrapped:
// localStorage throws in Safari private mode and when cookies are blocked, and
// a storage failure must never break sign-in.
const SIGNED_OUT_KEY = 'robocodejs.signedOut';

export const markSignedOut = (): void => {
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    /* storage unavailable — fall back to the in-session guards */
  }
};

export const clearSignedOut = (): void => {
  try {
    window.localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    /* storage unavailable */
  }
};

export const isSignedOutDeliberately = (): boolean => {
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY) === '1';
  } catch {
    return false;
  }
};

// How a Google credential came to us. GIS reports this on the credential
// response as `select_by`: 'auto' means Google picked the account with no user
// action at all (auto_select), while every other value ('btn', 'btn_confirm',
// 'user', 'user_1tap', …) involved a click or tap. This is a far more reliable
// discriminator than tracking "did we just ask for a refresh?" in a module
// flag, which stuck true whenever GIS declined to issue and then mislabelled
// the next real sign-in.
export type CredentialSource = 'auto' | 'interactive';

export const classifyCredential = (selectBy?: string): CredentialSource =>
  selectBy === 'auto' ? 'auto' : 'interactive';

// Should a credential that just arrived from Google be turned into a session?
// One the user actively chose: always. An automatic one: only if they have not
// deliberately signed out — otherwise the logout is undone within seconds.
export const shouldAcceptCredential = (
  source: CredentialSource,
  signedOutDeliberately: boolean
): boolean => source === 'interactive' || !signedOutDeliberately;
