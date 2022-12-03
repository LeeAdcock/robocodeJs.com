import App from '../../types/tankApp';
import { Event } from '../../types/event';
export declare const createTankWrapper: (apps: App[], appIndex: number, tankIndex: number, tankLogger: any) => {
    __raw__: import("../..").Tank;
    on: (event: Event, handler: any) => void;
    setName: (name: any) => any;
    getId: () => number;
    getHealth: () => number;
    setOrientation: (d: any) => Promise<unknown>;
    getOrientation: () => number;
    isTurning: () => boolean;
    turn: (d: any) => Promise<unknown>;
    setSpeed: (d: any) => Promise<unknown>;
    getSpeed: () => number;
    getX: () => number;
    getY: () => number;
    send: (x: number) => void;
    radar: {
        setOrientation: (d: any) => Promise<unknown>;
        getOrientation: () => number;
        isTurning: () => boolean;
        turn: (d: any) => Promise<unknown>;
        onReady: () => Promise<unknown>;
        isReady: () => boolean;
        scan: () => Promise<any[]>;
    };
    turret: {
        setOrientation: (d: any) => Promise<unknown>;
        getOrientation: () => number;
        isTurning: () => boolean;
        turn: (d: any) => Promise<unknown>;
        onReady: () => Promise<unknown>;
        isReady: () => boolean;
        fire: () => Promise<unknown>;
    };
};
