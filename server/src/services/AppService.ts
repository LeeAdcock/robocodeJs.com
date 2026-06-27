import { UserId } from '../types/user';
import TankApp, { AppId } from '../types/app';
import pool from '../util/db';
import { randomUUID } from 'node:crypto';

pool.query(`
  CREATE TABLE IF NOT EXISTS app (
    id UUID,
    userId UUID,
    source text,
    name text,
    deleted boolean default false,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    updatedTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);

export class AppService {
  create = (userId: UserId): Promise<TankApp> => {
    const appId = randomUUID();
    const app = new TankApp(appId, userId);
    return pool
      .query({
        text: 'INSERT INTO app(id, userId, name) VALUES($1, $2, $3)',
        values: [app.getId(), app.getUserId(), app.getName()],
      })
      .then(() => Promise.resolve(app));
  };

  get = (appId: AppId): Promise<TankApp | undefined> => {
    return pool
      .query({
        text: 'SELECT app.userId as "userId", app.name as "name", app.source as "source" FROM app WHERE id=$1 AND NOT deleted',
        values: [appId],
      })
      .then((res) => {
        if (res.rowCount === 0) return undefined;
        return new TankApp(appId, res.rows[0].userId).hydrate(
          res.rows[0].name,
          res.rows[0].source
        );
      });
  };

  getForUser = (userId: UserId): Promise<TankApp[]> => {
    return pool
      .query({
        text: 'SELECT app.id as "appId", app.name as "name", app.source as "source" FROM app WHERE userId=$1 AND NOT deleted ORDER BY app.id',
        values: [userId],
      })
      .then((res) =>
        res.rows.map((row) =>
          new TankApp(row.appId, userId).hydrate(row.name, row.source)
        )
      );
  };
}

export default new AppService();
