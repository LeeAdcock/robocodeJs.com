// A minimal browser-safe event emitter.
//
// App.tsx previously imported Node's built-in `events` module, which webpack
// (CRA) silently polyfilled. Vite externalizes Node built-ins for the browser,
// so that import resolves to an empty stub and `new EventEmitter()` throws at
// runtime. This drop-in covers the only methods we use: addListener,
// removeListener, and emit.

type Listener = (...args: unknown[]) => void;

export class Emitter {
  private listeners: Map<string, Set<Listener>> = new Map();

  addListener(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener);
    return this;
  }

  removeListener(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    set.forEach((listener) => listener(...args));
    return true;
  }
}
