import pool from "../util/db";
import { ArenaId } from "../types/arena";
import { AppId } from "../types/app";
import ArenaMember from "../types/arenaMember";

pool.query(`
  CREATE TABLE IF NOT EXISTS arena_member (
    arenaId UUID,
    appId UUID
  )
`);

export class ArenaMemberService {
  create = (arenaId: ArenaId, appId: AppId): Promise<ArenaMember> => {
    const member = new ArenaMember(arenaId, appId);
    return pool
      .query({
        text: "INSERT INTO arena_member(arenaId, appId) VALUES($1, $2)",
        values: [arenaId, appId],
      })
      .then(() => Promise.resolve(member));
  };

  delete = (appId: AppId, arenaId: ArenaId): Promise<undefined> => {
    return pool
      .query({
        text: "DELETE FROM arena_member WHERE arenaId=$1 AND appId=$2",
        values: [arenaId, appId],
      })
      .then((_) => undefined);
  };

  getForApp = (appId: AppId): Promise<ArenaId[]> => {
    return pool
      .query({
        text: 'SELECT arena_member.arenaId as "arenaId" FROM arena_member WHERE appId=$1',
        values: [appId],
      })
      .then((res) => res.rows.map((row) => row.arenaId));
  };

  getForArena = (arenaId: ArenaId): Promise<AppId[]> => {
    return pool
      .query({
        text: 'SELECT arena_member.appId as "appId" FROM arena_member WHERE arenaId=$1',
        values: [arenaId],
      })
      .then((res) => res.rows.map((row) => row.appId));
  };
}

export default new ArenaMemberService();