import { UserId } from "../types/user";
import TankApp, { AppId } from "../types/app";
import pool from "../util/db";
import { v4 as uuidv4 } from "uuid";

pool.query(`
  CREATE TABLE IF NOT EXISTS app (
    id UUID,
    userId UUID,
    source text,
    name text
  )
`);

export class AppService {
  create = (userId: UserId): Promise<TankApp> => {
    const appId = uuidv4();
    const app = new TankApp(appId, userId);
    return pool
      .query({
        text: "INSERT INTO app(id, userId, name) VALUES($1, $2, $3)",
        values: [app.getId(), app.getUserId(), app.getName()],
      })
      .then(() => Promise.resolve(app));
  };

  get = (appId: AppId): Promise<TankApp | undefined> => {
    return pool
      .query({
        text: 'SELECT app.userId as "userId", app.name as "name", app.source as "source" FROM app WHERE id=$1',
        values: [appId],
      })
      .then((res) => {
        if (res.rowCount === 0) return undefined;
        const app = new TankApp(appId, res.rows[0].userId);
        app.setName(res.rows[0].name);
        app.setSource(res.rows[0].source);
        return app;
      });
  };

  getForUser = (userId: UserId): Promise<TankApp[]> => {
    return pool
      .query({
        text: 'SELECT app.id as "appId", app.name as "name", app.source as "source" FROM app WHERE userId=$1',
        values: [userId],
      })
      .then((res) =>
        res.rows.map((row) => {
          const app = new TankApp(row.appId, userId);
          app.setName(row.name);
          app.setSource(row.source);
          return app;
        })
      );
  };

}

export default new AppService();
