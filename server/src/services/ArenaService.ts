import User, { UserId } from "../types/user";
import Arena, { ArenaId } from "../types/arena";
import { AppId } from "../types/app";

class ArenaService {
  arenas: Arena[] = [];
  get = (arenaId: ArenaId) =>
    this.arenas.find((arena) => arena.getId() === arenaId);
  put = (arena: Arena) => this.arenas.push(arena);

  create = (user: User): Arena => {
    const arena = new Arena(user);
    this.put(arena);
    return arena;
  };
  getForUser = (userId: UserId): Arena[] =>
    this.arenas.filter((arena) => arena.getUserId() === userId);
  getForApp = (appId: AppId): Arena[] =>
    this.arenas.filter((arena) =>
      arena.getProcesses().find((process) => process.app.getId() === appId)
    );
}

export default new ArenaService();
