import { Request, Response, NextFunction } from 'express';
import userService from '../services/UserService';
import appService from '../services/AppService';
import { logger, LogEvent } from '../util/logger';
import arenaService from '../services/ArenaService';
import User from '../types/user';
import TankApp from '../types/app';
import Arena from '../types/arena';

// Express middleware that removes the user-lookup / ownership / app-lookup
// boilerplate that was repeated across the api/* route handlers.

// `user` is attached by the auth() middleware; targetUser/targetApp by the
// loaders below.
export type UserScopedRequest = Request & { user?: User; targetUser: User };
export type AppScopedRequest = UserScopedRequest & { targetApp: TankApp };
export type ArenaScopedRequest = UserScopedRequest & { targetArena: Arena };

// Typed accessors for the resources attached by the loaders above.
export const scopedUser = (req: Request): User =>
  (req as UserScopedRequest).targetUser;
export const scopedApp = (req: Request): TankApp =>
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

// Loads the :appId path param into req.targetApp, or 404s.
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
