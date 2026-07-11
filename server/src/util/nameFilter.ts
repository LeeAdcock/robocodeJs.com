import { Filter } from 'glin-profanity';

// Profanity gate for bot/app names (GitHub #151 follow-up). Names are untrusted
// and shown on public surfaces (arena, roster, global leaderboard), so a name
// that trips this filter is rejected at the App.setName chokepoint.
//
// We use a library rather than a hand-rolled wordlist deliberately: maintaining
// a multilingual list with obfuscation matching is exactly the kind of thing
// that rots when home-grown. This complements util/botName.ts (structural
// hygiene) — that is ours because it's simple/security-auditable; the *content*
// judgment is the library's job.
//
// A single Filter instance is built once and reused (it compiles wordlists /
// regexes up front). English only for now to keep false positives (the
// "Scunthorpe problem") low; word boundaries on for the same reason. Leetspeak
// and Unicode normalization are enabled so "f4ck" / homoglyph spellings still
// trip it.
const filter = new Filter({
  languages: ['english'],
  wordBoundaries: true,
  detectLeetspeak: true,
  leetspeakLevel: 'moderate',
  normalizeUnicode: true,
});

// True when `text` appears to contain profanity. Fails OPEN (returns false) if
// the library ever throws: a filter bug must not be able to wedge a name write.
// Anything that slips through is handled by report/rename, not by crashing.
export const isNameProfane = (text: string): boolean => {
  if (!text) return false;
  try {
    return filter.isProfane(text);
  } catch {
    return false;
  }
};

// Thrown by App.setName when a (sanitized) name trips the profanity filter, so a
// direct caller (e.g. the MCP tool) can surface a clear rejection. The sandbox
// bot.setName path pre-checks with isNameProfane and never triggers this.
export class NameRejectedError extends Error {
  constructor() {
    super('Name rejected: it appears to contain inappropriate language.');
    this.name = 'NameRejectedError';
  }
}
