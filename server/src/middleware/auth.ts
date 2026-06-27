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
    try {
      return verifyGoogleCredential(req.cookies.auth)
        .then((payload) => {
          if (payload) {
            return authService.get('google', payload.sub).then((userAuth) => {
              if (userAuth) {
                // We recognize this user
                return userService.get(userAuth.getUserId()).then((user) => {
                  if (!user) {
                    // Should not be possible to recognize their auth but not
                    // have a user record for them.
                    throw new Error('Missing account.');
                  }
                  (req as AuthenticatedRequest).user = user;
                  return next();
                });
              } else {
                // Create this user
                return userService
                  .create(payload.name, payload.picture, payload.email)
                  .then((user) => {
                    (req as AuthenticatedRequest).user = user;
                    return authService
                      .create(user.getId(), 'google', payload.sub)
                      .then(next);
                  });
              }
            });
          }
        })
        .catch(() => {
          if (required) {
            // A gated route rejected an invalid/expired credential. Worth
            // monitoring: a spike suggests probing or token issues. No token
            // contents are logged.
            logger.warn(
              { event: LogEvent.AUTH_FAILED, path: req.path },
              'rejected request with invalid credential'
            );
            res.clearCookie('auth');
            res.status(401);
            res.send('Access forbidden');
          } else {
            next();
          }
        });
    } catch (e) {
      logger.warn(
        { event: LogEvent.AUTH_FAILED, path: req.path, err: e },
        'auth middleware error'
      );
      res.clearCookie('auth');
      res.status(401);
      res.send('Access forbidden');
    }
  };
