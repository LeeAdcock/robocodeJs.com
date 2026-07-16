import User, { UserId, DEMO_USER_ID } from '../types/user';
import { randomUUID } from 'node:crypto';
import arenaService from './ArenaService';
import pool from '../util/db';
import appService from './AppService';
import arenaMemberService from './ArenaMemberService';
import environmentService from './EnvironmentService';
import { logger } from '../util/logger';
import { STARTER_BOTS } from '../util/starterBots';

pool.query(`
  CREATE TABLE IF NOT EXISTS account (
    id UUID,
    name text,
    picture text,
    email text,
    lastActiveAt timestamp,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);
// Backfill lastActiveAt (GitHub #151 — ladder eligibility reads it as "owner
// active recently") on databases whose `account` table predates the column.
// No-op where the CREATE above already added it. Same guarded idiom as
// ArenaMemberService so a mocked pool.query is safe and an engine lacking `ADD
// COLUMN IF NOT EXISTS` can't crash boot.
Promise.resolve(
  pool.query(
    'ALTER TABLE account ADD COLUMN IF NOT EXISTS lastActiveAt timestamp'
  )
).catch(() => undefined);

class UserService {
  static demoUserId: UserId = DEMO_USER_ID;

  create = (
    name: string | undefined,
    picture: string | undefined,
    email: string | undefined,
    demo = false
  ): Promise<User> => {
    const userId: UserId = demo ? UserService.demoUserId : randomUUID();
    logger.info({ userId }, 'creating user');
    return pool
      .query({
        // RETURNING the row's own createdTimestamp rather than stamping one here:
        // the column defaults to CURRENT_TIMESTAMP, so this is the only way the
        // returned User carries the same value a later get() would read. Without
        // it, a freshly-created User has no "member since" — which local dev shows
        // permanently, since it memoizes the User from this call (ensureDevUser).
        text: 'INSERT INTO account(id, name, picture, email) VALUES($1, $2, $3, $4) RETURNING createdTimestamp as "createdTimestamp"',
        values: [userId, name, picture, email],
      })
      .then((res) => {
        const user = new User(
          userId,
          name,
          picture,
          email,
          res.rows[0]?.createdTimestamp
        );
        return user;
      })
      .then((user) =>
        arenaService.create(user.getId()).then((arena) =>
          Promise.all(
            // Seed each new account's starter bots from the shared templates
            // (util/starterBots.ts), which the ladder also references to keep
            // untouched starters out of the rankings.
            STARTER_BOTS.map((starter) =>
              appService.create(user.getId()).then((app) => {
                app.setName(starter.name);
                return app
                  .setSource(starter.source)
                  .then(() =>
                    arenaMemberService.create(arena.getId(), app.getId())
                  );
              })
            )
          )
            .then(() =>
              environmentService.get(arena).then((env) => env.resume())
            )
            .then(() => user)
        )
      );
  };

  getDemoUser = (): Promise<User> => {
    return this.get(UserService.demoUserId).then((user) => {
      if (!user) {
        return this.create('demo', undefined, undefined, true);
      }
      return user;
    });
  };

  get = (userId: UserId): Promise<User | undefined> => {
    return pool
      .query({
        text: 'SELECT account.name, account.picture, account.email, account.createdTimestamp as "createdTimestamp" FROM account WHERE id=$1',
        values: [userId],
      })
      .then((res) => {
        return res.rowCount === 0
          ? undefined
          : new User(
              userId,
              res.rows[0].name,
              res.rows[0].picture,
              res.rows[0].email,
              res.rows[0].createdTimestamp
            );
      });
  };

  // Record that a user was active now (GitHub #151 — ladder eligibility skips
  // apps whose owner has gone quiet). Called fire-and-forget from the auth
  // middleware on every authenticated request, so the update is throttled in SQL
  // to at most once per hour per user to avoid write amplification. Resolves to
  // whether a row was actually written (false when throttled or user missing).
  touchActivity = (userId: UserId): Promise<boolean> => {
    return pool
      .query({
        text: "UPDATE account SET lastActiveAt=CURRENT_TIMESTAMP WHERE id=$1 AND (lastActiveAt IS NULL OR lastActiveAt < CURRENT_TIMESTAMP - interval '1 hour')",
        values: [userId],
      })
      .then((res) => (res.rowCount ?? 0) > 0);
  };
}

export default new UserService();
