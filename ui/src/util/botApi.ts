// Single source of truth for the bot-facing API.
//
// This model drives two things that must never drift apart:
//   1. The in-editor Ace autocomplete (context-aware completions + hover docs)
//      — see `completionsFor` and `appEditor.tsx`.
//   2. The generated `public/docs/ts/robocode.d.ts` — see `generateDts` (and the
//      `botApi.test.ts` snapshot guard that keeps the committed file in sync).
//
// It is derived from the real sandbox surface compiled in
// `server/src/util/compiler.ts` and the author docs in `public/docs/dev.md`.
// When the bot API changes, edit this file and run `npm test -- -u` to refresh
// the committed `.d.ts`.

export interface ApiParam {
  name: string;
  type: string; // TypeScript type
}

export interface ApiMember {
  name: string;
  kind: 'method' | 'property';
  params?: ApiParam[];
  // For a method this is the return type; for a property, its type. A type that
  // matches an interface name (e.g. 'Radar') is treated as navigable for
  // member completion (so `bot.radar.` resolves to the Radar members).
  type: string;
  doc: string;
}

export interface ApiInterface {
  name: string;
  doc: string;
  // Base interface this one extends (rendered into the generated .d.ts).
  extends?: string;
  members: ApiMember[];
}

export interface ApiEvent {
  name: string;
  // The handler argument type, or 'void' for events that pass no payload.
  payload: string;
  // Optional full handler parameter list; overrides `payload` for events whose
  // handler takes more than one argument (e.g. RECEIVED's `(message, from)`).
  params?: string;
  // Which object registers the handler: `bot.on(...)` or `clock.on(...)`.
  channel: 'bot' | 'clock';
  doc: string;
}

export interface ApiGlobal {
  name: string;
  // Display signature shown in the completion's hover docs.
  signature: string;
  doc: string;
}

// --- The events a bot can react to ---------------------------------------

export const EVENTS: ApiEvent[] = [
  {
    name: 'START',
    payload: 'void',
    channel: 'bot',
    doc: 'Fires when the bot first starts, when the arena restarts, and when you reboot the app. An ordinary save does NOT re-fire it. Set up state here on `this`.',
  },
  {
    name: 'TICK',
    payload: 'void',
    channel: 'clock',
    doc: 'Fires every simulation tick. Register with clock.on(Event.TICK, ...). The main place to drive behaviour.',
  },
  {
    name: 'SCANNED',
    payload: 'Contact[]',
    channel: 'bot',
    doc: 'Fires after your radar scans. The handler receives the array of Contacts the scan detected, the same objects bot.radar.scan() resolves with.',
  },
  {
    name: 'DETECTED',
    payload: 'void',
    channel: 'bot',
    doc: "Fires when another bot's radar sweeps over you: you have been spotted.",
  },
  {
    name: 'HIT',
    payload: '{ angle: number }',
    channel: 'bot',
    doc: 'Fires when a bullet hits you. `angle` is the bearing the shot came from, relative to your heading.',
  },
  {
    name: 'COLLIDED',
    payload: '{ angle: number; friendly?: boolean; impactSpeed: number }',
    channel: 'bot',
    doc: 'Fires when you collide with a wall or another bot (you stop). `angle` is the bearing to the thing you hit, relative to your heading (0 = dead ahead). `friendly` is `true` for a teammate and `false` for an enemy; it is `undefined` when you hit a wall. `impactSpeed` is how hard you drove into it (a wall: your speed toward the wall; a bot: the closing speed) — never negative, and the same value that scales the collision damage (`0.75 × impactSpeed`). It is `0` when you are only grazing — touching a wall while driving parallel to it, or a contact with nothing closing — which is a free, no-damage contact.',
  },
  {
    name: 'FIRED',
    payload: 'void',
    channel: 'bot',
    doc: 'Fires when your turret fires a shot.',
  },
  {
    name: 'RECEIVED',
    payload: 'BotMessage',
    params: 'message: BotMessage, from: SenderInfo',
    channel: 'bot',
    doc: 'Fires when any bot in the arena (a teammate OR an enemy) broadcasts a message via bot.send. `message` is the payload (a primitive, or nested arrays/objects of primitives); `from.distance` is how far away the sender was. A broadcast Contact arrives as plain data. Rebuild it with arena.createContact(message).',
  },
];

