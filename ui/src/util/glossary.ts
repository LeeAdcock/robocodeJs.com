// Glossary of programming/math/game concepts used across the lessons and
// docs. MarkdownPage auto-detects these terms in rendered prose and wraps the
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
    term: 'program',
    aliases: ['programs'],
    definition: 'A list of instructions your robot follows from top to bottom.',
  },
  {
    term: 'code',
    definition: 'Instructions written for a computer to follow.',
  },
  {
    term: 'string',
    aliases: ['strings'],
    definition: "A piece of text in quotes, like 'Rusty'.",
  },
  {
    term: 'variable',
    aliases: ['variables'],
    definition:
      'A named box that stores a value you can read and change later.',
  },
  {
    term: 'function',
    aliases: ['functions'],
    definition: 'A named, reusable bundle of code you can call from anywhere.',
  },
  {
    term: 'boolean',
    aliases: ['booleans'],
    definition: 'A yes-or-no value: true or false.',
  },
  {
    term: 'list',
    aliases: ['lists', 'array', 'arrays'],
    definition: 'Several things in a row; each item can be visited in turn.',
  },
  {
    term: 'object',
    aliases: ['objects'],
    definition:
      "A value with named labels, like a target's distance and speed.",
  },
  {
    term: 'event',
    aliases: ['events'],
    definition:
      'Something that happens in the game that your code can react to.',
  },
  {
    term: 'handler',
    aliases: ['handlers'],
    definition: 'The code that runs when an event fires.',
  },
  {
    term: 'tick',
    aliases: ['ticks'],
    definition: 'One beat of the game clock; bots think and act once per tick.',
  },
  {
    term: 'timer',
    aliases: ['timers'],
    definition:
      'A countdown that fires an event after a chosen number of ticks.',
  },
  {
    term: 'state machine',
    aliases: ['state machines'],
    definition:
      'A design where the bot is always in one named mode and behaves differently in each.',
  },
  {
    term: 'mode',
    aliases: ['modes'],
    definition: 'The state your bot is currently in, like SEARCH or ATTACK.',
  },
  {
    term: 'bearing',
    aliases: ['bearings'],
    definition:
      'A direction to something measured relative to where your bot is facing.',
  },
  {
    term: 'heading',
    definition: 'The compass direction your bot is currently facing.',
  },
  {
    term: 'orientation',
    definition: "A target's absolute compass direction of travel.",
  },
  {
    term: 'radar',
    definition:
      'The sensor that scans for other robots in the direction it points.',
  },
  {
    term: 'turret',
    definition:
      'The gun on top of your bot; it turns independently of the body.',
  },
  {
    term: 'scan',
    aliases: ['scans', 'scanning'],
    definition: 'Using the radar to look for other robots.',
  },
  {
    term: 'marker',
    aliases: ['markers'],
    definition:
      'A pin on the arena map that reports its bearing and distance from your bot.',
  },
  {
    term: 'leading',
    aliases: ['lead'],
    definition: 'Aiming where a moving target will be, not where it is now.',
  },
  {
    term: 'threshold',
    definition:
      'A cutoff number a value is compared against to trigger a decision.',
  },
  {
    term: 'arena',
    definition: 'The battlefield where bots drive, scan, and fight.',
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
