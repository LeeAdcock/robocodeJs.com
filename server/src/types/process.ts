import TankApp from "./app";
import Tank from "./tank";
import ivm from "isolated-vm";

export default class Process {
  constructor(app: TankApp) {
    this.app = app;
    this.sandbox = new ivm.Isolate({
      memoryLimit: 8,
      onCatastrophicError: (msg) => {
        this.tanks.forEach((tank) => {
          tank.appCrashed = true;
          tank.logger.error(new Error(msg));
        });
        this.sandbox.dispose();
      },
    });
  }
  app: TankApp;
  tanks: Tank[] = [];
  sandbox: ivm.Isolate;

  reset() {
    this.tanks = [];
    this.sandbox.dispose();
    this.sandbox = new ivm.Isolate({
      memoryLimit: 8,
      onCatastrophicError: (msg) => console.log(msg),
    });
  }
}
