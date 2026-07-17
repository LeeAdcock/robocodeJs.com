// A brief "snap window" opened whenever arena state is replaced wholesale from a
// REST snapshot (tab-visible resync, SSE reconnect reconcile, restart) rather
// than advanced tick by tick. The arena sprites animate position/rotation with
// short CSS transitions to smooth normal per-tick motion — but a snapshot jump
// isn't motion, and letting it animate makes bots visibly glide across the map,
// contradicting the arena physics. While a snap window is open, ArenaSvg tags
// itself with the `motion-snap` class (index.css) so those transitions are
// suppressed and the new state appears instantly.
//
// Like playbackClock.ts, this is a tiny module-level store (there is only ever
// one arena view at a time) exposing a useSyncExternalStore-compatible
// subscribe/getSnapshot pair.

type Listener = () => void;

// Comfortably covers the React commit + paint of the snapped state, while short
// enough that the suppressed per-tick interpolation (~10 ticks/s) is barely
// noticeable before transitions resume.
const SNAP_WINDOW_MS = 400;

let snapping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

// Open (or extend) the snap window. Call whenever the next arena render will
// jump state discontinuously.
export function beginMotionSnap() {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    snapping = false;
    listeners.forEach((listener) => listener());
  }, SNAP_WINDOW_MS);
  if (!snapping) {
    snapping = true;
    listeners.forEach((listener) => listener());
  }
}

export function getMotionSnap() {
  return snapping;
}

export function subscribeMotionSnap(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
