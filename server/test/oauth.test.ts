import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

// Back OAuthService with a real in-memory Postgres (pg-mem) so the actual SQL
// runs — single-use code redemption, expiry, and token rotation are exercised
// end to end, not mocked. This is the same engine db.ts uses in local dev.
vi.mock('../src/util/db', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { newDb } = require('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return { default: new Pool() };
});

// The endpoint test needs a session; stub auth to inject a fixed user (Google
// verification is covered in auth.test.ts). Real user ids are UUIDs, and the
// oauth tables store userId as UUID, so use a valid one.
vi.mock('../src/middleware/auth', () => ({
  default:
    () => (req: express.Request, _res: express.Response, next: () => void) => {
      (req as unknown as { user: unknown }).user = {
        getId: () => '11111111-1111-1111-1111-111111111111',
      };
      next();
    },
}));

import oauthService from '../src/services/OAuthService';
import RobocodeOAuthProvider, { SCOPE } from '../src/util/oauthProvider';
import oauthApp from '../src/api/oauth';

const USER = '11111111-1111-1111-1111-111111111111';
const REDIRECT = 'https://client.example/callback';

const client: OAuthClientInformationFull = {
  client_id: 'client-1',
  redirect_uris: [REDIRECT],
  client_name: 'Test Client',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

const otherClient: OAuthClientInformationFull = {
  ...client,
  client_id: 'client-2',
};

const provider = new RobocodeOAuthProvider(new URL('http://localhost:5000'));

beforeAll(async () => {
  // The CREATE TABLE statements run at import; give them a tick, then register
  // the clients the tests act on.
  await oauthService.registerClient(client);
  await oauthService.registerClient(otherClient);
});

const mintCode = (
  overrides: Partial<Parameters<typeof oauthService.createCode>[0]> = {}
) =>
  oauthService.createCode({
    userId: USER,
    clientId: client.client_id,
    redirectUri: REDIRECT,
    codeChallenge: 'challenge-abc',
    scopes: [SCOPE],
    ...overrides,
  });

describe('OAuth provider (clients, codes, tokens)', () => {
  it('registers and reads back a client', async () => {
    expect((await oauthService.getClient('client-1'))?.client_name).toBe(
      'Test Client'
    );
    expect(await oauthService.getClient('nope')).toBeUndefined();
  });

  it('returns the stored PKCE challenge without consuming the code', async () => {
    const code = await mintCode();
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe(
      'challenge-abc'
    );
    // Still redeemable afterwards (peek, not consume).
    expect(await oauthService.getCode(code)).toBeDefined();
  });

  it('exchanges a code for access + refresh tokens, and verifies the access token', async () => {
    const code = await mintCode();
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      REDIRECT
    );
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope).toBe(SCOPE);

    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info.extra?.userId).toBe(USER);
    expect(info.clientId).toBe('client-1');
    expect(info.scopes).toEqual([SCOPE]);
  });

  it('redeems a code at most once (single-use)', async () => {
    const code = await mintCode();
    await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    await expect(
      provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
    ).rejects.toThrow();
  });

  it('rejects a code redeemed by a different client', async () => {
    const code = await mintCode();
    await expect(
      provider.exchangeAuthorizationCode(otherClient, code, undefined, REDIRECT)
    ).rejects.toThrow();
  });

  it('rejects a mismatched redirect_uri', async () => {
    const code = await mintCode();
    await expect(
      provider.exchangeAuthorizationCode(
        client,
        code,
        undefined,
        'https://evil.example/callback'
      )
    ).rejects.toThrow();
  });

  it('rotates on refresh: old refresh token stops working, new access verifies', async () => {
    const code = await mintCode();
    const first = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      REDIRECT
    );
    const refreshed = await provider.exchangeRefreshToken(
      client,
      first.refresh_token as string
    );
    expect(refreshed.access_token).not.toBe(first.access_token);

    // New access token verifies…
    expect(
      (await provider.verifyAccessToken(refreshed.access_token)).extra?.userId
    ).toBe(USER);
    // …and the consumed refresh token is now invalid (rotation).
    await expect(
      provider.exchangeRefreshToken(client, first.refresh_token as string)
    ).rejects.toThrow();
  });

  it('revokes an access token', async () => {
    const code = await mintCode();
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      REDIRECT
    );
    await provider.revokeToken(client, { token: tokens.access_token });
    await expect(
      provider.verifyAccessToken(tokens.access_token)
    ).rejects.toThrow();
  });

  it('rejects an unknown access token', async () => {
    await expect(provider.verifyAccessToken('made-up')).rejects.toThrow();
  });
});

describe('POST /api/oauth/authorize (session-gated approval)', () => {
  const app = express();
  app.use(express.json());
  app.use(oauthApp);

  it('mints a code and returns a client redirect carrying it', async () => {
    const res = await request(app).post('/api/oauth/authorize').send({
      client_id: 'client-1',
      redirect_uri: REDIRECT,
      code_challenge: 'challenge-xyz',
      state: 'st-123',
    });
    expect(res.status).toBe(200);
    const location = new URL(res.body.location);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('st-123');
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();
    // The returned code is real and bound to the PKCE challenge we sent.
    expect(
      await provider.challengeForAuthorizationCode(client, code as string)
    ).toBe('challenge-xyz');
  });

  it('rejects an unregistered redirect_uri (open-redirect guard)', async () => {
    const res = await request(app).post('/api/oauth/authorize').send({
      client_id: 'client-1',
      redirect_uri: 'https://evil.example/steal',
      code_challenge: 'c',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown client', async () => {
    const res = await request(app).post('/api/oauth/authorize').send({
      client_id: 'ghost',
      redirect_uri: REDIRECT,
      code_challenge: 'c',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('rejects a request missing required params', async () => {
    const res = await request(app)
      .post('/api/oauth/authorize')
      .send({ client_id: 'client-1' });
    expect(res.status).toBe(400);
  });
});
