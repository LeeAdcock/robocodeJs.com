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
  default: { get: vi.fn(), create: vi.fn() },
}));
vi.mock('../src/services/IdentityService', () => ({
  default: { get: vi.fn(), create: vi.fn() },
}));

import auth, { hashToken } from '../src/middleware/auth';
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

  it('resolves the user from a valid Bearer API token (by hash)', async () => {
    const user = { getId: () => 'u9' };
    vi.mocked(identityService.get).mockResolvedValue({
      getUserId: () => 'u9',
    } as never);
    vi.mocked(userService.get).mockResolvedValue(user as never);

    const req = {
      cookies: {},
      headers: { authorization: 'Bearer secret-token' },
    } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    // Looked up by the token's sha256 hash under the 'apikey' source, never the
    // raw token; and Google verification is not consulted for a Bearer request.
    const [source, sourceId] = vi.mocked(identityService.get).mock.calls[0];
    expect(source).toBe('apikey');
    expect(sourceId).toBe(hashToken('secret-token'));
    expect((req as { user: unknown }).user).toBe(user);
    expect(next).toHaveBeenCalled();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects an unknown Bearer token with 401 when required', async () => {
    vi.mocked(identityService.get).mockResolvedValue(undefined);
    const req = {
      cookies: {},
      headers: { authorization: 'Bearer nope' },
    } as never;
    const res = makeRes();
    const next = vi.fn();
    await auth(true)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
