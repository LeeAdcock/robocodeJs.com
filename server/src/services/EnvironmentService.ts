import Arena from "../types/arena";
import Environment, { ArenaId, Process } from "../types/environment";
import arenaMemberService from "./ArenaMemberService";

export class EnvironmentService {
  store: Map<ArenaId, Environment> = new Map();

  constructor() {
    // Garbage collection
    setInterval(() => {
      const threshold = new Date().getTime() - 30 * 60 * 1000; // thirty minutes ago
      (Object.entries(this.store) as [ArenaId, Environment][]).forEach(
        ([arenaId, env]) => {
          if (env.stoppedAt && threshold > env.stoppedAt.getTime()) {
            console.log("disposing isolate", arenaId);
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
    console.log("creating isolate", arena.getId());

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
      .then(() => {
        env.restart();
        return env;
      });
  };

  getByArenaId = (arenaId: ArenaId): Promise<Environment | undefined> => {
    return Promise.resolve(this.store[arenaId]);
  };

  has = (arenaId: ArenaId): boolean => undefined !== this.store[arenaId];
}

export default new EnvironmentService();
