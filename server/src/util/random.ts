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
