import { Request, Response, NextFunction } from 'express';
import userService from '../services/UserService';
import appService from '../services/AppService';
import User from '../types/user';
import TankApp from '../types/app';

// Express middleware that removes the user-lookup / ownership / app-lookup
// boilerplate that was repeated across the api/* route handlers.

// `user` is attached by the auth() middleware; targetUser/targetApp by the
// loaders below.
export type UserScopedRequest = Request & { user?: User; targetUser: User };
export type AppScopedRequest = UserScopedRequest & { targetApp: TankApp };

// Typed accessors for the resources attached by the loaders above.
export const scopedUser = (req: Request): User =>
  (req as UserScopedRequest).targetUser;
export const scopedApp = (req: Request): TankApp =>
  (req as AppScopedRequest).targetApp;

// Loads the :userId path param into req.targetUser, or 404s.
export const loadUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = await userService.get(req.params.userId);
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
  const app = await appService.get(req.params.appId);
  if (!app) {
    res.status(404);
    res.send('Invalid app id');
    return;
  }
  (req as AppScopedRequest).targetApp = app;
  next();
};
