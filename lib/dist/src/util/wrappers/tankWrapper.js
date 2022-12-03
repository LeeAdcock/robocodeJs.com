"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTankWrapper = void 0;
const bullet_1 = __importDefault(require("../../types/bullet"));
const event_1 = require("../../types/event");
const normalizeAngle = (x) => {
    x = x % 360;
    while (x < 0)
        x += 360;
    return Math.floor(x);
};
const getTankId = (appIndex, tankIndex) => (appIndex + 1) * 10 + (tankIndex + 1);
const waitUntil = (successCondition, failureCondition = null, msg = null) => new Promise(function (resolve, reject) {
    ;
    (function waitForFoo() {
        if (successCondition())
            return resolve(null);
        if (failureCondition && failureCondition())
            return reject(msg);
        setTimeout(waitForFoo, 50);
    })();
});
const createTankWrapper = (apps, appIndex, tankIndex, tankLogger) => {
    const app = apps[appIndex];
    const tank = apps[appIndex].tanks[tankIndex];
    const tankWrapper = {
        __raw__: tank,
        on: (event, handler) => {
            if (!Object.keys(event_1.Event).includes(event))
                throw new Error('Invalid event type.');
            const eventPromiseMap = new Map();
            tank.handlers[event] = x => eventPromiseMap.get(event)
                ? undefined
                : setTimeout(() => {
                    try {
                        if (event !== event_1.Event.TICK) {
                            if (x)
                                tankLogger.trace("Called event handler '" + event + "' with ", x);
                            else
                                tankLogger.trace("Called event handler '" + event + "'");
                        }
                        const startTime = new Date();
                        const result = handler(x);
                        if (result) {
                            eventPromiseMap.set(event, result);
                            result
                                .then(() => eventPromiseMap.delete(event))
                                .catch(e => {
                                tankLogger.warn(e);
                                eventPromiseMap.delete(event);
                            });
                        }
                        const endTime = new Date();
                        const duration = endTime.getTime() - startTime.getTime();
                        if (duration > 25)
                            tankLogger.warn('Handler ' + event + ' took a long time');
                    }
                    catch (e) {
                        tankLogger.error(e);
                    }
                }, 0);
        },
        setName: name => (app.name = name),
        getId: () => getTankId(appIndex, tankIndex),
        getHealth: () => tank.health / 100,
        setOrientation: d => {
            const target = normalizeAngle(d);
            tank.bodyOrientationTarget = target;
            tankLogger.trace('Turning to ' + tank.bodyOrientationTarget + '°');
            if (tank.bodyOrientationTarget === tank.bodyOrientation)
                return Promise.resolve();
            return waitUntil(() => tank.bodyOrientation === target, () => tank.bodyOrientationTarget !== target || tank.health <= 0, 'Orientation change cancelled');
        },
        getOrientation: () => normalizeAngle(tank.bodyOrientation),
        isTurning: () => tank.bodyOrientation !== tank.bodyOrientationTarget,
        turn: d => {
            const target = normalizeAngle(tank.bodyOrientation + d);
            tank.bodyOrientationTarget = target;
            tankLogger.trace('Turning to ' + tank.bodyOrientationTarget + '°');
            if (tank.bodyOrientationTarget === tank.bodyOrientation)
                return Promise.resolve();
            return waitUntil(() => tank.bodyOrientation === target, () => tank.bodyOrientationTarget !== target || tank.health <= 0, 'Turn cancelled');
        },
        setSpeed: d => {
            tank.speedTarget = Math.min(d, tank.speedMax);
            tankLogger.trace(d === 0 ? 'Stopping' : 'Accelerating to ' + tank.speedTarget);
            return waitUntil(() => tank.speed === Math.min(d, tank.speedMax), () => tank.speedTarget !== Math.min(d, tank.speedMax) || tank.health <= 0, 'Speed change cancelled');
        },
        getSpeed: () => tank.speed,
        getX: () => tank.x,
        getY: () => tank.y,
        send: (x) => {
            if (!Number.isInteger(x)) {
                throw new Error('Must be numeric');
            }
            tankLogger.trace('Sending message "' + x + '"');
            tank.stats.messagesSent += 1;
            apps.forEach((otherApp, otherAppIndex) => {
                otherApp.tanks
                    .filter(otherTank => tank.health > 0)
                    .forEach((otherTank, otherTankIndex) => {
                    if (otherAppIndex !== appIndex || otherTankIndex !== tankIndex) {
                        otherTank.stats.messagesReceived += 1;
                        if (otherTank.handlers[event_1.Event.RECEIVED]) {
                            otherTank.handlers[event_1.Event.RECEIVED](x);
                        }
                    }
                });
            });
        },
        radar: {
            setOrientation: d => {
                const target = normalizeAngle(d);
                tank.radarOrientationTarget = target;
                tankLogger.trace('Turning radar to ' + tank.radarOrientationTarget + '°');
                if (tank.radarOrientationTarget === tank.radarOrientation)
                    return Promise.resolve();
                return waitUntil(() => tank.radarOrientation === target % 360, () => tank.radarOrientationTarget !== target % 360, 'Radar orientation change cancelled');
            },
            getOrientation: () => normalizeAngle(tank.radarOrientation),
            isTurning: () => tank.radarOrientation !== tank.radarOrientationTarget,
            turn: d => {
                const target = normalizeAngle(tank.radarOrientation + d);
                tank.radarOrientationTarget = target;
                tankLogger.trace('Turning radar to ' + tank.radarOrientationTarget + '°');
                if (tank.radarOrientationTarget === tank.radarOrientation)
                    return Promise.resolve();
                return waitUntil(() => tank.radarOrientation === target, () => tank.radarOrientationTarget !== target || tank.health <= 0, 'Radar turn chancelled');
            },
            onReady: () => {
                let peakValue = tank.radarCharged;
                return waitUntil(() => tank.radarCharged >= 100, () => {
                    peakValue = Math.max(peakValue, tank.radarCharged);
                    return tank.health <= 0 || tank.radarCharged < peakValue;
                }, 'Radar already scanned');
            },
            isReady: () => tank.radarCharged >= 100,
            scan: () => {
                if (tank.radarCharged < 100)
                    return Promise.reject('Radar not ready');
                tankLogger.trace('Scanning');
                tank.radarCharged = 0;
                tank.radarOn = true;
                setTimeout(() => (tank.radarOn = false), 100);
                tank.stats.scansCompleted += 1;
                const found = [];
                apps.forEach((otherApp, otherAppIndex) => {
                    otherApp.tanks.forEach((otherTank, otherTankIndex) => {
                        if (otherTank.health > 0 &&
                            (otherAppIndex !== appIndex || otherTankIndex !== tankIndex)) {
                            const distance = Math.sqrt(Math.pow(otherTank.x - tank.x, 2) + Math.pow(otherTank.y - tank.y, 2));
                            const angle = normalizeAngle(Math.atan2(otherTank.y - tank.y, otherTank.x - tank.x) * (180 / Math.PI) - 90);
                            const radarAngle = normalizeAngle(tank.bodyOrientation + tank.turretOrientation + tank.radarOrientation);
                            if (distance < 300 &&
                                Math.abs(normalizeAngle(angle - radarAngle + 180) - 180) <
                                    (500 - distance) * (0.5 / 10)) {
                                if (otherTank.handlers[event_1.Event.DETECTED]) {
                                    otherTank.handlers[event_1.Event.DETECTED]();
                                }
                                otherTank.stats.timesDetected += 1;
                                found.push({
                                    id: getTankId(otherAppIndex, otherTankIndex),
                                    speed: otherTank.speed,
                                    orientation: otherTank.bodyOrientation,
                                    distance,
                                    angle,
                                    friendly: appIndex === otherAppIndex,
                                });
                            }
                        }
                    });
                });
                if (tank.handlers[event_1.Event.SCANNED]) {
                    tank.handlers[event_1.Event.SCANNED](found);
                }
                tankLogger.trace(`Scan detected ${found.length} bots`);
                tank.stats.scansDetected += found.length;
                return Promise.resolve(found);
            },
        },
        turret: {
            setOrientation: d => {
                const target = normalizeAngle(d);
                tank.turretOrientationTarget = normalizeAngle(d);
                tankLogger.trace('Turning turret to ' + tank.turretOrientationTarget + '°');
                if (tank.turretOrientationTarget === tank.turretOrientation)
                    return Promise.resolve();
                return waitUntil(() => tank.turretOrientation === target % 360, () => tank.turretOrientationTarget !== target % 360 || tank.health <= 0, 'Turret orientation change cancelled');
            },
            getOrientation: () => normalizeAngle(tank.turretOrientation),
            isTurning: () => tank.turretOrientation !== tank.turretOrientationTarget,
            turn: d => {
                const target = normalizeAngle(tank.turretOrientation + d);
                tank.turretOrientationTarget = target;
                tankLogger.trace('Turning turret to ' + tank.turretOrientationTarget + '°');
                if (tank.turretOrientationTarget === tank.turretOrientation)
                    return Promise.resolve();
                return waitUntil(() => tank.turretOrientation === target, () => tank.turretOrientationTarget !== target || tank.health <= 0, 'Turret turn cancelled');
            },
            onReady: () => {
                let peakValue = tank.turretLoaded;
                return waitUntil(() => tank.turretLoaded >= 100, () => {
                    peakValue = Math.max(peakValue, tank.turretLoaded);
                    return tank.health <= 0 || tank.turretLoaded < peakValue;
                }, 'Turret already fired');
            },
            isReady: () => tank.turretLoaded >= 100,
            fire: () => {
                if (tank.turretLoaded < 100)
                    return Promise.reject('Turret not ready');
                tankLogger.trace('Turret firing');
                tank.stats.shotsFired += 1;
                if (tank.handlers[event_1.Event.FIRED]) {
                    tank.handlers[event_1.Event.FIRED]();
                }
                const bullet = new bullet_1.default();
                bullet.x = tank.x;
                bullet.y = tank.y;
                bullet.origin.x = tank.x;
                bullet.origin.y = tank.y;
                bullet.orientation = tank.bodyOrientation + tank.turretOrientation;
                tank.bullets.push(bullet);
                tank.turretLoaded = 0;
                return new Promise(resolve => {
                    bullet.callback = resolve;
                });
            },
        },
    };
    return tankWrapper;
};
exports.createTankWrapper = createTankWrapper;
//# sourceMappingURL=tankWrapper.js.map