// --- The objects the bot API exposes -------------------------------------

const turnable = (subject: string): ApiMember[] => [
  {
    name: 'getOrientation',
    kind: 'method',
    type: 'number',
    doc: `Returns the ${subject}'s orientation in degrees (0–359).`,
  },
  {
    name: 'setOrientation',
    kind: 'method',
    params: [{ name: 'degrees', type: 'number' }],
    type: 'Promise<void>',
    doc: `Sets the ${subject}'s target orientation in degrees. Resolves when reached; rejects if a later command overrides it.`,
  },
  {
    name: 'turn',
    kind: 'method',
    params: [{ name: 'degrees', type: 'number' }],
    type: 'Promise<void>',
    doc: `Turns the ${subject} by the given number of degrees (positive = clockwise).`,
  },
  {
    name: 'turnTowards',
    kind: 'method',
    params: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
    ],
    type: 'Promise<void>',
    doc: `Turns the ${subject} to face the arena coordinate (x, y).`,
  },
  {
    name: 'isTurning',
    kind: 'method',
    type: 'boolean',
    doc: `Returns whether the ${subject} is currently turning.`,
  },
  {
    name: 'TURN_RATE',
    kind: 'property',
    type: 'number',
    doc: `How many degrees the ${subject} turns per clock tick. Plan how long a turn will take before committing to it.`,
  },
];

