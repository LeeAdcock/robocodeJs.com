import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { Request, Response, NextFunction } from 'express';
import userService from '../services/UserService';
import authService from '../services/IdentityService';
import User from '../types/user';

export type AuthenticatedRequest = Request & { user: User };

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
            res.clearCookie('auth');
            res.status(401);
            res.send('Access forbidden');
          } else {
            next();
          }
        });
    } catch (e) {
      res.clearCookie('auth');
      res.status(401);
      res.send('Access forbidden');
    }
  };
