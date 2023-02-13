import { AppId } from "./app";
import { ArenaId } from "./arena";
import pool from "../util/db";

export default class ArenaMember {
  private appId: AppId;
  private arenaId: ArenaId;
  private timestamp: number;

  constructor(appId: AppId, arenaId: ArenaId, timestamp: number) {
    this.appId = appId;
    this.arenaId = arenaId;
    this.timestamp = timestamp
  }

  getAppId = () => this.appId;
  getArenaId = () => this.arenaId;
  getTimestamp = () => this.timestamp;

  delete = (): Promise<undefined> => {
    return pool
      .query({
        text: "DELETE FROM arena_member WHERE arenaId=$1 AND appId=$2",
        values: [this.arenaId, this.appId],
      })
      .then(() => undefined);
  };
}
