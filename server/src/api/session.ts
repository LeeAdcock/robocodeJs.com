import express, { Request, Response } from 'express';
import { verifyGoogleCredential } from '../middleware/auth';
import { logger, LogEvent } from '../util/logger';

const app = express();

const isProd = process.env.NODE_ENV === 'production';

// Establish a session: verify the Google credential and store it in an
// HttpOnly cookie so it can't be read (or stolen via XSS) by client-side JS.
// The cookie is then sent automatically on subsequent API requests and verified
// by the auth() middleware.
app.post('/api/session', async (req: Request, res: Response) => {
  const credential = req.body?.credential;
  if (!credential) {
    logger.warn(
      { event: LogEvent.AUTH_FAILED, reason: 'missing-credential' },
      'session: sign-in attempt with no credential'
    );
    res.status(400);
    res.send('Missing credential');
    return;
  }
  return verifyGoogleCredential(credential)
    .then((payload) => {
      if (!payload) {
        logger.warn(
          { event: LogEvent.AUTH_FAILED, reason: 'empty-payload' },
          'session: credential verified but returned no payload'
        );
        res.status(401);
        res.send('Invalid credential');
        return;
      }
      logger.info(
        { event: 'auth.signin', sub: payload.sub },
        'session: established for verified Google user'
      );
      res.cookie('auth', credential, {
        httpOnly: true,
        secure: isProd, // browsers won't set Secure cookies over http (dev)
        sameSite: 'lax',
        path: '/',
      });
      res.status(200);
      res.send();
    })
    .catch((err: unknown) => {
      // Surface the *actual* reason — it's the difference between an audience
      // mismatch (GOOGLE_CLIENT_ID wrong), the instance being unable to reach
      // Google's cert endpoint (no egress), and an expired/clock-skewed token.
      logger.warn(
        {
          event: LogEvent.AUTH_FAILED,
          reason: 'verify-failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'session: Google credential verification failed'
      );
      res.status(401);
      res.send('Invalid credential');
    });
});

// Clear the session.
app.delete('/api/session', (req: Request, res: Response) => {
  res.clearCookie('auth');
  res.status(200);
  res.send();
});

export default app;