export const INTERFACES: ApiInterface[] = [
  {
    name: 'Contact',
    doc: 'One bot detected by a radar scan: a Marker pinned where that bot was at the moment of the scan. The pin does NOT follow the bot afterwards. getX/getY return that fixed position; getDistance/getBearing are measured from YOUR current position to the pin, so they change as you move, not as the target moves. To reason about where the target is heading, use getIntercept or take a fresh scan. Every reading is available both as a method (getId(), getSpeed(), …) and as a plain property, and the plain properties (including x/y/time) make a Contact serializable, so it can be broadcast with bot.send: the receiver gets the data (methods are not serialized) and rebuilds the full Contact with arena.createContact(message).',
    extends: 'Marker',
    members: [
      {
        name: 'getId',
        kind: 'method',
        type: 'string',
        doc: 'Unique id of the detected bot (same as the id property).',
      },
      {
        name: 'getSpeed',
        kind: 'method',
        type: 'number',
        doc: 'Its speed, -5 to 5 (same as the speed property).',
      },
      {
        name: 'getOrientation',
        kind: 'method',
        type: 'number',
        doc: 'Its body heading in degrees, absolute compass with 0 = north (same as the orientation property).',
      },
      {
        name: 'isFriendly',
        kind: 'method',
        type: 'boolean',
        doc: 'True if it is on your team (same as the friendly property).',
      },
      {
        name: 'getHealth',
        kind: 'method',
        type: 'number',
        doc: 'Its health at the moment of the scan, 0–100 (same as the health property).',
      },
      {
        name: 'id',
        kind: 'property',
        type: 'string',
        doc: 'Unique id of the detected bot.',
      },
      {
        name: 'speed',
        kind: 'property',
        type: 'number',
        doc: 'Its speed (-5 to 5).',
      },
      {
        name: 'orientation',
        kind: 'property',
        type: 'number',
        doc: 'Its body heading in degrees (absolute compass, 0 = north).',
      },
      {
        name: 'distance',
        kind: 'property',
        type: 'number',
        doc: 'Distance from you to it at the moment of the scan (getDistance() re-measures from wherever you are now to the pinned scan position).',
      },
      {
        name: 'angle',
        kind: 'property',
        type: 'number',
        doc: 'Bearing to it at the moment of the scan, relative to your heading, so bot.turret.setOrientation(angle) aims at it (getBearing() re-measures from wherever you are now to the pinned scan position).',
      },
      {
        name: 'friendly',
        kind: 'property',
        type: 'boolean',
        doc: 'True if it is on your team.',
      },
      {
        name: 'health',
        kind: 'property',
        type: 'number',
        doc: 'Its current health (0–100). Target the weakest enemy or judge a threat.',
      },
      {
        name: 'time',
        kind: 'property',
        type: 'number',
        doc: 'The clock tick when this contact was captured. Lets getIntercept (and a teammate who receives this contact via bot.send) account for how stale the reading is.',
      },
      {
        name: 'getIntercept',
        kind: 'method',
        params: [{ name: 'speed', type: 'number' }],
        type: 'Marker | null',
        doc: 'Where to aim (or drive) so something leaving your position at the given speed meets this bot, assuming it keeps its heading and speed. Pass bot.turret.BULLET_SPEED to lead a shot, or bot.MAX_SPEED to cut it off. Accounts for ticks elapsed since the scan. Returns null when no interception is possible.',
      },
    ],
  },
  {
    name: 'SenderInfo',
    doc: 'Details about the sender of a received message (the second RECEIVED argument).',
    members: [
      {
        name: 'distance',
        kind: 'property',
        type: 'number',
        doc: 'How far away the sender was when it broadcast: a range, not a bearing. The same value is given to teammates and eavesdropping enemies.',
      },
    ],
  },
  {
    name: 'Marker',
    doc: 'A virtual point in the arena with distance/bearing helpers, relative to the bot. Its x/y are plain properties, making a Marker serializable for use with bot.send (it transmits as its coordinates; methods are not serialized); a receiver rebuilds it with arena.createMarker(message.x, message.y).',
    members: [
      {
        name: 'x',
        kind: 'property',
        type: 'number',
        doc: "The marker's x coordinate (same as getX()).",
      },
      {
        name: 'y',
        kind: 'property',
        type: 'number',
        doc: "The marker's y coordinate (same as getY()).",
      },
      {
        name: 'getX',
        kind: 'method',
        type: 'number',
        doc: "The marker's x coordinate.",
      },
      {
        name: 'getY',
        kind: 'method',
        type: 'number',
        doc: "The marker's y coordinate.",
      },
      {
        name: 'getDistance',
        kind: 'method',
        type: 'number',
        doc: 'Distance from the bot to this marker.',
      },
      {
        name: 'getBearing',
        kind: 'method',
        type: 'number',
        doc: 'Bearing from the bot to this marker, relative to your heading (bot.turn(getBearing()) faces it).',
      },
      {
        name: 'isInBounds',
        kind: 'method',
        type: 'boolean',
        doc: 'Whether this marker lies inside the arena (arena.contains of its coordinates).',
      },
    ],
  },
  {
    name: 'Radar',
    doc: 'Detects bots inside its beam: the long, narrow wedge drawn under the radar in the arena (600 feet far, one tank-width at the bot). Mounted on the turret, so it turns with the body and turret. Recharges between scans.',
    members: [
      ...turnable('radar'),
      {
        name: 'scan',
        kind: 'method',
        type: 'Promise<Contact[]>',
        doc: 'Performs a scan, resolving with the Contacts detected (empty array if none). Rejects if the radar is not ready.',
      },
      {
        name: 'onReady',
        kind: 'method',
        type: 'Promise<void>',
        doc: 'Resolves when the radar is ready to scan again. Rejects if it scans (from elsewhere) while pending.',
      },
      {
        name: 'isReady',
        kind: 'method',
        type: 'boolean',
        doc: 'Returns whether the radar is ready to scan.',
      },
    ],
  },
  {
    name: 'Turret',
    doc: "Fires bullets. Mounted on the body, so its orientation is relative to the bot's. Reloads between shots.",
    members: [
      ...turnable('turret'),
      {
        name: 'fire',
        kind: 'method',
        type: 'Promise<{ id?: string }>',
        doc: 'Fires the turret. Resolves with `{ id }` of the bot hit, or `{}` if the bullet missed. Rejects if not ready to fire (reloading, or during the opening deployment hold).',
      },
      {
        name: 'onReady',
        kind: 'method',
        type: 'Promise<void>',
        doc: 'Resolves when the turret is ready to fire again. Rejects if it fires (from elsewhere) while pending.',
      },
      {
        name: 'isReady',
        kind: 'method',
        type: 'boolean',
        doc: 'Returns whether the turret is ready to fire (false while reloading, and during the opening deployment hold).',
      },
      {
        name: 'BULLET_SPEED',
        kind: 'property',
        type: 'number',
        doc: 'How far a bullet travels per clock tick. Divide a target’s distance by this to know the flight time when leading a shot.',
      },
      {
        name: 'BULLET_DAMAGE',
        kind: 'property',
        type: 'number',
        doc: 'Health an enemy loses when your bullet hits.',
      },
    ],
  },
  {
    name: 'Arena',
    doc: 'The battlefield. A square; headings are degrees on a compass (0 = north, 90 = east, 180 = south, 270 = west).',
    members: [
      {
        name: 'getWidth',
        kind: 'method',
        type: 'number',
        doc: 'Arena width.',
      },
      {
        name: 'getHeight',
        kind: 'method',
        type: 'number',
        doc: 'Arena height.',
      },
      {
        name: 'createMarker',
        kind: 'method',
        params: [
          { name: 'x', type: 'number' },
          { name: 'y', type: 'number' },
        ],
        type: 'Marker',
        doc: 'Creates a marker at the arena coordinate (x, y) for distance/bearing math.',
      },
      {
        name: 'createContact',
        kind: 'method',
        params: [
          {
            name: 'data',
            type: '{ x: number; y: number; speed: number; orientation: number; time?: number }',
          },
        ],
        type: 'Contact',
        doc: 'Rebuilds a full Contact from its serialized data, typically a contact a teammate broadcast, since a Contact serializes as its plain data properties (methods are not serialized). The result has every Contact method, measured from YOUR position: getBearing()/getDistance() are live, and getIntercept accounts for ticks elapsed since the capture time. Extra fields (id, health, friendly, …) carry through as data. A missing time means "as of now"; non-numeric x/y/speed/orientation throw.',
      },
      {
        name: 'contains',
        kind: 'method',
        params: [
          { name: 'x', type: 'number' },
          { name: 'y', type: 'number' },
        ],
        type: 'boolean',
        doc: 'Whether (x, y) lies inside the arena (0..width, 0..height, edges inclusive).',
      },
      {
        name: 'getNearestWall',
        kind: 'method',
        type: 'Marker',
        doc: 'A marker at the nearest point on the arena boundary: getDistance() is how far the wall is, getBearing() which way. Note you collide 16 feet before the wall itself.',
      },
    ],
  },
  {
    name: 'Clock',
    doc: 'Simulation time and the TICK event.',
    members: [
      {
        name: 'getTime',
        kind: 'method',
        type: 'number',
        doc: 'Number of ticks elapsed in the current match.',
      },
      {
        name: 'on',
        kind: 'method',
        params: [
          { name: 'event', type: "'TICK'" },
          { name: 'handler', type: '() => void | Promise<unknown>' },
        ],
        type: 'void',
        doc: 'Registers a handler for Event.TICK, run every simulation tick.',
      },
    ],
  },
  {
    name: 'Bot',
    doc: 'Your bot: movement, radar, turret, communications, and event registration.',
    members: [
      {
        name: 'radar',
        kind: 'property',
        type: 'Radar',
        doc: 'The radar, for detecting other bots.',
      },
      {
        name: 'turret',
        kind: 'property',
        type: 'Turret',
        doc: 'The turret, for firing.',
      },
      {
        name: 'on',
        kind: 'method',
        params: [
          { name: 'event', type: 'string' },
          {
            name: 'handler',
            type: '(event?: unknown) => void | Promise<unknown>',
          },
        ],
        type: 'void',
        doc: 'Registers an event handler (see the Event constants). Setting a handler replaces any previous one for that event.',
      },
      {
        name: 'getId',
        kind: 'method',
        type: 'string',
        doc: 'Returns this bot’s unique id.',
      },
      {
        name: 'getHealth',
        kind: 'method',
        type: 'number',
        doc: 'Returns health from 100 (full) down to 0 (dead).',
      },
      {
        name: 'getX',
        kind: 'method',
        type: 'number',
        doc: 'Current x position (0 is the left edge).',
      },
      {
        name: 'getY',
        kind: 'method',
        type: 'number',
        doc: 'Current y position (0 is the top edge).',
      },
      {
        name: 'getOrientation',
        kind: 'method',
        type: 'number',
        doc: 'Body heading in degrees on a compass (0 = north, clockwise).',
      },
      {
        name: 'setOrientation',
        kind: 'method',
        params: [{ name: 'degrees', type: 'number' }],
        type: 'Promise<void>',
        doc: 'Sets the body target orientation. Resolves when reached; rejects if overridden by a later command.',
      },
      {
        name: 'turn',
        kind: 'method',
        params: [{ name: 'degrees', type: 'number' }],
        type: 'Promise<void>',
        doc: 'Turns the body by the given degrees (positive = clockwise).',
      },
      {
        name: 'turnTowards',
        kind: 'method',
        params: [
          { name: 'x', type: 'number' },
          { name: 'y', type: 'number' },
        ],
        type: 'Promise<void>',
        doc: 'Turns the body to face the arena coordinate (x, y).',
      },
      {
        name: 'isTurning',
        kind: 'method',
        type: 'boolean',
        doc: 'Returns whether the body is currently turning.',
      },
      {
        name: 'TURN_RATE',
        kind: 'property',
        type: 'number',
        doc: 'How many degrees the body turns per clock tick.',
      },
      {
        name: 'getSpeed',
        kind: 'method',
        type: 'number',
        doc: 'Returns the current speed.',
      },
      {
        name: 'setSpeed',
        kind: 'method',
        params: [{ name: 'speed', type: 'number' }],
        type: 'Promise<void>',
        doc: 'Sets the target speed, an integer from -5 to 5. Resolves when reached; rejects if overridden.',
      },
      {
        name: 'MAX_SPEED',
        kind: 'property',
        type: 'number',
        doc: 'The fastest the bot can travel, in feet per clock tick.',
      },
      {
        name: 'ACCELERATION',
        kind: 'property',
        type: 'number',
        doc: 'How much the speed changes per clock tick while moving toward the target speed, needed to judge braking distance.',
      },
      {
        name: 'RADIUS',
        kind: 'property',
        type: 'number',
        doc: 'The bot’s collision radius (half its width): a wall is hit when the center comes within one radius of an edge, and bots or bullets connect within two.',
      },
      {
        name: 'setName',
        kind: 'method',
        params: [{ name: 'name', type: 'string' }],
        type: 'void',
        doc: "Sets the bot's display name.",
      },
      {
        name: 'send',
        kind: 'method',
        params: [{ name: 'message', type: 'BotMessage' }],
        type: 'void',
        doc: 'Broadcasts a message to every bot in the arena, enemies included, received via Event.RECEIVED. The message can be a primitive (number, string, boolean, null) or nested arrays/objects of primitives. Contacts and Markers are serializable, so they can be sent directly: what transmits is their plain data properties (methods are not serialized), and the receiver rebuilds the object with arena.createContact(message) or arena.createMarker(message.x, message.y).',
      },
      {
        name: 'dropMarker',
        kind: 'method',
        type: 'Marker',
        doc: "Returns a marker at the bot's current location. Markers are serializable, so bot.send(bot.dropMarker()) is the easy way to broadcast your position. A receiver rebuilds it with arena.createMarker(message.x, message.y).",
      },
    ],
  },
];

