import Environment from '../types/environment';
import Tank, { Logger } from '../types/tank';

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

  reset = () => {
    this.intervalMap = {};
    this.timerMap = {};
  };
}

export const timerTick = (env: Environment) => {
  const time = env.getTime();

  env.getProcesses().forEach((process) =>
    process.tanks
      .filter((tank) => tank.health > 0)
      .forEach((tank) => {
        Object.entries(tank.timers.intervalMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - (timer.lastFired || timer.started) >= timer.interval) {
            timer.logger.trace('Triggered interval', timerId);
            timer.lastFired = time;
            if (timer.func) timer.func();
          }
        });

        Object.entries(tank.timers.timerMap).forEach((entry) => {
          const timer: Timer = entry[1] as Timer;
          const timerId: number = parseInt(entry[0]);
          if (time - timer.started >= timer.interval) {
            timer.logger.trace('Triggered timer', timerId);
            if (timer.func) timer.func();
            timer.logger.trace('Canceled timer', timerId);
            delete tank.timers.timerMap[timerId];
          }
        });
      })
  );
};

// Create timer and interval wrapper functions for the provided tank
export const scheduleFactory = (tank: Tank) => {
  return {
    // timerId is generated isolate-side (a per-tank sequence) and passed in, so
    // the host map and the bot's own timer table share one stable key.
    setInterval: (
      timerId: number,
      func: () => void,
      interval: number,
      env: Environment
    ) => {
      tank.logger.trace('Created interval', timerId);
      tank.timers.intervalMap[timerId] = {
        func,
        started: env.getTime(),
        interval,
        logger: tank.logger,
        lastFired: null,
      };
      return timerId;
    },

    clearInterval: (timerId: number) => {
      tank.logger.trace('Canceled interval', timerId);
      delete tank.timers.intervalMap[timerId];
    },

    setTimeout: (
      timerId: number,
      func: () => void,
      interval: number,
      env: Environment
    ) => {
      tank.logger.trace('Created timer', timerId);
      const wrappedFunc = () => {
        delete tank.timers.timerMap[timerId];
        tank.logger.trace('Triggered timer', timerId);
        func();
      };
      tank.timers.timerMap[timerId] = {
        func: wrappedFunc,
        interval,
        started: env.getTime(),
        logger: tank.logger,
        lastFired: null,
      };
      return timerId;
    },

    clearTimeout: (timerId: number) => {
      tank.logger.trace('Canceled timer', timerId);
      delete tank.timers.timerMap[timerId];
    },
  };
};
