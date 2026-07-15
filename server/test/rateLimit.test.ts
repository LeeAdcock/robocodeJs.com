// The real limiters are disabled under NODE_ENV=test so the other suites aren't
// throttled. Force them on for this file BEFORE the module is imported, then
// exercise the shared makeLimiter factory directly with a tiny limit.
process.env.RATE_LIMIT_ENABLED = '1';
// Tiny per-user MCP budget so the mcpRateLimit test below trips on the 2nd call.
// Read once at module-eval time, so it must be set before the dynamic import.
process.env.RATE_LIMIT_MCP_MAX = '1';

import { describe, it, expect } from 'vitest';
import express, { Request } from 'express';
import request from 'supertest';

describe('rate limiting', () => {
  it('refuses requests past the limit with HTTP 429 and error code E022', async () => {
    const { makeLimiter } = await import('../src/middleware/rateLimit');
    const limiter = makeLimiter('test', { windowMs: 60_000, limit: 2 });

    const app = express();
    app.get('/ping', limiter, (_req, res) => {
      res.status(200).send('ok');
    });
    const agent = request(app);

    // Two requests are within budget...
    expect((await agent.get('/ping')).status).toBe(200);
    expect((await agent.get('/ping')).status).toBe(200);

    // ...the third trips the limiter.
    const blocked = await agent.get('/ping');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'E022' });
    expect(blocked.body.error).toMatch(/too many requests/i);
  });

  it('keeps separate budgets per key', async () => {
    const { makeLimiter } = await import('../src/middleware/rateLimit');
    // Key by a header so the test can simulate two distinct callers sharing one
    // source IP (the production limiters key by user id, same idea).
    const limiter = makeLimiter('test-keyed', {
      windowMs: 60_000,
      limit: 1,
      keyGenerator: (req) => String(req.headers['x-caller'] ?? 'anon'),
    });
    const app = express();
    app.get('/ping', limiter, (_req, res) => {
      res.status(200).send('ok');
    });
    const agent = request(app);

    expect((await agent.get('/ping').set('x-caller', 'alice')).status).toBe(
      200
    );
    expect((await agent.get('/ping').set('x-caller', 'alice')).status).toBe(
      429
    );
    // A different caller still has their full budget.
    expect((await agent.get('/ping').set('x-caller', 'bob')).status).toBe(200);
  });

  it('mcpRateLimit keys the MCP surface per user, not per IP', async () => {
    const { mcpRateLimit } = await import('../src/middleware/rateLimit');

    const app = express();
    // Stand in for mcpAuth: populate req.user so the limiter's default
    // userOrIpKey resolves to u:<id> instead of falling back to the shared IP.
    app.post(
      '/api/mcp',
      (req: Request, _res, next) => {
        (req as unknown as { user: { getId: () => string } }).user = {
          getId: () => String(req.headers['x-user'] ?? 'anon'),
        };
        next();
      },
      mcpRateLimit,
      (_req, res) => {
        res.status(200).send('ok');
      }
    );
    const agent = request(app);

    // RATE_LIMIT_MCP_MAX=1 (set at top): alice's 2nd request trips E022, while
    // bob — same source IP — still has his own full budget.
    expect((await agent.post('/api/mcp').set('x-user', 'alice')).status).toBe(
      200
    );
    const blocked = await agent.post('/api/mcp').set('x-user', 'alice');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'E022' });
    expect((await agent.post('/api/mcp').set('x-user', 'bob')).status).toBe(
      200
    );
  });
});
