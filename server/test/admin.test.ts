import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// The admin API (GitHub #469). The gate runs the REAL auth middleware (only the
// Google verifier and account lookups are mocked), because the property under
// test is end to end: to anyone who isn't an admin, /api/admin/* must behave
// exactly like a path that doesn't exist, which here means falling through to
// the stand-in SPA fallback below.

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(function () {
    return { verifyIdToken };
  }),
}));
vi.mock('../src/services/IdentityService', () => ({
  default: {
    get: vi.fn(async (_source: string, sub: string) => ({
      getUserId: () => sub,
    })),
    create: vi.fn(),
  },
}));
vi.mock('../src/services/UserService', async () => {
  const { default: User } = await import('../src/types/user');
  const accounts: Record<string, InstanceType<typeof User>> = {
    'admin-id': new User('admin-id', 'Ada', 'pic', 'Admin@Example.com'),
    'user-id': new User('user-id', 'Bob', 'pic', 'bob@example.com'),
  };
  return {
    default: {
      get: vi.fn(async (id: string) => accounts[id]),
      create: vi.fn(),
      touchActivity: vi.fn().mockResolvedValue(false),
    },
  };
});
vi.mock('../src/services/AdminService', () => ({
  default: {
    overview: vi.fn(),
    users: vi.fn(),
    userDetail: vi.fn(),
    signupsByDay: vi.fn(),
    ladderApps: vi.fn(),
  },
}));
vi.mock('../src/services/LadderService', () => ({
  default: { adminSnapshot: vi.fn(), isLoopRunning: vi.fn(() => false) },
}));
vi.mock('../src/services/RankedMatchService', () => ({
  default: { outcomesSince: vi.fn() },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: {
    metrics: vi.fn(() => ({
      arenas: 1,
      runningArenas: 1,
      idlePausedArenas: 0,
      isolates: 2,
      maxAvgTickMs: 1.5,
    })),
  },
}));

import adminRouter from '../src/api/admin';
import adminService, { AdminUserRow } from '../src/services/AdminService';
import ladderService from '../src/services/LadderService';
import rankedMatchService from '../src/services/RankedMatchService';
import { logger } from '../src/util/logger';

// Google tokens: the cookie value names the account it signs in as.
verifyIdToken.mockImplementation(async ({ idToken }: { idToken?: string }) => {
  if (idToken === 'admin-token')
    return { getPayload: () => ({ sub: 'admin-id' }) };
  if (idToken === 'user-token')
    return { getPayload: () => ({ sub: 'user-id' }) };
  throw new Error('invalid token');
});

const FALLBACK = '<!doctype html><title>shell</title>';
const server = express();
server.use(cookieParser());
server.use(adminRouter);
// Stand-in for index.ts's SPA fallback: what an unknown path gets.
server.use((_req, res) => {
  res.status(200).type('html').send(FALLBACK);
});

const asAdmin = (path: string) =>
  request(server).get(path).set('Cookie', 'auth=admin-token');

const row = (over: Partial<AdminUserRow>): AdminUserRow => ({
  id: 'id',
  name: 'Name',
  email: 'e@x',
  picture: null,
  createdTimestamp: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-10-01T00:00:00.000Z',
  apps: 3,
  editedApps: 1,
  lastAppEdit: null,
  arenas: 1,
  mcpClients: 0,
  ...over,
});

const savedAdmins = process.env.ADMIN_EMAILS;
beforeEach(() => {
  process.env.ADMIN_EMAILS = ' someone@else.com , admin@example.COM ';
  vi.mocked(rankedMatchService.outcomesSince).mockResolvedValue({
    total: 0,
    unrated: 0,
  });
});
afterEach(() => {
  process.env.ADMIN_EMAILS = savedAdmins;
});

