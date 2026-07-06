import pool from '../util/db';
import { ArenaId } from '../types/arena';
import { AppId } from '../types/app';
import ArenaMember from '../types/arenaMember';

pool.query(`
  CREATE TABLE IF NOT EXISTS arena_member (
    arenaId UUID,
    appId UUID,
    enabled BOOLEAN NOT NULL DEFAULT true,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (arenaId, appId)
  )
`);
// Backfill `enabled` on databases whose arena_member predates the column. A
// no-op where the CREATE above already added it (fresh pg-mem in dev/test).
// Wrapped in Promise.resolve so a mocked pool.query (unit tests return undefined)
// is safe, and errors are swallowed so an engine lacking `ADD COLUMN IF NOT
// EXISTS` can't crash boot.
Promise.resolve(
  pool.query(
    'ALTER TABLE arena_member ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true'
  )
).catch(() => undefined);

export class ArenaMemberService {
  create = (
    arenaId: ArenaId,
    appId: AppId,
    enabled = true
  ): Promise<ArenaMember> => {
    const member = new ArenaMember(
      appId,
      arenaId,
      new Date().getTime(),
      enabled
    );
    return pool
      .query({
        text: 'INSERT INTO arena_member(arenaId, appId, enabled) VALUES($1, $2, $3)',
        values: [arenaId, appId, enabled],
      })
      .then(() => Promise.resolve(member));
  };

  getForApp = (appId: AppId): Promise<ArenaMember[]> => {
    return pool
      .query({
        text: 'SELECT arena_member.arenaId as "arenaId", arena_member.enabled as "enabled", arena_member.createdTimestamp as "createdTimestamp" FROM arena_member WHERE appId=$1 ORDER BY arena_member.createdTimestamp, arena_member.arenaId',
        values: [appId],
      })
      .then((res) =>
        res.rows.map(
          (row) =>
            new ArenaMember(
              appId,
              row.arenaId,
              new Date(row.createdTimestamp).getTime(),
              row.enabled
            )
        )
      );
  };

  deleteForArena = (arenaId: ArenaId): Promise<void> => {
    return pool
      .query({
        text: 'DELETE FROM arena_member WHERE arenaId=$1',
        values: [arenaId],
      })
      .then(() => undefined);
  };

  getForArena = (arenaId: ArenaId): Promise<ArenaMember[]> => {
    return pool
      .query({
        // createdTimestamp ties (bots added in the same instant — e.g. the
        // starter bots, and pg-mem's per-statement CURRENT_TIMESTAMP) would make
        // the order non-deterministic, so a toggle/refetch could reshuffle the
        // roster (and arena colors, which key off member order). Break ties by
        // appId for a stable, deterministic order.
        text: 'SELECT arena_member.appId as "appId", arena_member.enabled as "enabled", arena_member.createdTimestamp as "createdTimestamp" FROM arena_member WHERE arenaId=$1 ORDER BY arena_member.createdTimestamp, arena_member.appId',
        values: [arenaId],
      })
      .then((res) =>
        res.rows.map(
          (row) =>
            new ArenaMember(
              row.appId,
              arenaId,
              new Date(row.createdTimestamp).getTime(),
              row.enabled
            )
        )
      );
  };
}

export default new ArenaMemberService();
