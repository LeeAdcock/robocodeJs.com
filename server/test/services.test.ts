import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool. Services (and the domain types they build) call pool.query;
// here we feed it canned result sets and assert the row -> object mapping.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import pool from '../src/util/db';
import appService from '../src/services/AppService';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';
import { DEMO_USER_ID } from '../src/types/user';

const query = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('AppService', () => {
  it('get() returns undefined when no row matches', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    expect(await appService.get('missing')).toBeUndefined();
  });

  it('get() maps a row to a App', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'Cool Bot', source: '// code' }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getId()).toBe('a1');
    expect(app?.getUserId()).toBe('u1');
    expect(app?.getName()).toBe('Cool Bot');
    expect(app?.getSource()).toBe('// code');
    // hydration must not write back to the database (only the SELECT runs)
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('getForUser() maps each row to a App', async () => {
    query.mockResolvedValue({
      rows: [
        { appId: 'a1', name: 'N1', source: 's1' },
        { appId: 'a2', name: 'N2', source: 's2' },
      ],
      rowCount: 2,
    } as never);
    const apps = await appService.getForUser('u1');
    expect(apps.map((a) => a.getId())).toEqual(['a1', 'a2']);
    expect(apps.map((a) => a.getName())).toEqual(['N1', 'N2']);
  });

  it('get() coerces a NULL source (legacy rows) to an empty string', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'Cool Bot', source: null }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getSource()).toBe('');
  });

  it('create() inserts and returns an app owned by the user', async () => {
    const app = await appService.create('u1');
    expect(app.getUserId()).toBe('u1');
    expect(typeof app.getId()).toBe('string');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('INSERT INTO app'),
      })
    );
  });

  it('create() inserts a non-NULL empty-string source, not NULL', async () => {
    await appService.create('u1');
    const insert = query.mock.calls.find(([arg]) =>
      (arg as { text?: string }).text?.includes('INSERT INTO app')
    );
    expect(insert).toBeDefined();
    const { text, values } = insert![0] as { text: string; values: unknown[] };
    // source is now an explicit column in the insert, and its value is '' (never NULL)
    expect(text).toContain('source');
    expect(values).toContain('');
  });

  it('get() hydrates the ladder rating fields', async () => {
    query.mockResolvedValue({
      rows: [
        {
          userId: 'u1',
          name: 'Ranked Bot',
          source: '// code',
          rating: 1642,
          ratingGames: 12,
          broken: false,
        },
      ],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getRating()).toBe(1642);
    expect(app?.getRatingGames()).toBe(12);
    expect(app?.isBroken()).toBe(false);
  });

  it('get() defaults rating fields for legacy rows predating the ladder columns', async () => {
    query.mockResolvedValue({
      rows: [
        {
          userId: 'u1',
          name: 'Old Bot',
          source: '// code',
          rating: null,
          ratingGames: null,
          broken: null,
        },
      ],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getRating()).toBe(1500); // DEFAULT_RATING
    expect(app?.getRatingGames()).toBe(0);
    expect(app?.isBroken()).toBe(false);
  });

  it('setRating() persists rating, games, and a lastRankedAt stamp', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'N', source: 's' }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    query.mockClear();
    await app!.setRating(1580, 5, true);
    expect(app!.getRating()).toBe(1580);
    expect(app!.getRatingGames()).toBe(5);
    expect(app!.getRatingWins()).toBe(1); // won -> wins incremented
    const [{ text, values }] = query.mock.calls[0] as [
      { text: string; values: unknown[] },
    ];
    expect(text).toContain('rating=$2');
    expect(text).toContain('ratingWins=ratingWins + $4');
    expect(text).toContain('lastRankedAt=CURRENT_TIMESTAMP');
    expect(values).toEqual(['a1', 1580, 5, 1]);
  });

  it('getLeaderboard() maps rows, rounds rating, and computes rank + win rate', async () => {
    query.mockResolvedValue({
      rows: [
        {
          appId: 'a1',
          ownerUserId: 'u1',
          name: 'Bot1',
          ownerName: 'Lee Adcock',
          rating: 1712.4,
          ratingGames: 40,
          ratingWins: 30,
        },
        {
          appId: 'a2',
          ownerUserId: 'u2',
          name: 'Bot2',
          ownerName: 'Dana',
          rating: 1655,
          ratingGames: 10,
          ratingWins: 5,
        },
      ],
      rowCount: 2,
    } as never);
    const board = await appService.getLeaderboard(20);
    expect(board[0]).toMatchObject({
      rank: 1,
      appId: 'a1',
      ownerName: 'Lee A.', // abbreviated server-side for privacy
      rating: 1712,
      winRate: 0.75,
    });
    expect(board[1]).toMatchObject({ rank: 2, winRate: 0.5 });
    // Demo bots excluded; a wider scan than the display size is fetched so the
    // per-owner cap can drop rows and still fill the board.
    const [{ text, values }] = query.mock.calls[0] as [
      { text: string; values: unknown[] },
    ];
    expect(text).toContain('app.userId <> $2');
    expect(values).toEqual([500, DEMO_USER_ID]);
  });

  it('getLeaderboard() caps each owner at 3 bots and re-ranks', async () => {
    // u1 fields 5 top bots; u2 fields 2. Rows arrive in rating order.
    const rows = [
      ...[1800, 1790, 1780, 1770, 1760].map((r, k) => ({
        appId: `u1-${k}`,
        ownerUserId: 'u1',
        name: `A${k}`,
        ownerName: 'One',
        rating: r,
        ratingGames: 10,
        ratingWins: 5,
      })),
      ...[1700, 1690].map((r, k) => ({
        appId: `u2-${k}`,
        ownerUserId: 'u2',
        name: `B${k}`,
        ownerName: 'Two',
        rating: r,
        ratingGames: 10,
        ratingWins: 5,
      })),
    ];
    query.mockResolvedValue({ rows, rowCount: rows.length } as never);

    const board = await appService.getLeaderboard(20);
    // 3 of u1's + both of u2's = 5, and u1's 4th/5th are dropped.
    expect(board).toHaveLength(5);
    expect(board.filter((e) => e.appId.startsWith('u1-'))).toHaveLength(3);
    expect(board.map((e) => e.appId)).toEqual([
      'u1-0',
      'u1-1',
      'u1-2',
      'u2-0',
      'u2-1',
    ]);
    // Ranks are contiguous over the *displayed* rows, not the raw query order.
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('getLeaderboard() falls back to Anonymous for a profane owner name', async () => {
    query.mockResolvedValue({
      rows: [
        {
          appId: 'a1',
          name: 'Bot',
          ownerName: 'fucker',
          rating: 1500,
          ratingGames: 5,
          ratingWins: 2,
        },
      ],
      rowCount: 1,
    } as never);
    const board = await appService.getLeaderboard(20);
    expect(board[0].ownerName).toBe('Anonymous');
  });

  it('getLadderCandidates() excludes the demo user and maps eligible rows', async () => {
    query.mockResolvedValue({
      rows: [
        {
          appId: 'a1',
          userId: 'u1',
          rating: 1600,
          ratingGames: 8,
          source: '// bot',
        },
      ],
      rowCount: 1,
    } as never);
    const candidates = await appService.getLadderCandidates();
    expect(candidates[0]).toMatchObject({ appId: 'a1', rating: 1600 });
    const [{ text, values }] = query.mock.calls[0] as [
      { text: string; values: unknown[] },
    ];
    expect(text).toContain('app.userId <> $1');
    expect(values).toEqual([DEMO_USER_ID]);
  });

  it('setSource() clears the broken flag', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'N', source: 's', broken: true }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app!.isBroken()).toBe(true);
    query.mockClear();
    await app!.setSource('// edited');
    expect(app!.isBroken()).toBe(false);
    const [{ text }] = query.mock.calls[0] as [{ text: string }];
    expect(text).toContain('broken=false');
  });

  it('setName() sanitizes the name at the persistence chokepoint', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'N', source: 's' }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');

    // Control char stripped, length capped -> the *persisted* value is cleaned.
    query.mockClear();
    await app!.setName('Cool' + String.fromCodePoint(0) + 'Bot');
    let [{ values }] = query.mock.calls[0] as [{ values: unknown[] }];
    expect(values[1]).toBe('CoolBot');
    expect(app!.getName()).toBe('CoolBot');

    query.mockClear();
    await app!.setName('a'.repeat(80));
    [{ values }] = query.mock.calls[0] as [{ values: unknown[] }];
    expect((values[1] as string).length).toBe(50);

    // An all-junk name is a no-op — the current name is never blanked.
    query.mockClear();
    await app!.setName(String.fromCodePoint(0x200b));
    expect(query).not.toHaveBeenCalled();
    expect(app!.getName()).toBe('a'.repeat(50));
  });

  it('setName() rejects a profane name without writing', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'Fine Name', source: 's' }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    query.mockClear();
    await expect(app!.setName('fucking bot')).rejects.toThrow(/inappropriate/i);
    expect(query).not.toHaveBeenCalled();
    expect(app!.getName()).toBe('Fine Name'); // unchanged
  });
});

