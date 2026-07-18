import Bullet, { BULLET_SPEED } from './bullet';
import { randomUUID } from 'node:crypto';
import { Event } from './event';
import { Orientated } from './orientated';
import Bot, { commandBudgetRejected, finiteArg, waitUntil } from './bot';
import { normalizeAngle } from '../util/geometry';
import { BotRadar } from './botRadar';
import { DEPLOY_TICKS } from './environment';

// Degrees the turret turns per tick (seeds the per-instance runtime field and
// is mirrored into the sandbox as the bot.turret.TURN_RATE attribute), and
// reload progress added per tick toward the 100 full-charge threshold.
export const TURRET_TURN_SPEED = 4;
export const TURRET_RELOAD_RATE = 2.5;

export class BotTurret implements Orientated {
  public orientation: number;
  public orientationTarget: number;
  public orientationVelocity: number;
  public radar: BotRadar;
  public loaded: number;
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
    this.orientation = bot.env.random() * 360;
    this.orientationTarget = this.orientation;
    this.orientationVelocity = TURRET_TURN_SPEED;
    this.radar = new BotRadar(bot);
    this.loaded = 0;
  }

  setOrientation(d: number) {
    if (!this.bot.chargeCommandBudget()) return commandBudgetRejected();
    const n = finiteArg(d);
    if (n === null) {
      this.bot.logger.trace(
        'Ignoring non-finite turret setOrientation argument'
      );
      return Promise.resolve();
    }
    const target = normalizeAngle(Math.round(n));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.bot.env.emit('event', {
      type: 'turretTurn',
      time: this.bot.env.getTime(),
      id: this.bot.id,
      turretOrientationTarget: this.orientationTarget,
      turretOrientation: this.orientation,
      turretOrientationVelocity: this.orientationVelocity,
    });
    this.bot.logger.trace('Turning turret to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.bot.env,
      () => this.orientation === target % 360,
      () =>
        !this.bot.env.isRunning() ||
        this.orientationTarget !== target % 360 ||
        this.bot.health <= 0,
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
    if (!this.bot.chargeCommandBudget()) return commandBudgetRejected();
    const n = finiteArg(d);
    if (n === null) {
      this.bot.logger.trace('Ignoring non-finite turret turn argument');
      return Promise.resolve();
    }
    const target = normalizeAngle(Math.round(this.orientation + n));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.bot.env.emit('event', {
      type: 'turretTurn',
      time: this.bot.env.getTime(),
      id: this.bot.id,
      turretOrientationTarget: this.orientationTarget,
      turretOrientation: this.orientation,
      turretOrientationVelocity: this.orientationVelocity,
    });
    this.bot.logger.trace('Turning turret to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.bot.env,
      () => this.orientation === target,
      () =>
        !this.bot.env.isRunning() ||
        this.orientationTarget !== target ||
        this.bot.health <= 0,
      'Turret turn cancelled'
    );
  }

  // The turret is weapons-held during the opening deployment window
  // (DEPLOY_TICKS): reload still progresses, but the gun reads "not ready" so no
  // shot fires until combat opens. This replaces per-bullet damage suppression —
  // there are simply no bullets during warm-up — and reuses the reload/readiness
  // contract bots already handle. Radar (scanning/aiming) is unaffected.
  private deployed = () => this.bot.env.getTime() >= DEPLOY_TICKS;

  onReady() {
    if (!this.bot.chargeCommandBudget()) return commandBudgetRejected();
    let peakValue = this.loaded;
    return waitUntil(
      this.bot.env,
      () => this.loaded >= 100 && this.deployed(),
      () => {
        // Reject if the value decreases, or bot dies
        peakValue = Math.max(peakValue, this.loaded);
        return (
          !this.bot.env.isRunning() ||
          this.bot.health <= 0 ||
          this.loaded < peakValue
        );
      },
      'Turret already fired'
    );
  }

  isReady() {
    return this.loaded >= 100 && this.deployed();
  }

  fire() {
    if (!this.bot.chargeCommandBudget()) return commandBudgetRejected();
    if (this.loaded < 100 || !this.deployed())
      return Promise.reject('Turret not ready');
    this.bot.logger.trace('Turret firing');

    this.bot.stats.shotsFired += 1;

    if (this.bot.handlers[Event.FIRED]) {
      this.bot.handlers[Event.FIRED]();
    }

    const bullet: Bullet = {
      id: randomUUID(),
      exploded: false,
      x: this.bot.x,
      y: this.bot.y,
      origin: {
        x: this.bot.x,
        y: this.bot.y,
      },
      orientation: this.bot.getOrientation() + this.orientation,
      speed: BULLET_SPEED,
    };
    this.bot.bullets.push(bullet);
    this.loaded = 0;

    this.bot.env.emit('event', {
      type: 'bulletFired',
      time: this.bot.env.getTime(),
      id: bullet.id,
      botId: this.bot.id,
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
