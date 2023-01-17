import { UserId } from "../types/user";
import pool from "../util/db";
import { v4 as uuidv4 } from "uuid";
import Arena, { ArenaId } from "../types/arena";

pool.query(`
  CREATE TABLE IF NOT EXISTS arena (
    id UUID,
    userId UUID
  )
`);

export class ArenaService {
  create = (userId: UserId): Promise<Arena> => {
    const arenaId = uuidv4();
    const arena = new Arena(arenaId, userId);
    return pool
      .query({
        text: "INSERT INTO arena(id, userId) VALUES($1, $2)",
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
        text: 'SELECT arena.id as "arenaId" FROM arena WHERE userId=$1',
        values: [userId],
      })
      .then((res) => res.rows.map((row) => new Arena(row.arenaId, userId)));
  };
}

export default new ArenaService();
