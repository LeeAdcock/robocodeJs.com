import { Event } from './event';
import { Orientated } from './orientated';
import Bot, { waitUntil } from './bot';
import {
  normalizeAngle,
  toApiHeading,
  toRelativeBearing,
} from '../util/geometry';

export class BotRadar implements Orientated {
  public orientation: number;
  public orientationTarget: number;
  public orientationVelocity: number;

  public charged: number;
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
    this.orientation = bot.env.random() * 360;
    this.orientationTarget = this.orientation;
    this.orientationVelocity = 4;
    this.charged = 0;
  }

  setOrientation(d: number) {
    const target = normalizeAngle(Math.round(d));
    if (target === this.orientationTarget) {
      return Promise.resolve();
    }
    this.orientationTarget = target;
    this.bot.env.emit('event', {
      type: 'radarTurn',
      time: this.bot.env.getTime(),
      id: this.bot.id,
      radarOrientationTarget: this.orientationTarget,
      radarOrientation: this.orientation,
      radarOrientationVelocity: this.orientationVelocity,
    });
    this.bot.logger.trace('Turning radar to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.bot.env,
      () => this.orientation === target % 360,
      () =>
        !this.bot.env.isRunning() || this.orientationTarget !== target % 360,
      'Radar orientation change cancelled'
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
    this.bot.env.emit('event', {
      type: 'radarTurn',
      time: this.bot.env.getTime(),
      id: this.bot.id,
      radarOrientationTarget: this.orientationTarget,
      radarOrientation: this.orientation,
      radarOrientationVelocity: this.orientationVelocity,
    });
    this.bot.logger.trace('Turning radar to ' + this.orientationTarget + '°');
    if (this.orientationTarget === this.orientation) return Promise.resolve();
    return waitUntil(
      this.bot.env,
      () => this.orientation === target,
      () =>
        !this.bot.env.isRunning() ||
        this.orientationTarget !== target ||
        this.bot.health <= 0,
      'Radar turn chancelled'
    );
  }

  onReady() {
    let peakValue = this.charged;
    return waitUntil(
      this.bot.env,
      () => this.charged >= 100,
      () => {
        // Reject if the value decreases, or bot dies
        peakValue = Math.max(peakValue, this.charged);
        return (
          !this.bot.env.isRunning() ||
          this.bot.health <= 0 ||
          this.charged < peakValue
        );
      },
      'Radar already scanned'
    );
  }

  isReady() {
    return this.charged >= 100;
  }

  scan() {
    if (this.charged < 100) return Promise.reject('Radar not ready');
    this.bot.logger.trace('Scanning');
    this.charged = 0;
    this.bot.env.emit('event', {
      type: 'radarScan',
      time: this.bot.env.getTime(),
      id: this.bot.id,
    });

    this.bot.stats.scansCompleted += 1;

    const found: Array<{
      id: string;
      speed: number;
      orientation: number;
      distance: number;
      angle: number;
      friendly: boolean;
      health: number;
    }> = [];
    this.bot.env.getProcesses().forEach((otherProcess) => {
      otherProcess.bots.forEach((otherBot) => {
        if (otherBot.health > 0 && otherBot.id !== this.bot.id) {
          const distance = Math.sqrt(
            Math.pow(otherBot.x - this.bot.x, 2) +
              Math.pow(otherBot.y - this.bot.y, 2)
          );
          const angle: number = normalizeAngle(
            Math.atan2(otherBot.y - this.bot.y, otherBot.x - this.bot.x) *
              (180 / Math.PI) -
              90
          );
          const radarAngle: number = normalizeAngle(
            this.bot.getOrientation() +
              this.bot.turret.getOrientation() +
              this.getOrientation()
          );
          if (
            distance < 300 &&
            Math.abs(normalizeAngle(angle - radarAngle + 180) - 180) <
              (500 - distance) * (0.5 / 10)
          ) {
            if (otherBot.handlers[Event.DETECTED]) {
              otherBot.handlers[Event.DETECTED]();
            }
            otherBot.stats.timesDetected += 1;
            found.push({
              id: otherBot.id,
              speed: otherBot.speed,
              // The enemy's own heading is absolute (north-zero); the bearing to
              // it is relative to our body (so turret.setOrientation(angle) aims).
              orientation: toApiHeading(otherBot.getOrientation()),
              distance,
              angle: toRelativeBearing(angle, this.bot.getOrientation()),
              friendly: otherProcess.getAppId() === this.bot.process.getAppId(),
              // The detected bot's current health (0–100), so bots can prioritize
              // the weakest enemy or judge a threat. Symmetric — every bot sees it.
              health: otherBot.health,
            });
          }
        }
      });
    });
    if (this.bot.handlers[Event.SCANNED]) {
      this.bot.handlers[Event.SCANNED](found);
    }

    this.bot.logger.trace(`Scan detected ${found.length} bots`);
    this.bot.stats.scansDetected += found.length;

    return Promise.resolve(found);
  }
}
