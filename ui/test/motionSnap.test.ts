import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  beginMotionSnap,
  getMotionSnap,
  subscribeMotionSnap,
} from '../src/util/motionSnap';

describe('motionSnap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Drain any window left open by a previous test.
    vi.runAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a snap window that closes on its own', () => {
    expect(getMotionSnap()).toBe(false);
    beginMotionSnap();
    expect(getMotionSnap()).toBe(true);
    vi.runAllTimers();
    expect(getMotionSnap()).toBe(false);
  });

  it('extends the window when re-opened mid-window', () => {
    beginMotionSnap();
    // Partway through the window, a second reload (e.g. reconnect right after
    // tab-visible) re-opens it; the full duration restarts from that point.
    vi.advanceTimersByTime(300);
    beginMotionSnap();
    vi.advanceTimersByTime(300);
    expect(getMotionSnap()).toBe(true);
    vi.runAllTimers();
    expect(getMotionSnap()).toBe(false);
  });

  it('notifies subscribers on open and close, but not on extend', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMotionSnap(listener);

    beginMotionSnap();
    expect(listener).toHaveBeenCalledTimes(1);

    // Already snapping — extending the window isn't a state change.
    beginMotionSnap();
    expect(listener).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    beginMotionSnap();
    expect(listener).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
  });
});
