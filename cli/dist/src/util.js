"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = void 0;
const lib_1 = require("@battletank/lib");
const fs = __importStar(require("fs"));
class LogCapturer {
    constructor() {
        this.write = value => {
            this.value = value;
        };
        this.getLastRecord = () => this.value;
    }
}
const init = (files, tankCount, arenaWidth, arenaHeight, timeProvider) => {
    const apps = [];
    const logs = [];
    for (let appIndex = 0; appIndex < files.length; appIndex++) {
        const app = new lib_1.TankApp();
        app.name = appIndex.toString();
        apps.push(app);
        const logCapturer = new LogCapturer();
        logs.push(logCapturer);
        app.source = fs.readFileSync(files[appIndex], 'utf8');
        app.recompile = true;
        app.tanks = new Array();
        for (let tankIndex = 0; tankIndex < tankCount; tankIndex++) {
            const tank = new lib_1.Tank();
            app.tanks.push(tank);
            let overallClosestTank = null;
            do {
                tank.x = 16 + (arenaWidth - 32) * Math.random();
                tank.y = 16 + (arenaHeight - 32) * Math.random();
                overallClosestTank = apps.reduce((closestDistanceForTankApp, curTankApp, curTankAppIndex) => {
                    const closestTankForThisTankApp = curTankApp.tanks.reduce((closestDistanceForTank, curTank, curTankIndex) => {
                        if (curTankAppIndex === appIndex && curTankIndex === tankIndex)
                            return closestDistanceForTank;
                        const curTankDistance = Math.sqrt(Math.pow(curTank.x - tank.x, 2) + Math.pow(curTank.y - tank.y, 2));
                        return !closestDistanceForTank
                            ? curTankDistance
                            : Math.min(closestDistanceForTank, curTankDistance);
                    }, null);
                    if (!closestDistanceForTankApp)
                        return closestTankForThisTankApp;
                    if (!closestTankForThisTankApp)
                        return closestDistanceForTankApp;
                    return Math.min(closestDistanceForTankApp, closestTankForThisTankApp);
                }, null);
            } while (overallClosestTank !== null && overallClosestTank < 50);
            tank.bodyOrientation = Math.random() * 360;
            tank.bodyOrientationTarget = tank.bodyOrientation;
            tank.turretOrientation = Math.random() * 360;
            tank.turretOrientationTarget = tank.turretOrientation;
            tank.radarOrientation = Math.random() * 360;
            tank.radarOrientationTarget = tank.radarOrientation;
            tank.health = 100;
            tank.turretLoaded = 0;
            tank.radarCharged = 0;
            tank.speed = 0;
            tank.needsStarting = true;
            lib_1.Compiler.compile(apps, appIndex, tankIndex, () => arenaWidth, () => arenaHeight, logCapturer, false, timeProvider);
        }
    }
    return { apps, logs };
};
exports.init = init;
//# sourceMappingURL=util.js.map