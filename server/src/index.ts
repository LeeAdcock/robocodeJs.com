import express, { NextFunction, Request, Response } from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import path from 'path';

import auth from './middleware/auth';
import { isLocalDev } from './util/devMode';
import { logger, LogEvent } from './util/logger';

import healthEndpoints from './api/health';
import sessionEndpoints from './api/session';
import userEndpoints from './api/user';
import appEndpoints from './api/app';
import arenaEndpoints from './api/arena';
import helpEndpoints from './api/help';
import demoEndpoints from './api/demo';

const app = express();

// One structured log line per request (method, path, status, duration), with a
// per-request child logger on req.log. Skip the long-lived SSE streams and the
// health check to avoid noise.
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) =>
        req.url === '/health' ||
        !!req.url?.includes('/events') ||
        !!req.url?.includes('/logs'),
    },
  })
);

app.use('/api', [
  // Bound request body sizes: JSON covers the auth credential and small
  // payloads; the octet-stream body is bot source code.
  bodyParser.json({ limit: '256kb' }),
  bodyParser.raw({ type: 'application/octet-stream', limit: '64kb' }),
  cookieParser(),
]);
app.use('/', express.static('./dist/public'));

app.use('/api/user', auth(true));

app.use(healthEndpoints);
app.use(sessionEndpoints);
app.use(demoEndpoints);
app.use(helpEndpoints);
app.use(userEndpoints);
app.use(appEndpoints);
app.use(arenaEndpoints);

app.all('*', function (req, res) {
  res.sendFile(path.resolve(__dirname + '/../public/index.html'));
});

// Catch-all error handler: anything that throws/rejects into Express lands here
// as a 5xx and is logged at error so it can be alerted on.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    { event: LogEvent.HTTP_ERROR, method: req.method, url: req.url, err },
    'unhandled request error'
  );
  if (!res.headersSent) res.status(500).send('Internal server error');
});

// Process-level safety net: a bug (or an un-awaited bot-command rejection) that
// escapes should be logged, not silently swallowed or allowed to crash quietly.
process.on('unhandledRejection', (reason) => {
  logger.error(
    { event: LogEvent.PROCESS_FATAL, kind: 'unhandledRejection', err: reason },
    'unhandled promise rejection'
  );
});
process.on('uncaughtException', (err) => {
  logger.fatal(
    { event: LogEvent.PROCESS_FATAL, kind: 'uncaughtException', err },
    'uncaught exception'
  );
});

const port = 8080;
app.listen(port, () => {
  logger.info({ port }, `server started at http://localhost:${port}`);
  if (isLocalDev) {
    logger.info(
      'LOCAL DEV MODE — in-memory database + auth bypass (no Google sign-in). ' +
        'A "Local Dev" user with starter bots is created automatically. ' +
        'Set RDS_HOSTNAME (and NODE_ENV=production for deploys) to use a real database.'
    );
  }
});
