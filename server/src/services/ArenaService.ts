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
