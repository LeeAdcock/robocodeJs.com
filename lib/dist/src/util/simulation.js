"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const event_1 = require("../types/event");
const timerWrapper_1 = require("../util/wrappers/timerWrapper");
const normalizeAngle = (x) => {
    x = x % 360;
    while (x < 0)
        x += 360;
    return x;
};
const getTankId = (appIndex, tankIndex) => (appIndex + 1) * 10 + (tankIndex + 1);
exports.default = {
    run: (time, apps, arenaWidth, arenaHeight) => {
        (0, timerWrapper_1.timerTick)(apps, time);
        apps.forEach((app, appIndex) => {
            app.tanks
                .filter(tank => tank.health > 0)
                .forEach((tank, tankIndex) => {
                if (tank.handlers[event_1.Event.TICK]) {
                    tank.handlers[event_1.Event.TICK]();
                }
                if (tank.turretLoaded < 100)
                    tank.turretLoaded += 2;
                if (tank.radarCharged < 100)
                    tank.radarCharged += 10;
            });
        });
        apps.forEach((app, appIndex) => {
            app.tanks.forEach((tank, tankIndex) => {
                if (tank.health > 0) {
                    if (tank.needsStarting === true) {
                        if (tank.handlers[event_1.Event.START]) {
                            tank.handlers[event_1.Event.START]();
                        }
                        tank.needsStarting = false;
                    }
                    tank.x = Math.min(arenaWidth - 16, tank.x);
                    tank.y = Math.min(arenaHeight - 16, tank.y);
                    const newX = tank.x + tank.speed * Math.sin(-tank.bodyOrientation * (Math.PI / 180));
                    const newY = tank.y + tank.speed * Math.cos(-tank.bodyOrientation * (Math.PI / 180));
                    let collided = false;
                    apps.forEach((otherApp, otherAppIndex) => otherApp.tanks.forEach((otherTank, otherTankIndex) => {
                        if (otherTank.health > 0 &&
                            (otherAppIndex !== appIndex || otherTankIndex !== tankIndex)) {
                            const distance = Math.sqrt(Math.pow(otherTank.x - newX, 2) + Math.pow(otherTank.y - newY, 2));
                            const angle = normalizeAngle(Math.atan2(otherTank.y - tank.y, otherTank.x - tank.x) * (180 / Math.PI) - 90);
                            if (distance < 32) {
                                collided = true;
                                tank.stats.timesCollided += 1;
                                otherTank.stats.timesCollided += 1;
                                if (tank.handlers[event_1.Event.COLLIDED]) {
                                    tank.handlers[event_1.Event.COLLIDED]({ angle, friendly: appIndex === otherAppIndex });
                                }
                                if (otherTank.handlers[event_1.Event.COLLIDED]) {
                                    otherTank.handlers[event_1.Event.COLLIDED]({
                                        angle: normalizeAngle(180 + angle),
                                        friendly: appIndex === otherAppIndex,
                                    });
                                }
                            }
                        }
                    }));
                    apps.forEach((otherApp, otherAppIndex) => otherApp.tanks.forEach((otherTank, otherTankIndex) => {
                        if (otherAppIndex !== appIndex || otherTankIndex !== tankIndex) {
                            otherTank.bullets
                                .filter(bullet => !bullet.exploded)
                                .forEach((bullet, bulletIndex, bullets) => {
                                const distance = Math.sqrt(Math.pow(bullet.x - tank.x, 2) + Math.pow(bullet.y - tank.y, 2));
                                const angle = normalizeAngle(Math.atan2(tank.y - bullet.origin.y, tank.x - bullet.origin.x) *
                                    (180 / Math.PI) -
                                    90);
                                if (distance < 32) {
                                    if (tank.handlers[event_1.Event.HIT]) {
                                        tank.handlers[event_1.Event.HIT]({ angle: normalizeAngle(angle + 180) });
                                    }
                                    tank.health -= 25;
                                    tank.stats.timesHit += 1;
                                    otherTank.stats.shotsHit += 1;
                                    bullet.exploded = true;
                                    if (bullet.callback)
                                        bullet.callback({ id: getTankId(appIndex, tankIndex) });
                                }
                            });
                        }
                    }));
                    if (newX < 16 || newX > arenaWidth - 16 || newY < 16 || newY > arenaHeight - 16) {
                        collided = true;
                        tank.stats.timesCollided += 1;
                        if (tank.handlers[event_1.Event.COLLIDED]) {
                            tank.handlers[event_1.Event.COLLIDED]({ angle: normalizeAngle(tank.bodyOrientation) });
                        }
                    }
                    if (!collided) {
                        tank.x = newX;
                        tank.y = newY;
                        tank.stats.distanceTraveled += tank.speed;
                        if (tank.speed > tank.speedTarget)
                            tank.speed -= tank.speedAcceleration;
                        if (tank.speed < tank.speedTarget)
                            tank.speed += tank.speedAcceleration;
                        if (Math.abs(tank.speed - tank.speedTarget) < tank.speedAcceleration)
                            tank.speed = tank.speedTarget;
                        tank.speed = Math.min(tank.speedMax, tank.speed);
                    }
                    else {
                        tank.speedTarget = 0;
                        tank.speed = 0;
                        tank.health -= 1;
                    }
                    const rotate = (current, target, velocity) => {
                        if (normalizeAngle(Math.abs(current - target)) < velocity)
                            return target;
                        const delta = normalizeAngle(current - target);
                        return normalizeAngle(current + (delta <= 180 ? -1 : 1) * velocity);
                    };
                    if (tank.bodyOrientation !== tank.bodyOrientationTarget) {
                        if (!tank.path)
                            tank.path = [];
                        const lastPoint = tank.path[tank.pathIndex - (1 % tank.path.length)] || {};
                        if (!lastPoint || lastPoint.x !== tank.x || lastPoint.y !== tank.y) {
                            tank.path[tank.pathIndex % tank.path.length] = { x: tank.x, y: tank.y, time };
                            tank.pathIndex = (tank.pathIndex || 0) + 1;
                        }
                    }
                    tank.bodyOrientation = rotate(tank.bodyOrientation, tank.bodyOrientationTarget, tank.bodyOrientationVelocity);
                    tank.turretOrientation = rotate(tank.turretOrientation, tank.turretOrientationTarget, tank.turretOrientationVelocity);
                    tank.radarOrientation = rotate(tank.radarOrientation, tank.radarOrientationTarget, tank.radarOrientationVelocity);
                }
                tank.bullets.forEach((bullet, bulletIndex, bullets) => {
                    if (!bullet.exploded) {
                        const newX = bullet.x + bullet.speed * Math.sin(-bullet.orientation * (Math.PI / 180));
                        const newY = bullet.y + bullet.speed * Math.cos(-bullet.orientation * (Math.PI / 180));
                        if (newX > 0 && newX < arenaWidth && newY > 0 && newY < arenaHeight) {
                            bullet.x = newX;
                            bullet.y = newY;
                        }
                        else {
                            if (bullet.callback)
                                bullet.callback({});
                            bullets.splice(bulletIndex, 1);
                        }
                    }
                });
            });
        });
    },
};
//# sourceMappingURL=simulation.js.map