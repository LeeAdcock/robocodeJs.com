"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConsoleWrapper = void 0;
const browser_bunyan_1 = require("browser-bunyan");
const getTankId = (appIndex, tankIndex) => (appIndex + 1) * 10 + (tankIndex + 1);
const createConsoleWrapper = (apps, appIndex, tankIndex, buffer, writeToConsole) => {
    const app = apps[appIndex];
    const streams = [
        {
            level: 'TRACE',
            stream: buffer,
        },
    ];
    if (writeToConsole)
        streams.push({
            level: 'TRACE',
            stream: new browser_bunyan_1.ConsoleFormattedStream(),
        });
    const wrappedConsole = (0, browser_bunyan_1.createLogger)({
        name: app.name + ' <' + getTankId(appIndex, tankIndex) + '>',
        streams,
    });
    return {
        log: (msg, ...msgs) => wrappedConsole.info(msg, ...msgs),
        info: (msg, ...msgs) => wrappedConsole.info(msg, ...msgs),
        trace: (msg, ...msgs) => wrappedConsole.trace(msg, ...msgs),
        debug: (msg, ...msgs) => wrappedConsole.debug(msg, ...msgs),
        warn: (msg, ...msgs) => wrappedConsole.warn(msg, ...msgs),
        error: (msg, ...msgs) => wrappedConsole.error(msg, ...msgs),
    };
};
exports.createConsoleWrapper = createConsoleWrapper;
//# sourceMappingURL=consoleWrapper.js.map