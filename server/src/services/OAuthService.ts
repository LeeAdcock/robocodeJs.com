import { randomUUID } from 'node:crypto';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { UserId } from '../types/user';
import pool from '../util/db';
import { sha256hex } from '../util/hash';

// Persistent state for the MCP OAuth 2.1 flow (see api/oauth.ts). Everything a
// request needs — registered clients, in-flight authorization codes, and issued
// access/refresh tokens — lives in shared Postgres and is looked up by hash, so
// nothing depends on a request hitting the same instance that started the flow
// (the browser may mint a code on one instance and the client exchange it on
// another). No process-memory session state anywhere: safe to run many replicas.
//
// Credentials (codes, tokens) are stored only as their sha256 hash — a DB read
// never yields a usable secret. Registered-client rows keep the full client
// info (including a `client_secret` for confidential clients) because the SDK's
// client-auth middleware compares the presented secret against it; MCP clients
// almost always register as *public* PKCE clients with no secret at all.

pool.query(`
  CREATE TABLE IF NOT EXISTS oauth_client (
    clientId text PRIMARY KEY,
    info text,
    createdTimestamp timestamp default CURRENT_TIMESTAMP
  )
`);

// expiresAt is epoch-millis (bigint), compared against Date.now() rather than a
// SQL now() — no timezone coupling, and identical behaviour across real Postgres
// and the pg-mem dev/test database.
pool.query(`
  CREATE TABLE IF NOT EXISTS oauth_code (
    codeHash text PRIMARY KEY,
    userId UUID,
    clientId text,
    redirectUri text,
    codeChallenge text,
    scopes text,
    expiresAt bigint,
    createdTimestamp timestamp default CURRENT_TIMESTAMP
  )
`);

pool.query(`
  CREATE TABLE IF NOT EXISTS oauth_token (
    tokenHash text PRIMARY KEY,
    userId UUID,
    clientId text,
    kind text,
    scopes text,
    expiresAt bigint,
    createdTimestamp timestamp default CURRENT_TIMESTAMP
  )
`);

// Lifetimes (seconds). Env-tunable like the sandbox/rate-limit knobs. Codes are
// single-use and second-lived; access tokens are short; refresh tokens are long.
const secs = (name: string, fallback: number): number =>
  Number(process.env[name]) || fallback;
const CODE_TTL = secs('OAUTH_CODE_TTL_S', 60);
const ACCESS_TTL = secs('OAUTH_ACCESS_TTL_S', 60 * 60);
const REFRESH_TTL = secs('OAUTH_REFRESH_TTL_S', 30 * 24 * 60 * 60);

const parseScopes = (s: string | null | undefined): string[] =>
  s ? s.split(' ').filter(Boolean) : [];

export type AuthCode = {
  userId: UserId;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
};

export type TokenInfo = {
  userId: UserId;
  clientId: string;
  scopes: string[];
  expiresAt: Date;
};

export type TokenKind = 'access' | 'refresh';

class OAuthService {
  // ---- Registered clients (dynamic client registration) ----

  getClient = (
    clientId: string
  ): Promise<OAuthClientInformationFull | undefined> =>
    pool
      .query({
        text: 'SELECT info FROM oauth_client WHERE clientId=$1',
        values: [clientId],
      })
      .then((res) =>
        res.rowCount === 0
          ? undefined
          : (JSON.parse(res.rows[0]['info']) as OAuthClientInformationFull)
      );

  registerClient = (
    client: OAuthClientInformationFull
  ): Promise<OAuthClientInformationFull> =>
    pool
      .query({
        text: 'INSERT INTO oauth_client(clientId, info) VALUES($1, $2)',
        values: [client.client_id, JSON.stringify(client)],
      })
      .then(() => client);

  // ---- Authorization codes (single-use, short-lived) ----

  // Mint a code bound to the approval. Returns the plaintext code (only its hash
  // is stored). expiresAt is written as an absolute instant so any instance can
  // judge freshness without a shared clock beyond the DB.
  createCode = (code: AuthCode): Promise<string> => {
    const plain = randomUUID();
    const expiresAt = Date.now() + CODE_TTL * 1000;
    return pool
      .query({
        text: `INSERT INTO oauth_code(codeHash, userId, clientId, redirectUri, codeChallenge, scopes, expiresAt)
               VALUES($1, $2, $3, $4, $5, $6, $7)`,
        values: [
          sha256hex(plain),
          code.userId,
          code.clientId,
          code.redirectUri,
          code.codeChallenge,
          code.scopes.join(' '),
          expiresAt,
        ],
      })
      .then(() => plain);
  };

