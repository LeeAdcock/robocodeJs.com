import pool from "../util/db";
import { ArenaId } from "../types/arena";
import { AppId } from "../types/app";
import ArenaMember from "../types/arenaMember";

pool.query(`
  CREATE TABLE IF NOT EXISTS arena_member (
    arenaId UUID,
    appId UUID,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (arenaId, appId)
  )
`);

export class ArenaMemberService {
  create = (arenaId: ArenaId, appId: AppId): Promise<ArenaMember> => {
    const member = new ArenaMember(arenaId, appId, new Date().getTime());
    return pool
      .query({
        text: "INSERT INTO arena_member(arenaId, appId) VALUES($1, $2)",
        values: [arenaId, appId],
      })
      .then(() => Promise.resolve(member));
  };

  getForApp = (appId: AppId): Promise<ArenaMember[]> => {
    return pool
      .query({
        text: 'SELECT arena_member.arenaId as "arenaId", arena_member.createdTimestamp as "createdTimestamp" FROM arena_member WHERE appId=$1 ORDER BY arena_member.createdTimestamp',
        values: [appId],
      })
      .then((res) =>
        res.rows.map((row) => new ArenaMember(appId, row.arenaId, new Date(row.createdTimestamp).getTime()))
      );
  };

  getForArena = (arenaId: ArenaId): Promise<ArenaMember[]> => {
    return pool
      .query({
        text: 'SELECT arena_member.appId as "appId", arena_member.createdTimestamp as "createdTimestamp" FROM arena_member WHERE arenaId=$1 ORDER BY arena_member.createdTimestamp',
        values: [arenaId],
      })
      .then((res) =>
        res.rows.map((row) => new ArenaMember(row.appId, arenaId, new Date(row.createdTimestamp).getTime()))
      );
  };
}

export default new ArenaMemberService();
