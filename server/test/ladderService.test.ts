import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the heavy collaborators so we exercise the ladder's decision-handling
// (Elo wiring, broken-flagging, history, the in-flight guard) deterministically,
// without spinning up real isolates. runMatchToDecision is stubbed to return a
// canned match summary; AppService yields controllable fake apps.
vi.mock('../src/util/runMatch', () => ({
  runMatchToDecision: vi.fn(),
  DEFAULT_MATCH_TIMEOUT_MS: 60000,
}));
vi.mock('../src/services/AppService', () => ({
  default: { get: vi.fn(), getLadderCandidates: vi.fn() },
}));
vi.mock('../src/services/RankedMatchService', () => ({
  default: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../src/services/EnvironmentService', () => ({
  default: { metrics: vi.fn(() => ({ isolates: 0 })) },
}));
// LadderService now awards achievements (GitHub #121). Mock the award layer so
// these tests assert what the ladder HANDS it, and mock the pool so the
// transitive AchievementService import never reaches for a real Postgres.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/util/awardAchievements', () => ({
  recordLadderResult: vi.fn().mockResolvedValue(undefined),
}));

import appService from '../src/services/AppService';
import rankedMatchService from '../src/services/RankedMatchService';
import environmentService from '../src/services/EnvironmentService';
import { runMatchToDecision } from '../src/util/runMatch';
import ladderService from '../src/services/LadderService';
import { recordLadderResult } from '../src/util/awardAchievements';
import { STARTER_BOTS } from '../src/util/starterBots';

const metrics = vi.mocked(environmentService.metrics);

const getApp = vi.mocked(appService.get);
const getCandidates = vi.mocked(appService.getLadderCandidates);
const record = vi.mocked(rankedMatchService.record);
const runMatch = vi.mocked(runMatchToDecision);

// A ladder candidate row (as AppService.getLadderCandidates returns).
const cand = (
  appId: string,
  rating: number,
  ratingGames: number,
  userId = `owner-${appId}`,
  source = `// ${appId}`
) => ({ appId, userId, rating, ratingGames, source });

// A minimal App stand-in tracking rating/games/broken through the setters the
// ladder calls.
const makeApp = (id: string, rating: number, games: number, broken = false) => {
  const state = { rating, games, broken };
  return {
    getId: () => id,
    getUserId: () => `owner-${id}`,
    getName: () => `App ${id}`,
    getRating: () => state.rating,
    getRatingGames: () => state.games,
    isBroken: () => state.broken,
    setRating: vi.fn((r: number, g: number) => {
      state.rating = r;
      state.games = g;
      return Promise.resolve();
    }),
    setBroken: vi.fn((b: boolean) => {
      state.broken = b;
      return Promise.resolve();
    }),
  };
};

// Canned match summary: decided with `winnerId`, and per-app crash counts.
const summary = (
  winnerId: string | null,
  decided = true,
  crashed: Record<string, number> = {}
) =>
  ({
    match: { decided, winner: winnerId ? { id: winnerId } : null },
    leaderboard: [
      { id: 'A', crashedCount: crashed.A ?? 0, botsTotal: 5 },
      { id: 'B', crashedCount: crashed.B ?? 0, botsTotal: 5 },
    ],
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  metrics.mockReturnValue({ isolates: 0 } as never);
});

