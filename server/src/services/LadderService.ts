import { randomUUID } from 'node:crypto';
import Arena from '../types/arena';
import Environment, { Process } from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { AppId } from '../types/app';
import appService, { LadderCandidate } from './AppService';
import rankedMatchService from './RankedMatchService';
import ladderClaimService, { LadderClaim } from './LadderClaimService';
import environmentService from './EnvironmentService';
import { runMatchToDecision, DEFAULT_MATCH_TIMEOUT_MS } from '../util/runMatch';
import { updateRatings, Outcome } from '../util/elo';
import { isUntouchedStarter } from '../util/starterBots';
import { logger, LogEvent } from '../util/logger';
import {
  recordLadderResult,
  LadderResult,
  RankedApp,
} from '../util/awardAchievements';
import { MIN_RANKED_GAMES_FOR_RANK } from '../util/achievements';
import { UserId } from '../types/user';
import { BotStats } from '../types/botStats';

// A synthetic owner id for the throwaway arena a ladder match runs in. The arena
// is never persisted; buildMatchSummary reads the real app owners for the
// winner, not this, so any stable value works.
const LADDER_ARENA_OWNER = 'ladder';

// Resolved background-loop configuration. Defaults are deliberately conservative
// — a single worker with a gap between matches — because a ranked match is real
// isolate compute and the prod box is small (see GitHub #151 compute notes).
export interface LadderLoopConfig {
  concurrency: number; // matches run at once
  matchIntervalMs: number; // pause after a completed match, per worker
  idleMs: number; // backoff when there's no pair or we're load-gated
  maxLiveIsolates: number; // yield the CPU when user arenas hold this many isolates
  timeoutMs: number; // per-match wall-clock cap
  matchSpeed: number; // tick-rate cap for a ranked match (0 = unbounded)
  retentionDays: number; // age at which ranked_match rows are pruned (0 = keep)
  pairMatchCap: number; // matches a pair may play since either changed (0 = off)
}

// Retention sweep pacing. One sweep per hour is plenty for a table that gains
// ~1 row per completed match, and the per-sweep ceiling (BATCHES x BATCH_SIZE =
// 100k rows) means an accumulated backlog drains over a few hours instead of in
// one long transaction. Both are constants rather than env knobs: the thing
// worth tuning per environment is the retention window, not the shape of the
// sweep that enforces it.
const RETENTION_SWEEP_MS = 60 * 60 * 1000;
const RETENTION_BATCH_SIZE = 5000;
const RETENTION_MAX_BATCHES = 20;

// How long a cross-instance app claim (LadderClaimService) stays valid. A live
// match releases its claim when it ends, so this only matters for a claim left
// by an instance that died mid-match: it must outlast the longest possible
// match (the wall-clock timeout, plus teardown) so a slow match is never
// "expired" out from under itself, yet still free the apps reasonably soon.
// Twice the match timeout plus a minute: ~5 min at prod's 120 s timeout.
const claimTtlMs = (timeoutMs: number): number => 2 * timeoutMs + 60_000;

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

// The admin panel's read-only view of the ladder (see adminSnapshot). No
// source: pool members carry only what the matchmaker ranks them by.
export interface LadderAdminSnapshot {
  enabled: boolean; // LADDER_ENABLED on this instance
  loopRunning: boolean; // the background loop is running on this instance
  config: LadderLoopConfig; // effective config (started loop's, else env defaults)
  pool: {
    appId: AppId;
    userId: string;
    rating: number;
    ratingGames: number;
    updatedTimestamp: Date;
  }[];
  // Every unordered pairing in the pool, with its count against the cap.
  pairs: { appA: AppId; appB: AppId; matches: number; saturated: boolean }[];
  claimedAppIds: AppId[]; // apps under a live cross-instance claim right now
}

export interface LadderMatchResult {
  ran: boolean;
  // Set when ran === false: 'missing-app' (an id no longer resolves), 'busy'
  // (one of the apps is already in a ladder match, on this instance or any
  // other), or 'saturated' (the pair reached the cap while this match was
  // being set up — another instance finished one of its games first).
  reason?: 'missing-app' | 'busy' | 'saturated';
  decided: boolean;
  timedOut: boolean;
  winnerId: AppId | null;
  seed: number;
  a?: LadderSide;
  b?: LadderSide;
}

