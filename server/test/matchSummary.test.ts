import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildMatchSummary imports Environment (for the SUDDEN_DEATH_TIME constant),
// which transitively pulls in AppService → db. Stub the pool and the service so
// the util can be driven against lightweight mocks, mirroring the other unit
// tests. appService.get resolves the app metadata joined into each leaderboard row.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/services/AppService', () => ({
  default: { get: vi.fn() },
}));

import { buildMatchSummary, buildMatchStatus } from '../src/util/matchSummary';
import { SUDDEN_DEATH_TIME } from '../src/types/environment';
import { BotStats } from '../src/types/botStats';
import appService from '../src/services/AppService';

// A mock bot exposing just the fields buildMatchSummary reads.
const makeBot = (
  id: string,
  health: number,
  eliminatedAt: number | null,
  stats: Partial<BotStats> = {},
  appCrashed = false
) => ({
  id,
  health,
  eliminatedAt,
  appCrashed,
  stats: { ...new BotStats(), ...stats },
});

// A mock process (one app's five bots). buildMatchSummary reads `.appId` and
// `.bots`.
const makeProcess = (appId: string, bots: ReturnType<typeof makeBot>[]) => ({
  appId,
  getAppId: () => appId,
  bots,
});

const makeMember = (appId: string, timestamp: number) => ({
  getAppId: () => appId,
  getTimestamp: () => timestamp,
});

// A mock Environment with only the getters the util calls. clock.time resets to 0
// on restart, so `time` is the current match's duration.
const makeEnv = (
  processes: ReturnType<typeof makeProcess>[],
  { running = true, time = 900, seed = 7 } = {}
) =>
  ({
    getArena: () => ({ getWidth: () => 800, getHeight: () => 600 }),
    getProcesses: () => processes,
    isRunning: () => running,
    getTime: () => time,
    getSeed: () => seed,
  }) as never;

const APPS: Record<string, { name: string; userId: string }> = {
  a1: { name: 'Hunter', userId: 'u1' },
  a2: { name: 'Wanderer', userId: 'u2' },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appService.get).mockImplementation(
    async (id: string) =>
      ({
        getId: () => id,
        getName: () => APPS[id]?.name,
        getUserId: () => APPS[id]?.userId,
      }) as never
  );
});

describe('buildMatchSummary', () => {
  it('reports an undecided match when two apps still have living bots', async () => {
    const env = makeEnv([
      makeProcess('a1', [makeBot('t1', 80, null), makeBot('t2', 0, 300)]),
      makeProcess('a2', [makeBot('t3', 50, null), makeBot('t4', 40, null)]),
    ]);
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const summary = await buildMatchSummary(env, members);

    expect(summary.match.appCount).toBe(2);
    expect(summary.match.appsAlive).toBe(2);
    expect(summary.match.decided).toBe(false);
    expect(summary.match.winner).toBeNull();
    // Both alive → ranked by total health: a2 (90) above a1 (80).
    expect(summary.leaderboard.map((e) => e.id)).toEqual(['a2', 'a1']);
    expect(summary.leaderboard[0].rank).toBe(1);
    expect(summary.match.durationTicks).toBe(900); // = clock.time (resets on restart)
    expect(summary.match.suddenDeathTick).toBe(SUDDEN_DEATH_TIME);
    expect(summary.match.suddenDeath).toBe(false);
  });

  it('resolves the surviving app as the winner when the other is wiped out', async () => {
    const env = makeEnv([
      makeProcess('a1', [makeBot('t1', 0, 420), makeBot('t2', 0, 500)]),
      makeProcess('a2', [makeBot('t3', 25, null), makeBot('t4', 0, 480)]),
    ]);
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const summary = await buildMatchSummary(env, members);

    expect(summary.match.decided).toBe(true);
    expect(summary.match.appsAlive).toBe(1);
    expect(summary.match.winner).toEqual({
      id: 'a2',
      name: 'Wanderer',
      userId: 'u2',
    });
    // Living app ranks first; the eliminated app carries its last-bot death tick.
    expect(summary.leaderboard[0].id).toBe('a2');
    expect(summary.leaderboard[0].alive).toBe(true);
    expect(summary.leaderboard[0].eliminatedAt).toBeNull();
    expect(summary.leaderboard[1].id).toBe('a1');
    expect(summary.leaderboard[1].alive).toBe(false);
    expect(summary.leaderboard[1].eliminatedAt).toBe(500);
  });

  it('picks the last app eliminated as the winner once all are dead', async () => {
    const env = makeEnv(
      [
        makeProcess('a1', [makeBot('t1', 0, 300), makeBot('t2', 0, 450)]),
        makeProcess('a2', [makeBot('t3', 0, 700), makeBot('t4', 0, 820)]),
      ],
      { running: false }
    );
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const summary = await buildMatchSummary(env, members);

    expect(summary.running).toBe(false);
    expect(summary.match.appsAlive).toBe(0);
    expect(summary.match.decided).toBe(true);
    // a2's last bot (820) died after a1's (450) → a2 survived longest → winner.
    expect(summary.match.winner?.id).toBe('a2');
    expect(summary.leaderboard.map((e) => e.id)).toEqual(['a2', 'a1']);
    expect(summary.leaderboard[0].eliminatedAt).toBe(820);
  });

  it('aggregates stats, computes accuracy, and breaks out per-bot detail', async () => {
    const env = makeEnv([
      makeProcess('a1', [
        makeBot('t1', 100, null, { shotsFired: 6, shotsHit: 3, timesHit: 1 }),
        makeBot('t2', 0, 200, { shotsFired: 4, shotsHit: 0 }, true),
      ]),
      // An app that never fired → accuracy must be 0, not NaN.
      makeProcess('a2', [makeBot('t3', 100, null, { shotsFired: 0 })]),
    ]);
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const summary = await buildMatchSummary(env, members);

    const a1 = summary.leaderboard.find((e) => e.id === 'a1')!;
    expect(a1.stats.shotsFired).toBe(10);
    expect(a1.stats.shotsHit).toBe(3);
    expect(a1.stats.timesHit).toBe(1);
    expect(a1.stats.accuracy).toBeCloseTo(0.3);
    expect(a1.crashedCount).toBe(1);
    expect(a1.botsTotal).toBe(2);
    expect(a1.botsAlive).toBe(1);
    expect(a1.totalHealth).toBe(100);
    expect(a1.bots).toHaveLength(2);
    expect(a1.bots[1]).toMatchObject({
      id: 't2',
      health: 0,
      alive: false,
      crashed: true,
      eliminatedAt: 200,
    });

    const a2 = summary.leaderboard.find((e) => e.id === 'a2')!;
    expect(a2.stats.accuracy).toBe(0);
  });
});

