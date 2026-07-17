import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors services.test.ts: mock the pg pool only and assert the SQL we send and
// the row -> object mapping we get back. The pg-mem gate in db.test.ts covers
// whether the SQL itself actually behaves.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import pool from '../src/util/db';
import achievementService from '../src/services/AchievementService';

const query = vi.mocked(pool.query);
const USER = 'user-1';

// The text of the Nth non-DDL query (the module fires CREATE TABLEs at import).
const sentText = (): string => {
  const call = query.mock.calls.at(-1)![0] as { text: string };
  return call.text.replace(/\s+/g, ' ');
};
const sentValues = (): unknown[] =>
  (query.mock.calls.at(-1)![0] as { values: unknown[] }).values;

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('AchievementService.bump', () => {
  it('upserts every delta in ONE statement and returns the new totals', async () => {
    query.mockResolvedValue({
      rows: [
        { counter: 'shotsFired', value: 15 },
        { counter: 'kills', value: 3 },
      ],
      rowCount: 2,
    } as never);

    const totals = await achievementService.bump(USER, {
      shotsFired: 5,
      kills: 2,
    });

    expect(query).toHaveBeenCalledTimes(1);
    // One statement, and it ADDS rather than replaces — the property that makes
    // concurrent bumps for the same user safe without any locking.
    expect(sentText()).toContain('ON CONFLICT (userId, counter)');
    expect(sentText()).toContain(
      'DO UPDATE SET value = user_counter.value + EXCLUDED.value'
    );
    expect(sentText()).toContain('VALUES ($1, $2, $3), ($1, $4, $5)');
    expect(sentValues()).toEqual([USER, 'shotsFired', 5, 'kills', 2]);
    expect(totals).toEqual({ shotsFired: 15, kills: 3 });
  });

  it('converts a bigint total from a string (node-postgres) to a number', async () => {
    query.mockResolvedValue({
      rows: [{ counter: 'distanceTraveled', value: '123456789' }],
      rowCount: 1,
    } as never);
    const totals = await achievementService.bump(USER, { distanceTraveled: 1 });
    expect(totals).toEqual({ distanceTraveled: 123456789 });
  });

  it('skips the query entirely when there is nothing to add', async () => {
    // The counters are monotonic, so a zero or negative delta is never meaningful;
    // an empty flush must not cost a round trip.
    expect(await achievementService.bump(USER, {})).toEqual({});
    expect(await achievementService.bump(USER, { kills: 0 })).toEqual({});
    expect(await achievementService.bump(USER, { kills: -5 })).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });

  it('drops the zero deltas but still sends the real ones', async () => {
    query.mockResolvedValue({
      rows: [{ counter: 'kills', value: 1 }],
      rowCount: 1,
    } as never);
    await achievementService.bump(USER, { kills: 1, shotsFired: 0 });
    expect(sentValues()).toEqual([USER, 'kills', 1]);
    expect(sentText()).toContain('VALUES ($1, $2, $3)');
  });
});

describe('AchievementService.unlock', () => {
  it('inserts every id with DO NOTHING and returns only what it inserted', async () => {
    query.mockResolvedValue({
      rows: [{ achievementId: 'shots-1000' }],
      rowCount: 1,
    } as never);

    const unlocked = await achievementService.unlock(USER, [
      { id: 'first-kill' },
      { id: 'shots-1000' },
    ]);

    expect(sentText()).toContain(
      'ON CONFLICT (userId, achievementId) DO NOTHING'
    );
    // Callers pass the full eligible list every time; already-held ids are absorbed
    // by the conflict clause rather than filtered in JS.
    expect(unlocked).toEqual(['shots-1000']);
  });

  it('records the earning app for a ladder badge and null when none earned it', async () => {
    await achievementService.unlock(USER, [
      { id: 'ladder-flawless', appId: 'app-9' },
      { id: 'shots-1000' },
    ]);
    // A non-null appId always means "this bot did this"; counter badges accrue
    // across every app the user owns, so they store null.
    expect(sentValues()).toEqual([
      USER,
      'ladder-flawless',
      'app-9',
      'shots-1000',
      null,
    ]);
  });

  it('skips the query when there is nothing to unlock', async () => {
    expect(await achievementService.unlock(USER, [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('AchievementService reads', () => {
  it('maps counter rows into a totals object', async () => {
    query.mockResolvedValue({
      rows: [
        { counter: 'kills', value: '7' },
        { counter: 'shotsFired', value: 120 },
      ],
      rowCount: 2,
    } as never);
    expect(await achievementService.getCounters(USER)).toEqual({
      kills: 7,
      shotsFired: 120,
    });
  });

  it('maps unlocked rows, defaulting a missing appId to null', async () => {
    const when = new Date('2026-01-02T03:04:05Z');
    query.mockResolvedValue({
      rows: [
        {
          achievementId: 'ladder-flawless',
          appId: 'app-9',
          unlockedTimestamp: when,
        },
        { achievementId: 'shots-1000', appId: null, unlockedTimestamp: when },
      ],
      rowCount: 2,
    } as never);

    expect(await achievementService.getForUser(USER)).toEqual([
      {
        achievementId: 'ladder-flawless',
        appId: 'app-9',
        unlockedTimestamp: when,
      },
      { achievementId: 'shots-1000', appId: null, unlockedTimestamp: when },
    ]);
    // Quoted aliases: pg lowercases bare identifiers, so without them these come
    // back as achievementid/appid and the mapping silently yields undefined.
    expect(sentText()).toContain('achievementId as "achievementId"');
  });
});