class LadderService {
  // App ids currently in a ladder match on THIS instance. The fast, local half
  // of "never put one app in two matches at once" (Node is single-threaded, so
  // add/has/delete here are atomic between awaits); LadderClaimService is the
  // cross-instance half, so the ladder is safe with several workers per
  // instance (LADDER_CONCURRENCY) and several instances (GitHub #409).
  private inFlight = new Set<AppId>();

  // Background-loop state. `running` gates the worker loops; flipping it false
  // (stop) lets each worker fall out after its current match.
  private running = false;
  private config: LadderLoopConfig | null = null;
  // Epoch ms of the last retention sweep; 0 = never (sweep on next iteration).
  private lastPruneAt = 0;

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
      // Cap the tick rate of a ranked match instead of running it unbounded, so
      // background matches don't pin a core on the small prod box (GitHub #151
      // compute notes). Default 20 → ~5 ms/tick, so a full sudden-death match
      // (SUDDEN_DEATH_TIME=7500 ticks) takes ~37.5 s — comfortably under the 60 s
      // default timeout. Lowering this throttles harder but lengthens matches:
      // keep LADDER_MATCH_TIMEOUT_MS above 7500/(10·speed) s or slow matches will
      // time out unrated. 0 opts back into unbounded (the prior behaviour).
      matchSpeed: opts.matchSpeed ?? envInt('LADDER_MATCH_SPEED', 20),
      // Backstop age for the hourly sweep. Per-pair pruning (runOneMatch) is now
      // the primary retention rule, but it only ever touches pairs that are
      // STILL PLAYING — a pairing whose app was deleted or aged out of
      // eligibility is never written again, so its rows would sit forever. This
      // sweep is the garbage collector for those, which is why the window is
      // long (90 days) rather than tight: it is not what bounds the table, it
      // just stops dead pairings accumulating. 0 disables it.
      retentionDays:
        opts.retentionDays ?? envInt('LADDER_MATCH_RETENTION_DAYS', 90),
      // How many times a given pair may meet before either side's code changes
      // again (see pickPair). The pool is small — 12 apps in prod on 2026-10-10,
      // so 66 distinct pairs — and the loop was replaying them ~85x/day each
      // forever, long past the ~20-40 games a rating needs to settle. 10 is
      // chosen for SAMPLING rather than convergence: spawn placement is random
      // per seed and outcome-deciding, so ~10 seeds is a reasonable read on a
      // pairing. 0 disables the cap (the prior play-forever behaviour).
      pairMatchCap: opts.pairMatchCap ?? envInt('LADDER_PAIR_MATCH_CAP', 10),
    };
    this.running = true;
    // Sweep on the first loop iteration after a start, so a deploy that lowers
    // the retention window acts on the existing backlog promptly.
    this.lastPruneAt = 0;
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
      // Ahead of the load gate on purpose: the sweep is a handful of small
      // DELETEs, and letting sustained live-arena load starve it would let the
      // history grow unbounded exactly when the box can least afford it.
      await this.maybePruneHistory(cfg);

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
        const res = await this.runNextMatch({
          timeoutMs: cfg.timeoutMs,
          speed: cfg.matchSpeed,
        });
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

  // Garbage-collect recorded matches older than the backstop window, at most
  // once per RETENTION_SWEEP_MS. This is NOT what bounds the table — per-pair
  // pruning in runOneMatch does that, and under the saturation cap a live
  // pairing holds at most `pairMatchCap` rows. This only catches pairings that
  // stopped playing entirely (an app deleted, or aged out of eligibility), whose
  // rows write-time pruning can never reach again. The ladder is the only writer
  // of ranked_match, so running it from the loop keeps the two in step: no
  // history accumulates while the loop is stopped, and nothing needs scheduling.
  //
  // The slot is claimed before the first await so concurrent workers
  // (LADDER_CONCURRENCY > 1) can't both sweep the same hour. Failures are logged
  // and swallowed — a prune that can't run is a growing table, not a broken
  // ladder, and must never take matchmaking down with it.
  private maybePruneHistory = async (cfg: LadderLoopConfig): Promise<void> => {
    if (cfg.retentionDays <= 0) return;
    const now = Date.now();
    if (now - this.lastPruneAt < RETENTION_SWEEP_MS) return;
    this.lastPruneAt = now;

    const cutoff = new Date(now - cfg.retentionDays * 24 * 60 * 60 * 1000);
    try {
      let removed = 0;
      for (let i = 0; i < RETENTION_MAX_BATCHES; i++) {
        const n = await rankedMatchService.deleteOlderThan(
          cutoff,
          RETENTION_BATCH_SIZE
        );
        removed += n;
        // A short batch means the backlog is drained; anything still older than
        // the cutoff waits for the next sweep.
        if (n < RETENTION_BATCH_SIZE) break;
      }
      if (removed > 0) {
        logger.info(
          {
            event: LogEvent.LADDER_MATCH,
            removed,
            retentionDays: cfg.retentionDays,
          },
          'garbage-collected dead-pairing match history'
        );
      }
    } catch (err) {
      logger.error(
        { event: LogEvent.LADDER_MATCH, err },
        'ranked match history prune failed'
      );
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
  //      nearest), since similar-strength matchups carry the most Elo signal.
  //      Same-owner matchups are allowed (see below) so a dominant player's bots
  //      still test each other.
  // In-flight apps and untouched starters are excluded.
  // `opts.pairMatchCap` overrides the resolved cap (used by tests to exercise
  // saturation without standing up a loop).
  pickPair = async (
    opts: { pairMatchCap?: number } = {}
  ): Promise<[AppId, AppId] | null> => {
    // Skip apps already in a match here (inFlight) or on another instance
    // (claimed). The claim in runOneMatch is still the real guard; this just
    // avoids picking a pair it would then refuse.
    const claimed = await ladderClaimService.claimedApps(
      new Date(Date.now() - claimTtlMs(this.matchTimeoutMs()))
    );
    const pool = (await appService.getLadderCandidates()).filter(
      (c) =>
        !this.inFlight.has(c.appId) &&
        !claimed.has(c.appId) &&
        !isUntouchedStarter(c.source)
    );
    if (pool.length < 2) return null;

    // Resolved here, once, so every anchor attempt in the loop below agrees.
    // Falls back to the env default rather than to "off" when the loop hasn't
    // been started: pickPair is reachable without start(), and a cap that
    // quietly stops applying depending on how it was entered is the kind of
    // thing that looks like it works. 0 means off because the operator said so,
    // not because config wasn't built yet.
    const cap = opts.pairMatchCap ?? this.pairMatchCap();

    // 1. Anchor: random pick among the fewest-played quartile (at least 1).
    const byGames = [...pool].sort((a, b) => a.ratingGames - b.ratingGames);
    const anchorBand = byGames.slice(
      0,
      Math.max(1, Math.ceil(pool.length / 4))
    );
    // Try the fewest-played band first, then everyone else. A single anchor can
    // be saturated against the whole pool while other pairings are still open,
    // so one exhausted anchor must not read as "nothing to play" — only an
    // exhausted POOL does. Ordered, not random, past the first band: by then we
    // are scraping for any legal pairing, not choosing a preferred one.
    const anchorOrder = [
      anchorBand[Math.floor(Math.random() * anchorBand.length)],
      ...anchorBand,
      ...byGames,
    ];
    const tried = new Set<AppId>();

    for (const anchor of anchorOrder) {
      if (tried.has(anchor.appId)) continue;
      tried.add(anchor.appId);

      // 2. Opponent: nearest rating to the anchor (random among the few nearest
      //    so pairings vary between rounds). Same-owner matchups are allowed on
      //    purpose: random matchmaking already prevents targeted farming (you
      //    can't choose your opponent) and a same-owner match is zero-sum, while
      //    excluding them shields a dominant player's own bots from ever meeting —
      //    which pins their ratings together and keeps them artificially undefeated.
      const others = await this.unsaturatedOpponents(anchor, pool, cap);
      if (others.length === 0) continue;

      const ratingDist = (c: LadderCandidate) =>
        Math.abs(c.rating - anchor.rating);
      const nearest = [...others].sort((a, b) => ratingDist(a) - ratingDist(b));
      const nearBand = nearest.slice(0, Math.min(5, nearest.length));
      const opponent = nearBand[Math.floor(Math.random() * nearBand.length)];

      return [anchor.appId, opponent.appId];
    }

    // Every pairing has played its quota since both sides last changed. Nothing
    // to learn until someone edits a bot; the caller backs off on idleMs.
    return null;
  };

  // The pool members `anchor` may still legally meet: those it has played fewer
  // than `pairMatchCap` times since the LATER of the two apps' last edits. One
  // query for the anchor's whole recent history, folded per opponent — cheaper
  // than a count per candidate pair, and the per-opponent cutoff differs (it
  // depends on that opponent's own edit time), which is exactly what SQL
  // aggregation can't express in one portable statement.
  private unsaturatedOpponents = async (
    anchor: LadderCandidate,
    pool: LadderCandidate[],
    cap: number
  ): Promise<LadderCandidate[]> => {
    const others = pool.filter((c) => c.appId !== anchor.appId);
    if (cap <= 0) return others;
    const counts = await this.pairCounts(anchor, others);
    return others.filter((c) => (counts.get(c.appId) ?? 0) < cap);
  };

  // How many times `anchor` has met each of `others` since the LATER of the two
  // apps' last edits — the count the pair cap is measured against. Shared by
  // pickPair (via unsaturatedOpponents) and the admin ladder view, so the panel
  // reports saturation by exactly the rule the matchmaker enforces.
  private pairCounts = async (
    anchor: LadderCandidate,
    others: LadderCandidate[]
  ): Promise<Map<AppId, number>> => {
    // Anchor's own edit time is the floor for every pairing, so filter by it in
    // SQL and apply each opponent's (later or earlier) edit time in JS.
    const history = await rankedMatchService.matchesForApp(
      anchor.appId,
      anchor.updatedTimestamp
    );

    const played = new Map<AppId, Date[]>();
    for (const h of history) {
      const list = played.get(h.opponentId);
      if (list) list.push(h.at);
      else played.set(h.opponentId, [h.at]);
    }

    const counts = new Map<AppId, number>();
    for (const c of others) {
      const times = played.get(c.appId);
      if (!times) continue;
      const since = Math.max(
        anchor.updatedTimestamp.getTime(),
        c.updatedTimestamp.getTime()
      );
      counts.set(
        c.appId,
        times.reduce((n, t) => (t.getTime() > since ? n + 1 : n), 0)
      );
    }
    return counts;
  };

  // Read-only view of the ladder for the admin panel (GitHub #469): the
  // effective configuration, the eligible pool, every pairing's count against
  // the cap, and the live cross-instance claims. Built from the same pieces the
  // matchmaker uses — getLadderCandidates, the untouched-starter filter,
  // pairCounts, the claim lease — so it can't drift from what pickPair would
  // actually do. Unlike pickPair it does NOT drop in-flight or claimed apps
  // from the pool: those are still eligible, just busy right now, and the panel
  // lists the claims separately.
  //
  // Costs one matchesForApp query per pool member (the same as one fully
  // saturated pickPair poll), which is fine for an on-demand admin page.
  adminSnapshot = async (): Promise<LadderAdminSnapshot> => {
    const timeoutMs = this.matchTimeoutMs();
    const cap = this.pairMatchCap();
    const pool = (await appService.getLadderCandidates()).filter(
      (c) => !isUntouchedStarter(c.source)
    );

    const pairs: LadderAdminSnapshot['pairs'] = [];
    for (let i = 0; i < pool.length; i++) {
      const later = pool.slice(i + 1);
      if (later.length === 0) break;
      const counts = await this.pairCounts(pool[i], later);
      for (const other of later) {
        const matches = counts.get(other.appId) ?? 0;
        pairs.push({
          appA: pool[i].appId,
          appB: other.appId,
          matches,
          saturated: cap > 0 && matches >= cap,
        });
      }
    }

    const claimed = await ladderClaimService.claimedApps(
      new Date(Date.now() - claimTtlMs(timeoutMs))
    );

    return {
      enabled: process.env.LADDER_ENABLED === 'true',
      loopRunning: this.running,
      config: this.config ?? {
        concurrency: Math.max(1, envInt('LADDER_CONCURRENCY', 1)),
        matchIntervalMs: envInt('LADDER_MATCH_INTERVAL_MS', 3000),
        idleMs: envInt('LADDER_IDLE_MS', 60000),
        maxLiveIsolates: envInt('LADDER_MAX_LIVE_ISOLATES', 40),
        timeoutMs,
        matchSpeed: envInt('LADDER_MATCH_SPEED', 20),
        retentionDays: envInt('LADDER_MATCH_RETENTION_DAYS', 90),
        pairMatchCap: cap,
      },
      pool: pool.map((c) => ({
        appId: c.appId,
        userId: c.userId,
        rating: c.rating,
        ratingGames: c.ratingGames,
        updatedTimestamp: c.updatedTimestamp,
      })),
      pairs,
      claimedAppIds: [...claimed],
    };
  };

  // Resolved pair cap and match timeout: the started loop's config, else the env
  // default. Falls back to the env default rather than to "off" when the loop
  // hasn't been started: pickPair/runOneMatch are reachable without start(), and
  // a cap that quietly stops applying depending on how it was entered is the
  // kind of thing that looks like it works. 0 means off because the operator
  // said so, not because config wasn't built yet.
  private pairMatchCap = (): number =>
    this.config?.pairMatchCap ?? envInt('LADDER_PAIR_MATCH_CAP', 10);

  private matchTimeoutMs = (): number =>
    this.config?.timeoutMs ??
    envInt('LADDER_MATCH_TIMEOUT_MS', DEFAULT_MATCH_TIMEOUT_MS);

  // Has this pair already played `cap` times since the later of the two apps'
  // last edits? The same rule unsaturatedOpponents applies when picking, asked
  // again for one pair once it's claimed: between pickPair's read and the claim,
  // another instance can finish a game of this very pair (GitHub #409).
  private pairSaturated = async (
    appIdA: AppId,
    appIdB: AppId,
    cap: number
  ): Promise<boolean> => {
    if (cap <= 0) return false;
    const since =
      (await appService.pairEditCutoff(appIdA, appIdB)) ?? new Date(0);
    const history = await rankedMatchService.matchesForApp(appIdA, since);
    return history.filter((h) => h.opponentId === appIdB).length >= cap;
  };

  // Pick a pair and run their match. Returns null if no pair was available.
  runNextMatch = async (
    opts: {
      seed?: number;
      timeoutMs?: number;
      speed?: number;
    } = {}
  ): Promise<LadderMatchResult | null> => {
    const pair = await this.pickPair();
    if (!pair) return null;
    return this.runOneMatch(pair[0], pair[1], {
      ...opts,
      pairMatchCap: this.pairMatchCap(),
    });
  };

  // Run a single headless 1v1 ranked match between two apps to a decision (or a
  // timeout), apply the Elo update, flag a fully-crashed app as broken, and
  // record the match. Constructs an ephemeral, non-persisted Environment so it
  // never touches user arenas or the EnvironmentService registry — the caller
  // Fold a finished match's summary into one achievement award per USER (GitHub
  // #121). Grouped by userId rather than by app for two reasons: badges are
  // user-level, and pickPair allows same-owner matchups — without grouping, such a
  // match would bump one user twice and could hand them both a win and a loss.
  //
  // Every input is already in `summary`, so this costs no extra queries. Failures
  // are swallowed: a badge is never worth failing a ranked match over.
  // `opts` carries the pre-match ratings rather than reading them from instance
  // state: workers run concurrently (LADDER_CONCURRENCY), so per-match data must
  // stay on the call stack.
  private awardAchievements = async (
    summary: Awaited<ReturnType<typeof runMatchToDecision>>,
    opts: {
      rated: boolean;
      winnerId: AppId | null;
      appIdA: AppId;
      appIdB: AppId;
      before: { a: number; b: number };
      games: { a: number; b: number };
    }
  ): Promise<void> => {
    try {
      const winnerUserId = summary.match.winner?.userId;
      const byUser = new Map<UserId, LadderResult>();

      const gamesOf = (appId: AppId): number =>
        appId === opts.appIdA ? opts.games.a : opts.games.b;

      // Board ranks for the rank badges (GitHub #121). Unlike every other ladder
      // fact, a rank isn't in the summary — it's a property of the whole board — so
      // this is the one extra query, and it's skipped unless it could matter:
      // an unrated match moved no rating (so no rank changed), and an app short of
      // the placement gate can't earn on its rank however high it sits.
      const ranks =
        opts.rated &&
        [opts.appIdA, opts.appIdB].some(
          (id) => gamesOf(id) >= MIN_RANKED_GAMES_FOR_RANK
        )
          ? await appService.getRanks([opts.appIdA, opts.appIdB])
          : new Map<AppId, number>();

      const rankedAppOf = (appId: AppId): RankedApp => ({
        appId,
        rank: ranks.get(appId),
        ratingGames: gamesOf(appId),
      });

      for (const entry of summary.leaderboard) {
        const userId = entry.userId;
        if (!userId) continue;

        const existing = byUser.get(userId);
        if (existing) {
          // Same owner on both sides: sum the two sides into the single result.
          for (const [key, value] of Object.entries(entry.stats)) {
            if (typeof value !== 'number') continue;
            const k = key as keyof BotStats;
            existing.stats[k] = (existing.stats[k] ?? 0) + value;
          }
          existing.facts.timesHit += entry.stats.timesHit;
          existing.facts.botsAlive += entry.botsAlive;
          existing.facts.botsTotal += entry.botsTotal;
          existing.facts.shotsFired += entry.stats.shotsFired;
          existing.facts.shotsHit += entry.stats.shotsHit;
          // suddenDeath is match-level: both sides already agree on it.
          // Both apps are candidates for the rank badge; awardAchievements takes
          // the better of them.
          existing.rankedApps?.push(rankedAppOf(entry.id));
          continue;
        }

        // The opponent's pre-match rating, for the upset check. Two apps per ladder
        // match, so "the other one" is unambiguous.
        const isA = entry.id === opts.appIdA;
        byUser.set(userId, {
          userId,
          stats: { ...entry.stats },
          facts: {
            won: !!winnerUserId && winnerUserId === userId,
            myRatingBefore: isA ? opts.before.a : opts.before.b,
            opponentRatingBefore: isA ? opts.before.b : opts.before.a,
            timesHit: entry.stats.timesHit,
            botsAlive: entry.botsAlive,
            botsTotal: entry.botsTotal,
            shotsFired: entry.stats.shotsFired,
            shotsHit: entry.stats.shotsHit,
            suddenDeath: summary.match.suddenDeath,
          },
          winningAppId: opts.winnerId,
          rankedApps: [rankedAppOf(entry.id)],
          rated: opts.rated,
        });
      }

      await Promise.all([...byUser.values()].map(recordLadderResult));
    } catch (err) {
      logger.warn({ err }, 'ladder achievement award failed');
    }
  };

  // owns teardown, which always happens in the finally.
  runOneMatch = async (
    appIdA: AppId,
    appIdB: AppId,
    opts: {
      seed?: number;
      timeoutMs?: number;
      speed?: number;
      // Re-check the pair cap after claiming (set by runNextMatch). Omitted for
      // a directly-requested match, which is the caller's call to make.
      pairMatchCap?: number;
    } = {}
  ): Promise<LadderMatchResult> => {
    const seed = opts.seed ?? Math.floor(Math.random() * 0x100000000);
    const notRun = (
      reason: NonNullable<LadderMatchResult['reason']>
    ): LadderMatchResult => ({
      ran: false,
      reason,
      decided: false,
      timedOut: false,
      winnerId: null,
      seed,
    });

    if (this.inFlight.has(appIdA) || this.inFlight.has(appIdB)) {
      return notRun('busy');
    }

    const [appA, appB] = await Promise.all([
      appService.get(appIdA),
      appService.get(appIdB),
    ]);
    if (!appA || !appB) {
      return notRun('missing-app');
    }

    // Re-check the local guard: the app loads above awaited, and another worker
    // on this instance may have taken one of these apps meanwhile.
    if (this.inFlight.has(appIdA) || this.inFlight.has(appIdB)) {
      return notRun('busy');
    }
    // Reserve locally before the claim's awaits, so a sibling worker can't race
    // us into the claim for the same app.
    this.inFlight.add(appIdA);
    this.inFlight.add(appIdB);

    // Cross-instance claim (GitHub #409): the shared version of inFlight.
    let claim: LadderClaim | null = null;
    try {
      const now = new Date();
      const timeoutMs = opts.timeoutMs ?? this.matchTimeoutMs();
      claim = await ladderClaimService.claim(
        appIdA,
        appIdB,
        now,
        new Date(now.getTime() - claimTtlMs(timeoutMs))
      );
      if (!claim) return notRun('busy');
      if (
        opts.pairMatchCap !== undefined &&
        (await this.pairSaturated(appIdA, appIdB, opts.pairMatchCap))
      ) {
        await ladderClaimService.release(claim);
        claim = null;
        return notRun('saturated');
      }
    } catch (err) {
      // Release anything we did get, then let the worker log the error.
      if (claim) await ladderClaimService.release(claim).catch(() => undefined);
      throw err;
    } finally {
      // Not proceeding to a match: drop the local reservation too.
      if (!claim) {
        this.inFlight.delete(appIdA);
        this.inFlight.delete(appIdB);
      }
    }

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
        speed: opts.speed,
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
        // Applied as increments, not absolute ratings, so a concurrent result
        // for either app (another worker or instance) composes with this one
        // instead of being overwritten (GitHub #409).
        await Promise.all([
          appA.applyRatingResult(res.a.delta, winnerId === appIdA),
          appB.applyRatingResult(res.b.delta, winnerId === appIdB),
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

      // Retire this pairing's PREVIOUS generation. What stays in ranked_match for
      // a pair is then exactly its head-to-head record between the two apps'
      // current versions — which is also what the saturation cap counts, so the
      // retention rule and the control rule read the same rows rather than one
      // shadowing the other. Pruning at write time keeps it with the only writer:
      // a pair is tidied on its first match after either side changes, and the
      // row just inserted is newer than the cutoff so it always survives.
      //
      // Best-effort: a failed prune leaves stale rows for the next match (or the
      // GC sweep) to clear and must never fail a completed, already-rated match.
      try {
        const cutoff = await appService.pairEditCutoff(appIdA, appIdB);
        if (cutoff) {
          const dropped = await rankedMatchService.deleteStaleForPair(
            appIdA,
            appIdB,
            cutoff
          );
          if (dropped > 0) {
            logger.info(
              { event: LogEvent.LADDER_MATCH, appIdA, appIdB, dropped },
              'retired pre-edit head-to-head history'
            );
          }
        }
      } catch (err) {
        logger.error(
          { event: LogEvent.LADDER_MATCH, err },
          'pair history prune failed'
        );
      }

      // Achievements (GitHub #121). Ladder badges are only worth something because
      // they can ONLY be earned here, so this is their sole award point — and the
      // ephemeral env above never gets a stats sink (EnvironmentService installs
      // those, and this Environment was built directly), so its dispose() in the
      // finally can't double-count what we record now.
      //
      // Awaited inside the try so a failure is caught and logged rather than
      // rejecting runOneMatch — a badge must never fail or slow a ranked match.
      await this.awardAchievements(summary, {
        rated: rate,
        winnerId: rate ? winnerId : null,
        appIdA,
        appIdB,
        before,
        // Post-match counts: applyRatingResult already synced these, so a rank
        // badge is gated on games INCLUDING the match that just earned it.
        games: { a: appA.getRatingGames(), b: appB.getRatingGames() },
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
      // Always release the isolates, the in-flight locks and the cross-instance
      // claim, even if the match threw partway through. A claim release that
      // fails is logged, not thrown: the lease expires on its own (claimTtlMs).
      env.dispose();
      this.inFlight.delete(appIdA);
      this.inFlight.delete(appIdB);
      if (claim) {
        await ladderClaimService
          .release(claim)
          .catch((err) =>
            logger.error(
              { event: LogEvent.LADDER_MATCH, err, appIdA, appIdB },
              'ladder claim release failed; it will expire'
            )
          );
      }
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
