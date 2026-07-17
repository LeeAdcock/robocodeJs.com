// Glossary of RobocodeJs domain concepts used across the lessons and docs,
// aimed at readers who already program but are new to the game — so game
// mechanics and simulation semantics, not general programming vocabulary.
// MarkdownPage auto-detects these terms in rendered prose and wraps the
// first occurrence per page in a definition tooltip (see components/
// glossaryTerm.tsx). Matching is case-insensitive; plurals and synonyms are
// listed as explicit aliases rather than inferred. If a term proves noisy in
// prose, drop it from this list rather than adding matching machinery.

export interface GlossaryEntry {
  /** Canonical form, lowercase; also the seen-set key and tooltip id slug. */
  term: string;
  /** One short plain-text sentence, rendered inside the tooltip. */
  definition: string;
  /** Extra matchable forms: plurals and synonyms. */
  aliases?: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'event',
    aliases: ['events'],
    definition:
      'A game occurrence — a scan result, collision, or bullet hit — delivered to the handler your bot registers for it.',
  },
  {
    term: 'handler',
    aliases: ['handlers'],
    definition:
      'A callback registered for a game event; the simulation invokes it during the tick the event fires.',
  },
  {
    term: 'tick',
    aliases: ['ticks'],
    definition:
      'The simulation’s discrete time step, about 100 ms at default speed; speeds, turn rates, and reload times are all per-tick.',
  },
  {
    term: 'asynchronous',
    aliases: ['asynchronously', 'async'],
    definition:
      'Starting an action and returning immediately, delivering the result later — bot commands are asynchronous, handing back a Promise you can await.',
  },
  {
    term: 'synchronous',
    aliases: ['synchronously'],
    definition:
      'Completing before the next line runs. Bot commands are not synchronous: they start physical actions that take ticks to finish.',
  },
  {
    term: 'promise',
    aliases: ['promises'],
    definition:
      'A value representing an eventual result: bot commands return one that resolves when the physical action completes, and rejects if the target changes first.',
  },
  {
    term: 'serialize',
    aliases: ['serializes', 'serialized', 'serializing', 'serialization'],
    definition:
      'Convert an in-memory object into a plain data format, like a JSON string, so it can be stored or sent as a message.',
  },
  {
    term: 'deserialize',
    aliases: [
      'deserializes',
      'deserialized',
      'deserializing',
      'deserialization',
    ],
    definition:
      'Rebuild a live object from its serialized form, such as parsing a received JSON string back into data you can use.',
  },
  {
    term: 'timer',
    aliases: ['timers'],
    definition:
      'A setTimeout or setInterval driven by simulation ticks rather than wall-clock time, so it pauses and resumes with the match.',
  },
  {
    term: 'state machine',
    aliases: ['state machines'],
    definition:
      'A control pattern where the bot is in exactly one named state at a time, and events trigger the transitions between states.',
  },
  {
    term: 'bearing',
    aliases: ['bearings'],
    definition:
      'An angle measured relative to your bot’s current heading, in degrees — you turn by a bearing, not to it.',
  },
  {
    term: 'heading',
    definition:
      'The absolute direction your bot’s body faces, in degrees; scan angles and marker bearings are relative to it.',
  },
  {
    term: 'orientation',
    definition:
      'An absolute direction in the arena’s frame, in degrees — your bot’s facing, or a contact’s direction of travel.',
  },
  {
    term: 'radar',
    definition:
      'The scan sensor, mounted on the turret and turning relative to it; each scan takes about 10 ticks to recharge.',
  },
  {
    term: 'turret',
    definition:
      'The gun mount, turning relative to the body at 4° per tick; firing starts a 40-tick reload.',
  },
  {
    term: 'scan',
    aliases: ['scans', 'scanning'],
    definition:
      'A radar pulse that returns the contacts in its beam, each with a body-relative angle, distance, and speed.',
  },
  {
    term: 'contact',
    aliases: ['contacts'],
    definition:
      'A scan result: a marker pinned where a bot was detected, carrying its distance, speed, and orientation readings.',
  },
  {
    term: 'marker',
    aliases: ['markers'],
    definition:
      'A pin at a fixed arena position; every read recomputes its bearing and distance from your bot’s current position.',
  },
  {
    term: 'leading',
    aliases: ['lead'],
    definition:
      'Aiming at where a target will be when your bullet arrives, projected from its speed, orientation, and the bullet’s travel time.',
  },
  {
    term: 'sudden death',
    definition:
      'A late-match phase where every bot’s health decays each tick, forcing a decision when the remaining bots avoid fighting.',
  },
  {
    term: 'elo rating',
    aliases: ['elo'],
    definition:
      'A head-to-head skill score, as in chess: expected wins move ratings a little, upsets move them a lot. It rides your bot’s current code.',
  },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest form first: JS alternation is ordered, so at the same start position
// "state machine" wins over a hypothetical shorter overlapping form.
const forms = GLOSSARY.flatMap((entry) =>
  [entry.term, ...(entry.aliases ?? [])].map((form) => ({ form, entry }))
).sort((a, b) => b.form.length - a.form.length);

const byForm = new Map(forms.map((f) => [f.form.toLowerCase(), f.entry]));

const pattern = new RegExp(
  `\\b(?:${forms.map((f) => escapeRegExp(f.form)).join('|')})\\b`,
  'gi'
);

export type GlossarySegment = string | { entry: GlossaryEntry; text: string };

/**
 * Splits `text` around glossary matches not already in `seen`, adding each
 * matched entry's canonical term to `seen` (first occurrence wins). Returns
 * null when nothing new matched, so the caller can leave the node untouched.
 * matchAll clones the regex per spec, so the shared pattern's lastIndex never
 * leaks between calls.
 */
export function splitGlossary(
  text: string,
  seen: Set<string>
): GlossarySegment[] | null {
  const out: GlossarySegment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const entry = byForm.get(m[0].toLowerCase())!;
    if (seen.has(entry.term)) continue;
    seen.add(entry.term);
    out.push(text.slice(last, m.index), { entry, text: m[0] });
    last = m.index + m[0].length;
  }
  if (out.length === 0) return null;
  out.push(text.slice(last));
  return out;
}
