// Bot/app names are untrusted, user-controlled text (set from sandboxed bot code
// via bot.setName, from the MCP create_app tool, and seeded for starters). They
// are persisted and shown on public surfaces - the arena labels, the roster, and
// the global leaderboard - so they are sanitized at the single persistence
// chokepoint (App.setName) rather than per display. This keeps every writer
// covered by one rule and closes the gap where callers of App.setName that
// aren't the sandbox (e.g. MCP) previously skipped cleaning entirely.
//
// Note we do NOT need this for XSS: every render path escapes the name as text
// (React text nodes; no dangerouslySetInnerHTML / markdown parsing touches
// names). This is about keeping the *stored* value sane: bounded length, no
// control characters, and no invisible / bidirectional-override characters that
// let a name spoof or hide its displayed text.

export const MAX_NAME_LENGTH = 50;

// Code-point ranges removed outright. Built programmatically (from hex, not
// literal characters) so the source stays pure ASCII and reviewable:
//   0000-001F, 007F-009F  C0 / C1 control codes and DEL
//   00AD                  soft hyphen (invisible)
//   061C                  Arabic letter mark (bidi)
//   200B                  zero-width space
//   200E-200F             left-to-right / right-to-left marks (bidi)
//   2060                  word joiner (invisible)
//   202A-202E             bidi embeddings / overrides
//   2066-2069             bidi isolates
//   FEFF                  byte-order mark / zero-width no-break space
// The zero-width joiner / non-joiner (200D / 200C) are deliberately KEPT - they
// are legitimate in several scripts and in emoji sequences.
const STRIP_RANGES: ReadonlyArray<[number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2060, 0x2060],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = (cp: number) => '\\u' + cp.toString(16).padStart(4, '0');
const STRIP = new RegExp(
  '[' +
    STRIP_RANGES.map(([a, b]) =>
      a === b ? hex(a) : hex(a) + '-' + hex(b)
    ).join('') +
    ']',
  'g'
);

// Normalize an untrusted name into the form we persist and display: Unicode
// NFC, control/invisible/bidi characters stripped, runs of whitespace collapsed
// to a single space, trimmed, and capped at MAX_NAME_LENGTH. May return '' (an
// all-junk or empty input) - callers treat that as "no usable name" and leave
// the existing name untouched rather than blanking it.
export const sanitizeBotName = (name: unknown): string =>
  String(name ?? '')
    .normalize('NFC')
    // Turn any whitespace (incl. tab/newline control codes) into a single space
    // FIRST, so a control-char separator keeps the word boundary instead of
    // fusing the words together...
    .replace(/\s+/g, ' ')
    // ...then strip the (now non-whitespace) control / invisible / bidi set...
    .replace(STRIP, '')
    // ...and re-collapse in case stripping an invisible left two spaces adjacent.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
