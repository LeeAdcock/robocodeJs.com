import { Response } from 'express';
import {
  OAuthServerProvider,
  AuthorizationParams,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import oauthService from '../services/OAuthService';
import { logger, LogEvent } from './logger';

// The single scope this authorization server issues. MCP grants full control of
// the user's own bots/arenas (and nothing else), so there is one coarse scope
// rather than a fine-grained set.
export const SCOPE = 'robocode';

// Implements the MCP OAuth 2.1 authorization server. RobocodeJs is its own AS +
// resource server; the actual human login is delegated to the existing Google
// sign-in on a UI page (see authorize() below and ui/src/page/mcpAuthorize.tsx).
// All persistent state lives in OAuthService (Postgres, hash-keyed), so the
// provider itself is stateless and replica-safe.
export class RobocodeOAuthProvider implements OAuthServerProvider {
  clientsStore: OAuthRegisteredClientsStore = {
    getClient: (clientId) => oauthService.getClient(clientId),
    registerClient: (client) =>
      oauthService.registerClient(client as OAuthClientInformationFull),
  };

  // The public origin of this deployment (e.g. https://robocodejs.com), used to
  // build the browser redirect to our login/approval page.
  constructor(private readonly issuer: URL) {}

  // Begin the authorization flow. We can't complete it here (only `res` is
  // passed — no cookies/session), so redirect the browser to our own UI page,
  // which ensures the user is signed in (Google), auto-approves, and calls
  // POST /api/oauth/authorize to mint the code and bounce back to `redirectUri`.
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const target = new URL('/mcp/authorize', this.issuer);
    target.searchParams.set('client_id', client.client_id);
    target.searchParams.set('redirect_uri', params.redirectUri);
    target.searchParams.set('code_challenge', params.codeChallenge);
    target.searchParams.set('code_challenge_method', 'S256');
    target.searchParams.set('scope', (params.scopes ?? [SCOPE]).join(' '));
    if (params.state) target.searchParams.set('state', params.state);
    // Purely for display on the approval page ("Connect <name>?").
    if (client.client_name)
      target.searchParams.set('client_name', client.client_name);
    res.redirect(target.href);
  }

  // Return the PKCE challenge stored with the code so the SDK's token handler can
  // verify the presented code_verifier BEFORE calling exchangeAuthorizationCode.
  // Non-consuming: the code is only redeemed in the exchange.
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const code = await oauthService.getCode(authorizationCode);
    if (!code)
      throw new InvalidGrantError('Invalid or expired authorization code');
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    // Single-use redemption (delete-and-return) — atomic even under a double
    // exchange.
    const code = await oauthService.consumeCode(authorizationCode);
    if (!code)
      throw new InvalidGrantError('Invalid or expired authorization code');
    if (code.clientId !== client.client_id)
      throw new InvalidGrantError(
        'Authorization code was issued to another client'
      );
    if (redirectUri !== undefined && redirectUri !== code.redirectUri)
      throw new InvalidGrantError(
        'redirect_uri does not match the authorization request'
      );

    return this.issueTokens(code.userId, client.client_id, code.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    const existing = await oauthService.getToken(refreshToken, 'refresh');
    if (!existing)
      throw new InvalidGrantError('Invalid or expired refresh token');
    if (existing.clientId !== client.client_id)
      throw new InvalidGrantError('Refresh token was issued to another client');
    // Rotate: the old refresh token stops working the moment it is exchanged.
    await oauthService.deleteToken(refreshToken);
    // A refresh MAY narrow scope but never widen it. We only ever issue the one
    // SCOPE, so a requested subset can only ever be the same set — keep the
    // original grant.
    void scopes;
    return this.issueTokens(existing.userId, client.client_id, existing.scopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const info = await oauthService.getToken(token, 'access');
    if (!info) throw new InvalidTokenError('Invalid or expired access token');
    return {
      token,
      clientId: info.clientId,
      scopes: info.scopes,
      expiresAt: Math.floor(info.expiresAt.getTime() / 1000),
      // The route resolves the acting user from here (see api/mcp.ts).
      extra: { userId: info.userId },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    // Hash-keyed delete works for either token kind, so the hint is unneeded.
    await oauthService.deleteToken(request.token);
    logger.info(
      { event: LogEvent.AUTH_TOKEN_REVOKED, clientId: client.client_id },
      'OAuth token revoked'
    );
  }

  private async issueTokens(
    userId: string,
    clientId: string,
    scopes: string[]
  ): Promise<OAuthTokens> {
    // Best-effort GC of anything expired; never block issuance on it.
    oauthService.sweepExpired().catch(() => undefined);
    const access = await oauthService.createToken(
      userId,
      clientId,
      'access',
      scopes
    );
    const refresh = await oauthService.createToken(
      userId,
      clientId,
      'refresh',
      scopes
    );
    logger.info(
      { event: LogEvent.AUTH_TOKEN_CREATED, userId, clientId },
      'OAuth tokens issued'
    );
    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: access.expiresIn,
      scope: scopes.join(' '),
      refresh_token: refresh.token,
    };
  }
}

export default RobocodeOAuthProvider;
