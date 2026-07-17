import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';

import auth, { AuthenticatedRequest } from '../middleware/auth';
import RobocodeOAuthProvider, { SCOPE } from '../util/oauthProvider';
import oauthService from '../services/OAuthService';
import { logger, LogEvent } from '../util/logger';
import { awardEdgeAchievement } from '../util/awardAchievements';
import { ACCOUNT_MCP_TOKEN } from '../util/achievements';

// The public origin of this deployment, used as the OAuth issuer and to build the
// browser login redirect. It must be a fixed value at startup because the SDK
// bakes it into the discovery metadata when the router is mounted. Defaults by
// environment (prod → the live https origin, else the local dev proxy), mirroring
// how GOOGLE_CLIENT_ID ships a hardcoded prod default; MCP_ISSUER_URL overrides it
// for any other deployment. HTTPS is required by the spec except for localhost.
const DEFAULT_ISSUER =
  process.env.NODE_ENV === 'production'
    ? 'https://robocodejs.com'
    : 'http://localhost:5000';
export const ISSUER = new URL(process.env.MCP_ISSUER_URL || DEFAULT_ISSUER);
// The MCP endpoint is the protected resource whose metadata we advertise (its
// path is inserted into the .well-known URL per RFC 9728).
export const RESOURCE_URL = new URL('/api/mcp', ISSUER);

export const provider = new RobocodeOAuthProvider(ISSUER);

const app = express();

// Standard MCP authorization-server endpoints, mounted at the app ROOT (required
// by the SDK): /authorize, /token, /register, /revoke, and the two .well-known
// metadata documents. Each SDK handler brings its own body parsing and rate
// limiting. Discovery + dynamic client registration + PKCE let claude.ai /
// Claude Desktop connectors negotiate auth with no manual token.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: ISSUER,
    resourceServerUrl: RESOURCE_URL,
    scopesSupported: [SCOPE],
    serviceDocumentationUrl: new URL('/mcp', ISSUER),
    resourceName: 'RobocodeJs',
  })
);

// The one piece the SDK can't do itself: our login/consent lives in the UI (so it
// can reuse Google sign-in), and only there is the user's session cookie present.
// The provider's authorize() redirects the browser to /mcp/authorize, which — once
// the user is signed in — POSTs the authorization params here (session-gated).
// We mint the auth code and hand back the client redirect. Because we act on the
// authenticated user's own account, no Allow/Deny consent step is needed.
app.post('/api/oauth/authorize', auth(true), async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  const {
    client_id,
    redirect_uri,
    code_challenge,
    scope,
    state,
  }: Record<string, string | undefined> = req.body ?? {};

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const client = await oauthService.getClient(client_id);
  if (!client) {
    res.status(400).json({ error: 'invalid_client' });
    return;
  }

  // Open-redirect guard: only ever bounce back to a redirect URI the client
  // registered (loopback ports are wildcarded per RFC 8252, matching the SDK's
  // own /authorize validation).
  const allowed = client.redirect_uris.some((uri) =>
    redirectUriMatches(redirect_uri, uri)
  );
  if (!allowed) {
    logger.warn(
      { event: LogEvent.AUTH_FORBIDDEN, clientId: client_id },
      'oauth: unregistered redirect_uri rejected'
    );
    res.status(400).json({ error: 'invalid redirect_uri' });
    return;
  }

  const code = await oauthService.createCode({
    userId: user.getId(),
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    scopes: scope ? scope.split(' ').filter(Boolean) : [SCOPE],
  });

  // Achievements (GitHub #121). This is the moment a user connects an AI client
  // to their account, and it happens exactly once per authorization — unlike the
  // token endpoint (handled by the SDK provider above), which also mints an access
  // token every hour. It's session-gated, so the acting user is right here.
  // Fire-and-forget: a badge must never fail an authorization.
  void awardEdgeAchievement(user.getId(), ACCOUNT_MCP_TOKEN);

  const location = new URL(redirect_uri);
  location.searchParams.set('code', code);
  if (state) location.searchParams.set('state', state);
  res.status(200).json({ location: location.href });
});

export default app;
