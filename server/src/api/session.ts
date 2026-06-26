import express, { Request, Response } from 'express';
import { verifyGoogleCredential } from '../middleware/auth';

const app = express();

const isProd = process.env.NODE_ENV === 'production';

// Establish a session: verify the Google credential and store it in an
// HttpOnly cookie so it can't be read (or stolen via XSS) by client-side JS.
// The cookie is then sent automatically on subsequent API requests and verified
// by the auth() middleware.
app.post('/api/session', async (req: Request, res: Response) => {
  const credential = req.body?.credential;
  if (!credential) {
    res.status(400);
    res.send('Missing credential');
    return;
  }
  return verifyGoogleCredential(credential)
    .then((payload) => {
      if (!payload) {
        res.status(401);
        res.send('Invalid credential');
        return;
      }
      res.cookie('auth', credential, {
        httpOnly: true,
        secure: isProd, // browsers won't set Secure cookies over http (dev)
        sameSite: 'lax',
        path: '/',
      });
      res.status(200);
      res.send();
    })
    .catch(() => {
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
