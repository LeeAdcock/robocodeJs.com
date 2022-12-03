import TankApp from '../../types/tankApp';
declare class Timer {
    func: Function | null;
    logger: any;
    interval: number;
    started: number;
    lastFired: number | null;
}
export declare class TimersContainer {
    intervalMap: Map<number, Timer>;
    timerMap: Map<number, Timer>;
}
export declare const timerTick: (apps: TankApp[], time: number) => void;
export declare const createTimerWrappers: (apps: TankApp[], appIndex: number, tankIndex: number, tankLogger: any) => {
    setIntervalWrapper: (func: any, interval: any) => number;
    clearIntervalWrapper: (timerId: any) => void;
    setTimeoutWrapper: (func: any, interval: any) => number;
    clearTimeoutWrapper: (timerId: any) => void;
};
export {};
