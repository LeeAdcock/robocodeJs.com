import { UserId } from "../types/user";
import Identity from "../types/identity";
import pool from "../util/db";

pool.query(`
  CREATE TABLE IF NOT EXISTS identity (
    userId UUID,
    source text,
    sourceId text,
    createdTimestamp timestamp default CURRENT_TIMESTAMP
  )
`);

class IdentityService {
  create = (
    userId: UserId,
    source: string,
    sourceId: string
  ): Promise<Identity> => {
    const userAuth = new Identity(userId, source, sourceId);
    return pool
      .query({
        text: "INSERT INTO identity(userId, source, sourceId) VALUES($1, $2, $3)",
        values: [userId, source, sourceId],
      })
      .then(() => userAuth);
  };

  get = (source: string, sourceId: string): Promise<Identity | undefined> => {
    return pool
      .query({
        text: 'SELECT identity.userId as "userId" FROM identity WHERE source=$1 AND sourceId=$2',
        values: [source, sourceId],
      })
      .then((res) =>
        res.rowCount === 0
          ? undefined
          : new Identity(res.rows[0]["userId"], source, sourceId)
      );
  };
}

export default new IdentityService();
