import { describe, it, expect, vi } from 'vitest';
import {
  setPlaybackTime,
  getPlaybackTime,
  subscribePlaybackTime,
} from '../src/util/playbackClock';

describe('playbackClock', () => {
  it('reports the latest set time', () => {
    setPlaybackTime(42);
    expect(getPlaybackTime()).toBe(42);
    setPlaybackTime(43);
    expect(getPlaybackTime()).toBe(43);
  });

  it('notifies subscribers when the time changes', () => {
    setPlaybackTime(100);
    const listener = vi.fn();
    const unsubscribe = subscribePlaybackTime(listener);

    setPlaybackTime(101);
    expect(listener).toHaveBeenCalledTimes(1);

    // No notification when the value is unchanged.
    setPlaybackTime(101);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setPlaybackTime(102);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
