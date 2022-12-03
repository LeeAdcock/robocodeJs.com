#! /usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs_1 = __importDefault(require("yargs"));
const cli_progress_1 = __importDefault(require("cli-progress"));
const helpers_1 = require("yargs/helpers");
const colors_1 = __importDefault(require("colors"));
const lib_1 = require("@battletank/lib");
const fs_1 = __importDefault(require("fs"));
const util_1 = require("./util");
process.on('unhandledRejection', (reason, promise) => {
});
const argv = (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .option('botCount', {
    alias: 'b',
    type: 'number',
    default: 5,
    description: 'number of bots for each app',
})
    .option('mode', {
    alias: 'm',
    type: 'string',
    default: 'laststanding',
    choices: ['laststanding', 'knockout'],
    description: 'conditions for game completion',
})
    .option('arenaWidth', {
    alias: 'w',
    type: 'number',
    default: 750,
    description: 'arena width',
})
    .option('arenaHeight', {
    alias: 'h',
    type: 'number',
    default: 750,
    description: 'arena height',
})
    .option('file', {
    alias: 'f',
    array: true,
    type: 'string',
    demandOption: true,
    description: 'path to bot js file or directory of files',
})
    .option('battleCount', {
    alias: 'b',
    default: 1,
    type: 'number',
    description: 'number of battles',
})
    .option('appsInArena', {
    alias: 'a',
    type: 'number',
    description: 'number of apps in the arena at one time',
    default: 'all',
})
    .option('slowDeathTime', {
    alias: 's',
    type: 'number',
    description: 'number of clock ticks before slow death begins',
    default: '10000',
}).argv;
const files = Array.isArray(argv.file) ? argv.file : [argv.file];
const mode = argv.mode;
const botCount = argv.botCount;
const arenaWidth = argv.arenaWidth;
const arenaHeight = argv.arenaHeight;
const battleCount = argv.battleCount;
const slowDeathTime = argv.slowDeathTime;
files.forEach((directory, directoryIndex) => {
    if (fs_1.default.lstatSync(directory).isDirectory()) {
        fs_1.default.readdirSync(directory).forEach(file => {
            if (file.endsWith('.js')) {
                files.push(directory + '/' + file);
            }
        });
        files.splice(directoryIndex, 1);
    }
});
const appsInArena = argv.appsInArena === 'all' ? files.length : argv.appsInArena;
const simulate = (apps, bars, multibar, logs, clock, resolve) => {
    lib_1.Simulation.run(clock.time, apps, arenaWidth, arenaHeight);
    clock.time = clock.time + 1;
    if (clock.time > slowDeathTime && clock.time % 50 === 0) {
        apps.forEach(app => {
            app.tanks
                .filter(tank => tank.health > 0)
                .forEach(tank => {
                tank.health = Math.max(0, tank.health - 1);
            });
        });
    }
    const appHealth = apps.map(app => app.tanks.reduce((sum, tank) => sum + tank.health, 0) / (app.tanks.length * 100));
    appHealth
        .filter((health, index) => bars[index].isActive)
        .forEach((health, index) => bars[index].update(health * 100, {
        index: index + 1,
        name: (apps[index].name || '').padEnd(20, ' '),
        health: Math.max(0, Math.ceil(health * 100))
            .toString()
            .padStart(3, ' '),
        log: health <= 0 ? colors_1.default.red('Dead') : (logs[index].getLastRecord() || {})['msg'],
    }));
    if (appHealth.filter(item => item > 0).length === 0) {
        appHealth
            .filter((health, index) => bars[index].isActive)
            .forEach((health, index) => bars[index].update(health * 100, {
            log: health > 0 ? colors_1.default.green('Winner') : colors_1.default.red('Dead'),
        }));
        multibar.stop();
        resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })));
        return;
    }
    switch (mode) {
        case 'knockout':
            if (appHealth.some(item => item <= 0)) {
                appHealth
                    .filter((health, index) => bars[index].isActive)
                    .forEach((health, index) => bars[index].update(health * 100, {
                    log: health > 0 ? colors_1.default.green('Winner') : colors_1.default.red('Dead'),
                }));
                multibar.stop();
                resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })));
            }
            else
                setTimeout(simulate, 0, apps, bars, multibar, logs, clock, resolve);
            break;
        case 'laststanding':
            if (appHealth.filter(item => item > 0).length <= 1) {
                appHealth
                    .filter((health, index) => bars[index].isActive)
                    .forEach((health, index) => bars[index].update(health * 100, {
                    log: health > 0 ? colors_1.default.green('Winner') : colors_1.default.red('Dead'),
                }));
                multibar.stop();
                resolve(apps.map((app, index) => ({ name: app.name, health: appHealth[index] })));
            }
            else
                setTimeout(simulate, 0, apps, bars, multibar, logs, clock, resolve);
            break;
        default:
    }
};
function* subsets(array, offset = 0) {
    while (offset < array.length) {
        const first = array[offset++];
        for (const subset of subsets(array, offset)) {
            subset.push(first);
            yield subset;
        }
    }
    yield [];
}
const games = Array.from(subsets(files)).filter(game => game.length === appsInArena);
games.forEach(game => {
    for (let i = 1; i < battleCount; i++)
        games.push(game);
});
games.sort();
const results = [];
const run = () => new Promise(res => {
    const game = games.shift();
    if (game === undefined) {
        return res();
    }
    const multibar = new cli_progress_1.default.MultiBar({
        fps: 4,
        format: '{index}] {name} {health}% [{bar}] {log}',
    }, cli_progress_1.default.Presets.shades_grey);
    const clock = { time: 0 };
    const { apps, logs } = (0, util_1.init)(game, botCount, arenaWidth, arenaHeight, () => clock.time);
    const bars = apps.map(app => multibar.create(100, 100));
    return new Promise(resolve => simulate(apps, bars, multibar, logs, clock, resolve))
        .then(result => {
        results.push(result);
        return run();
    })
        .then(res);
});
run().then(() => {
    const final = {};
    results.forEach(result => {
        result
            .sort((a, b) => a.health - b.health)
            .forEach((app, index) => {
            final[app.name] = (final[app.name] || 0) + (app.health > 0 ? index : 0);
        });
    });
    Object.keys(final).sort((a, b) => final[b] - final[a]).forEach((app, index) => {
        console.log(index + 1 + ".", app, final[app]);
    });
    process.exit();
});
//# sourceMappingURL=cli.js.map