"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const event_1 = require("../types/event");
const timerWrapper_1 = require("./wrappers/timerWrapper");
const consoleWrapper_1 = require("./wrappers/consoleWrapper");
const tankWrapper_1 = require("./wrappers/tankWrapper");
const arenaWrapper_1 = require("./wrappers/arenaWrapper");
exports.default = {
    compile: (apps, appIndex, tankIndex, arenaWidthProvider, arenaHeightProvider, buffer, writeToConsole, timeProvider) => {
        const app = apps[appIndex];
        const tank = app.tanks[tankIndex];
        const consoleWrapper = (0, consoleWrapper_1.createConsoleWrapper)(apps, appIndex, tankIndex, buffer, writeToConsole);
        const arenaWrapper = (0, arenaWrapper_1.createArenaWrapper)(arenaHeightProvider, arenaWidthProvider);
        const tankWrapper = (0, tankWrapper_1.createTankWrapper)(apps, appIndex, tankIndex, consoleWrapper);
        const clockWrapper = {
            getTime: timeProvider,
            on: (event, handler) => {
                if (event === event_1.Event.TICK)
                    tankWrapper.on(event, handler);
            },
        };
        const { setTimeoutWrapper, clearTimeoutWrapper, setIntervalWrapper, clearIntervalWrapper } = (0, timerWrapper_1.createTimerWrappers)(apps, appIndex, tankIndex, consoleWrapper);
        try {
            tank.handlers = {};
            new Function('clock', 'Math', 'bot', 'arena', 'Event', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'with({document:undefined, window:undefined}){' + app.source + '}').bind(tank.appScope)(clockWrapper, Math, tankWrapper, arenaWrapper, event_1.Event, consoleWrapper, setTimeoutWrapper, clearTimeoutWrapper, setIntervalWrapper, clearIntervalWrapper);
        }
        catch (e) {
            consoleWrapper.error(e);
        }
    },
};
//# sourceMappingURL=compiler.js.map