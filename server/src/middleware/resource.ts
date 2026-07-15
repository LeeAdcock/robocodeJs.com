import { Request, Response, NextFunction } from 'express';
import userService from '../services/UserService';
import appService from '../services/AppService';
import { logger, LogEvent } from '../util/logger';
import arenaService from '../services/ArenaService';
import User from '../types/user';
import App from '../types/app';
import Arena from '../types/arena';

// Express middleware that removes the user-lookup / ownership / app-lookup
// boilerplate that was repeated across the api/* route handlers.

// `user` is attached by the auth() middleware; targetUser/targetApp by the
// loaders below.
export type UserScopedRequest = Request & { user?: User; targetUser: User };
export type AppScopedRequest = UserScopedRequest & { targetApp: App };
export type ArenaScopedRequest = UserScopedRequest & { targetArena: Arena };

// Typed accessors for the resources attached by the loaders above.
export const scopedUser = (req: Request): User =>
  (req as UserScopedRequest).targetUser;
export const scopedApp = (req: Request): App =>
  (req as AppScopedRequest).targetApp;
export const scopedArena = (req: Request): Arena =>
  (req as ArenaScopedRequest).targetArena;

// Loads the :userId path param into req.targetUser, or 404s.
export const loadUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = await userService.get(req.params.userId as string);
  if (!user) {
    res.status(404);
    res.send('Invalid user id');
    return;
  }
  (req as UserScopedRequest).targetUser = user;
  next();
};

// Requires the authenticated user (set by auth()) to be the :userId user.
// Run after loadUser.
export const requireOwner = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const r = req as UserScopedRequest;
  if (!r.user || r.user.getId() !== r.targetUser.getId()) {
    // An authenticated user tried to mutate another user's resource — a
    // potential abuse signal worth alerting on if it recurs.
    logger.warn(
      {
        event: LogEvent.AUTH_FORBIDDEN,
        actor: r.user?.getId(),
        target: r.targetUser.getId(),
        path: req.path,
      },
      'ownership check failed'
    );
    res.status(401);
    res.send('Unauthorized');
    return;
  }
  next();
};

// Loads the :appId path param into req.targetApp, or 404s. Intentionally NOT
// scoped to the :userId user: an app id may be *referenced* by other users (e.g.
// to add someone's bot to your own arena by id). Ownership is enforced
// separately by requireAppOwner on the routes that expose or mutate private
// state (source, delete, compile, reboot) — see requireAppOwner.
export const loadApp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const app = await appService.get(req.params.appId as string);
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return;
  }
  (req as AppScopedRequest).targetApp = app;
  next();
};

// Requires the authenticated user to OWN the loaded :appId app. Run after
// loadApp. This is the object-level guard that keeps a bot's source private and
// editable only by its author: because loadApp resolves an app id regardless of
// who owns it (so add-by-reference works), a route that returns or mutates the
// source/lifecycle MUST additionally pass through this check. Without it, an
// attacker could pass their own :userId (satisfying requireOwner) with a
// victim's :appId and read or overwrite the victim's source.
export const requireAppOwner = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const r = req as AppScopedRequest;
  if (!r.user || r.targetApp.getUserId() !== r.user.getId()) {
    logger.warn(
      {
        event: LogEvent.AUTH_FORBIDDEN,
        actor: r.user?.getId(),
        target: r.targetApp.getUserId(),
        path: req.path,
      },
      'app ownership check failed'
    );
    res.status(401);
    res.send('Unauthorized');
    return;
  }
  next();
};

// Resolves the arena for the request into req.targetArena. With an :arenaId
// path param it loads that specific arena (404 if missing or not owned by the
// :userId user — this scoping check stops one user addressing another's arena
// by id); without one it falls back to the user's default arena, which
// getDefaultForUser lazily creates if needed. Run after loadUser.
export const resolveArena = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const targetUser = (req as UserScopedRequest).targetUser;
  if (req.params.arenaId) {
    const arena = await arenaService.get(req.params.arenaId as string);
    if (!arena || arena.getUserId() !== targetUser.getId()) {
      res.status(404);
      res.send('Invalid arena id');
      return;
    }
    (req as ArenaScopedRequest).targetArena = arena;
  } else {
    (req as ArenaScopedRequest).targetArena =
      await arenaService.getDefaultForUser(targetUser.getId());
  }
  next();
};

// Resolves an arena by its UUID alone into req.targetArena — no :userId, no
// ownership. Unlike resolveArena (which ties the arena to the path :userId user),
// this powers the PUBLIC spectator routes (`/api/arena/:arenaId`): the arena UUID
// is the bearer capability, so anyone holding a share link can watch. Only the
// non-owner-gated view handlers (status/events/summary/match-status) are mounted
// on it — never logs or any mutation. 404s if the id is unknown.
export const resolvePublicArena = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Treat a lookup failure as "not found" too: this is a public, guessable URL,
  // so a mangled share link (e.g. a non-UUID id the DB rejects with a cast error)
  // must render the friendly not-found page — a 404 the watch UI handles — rather
  // than a 500.
  let arena;
  try {
    arena = await arenaService.get(req.params.arenaId as string);
  } catch {
    arena = undefined;
  }
  if (!arena) {
    res.status(404);
    res.send('Invalid arena id');
    return;
  }
  (req as ArenaScopedRequest).targetArena = arena;
  next();
};
