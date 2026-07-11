import { randomUUID } from 'node:crypto';
import Arena from '../types/arena';
import Environment, { Process } from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { AppId } from '../types/app';
import appService, { LadderCandidate } from './AppService';
import rankedMatchService from './RankedMatchService';
import environmentService from './EnvironmentService';
import { runMatchToDecision, DEFAULT_MATCH_TIMEOUT_MS } from '../util/runMatch';
import { updateRatings, Outcome } from '../util/elo';
import { isUntouchedStarter } from '../util/starterBots';
import { logger, LogEvent } from '../util/logger';

// A synthetic owner id for the throwaway arena a ladder match runs in. The arena
// is never persisted; buildMatchSummary reads the real app owners for the
// winner, not this, so any stable value works.
const LADDER_ARENA_OWNER = 'ladder';

// Resolved background-loop configuration. Defaults are deliberately conservative
// — a single worker with a gap between matches — because a ranked match is real
// isolate compute and the prod box is small (see GitHub #151 compute notes).
interface LadderLoopConfig {
  concurrency: number; // matches run at once
  matchIntervalMs: number; // pause after a completed match, per worker
  idleMs: number; // backoff when there's no pair or we're load-gated
  maxLiveIsolates: number; // yield the CPU when user arenas hold this many isolates
  timeoutMs: number; // per-match wall-clock cap
}