// Never let a started background loop leak into the next test.
afterEach(() => {
  ladderService.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LadderService.runOneMatch', () => {
  it('applies a zero-sum Elo update between equal apps and records the match', async () => {
    const a = makeApp('A', 1500, 20);
    const b = makeApp('B', 1500, 20);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
    runMatch.mockResolvedValue(summary('A'));

    const res = await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(res.ran).toBe(true);
    expect(res.decided).toBe(true);
    expect(res.winnerId).toBe('A');
    expect(res.a!.delta).toBeGreaterThan(0);
    expect(res.b!.delta).toBe(-res.a!.delta); // zero-sum between equals
    expect(a.setRating).toHaveBeenCalledWith(1500 + res.a!.delta, 21, true); // A won
    expect(b.setRating).toHaveBeenCalledWith(1500 + res.b!.delta, 21, false);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        appA: 'A',
        appB: 'B',
        winnerId: 'A',
        ratingABefore: 1500,
        ratingBBefore: 1500,
        seed: 7,
      })
    );
  });

  it('flags a fully-crashed app as broken while the opponent still wins', async () => {
    const a = makeApp('A', 1500, 5);
    const b = makeApp('B', 1500, 5);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
    // B's five bots all crashed; A survives and wins.
    runMatch.mockResolvedValue(summary('A', true, { B: 5 }));

    const res = await ladderService.runOneMatch('A', 'B', { seed: 1 });

    expect(res.winnerId).toBe('A');
    expect(res.b!.broken).toBe(true);
    expect(b.setBroken).toHaveBeenCalledWith(true);
    expect(a.setBroken).not.toHaveBeenCalled();
    // A one-sided crash is still a real result — ratings move.
    expect(a.setRating).toHaveBeenCalled();
    expect(b.setRating).toHaveBeenCalled();
  });

  it('does not move ratings when both apps crash out', async () => {
    const a = makeApp('A', 1500, 5);
    const b = makeApp('B', 1500, 5);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
    runMatch.mockResolvedValue(summary('A', true, { A: 5, B: 5 }));

    const res = await ladderService.runOneMatch('A', 'B', { seed: 2 });

    expect(res.winnerId).toBeNull(); // no-contest
    expect(a.setRating).not.toHaveBeenCalled();
    expect(b.setRating).not.toHaveBeenCalled();
    expect(a.setBroken).toHaveBeenCalledWith(true);
    expect(b.setBroken).toHaveBeenCalledWith(true);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ winnerId: null, deltaA: 0, deltaB: 0 })
    );
  });

  it('does not move ratings on an undecided (timed-out) match', async () => {
    const a = makeApp('A', 1500, 5);
    const b = makeApp('B', 1500, 5);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
    runMatch.mockResolvedValue(summary(null, false));

    const res = await ladderService.runOneMatch('A', 'B', { seed: 3 });

    expect(res.decided).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(a.setRating).not.toHaveBeenCalled();
    expect(b.setRating).not.toHaveBeenCalled();
  });

  it('refuses to run when an app id no longer resolves', async () => {
    getApp.mockResolvedValue(undefined as never);
    const res = await ladderService.runOneMatch('A', 'B');
    expect(res.ran).toBe(false);
    expect(res.reason).toBe('missing-app');
    expect(runMatch).not.toHaveBeenCalled();
  });

  it('refuses a concurrent match for an app already in flight', async () => {
    const a = makeApp('A', 1500, 5);
    const b = makeApp('B', 1500, 5);
    const c = makeApp('C', 1500, 5);
    getApp.mockImplementation((id) =>
      Promise.resolve({ A: a, B: b, C: c }[id] as never)
    );

    // Hold the first match open so A/B stay in flight.
    let release!: () => void;
    runMatch.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(summary('A'));
      }) as never
    );

    const first = ladderService.runOneMatch('A', 'B', { seed: 1 });
    // Let runOneMatch reach the in-flight registration + await.
    await Promise.resolve();
    await Promise.resolve();

    expect(ladderService.isBusy('A')).toBe(true);
    const blocked = await ladderService.runOneMatch('A', 'C', { seed: 2 });
    expect(blocked.ran).toBe(false);
    expect(blocked.reason).toBe('busy');

    release();
    await first;
    expect(ladderService.isBusy('A')).toBe(false); // lock released after teardown
  });
});

