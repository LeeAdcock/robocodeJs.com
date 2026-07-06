import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { Request, Response, NextFunction } from 'express';
import userService from '../services/UserService';
import authService from '../services/IdentityService';
import User from '../types/user';
import { isLocalDev } from '../util/devMode';
import { logger, LogEvent } from '../util/logger';

export type AuthenticatedRequest = Request & { user: User };

// Local-dev login bypass: resolve (or lazily create) a single fixed "Local Dev"
// user so no Google sign-in is needed. Memoized so concurrent requests share one
// creation rather than racing to insert the identity.
let devUserPromise: Promise<User> | null = null;
export const ensureDevUser = (): Promise<User> => {
  if (!devUserPromise) {
    devUserPromise = authService.get('local', 'dev').then((identity) => {
      if (identity) {
        return userService.get(identity.getUserId()).then((user) => {
          if (user) return user;
          throw new Error('Dev identity has no account.');
        });
      }
      return userService
        .create('Local Dev', undefined, 'dev@localhost')
        .then((user) =>
          authService.create(user.getId(), 'local', 'dev').then(() => user)
        );
    });
  }
  return devUserPromise;
};

// The Google OAuth client id that browser sign-in mints tokens for. Tokens are
// verified against this as the audience, so a token issued for any other client
// is rejected. Overridable via env for different deployments.
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '926984742216-a5uuqefrrrvnn5pa87e357kld6rv2bsc.apps.googleusercontent.com';

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Verifies a Google credential (id token), checking it was issued for our
// client id (audience), and returns its payload (or rejects).
export const verifyGoogleCredential = (
  idToken: string | undefined
): Promise<TokenPayload | undefined> =>
  client
    .verifyIdToken({ idToken: idToken as string, audience: GOOGLE_CLIENT_ID })
    .then((verification) => verification.getPayload());

export default (required: boolean) =>
  async (req: Request, res: Response, next: NextFunction) => {
    // Local dev: skip Google verification and act as the fixed dev user. The
    // NODE_ENV re-check makes doubly sure this can never run in production.
    if (isLocalDev && process.env.NODE_ENV !== 'production') {
      try {
        (req as AuthenticatedRequest).user = await ensureDevUser();
        return next();
      } catch {
        if (required) {
          res.status(401);
          res.send('Access forbidden');
          return;
        }
        return next();
      }
    }
    // Bearer tokens (the MCP OAuth access token) are NOT handled here: the
    // /api/mcp route verifies them with the SDK's requireBearerAuth against the
    // OAuth provider (see api/mcp.ts). This middleware covers the browser session
    // (Google cookie) that gates the REST API and the OAuth consent page.

    // Step 1 — verify the Google credential. A failure here means the token is
    // missing/expired/invalid (or minted for another audience): the *client's*
    // problem, so a gated route answers 401. An ungated route just proceeds
    // anonymously (e.g. a logged-out visitor with no cookie). The error message
    // (not token contents) is logged so config problems (audience mismatch, no
    // egress to fetch Google's certs, clock skew) are diagnosable. Worth
    // monitoring: a spike of these suggests probing or token issues.
    let payload: TokenPayload | undefined;
    try {
      payload = await verifyGoogleCredential(req.cookies.auth);
    } catch (err: unknown) {
      if (required) {
        logger.warn(
          {
            event: LogEvent.AUTH_FAILED,
            path: req.path,
            err: err instanceof Error ? err.message : String(err),
          },
          'rejected request with invalid credential'
        );
        res.clearCookie('auth');
        res.status(401);
        res.send('Access forbidden');
        return;
      }
      return next();
    }

    if (!payload) {
      // Verified but no payload — treat as unauthenticated.
      if (required) {
        res.clearCookie('auth');
        res.status(401);
        res.send('Access forbidden');
        return;
      }
      return next();
    }

    // Step 2 — the token is valid; resolve (or create) the user. A failure here
    // is a *server-side* problem (e.g. the database is unreachable), NOT a bad
    // credential, so it must surface as 500 rather than masquerading as a 401.
    // Conflating the two previously made a DB outage look like a sign-in failure.
    try {
      const userAuth = await authService.get('google', payload.sub);
      let user: User | undefined;
      if (userAuth) {
        // We recognize this user.
        user = await userService.get(userAuth.getUserId());
        if (!user) {
          // Should not be possible to recognize their auth but not have a user
          // record for them.
          throw new Error('Missing account.');
        }
      } else {
        // First time we've seen this Google user: create their account. Require
        // a Google-verified email before persisting it — the account is keyed on
        // the immutable `sub`, but the stored `email` must be trustworthy so no
        // downstream logic ever treats an attacker-controllable, unverified
        // address as identifying. (Google sets email_verified=true for normal
        // accounts, so this only rejects genuinely unverified ones.)
        if (payload.email_verified !== true) {
          logger.warn(
            { event: LogEvent.AUTH_FAILED, sub: payload.sub },
            'sign-up rejected: Google email not verified'
          );
          res.clearCookie('auth');
          res.status(401);
          res.send('Access forbidden');
          return;
        }
        user = await userService.create(
          payload.name,
          payload.picture,
          payload.email
        );
        await authService.create(user.getId(), 'google', payload.sub);
      }
      (req as AuthenticatedRequest).user = user;
      return next();
    } catch (err: unknown) {
      logger.error(
        {
          event: LogEvent.DB_ERROR,
          path: req.path,
          err: err instanceof Error ? err.message : String(err),
        },
        'auth: credential valid but resolving the user failed'
      );
      res.status(500);
      res.send('Internal server error');
      return;
    }
  };
