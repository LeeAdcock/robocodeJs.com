import Environment from '../types/environment';
import Bot, { Logger } from '../types/bot';
import { ErrorCodes } from '../types/ErrorCodes';

// Hard cap on the number of live timers (setInterval + setTimeout combined) a
// single bot may hold at once. Each timer occupies a slot in the host-side maps
// below AND is scanned every tick by timerTick, so an uncapped bot could
// register enough timers to exhaust host memory or impose a permanent per-tick
// CPU tax (a firing is a host→isolate call). Registrations past the cap are
// rejected — the bot keeps running; see error code E021. Tunable via env.
export const MAX_TIMERS_PER_BOT = Number(process.env.MAX_TIMERS_PER_BOT) || 64;

/*
  This creates "monkey-patched" wrappers for the timer related
  JavaScript functions, these are provided to the user-generated
  code so that the game has the ability to pause, resume, and
  stop times the code creates.
*/

class Timer {
  func: (() => void) | null = null;
  logger!: Logger;
  interval = 0;

  started = 0;
  lastFired: number | null = 0;
}

export class TimersContainer {
  // Keyed by timer id. Accessed via bracket notation / Object.entries, so these
  // are plain records, not Maps.
  intervalMap: Record<number, Timer> = {};
  timerMap: Record<number, Timer> = {};
  // Set once we've warned the author that the timer cap was hit, so a bot that
  // spams registrations in a loop logs E021 once instead of flooding its
  // console. Cleared on reset (e.g. reboot) so a fresh run can warn again.
  overflowWarned = false;

  reset = () => {
    this.intervalMap = {};
    this.timerMap = {};
    this.overflowWarned = false;
  };

  // Combined count of live intervals + timeouts, checked against
  // MAX_TIMERS_PER_BOT before registering a new one.
  size = (): number =>
    Object.keys(this.intervalMap).length + Object.keys(this.timerMap).length;
}

export const timerTick = (env: Environment) => {
  const time = env.getTime();

  env.getProcesses().forEach((process) =>
    process.bots
      .filter((bot) => bot.health > 0)
      .forEach((bot) => {
        Object.entries(bot.timers.intervalMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - (timer.lastFired || timer.started) >= timer.interval) {
            timer.logger.trace('Triggered interval', timerId);
            timer.lastFired = time;
            if (timer.func) timer.func();
          }
        });

        Object.entries(bot.timers.timerMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - timer.started >= timer.interval) {
            timer.logger.trace('Triggered timer', timerId);
            if (timer.func) timer.func();
            timer.logger.trace('Canceled timer', timerId);
            delete bot.timers.timerMap[timerId];
          }
        });
      })
  );
};

// Create timer and interval wrapper functions for the provided bot
export const scheduleFactory = (bot: Bot) => {
  // True (and warns once) when the bot is already holding the maximum number of
  // timers, so a new registration must be refused. The isolate-side wrapper
  // treats a falsy return as "rejected" and drops its own callback entry.
  const atCapacity = (): boolean => {
    if (bot.timers.size() < MAX_TIMERS_PER_BOT) return false;
    if (!bot.timers.overflowWarned) {
      bot.timers.overflowWarned = true;
      bot.logger.warn(
        `${ErrorCodes.E021}: timer limit reached (${MAX_TIMERS_PER_BOT} active). ` +
          'Further setInterval/setTimeout calls are ignored until some are cleared.'
      );
    }
    return true;
  };

  return {
    // timerId is generated isolate-side (a per-bot sequence) and passed in, so
    // the host map and the bot's own timer table share one stable key. Returns
    // the id on success, or 0 when the per-bot timer cap is hit (rejected).
    setInterval: (
      timerId: number,
      func: () => void,
      interval: number,
      env: Environment
    ) => {
      if (atCapacity()) return 0;
      bot.logger.trace('Created interval', timerId);
      bot.timers.intervalMap[timerId] = {
        func,
        started: env.getTime(),
        interval,
        logger: bot.logger,
        lastFired: null,
      };
      return timerId;
    },

    clearInterval: (timerId: number) => {
      bot.logger.trace('Canceled interval', timerId);
      delete bot.timers.intervalMap[timerId];
    },

    setTimeout: (
      timerId: number,
      func: () => void,
      interval: number,
      env: Environment
    ) => {
      if (atCapacity()) return 0;
      bot.logger.trace('Created timer', timerId);
      const wrappedFunc = () => {
        delete bot.timers.timerMap[timerId];
        bot.logger.trace('Triggered timer', timerId);
        func();
      };
      bot.timers.timerMap[timerId] = {
        func: wrappedFunc,
        interval,
        started: env.getTime(),
        logger: bot.logger,
        lastFired: null,
      };
      return timerId;
    },

    clearTimeout: (timerId: number) => {
      bot.logger.trace('Canceled timer', timerId);
      delete bot.timers.timerMap[timerId];
    },
  };
};
