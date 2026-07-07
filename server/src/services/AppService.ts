import { UserId } from '../types/user';
import App, { AppId } from '../types/app';
import pool from '../util/db';
import { randomUUID } from 'node:crypto';

pool.query(`
  CREATE TABLE IF NOT EXISTS app (
    id UUID,
    userId UUID,
    source text default '',
    name text,
    deleted boolean default false,
    createdTimestamp timestamp default CURRENT_TIMESTAMP,
    updatedTimestamp timestamp default CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  )
`);

export class AppService {
  create = (userId: UserId): Promise<App> => {
    const appId = randomUUID();
    const app = new App(appId, userId);
    return pool
      .query({
        // Insert an empty-string source rather than leaving it NULL: a NULL
        // source reads back as an empty bot before setSource lands and is a
        // foot-gun for any consumer that assumes a string (get_app_source, the
        // compiler, the editor). See App.hydrate for the read-side guard.
        text: 'INSERT INTO app(id, userId, name, source) VALUES($1, $2, $3, $4)',
        values: [app.getId(), app.getUserId(), app.getName(), app.getSource()],
      })
      .then(() => Promise.resolve(app));
  };

  get = (appId: AppId): Promise<App | undefined> => {
    return pool
      .query({
        text: 'SELECT app.userId as "userId", app.name as "name", app.source as "source" FROM app WHERE id=$1 AND NOT deleted',
        values: [appId],
      })
      .then((res) => {
        if (res.rowCount === 0) return undefined;
        return new App(appId, res.rows[0].userId).hydrate(
          res.rows[0].name,
          res.rows[0].source
        );
      });
  };

  getForUser = (userId: UserId): Promise<App[]> => {
    return pool
      .query({
        text: 'SELECT app.id as "appId", app.name as "name", app.source as "source" FROM app WHERE userId=$1 AND NOT deleted ORDER BY app.id',
        values: [userId],
      })
      .then((res) =>
        res.rows.map((row) =>
          new App(row.appId, userId).hydrate(row.name, row.source)
        )
      );
  };
}

export default new AppService();
