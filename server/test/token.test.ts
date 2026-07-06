import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Stub the auth middleware to a pass-through that injects a fixed user, so these
// tests exercise the token routes themselves rather than Google verification.
// hashToken is stubbed to a recognizable transform so we can assert the *hash*
// (never the raw token) is what gets stored.
vi.mock('../src/middleware/auth', () => ({
  default:
    () => (req: express.Request, _res: express.Response, next: () => void) => {
      (req as unknown as { user: unknown }).user = { getId: () => 'u1' };
      next();
    },
  hashToken: (t: string) => `h:${t}`,
}));

vi.mock('../src/services/IdentityService', () => ({
  default: {
    getForUser: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
    deleteForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

import tokenRouter from '../src/api/token';
import identityService from '../src/services/IdentityService';

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(tokenRouter);
  return app;
};

beforeEach(() => vi.clearAllMocks());

describe('token endpoints', () => {
  it('POST /api/token mints a token and stores only its hash', async () => {
    const res = await request(makeApp()).post('/api/token');

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);

    // Old token cleared first (rotate), then the new one stored as its hash.
    expect(identityService.deleteForUser).toHaveBeenCalledWith('u1', 'apikey');
    expect(identityService.create).toHaveBeenCalledWith(
      'u1',
      'apikey',
      `h:${res.body.token}`
    );
    // The raw token is never handed to the store.
    expect(identityService.create).not.toHaveBeenCalledWith(
      'u1',
      'apikey',
      res.body.token
    );
  });

  it('GET /api/token/new mints a fresh token (browser address-bar flow)', async () => {
    const res = await request(makeApp()).get('/api/token/new');

    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    // Rotates: clears the old token, stores only the new hash.
    expect(identityService.deleteForUser).toHaveBeenCalledWith('u1', 'apikey');
    expect(identityService.create).toHaveBeenCalledWith(
      'u1',
      'apikey',
      `h:${res.body.token}`
    );
    // A credential must never be cached.
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/token/new blocks a cross-site request (CSRF DoS) with 403', async () => {
    const res = await request(makeApp())
      .get('/api/token/new')
      .set('Sec-Fetch-Site', 'cross-site');

    expect(res.status).toBe(403);
    // The victim's existing token is left untouched (not rotated).
    expect(identityService.deleteForUser).not.toHaveBeenCalled();
    expect(identityService.create).not.toHaveBeenCalled();
  });

  it('GET /api/token/new allows a same-origin request', async () => {
    const res = await request(makeApp())
      .get('/api/token/new')
      .set('Sec-Fetch-Site', 'same-origin');

    expect(res.status).toBe(201);
    expect(identityService.create).toHaveBeenCalled();
  });

  it('GET /api/token reports existence without revealing a value', async () => {
    vi.mocked(identityService.getForUser).mockResolvedValueOnce([{}] as never);
    const present = await request(makeApp()).get('/api/token');
    expect(present.body).toEqual({ exists: true });
    expect(JSON.stringify(present.body)).not.toContain('token');

    vi.mocked(identityService.getForUser).mockResolvedValueOnce([]);
    const absent = await request(makeApp()).get('/api/token');
    expect(absent.body).toEqual({ exists: false });
  });

  it('DELETE /api/token revokes the token', async () => {
    const res = await request(makeApp()).delete('/api/token');
    expect(res.status).toBe(200);
    expect(identityService.deleteForUser).toHaveBeenCalledWith('u1', 'apikey');
  });
});
