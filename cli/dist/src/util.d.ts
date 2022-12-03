import { TankApp } from '@battletank/lib';
declare class LogCapturer {
    value: undefined | object;
    write: (value: any) => void;
    getLastRecord: () => object | undefined;
}
export declare const init: (files: any, tankCount: any, arenaWidth: any, arenaHeight: any, timeProvider: Function) => {
    apps: TankApp[];
    logs: LogCapturer[];
};
export {};
