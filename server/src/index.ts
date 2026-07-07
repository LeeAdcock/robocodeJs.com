import express, { NextFunction, Request, Response } from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import path from 'node:path';

import auth from './middleware/auth';
import securityHeaders from './middleware/securityHeaders';
import { apiRateLimit, authRateLimit } from './middleware/rateLimit';
import { isLocalDev } from './util/devMode';
import { logger, LogEvent } from './util/logger';
import pool from './util/db';
import environmentService from './services/EnvironmentService';

import healthEndpoints from './api/health';
import sessionEndpoints from './api/session';
import oauthEndpoints from './api/oauth';
import mcpEndpoints from './api/mcp';
import userEndpoints from './api/user';
import appEndpoints from './api/app';
import arenaEndpoints from './api/arena';
import helpEndpoints from './api/help';
import demoEndpoints from './api/demo';

const app = express();

// Behind the dev proxy (index.js) and, in production, Elastic Beanstalk's load
// balancer, the real client IP arrives in X-Forwarded-For. Trust exactly one
// proxy hop so req.ip reflects the client (not the proxy) for IP-keyed rate
// limiting. A specific hop count (not `true`) also satisfies express-rate-limit's
// permissive-trust-proxy guard.
app.set('trust proxy', 1);

// Security response headers (CSP, X-Frame-Options, nosniff, HSTS, …). Installed
// first so every response — static assets, the API, and the SPA fallback — is
// covered. See middleware/securityHeaders.ts for the CSP rationale.
app.use(securityHeaders);

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

// Rate limiting (A07). Strict IP-keyed limits on the unauthenticated sign-in and
// token routes; a broad backstop over the rest of the API. The expensive
// per-route limiters (isolate spawns, resource creation) are attached inside the
// app/arena routers. Refusals return 429 + error code E022.
app.use('/api/session', authRateLimit);
app.use('/api/oauth', authRateLimit);
app.use('/api', apiRateLimit);

app.use('/', express.static('./dist/public'));

app.use('/api/user', auth(true));
// Bot metadata-by-id (GET /api/app/:appId) is readable by any signed-in user for
// add-by-reference; it sits outside /api/user so gate it here. It returns
// metadata only — never source.
app.use('/api/app', auth(true));

app.use(healthEndpoints);
app.use(sessionEndpoints);
// OAuth 2.1 authorization-server endpoints (/.well-known/*, /authorize, /token,
// /register, /revoke) live at the app root — must be mounted before the SPA
// fallback below so they aren't swallowed by index.html.
app.use(oauthEndpoints);
app.use(mcpEndpoints);
app.use(demoEndpoints);
app.use(helpEndpoints);
app.use(userEndpoints);
app.use(appEndpoints);
app.use(arenaEndpoints);

// SPA fallback: serve index.html for any request not handled above. Express 5
// (path-to-regexp v8) no longer accepts a bare '*' route, so use a path-less
// middleware, which matches every method and path including the root.
app.use(function (req, res) {
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
const server = app.listen(port, () => {
  logger.info({ port }, `server started at http://localhost:${port}`);
  if (isLocalDev) {
    logger.info(
      'LOCAL DEV MODE — in-memory database + auth bypass (no Google sign-in). ' +
        'A "Local Dev" user with starter bots is created automatically. ' +
        'Set RDS_HOSTNAME (and NODE_ENV=production for deploys) to use a real database.'
    );
  }
});

// Graceful shutdown: on a deploy/restart signal, stop accepting new connections,
// dispose every live isolate (releasing native isolated-vm memory) and close the
// pg pool, so a redeploy doesn't leak native resources. This matters on the small
// prod instance where leaked isolates across in-place deploys contribute to OOM.
// Guarded so a repeated signal is a no-op, with a failsafe timeout in case the
// orderly close hangs (a stuck connection or pool client).
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(
    { event: LogEvent.SHUTDOWN, signal },
    `received ${signal}, shutting down gracefully`
  );

  const failsafe = setTimeout(() => {
    logger.error(
      { event: LogEvent.SHUTDOWN, signal },
      'graceful shutdown timed out; forcing exit'
    );
    process.exit(1);
  }, 10000);
  failsafe.unref();

  server.close(async () => {
    try {
      const isolatesDisposed = environmentService.disposeAll();
      await pool.end();
      logger.info(
        { event: LogEvent.SHUTDOWN, signal, isolatesDisposed },
        'graceful shutdown complete'
      );
    } catch (err) {
      logger.error(
        { event: LogEvent.SHUTDOWN, signal, err },
        'error during graceful shutdown'
      );
    } finally {
      clearTimeout(failsafe);
      process.exit(0);
    }
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
