import { AppId } from "./app";
import { ArenaId } from "./arena";

export default class ArenaMember {
  public appId: AppId;
  public arenaId: ArenaId;

  constructor(appId: AppId, arenaId: ArenaId) {
    this.appId = appId;
    this.arenaId = arenaId;
  }
}
