import { UserId } from "../types/user";
import UserAuth from "../types/userAuth";
import pool from "../util/db";

pool.query(`
  CREATE TABLE IF NOT EXISTS "user_auth" (
    userId UUID,
    source text,
    sourceId text
  )
`);

class AuthService {
  create = (
    userId: UserId,
    source: string,
    sourceId: string
  ): Promise<UserAuth> => {
    const userAuth = new UserAuth(userId, source, sourceId);
    return pool
      .query({
        text: "INSERT INTO user_auth(userId, source, sourceId) VALUES($1, $2, $3)",
        values: [userId, source, sourceId],
      })
      .then(() => userAuth);
  };

  get = (source: string, sourceId: string): Promise<UserAuth | undefined> => {
    return pool
      .query({
        text: 'SELECT user_auth.userId as "userId" FROM user_auth WHERE source=$1 AND sourceId=$2',
        values: [source, sourceId],
      })
      .then((res) =>
        res.rowCount === 0
          ? undefined
          : new UserAuth(res.rows[0]["userId"], source, sourceId)
      );
  };
}

export default new AuthService();