  // Peek at a code's binding WITHOUT consuming it (the SDK reads the PKCE
  // challenge to validate before exchange). Returns undefined if unknown/expired.
  getCode = (code: string): Promise<AuthCode | undefined> =>
    pool
      .query({
        text: 'SELECT * FROM oauth_code WHERE codeHash=$1 AND expiresAt > $2',
        values: [sha256hex(code), Date.now()],
      })
      .then((res) =>
        res.rowCount === 0 ? undefined : this.rowToCode(res.rows[0])
      );

  // Redeem a code: delete-and-return atomically so it can be used at most once,
  // even under a concurrent double-exchange. Returns undefined if already used or
  // expired.
  consumeCode = (code: string): Promise<AuthCode | undefined> =>
    pool
      .query({
        text: 'DELETE FROM oauth_code WHERE codeHash=$1 AND expiresAt > $2 RETURNING *',
        values: [sha256hex(code), Date.now()],
      })
      .then((res) =>
        res.rowCount === 0 ? undefined : this.rowToCode(res.rows[0])
      );

  // Postgres (and pg-mem) fold unquoted column identifiers to lower case, so a
  // `SELECT *` / `RETURNING *` yields lower-cased keys — read them as such.
  private rowToCode = (row: Record<string, unknown>): AuthCode => ({
    userId: row['userid'] as UserId,
    clientId: row['clientid'] as string,
    redirectUri: row['redirecturi'] as string,
    codeChallenge: row['codechallenge'] as string,
    scopes: parseScopes(row['scopes'] as string),
  });

  // ---- Access & refresh tokens ----

  createToken = (
    userId: UserId,
    clientId: string,
    kind: TokenKind,
    scopes: string[]
  ): Promise<{ token: string; expiresIn: number }> => {
    const plain = randomUUID();
    const ttl = kind === 'access' ? ACCESS_TTL : REFRESH_TTL;
    const expiresAt = Date.now() + ttl * 1000;
    return pool
      .query({
        text: `INSERT INTO oauth_token(tokenHash, userId, clientId, kind, scopes, expiresAt)
               VALUES($1, $2, $3, $4, $5, $6)`,
        values: [
          sha256hex(plain),
          userId,
          clientId,
          kind,
          scopes.join(' '),
          expiresAt,
        ],
      })
      .then(() => ({ token: plain, expiresIn: ttl }));
  };

  getToken = (token: string, kind: TokenKind): Promise<TokenInfo | undefined> =>
    pool
      .query({
        text: 'SELECT * FROM oauth_token WHERE tokenHash=$1 AND kind=$2 AND expiresAt > $3',
        values: [sha256hex(token), kind, Date.now()],
      })
      .then((res) =>
        res.rowCount === 0
          ? undefined
          : {
              userId: res.rows[0]['userid'] as UserId,
              clientId: res.rows[0]['clientid'] as string,
              scopes: parseScopes(res.rows[0]['scopes'] as string),
              // bigint comes back as a string from node-pg; normalize to a Date.
              expiresAt: new Date(Number(res.rows[0]['expiresat'])),
            }
      );

  deleteToken = (token: string): Promise<void> =>
    pool
      .query({
        text: 'DELETE FROM oauth_token WHERE tokenHash=$1',
        values: [sha256hex(token)],
      })
      .then(() => undefined);

  // Best-effort sweep of anything past its expiry. Cheap and idempotent; called
  // opportunistically so no cross-instance timer is needed.
  sweepExpired = (): Promise<void> =>
    Promise.all([
      pool.query({
        text: 'DELETE FROM oauth_code WHERE expiresAt < $1',
        values: [Date.now()],
      }),
      pool.query({
        text: 'DELETE FROM oauth_token WHERE expiresAt < $1',
        values: [Date.now()],
      }),
    ]).then(() => undefined);
}

export default new OAuthService();
