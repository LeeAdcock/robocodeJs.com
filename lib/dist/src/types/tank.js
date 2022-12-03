"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Stats = void 0;
const point_1 = __importDefault(require("./point"));
const timerWrapper_1 = require("../util/wrappers/timerWrapper");
class Stats {
    constructor() {
        this.distanceTraveled = 0;
        this.scansCompleted = 0;
        this.scansDetected = 0;
        this.shotsFired = 0;
        this.shotsHit = 0;
        this.messagesSent = 0;
        this.messagesReceived = 0;
        this.timesCollided = 0;
        this.timesHit = 0;
        this.timesDetected = 0;
    }
}
exports.Stats = Stats;
class Tank extends point_1.default {
    constructor() {
        super(...arguments);
        this.speed = 0;
        this.speedTarget = 0;
        this.speedAcceleration = 2;
        this.speedMax = 5;
        this.bodyOrientation = 0;
        this.bodyOrientationTarget = 0;
        this.bodyOrientationVelocity = 10;
        this.turretOrientation = Math.random() * 360;
        this.turretOrientationTarget = 0;
        this.turretOrientationVelocity = 2;
        this.turretLoaded = 0;
        this.radarOrientation = Math.random() * 360;
        this.radarOrientationTarget = 0;
        this.radarOrientationVelocity = 2;
        this.radarCharged = 0;
        this.radarOn = false;
        this.needsStarting = true;
        this.handlers = {};
        this.appScope = {};
        this.bullets = [];
        this.health = 100;
        this.path = new Array(20);
        this.pathIndex = 0;
        this.stats = new Stats();
        this.timers = new timerWrapper_1.TimersContainer();
    }
}
exports.default = Tank;
//# sourceMappingURL=tank.js.map