describe('buildMatchStatus', () => {
  it('returns coarse standings with no stat blocks or per-bot arrays', async () => {
    const env = makeEnv([
      makeProcess('a1', [
        makeBot('t1', 80, null, { shotsFired: 6, shotsHit: 3 }),
        makeBot('t2', 0, 300),
      ]),
      makeProcess('a2', [makeBot('t3', 50, null), makeBot('t4', 40, null)]),
    ]);
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const status = await buildMatchStatus(env, members);

    expect(status.running).toBe(true);
    expect(status.clock.time).toBe(900);
    expect(status.match.appCount).toBe(2);
    expect(status.match.appsAlive).toBe(2);
    expect(status.match.decided).toBe(false);
    expect(status.match.winner).toBeNull();
    // Both alive → ranked by total health: a2 (90) above a1 (80).
    expect(status.standings.map((s) => s.id)).toEqual(['a2', 'a1']);
    expect(status.standings[0]).toEqual({
      rank: 1,
      id: 'a2',
      name: 'Wanderer',
      alive: true,
      botsAlive: 2,
      totalHealth: 90,
      eliminatedAt: null,
    });
    // Lean shape: no per-bot stats, no per-bot arrays, no ranking-only fields.
    const row = status.standings[0] as Record<string, unknown>;
    expect(row.stats).toBeUndefined();
    expect(row.bots).toBeUndefined();
    expect(row.shotsHit).toBeUndefined();
    expect(row.userId).toBeUndefined();
  });

  it('agrees with buildMatchSummary on order, decided, and winner', async () => {
    const processes = [
      makeProcess('a1', [makeBot('t1', 0, 420), makeBot('t2', 0, 500)]),
      makeProcess('a2', [makeBot('t3', 25, null), makeBot('t4', 0, 480)]),
    ];
    const members = [makeMember('a1', 1), makeMember('a2', 2)];

    const status = await buildMatchStatus(makeEnv(processes), members);
    const summary = await buildMatchSummary(makeEnv(processes), members);

    expect(status.match.decided).toBe(true);
    expect(status.match.winner).toEqual({
      id: 'a2',
      name: 'Wanderer',
      userId: 'u2',
    });
    // The two views must never disagree — they share the ranking/outcome helpers.
    expect(status.match).toEqual(summary.match);
    expect(status.standings.map((s) => s.id)).toEqual(
      summary.leaderboard.map((e) => e.id)
    );
    expect(status.standings[1].eliminatedAt).toBe(500);
  });
});