// --- The top-level globals available to bot code -------------------------

export const GLOBALS: ApiGlobal[] = [
  {
    name: 'bot',
    signature: 'bot: Bot',
    doc: 'Your bot: movement, radar, turret, comms, and event registration.',
  },
  {
    name: 'arena',
    signature: 'arena: Arena',
    doc: 'The battlefield: dimensions and marker helpers.',
  },
  {
    name: 'clock',
    signature: 'clock: Clock',
    doc: 'Simulation time and the TICK event.',
  },
  {
    name: 'Event',
    signature: 'Event',
    doc: 'Event-name constants for bot.on / clock.on.',
  },
  {
    name: 'console',
    signature: 'console: { log, info, warn, error, debug }',
    doc: 'Logs to the bot console shown in the UI. Accepts any mix of arguments (strings, numbers, objects, arrays, Errors); each is formatted into the message.',
  },
  {
    name: 'logger',
    signature: 'logger: { log, info, debug, trace, warn, error }',
    doc: 'Leveled logging to the bot console. Like console.log, accepts any mix of arguments and formats objects into the message.',
  },
  {
    name: 'setInterval',
    signature: 'setInterval(handler: () => void, ticks: number): number',
    doc: 'Runs the handler every N simulation ticks (not milliseconds). Create it inside START. Returns -1 if the per-bot timer cap is hit (E021).',
  },
  {
    name: 'clearInterval',
    signature: 'clearInterval(id: number): void',
    doc: 'Cancels an interval created with setInterval.',
  },
  {
    name: 'setTimeout',
    signature: 'setTimeout(handler: () => void, ticks: number): number',
    doc: 'Runs the handler once after N simulation ticks (not milliseconds). Returns -1 if the per-bot timer cap is hit (E021).',
  },
  {
    name: 'clearTimeout',
    signature: 'clearTimeout(id: number): void',
    doc: 'Cancels a timeout created with setTimeout.',
  },
  {
    name: 'Math',
    signature: 'Math',
    doc: 'Standard JavaScript math (atan2, hypot, sqrt, …).',
  },
  {
    name: 'Promise',
    signature: 'Promise',
    doc: 'Standard JavaScript promises.',
  },
];

