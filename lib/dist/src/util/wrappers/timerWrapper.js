"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTimerWrappers = exports.timerTick = exports.TimersContainer = void 0;
let lastTime = 0;
class Timer {
    constructor() {
        this.func = null;
        this.interval = 0;
        this.started = 0;
        this.lastFired = 0;
    }
}
class TimersContainer {
    constructor() {
        this.intervalMap = new Map();
        this.timerMap = new Map();
    }
}
exports.TimersContainer = TimersContainer;
const timerTick = (apps, time) => {
    lastTime = time;
    apps.forEach(app => app.tanks
        .filter(tank => tank.health > 0)
        .forEach(tank => {
        Object.entries(tank.timers.intervalMap).forEach(entry => {
            const timer = entry[1];
            const timerId = parseInt(entry[0]);
            if (time - (timer.lastFired || timer.started) >= timer.interval) {
                timer.logger.trace('Triggered interval', timerId);
                timer.lastFired = time;
                if (timer.func)
                    timer.func();
            }
        });
        Object.entries(tank.timers.timerMap).forEach(entry => {
            const timer = entry[1];
            const timerId = parseInt(entry[0]);
            if (time - timer.started >= timer.interval) {
                timer.logger.trace('Triggered timer', timerId);
                if (timer.func)
                    timer.func();
                timer.logger.trace('Canceled timer', timerId);
                delete tank.timers.timerMap[timerId];
            }
        });
    }));
};
exports.timerTick = timerTick;
const createTimerWrappers = (apps, appIndex, tankIndex, tankLogger) => {
    const tank = apps[appIndex].tanks[tankIndex];
    return {
        setIntervalWrapper: (func, interval) => {
            const timerId = Math.floor(Math.random() * 100000);
            tankLogger.trace('Created interval', timerId);
            tank.timers.intervalMap[timerId] = {
                func,
                started: lastTime,
                interval,
                logger: tankLogger,
            };
            return timerId;
        },
        clearIntervalWrapper: timerId => {
            tankLogger.trace('Canceled interval', timerId);
            delete tank.timers.intervalMap[timerId];
        },
        setTimeoutWrapper: (func, interval) => {
            const timerId = Math.floor(Math.random() * 100000);
            tankLogger.trace('Created timer', timerId);
            const wrappedFunc = () => {
                delete tank.timers.timerMap[timerId];
                tankLogger.trace('Triggered timer', timerId);
                func();
            };
            tank.timers.timerMap[timerId] = {
                func: wrappedFunc,
                interval,
                started: lastTime,
                logger: tankLogger,
            };
            return timerId;
        },
        clearTimeoutWrapper: timerId => {
            tankLogger.trace('Canceled timer', timerId);
            delete tank.timers.timerMap[timerId];
        },
    };
};
exports.createTimerWrappers = createTimerWrappers;
//# sourceMappingURL=timerWrapper.js.map