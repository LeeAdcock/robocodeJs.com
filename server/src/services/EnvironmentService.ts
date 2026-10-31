import Arena from '../types/arena';
import Environment, { ArenaId, Process } from '../types/environment';
import arenaMemberService from './ArenaMemberService';
import homeService from './HomeService';
import { logger, LogEvent } from '../util/logger';
import { recordSandboxStats } from '../util/awardAchievements';
import { DEMO_USER_ID, UserId } from '../types/user';

// How long a running arena may go with no viewers and no access before it is
// paused (see pauseIdle). `0` disables idle pausing.
const DEFAULT_IDLE_PAUSE_MS = 5 * 60 * 1000;
export const parseIdlePauseMs = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === '') return DEFAULT_IDLE_PAUSE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_IDLE_PAUSE_MS;
};

export class EnvironmentService {
  // Keyed by arenaId. Accessed via bracket notation / Object.entries below, so
  // this is a plain record, not a Map.
  store: Record<ArenaId, Environment> = {};

  idlePauseMs = parseIdlePauseMs(process.env.ARENA_IDLE_PAUSE_MS);

  // Arenas the GC disposed while idle-paused. They were running when their
  // owner left, so the next get() rebuilds them running rather than leaving a
  // returning user on a paused arena. Just ids, so it costs nothing to keep.
  private wakeOnLoad: Set<ArenaId> = new Set();

  private reconciling = false;

  constructor() {
    setInterval(() => {
      this.pauseIdle();
      this.collectGarbage();
      void this.reconcileHomes();
    }, 10000);
  }

