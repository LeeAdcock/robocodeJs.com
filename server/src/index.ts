import express, { NextFunction, Request, Response } from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';

import {
  createSeoResolver,
  renderHeadTags,
  SEO_REGION,
  type BlogEntry,
} from './util/seo';
import { buildSitemap } from './util/sitemap';

import auth from './middleware/auth';
import securityHeaders from './middleware/securityHeaders';
import { apiRateLimit, authRateLimit } from './middleware/rateLimit';
import { isLocalDev } from './util/devMode';
import { logger, LogEvent } from './util/logger';
import { collectMetrics } from './util/metrics';
import pool from './util/db';
import environmentService from './services/EnvironmentService';
import ladderService from './services/LadderService';

import healthEndpoints from './api/health';
import sessionEndpoints from './api/session';
import oauthEndpoints from './api/oauth';
import mcpEndpoints from './api/mcp';
import userEndpoints from './api/user';
import appEndpoints from './api/app';
import arenaEndpoints from './api/arena';
import helpEndpoints from './api/help';
import demoEndpoints from './api/demo';
import watchArenaEndpoints from './api/watchArena';
import leaderboardEndpoints from './api/leaderboard';

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
  // payloads; the octet-stream body is bot source code. The octet-stream limit
  // is a hard memory backstop set above the app-level source cap
  // (MAX_SOURCE_BYTES = 256 KB, enforced in api/app.ts) so a normal oversized
  // save is rejected in-route with a clean, documented 413/E025 rather than this
  // parser's generic 413; only a pathological body trips the parser.
  bodyParser.json({ limit: '256kb' }),
  bodyParser.raw({ type: 'application/octet-stream', limit: '512kb' }),
  cookieParser(),
]);

// Rate limiting (A07). Strict IP-keyed limits on the unauthenticated sign-in and
// token routes; a broad backstop over the rest of the API. The expensive
// per-route limiters (isolate spawns, resource creation) are attached inside the
// app/arena routers. Refusals return 429 + error code E022.
app.use('/api/session', authRateLimit);
app.use('/api/oauth', authRateLimit);
app.use('/api', apiRateLimit);

app.use(
  '/',
  express.static('./dist/public', {
    // Don't auto-serve index.html for "/" — let it fall through to the SPA
    // fallback below so the homepage gets its per-page SEO metadata injected
    // like every other route.
    index: false,
    // The raw markdown sources (/docs/**.md) and the blog manifest are fetched
    // by the SPA at runtime, but they are not human-facing pages — the real
    // routes are /blog/<slug>, /learn/<slug>, etc. Tell crawlers not to index
    // them, so they don't compete with the canonical pages as duplicate content.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.md') || filePath.endsWith('blog-index.json')) {
        res.setHeader('X-Robots-Tag', 'noindex');
      }
      // The mime registry maps .ts to video/mp2t (MPEG transport stream), so
      // the published robocode.d.ts would download instead of rendering as
      // text in the browser. text/typescript is unregistered but descriptive,
      // and browsers treat an unknown text/* subtype as displayable text.
      // Pre-set the type; send() won't override it.
      if (filePath.endsWith('.d.ts')) {
        res.setHeader('Content-Type', 'text/typescript; charset=utf-8');
      }
    },
  })
);

app.use('/api/user', auth(true));
// Bot metadata-by-id (GET /api/app/:appId) is readable by any signed-in user for
// add-by-reference; it sits outside /api/user so gate it here. It returns
// metadata only — never source.
app.use('/api/app', auth(true));

app.use(healthEndpoints);
app.use(leaderboardEndpoints);
app.use(sessionEndpoints);
// OAuth 2.1 authorization-server endpoints (/.well-known/*, /authorize, /token,
// /register, /revoke) live at the app root — must be mounted before the SPA
// fallback below so they aren't swallowed by index.html.
app.use(oauthEndpoints);
app.use(mcpEndpoints);
app.use(demoEndpoints);
// Public spectator routes (/api/arena/:arenaId...) — mounted here, before the
// /api/user tree, so the auth(true) gate above never runs on them; anonymous
// share-link visitors can watch a match. Read-only; logs and mutations stay
// owner-gated under /api/user.
app.use(watchArenaEndpoints);
app.use(helpEndpoints);
app.use(userEndpoints);
app.use(appEndpoints);
app.use(arenaEndpoints);

