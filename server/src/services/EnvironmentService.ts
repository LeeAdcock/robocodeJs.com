import Arena from '../types/arena';
import Environment, { ArenaId, Process } from '../types/environment';
import arenaMemberService from './ArenaMemberService';
import { logger } from '../util/logger';

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
