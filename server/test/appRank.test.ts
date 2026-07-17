import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/RankedMatchService', () => ({
  default: { deltasSince: vi.fn().mockResolvedValue([]) },
}));

import pool from '../src/util/db';
import appService, { rankWithOwnerCap } from '../src/services/AppService';

const query = vi.mocked(pool.query);

// A candidate row as the leaderboard SQL returns it. Ordering is the query's job,
// so these are written already sorted by rating.
const row = (appId: string, ownerUserId: string, rating: number) => ({
  appId,
  ownerUserId,
  name: appId,
  ownerName: 'Owner',
  rating,
  ratingGames: 50,
  ratingWins: 25,
});

beforeEach(() => query.mockReset());

// rankWithOwnerCap is THE definition of a board rank — getLeaderboard and getRanks
// both go through it, which is what stops a badge from disagreeing with the page.
describe('rankWithOwnerCap', () => {
  it('ranks an ordered list sequentially from 1', () => {
    const ranks = rankWithOwnerCap([
      { appId: 'a', ownerId: 'u1' },
      { appId: 'b', ownerId: 'u2' },
      { appId: 'c', ownerId: 'u3' },
    ]);
    expect([...ranks.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it("skips an owner's 4th bot and does not spend a rank on it", () => {
    const ranks = rankWithOwnerCap([
      { appId: 'a1', ownerId: 'u1' },
      { appId: 'a2', ownerId: 'u1' },
      { appId: 'a3', ownerId: 'u1' },
      { appId: 'a4', ownerId: 'u1' }, // capped out
      { appId: 'b1', ownerId: 'u2' },
    ]);
    expect(ranks.get('a4')).toBeUndefined();
    // The next eligible app takes rank 4 — the capped bot doesn't leave a hole,
    // which is the whole point: one owner can't push rivals down the board.
    expect(ranks.get('b1')).toBe(4);
  });
});

describe('AppService.getRanks', () => {
  it('returns the board rank for the requested apps only', async () => {
    query.mockResolvedValue({
      rows: [
        row('top', 'u1', 1900),
        row('mid', 'u2', 1500),
        row('low', 'u3', 1200),
      ],
    } as never);

    const ranks = await appService.getRanks(['low', 'top']);

    expect(ranks.get('top')).toBe(1);
    expect(ranks.get('low')).toBe(3);
    expect(ranks.has('mid')).toBe(false);
  });

  it('omits an app that is not on the board at all', async () => {
    query.mockResolvedValue({ rows: [row('other', 'u2', 1500)] } as never);
    const ranks = await appService.getRanks(['missing']);
    expect(ranks.has('missing')).toBe(false);
  });

  it('makes no query when asked for nothing', async () => {
    await appService.getRanks([]);
    expect(query).not.toHaveBeenCalled();
  });

  // The rank a badge sees must be the rank the rankings page shows, cap included.
  // Without this, an owner holding the top three would silently push everyone
  // else's badge threshold down by three.
  it('applies the owner cap, so rank matches what the board displays', async () => {
    query.mockResolvedValue({
      rows: [
        row('mine1', 'u1', 1900),
        row('mine2', 'u1', 1880),
        row('mine3', 'u1', 1870),
        row('mine4', 'u1', 1860), // capped out
        row('rival', 'u2', 1500),
      ],
    } as never);

    const ranks = await appService.getRanks(['rival', 'mine4']);

    expect(ranks.get('rival')).toBe(4);
    expect(ranks.has('mine4')).toBe(false);
  });
});