// --- SEO: per-page metadata + sitemap for the client-rendered public pages ---
// The UI is a single-page app, so every route below returns the same index.html
// shell. Without help, a crawler (and every social link-preview scraper that
// doesn't run JS) would see one generic <title> and empty description for the
// homepage, docs, lessons, and blog. We compute per-route metadata from the
// shared blog manifest and the markdown, and inject it into the shell.
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN || 'https://robocodejs.com'
).replace(/\/+$/, '');
const OG_IMAGE = PUBLIC_ORIGIN + '/og-card.png';

const readPublic = (rel: string): string | null => {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, rel), 'utf8');
  } catch {
    return null;
  }
};

const loadBlogIndex = (): BlogEntry[] => {
  const raw = readPublic('blog-index.json');
  if (!raw) return [];
  try {
    return JSON.parse(raw) as BlogEntry[];
  } catch {
    return [];
  }
};

const seo = createSeoResolver({
  blogIndex: loadBlogIndex(),
  readDoc: (name) => readPublic(`docs/${name}.md`),
  now: () => new Date(),
  origin: PUBLIC_ORIGIN,
});

app.get('/sitemap.xml', (_req, res) => {
  const lessonSlugs = (() => {
    try {
      return fs
        .readdirSync(path.join(PUBLIC_DIR, 'docs'))
        .filter((f) => f.startsWith('learn-') && f.endsWith('.md'))
        .map((f) => f.slice('learn-'.length, -'.md'.length));
    } catch {
      return [];
    }
  })();
  res.type('application/xml').send(
    buildSitemap({
      blogIndex: loadBlogIndex(),
      lessonSlugs,
      now: () => new Date(),
      origin: PUBLIC_ORIGIN,
    })
  );
});

// The shell is read once and cached; its <!--SEO:start--> … <!--SEO:end-->
// region is replaced per request with the computed <head> tags.
const shellHtml = (() => {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  } catch {
    return null;
  }
})();

// SPA fallback: serve index.html for any request not handled above. Express 5
// (path-to-regexp v8) no longer accepts a bare '*' route, so use a path-less
// middleware, which matches every method and path including the root.
app.use(function (req, res) {
  // Only GET navigations get the SEO treatment; other methods just get the
  // shell (or fall through to sendFile if the shell couldn't be read).
  if (req.method !== 'GET' || !shellHtml || !SEO_REGION.test(shellHtml)) {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  const meta = seo.resolve(req.path);
  const head = renderHeadTags(meta, OG_IMAGE);
  const html = shellHtml.replace(
    SEO_REGION,
    `<!--SEO:start-->\n    ${head}\n    <!--SEO:end-->`
  );
  res.type('html').send(html);
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

// Periodic operational-metrics heartbeat: emit the same cheap gauges /health
// serves as a structured `event=metrics` log line, so they become a time series
// for dashboards/alerting (e.g. a CloudWatch metric filter on the event field)
// without anyone having to poll /health. Interval is env-tunable (0 disables);
// unref'd so it never keeps the process alive during shutdown. Skipped under test.
const metricsIntervalMs = parseInt(
  process.env.METRICS_LOG_INTERVAL_MS || '60000'
);
if (process.env.NODE_ENV !== 'test' && metricsIntervalMs > 0) {
  const metricsTimer = setInterval(() => {
    logger.info(
      {
        event: LogEvent.METRICS,
        ...collectMetrics(),
        uptimeSec: Math.round(process.uptime()),
      },
      'operational metrics'
    );
  }, metricsIntervalMs);
  metricsTimer.unref();
}

// Global bot ladder (GitHub #151): a background loop that continuously runs
// ranked matches between eligible apps and adjusts their Elo. Opt-in via
// LADDER_ENABLED (off by default, never under test) because it is real,
// continuous isolate compute — see the LADDER_* knobs in LadderService.
if (process.env.NODE_ENV !== 'test' && process.env.LADDER_ENABLED === 'true') {
  ladderService.start();
}

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

  // Stop scheduling new ranked matches before tearing down isolates.
  ladderService.stop();

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
