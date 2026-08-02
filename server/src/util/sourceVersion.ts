import { sha256hex } from './hash';

// A short, stable content fingerprint of a bot's source — its "version". It lets
// a caller trace one specific piece of source verifiably through the system: the
// value MCP `set_app_source` (and `create_app`) returns for a save is the same
// value that later shows up against that app in `add_app_to_arena`, `list_apps`,
// and the arena/match views (`arena_status`, `match_summary`, `match_status`), so
// you can confirm an arena is running the exact source you deployed rather than an
// earlier draft.
//
// Verifiable by construction: it is the first SOURCE_VERSION_LENGTH hex chars of
// the SHA-256 of the UTF-8 source, so any client can recompute and compare it
// (`sha256(source).hex()[:16]`). 64 bits is ample to distinguish real edits while
// staying compact enough to echo into every status payload. Empty source hashes
// like any other string (a stable value, not a special case).
export const SOURCE_VERSION_LENGTH = 16;

export const sourceVersion = (source: string): string =>
  sha256hex(source ?? '').slice(0, SOURCE_VERSION_LENGTH);

export default sourceVersion;
