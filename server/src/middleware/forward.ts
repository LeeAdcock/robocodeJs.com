import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import homeService, { Home } from '../services/HomeService';
import arenaService from '../services/ArenaService';
import { DEMO_USER_ID, UserId } from '../types/user';
import { instanceIdentity, InstanceIdentity } from '../util/instance';
import { isUuid } from '../util/uuid';
import { logger, LogEvent } from '../util/logger';
import {
  forwardCounters as metrics,
  isForwarded,
  markForwarded,
} from '../util/forwarded';

// Request forwarding to a user's home instance (GitHub #444, phase 3).
//
// Arena state lives in one process's memory. Each user has a home instance
// (the user_home lease, services/HomeService.ts), and any request that touches
// a user's arenas is served there. A request arriving anywhere else (the
// "edge") is proxied to the home, which serves it as if it had arrived
// directly. Two middlewares, mounted in index.ts before the body parsers:
//
//   acceptForwarded  on the home: verifies a forwarded request's signature and
//                    restores the client IP the edge saw. Mounted before the
//                    IP-keyed rate limiters, which skip verified requests (the
//                    edge already counted them).
//   forwardToHome    on the edge: resolves the request's owner, and proxies it
//                    if their home is another instance. On the home it answers
//                    421 if a forwarded request reached it after the user moved.
//
// Requests are signed with INTERNAL_FORWARD_SECRET. Without it this instance
// never forwards and never trusts a forwarded marker: it serves everything
// locally, exactly as before forwarding existed.

const H_FROM = 'x-robocode-forwarded';
const H_TS = 'x-robocode-forward-ts';
const H_IP = 'x-robocode-client-ip';
const H_SIG = 'x-robocode-forward-sig';
const H_MISDIRECTED = 'x-robocode-misdirected';

// A signature older than this is refused, so a captured forwarded request
// can't be replayed later.
const MAX_SKEW_MS = 60_000;
// How long to wait for a TCP connection to the home before treating it as
// unreachable. Same VPC, so a healthy home connects in a millisecond or two.
const CONNECT_TIMEOUT_MS = 2_000;
// Request bodies are buffered (so a misdirected request can be resent). The
// largest body any route accepts is 512 KB of bot source (index.ts).
const MAX_BODY_BYTES = 1024 * 1024;
// Hop-by-hop headers (RFC 9110 §7.6.1) belong to one connection, not the
// request, so they're never copied across the proxy. content-length is
// recomputed from the buffered body.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'content-length',
  // The edge's own server has already answered any 100-continue.
  'expect',
]);

export const sign = (
  secret: string,
  parts: { method: string; url: string; ts: string; from: string; ip: string }
): string =>
  createHmac('sha256', secret)
    .update(
      [parts.method, parts.url, parts.ts, parts.from, parts.ip].join('\n')
    )
    .digest('hex');

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

// The user whose home serves this request, or undefined if any instance can
// serve it. Path-based so it runs before auth and body parsing.
export const routingKey = async (
  req: Request,
  ownerOf: (arenaId: string) => Promise<UserId | undefined>
): Promise<UserId | undefined> => {
  const path = req.path;
  let m = /^\/api\/user\/([^/]+)\/./.exec(path);
  if (m) return isUuid(m[1]) ? m[1] : undefined;
  m = /^\/api\/arena\/([^/]+)(\/|$)/.exec(path);
  if (m) return isUuid(m[1]) ? ownerOf(m[1]) : undefined;
  if (/^\/api\/demo(\/|$)/.test(path)) return DEMO_USER_ID;
  return undefined;
};

// Arena ownership never changes, so an arena's owner is cached for the life of
// the process. Bounded by clearing it outright if it ever grows large: a miss
// is just one indexed lookup.
const OWNER_CACHE_MAX = 10_000;
const ownerCache = new Map<string, UserId>();
const lookupOwner = async (arenaId: string): Promise<UserId | undefined> => {
  const cached = ownerCache.get(arenaId);
  if (cached) return cached;
  const arena = await arenaService.get(arenaId);
  if (!arena) return undefined;
  if (ownerCache.size >= OWNER_CACHE_MAX) ownerCache.clear();
  ownerCache.set(arenaId, arena.getUserId());
  return arena.getUserId();
};

// The whole request body, or why there isn't one: too large, or the client
// went away before sending it all. Never rejects and always settles, so an
// abandoned upload neither hangs nor surfaces as a server error.
const readBody = (req: Request): Promise<Buffer | 'too-large' | 'aborted'> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve('too-large');
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve('aborted'));
    req.on('close', () => {
      if (!req.complete) resolve('aborted');
    });
  });

type Outcome = 'done' | 'misdirected' | 'unreachable' | 'failed';

export interface ForwardingOptions {
  secret?: string;
  identity?: () => Promise<InstanceIdentity>;
  homes?: Pick<typeof homeService, 'resolve' | 'forget' | 'claim'>;
  ownerOf?: (arenaId: string) => Promise<UserId | undefined>;
}