const envInt = (name: string, dflt: number): number => {
  const n = parseInt(process.env[name] ?? '');
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

// Per-app outcome of a ranked match.
interface LadderSide {
  appId: AppId;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  broken: boolean;
}

export interface LadderMatchResult {
  ran: boolean;
  // Set when ran === false: 'missing-app' (an id no longer resolves) or 'busy'
  // (one of the apps is already in a ladder match).
  reason?: 'missing-app' | 'busy';
  decided: boolean;
  timedOut: boolean;
  winnerId: AppId | null;
  seed: number;
  a?: LadderSide;
  b?: LadderSide;
}

class LadderService {
  // App ids currently in a ladder match. Guards against running two matches for
  // the same app at once, which would make the read-modify-write Elo update race
  // (Node is single-threaded, so add/has/delete here are atomic between awaits).
  private inFlight = new Set<AppId>();

  // Background-loop state. `running` gates the worker loops; flipping it false
  // (stop) lets each worker fall out after its current match.
  private running = false;
  private config: LadderLoopConfig | null = null;

  isBusy = (appId: AppId): boolean => this.inFlight.has(appId);

  isLoopRunning = (): boolean => this.running;

  // Start the background matchmaking loop: `concurrency` workers that each pick a
  // pair, run the match, then pause. Options override the LADDER_* env defaults
  // (used by tests to run a fast, deterministic loop). Enablement itself is the
  // caller's decision (index.ts starts it only when LADDER_ENABLED=true and not
  // under test) so this can be driven directly in unit tests. Idempotent.
  start = (opts: Partial<LadderLoopConfig> = {}): void => {
    if (this.running) return;
    this.config = {
      concurrency: Math.max(
        1,
        opts.concurrency ?? envInt('LADDER_CONCURRENCY', 1)
      ),
      matchIntervalMs:
        opts.matchIntervalMs ?? envInt('LADDER_MATCH_INTERVAL_MS', 3000),
      idleMs: opts.idleMs ?? envInt('LADDER_IDLE_MS', 60000),
      maxLiveIsolates:
        opts.maxLiveIsolates ?? envInt('LADDER_MAX_LIVE_ISOLATES', 40),
      timeoutMs:
        opts.timeoutMs ??
        envInt('LADDER_MATCH_TIMEOUT_MS', DEFAULT_MATCH_TIMEOUT_MS),
    };
    this.running = true;
    logger.info(
      { event: LogEvent.LADDER_MATCH, config: this.config },
      'global ladder loop started'
    );
    for (let i = 0; i < this.config.concurrency; i++) void this.worker();
  };

  // Signal the loop to stop; workers exit after their in-flight match. An
  // ephemeral match already running is left to finish (or is abandoned at
  // process exit — nothing persistent leaks).
  stop = (): void => {
    if (!this.running) return;
    this.running = false;
    logger.info({ event: LogEvent.LADDER_MATCH }, 'global ladder loop stopped');
  };

  private worker = async (): Promise<void> => {
    const cfg = this.config!;
    while (this.running) {
      // Load gate: when user arenas are holding a lot of isolates, back off so
      // ranked matches never starve real players on the small prod box. (The
      // ladder's own ephemeral envs aren't in the store, so this measures user
      // load only.)
      if (environmentService.metrics().isolates > cfg.maxLiveIsolates) {
        await this.delay(cfg.idleMs);
        continue;
      }

      let idle = true;
      try {
        const res = await this.runNextMatch({ timeoutMs: cfg.timeoutMs });
        idle = res === null; // no eligible pair right now
      } catch (err) {
        logger.error(
          { event: LogEvent.LADDER_MATCH, err },
          'ladder match errored'
        );
      }
      await this.delay(idle ? cfg.idleMs : cfg.matchIntervalMs);
    }
  };

  // A cancellable-ish sleep. The timer is unref'd so a pending backoff never
  // keeps the process alive during shutdown.
  private delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      if (typeof t.unref === 'function') t.unref();
    });

  // Choose two apps for the next ranked match, or null if fewer than two are
  // eligible. Selection is biased two ways so the ladder converges usefully
  // rather than pairing at pure random:
  //   1. Anchor — drawn from the least-played apps (random among the fewest-games
  //      quartile) so new/under-played bots get games and their ratings settle.
  //   2. Opponent — the closest in rating to the anchor (random among the few
  //      nearest), since similar-strength matchups carry the most Elo signal;
  //      a different owner is preferred so a user's own bots don't just farm
  //      each other (which is zero-sum anyway, but wasteful).
  // In-flight apps and untouched starters are excluded.
  pickPair = async (): Promise<[AppId, AppId] | null> => {
    const pool = (await appService.getLadderCandidates()).filter(
      (c) => !this.inFlight.has(c.appId) && !isUntouchedStarter(c.source)
    );
    if (pool.length < 2) return null;

    // 1. Anchor: random pick among the fewest-played quartile (at least 1).
    const byGames = [...pool].sort((a, b) => a.ratingGames - b.ratingGames);
    const anchorBand = byGames.slice(
      0,
      Math.max(1, Math.ceil(pool.length / 4))
    );
    const anchor = anchorBand[Math.floor(Math.random() * anchorBand.length)];

    // 2. Opponent: nearest rating to the anchor, preferring a different owner.
    const others = pool.filter((c) => c.appId !== anchor.appId);
    const ratingDist = (c: LadderCandidate) =>
      Math.abs(c.rating - anchor.rating);
    const nearest = [...others].sort((a, b) => ratingDist(a) - ratingDist(b));
    const differentOwner = nearest.filter((c) => c.userId !== anchor.userId);
    const preferred = differentOwner.length > 0 ? differentOwner : nearest;
    // Random among the few nearest so pairings vary between rounds.
    const nearBand = preferred.slice(0, Math.min(5, preferred.length));
    const opponent = nearBand[Math.floor(Math.random() * nearBand.length)];

    return [anchor.appId, opponent.appId];
  };

  // Pick a pair and run their match. Returns null if no pair was available.
  runNextMatch = async (
    opts: {
      seed?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<LadderMatchResult | null> => {
    const pair = await this.pickPair();
    if (!pair) return null;
    return this.runOneMatch(pair[0], pair[1], opts);
  };

  // Run a single headless 1v1 ranked match between two apps to a decision (or a
  // timeout), apply the Elo update, flag a fully-crashed app as broken, and
  // record the match. Constructs an ephemeral, non-persisted Environment so it
  // never touches user arenas or the EnvironmentService registry — the caller
  // owns teardown, which always happens in the finally.
  runOneMatch = async (
    appIdA: AppId,
    appIdB: AppId,
    opts: { seed?: number; timeoutMs?: number } = {}
  ): Promise<LadderMatchResult> => {
    const seed = opts.seed ?? Math.floor(Math.random() * 0x100000000);

    if (this.inFlight.has(appIdA) || this.inFlight.has(appIdB)) {
      return {
        ran: false,
        reason: 'busy',
        decided: false,
        timedOut: false,
        winnerId: null,
        seed,
      };
    }

    const [appA, appB] = await Promise.all([
      appService.get(appIdA),
      appService.get(appIdB),
    ]);
    if (!appA || !appB) {
      return {
        ran: false,
        reason: 'missing-app',
        decided: false,
        timedOut: false,
        winnerId: null,
        seed,
      };
    }

    this.inFlight.add(appIdA);
    this.inFlight.add(appIdB);

    // Throwaway arena + environment: not written to the DB, not registered with
    // EnvironmentService (so it's outside the 30-min GC and MAX_TOTAL_ARENAS).
    const arena = new Arena(randomUUID(), LADDER_ARENA_OWNER);
    const env = new Environment(arena);
    env.processes.push(new Process(appIdA));
    env.processes.push(new Process(appIdB));
    // Members exist only for buildMatchSummary's join-time ordering; winner
    // detection does not depend on them.
    const members = [
      new ArenaMember(appIdA, arena.getId(), 0, true),
      new ArenaMember(appIdB, arena.getId(), 1, true),
    ];

    try {
      const summary = await runMatchToDecision(env, members, {
        seed,
        timeoutMs: opts.timeoutMs,
      });
      const decided = summary.match.decided;
      const winnerId = decided ? (summary.match.winner?.id ?? null) : null;

      // A fully-crashed app (every one of its bots crashed) couldn't really
      // compete — flag it broken so matchmaking benches it until it's edited.
      const crashed = (appId: AppId): boolean => {
        const entry = summary.leaderboard.find((e) => e.id === appId);
        return entry ? entry.crashedCount >= entry.botsTotal : true;
      };
      const aCrashed = crashed(appIdA);
      const bCrashed = crashed(appIdB);

      // Skip the rating update when the match didn't decide (timeout) or both
      // apps crashed out — neither is a real result. A one-sided crash still
      // counts: the crasher legitimately lost.
      const rate = decided && !(aCrashed && bCrashed);

      const before = {
        a: appA.getRating(),
        b: appB.getRating(),
      };
      let delta = { a: 0, b: 0 };
      if (rate) {
        const outcome: Outcome =
          winnerId === appIdA ? 'a' : winnerId === appIdB ? 'b' : 'draw';
        const res = updateRatings(
          { rating: appA.getRating(), games: appA.getRatingGames() },
          { rating: appB.getRating(), games: appB.getRatingGames() },
          outcome
        );
        delta = { a: res.a.delta, b: res.b.delta };
        await Promise.all([
          appA.setRating(
            res.a.rating,
            appA.getRatingGames() + 1,
            winnerId === appIdA
          ),
          appB.setRating(
            res.b.rating,
            appB.getRatingGames() + 1,
            winnerId === appIdB
          ),
        ]);
      }

      if (aCrashed && !appA.isBroken()) await appA.setBroken(true);
      if (bCrashed && !appB.isBroken()) await appB.setBroken(true);

      await rankedMatchService.record({
        appA: appIdA,
        appB: appIdB,
        winnerId: rate ? winnerId : null,
        ratingABefore: before.a,
        ratingBBefore: before.b,
        deltaA: delta.a,
        deltaB: delta.b,
        seed,
      });

      logger.info(
        {
          event: LogEvent.LADDER_MATCH,
          appA: appIdA,
          appB: appIdB,
          winnerId: rate ? winnerId : null,
          decided,
          rated: rate,
          seed,
        },
        'ladder match complete'
      );

      return {
        ran: true,
        decided,
        timedOut: !decided,
        winnerId: rate ? winnerId : null,
        seed,
        a: {
          appId: appIdA,
          ratingBefore: before.a,
          ratingAfter: appA.getRating(),
          delta: delta.a,
          broken: aCrashed,
        },
        b: {
          appId: appIdB,
          ratingBefore: before.b,
          ratingAfter: appB.getRating(),
          delta: delta.b,
          broken: bCrashed,
        },
      };
    } finally {
      // Let the tick loop fully exit before releasing the isolates. pause()
      // only flips `running` off; the loop still finishes its in-flight tick
      // (bot handlers on the isolate thread pool). Disposing before that lands
      // races the apply → a spurious "Isolate was disposed during execution"
      // bot.fault. Bounded so a wedged loop can't hang teardown; dispose is
      // safe regardless.
      await this.waitForLoopExit(env);
      // Always release the isolates and the in-flight locks, even if the match
      // threw partway through.
      env.dispose();
      this.inFlight.delete(appIdA);
      this.inFlight.delete(appIdB);
    }
  };

  // Poll until the environment's tick loop has stopped (or a safety cap), so a
  // caller can dispose its isolates without racing an in-flight bot handler.
  private waitForLoopExit = async (env: Environment): Promise<void> => {
    for (let i = 0; i < 250 && env.isLooping(); i++) {
      await this.delay(20);
    }
  };
}

export default new LadderService();
