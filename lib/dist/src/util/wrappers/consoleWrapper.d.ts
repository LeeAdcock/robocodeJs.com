import App from '../../types/tankApp';
export declare const createConsoleWrapper: (apps: App[], appIndex: number, tankIndex: number, buffer: any, writeToConsole: boolean) => {
    log: (msg: any, ...msgs: any[]) => void;
    info: (msg: any, ...msgs: any[]) => void;
    trace: (msg: any, ...msgs: any[]) => void;
    debug: (msg: any, ...msgs: any[]) => void;
    warn: (msg: any, ...msgs: any[]) => void;
    error: (msg: any, ...msgs: any[]) => void;
};
