import { AppId } from './app';
import { ArenaId } from './arena';
import pool from '../util/db';

export default class ArenaMember {
  private appId: AppId;
  private arenaId: ArenaId;
  private timestamp: number;
  // Whether the bot participates in the live match. Disabled members keep their
  // link to the arena (so they show in the roster and can be re-enabled) but are
  // never materialized into a Process — see EnvironmentService.get.
  private enabled: boolean;

  constructor(
    appId: AppId,
    arenaId: ArenaId,
    timestamp: number,
    enabled = true
  ) {
    this.appId = appId;
    this.arenaId = arenaId;
    this.timestamp = timestamp;
    this.enabled = enabled;
  }

  getAppId = () => this.appId;
  getArenaId = () => this.arenaId;
  getTimestamp = () => this.timestamp;
  getEnabled = () => this.enabled;

  setEnabled = (enabled: boolean): Promise<undefined> => {
    this.enabled = enabled;
    return pool
      .query({
        text: 'UPDATE arena_member SET enabled=$3 WHERE arenaId=$1 AND appId=$2',
        values: [this.arenaId, this.appId, enabled],
      })
      .then(() => undefined);
  };

  delete = (): Promise<undefined> => {
    return pool
      .query({
        text: 'DELETE FROM arena_member WHERE arenaId=$1 AND appId=$2',
        values: [this.arenaId, this.appId],
      })
      .then(() => undefined);
  };
}