  // Keep this instance's home leases (GitHub #444) matching the users it holds
  // arenas for: renew them, and release users whose last arena the GC just
  // collected. A user whose home another instance took over is only counted and
  // logged (by HomeService) and keeps being served here: with nothing routed on
  // the leases yet, dropping their arenas would just rebuild them on the next
  // request. Skipped while a previous pass is still waiting on the database.
  reconcileHomes = async (now = Date.now()): Promise<void> => {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await homeService.reconcile(this.owners, now);
    } finally {
      this.reconciling = false;
    }
  };

  // Users with at least one arena held on this instance.
  owners = (): Set<UserId> =>
    new Set(Object.values(this.store).map((env) => env.getArena().getUserId()));

  // Dispose environments that have been stopped for thirty minutes. Only a
  // stopped arena qualifies: stoppedAt is stamped at construction and on each
  // stop but never cleared on resume, so without the running/looping guard an
  // arena played continuously for thirty minutes was disposed mid-match — its
  // isolates released under a live tick loop, every bot faulting, and the next
  // request rebuilding a fresh, paused arena in its place.
  collectGarbage = (now = Date.now()) => {
    const threshold = now - 30 * 60 * 1000; // thirty minutes ago
    (Object.entries(this.store) as [ArenaId, Environment][]).forEach(
      ([arenaId, env]) => {
        if (
          !env.isRunning() &&
          !env.isLooping() &&
          threshold > env.stoppedAt.getTime()
        ) {
          logger.debug({ arenaId }, 'disposing idle isolate (GC)');
          if (env.isIdlePaused()) this.wakeOnLoad.add(arenaId);
          delete this.store[arenaId];
          env.dispose();
        }
      }
    );
  };

  // Pause every running arena nobody is watching or using. Nothing else pauses
  // a running arena, so without this every arena anyone resumed would tick
  // until the next deploy and the box's capacity would be "arenas touched since
  // the last deploy" rather than "players online". A paused arena costs memory but no CPU, and
  // the GC above frees it 30 minutes later. Waking is transparent: every access
  // goes through get(), which resumes it before the caller sees it. Returns how
  // many arenas were paused.
  pauseIdle = (now = Date.now()): number => {
    if (this.idlePauseMs <= 0) return 0;
    let paused = 0;
    for (const [arenaId, env] of Object.entries(this.store) as [
      ArenaId,
      Environment,
    ][]) {
      if (
        env.isRunning() &&
        !env.hasViewers() &&
        env.getIdleMs(now) >= this.idlePauseMs &&
        env.idlePause()
      ) {
        paused++;
        logger.info(
          { event: LogEvent.ARENA_IDLE_PAUSE, arenaId },
          'paused idle arena'
        );
      }
    }
    return paused;
  };

  get = (arena: Arena): Promise<Environment> => {
    let env: Environment = this.store[arena.getId()];
    if (env) {
      // Every access counts as activity and wakes an idle-paused arena: status
      // polls, SSE connects, editor compiles and MCP tools all land here.
      env.touch();
      if (env.wake()) {
        logger.info(
          { event: LogEvent.ARENA_IDLE_WAKE, arenaId: arena.getId() },
          'woke idle arena'
        );
      }
      return Promise.resolve(env);
    }

    env = new Environment(arena);
    logger.debug({ arenaId: arena.getId() }, 'creating isolate');

    // Route this arena's cumulative bot stats to the owner's lifetime achievement
    // counters. This is the ONLY place a sink is installed, and it is the only
    // place a real arena's Environment is constructed — LadderService builds its
    // ephemeral one directly, so ranked matches flush nowhere and the ladder hook
    // stays their sole counter owner. That's what makes a double-count structurally
    // impossible instead of a rule to remember.
    //
    // The arena OWNER is credited for all combat in their arena, including bots
    // added by reference (api/arena.ts) that they didn't write. Sandbox counters are
    // explicitly grindable/cosmetic, so that's no worse than grinding your own bot —
    // and the alternative (credit each app's owner) would cost a lookup per flush
    // and let anyone farm counters inside someone else's arena.
    //
    // The shared demo account is excluded for the same reason it's excluded from
    // ladder candidates (AppService.getLadderCandidates): it isn't a real player.
    const ownerId = arena.getUserId();
    if (ownerId !== DEMO_USER_ID) {
      env.setStatsSink((deltas) => {
        // Fire-and-forget: the flush points are lifecycle paths (game over, restart,
        // dispose) and must not wait on, or fail because of, a database write.
        void recordSandboxStats(ownerId, deltas);
      });
    }

    this.store[arena.getId()] = env;
    // Take the owner's home lease now rather than at the next reconcile, so
    // the lease is in place as soon as their first arena is. Fire-and-forget:
    // claim never throws, and nothing routes on the result yet.
    void homeService.claim(ownerId);
    return arenaMemberService
      .getForArena(arena.getId())
      .then((members) =>
        Promise.all(
          // Disabled members keep their link but don't participate in the match,
          // so they're never given a Process (isolate). Re-enabling adds one live
          // via Environment.addApp (see api/arena.ts setEnabled).
          members
            .filter((member) => member.getEnabled())
            .map((member) => {
              env.processes.push(new Process(member.getAppId()));
            })
        ).then(() => env)
      )
      .then(() => env.restart())
      .then(() => {
        if (this.wakeOnLoad.delete(arena.getId())) {
          logger.info(
            { event: LogEvent.ARENA_IDLE_WAKE, arenaId: arena.getId() },
            'rebuilt idle arena running'
          );
          env.resume();
        }
        return env;
      });
  };

  // Tears down an arena's in-memory environment immediately (rather than
  // waiting for the 30-minute idle GC). Used when an arena is deleted.
  dispose = (arenaId: ArenaId): Promise<void> => {
    this.wakeOnLoad.delete(arenaId);
    const env = this.store[arenaId];
    if (env) {
      logger.debug({ arenaId }, 'disposing isolate');
      delete this.store[arenaId];
      env.dispose();
    }
    return Promise.resolve();
  };

  // Tears down every live environment (pausing its tick loop first, then
  // releasing its isolate) and clears the store. Used on graceful shutdown so a
  // deploy/restart releases native isolated-vm memory instead of leaking it.
  // Returns the number of environments disposed.
  disposeAll = (): number => {
    const entries = Object.entries(this.store) as [ArenaId, Environment][];
    entries.forEach(([arenaId, env]) => {
      env.pause();
      env.dispose();
      delete this.store[arenaId];
    });
    return entries.length;
  };

  // Cheap point-in-time gauges for the /health endpoint. A single O(arenas) pass
  // over the store reading already-maintained fields — no isolate calls, no async,
  // no allocation beyond the returned object — so it's safe to compute on every
  // (frequent) load-balancer health check.
  //   arenas        live environments held in memory (each owns isolates)
  //   runningArenas environments whose tick loop is active
  //   idlePausedArenas environments paused by pauseIdle (wake on next access)
  //   isolates      total Processes across all environments (one isolate each)
  //   maxAvgTickMs  the busiest arena's EMA tick duration (see Environment)
  metrics = (): {
    arenas: number;
    runningArenas: number;
    idlePausedArenas: number;
    isolates: number;
    maxAvgTickMs: number;
  } => {
    const envs = Object.values(this.store);
    let runningArenas = 0;
    let idlePausedArenas = 0;
    let isolates = 0;
    let maxAvgTickMs = 0;
    for (const env of envs) {
      if (env.isRunning()) runningArenas++;
      if (env.isIdlePaused()) idlePausedArenas++;
      isolates += env.getProcesses().length;
      const t = env.getAvgTickMs();
      if (t > maxAvgTickMs) maxAvgTickMs = t;
    }
    return {
      arenas: envs.length,
      runningArenas,
      idlePausedArenas,
      isolates,
      maxAvgTickMs: Math.round(maxAvgTickMs * 100) / 100,
    };
  };

  getByArenaId = (arenaId: ArenaId): Promise<Environment | undefined> => {
    return Promise.resolve(this.store[arenaId]);
  };

  has = (arenaId: ArenaId): boolean => undefined !== this.store[arenaId];
}

export default new EnvironmentService();
