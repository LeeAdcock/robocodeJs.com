import Arena from '../types/arena';
import Environment, { ArenaId, Process } from '../types/environment';
import arenaMemberService from './ArenaMemberService';
import { logger } from '../util/logger';
import { recordSandboxStats } from '../util/awardAchievements';
import { DEMO_USER_ID } from '../types/user';

export class EnvironmentService {
  // Keyed by arenaId. Accessed via bracket notation / Object.entries below, so
  // this is a plain record, not a Map.
  store: Record<ArenaId, Environment> = {};

  constructor() {
    // Garbage collection
    setInterval(() => {
      const threshold = new Date().getTime() - 30 * 60 * 1000; // thirty minutes ago
      (Object.entries(this.store) as [ArenaId, Environment][]).forEach(
        ([arenaId, env]) => {
          if (env.stoppedAt && threshold > env.stoppedAt.getTime()) {
            logger.debug({ arenaId }, 'disposing idle isolate (GC)');
            delete this.store[arenaId];
            env.dispose();
          }
        }
      );
    }, 10000);
  }

  get = (arena: Arena): Promise<Environment> => {
    let env: Environment = this.store[arena.getId()];
    if (env) {
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
      .then(() => env.restart().then(() => env));
  };

  // Tears down an arena's in-memory environment immediately (rather than
  // waiting for the 30-minute idle GC). Used when an arena is deleted.
  dispose = (arenaId: ArenaId): Promise<void> => {
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
  //   isolates      total Processes across all environments (one isolate each)
  //   maxAvgTickMs  the busiest arena's EMA tick duration (see Environment)
  metrics = (): {
    arenas: number;
    runningArenas: number;
    isolates: number;
    maxAvgTickMs: number;
  } => {
    const envs = Object.values(this.store);
    let runningArenas = 0;
    let isolates = 0;
    let maxAvgTickMs = 0;
    for (const env of envs) {
      if (env.isRunning()) runningArenas++;
      isolates += env.getProcesses().length;
      const t = env.getAvgTickMs();
      if (t > maxAvgTickMs) maxAvgTickMs = t;
    }
    return {
      arenas: envs.length,
      runningArenas,
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
