import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The public spectator router reuses the arena.ts view handlers, so mock the same
// data-access singletons those handlers touch — no Postgres, no isolates. The
// status/summary builders are covered in their own tests; here we only assert the
// public routes are wired up and reachable WITHOUT authentication.
vi.mock('../src/services/UserService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/AppService', () => ({ default: { get: vi.fn() } }));
vi.mock('../src/services/ArenaService', () => ({
  default: { get: vi.fn(), getDefaultForUser: vi.fn() },
}));
vi.mock('../src/services/ArenaMemberService', () => ({
  default: { getForArena: vi.fn() },
}));
vi.mock('../src/services/EnvironmentService', () => ({
  default: { get: vi.fn() },
}));
vi.mock('../src/util/arenaStatus', () => ({ buildArenaStatus: vi.fn() }));
vi.mock('../src/util/matchSummary', () => ({
  buildMatchSummary: vi.fn(),
  buildMatchStatus: vi.fn(),
}));

import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import environmentService from '../src/services/EnvironmentService';
import { buildArenaStatus } from '../src/util/arenaStatus';
import watchRouter from '../src/api/watchArena';

// A bare Express app with NO auth middleware and NO injected req.user — this is
// the whole point of the public tree: anonymous visitors can reach it.
function makeAnonApp() {
  const app = express();
  app.use(watchRouter);
  return app;
}

const fakeArena = (id: string, userId: string) => ({
  getId: () => id,
  getUserId: () => userId,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('public watch routes (/api/arena/:arenaId)', () => {
  it('serves the status snapshot to an anonymous visitor by arena UUID alone', async () => {
    (arenaService.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeArena('arena-1', 'owner-9')
    );
    (environmentService.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (
      arenaMemberService.getForArena as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (buildArenaStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'arena-1',
      running: true,
      apps: [],
    });

    const res = await request(makeAnonApp()).get('/api/arena/arena-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'arena-1' });
    // Resolved purely from the UUID — no owner userId was supplied or required.
    expect(arenaService.get).toHaveBeenCalledWith('arena-1');
  });

  it('404s for an unknown arena id', async () => {
    (arenaService.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const res = await request(makeAnonApp()).get('/api/arena/nope');

    expect(res.status).toBe(404);
    expect(buildArenaStatus).not.toHaveBeenCalled();
  });

  it('404s (not 500) when the id lookup throws — e.g. a mangled, non-UUID link', async () => {
    (arenaService.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('invalid input syntax for type uuid')
    );

    const res = await request(makeAnonApp()).get('/api/arena/not-a-uuid');

    expect(res.status).toBe(404);
    expect(buildArenaStatus).not.toHaveBeenCalled();
  });

  it('does NOT expose the private logs stream on the public tree', async () => {
    (arenaService.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeArena('arena-1', 'owner-9')
    );

    const res = await request(makeAnonApp()).get('/api/arena/arena-1/logs');

    // No /logs route is registered here — console output stays owner-only under
    // /api/user. Express returns 404 for the unmatched path.
    expect(res.status).toBe(404);
  });
});
