import { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

import type { AuthenticatedRequest } from './auth';
import { ErrorCodes } from '../types/ErrorCodes';
import { logger, LogEvent } from '../util/logger';

// Request rate limiting (OWASP A07). Protects the unauthenticated sign-in
// endpoint from credential stuffing/brute force, and the compute- and
// isolate-spawning endpoints from abuse, with a broad backstop over the whole
// API. A refused request returns HTTP 429 with a stable JSON body carrying
// error code E022 (documented in ui/public/docs/error-codes.md), so both the UI
// and tooling can recognize a rate-limit rejection distinctly from other 4xx.

// Disabled under the test runner so the existing suites (which fire many
// requests in a tight loop) aren't throttled. rateLimit.test.ts force-enables
// its own low-limit limiters directly, and RATE_LIMIT_ENABLED=1 can turn the
// real limiters on in any environment.
const disabled =
  process.env.RATE_LIMIT_ENABLED !== '1' && process.env.NODE_ENV === 'test';

// Per-window request budgets. Env-tunable (mirrors SANDBOX_TIMEOUT_MS) so limits
// can be tightened in production or relaxed for load tests without a code change.
const num = (name: string, fallback: number) =>
  Number(process.env[name]) || fallback;

// Key by authenticated user when present — fair per-account limits that can't be
// sidestepped by rotating source IPs — else by client IP. ipKeyGenerator
// normalizes IPv6 into a subnet block, as the library requires for any custom
// generator that falls back to an IP.
export const userOrIpKey = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).user?.getId?.();
  return userId ? `u:${userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
};

const ipKey = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? '')}`;

// Shared 429 responder: logs a monitorable event and returns the E022 body.
const rejected =
  (limiter: string) =>
  (req: Request, res: Response): void => {
    logger.warn(
      {
        event: LogEvent.RATE_LIMITED,
        limiter,
        key: userOrIpKey(req),
        method: req.method,
        path: req.path,
      },
      'rate limit exceeded'
    );
    res.status(429).json({
      code: ErrorCodes.E022,
      error:
        'Too many requests — you have hit a rate limit. Slow down and retry shortly.',
    });
  };

type LimiterOpts = {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
};

// Factory so tests can build a low-limit limiter with the same behavior as the
// production ones (see rateLimit.test.ts).
export const makeLimiter = (name: string, opts: LimiterOpts) =>
  rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: opts.keyGenerator ?? userOrIpKey,
    handler: rejected(name),
    skip: () => disabled,
  });

// Sign-in / token minting: strict, IP-keyed (the sign-in request has no user
// yet). Blunts credential stuffing against POST /api/session and abuse of the
// token-rotation routes.
export const authRateLimit = makeLimiter('auth', {
  windowMs: 10 * 60 * 1000,
  limit: num('RATE_LIMIT_AUTH_MAX', 20),
  keyGenerator: ipKey,
});

// Isolate-spawning routes (check / compile / reboot): each spins up an 8 MB
// isolate and runs untrusted code for up to the sandbox timeout, so this is the
// most expensive surface. Keyed per user.
export const computeRateLimit = makeLimiter('compute', {
  windowMs: 60 * 1000,
  limit: num('RATE_LIMIT_COMPUTE_MAX', 60),
});

// Resource-creating writes (new app / new arena). Keyed per user.
export const writeRateLimit = makeLimiter('write', {
  windowMs: 60 * 1000,
  limit: num('RATE_LIMIT_WRITE_MAX', 30),
});

// Broad backstop across the whole API, IP-keyed. Generous — the targeted
// limiters above do the real work; this only catches gross floods.
export const apiRateLimit = makeLimiter('api', {
  windowMs: 60 * 1000,
  limit: num('RATE_LIMIT_GENERAL_MAX', 600),
  keyGenerator: ipKey,
});
