// robocode.d.ts — TypeScript definitions for the RobocodeJs bot API.
//
// Generated from ui/src/util/botApi.ts — do not edit by hand.
// These power the in-browser editor autocomplete. Reference or copy this
// file to author bots in your own TypeScript-aware IDE with full typing.

/** A value carried by bot.send and delivered to Event.RECEIVED: a JSON
 *  primitive, or nested arrays/objects of primitives. */
type BotMessage =
  | number
  | string
  | boolean
  | null
  | BotMessage[]
  | { [key: string]: BotMessage };

/** One bot detected by a radar scan. */
interface ScanResult {
  /** Unique id of the detected bot. */
  id: string;
  /** Its speed (-5 to 5). */
  speed: number;
  /** Its body heading in degrees (absolute compass, 0 = north). */
  orientation: number;
  /** Distance from you to it. */
  distance: number;
  /** Bearing to it, relative to your heading — so bot.turret.setOrientation(angle) aims at it. */
  angle: number;
  /** True if it is on your team. */
  friendly: boolean;
  /** Its current health (0–100) — target the weakest enemy or judge a threat. */
  health: number;
}

/** Details about the sender of a received message (the second RECEIVED argument). */
interface SenderInfo {
  /** How far away the sender was when it broadcast — a range, not a bearing. The same value is given to teammates and eavesdropping enemies. */
  distance: number;
}

/** A virtual point in the arena with distance/bearing helpers, relative to the bot. */
interface Marker {
  /** The marker's x coordinate. */
  getX(): number;
  /** The marker's y coordinate. */
  getY(): number;
  /** Distance from the bot to this marker. */
  getDistance(): number;
  /** Bearing from the bot to this marker, relative to your heading (bot.turn(getBearing()) faces it). */
  getBearing(): number;
}

/** Detects bots inside its beam — the long, narrow wedge drawn under the radar in the arena (600 units far, one tank-width at the bot). Mounted on the turret, so it turns with the body and turret. Recharges between scans. */
interface Radar {
  /** Returns the radar's orientation in degrees (0–359). */
  getOrientation(): number;
  /** Sets the radar's target orientation in degrees. Resolves when reached; rejects if a later command overrides it. */
  setOrientation(degrees: number): Promise<void>;
  /** Turns the radar by the given number of degrees (positive = clockwise). */
  turn(degrees: number): Promise<void>;
  /** Turns the radar to face the arena coordinate (x, y). */
  turnTowards(x: number, y: number): Promise<void>;
  /** Returns whether the radar is currently turning. */
  isTurning(): boolean;
  /** Performs a scan, resolving with the bots detected (empty array if none). Rejects if the radar is not ready. */
  scan(): Promise<ScanResult[]>;
  /** Resolves when the radar is ready to scan again. Rejects if it scans (from elsewhere) while pending. */
  onReady(): Promise<void>;
  /** Returns whether the radar is ready to scan. */
  isReady(): boolean;
}

/** Fires bullets. Mounted on the body, so its orientation is relative to the bot's. Reloads between shots. */
interface Turret {
  /** Returns the turret's orientation in degrees (0–359). */
  getOrientation(): number;
  /** Sets the turret's target orientation in degrees. Resolves when reached; rejects if a later command overrides it. */
  setOrientation(degrees: number): Promise<void>;
  /** Turns the turret by the given number of degrees (positive = clockwise). */
  turn(degrees: number): Promise<void>;
  /** Turns the turret to face the arena coordinate (x, y). */
  turnTowards(x: number, y: number): Promise<void>;
  /** Returns whether the turret is currently turning. */
  isTurning(): boolean;
  /** Fires the turret. Resolves with `{ id }` of the bot hit, or `{}` if the bullet missed. Rejects if not ready to fire (reloading, or during the opening deployment hold). */
  fire(): Promise<{ id?: string }>;
  /** Resolves when the turret is ready to fire again. Rejects if it fires (from elsewhere) while pending. */
  onReady(): Promise<void>;
  /** Returns whether the turret is ready to fire (false while reloading, and during the opening deployment hold). */
  isReady(): boolean;
}

/** The battlefield. A square; headings are degrees on a compass (0 = north, 90 = east, 180 = south, 270 = west). */
interface Arena {
  /** Arena width. */
  getWidth(): number;
  /** Arena height. */
  getHeight(): number;
  /** Creates a marker at the arena coordinate (x, y) for distance/bearing math. */
  createMarker(x: number, y: number): Marker;
}