describe('ArenaService', () => {
  it('get() returns undefined when no row matches', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    expect(await arenaService.get('missing')).toBeUndefined();
  });

  it('get() maps a row to an Arena with default dimensions', async () => {
    query.mockResolvedValue({ rows: [{ userId: 'u1' }], rowCount: 1 } as never);
    const arena = await arenaService.get('ar1');
    expect(arena?.getId()).toBe('ar1');
    expect(arena?.getUserId()).toBe('u1');
    expect(arena?.getWidth()).toBe(750);
    expect(arena?.getHeight()).toBe(750);
  });

  it('getDefaultForUser() returns the first arena for the user', async () => {
    query.mockResolvedValue({
      rows: [{ arenaId: 'ar1' }, { arenaId: 'ar2' }],
      rowCount: 2,
    } as never);
    const arena = await arenaService.getDefaultForUser('u1');
    expect(arena.getId()).toBe('ar1');
    expect(arena.getUserId()).toBe('u1');
  });
});

describe('ArenaMemberService', () => {
  it('getForApp() maps rows to members (appId, arenaId, timestamp)', async () => {
    query.mockResolvedValue({
      rows: [{ arenaId: 'ar1', createdTimestamp: 1700000000000 }],
      rowCount: 1,
    } as never);
    const [member] = await arenaMemberService.getForApp('app1');
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('ar1');
    expect(member.getTimestamp()).toBe(1700000000000);
  });

  it('getForArena() maps rows to members', async () => {
    query.mockResolvedValue({
      rows: [{ appId: 'app1', createdTimestamp: 1700000000000 }],
      rowCount: 1,
    } as never);
    const [member] = await arenaMemberService.getForArena('ar1');
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('ar1');
  });

  it('create() inserts the row and returns a member with the correct ids', async () => {
    const member = await arenaMemberService.create('arena1', 'app1');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['arena1', 'app1', true] })
    );
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('arena1');
  });
});