export const createForwarding = ({
  secret = process.env.INTERNAL_FORWARD_SECRET,
  identity = instanceIdentity,
  homes = homeService,
  ownerOf = lookupOwner,
}: ForwardingOptions = {}) => {
  const agent = new http.Agent({ keepAlive: true });

  const acceptForwarded = (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    const from = header(req, H_FROM);
    if (!from) return next();
    const ts = header(req, H_TS) ?? '';
    const ip = header(req, H_IP) ?? '';
    const sig = header(req, H_SIG) ?? '';
    const expected = secret
      ? sign(secret, { method: req.method, url: req.originalUrl, ts, from, ip })
      : '';
    const fresh = Math.abs(Date.now() - Number(ts)) <= MAX_SKEW_MS;
    const valid =
      !!secret &&
      fresh &&
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!valid) {
      // A forged or stale marker earns nothing: the request is treated as an
      // ordinary one from whoever sent it, IP limiters and all.
      logger.warn(
        { event: LogEvent.FORWARD_REJECTED, from, path: req.path },
        'ignored an unverifiable forwarded request marker'
      );
      return next();
    }
    markForwarded(req, from);
    // The edge resolved the client IP from its own proxy chain; trust that
    // rather than counting hops here, so req.ip (rate limiting, logs) is the
    // same as if the request had arrived directly.
    Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  };

  const proxy = async (
    req: Request,
    res: Response,
    home: Home,
    body: Buffer
  ): Promise<Outcome> => {
    const me = await identity();
    const ts = String(Date.now());
    const ip = req.ip ?? '';
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
    }
    headers['content-length'] = String(body.length);
    headers[H_FROM] = me.id;
    headers[H_TS] = ts;
    headers[H_IP] = ip;
    headers[H_SIG] = sign(secret as string, {
      method: req.method,
      url: req.originalUrl,
      ts,
      from: me.id,
      ip,
    });

    return new Promise<Outcome>((resolve) => {
      let connected = false;
      let settled = false;
      const settle = (outcome: Outcome) => {
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };
      const upstream = http.request(new URL(req.originalUrl, home.address), {
        method: req.method,
        headers,
        agent,
      });
      upstream.on('socket', (socket) => {
        if (!socket.connecting) {
          connected = true;
          return;
        }
        const timer = setTimeout(
          () => upstream.destroy(new Error('connect timeout')),
          CONNECT_TIMEOUT_MS
        );
        socket.once('connect', () => {
          connected = true;
          clearTimeout(timer);
        });
        socket.once('close', () => clearTimeout(timer));
      });
      upstream.on('response', (incoming) => {
        if (incoming.statusCode === 421 && incoming.headers[H_MISDIRECTED]) {
          incoming.resume();
          settle('misdirected');
          return;
        }
        const out: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (
            value !== undefined &&
            (!HOP_BY_HOP.has(name) || name === 'content-length')
          ) {
            out[name] = value;
          }
        }
        res.writeHead(incoming.statusCode ?? 502, out);
        // Streamed chunk by chunk: SSE responses (already gzipped and
        // sync-flushed per event by the home, see util/sse.ts) pass through
        // without being buffered or re-encoded here.
        incoming.pipe(res);
        incoming.on('end', () => settle('done'));
        incoming.on('error', () => {
          res.destroy();
          settle('done');
        });
      });
      upstream.on('error', (err) => {
        if (res.headersSent) {
          res.destroy();
          settle('done');
          return;
        }
        logger.warn(
          { event: LogEvent.FORWARD_FAILED, err, home: home.instanceId },
          'forward to home failed'
        );
        settle(connected ? 'failed' : 'unreachable');
      });
      // The client went away (closed tab, EventSource reconnect): stop the
      // upstream request too, so the home sees its SSE viewer leave.
      res.on('close', () => {
        upstream.destroy();
        settle('done');
      });
      upstream.end(body);
    });
  };

  const unavailable = (res: Response) => {
    metrics.failures++;
    res.setHeader('Retry-After', '5');
    res.status(503).json({ error: 'Arena host unavailable; retry shortly.' });
  };

  const forwardToHome = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (!secret) return next();
    let userId: UserId | undefined;
    try {
      userId = await routingKey(req, ownerOf);
    } catch (err) {
      logger.warn({ err, path: req.path }, 'forward routing lookup failed');
      return next();
    }
    if (!userId) return next();

    let home = await homes.resolve(userId);
    // No answer from the database: serve here, as before forwarding existed.
    if (!home || home.local) return next();

    if (isForwarded(req)) {
      // Another instance sent this here, but this instance isn't the user's
      // home (any more). Never forward again, which could loop; tell the edge
      // to look the home up afresh.
      metrics.misdirected++;
      res.setHeader(H_MISDIRECTED, '1');
      return res.status(421).json({ error: 'Misdirected request' });
    }

    const body = await readBody(req);
    if (body === 'aborted') return;
    if (body === 'too-large') {
      return res.status(413).json({ error: 'Request body too large' });
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await proxy(req, res, home, body);
      if (outcome === 'done') {
        metrics.forwarded++;
        return;
      }
      homes.forget(userId);
      if (outcome === 'failed') return unavailable(res);
      if (outcome === 'unreachable') {
        // The home may have died. If its lease has lapsed, take the user over
        // and serve here; a request with a body has already been read, so the
        // client retries it (Retry-After) and the retry lands locally.
        const claimed = await homes.claim(userId);
        if (claimed?.local && body.length === 0) return next();
        return unavailable(res);
      }
      // Misdirected: the cached home was stale. Look it up again, once.
      const fresh = await homes.resolve(userId);
      if (!fresh || fresh.local) {
        if (body.length === 0) return next();
        return unavailable(res);
      }
      home = fresh;
    }
    return unavailable(res);
  };

  return { acceptForwarded, forwardToHome };
};
