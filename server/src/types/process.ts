import TankApp from "./app";
import Tank from "./tank";
import ivm from "isolated-vm";

export default class Process {
  public app: TankApp;
  public tanks: Tank[] = [];
  private sandbox: ivm.Isolate | null = null;

  constructor(app: TankApp) {
    this.app = app;
  }

  getSandbox = (): ivm.Isolate => {
    if (!this.sandbox) {
      this.sandbox = new ivm.Isolate({
        memoryLimit: 8,
        onCatastrophicError: (msg) => {
          this.tanks.forEach((tank) => {
            tank.appCrashed = true;
            tank.logger.error(new Error(msg));
          });
          this.sandbox?.dispose();
        },
      });
    }
    return this.sandbox;
  };

  reset() {
    this.tanks = [];
    this.sandbox?.dispose();
    this.sandbox = null;
  }
}
