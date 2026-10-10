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
  default: {
    get: vi.fn(),
    getLadderCandidates: vi.fn(),
    // The rank badges (GitHub #121) look the board up after the rating update.
    getRanks: vi.fn(async () => new Map<string, number>()),
    // Cutoff for retiring a pair's pre-edit history. Null by default = "nothing
    // to prune", so tests that don't care see no prune.
    pairEditCutoff: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../src/services/RankedMatchService', () => ({
  default: {
    record: vi.fn().mockResolvedValue(undefined),
    deleteOlderThan: vi.fn().mockResolvedValue(0),
    // Pair-saturation inputs: no history and nothing stale, so by default every
    // pairing is open and these tests see the pre-cap selection behaviour.
    matchesForApp: vi.fn().mockResolvedValue([]),
    deleteStaleForPair: vi.fn().mockResolvedValue(0),
  },
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
const getRanks = vi.mocked(appService.getRanks);
const pairEditCutoff = vi.mocked(appService.pairEditCutoff);
const record = vi.mocked(rankedMatchService.record);
const deleteOlderThan = vi.mocked(rankedMatchService.deleteOlderThan);
const matchesForApp = vi.mocked(rankedMatchService.matchesForApp);
const deleteStaleForPair = vi.mocked(rankedMatchService.deleteStaleForPair);
const runMatch = vi.mocked(runMatchToDecision);

// A ladder candidate row (as AppService.getLadderCandidates returns).
const cand = (
  appId: string,
  rating: number,
  ratingGames: number,
  userId = `owner-${appId}`,
  source = `// ${appId}`,
  // Epoch unless a test cares: "last edited long ago", so every recorded match
  // counts toward the pair's saturation.
  updatedTimestamp = new Date(0)
) => ({ appId, userId, rating, ratingGames, source, updatedTimestamp });

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
  // clearAllMocks resets calls but NOT implementations, so re-pin this: a rank
  // map set by one test would otherwise leak into the next.
  getRanks.mockResolvedValue(new Map());
  deleteOlderThan.mockResolvedValue(0);
  matchesForApp.mockResolvedValue([]);
  deleteStaleForPair.mockResolvedValue(0);
  pairEditCutoff.mockResolvedValue(null);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Never let a started background loop leak into the next test. stop() only
// clears the run flag — a worker parked in its inter-match delay returns to the
// top of the loop and exits on the next macrotask, so yield before handing over.
// Without the yield a stale worker is still live when the next test's start()
// flips the flag back on, and it resumes against the config IT captured.
afterEach(async () => {
  ladderService.stop();
  await sleep(5);
});

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

  it('forwards the bounded match speed (CPU throttle) to the match runner', async () => {
    const a = makeApp('A', 1500, 5);
    const b = makeApp('B', 1500, 5);
    getApp.mockImplementation((id) =>
      Promise.resolve((id === 'A' ? a : b) as never)
    );
    runMatch.mockResolvedValue(summary('A'));

    await ladderService.runOneMatch('A', 'B', { seed: 9, speed: 20 });

    // runMatchToDecision caps the tick rate instead of running unbounded, so the
    // ladder never pins the box at 100%.
    expect(runMatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ seed: 9, speed: 20 })
    );
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

// ── Per-pair saturation cap ─────────────────────────────────────────────────
// The pool is small (12 apps in prod = 66 pairs) and the loop was replaying
// every pairing ~85x/day forever, long past the ~20-40 games a rating needs.
// The cap stops a pair once it has met `pairMatchCap` times since EITHER side's
// code last changed, so the ladder goes quiet until someone edits a bot.
describe('LadderService.pickPair — pair saturation', () => {
  // Build a SYMMETRIC matchesForApp mock from pair records. The real query
  // matches `(appA=$1 OR appB=$1)`, so it returns a pair's rows whichever column
  // each app landed in — a one-sided fixture would make a saturated pair look
  // open from the other app's turn as anchor, which is exactly the bug a cap
  // like this would ship with if the test were asymmetric.
  //
  // `since` is ignored here: the query filters by the anchor's edit time in SQL,
  // but pickPair re-applies max(anchor, opponent) in JS, so leaving it to the
  // code under test gives the same answer and keeps the fixture honest.
  const history = (pairs: { x: string; y: string; n: number; at?: Date }[]) =>
    matchesForApp.mockImplementation(async (appId: string) =>
      pairs.flatMap(({ x, y, n, at = new Date('2026-06-01') }) =>
        appId === x || appId === y
          ? Array.from({ length: n }, () => ({
              opponentId: appId === x ? y : x,
              at,
            }))
          : []
      )
    );

  it('will not re-pair two apps that have played their quota', async () => {
    getCandidates.mockResolvedValue([cand('a', 1500, 10), cand('b', 1500, 10)]);
    history([{ x: 'a', y: 'b', n: 10 }]);

    expect(await ladderService.pickPair({ pairMatchCap: 10 })).toBeNull();
  });

  it('still pairs them one short of the quota', async () => {
    getCandidates.mockResolvedValue([cand('a', 1500, 10), cand('b', 1500, 10)]);
    history([{ x: 'a', y: 'b', n: 9 }]);

    expect(await ladderService.pickPair({ pairMatchCap: 10 })).not.toBeNull();
  });

  it('moves to another anchor rather than giving up when one is exhausted', async () => {
    // 'a' is capped against both others; 'b' vs 'c' is still open. An exhausted
    // ANCHOR must not read as an exhausted POOL.
    getCandidates.mockResolvedValue([
      cand('a', 1500, 0), // fewest games, so chosen as anchor first
      cand('b', 1500, 50),
      cand('c', 1500, 50),
    ]);
    history([
      { x: 'a', y: 'b', n: 10 },
      { x: 'a', y: 'c', n: 10 },
    ]);

    const pair = await ladderService.pickPair({ pairMatchCap: 10 });
    expect(pair).not.toBeNull();
    expect(new Set(pair!)).toEqual(new Set(['b', 'c']));
  });

  it('excludes only the saturated opponent, not the whole pool', async () => {
    getCandidates.mockResolvedValue([
      cand('a', 1500, 0),
      cand('b', 1500, 50),
      cand('c', 1500, 50),
    ]);
    history([{ x: 'a', y: 'b', n: 10 }]); // a-vs-b done, a-vs-c open

    expect(await ladderService.pickPair({ pairMatchCap: 10 })).toEqual([
      'a',
      'c',
    ]);
  });

  it('ignores matches played BEFORE either side was last edited', async () => {
    // 20 past meetings, but 'b' was edited after all of them, so none count:
    // the pairing is open again against 'b' s new code.
    getCandidates.mockResolvedValue([
      cand('a', 1500, 10, 'owner-a', '// a', new Date('2026-01-01')),
      cand('b', 1500, 10, 'owner-b', '// b', new Date('2026-09-01')),
    ]);
    history([{ x: 'a', y: 'b', n: 20, at: new Date('2026-06-01') }]);

    expect(await ladderService.pickPair({ pairMatchCap: 10 })).not.toBeNull();
  });

  it('counts a pair from the LATER of the two edit times', async () => {
    // 'a' edited Jan, 'b' edited Sep. The 10 meetings in Jun predate 'b' s edit
    // and must not count; the 10 in Oct do — so the pair is saturated.
    getCandidates.mockResolvedValue([
      cand('a', 1500, 10, 'owner-a', '// a', new Date('2026-01-01')),
      cand('b', 1500, 10, 'owner-b', '// b', new Date('2026-09-01')),
    ]);
    history([
      { x: 'a', y: 'b', n: 10, at: new Date('2026-06-01') },
      { x: 'a', y: 'b', n: 10, at: new Date('2026-10-01') },
    ]);

    expect(await ladderService.pickPair({ pairMatchCap: 10 })).toBeNull();
  });

  it('applies no cap when pairMatchCap is 0 (play forever)', async () => {
    getCandidates.mockResolvedValue([cand('a', 1500, 10), cand('b', 1500, 10)]);
    history([{ x: 'a', y: 'b', n: 1000 }]);

    expect(await ladderService.pickPair({ pairMatchCap: 0 })).not.toBeNull();
    // Nothing to count, so the history is never even fetched.
    expect(matchesForApp).not.toHaveBeenCalled();
  });
});

// ── Pair history retirement ─────────────────────────────────────────────────
// Per-pair pruning at write time is the PRIMARY retention rule: what remains for
// a pair is its head-to-head record between the two apps' current versions,
// which is also exactly what the saturation cap counts. The hourly sweep is only
// a GC for pairings that stopped playing.
describe('LadderService — pair history retirement', () => {
  // 'A'/'B' because the shared `summary` fixture's leaderboard is keyed on those
  // ids — other ids read as "no entry", which the crash check treats as fully
  // crashed, leaving the match unrated and masking what these tests assert.
  const run = () => ladderService.runOneMatch('A', 'B', { seed: 7 });

  beforeEach(() => {
    getApp.mockImplementation(async (id: string) =>
      id === 'A' ? makeApp('A', 1500, 30) : makeApp('B', 1500, 30)
    );
    runMatch.mockResolvedValue(summary('A') as never);
  });

  it('retires the pair rows that predate the later edit, after recording', async () => {
    const cutoff = new Date('2026-09-01T00:00:00Z');
    pairEditCutoff.mockResolvedValue(cutoff);

    await run();

    expect(pairEditCutoff).toHaveBeenCalledWith('A', 'B');
    expect(deleteStaleForPair).toHaveBeenCalledWith('A', 'B', cutoff);
    // Order matters: the row just written is newer than the cutoff and must
    // survive, which only holds if record() happens first.
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      deleteStaleForPair.mock.invocationCallOrder[0]
    );
  });

  it('prunes nothing when neither app resolves a cutoff', async () => {
    pairEditCutoff.mockResolvedValue(null);
    await run();
    expect(deleteStaleForPair).not.toHaveBeenCalled();
  });

  it('still completes a rated match when the prune throws', async () => {
    pairEditCutoff.mockResolvedValue(new Date('2026-09-01T00:00:00Z'));
    deleteStaleForPair.mockRejectedValue(new Error('db down'));

    const res = await run();

    // A bookkeeping failure must not unwind a match that already moved ratings.
    expect(res.ran).toBe(true);
    expect(res.winnerId).toBe('A');
    expect(record).toHaveBeenCalled();
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

  it('passes the configured match speed (CPU cap) to each match', async () => {
    const spy = vi
      .spyOn(ladderService, 'runNextMatch')
      .mockResolvedValue(null as never);

    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      matchSpeed: 15,
    });
    await sleep(20);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ speed: 15 }));

    ladderService.stop();
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

// ── Ranked-match retention ──────────────────────────────────────────────────
// ranked_match is append-only and the ladder is its only writer, so the loop
// enforces retention itself. Without this the table grew forever (~4,500
// rows/day in prod) and its index with it — the squeeze that tripped the RDS
// freeable-memory alarm on 2026-10-09.
describe('LadderService — ranked match retention', () => {
  // Keep these from running real matches; the sweep is what's under test.
  const stubMatches = () =>
    vi.spyOn(ladderService, 'runNextMatch').mockResolvedValue(null as never);

  it('prunes history older than the retention window on the first iteration', async () => {
    const spy = stubMatches();
    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      retentionDays: 7,
    });
    await sleep(20);
    ladderService.stop();

    expect(deleteOlderThan).toHaveBeenCalled();
    const [cutoff, batchSize] = deleteOlderThan.mock.calls[0];
    // 7 days back, give or take the time the test took to get here.
    const ageMs = Date.now() - (cutoff as Date).getTime();
    expect(ageMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
    expect(batchSize).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('sweeps at most once per interval however many times the loop turns', async () => {
    const spy = stubMatches();
    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      retentionDays: 7,
    });
    await sleep(40); // many loop turns at idleMs 0
    ladderService.stop();

    // One sweep, not one per turn — the hourly slot is claimed on the first.
    expect(deleteOlderThan).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('keeps deleting in batches while each batch comes back full', async () => {
    const spy = stubMatches();
    // A backlog: two full batches, then a short one that ends the sweep.
    deleteOlderThan
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(5000)
      .mockResolvedValueOnce(12);

    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      retentionDays: 7,
    });
    await sleep(20);
    ladderService.stop();

    expect(deleteOlderThan).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('does not prune when retention is disabled (0 = keep forever)', async () => {
    const spy = stubMatches();
    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      retentionDays: 0,
    });
    await sleep(20);
    ladderService.stop();

    expect(deleteOlderThan).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('keeps matchmaking running when the prune fails', async () => {
    const spy = stubMatches();
    deleteOlderThan.mockRejectedValue(new Error('db down'));

    ladderService.start({
      concurrency: 1,
      idleMs: 0,
      matchIntervalMs: 0,
      retentionDays: 7,
    });
    await sleep(20);
    ladderService.stop();

    // A prune that can't run must never take the ladder down with it.
    expect(deleteOlderThan).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
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
      suddenDeath?: boolean;
    } = {}
  ) => {
    const {
      decided = true,
      suddenDeath = false,
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
      stats: { shotsFired: 0, shotsHit: 0, kills: 0, timesHit: 0, ...stats },
    });
    const winnerUser = winnerId === 'A' ? ownerA : ownerB;
    return {
      match: {
        decided,
        suddenDeath,
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

  // The feat badges need facts the summary already has, but that the ladder has to
  // actually pass along — and a widened LadderFacts can't fail a test on its own,
  // since tsc only covers src/. So assert they arrive.
  it('passes the accuracy and sudden-death facts to the award layer', async () => {
    twoApps();
    runMatch.mockResolvedValue(
      richSummary('A', {
        statsA: { shotsFired: 30, shotsHit: 20 },
        suddenDeath: true,
      })
    );

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(resultFor('owner-A').facts).toMatchObject({
      shotsFired: 30,
      shotsHit: 20,
      suddenDeath: true,
    });
    // Match-level, so the loser sees it too.
    expect(resultFor('owner-B').facts.suddenDeath).toBe(true);
  });

  it('sums both sides of a same-owner matchup for the accuracy facts', async () => {
    twoApps();
    runMatch.mockResolvedValue(
      richSummary('A', {
        ownerA: 'solo',
        ownerB: 'solo',
        statsA: { shotsFired: 10, shotsHit: 6 },
        statsB: { shotsFired: 10, shotsHit: 2 },
      })
    );

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(resultFor('solo').facts).toMatchObject({
      shotsFired: 20,
      shotsHit: 8,
    });
  });

  // The rank badges (GitHub #121). The ladder's job is to look the board up AFTER
  // the rating update and hand each app's rank to the award layer, which owns the
  // policy. These cover the wiring and — because a board scan isn't free — that it
  // is skipped whenever it couldn't matter.
  it('hands each app its board rank, looked up after the rating update', async () => {
    twoApps();
    getRanks.mockResolvedValue(
      new Map([
        ['A', 2],
        ['B', 7],
      ])
    );
    runMatch.mockResolvedValue(richSummary('A'));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(getRanks).toHaveBeenCalledWith(['A', 'B']);
    // 21 games: the 20 the app arrived with, plus the match just played.
    expect(resultFor('owner-A').rankedApps).toEqual([
      { appId: 'A', rank: 2, ratingGames: 21 },
    ]);
    expect(resultFor('owner-B').rankedApps).toEqual([
      { appId: 'B', rank: 7, ratingGames: 21 },
    ]);
  });

  it('does not scan the board for an unrated match — no rating moved', async () => {
    twoApps();
    runMatch.mockResolvedValue(richSummary(null, { decided: false }));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(getRanks).not.toHaveBeenCalled();
  });

  it('does not scan the board when neither app has finished placement', async () => {
    getApp.mockImplementation((id) =>
      Promise.resolve(makeApp(id as string, 1500, 5) as never)
    );
    runMatch.mockResolvedValue(richSummary('A'));

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(getRanks).not.toHaveBeenCalled();
  });

  it('gives a same-owner matchup both apps as rank candidates', async () => {
    twoApps();
    getRanks.mockResolvedValue(
      new Map([
        ['A', 4],
        ['B', 1],
      ])
    );
    runMatch.mockResolvedValue(
      richSummary('A', { ownerA: 'solo', ownerB: 'solo' })
    );

    await ladderService.runOneMatch('A', 'B', { seed: 7 });

    expect(resultFor('solo').rankedApps).toEqual([
      { appId: 'A', rank: 4, ratingGames: 21 },
      { appId: 'B', rank: 1, ratingGames: 21 },
    ]);
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
