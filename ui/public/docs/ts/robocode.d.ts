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

/** One bot detected by a radar scan: a Marker pinned where that bot was at the moment of the scan. The pin does NOT follow the bot afterwards. getX/getY return that fixed position; getDistance/getBearing are measured from YOUR current position to the pin, so they change as you move, not as the target moves. To reason about where the target is heading, use getIntercept or take a fresh scan. Every reading is available both as a method (getId(), getSpeed(), …) and as a plain property, and the plain properties (including x/y/time) make a Contact serializable, so it can be broadcast with bot.send: the receiver gets the data (methods are not serialized) and rebuilds the full Contact with arena.createContact(message). */
interface Contact extends Marker {
  /** Unique id of the detected bot (same as the id property). */
  getId(): string;
  /** Its speed, -5 to 5 (same as the speed property). */
  getSpeed(): number;
  /** Its body heading in degrees, absolute compass with 0 = north (same as the orientation property). */
  getOrientation(): number;
  /** True if it is on your team (same as the friendly property). */
  isFriendly(): boolean;
  /** Its health at the moment of the scan, 0–100 (same as the health property). */
  getHealth(): number;
  /** Unique id of the detected bot. */
  id: string;
  /** Its speed (-5 to 5). */
  speed: number;
  /** Its body heading in degrees (absolute compass, 0 = north). */
  orientation: number;
  /** Distance from you to it at the moment of the scan (getDistance() re-measures from wherever you are now to the pinned scan position). */
  distance: number;
  /** Bearing to it at the moment of the scan, relative to your heading, so bot.turret.setOrientation(angle) aims at it (getBearing() re-measures from wherever you are now to the pinned scan position). */
  angle: number;
  /** True if it is on your team. */
  friendly: boolean;
  /** Its current health (0–100). Target the weakest enemy or judge a threat. */
  health: number;
  /** The clock tick when this contact was captured. Lets getIntercept (and a teammate who receives this contact via bot.send) account for how stale the reading is. */
  time: number;
  /** Where to aim (or drive) so something leaving your position at the given speed meets this bot, assuming it keeps its heading and speed. Pass bot.turret.BULLET_SPEED to lead a shot, or bot.MAX_SPEED to cut it off. Accounts for ticks elapsed since the scan. Returns null when no interception is possible. */
  getIntercept(speed: number): Marker | null;
}

/** Details about the sender of a received message (the second RECEIVED argument). */
interface SenderInfo {
  /** How far away the sender was when it broadcast: a range, not a bearing. The same value is given to teammates and eavesdropping enemies. */
  distance: number;
}

/** A virtual point in the arena with distance/bearing helpers, relative to the bot. Its x/y are plain properties, making a Marker serializable for use with bot.send (it transmits as its coordinates; methods are not serialized); a receiver rebuilds it with arena.createMarker(message.x, message.y). */
interface Marker {
  /** The marker's x coordinate (same as getX()). */
  x: number;
  /** The marker's y coordinate (same as getY()). */
  y: number;
  /** The marker's x coordinate. */
  getX(): number;
  /** The marker's y coordinate. */
  getY(): number;
  /** Distance from the bot to this marker. */
  getDistance(): number;
  /** Bearing from the bot to this marker, relative to your heading (bot.turn(getBearing()) faces it). */
  getBearing(): number;
  /** Whether this marker lies inside the arena (arena.contains of its coordinates). */
  isInBounds(): boolean;
}

/** Detects bots inside its beam: the long, narrow wedge drawn under the radar in the arena (600 feet far, one tank-width at the bot). Mounted on the turret, so it turns with the body and turret. Recharges between scans. */
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
  /** How many degrees the radar turns per clock tick. Plan how long a turn will take before committing to it. */
  TURN_RATE: number;
  /** Performs a scan, resolving with the Contacts detected (empty array if none). Rejects if the radar is not ready. */
  scan(): Promise<Contact[]>;
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
  /** How many degrees the turret turns per clock tick. Plan how long a turn will take before committing to it. */
  TURN_RATE: number;
  /** Fires the turret. Resolves with `{ id }` of the bot hit, or `{}` if the bullet missed. Rejects if not ready to fire (reloading, or during the opening deployment hold). */
  fire(): Promise<{ id?: string }>;
  /** Resolves when the turret is ready to fire again. Rejects if it fires (from elsewhere) while pending. */
  onReady(): Promise<void>;
  /** Returns whether the turret is ready to fire (false while reloading, and during the opening deployment hold). */
  isReady(): boolean;
  /** How far a bullet travels per clock tick. Divide a target’s distance by this to know the flight time when leading a shot. */
  BULLET_SPEED: number;
  /** Health an enemy loses when your bullet hits. */
  BULLET_DAMAGE: number;
}

