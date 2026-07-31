// A tiny deterministic pseudo-random generator (mulberry32). A given 32-bit seed
// always produces the same sequence, so an arena's random setup — bot placement
// and starting orientations — is fully reproducible when the seed is fixed. This
// makes accelerated, headless runs (for tooling / AI) repeatable. It is fast and
// small; it is NOT cryptographic and must not be used for anything security-
// sensitive.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stable 32-bit hash of a string (FNV-1a). Used to fold a stable arena id into
// a bot-id seed so two arenas that share a pinned seed still get distinct bot ids
// (see Environment.restart). Not cryptographic.
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A deterministic, v4-shaped UUID string derived entirely from a 32-bit seed:
// the same seed always yields the same string. Its 128 bits come from
// mulberry32 (so the real entropy is the 32-bit seed), and the version/variant
// nibbles are set only so it reads like the randomUUID()-based ids it stands in
// for — nothing keys off the version. NOT cryptographic; it is only an in-match
// bot handle, made seed-derived so a pinned-seed match reproduces the exact ids
// bot code can observe (bot.getId(), a scanned contact's id).
export function seededUuid(seed: number): string {
  const rng = mulberry32(seed);
  const b: number[] = [];
  for (let i = 0; i < 16; i++) b.push(Math.floor(rng() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = b.map((x) => x.toString(16).padStart(2, '0'));
  return (
    h.slice(0, 4).join('') +
    '-' +
    h.slice(4, 6).join('') +
    '-' +
    h.slice(6, 8).join('') +
    '-' +
    h.slice(8, 10).join('') +
    '-' +
    h.slice(10, 16).join('')
  );
}

// The seed-derived bot id for one roster slot. Mixes the stable arena id, the
// arena's current PRNG seed, and the bot's (team, slot) position through an
// avalanche so distinct slots (and distinct arenas sharing a seed) get distinct
// ids, while the same arena + same pinned seed + same slot reproduces the id on
// every restart. Kept next to seededUuid so the whole derivation lives in one
// place.
export function deterministicBotId(
  arenaId: string,
  seed: number,
  teamIndex: number,
  slot: number
): string {
  let s = hashString(arenaId);
  s = Math.imul(s ^ (seed >>> 0), 0x9e3779b1) >>> 0;
  s = Math.imul(s ^ (teamIndex + 1), 0x85ebca6b) >>> 0;
  s = Math.imul(s ^ (slot + 1), 0xc2b2ae35) >>> 0;
  return seededUuid(s);
}
