import { Event } from "./event";
import { Orientated } from "./orientated";
import Tank, { normalizeAngle, waitUntil } from "./tank";

export class TankRadar implements Orientated {
  public orientation: number;
  public orientationTarget: number;
  public orientationVelocity: number;

  public charged: number;
  private tank: Tank;

  constructor(tank: Tank) {
    this.tank = tank;
    this.orientation = Math.random() * 360;
    this.orientationTarget = this.orientation;
    this.orientationVelocity = 2;
    this.charged = 0;
  }

  setOrientation(d: number) {
    const target = normalizeAngle(d);
    this.orientationTarget = target;
    // todo only if this is an actual change
    this.tank.arena.emit("event", {
      type: "radarTurn",
      time: this.tank.arena.getTime(),
      id: this.tank.id,
      radarOrientationTarget: this.orientationTarget,
      radarOrientation: this.orientation,
      radarOrientationVelocity: this.orientationVelocity,
    });
    this.tank.logger.trace("Turning radar to " + this.orientationTarget + "°");
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      () => this.orientation === target % 360,
      () =>
        !this.tank.arena.isRunning() || this.orientationTarget !== target % 360,
      "Radar orientation change cancelled"
    );
  }

  getOrientation() {
    return normalizeAngle(this.orientation);
  }

  isTurning() {
    return this.orientation !== this.orientationTarget;
  }

  turn(d: number) {
    const target = normalizeAngle(this.orientation + d);
    this.orientationTarget = target;
    // todo only if this is an actual change
    this.tank.arena.emit("event", {
      type: "radarTurn",
      time: this.tank.arena.getTime(),
      id: this.tank.id,
      radarOrientationTarget: this.orientationTarget,
      radarOrientation: this.orientation,
      radarOrientationVelocity: this.orientationVelocity,
    });
    this.tank.logger.trace("Turning radar to " + this.orientationTarget + "°");
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      () => this.orientation === target,
      () =>
        !this.tank.arena.isRunning() ||
        this.orientationTarget !== target ||
        this.tank.health <= 0,
      "Radar turn chancelled"
    );
  }

  onReady() {
    let peakValue = this.charged;
    return waitUntil(
      () => this.charged >= 100,
      () => {
        // Reject if the value decreases, or bot dies
        peakValue = Math.max(peakValue, this.charged);
        return (
          !this.tank.arena.isRunning() ||
          this.tank.health <= 0 ||
          this.charged < peakValue
        );
      },
      "Radar already scanned"
    );
  }

  isReady() {
    return this.charged >= 100;
  }

  scan() {
    if (this.charged < 100) return Promise.reject("Radar not ready");
    this.tank.logger.trace("Scanning");
    this.charged = 0;
    this.tank.arena.emit("event", {
      type: "radarScan",
      time: this.tank.arena.getTime(),
      id: this.tank.id,
    });

    this.tank.stats.scansCompleted += 1;

    const found: any[] = [];
    this.tank.arena.getProcesses().forEach((otherProcess) => {
      otherProcess.tanks.forEach((otherTank) => {
        if (otherTank.health > 0 && otherTank.id !== this.tank.id) {
          const distance = Math.sqrt(
            Math.pow(otherTank.x - this.tank.x, 2) +
              Math.pow(otherTank.y - this.tank.y, 2)
          );
          const angle: number = normalizeAngle(
            Math.atan2(otherTank.y - this.tank.y, otherTank.x - this.tank.x) *
              (180 / Math.PI) -
              90
          );
          const radarAngle: number = normalizeAngle(
            this.tank.getOrientation() +
              this.tank.turret.getOrientation() +
              this.getOrientation()
          );
          if (
            distance < 300 &&
            Math.abs(normalizeAngle(angle - radarAngle + 180) - 180) <
              (500 - distance) * (0.5 / 10)
          ) {
            if (otherTank.handlers[Event.DETECTED]) {
              otherTank.handlers[Event.DETECTED]();
            }
            otherTank.stats.timesDetected += 1;
            found.push({
              id: otherTank.id,
              speed: otherTank.speed,
              orientation: otherTank.getOrientation(),
              distance,
              angle,
              friendly:
                otherProcess.app.getId() === this.tank.process.app.getId(),
            });
          }
        }
      });
    });
    if (this.tank.handlers[Event.SCANNED]) {
      this.tank.handlers[Event.SCANNED](found);
    }

    this.tank.logger.trace(`Scan detected ${found.length} bots`);
    this.tank.stats.scansDetected += found.length;

    return Promise.resolve(found);
  }
}
