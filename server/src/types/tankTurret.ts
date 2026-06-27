import Bullet from './bullet';
import { randomUUID } from 'node:crypto';
import { Event } from './event';
import { Orientated } from './orientated';
import Tank, { waitUntil } from './tank';
import { normalizeAngle } from '../util/geometry';
import { TankRadar } from './tankRadar';

export class TankTurret implements Orientated {
  public orientation: number;
  public orientationTarget: number;
  public orientationVelocity: number;
  public radar: TankRadar;
  public loaded: number;
  private tank: Tank;

  constructor(tank: Tank) {
    this.tank = tank;
    this.orientation = Math.random() * 360;
    this.orientationTarget = this.orientation;
    this.orientationVelocity = 2;
    this.radar = new TankRadar(tank);
    this.loaded = 0;
  }

  setOrientation(d: number) {
    const target = normalizeAngle(Math.round(d));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.tank.env.emit('event', {
      type: 'turretTurn',
      time: this.tank.env.getTime(),
      id: this.tank.id,
      turretOrientationTarget: this.orientationTarget,
      turretOrientation: this.orientation,
      turretOrientationVelocity: this.orientationVelocity,
    });
    this.tank.logger.trace('Turning turret to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      () => this.orientation === target % 360,
      () =>
        !this.tank.env.isRunning() ||
        this.orientationTarget !== target % 360 ||
        this.tank.health <= 0,
      'Turret orientation change cancelled'
    );
  }

  getOrientation() {
    return Math.floor(normalizeAngle(this.orientation));
  }

  isTurning() {
    return this.orientation !== this.orientationTarget;
  }

  turn(d: number) {
    const target = normalizeAngle(Math.round(this.orientation + d));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.tank.env.emit('event', {
      type: 'turretTurn',
      time: this.tank.env.getTime(),
      id: this.tank.id,
      turretOrientationTarget: this.orientationTarget,
      turretOrientation: this.orientation,
      turretOrientationVelocity: this.orientationVelocity,
    });
    this.tank.logger.trace('Turning turret to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      () => this.orientation === target,
      () =>
        !this.tank.env.isRunning() ||
        this.orientationTarget !== target ||
        this.tank.health <= 0,
      'Turret turn cancelled'
    );
  }

  onReady() {
    let peakValue = this.loaded;
    return waitUntil(
      () => this.loaded >= 100,
      () => {
        // Reject if the value decreases, or bot dies
        peakValue = Math.max(peakValue, this.loaded);
        return (
          !this.tank.env.isRunning() ||
          this.tank.health <= 0 ||
          this.loaded < peakValue
        );
      },
      'Turret already fired'
    );
  }

  isReady() {
    return this.loaded >= 100;
  }

  fire() {
    if (this.loaded < 100) return Promise.reject('Turret not ready');
    this.tank.logger.trace('Turret firing');

    this.tank.stats.shotsFired += 1;

    if (this.tank.handlers[Event.FIRED]) {
      this.tank.handlers[Event.FIRED]();
    }

    const bullet: Bullet = {
      id: randomUUID(),
      exploded: false,
      x: this.tank.x,
      y: this.tank.y,
      origin: {
        x: this.tank.x,
        y: this.tank.y,
      },
      orientation: this.tank.getOrientation() + this.orientation,
      speed: 25,
    };
    this.tank.bullets.push(bullet);
    this.loaded = 0;

    this.tank.env.emit('event', {
      type: 'bulletFired',
      time: this.tank.env.getTime(),
      id: bullet.id,
      tankId: this.tank.id,
      x: bullet.origin.x,
      y: bullet.origin.y,
      speed: bullet.speed,
      orientation: bullet.orientation,
    });
    return new Promise((resolve) => {
      bullet.callback = resolve;
    });
  }
}