describe('admin gate', () => {
  const PATHS = [
    '/api/admin/me',
    '/api/admin/overview',
    '/api/admin/users',
    '/api/admin/users/11111111-1111-1111-1111-111111111111',
    '/api/admin/signups',
    '/api/admin/ladder',
  ];

  it.each(PATHS)(
    '%s looks like an unknown path to an anonymous caller',
    async (p) => {
      const res = await request(server).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toBe(FALLBACK);
    }
  );

  it.each(PATHS)(
    '%s looks like an unknown path to a signed-in non-admin',
    async (p) => {
      const res = await request(server).get(p).set('Cookie', 'auth=user-token');
      expect(res.text).toBe(FALLBACK);
    }
  );

  it('ignores a bearer token (an MCP token never reaches the admin API)', async () => {
    const res = await request(server)
      .get('/api/admin/me')
      .set('Authorization', 'Bearer admin-token');
    expect(res.text).toBe(FALLBACK);
  });

  it('treats an invalid cookie as anonymous, not as a 401', async () => {
    const res = await request(server)
      .get('/api/admin/me')
      .set('Cookie', 'auth=garbage');
    expect(res.text).toBe(FALLBACK);
  });

  it('never logs a non-admin as auth.forbidden (it would page the security alarm)', async () => {
    // auth.forbidden feeds the robocodejs-auth-forbidden alarm (>= 5 in 5 min),
    // which is for cross-user access; a non-admin opening /admin isn't that.
    const spies = (['warn', 'error', 'info'] as const).map((l) =>
      vi.spyOn(logger, l)
    );
    await request(server).get('/api/admin/me').set('Cookie', 'auth=user-token');
    for (const spy of spies) {
      for (const [obj] of spy.mock.calls)
        expect(JSON.stringify(obj)).not.toContain('auth.forbidden');
      spy.mockRestore();
    }
  });

  it('admits an allowlisted email, case- and whitespace-insensitively', async () => {
    const res = await asAdmin('/api/admin/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ admin: true });
  });

  it('admits nobody when ADMIN_EMAILS is unset or empty', async () => {
    delete process.env.ADMIN_EMAILS;
    expect((await asAdmin('/api/admin/me')).text).toBe(FALLBACK);
    process.env.ADMIN_EMAILS = ' , ';
    expect((await asAdmin('/api/admin/me')).text).toBe(FALLBACK);
  });

  it('leaves other paths alone', async () => {
    const res = await request(server)
      .get('/api/other')
      .set('Cookie', 'auth=admin-token');
    expect(res.text).toBe(FALLBACK);
  });
});

describe('GET /api/admin/overview', () => {
  it('combines the database counts with this instance’s gauges', async () => {
    const counts = { users: { total: 5 } };
    vi.mocked(adminService.overview).mockResolvedValue(counts as never);
    vi.mocked(rankedMatchService.outcomesSince).mockResolvedValue({
      total: 40,
      unrated: 4,
    });

    const res = await asAdmin('/api/admin/overview');

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual(counts);
    expect(res.body.metrics.isolates).toBe(2);
    expect(res.body.instance).toEqual(
      expect.objectContaining({
        hostname: expect.any(String),
        version: expect.any(String),
      })
    );
    expect(res.body.ladder).toEqual(
      expect.objectContaining({
        matchesDay: 40,
        unratedDay: 4,
        loopRunning: false,
      })
    );
  });

  it('answers a failed query with a 500, not a hang', async () => {
    vi.mocked(adminService.overview).mockRejectedValue(new Error('db down'));
    const res = await asAdmin('/api/admin/overview');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/admin/users', () => {
  const USERS = [
    row({
      id: 'u1',
      name: 'Alice',
      email: 'alice@x',
      lastActiveAt: '2026-10-30T00:00:00.000Z',
    }),
    row({
      id: 'u2',
      name: 'Bob',
      email: 'bob@x',
      lastActiveAt: '2026-10-20T00:00:00.000Z',
      editedApps: 0,
    }),
    row({
      id: 'u3',
      name: 'Cara',
      email: 'cara@x',
      lastActiveAt: '2020-01-01T00:00:00.000Z',
      apps: 18,
      mcpClients: 1,
    }),
    row({
      id: 'u4',
      name: 'Dan',
      email: 'dan@x',
      lastActiveAt: null,
      createdTimestamp: '2026-10-25T00:00:00.000Z',
      arenas: 9,
    }),
  ];
  beforeEach(() => vi.mocked(adminService.users).mockResolvedValue(USERS));

  const ids = (body: { users: AdminUserRow[] }) => body.users.map((u) => u.id);

  it('sorts by last activity by default, falling back to signup', async () => {
    const res = await asAdmin('/api/admin/users');
    expect(ids(res.body)).toEqual(['u1', 'u4', 'u2', 'u3']);
    expect(res.body.total).toBe(4);
    expect(res.body.limits).toEqual({ appsPerUser: 20, arenasPerUser: 10 });
  });

  it('searches name and email', async () => {
    expect(ids((await asAdmin('/api/admin/users?search=BOB')).body)).toEqual([
      'u2',
    ]);
    expect(ids((await asAdmin('/api/admin/users?search=cara@')).body)).toEqual([
      'u3',
    ]);
  });

  it.each([
    ['never-edited', ['u2']],
    ['near-cap', ['u4', 'u3']],
    ['dormant', ['u3']],
    ['mcp', ['u3']],
  ])('filters %s', async (filter, expected) => {
    const res = await asAdmin(`/api/admin/users?filter=${filter}`);
    expect(ids(res.body)).toEqual(expected);
  });

  it('pages, and clamps out-of-range paging params', async () => {
    const page = await asAdmin('/api/admin/users?limit=2&offset=1');
    expect(ids(page.body)).toEqual(['u4', 'u2']);
    expect(page.body.total).toBe(4);
    const clamped = await asAdmin('/api/admin/users?limit=99999&offset=-5');
    expect(clamped.body.limit).toBe(200);
    expect(clamped.body.offset).toBe(0);
  });

  it('ignores an unknown sort or filter', async () => {
    const res = await asAdmin('/api/admin/users?sort=evil&filter=evil');
    expect(ids(res.body)).toEqual(['u1', 'u4', 'u2', 'u3']);
  });
});

describe('GET /api/admin/users/:userId', () => {
  it('404s a malformed id without querying', async () => {
    const res = await asAdmin('/api/admin/users/not-a-uuid');
    expect(res.status).toBe(404);
    expect(adminService.userDetail).not.toHaveBeenCalledWith('not-a-uuid');
  });

  it('404s an unknown user', async () => {
    vi.mocked(adminService.userDetail).mockResolvedValue(undefined);
    const res = await asAdmin(
      '/api/admin/users/11111111-1111-1111-1111-111111111111'
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/ladder', () => {
  it('explains why each app outside the pool is not in it', async () => {
    vi.mocked(ladderService.adminSnapshot).mockResolvedValue({
      enabled: true,
      loopRunning: true,
      config: { pairMatchCap: 10 } as never,
      pool: [
        {
          appId: 'a',
          userId: 'o',
          rating: 1600.4,
          ratingGames: 30,
          updatedTimestamp: new Date('2026-10-01'),
        },
        {
          appId: 'b',
          userId: 'o',
          rating: 1700,
          ratingGames: 30,
          updatedTimestamp: new Date('2026-10-01'),
        },
      ],
      pairs: [{ appA: 'a', appB: 'b', matches: 10, saturated: true }],
      claimedAppIds: ['a'],
    });
    const recent = new Date().toISOString();
    const base = {
      userId: 'o',
      ownerName: 'Owner',
      broken: false,
      starter: false,
      empty: false,
      updatedTimestamp: recent,
      ownerActiveAt: recent,
      rating: 1500,
      ratingGames: 0,
      ratingWins: 0,
    };
    vi.mocked(adminService.ladderApps).mockResolvedValue([
      { ...base, id: 'a', name: 'Alpha', ratingWins: 20 },
      { ...base, id: 'b', name: 'Beta' },
      { ...base, id: 'c', name: 'Crashy', broken: true },
      { ...base, id: 'd', name: 'Starter', starter: true },
      {
        ...base,
        id: 'e',
        name: 'Old',
        updatedTimestamp: '2020-01-01T00:00:00.000Z',
      },
      {
        ...base,
        id: 'f',
        name: 'Gone',
        ownerActiveAt: '2020-01-01T00:00:00.000Z',
      },
      { ...base, id: 'g', name: 'Mystery' },
    ]);

    const res = await asAdmin('/api/admin/ladder');

    expect(res.status).toBe(200);
    expect(res.body.pool.map((p: { appId: string }) => p.appId)).toEqual([
      'b',
      'a',
    ]);
    expect(res.body.pool[1]).toEqual(
      expect.objectContaining({ name: 'Alpha', rating: 1600, wins: 20 })
    );
    expect(res.body.pairSummary).toEqual({ total: 1, saturated: 1, open: 0 });
    expect(res.body.claims).toEqual([
      { appId: 'a', name: 'Alpha', ownerName: 'Owner' },
    ]);
    expect(res.body.broken.map((b: { appId: string }) => b.appId)).toEqual([
      'c',
    ]);

    const reasons = Object.fromEntries(
      res.body.ineligible.apps.map(
        (i: { appId: string; reasons: string[] }) => [i.appId, i.reasons]
      )
    );
    // Starters are counted but not itemised.
    expect(reasons).toEqual({
      c: ['broken'],
      e: ['stale-app'],
      f: ['stale-owner'],
      g: ['unknown'],
    });
    expect(res.body.ineligible.reasons).toEqual({
      broken: 1,
      starter: 1,
      'stale-app': 1,
      'stale-owner': 1,
      unknown: 1,
    });
  });
});
