import { Request, Response, NextFunction } from 'express';
import type User from '../types/user';
import { isLocalDev } from '../util/devMode';
import { logger } from '../util/logger';

// Admin access for the /admin control panel (GitHub #469).
//
// Who is an admin is decided by config, not the database: ADMIN_EMAILS is a
// comma-separated, case-insensitive allowlist set in the Elastic Beanstalk
// environment. Keeping the grant out of the database means no SQL write (a bug,
// an injection, a bad migration) can ever mint an admin. Unset or empty means
// nobody is an admin.
//
// Read on every call rather than cached at import so tests can set the variable
// per case and an env change takes effect without a code path that remembers
// the old value.
export const adminEmails = (): Set<string> =>
  new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
  );

// Local dev already bypasses sign-in entirely (a fixed "Local Dev" user, see
// middleware/auth.ts), so that user is an admin too — otherwise the panel could
// only be worked on against production. The NODE_ENV re-check mirrors the one at
// the auth-bypass site so this can never apply in production.
const devAdmin = (): boolean =>
  isLocalDev && process.env.NODE_ENV !== 'production';

export const isAdmin = (user: User | undefined): boolean => {
  if (!user) return false;
  if (devAdmin()) return true;
  const email = user.getEmail()?.trim().toLowerCase();
  return !!email && adminEmails().has(email);
};

// Gate for the admin router. Mount it after auth(false), NOT auth(true): a
// required-auth gate answers an anonymous caller with a 401, which itself tells
// a scanner that something lives at this path. Instead, anyone who isn't an
// admin — anonymous, signed in, or presenting a bearer token (auth ignores
// those) — leaves the router with next('router') and falls through to whatever
// would have handled an unknown path, so the admin API is indistinguishable
// from a route that doesn't exist.
//
// Non-admin hits are deliberately NOT logged as auth.forbidden. That event
// (and its robocodejs-auth-forbidden alarm, >= 5 in 5 min) means one user
// acting on another user's resource; a signed-in user opening /admin, or a
// scanner trying the path, is not that, and would only bury the real signal.
// A debug line with no `event` field keeps it visible locally without feeding
// any metric filter.
export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const user = (req as Request & { user?: User }).user;
  if (isAdmin(user)) return next();
  if (user) {
    logger.debug(
      { userId: user.getId(), path: req.path },
      'non-admin request to the admin API'
    );
  }
  next('router');
};
