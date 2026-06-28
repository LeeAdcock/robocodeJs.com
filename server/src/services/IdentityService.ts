import { UserId } from '../types/user';
import Identity from '../types/identity';
import pool from '../util/db';

pool.query(`
  CREATE TABLE IF NOT EXISTS identity (
    userId UUID,
    source text,
    sourceId text,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (source, sourceId)
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
        text: 'INSERT INTO identity(userId, source, sourceId) VALUES($1, $2, $3)',
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
          : new Identity(res.rows[0]['userId'], source, sourceId)
      );
  };

  // All identities a user holds for a given source — e.g. ('apikey') to answer
  // "does this user have an API token?" without revealing it (we only store the
  // token's hash as sourceId).
  getForUser = (userId: UserId, source: string): Promise<Identity[]> => {
    return pool
      .query({
        text: 'SELECT identity.sourceId as "sourceId" FROM identity WHERE source=$1 AND userId=$2',
        values: [source, userId],
      })
      .then((res) =>
        res.rows.map((row) => new Identity(userId, source, row['sourceId']))
      );
  };

  // Remove all of a user's identities for a source. Used to rotate the single
  // API token: delete the old row before inserting the new hash.
  deleteForUser = (userId: UserId, source: string): Promise<void> => {
    return pool
      .query({
        text: 'DELETE FROM identity WHERE source=$1 AND userId=$2',
        values: [source, userId],
      })
      .then(() => undefined);
  };
}

export default new IdentityService();