// --- Completion engine (consumed by appEditor.tsx) -----------------------

export interface Completion {
  caption: string;
  value: string;
  meta: string;
  score: number;
  docHTML: string;
}

const interfaceByName: Record<string, ApiInterface> = Object.fromEntries(
  INTERFACES.map((i) => [i.name, i])
);

// Map a fully-qualified object path (e.g. 'bot', 'bot.radar') to its members,
// by walking property members whose type names a known interface.
const pathMembers: Record<string, ApiMember[]> = {};
const registerPath = (path: string, ifaceName: string) => {
  const iface = interfaceByName[ifaceName];
  if (!iface) return;
  pathMembers[path] = iface.members;
  for (const m of iface.members) {
    if (m.kind === 'property' && interfaceByName[m.type]) {
      registerPath(`${path}.${m.name}`, m.type);
    }
  }
};
registerPath('bot', 'Bot');
registerPath('arena', 'Arena');
registerPath('clock', 'Clock');

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const shortSignature = (m: ApiMember): string =>
  m.kind === 'method'
    ? `${m.name}(${(m.params ?? []).map((p) => p.name).join(', ')})`
    : m.name;

const fullSignature = (basePath: string, m: ApiMember): string => {
  const qualified = `${basePath}.${m.name}`;
  if (m.kind !== 'method') return `${qualified}: ${m.type}`;
  const params = (m.params ?? []).map((p) => `${p.name}: ${p.type}`).join(', ');
  return `${qualified}(${params}): ${m.type}`;
};

