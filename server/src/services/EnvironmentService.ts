import Arena from '../types/arena';
import Environment, { ArenaId, Process } from '../types/environment';
import arenaMemberService from './ArenaMemberService';

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
            console.log('disposing isolate', arenaId);
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
    console.log('creating isolate', arena.getId());

    this.store[arena.getId()] = env;
    return arenaMemberService
      .getForArena(arena.getId())
      .then((members) =>
        Promise.all(
          members.map((member) => {
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
      console.log('disposing isolate', arenaId);
      delete this.store[arenaId];
      env.dispose();
    }
    return Promise.resolve();
  };

  getByArenaId = (arenaId: ArenaId): Promise<Environment | undefined> => {
    return Promise.resolve(this.store[arenaId]);
  };

  has = (arenaId: ArenaId): boolean => undefined !== this.store[arenaId];
}

export default new EnvironmentService();