/** Simulation time and the TICK event. */
interface Clock {
  /** Number of ticks elapsed in the current match. */
  getTime(): number;
  /** Registers a handler for Event.TICK, run every simulation tick. */
  on(event: 'TICK', handler: () => void | Promise<unknown>): void;
}

/** Your bot: movement, radar, turret, communications, and event registration. */
interface Bot {
  /** The radar, for detecting other bots. */
  radar: Radar;
  /** The turret, for firing. */
  turret: Turret;
  /** Fires when the bot first starts, when the arena restarts, and when you reboot the app — an ordinary save does NOT re-fire it. Set up state here on `this`. */
  on(event: 'START', handler: () => void | Promise<unknown>): void;
  /** Fires after your radar scans. The handler receives the array of bots the scan detected. */
  on(event: 'SCANNED', handler: (event: ScanResult[]) => void | Promise<unknown>): void;
  /** Fires when another bot's radar sweeps over you — i.e. you have been spotted. */
  on(event: 'DETECTED', handler: () => void | Promise<unknown>): void;
  /** Fires when a bullet hits you. `angle` is the bearing the shot came from, relative to your heading. */
  on(event: 'HIT', handler: (event: { angle: number }) => void | Promise<unknown>): void;
  /** Fires when you collide with a wall or another bot (you stop). `angle` is the bearing to the thing you hit, relative to your heading (0 = dead ahead). `friendly` is `true` for a teammate and `false` for an enemy; it is `undefined` when you hit a wall. */
  on(event: 'COLLIDED', handler: (event: { angle: number; friendly?: boolean }) => void | Promise<unknown>): void;
  /** Fires when your turret fires a shot. */
  on(event: 'FIRED', handler: () => void | Promise<unknown>): void;
  /** Fires when any bot in the arena (a teammate OR an enemy) broadcasts a message via bot.send. `message` is the payload (a primitive, or nested arrays/objects of primitives); `from.distance` is how far away the sender was. */
  on(event: 'RECEIVED', handler: (message: BotMessage, from: SenderInfo) => void | Promise<unknown>): void;
  /** Returns this bot’s unique id. */
  getId(): string;
  /** Returns health from 100 (full) down to 0 (dead). */
  getHealth(): number;
  /** Current x position (0 is the left edge). */
  getX(): number;
  /** Current y position (0 is the top edge). */
  getY(): number;
  /** Body heading in degrees on a compass (0 = north, clockwise). */
  getOrientation(): number;
  /** Sets the body target orientation. Resolves when reached; rejects if overridden by a later command. */
  setOrientation(degrees: number): Promise<void>;
  /** Turns the body by the given degrees (positive = clockwise). */
  turn(degrees: number): Promise<void>;
  /** Turns the body to face the arena coordinate (x, y). */
  turnTowards(x: number, y: number): Promise<void>;
  /** Returns whether the body is currently turning. */
  isTurning(): boolean;
  /** Returns the current speed. */
  getSpeed(): number;
  /** Sets the target speed, an integer from -5 to 5. Resolves when reached; rejects if overridden. */
  setSpeed(speed: number): Promise<void>;
  /** Sets the bot's display name. */
  setName(name: string): void;
  /** Broadcasts a message to every bot in the arena — enemies included — received via Event.RECEIVED. The message can be a primitive (number, string, boolean, null) or nested arrays/objects of primitives. */
  send(message: BotMessage): void;
  /** Returns a marker at the bot's current location. */
  dropMarker(): Marker;
}

declare const bot: Bot;
declare const arena: Arena;
declare const clock: Clock;

/** Event-name constants for bot.on / clock.on. */
declare const Event: {
  START: 'START';
  TICK: 'TICK';
  SCANNED: 'SCANNED';
  DETECTED: 'DETECTED';
  HIT: 'HIT';
  COLLIDED: 'COLLIDED';
  FIRED: 'FIRED';
  RECEIVED: 'RECEIVED';
};

/** Logs to the bot console shown in the UI. Accepts any mix of arguments
 *  (strings, numbers, objects, arrays, Errors); each is formatted into the message. */
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};
/** Leveled logging to the bot console; formats objects like console.log. */
declare const logger: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  trace(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/** Runs the handler every N simulation ticks (not milliseconds).
 *  Returns -1 if the per-bot timer cap is hit (E021). */
declare function setInterval(handler: () => void, ticks: number): number;
declare function clearInterval(id: number): void;
/** Runs the handler once after N simulation ticks (not milliseconds).
 *  Returns -1 if the per-bot timer cap is hit (E021). */
declare function setTimeout(handler: () => void, ticks: number): number;
declare function clearTimeout(id: number): void;
