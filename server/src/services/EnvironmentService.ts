import Arena from "../types/arena";
import Environment, { ArenaId, Process } from "../types/environment";
import arenaMemberService from "./ArenaMemberService";

const store : Map<ArenaId, Environment> = new Map();

export class EnvironmentService {
  get = (arena: Arena): Promise<Environment> => {
    let env: Environment = store[arena.getId()]
    if(env)
    {
      return Promise.resolve(env);
    }

    env = new Environment(arena)
    store[arena.getId()] = env;
    return arenaMemberService.getForArena(arena.getId())
    .then(appIds => Promise.all(
      appIds.map(appId =>
        env.processes.push(new Process(env, appId))
      )
    ).then(() => env))
  };

  getByArenaId = (arenaId: ArenaId): Promise<Environment | undefined> => {
    return Promise.resolve(store[arenaId]);
  };

  has = (arenaId: ArenaId): boolean => store[arenaId] !== undefined;
}

export default new EnvironmentService();