describe('LadderService.pickPair', () => {
  it('returns null when fewer than two apps are eligible', async () => {
    getCandidates.mockResolvedValue([cand('A', 1500, 0)] as never);
    expect(await ladderService.pickPair()).toBeNull();
  });

  it('excludes untouched starter bots from the pool', async () => {
    getCandidates.mockResolvedValue([
      cand('A', 1500, 0, 'o1', STARTER_BOTS[0].source),
      cand('B', 1500, 0, 'o2', STARTER_BOTS[1].source),
      cand('C', 1500, 0, 'o3', '// real bot'),
    ] as never);
    // Only C is a real bot, so no pair can be formed.
    expect(await ladderService.pickPair()).toBeNull();
  });

  it('anchors on a least-played bot and pairs the nearest rating', async () => {
    // Deterministic picks: Math.random()=0 => first of each band.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    getCandidates.mockResolvedValue([
      cand('veteran', 1500, 100),
      cand('rookie', 1200, 0), // fewest games -> anchor
      cand('near', 1210, 40), // closest rating to rookie -> opponent
      cand('far', 1900, 30),
    ] as never);

    const pair = await ladderService.pickPair();
    expect(pair).toEqual(['rookie', 'near']);
    rnd.mockRestore();
  });

  it('picks the nearest-rating opponent regardless of owner (same-owner allowed)', async () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    getCandidates.mockResolvedValue([
      cand('anchor', 1500, 0, 'me'),
      cand('mine', 1505, 50, 'me'), // closest, same owner — now eligible
      cand('rival', 1520, 50, 'you'), // farther, different owner
    ] as never);

    // The different-owner preference was dropped, so the closest bot wins even
    // though it shares an owner with the anchor.
    const pair = await ladderService.pickPair();
    expect(pair).toEqual(['anchor', 'mine']);
    rnd.mockRestore();
  });
});

describe('LadderService background loop', () => {
  it('runs matches while started and stops on stop()', async () => {
    const spy = vi
      .spyOn(ladderService, 'runNextMatch')
      .mockResolvedValue(null as never);

    ladderService.start({ concurrency: 1, idleMs: 0, matchIntervalMs: 0 });
    expect(ladderService.isLoopRunning()).toBe(true);
    await sleep(20);
    expect(spy).toHaveBeenCalled();

    ladderService.stop();
    expect(ladderService.isLoopRunning()).toBe(false);
    await sleep(5); // let the in-flight iteration settle
    const settled = spy.mock.calls.length;
    await sleep(20);
    expect(spy.mock.calls.length).toBe(settled); // no new matches after stop

    spy.mockRestore();
  });

  it('is idempotent — a second start() does not add workers', async () => {
    const spy = vi
      .spyOn(ladderService, 'runNextMatch')
      .mockResolvedValue(null as never);
    ladderService.start({
      concurrency: 1,
      idleMs: 1000,
      matchIntervalMs: 1000,
    });
    ladderService.start({
      concurrency: 1,
      idleMs: 1000,
      matchIntervalMs: 1000,
    });
    expect(ladderService.isLoopRunning()).toBe(true);
    ladderService.stop();
    spy.mockRestore();
  });

  it('backs off without running a match while user load is over the isolate ceiling', async () => {
    const spy = vi
      .spyOn(ladderService, 'runNextMatch')
      .mockResolvedValue(null as never);
    metrics.mockReturnValue({ isolates: 999 } as never); // heavy user load

    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      maxLiveIsolates: 40,
    });
    await sleep(20);
    expect(spy).not.toHaveBeenCalled(); // gated out

    metrics.mockReturnValue({ isolates: 0 } as never); // load clears
    await sleep(20);
    expect(spy).toHaveBeenCalled(); // now it runs

    ladderService.stop();
    spy.mockRestore();
  });
});

