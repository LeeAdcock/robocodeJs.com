import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted lets the mock factory and the tests share the same spy.
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock('google-auth-library', () => ({
  // Must be constructable (auth.ts does `new OAuth2Client(...)`), so use a
  // function expression, not an arrow.
  OAuth2Client: vi.fn(function () {
    return { verifyIdToken };
  }),
}));
vi.mock('../src/services/UserService', () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(),
    // Fire-and-forget activity bump the middleware makes after resolving a user.
    touchActivity: vi.fn().mockResolvedValue(false),
  },
}));
vi.mock('../src/services/IdentityService', () => ({
  default: { get: vi.fn(), create: vi.fn() },
}));

import auth from '../src/middleware/auth';
import userService from '../src/services/UserService';
import identityService from '../src/services/IdentityService';

const payload = (sub: string, extra: Record<string, unknown> = {}) => ({
  getPayload: () => ({
    sub,
    name: 'Ada',
    picture: 'pic',
    email: 'a@b.c',
    email_verified: true,
    ...extra,
  }),
});
const makeRes = () => ({
  status: vi.fn().mockReturnThis(),
  send: vi.fn(),
  clearCookie: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe('auth middleware', () => {
  it('attaches the user and calls next for a recognized token', async () => {
    verifyIdToken.mockResolvedValue(payload('g1'));
    vi.mocked(identityService.get).mockResolvedValue({
      getUserId: () => 'u1',
    } as never);
    const user = { getId: () => 'u1' };
    vi.mocked(userService.get).mockResolvedValue(user as never);

    const req = { cookies: { auth: 'tok' } } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    expect((req as { user: unknown }).user).toBe(user);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('auto-creates a user on first login', async () => {
    verifyIdToken.mockResolvedValue(payload('g2'));
    vi.mocked(identityService.get).mockResolvedValue(undefined);
    const user = { getId: () => 'u2' };
    vi.mocked(userService.create).mockResolvedValue(user as never);
    vi.mocked(identityService.create).mockResolvedValue(undefined as never);

    const req = { cookies: { auth: 'tok' } } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    expect(userService.create).toHaveBeenCalledWith('Ada', 'pic', 'a@b.c');
    expect(identityService.create).toHaveBeenCalledWith('u2', 'google', 'g2');
    expect((req as { user: unknown }).user).toBe(user);
    expect(next).toHaveBeenCalled();
  });

  it('rejects first-login sign-up when the Google email is not verified', async () => {
    verifyIdToken.mockResolvedValue(payload('g4', { email_verified: false }));
    vi.mocked(identityService.get).mockResolvedValue(undefined);

    const req = { cookies: { auth: 'tok' } } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalledWith('auth');
    expect(userService.create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid token with 401 when auth is required', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = makeRes();
    const next = vi.fn();
    await auth(true)({ cookies: {} } as never, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.clearCookie).toHaveBeenCalledWith('auth');
    expect(next).not.toHaveBeenCalled();
  });

  it('falls through to next for an invalid token when auth is optional', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = makeRes();
    const next = vi.fn();
    await auth(false)({ cookies: {} } as never, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500 (not 401) when the token is valid but the user lookup fails', async () => {
    // A valid credential whose downstream resolution throws (e.g. the database
    // is unreachable) is a server fault, not a bad credential — it must not be
    // mislabeled as a 401 (which is what masked the RDS SSL outage). The cookie
    // is left intact so the still-valid session isn't cleared on a server blip.
    verifyIdToken.mockResolvedValue(payload('g3'));
    vi.mocked(identityService.get).mockRejectedValue(
      new Error('no pg_hba.conf entry for host ..., no encryption')
    );
    const res = makeRes();
    const next = vi.fn();
    await auth(true)({ cookies: { auth: 'tok' } } as never, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  // Bearer tokens are no longer handled by this middleware — the MCP OAuth access
  // token is verified on /api/mcp by the SDK's requireBearerAuth (see api/mcp.ts).
  // A Bearer header here is simply ignored and the request falls through to the
  // Google-cookie path (401 when there's no valid cookie).
  it('ignores a Bearer header and falls through to the cookie path (401)', async () => {
    // No valid session cookie, so Google verification rejects → 401.
    verifyIdToken.mockRejectedValue(new Error('no credential'));
    const req = {
      cookies: {},
      headers: { authorization: 'Bearer whatever' },
    } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
