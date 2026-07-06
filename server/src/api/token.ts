import express from 'express';
import { randomUUID } from 'node:crypto';

import auth, { AuthenticatedRequest, hashToken } from '../middleware/auth';
import identityService from '../services/IdentityService';
import { logger, LogEvent } from '../util/logger';

const app = express();

// A user's single API token, used by non-browser clients (the MCP server) via
// `Authorization: Bearer <token>`. The token itself is shown exactly once at
// generation; only its sha256 hash is stored (as an 'apikey' identity), so it
// can never be retrieved again — losing it means regenerating. "Revoke" is just
// regeneration, which overwrites the old hash so the previous token stops
// working immediately.
//
// These routes are gated by auth(true) directly (they live outside the
// `/api/user` global gate) and act on the authenticated user. Minting requires a
// browser session because the session cookie is HttpOnly and can't be replayed
// outside the browser — so this is the only way to bootstrap a token.
const SOURCE = 'apikey';

// Mint a fresh token for the user: overwrite any existing one (so the old token
// stops working) and return the new plaintext. Shared by the POST endpoint and
// the browser-friendly GET below.
const mintToken = async (
  req: express.Request,
  res: express.Response
): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;
  const token = randomUUID();
  await identityService.deleteForUser(user.getId(), SOURCE);
  await identityService.create(user.getId(), SOURCE, hashToken(token));
  logger.info(
    { event: LogEvent.AUTH_TOKEN_CREATED, userId: user.getId() },
    'API token created'
  );
  // Never let an intermediary or the browser cache a credential.
  res.set('Cache-Control', 'no-store');
  res.status(201);
  res.json({ token });
};

// Generate (or rotate) the token: delete any existing one, store the new hash,
// and return the plaintext this one time. For programmatic clients.
app.post('/api/token', auth(true), mintToken);

// Reject cross-site requests to the token-minting GET. Because that route is a
// state-changing GET reachable by a top-level navigation, a page on another site
// could otherwise link a signed-in victim to it and rotate (invalidate) their
// token — a CSRF denial-of-service on their MCP connection (it can't read the
// token, only churn it). `Sec-Fetch-Site: cross-site` marks exactly that case;
// legitimate flows are 'same-origin' (link within the app) or 'none' (typed into
// the address bar — the point of this route). Absent header (older/non-browser
// clients) falls through, preserving prior behavior.
const rejectCrossSite = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.get('sec-fetch-site') === 'cross-site') {
    logger.warn(
      { event: LogEvent.AUTH_FORBIDDEN, path: req.path },
      'blocked cross-site token mint'
    );
    res.status(403).send('Cross-site token requests are not allowed');
    return;
  }
  next();
};

// Browser-friendly minting: navigating the address bar to this URL while signed
// in sends the HttpOnly session cookie automatically, so a user can obtain a
// token without any UI. Each visit mints a *fresh* token and invalidates the
// previous one (we only store the hash, so it can't be re-shown). It is a GET so
// the address bar works; the response is uncacheable, the cookie is
// SameSite=lax so a cross-site page can't read it, and rejectCrossSite blocks a
// tricked cross-site navigation from rotating it.
app.get('/api/token/new', auth(true), rejectCrossSite, mintToken);

// Report whether the user has a token, without revealing it (we only hold the
// hash). Lets the UI show "connected" vs "generate" without a show-once value.
app.get('/api/token', auth(true), async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const identities = await identityService.getForUser(user.getId(), SOURCE);
  res.status(200);
  res.json({ exists: identities.length > 0 });
});

// Remove the token entirely (disconnect any AI client).
app.delete('/api/token', auth(true), async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  await identityService.deleteForUser(user.getId(), SOURCE);
  logger.info(
    { event: LogEvent.AUTH_TOKEN_REVOKED, userId: user.getId() },
    'API token revoked'
  );
  res.status(200);
  res.send();
});

export default app;
