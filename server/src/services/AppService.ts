import User from "../types/user";
import TankApp, { AppId } from "../types/app";

export class AppService {
  apps: TankApp[] = [];
  get = (appId: AppId) => this.apps.find((app) => app.getId() === appId);
  put = (app: TankApp) => this.apps.push(app);

  create = (user: User): TankApp => {
    const tankApp = new TankApp(user);
    this.put(tankApp);
    return tankApp;
  };
  getForUser = (user: User): TankApp[] =>
    this.apps.filter((app) => app.getUserId() === user.getId());
}

export default new AppService();
