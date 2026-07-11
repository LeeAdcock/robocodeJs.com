import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// The leaderboard router just delegates to AppService.getLeaderboard; mock it so
// the route test is about the HTTP contract (public, JSON, error handling).
vi.mock('../src/services/AppService', () => ({
  default: { getLeaderboard: vi.fn() },
}));

import appService from '../src/services/AppService';
import leaderboardRouter from '../src/api/leaderboard';

const getLeaderboard = vi.mocked(appService.getLeaderboard);

describe('GET /api/leaderboard', () => {
  it('serves the top rated bots as JSON without requiring auth', async () => {
    getLeaderboard.mockResolvedValue([
      {
        rank: 1,
        appId: 'a1',
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
      name: 'Overlord',
      ownerName: 'Lee A.',
      rating: 1712,
    });
    // Never leak source through this public surface.
    expect(res.body[0]).not.toHaveProperty('source');
  });

  it('returns 500 (not a crash) when the query fails', async () => {
    getLeaderboard.mockRejectedValue(new Error('db down'));
    const res = await request(leaderboardRouter).get('/api/leaderboard');
    expect(res.status).toBe(500);
  });
});
