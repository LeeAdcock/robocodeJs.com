import Bullet from './bullet';
import Point from './point';
export declare class Stats {
    distanceTraveled: number;
    scansCompleted: number;
    scansDetected: number;
    shotsFired: number;
    shotsHit: number;
    messagesSent: number;
    messagesReceived: number;
    timesCollided: number;
    timesHit: number;
    timesDetected: number;
}
export default class Tank extends Point {
    speed: number;
    speedTarget: number;
    speedAcceleration: number;
    speedMax: number;
    bodyOrientation: number;
    bodyOrientationTarget: number;
    bodyOrientationVelocity: number;
    turretOrientation: number;
    turretOrientationTarget: number;
    turretOrientationVelocity: number;
    turretLoaded: number;
    radarOrientation: number;
    radarOrientationTarget: number;
    radarOrientationVelocity: number;
    radarCharged: number;
    radarOn: boolean;
    needsStarting: boolean;
    handlers: any;
    appScope: any;
    bullets: Bullet[];
    health: number;
    path: Point[];
    pathIndex: number;
    stats: any;
    timers: any;
}