// ── Achievements (GitHub #121) ───────────────────────────────────────────────
// The ladder is the ONLY place a prestige badge can be earned, so these lock down
// what it hands the award layer. The award layer's own behavior is covered by
// awardAchievements.test.ts.
describe('LadderService — achievement awards', () => {
  const award = vi.mocked(recordLadderResult);

  // A fuller summary than the fixture above: awardAchievements reads per-app
  // userId and stats, which the Elo/history tests don't need.
  const richSummary = (
    winnerId: string | null,
    opts: {
      decided?: boolean;
      ownerA?: string;
      ownerB?: string;
      statsA?: Record<string, number>;
      statsB?: Record<string, number>;
      crashed?: Record<string, number>;
    } = {}
  ) => {
    const {
      decided = true,
      ownerA = 'owner-A',
      ownerB = 'owner-B',
      statsA = {},
      statsB = {},
      crashed = {},
    } = opts;
    const entry = (
      id: string,
      userId: string,
      stats: Record<string, number>
    ) => ({
      id,
      userId,
      crashedCount: crashed[id] ?? 0,
      botsTotal: 5,
      botsAlive: 5,
      stats: { shotsFired: 0, kills: 0, timesHit: 0, ...stats },
    });
    const winnerUser = winnerId === 'A' ? ownerA : ownerB;
    return {
      match: {
        decided,
        winner: winnerId ? { id: winnerId, userId: winnerUser } : null,
      },
      leaderboard: [entry('A', ownerA, statsA), entry('B', ownerB, statsB)],
    } as never;
  };

  const twoApps = (ratingA = 1500, ratingB = 1500) => {
    const a = makeApp('A', ratingA, 20);
    const b = makeApp('B', ratingB, 20);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
  };

  const resultFor = (userId: string) =>
    award.mock.calls.map((c) => c[0]).find((r) => r.userId === userId)!;

  it('awards both players, marking the winner won and the loser not', async () => {
    twoApps();
    runMatch.mockResolvedValue(
      richSummary('A', { statsA: { kills: 3, shotsFired: 40 } })
    );

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(award).toHaveBeenCalledTimes(2);
    expect(resultFor('owner-A')).toMatchObject({
      rated: true,
      winningAppId: 'A',
      stats: { kills: 3, shotsFired: 40 },
      facts: { won: true },
    });
    expect(resultFor('owner-B').facts.won).toBe(false);
  });

  it('tells each side which rating was theirs and which was the opponent’s', async () => {
    // Giant Slayer depends on getting this the right way round.
    twoApps(1400, 1700);
    runMatch.mockResolvedValue(richSummary('A'));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(resultFor('owner-A').facts).toMatchObject({
      myRatingBefore: 1400,
      opponentRatingBefore: 1700,
    });
    expect(resultFor('owner-B').facts).toMatchObject({
      myRatingBefore: 1700,
      opponentRatingBefore: 1400,
    });
  });

  // pickPair deliberately allows same-owner matchups, so this is a real case: one
  // award, both sides summed — never two awards handing one user a win AND a loss.
  it('awards a same-owner matchup once, with both sides summed', async () => {
    twoApps();
    runMatch.mockResolvedValue(
      richSummary('A', {
        ownerA: 'solo',
        ownerB: 'solo',
        statsA: { kills: 2, shotsFired: 10 },
        statsB: { kills: 1, shotsFired: 5 },
      })
    );

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(award).toHaveBeenCalledTimes(1);
    expect(resultFor('solo')).toMatchObject({
      stats: { kills: 3, shotsFired: 15 },
      facts: { won: true, botsAlive: 10, botsTotal: 10 },
    });
  });

  it('marks an undecided (timed-out) match unrated', async () => {
    twoApps();
    runMatch.mockResolvedValue(richSummary(null, { decided: false }));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    // Still awarded — the shots really were fired — but not as a ranked result,
    // so no ladderWins/ladderMatchesPlayed and no ladder badge.
    expect(award).toHaveBeenCalledTimes(2);
    for (const call of award.mock.calls) expect(call[0].rated).toBe(false);
  });

  it('marks a double-crash match unrated', async () => {
    twoApps();
    runMatch.mockResolvedValue(richSummary('A', { crashed: { A: 5, B: 5 } }));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    for (const call of award.mock.calls) expect(call[0].rated).toBe(false);
  });

  it('still rates a one-sided crash — the crasher legitimately lost', async () => {
    twoApps();
    runMatch.mockResolvedValue(richSummary('A', { crashed: { B: 5 } }));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    for (const call of award.mock.calls) expect(call[0].rated).toBe(true);
  });

  it('completes the match even if awarding throws', async () => {
    twoApps();
    runMatch.mockResolvedValue(richSummary('A'));
    award.mockRejectedValueOnce(new Error('db down'));

    const res = await ladderService.runOneMatch('A', 'B', { seed: 7 });

    // A badge is never worth failing a ranked match over: Elo and history stand.
    expect(res.ran).toBe(true);
    expect(res.winnerId).toBe('A');
    expect(record).toHaveBeenCalledOnce();
  });
});