/** The battlefield. A square; headings are degrees on a compass (0 = north, 90 = east, 180 = south, 270 = west). */
interface Arena {
  /** Arena width. */
  getWidth(): number;
  /** Arena height. */
  getHeight(): number;
  /** Creates a marker at the arena coordinate (x, y) for distance/bearing math. */
  createMarker(x: number, y: number): Marker;
  /** Rebuilds a full Contact from its serialized data, typically a contact a teammate broadcast, since a Contact serializes as its plain data properties (methods are not serialized). The result has every Contact method, measured from YOUR position: getBearing()/getDistance() are live, and getIntercept accounts for ticks elapsed since the capture time. Extra fields (id, health, friendly, …) carry through as data. A missing time means "as of now"; non-numeric x/y/speed/orientation throw. */
  createContact(data: { x: number; y: number; speed: number; orientation: number; time?: number }): Contact;
  /** Whether (x, y) lies inside the arena (0..width, 0..height, edges inclusive). */
  contains(x: number, y: number): boolean;
  /** A marker at the nearest point on the arena boundary: getDistance() is how far the wall is, getBearing() which way. Note you collide 16 feet before the wall itself. */
  getNearestWall(): Marker;
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
  /** Fires when the bot first starts, when the arena restarts, and when you reboot the app. An ordinary save does NOT re-fire it. Set up state here on `this`. */
  on(event: 'START', handler: () => void | Promise<unknown>): void;
  /** Fires after your radar scans. The handler receives the array of Contacts the scan detected, the same objects bot.radar.scan() resolves with. */
  on(event: 'SCANNED', handler: (event: Contact[]) => void | Promise<unknown>): void;
  /** Fires when another bot's radar sweeps over you: you have been spotted. */
  on(event: 'DETECTED', handler: () => void | Promise<unknown>): void;
  /** Fires when a bullet hits you. `angle` is the bearing the shot came from, relative to your heading. */
  on(event: 'HIT', handler: (event: { angle: number }) => void | Promise<unknown>): void;
  /** Fires when you collide with a wall or another bot (you stop). `angle` is the bearing to the thing you hit, relative to your heading (0 = dead ahead). `friendly` is `true` for a teammate and `false` for an enemy; it is `undefined` when you hit a wall. `impactSpeed` is how hard you drove into it (a wall: your speed toward the wall; a bot: the closing speed) — never negative, and the same value that scales the collision damage (`0.75 × impactSpeed`). It is `0` when you are only grazing — touching a wall while driving parallel to it, or a contact with nothing closing — which is a free, no-damage contact. */
  on(event: 'COLLIDED', handler: (event: { angle: number; friendly?: boolean; impactSpeed: number }) => void | Promise<unknown>): void;
  /** Fires when your turret fires a shot. */
  on(event: 'FIRED', handler: () => void | Promise<unknown>): void;
  /** Fires when any bot in the arena (a teammate OR an enemy) broadcasts a message via bot.send. `message` is the payload (a primitive, or nested arrays/objects of primitives); `from.distance` is how far away the sender was. A broadcast Contact arrives as plain data. Rebuild it with arena.createContact(message). */
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
  /** How many degrees the body turns per clock tick. */
  TURN_RATE: number;
  /** Returns the current speed. */
  getSpeed(): number;
  /** Sets the target speed, an integer from -5 to 5. Resolves when reached; rejects if overridden. */
  setSpeed(speed: number): Promise<void>;
  /** The fastest the bot can travel, in feet per clock tick. */
  MAX_SPEED: number;
  /** How much the speed changes per clock tick while moving toward the target speed, needed to judge braking distance. */
  ACCELERATION: number;
  /** The bot’s collision radius (half its width): a wall is hit when the center comes within one radius of an edge, another bot within two (each has a radius), and a bullet within one. */
  RADIUS: number;
  /** Sets the bot's display name. */
  setName(name: string): void;
  /** Broadcasts a message to every bot in the arena, enemies included, received via Event.RECEIVED. The message can be a primitive (number, string, boolean, null) or nested arrays/objects of primitives. Contacts and Markers are serializable, so they can be sent directly: what transmits is their plain data properties (methods are not serialized), and the receiver rebuilds the object with arena.createContact(message) or arena.createMarker(message.x, message.y). */
  send(message: BotMessage): void;
  /** Returns a marker at the bot's current location. Markers are serializable, so bot.send(bot.dropMarker()) is the easy way to broadcast your position. A receiver rebuilds it with arena.createMarker(message.x, message.y). */
  dropMarker(): Marker;
}

/** Back-compat alias — radar scans now resolve Contacts. */
type ScanResult = Contact;

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