const memberCompletion = (basePath: string, m: ApiMember): Completion => ({
  caption: shortSignature(m),
  value: m.name,
  meta: m.type,
  score: 1000,
  docHTML: `<b>${escapeHtml(fullSignature(basePath, m))}</b><hr>${escapeHtml(
    m.doc
  )}`,
});

const eventCompletion = (e: ApiEvent): Completion => ({
  caption: e.name,
  value: e.name,
  meta: 'event',
  score: 1000,
  docHTML: `<b>Event.${e.name}</b><hr>${escapeHtml(e.doc)}`,
});

const globalCompletion = (g: ApiGlobal): Completion => ({
  caption: g.name,
  value: g.name,
  meta: 'global',
  score: 1000,
  docHTML: `<b>${escapeHtml(g.signature)}</b><hr>${escapeHtml(g.doc)}`,
});

const startsWith = (name: string, prefix: string): boolean =>
  name.toLowerCase().startsWith(prefix.toLowerCase());

/**
 * Context-aware completions for the text up to the cursor. Returns member
 * completions after `obj.`, the Event constants after `Event.`, and the
 * top-level globals otherwise. Pure (no Ace dependency) so it can be unit tested.
 */
export function completionsFor(lineUpToCursor: string): Completion[] {
  const memberAccess = lineUpToCursor.match(
    /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/
  );
  if (memberAccess) {
    const base = memberAccess[1];
    const prefix = memberAccess[2] ?? '';
    if (base === 'Event') {
      return EVENTS.filter((e) => startsWith(e.name, prefix)).map(
        eventCompletion
      );
    }
    const members = pathMembers[base];
    if (!members) return [];
    return members
      .filter((m) => startsWith(m.name, prefix))
      .map((m) => memberCompletion(base, m));
  }

  const word = lineUpToCursor.match(/([A-Za-z_$][\w$]*)?$/)?.[1] ?? '';
  return GLOBALS.filter((g) => startsWith(g.name, word)).map(globalCompletion);
}

// --- TypeScript definition generator (-> public/robocode.d.ts) -----------

