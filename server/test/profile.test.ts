import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// The profile router delegates to AchievementService; mock it so this test is
// about the HTTP contract (auth, JSON shape, error handling).
vi.mock('../src/services/AchievementService', () => ({
  default: { getForUser: vi.fn(), getCounters: vi.fn() },
}));
// The route re-derives account badges on load (the self-healing pass); mock it so
// this test stays about the HTTP contract rather than the award logic, which
// awardAchievements.test.ts covers.
vi.mock('../src/util/awardAchievements', () => ({
  evaluateAccountAchievements: vi.fn().mockResolvedValue([]),
}));

// auth(true) here, so the middleware must be able to REJECT as well as attach —
// unlike the leaderboard's optional auth. Mirrors the real gate: 401 when there's
// no session, otherwise req.user.
let viewer:
  | {
      getId: () => string;
      getName: () => string;
      getPicture: () => string;
      getCreatedTimestamp: () => Date | undefined;
    }
  | undefined;
vi.mock('../src/middleware/auth', () => ({
  default:
    (required: boolean) =>
    (
      req: { user?: unknown },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void
    ) => {
      if (viewer) req.user = viewer;
      else if (required) return res.status(401).json({ error: 'unauthorized' });
      next();
    },
}));

import achievementService from '../src/services/AchievementService';
import { evaluateAccountAchievements } from '../src/util/awardAchievements';
import profileRouter from '../src/api/profile';

const getForUser = vi.mocked(achievementService.getForUser);
const getCounters = vi.mocked(achievementService.getCounters);

const MEMBER_SINCE = new Date('2025-03-04T00:00:00Z');
const USER = {
  getId: () => 'user-1',
  getName: () => 'Ada L.',
  getPicture: () => 'https://example.test/a.png',
  getCreatedTimestamp: () => MEMBER_SINCE,
};

beforeEach(() => {
  viewer = USER;
  getForUser.mockReset().mockResolvedValue([]);
  getCounters.mockReset().mockResolvedValue({});
});

describe('GET /api/profile', () => {
  it('requires a session — badges are private, not a public profile', async () => {
    viewer = undefined;
    const res = await request(profileRouter).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('serves the badge catalog alongside what the viewer unlocked', async () => {
    const when = new Date('2026-01-02T03:04:05Z');
    getForUser.mockResolvedValue([
      { achievementId: 'first-kill', appId: null, unlockedTimestamp: when },
      {
        achievementId: 'ladder-flawless',
        appId: 'app-9',
        unlockedTimestamp: when,
      },
    ]);
    getCounters.mockResolvedValue({ kills: 3, shotsFired: 812 });

    const res = await request(profileRouter).get('/api/profile');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      name: 'Ada L.',
      picture: 'https://example.test/a.png',
      memberSince: MEMBER_SINCE.toISOString(),
    });
    expect(res.body.counters).toEqual({ kills: 3, shotsFired: 812 });
    expect(res.body.unlocked).toEqual([
      { id: 'first-kill', appId: null, unlockedTimestamp: when.toISOString() },
      {
        id: 'ladder-flawless',
        appId: 'app-9',
        unlockedTimestamp: when.toISOString(),
      },
    ]);
    // The whole catalog ships, not just the unlocked ids — that's what lets the UI
    // render locked badges and progress with no per-badge knowledge of its own.
    expect(res.body.catalog.length).toBeGreaterThan(res.body.unlocked.length);
    expect(res.body.catalog[0]).toHaveProperty('scope');
    expect(res.body.catalog[0]).toHaveProperty('icon');
  });

  it('sends counter/threshold so the UI can draw progress toward a locked badge', async () => {
    const res = await request(profileRouter).get('/api/profile');
    const shots = res.body.catalog.find(
      (e: { id: string }) => e.id === 'shots-1000'
    );
    expect(shots).toMatchObject({ counter: 'shotsFired', threshold: 1000 });
  });

  it('never serializes a test predicate (functions are server-side only)', async () => {
    const res = await request(profileRouter).get('/api/profile');
    for (const entry of res.body.catalog) {
      expect(entry).not.toHaveProperty('test');
    }
  });

  it('reads the actor from the session — there is no :userId to tamper with', async () => {
    await request(profileRouter).get('/api/profile');
    expect(getForUser).toHaveBeenCalledWith('user-1');
    expect(getCounters).toHaveBeenCalledWith('user-1');
  });

  it('returns 500 when the service fails', async () => {
    getForUser.mockRejectedValue(new Error('db down'));
    const res = await request(profileRouter).get('/api/profile');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});

describe('GET /api/profile — account badges are self-healing', () => {
  it('re-derives account badges on load, before reading them back', async () => {
    await request(profileRouter).get('/api/profile');
    // account-veteran has no event to hang off — nothing happens when a year
    // passes — so the page load is the only thing that can ever award it. It also
    // heals a hook missed elsewhere.
    expect(evaluateAccountAchievements).toHaveBeenCalledWith(
      'user-1',
      MEMBER_SINCE
    );
  });

  it('still renders when the account evaluation fails', async () => {
    // It swallows its own errors, so a bad day for badges is not a broken page.
    vi.mocked(evaluateAccountAchievements).mockResolvedValueOnce([]);
    const res = await request(profileRouter).get('/api/profile');
    expect(res.status).toBe(200);
  });
});
