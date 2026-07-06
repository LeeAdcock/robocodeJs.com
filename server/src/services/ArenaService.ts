import { UserId } from '../types/user';
import pool from '../util/db';
import { randomUUID } from 'node:crypto';
import Arena, { ArenaId } from '../types/arena';

pool.query(`
  CREATE TABLE IF NOT EXISTS arena (
    id UUID,
    userId UUID,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);

export class ArenaService {
  create = (userId: UserId): Promise<Arena> => {
    const arenaId = randomUUID();
    const arena = new Arena(arenaId, userId);
    return pool
      .query({
        text: 'INSERT INTO arena(id, userId) VALUES($1, $2)',
        values: [arena.getId(), arena.getUserId()],
      })
      .then(() => Promise.resolve(arena));
  };

  get = (arenaId: ArenaId): Promise<Arena | undefined> => {
    return pool
      .query({
        text: 'SELECT arena.userId as "userId" FROM arena WHERE id=$1',
        values: [arenaId],
      })
      .then((res) => {
        return res.rowCount === 0
          ? undefined
          : new Arena(arenaId, res.rows[0].userId);
      });
  };

  // Total number of arenas across all users. Backs the global arena ceiling
  // (MAX_TOTAL_ARENAS in api/arena.ts): every arena can materialize into an
  // isolate-backed Environment, so this bounds the whole server's worst-case
  // isolate footprint, not just any one user's.
  count = (): Promise<number> => {
    return pool
      .query('SELECT COUNT(*) AS count FROM arena')
      .then((res) => Number(res.rows[0].count));
  };

  getForUser = (userId: UserId): Promise<Arena[]> => {
    return pool
      .query({
        text: 'SELECT arena.id as "arenaId" FROM arena WHERE userId=$1 ORDER BY createdTimestamp',
        values: [userId],
      })
      .then((res) => res.rows.map((row) => new Arena(row.arenaId, userId)));
  };

  // The user's default arena (first by creation time). Lazily creates one if
  // the user has none, so callers never have to special-case the empty state —
  // this is what lets the legacy `/arena` routes always resolve an arena.
  getDefaultForUser = (userId: UserId): Promise<Arena> => {
    return this.getForUser(userId).then((arenas) =>
      arenas.length > 0 ? arenas[0] : this.create(userId)
    );
  };

  delete = (arenaId: ArenaId): Promise<void> => {
    return pool
      .query({ text: 'DELETE FROM arena WHERE id=$1', values: [arenaId] })
      .then(() => undefined);
  };
}

export default new ArenaService();