const renderMemberDts = (iface: ApiInterface, m: ApiMember): string[] => {
  // `on` is overloaded per event, so render it from the event table instead of
  // the generic member shape.
  if (iface.name === 'Bot' && m.name === 'on') {
    return EVENTS.filter((e) => e.channel === 'bot').flatMap((e) => {
      const arg =
        e.params !== undefined
          ? e.params
          : e.payload === 'void'
            ? ''
            : `event: ${e.payload}`;
      return [
        `/** ${e.doc} */`,
        `on(event: '${e.name}', handler: (${arg}) => void | Promise<unknown>): void;`,
      ];
    });
  }
  if (iface.name === 'Clock' && m.name === 'on') {
    return [
      `/** ${m.doc} */`,
      `on(event: 'TICK', handler: () => void | Promise<unknown>): void;`,
    ];
  }
  if (m.kind === 'property') {
    return [`/** ${m.doc} */`, `${m.name}: ${m.type};`];
  }
  const params = (m.params ?? []).map((p) => `${p.name}: ${p.type}`).join(', ');
  return [`/** ${m.doc} */`, `${m.name}(${params}): ${m.type};`];
};

/**
 * Generates the `robocode.d.ts` ambient declarations for the bot API. The
 * committed `public/robocode.d.ts` is this output; `botApi.test.ts` asserts they
 * match so the file can never silently drift.
 */
export function generateDts(): string {
  const lines: string[] = [
    '// robocode.d.ts — TypeScript definitions for the RobocodeJs bot API.',
    '//',
    '// Generated from ui/src/util/botApi.ts — do not edit by hand.',
    '// These power the in-browser editor autocomplete. Reference or copy this',
    '// file to author bots in your own TypeScript-aware IDE with full typing.',
    '',
    '/** A value carried by bot.send and delivered to Event.RECEIVED: a JSON',
    ' *  primitive, or nested arrays/objects of primitives. */',
    'type BotMessage =',
    '  | number',
    '  | string',
    '  | boolean',
    '  | null',
    '  | BotMessage[]',
    '  | { [key: string]: BotMessage };',
    '',
  ];

  for (const iface of INTERFACES) {
    lines.push(`/** ${iface.doc} */`);
    const heritage = iface.extends ? ` extends ${iface.extends}` : '';
    lines.push(`interface ${iface.name}${heritage} {`);
    for (const m of iface.members) {
      for (const line of renderMemberDts(iface, m)) lines.push(`  ${line}`);
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('/** Back-compat alias — radar scans now resolve Contacts. */');
  lines.push('type ScanResult = Contact;');
  lines.push('');

  lines.push('declare const bot: Bot;');
  lines.push('declare const arena: Arena;');
  lines.push('declare const clock: Clock;');
  lines.push('');
  lines.push('/** Event-name constants for bot.on / clock.on. */');
  lines.push('declare const Event: {');
  for (const e of EVENTS) lines.push(`  ${e.name}: '${e.name}';`);
  lines.push('};');
  lines.push('');
  lines.push(
    '/** Logs to the bot console shown in the UI. Accepts any mix of arguments'
  );
  lines.push(
    ' *  (strings, numbers, objects, arrays, Errors); each is formatted into the message. */'
  );
  lines.push('declare const console: {');
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    lines.push(`  ${level}(...args: unknown[]): void;`);
  }
  lines.push('};');
  lines.push(
    '/** Leveled logging to the bot console; formats objects like console.log. */'
  );
  lines.push('declare const logger: {');
  for (const level of ['log', 'info', 'debug', 'trace', 'warn', 'error']) {
    lines.push(`  ${level}(...args: unknown[]): void;`);
  }
  lines.push('};');
  lines.push('');
  lines.push(
    '/** Runs the handler every N simulation ticks (not milliseconds).'
  );
  lines.push(' *  Returns -1 if the per-bot timer cap is hit (E021). */');
  lines.push(
    'declare function setInterval(handler: () => void, ticks: number): number;'
  );
  lines.push('declare function clearInterval(id: number): void;');
  lines.push(
    '/** Runs the handler once after N simulation ticks (not milliseconds).'
  );
  lines.push(' *  Returns -1 if the per-bot timer cap is hit (E021). */');
  lines.push(
    'declare function setTimeout(handler: () => void, ticks: number): number;'
  );
  lines.push('declare function clearTimeout(id: number): void;');
  lines.push('');

  return lines.join('\n');
}
