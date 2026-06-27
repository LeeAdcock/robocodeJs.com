// A client-side jitter buffer for the live arena event stream.
//
// SSE frames can arrive irregularly (bursty), e.g. behind a buffering proxy.
// Applying events the instant they arrive makes the per-tick physics step
// (Simulate, driven by `tick` events) advance in bursts, which looks jumpy.
//
// This buffer decouples *when events are applied* from *when they arrive*: the
// caller pushes events as they come in, then drives `drain()` from a steady
// local clock (a requestAnimationFrame loop in App.tsx). Events are released to
// the reducer at an even cadence, intentionally lagging arrival by a small
// cushion, so bursty input still plays back smoothly.
//
// It is framework-free and deterministic — `drain` advances only by the `dtMs`
// it is given (no internal timers) — so it can be unit-tested directly, matching
// the convention of arenaReducer.ts / simulate.ts.

// The server emits one tick roughly every 100ms.
export const NOMINAL_TICK_MS = 100;
// How many fully-buffered ticks to hold before playback starts (and the depth we
// aim to keep). ~400ms of cushion absorbs typical network jitter.
export const BUFFER_TARGET_TICKS = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArenaEvent = { type: string; [key: string]: any };

// A "tick-group" is all queued events up to and including the next `tick` event
// (the events the server emitted for one simulation step, terminated by its
// tick). We pace playback by releasing whole groups, so we never depend on the
// exact server `time` field semantics.
export default class PlaybackBuffer {
  private queue: ArenaEvent[] = [];
  // Number of complete (tick-terminated) groups currently buffered = how far
  // ahead of the playhead we are. This is our buffer depth.
  private completeGroups = 0;
  // Fractional tick credit accumulated from drained wall-clock time.
  private credit = 0;
  // Playback holds until the initial cushion has filled, then runs until a
  // genuine underrun.
  private started = false;

  // Queue an incoming cadence event.
  push(event: ArenaEvent) {
    this.queue.push(event);
    if (event.type === 'tick') this.completeGroups += 1;
  }

  // Discard everything and reset playback (used on restart / reload / reconnect,
  // where any still-buffered motion belongs to a now-stale arena).
  flush() {
    this.queue = [];
    this.completeGroups = 0;
    this.credit = 0;
    this.started = false;
  }

  // Number of complete tick-groups waiting to play (buffer depth).
  depth() {
    return this.completeGroups;
  }

  // How fast to play relative to nominal, nudged by buffer depth to absorb
  // client/server clock drift without a visible speed wobble.
  private speedFactor() {
    if (this.completeGroups < BUFFER_TARGET_TICKS) return 0.9; // near underrun: ease off
    if (this.completeGroups > BUFFER_TARGET_TICKS * 2) return 1.1; // too deep: catch up
    return 1.0;
  }

  // Release every queued event up to and including the next `tick`, in order.
  private releaseGroup(release: (event: ArenaEvent) => void) {
    while (this.queue.length > 0) {
      const event = this.queue.shift() as ArenaEvent;
      release(event);
      if (event.type === 'tick') {
        this.completeGroups -= 1;
        return;
      }
    }
  }

  // Advance the playhead by `dtMs` of real time and release any tick-groups that
  // are now due. Returns the number of groups released this call.
  drain(dtMs: number, release: (event: ArenaEvent) => void): number {
    // Wait for the initial cushion before playing anything.
    if (!this.started) {
      if (this.completeGroups < BUFFER_TARGET_TICKS) return 0;
      this.started = true;
    }

    this.credit += dtMs * this.speedFactor();

    let released = 0;
    while (this.credit >= NOMINAL_TICK_MS && this.completeGroups > 0) {
      this.releaseGroup(release);
      this.credit -= NOMINAL_TICK_MS;
      released += 1;
    }

    // Underrun: nothing complete to play. Don't let credit run away while we
    // wait for data, or we'd burst-release the whole backlog once it arrives.
    if (this.completeGroups === 0 && this.credit > NOMINAL_TICK_MS) {
      this.credit = NOMINAL_TICK_MS;
    }

    return released;
  }
}
