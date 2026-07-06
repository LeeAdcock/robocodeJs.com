// Single source of truth for the bot-facing API.
//
// This model drives two things that must never drift apart:
//   1. The in-editor Ace autocomplete (context-aware completions + hover docs)
//      — see `completionsFor` and `appEditor.tsx`.
//   2. The generated `public/robocode.d.ts` — see `generateDts` (and the
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
  members: ApiMember[];
}

export interface ApiEvent {
  name: string;
  // The handler argument type, or 'void' for events that pass no payload.
  payload: string;
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
    doc: 'Fires once when the bot starts — and again every time you save your code. Set up state here on `this`.',
  },
  {
    name: 'TICK',
    payload: 'void',
    channel: 'clock',
    doc: 'Fires every simulation tick. Register with clock.on(Event.TICK, ...). The main place to drive behaviour.',
  },
  {
    name: 'SCANNED',
    payload: 'ScanResult[]',
    channel: 'bot',
    doc: 'Fires after your radar scans. The handler receives the array of bots the scan detected.',
  },
  {
    name: 'DETECTED',
    payload: 'void',
    channel: 'bot',
    doc: "Fires when another bot's radar sweeps over you — i.e. you have been spotted.",
  },
  {
    name: 'HIT',
    payload: '{ angle: number }',
    channel: 'bot',
    doc: 'Fires when a bullet hits you. `angle` is the bearing the shot came from, relative to your heading.',
  },
  {
    name: 'COLLIDED',
    payload: '{ angle: number; friendly: boolean }',
    channel: 'bot',
    doc: 'Fires when you collide with a wall or another bot (you stop). `angle` is relative to your heading (a wall ahead is 0); `friendly` is true for a teammate.',
  },
  {
    name: 'FIRED',
    payload: 'void',
    channel: 'bot',
    doc: 'Fires when your turret fires a shot.',
  },
  {
    name: 'RECEIVED',
    payload: 'number',
    channel: 'bot',
    doc: 'Fires when a numeric message broadcast by a teammate (via bot.send) arrives.',
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
];

export const INTERFACES: ApiInterface[] = [
  {
    name: 'ScanResult',
    doc: 'One bot detected by a radar scan.',
    members: [
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
        doc: 'Distance from you to it.',
      },
      {
        name: 'angle',
        kind: 'property',
        type: 'number',
        doc: 'Bearing to it, relative to your heading — so bot.turret.setOrientation(angle) aims at it.',
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
        doc: 'Its current health (0–100) — target the weakest enemy or judge a threat.',
      },
    ],
  },
  {
    name: 'Marker',
    doc: 'A virtual point in the arena with distance/bearing helpers, relative to the bot.',
    members: [
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
    ],
  },
  {
    name: 'Radar',
    doc: 'Detects nearby bots in the direction it points. Mounted on the turret, so it turns with the body and turret. Recharges between scans.',
    members: [
      ...turnable('radar'),
      {
        name: 'scan',
        kind: 'method',
        type: 'Promise<ScanResult[]>',
        doc: 'Performs a scan, resolving with the bots detected (empty array if none). Rejects if the radar is not ready.',
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
        doc: 'Fires the turret. Resolves with `{ id }` of the bot hit, or `{}` if the bullet missed. Rejects if not ready to fire.',
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
        doc: 'Returns whether the turret is ready to fire.',
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
    doc: 'Your tank: movement, radar, turret, communications, and event registration.',
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
        name: 'setName',
        kind: 'method',
        params: [{ name: 'name', type: 'string' }],
        type: 'void',
        doc: "Sets the bot's display name.",
      },
      {
        name: 'send',
        kind: 'method',
        params: [{ name: 'message', type: 'number' }],
        type: 'void',
        doc: 'Broadcasts a numeric message to teammates (received via Event.RECEIVED).',
      },
      {
        name: 'dropMarker',
        kind: 'method',
        type: 'Marker',
        doc: "Returns a marker at the bot's current location.",
      },
    ],
  },
];

// --- The top-level globals available to bot code -------------------------

export const GLOBALS: ApiGlobal[] = [
  {
    name: 'bot',
    signature: 'bot: Bot',
    doc: 'Your tank: movement, radar, turret, comms, and event registration.',
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
    doc: 'Runs the handler every N simulation ticks (not milliseconds). Create it inside START.',
  },
  {
    name: 'clearInterval',
    signature: 'clearInterval(id: number): void',
    doc: 'Cancels an interval created with setInterval.',
  },
  {
    name: 'setTimeout',
    signature: 'setTimeout(handler: () => void, ticks: number): number',
    doc: 'Runs the handler once after N simulation ticks (not milliseconds).',
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
      const arg = e.payload === 'void' ? '' : `event: ${e.payload}`;
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
  ];

  for (const iface of INTERFACES) {
    lines.push(`/** ${iface.doc} */`);
    lines.push(`interface ${iface.name} {`);
    for (const m of iface.members) {
      for (const line of renderMemberDts(iface, m)) lines.push(`  ${line}`);
    }
    lines.push('}');
    lines.push('');
  }

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
    '/** Runs the handler every N simulation ticks (not milliseconds). */'
  );
  lines.push(
    'declare function setInterval(handler: () => void, ticks: number): number;'
  );
  lines.push('declare function clearInterval(id: number): void;');
  lines.push(
    '/** Runs the handler once after N simulation ticks (not milliseconds). */'
  );
  lines.push(
    'declare function setTimeout(handler: () => void, ticks: number): number;'
  );
  lines.push('declare function clearTimeout(id: number): void;');
  lines.push('');

  return lines.join('\n');
}
