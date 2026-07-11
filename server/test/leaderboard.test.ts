import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// The leaderboard router just delegates to AppService.getLeaderboard; mock it so
// the route test is about the HTTP contract (public, JSON, error handling).
vi.mock('../src/services/AppService', () => ({
  default: { getLeaderboard: vi.fn() },
}));

// The route mounts optional auth (auth(false)) so a logged-in viewer is
// resolved from their cookie. Mock the middleware so it neither hits Google nor
// loads the DB-backed user services: it just attaches whatever `viewer` we set.
let viewer: { getId: () => string } | undefined;
vi.mock('../src/middleware/auth', () => ({
  default: () => (req: { user?: unknown }, _res: unknown, next: () => void) => {
    if (viewer) req.user = viewer;
    next();
  },
}));

import appService from '../src/services/AppService';
import leaderboardRouter from '../src/api/leaderboard';

const getLeaderboard = vi.mocked(appService.getLeaderboard);

beforeEach(() => {
  viewer = undefined;
  getLeaderboard.mockReset();
});

describe('GET /api/leaderboard', () => {
  it('serves the top rated bots as JSON without requiring auth', async () => {
    getLeaderboard.mockResolvedValue([
      {
        rank: 1,
        color: 'blue',
        name: 'Overlord',
        ownerName: 'Lee A.',
        rating: 1712,
        games: 40,
        wins: 30,
        winRate: 0.75,
      },
    ] as never);

    const res = await request(leaderboardRouter).get('/api/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      rank: 1,
      color: 'blue',
      name: 'Overlord',
      ownerName: 'Lee A.',
      rating: 1712,
    });
    // A foreign row carries no real app id on this public surface.
    expect(res.body[0]).not.toHaveProperty('appId');
    // Never leak source through this public surface.
    expect(res.body[0]).not.toHaveProperty('source');
    // Anonymous viewer -> getLeaderboard called with no viewer id.
    expect(getLeaderboard).toHaveBeenCalledWith(20, undefined);
  });

  it('passes the logged-in viewer id so their own app ids are included', async () => {
    viewer = { getId: () => 'u1' };
    getLeaderboard.mockResolvedValue([] as never);
    const res = await request(leaderboardRouter).get('/api/leaderboard');
    expect(res.status).toBe(200);
    expect(getLeaderboard).toHaveBeenCalledWith(20, 'u1');
  });

  it('returns 500 (not a crash) when the query fails', async () => {
    getLeaderboard.mockRejectedValue(new Error('db down'));
    const res = await request(leaderboardRouter).get('/api/leaderboard');
    expect(res.status).toBe(500);
  });
});
