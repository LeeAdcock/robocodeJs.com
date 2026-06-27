// The current *displayed* simulation time — the tick the arena jitter buffer
// (playbackBuffer.ts) has played up to. The arena playback loop publishes it;
// other views read it so they stay in step with what's actually on screen
// rather than with raw network arrival.
//
// Without this, the bot log panel (a separate SSE stream) would show a log line
// ~one buffer-cushion (~400ms) before the motion it describes appears in the
// arena. Gating log display on this clock keeps the two in sync.
//
// It's a tiny module-level store (there is only ever one arena view at a time)
// exposing a useSyncExternalStore-compatible subscribe/getSnapshot pair.

type Listener = () => void;

let current = 0;
const listeners = new Set<Listener>();

export function setPlaybackTime(time: number) {
  if (time === current) return;
  current = time;
  listeners.forEach((listener) => listener());
}

export function getPlaybackTime() {
  return current;
}

export function subscribePlaybackTime(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
