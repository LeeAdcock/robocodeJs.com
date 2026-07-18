// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInitialDebugMode,
  getDebugMode,
  setDebugMode,
  toggleDebugMode,
  subscribeDebugMode,
} from '../src/util/debugMode';

describe('debugMode store', () => {
  beforeEach(() => {
    localStorage.clear();
    setDebugMode(false); // reset the live store to a known baseline
  });

  describe('getInitialDebugMode', () => {
    it('honors an explicit saved choice', () => {
      localStorage.setItem('debugMode', 'true');
      expect(getInitialDebugMode()).toBe(true);
      localStorage.setItem('debugMode', 'false');
      expect(getInitialDebugMode()).toBe(false);
    });

    it('defaults to off when nothing is saved (no OS fallback)', () => {
      localStorage.removeItem('debugMode');
      expect(getInitialDebugMode()).toBe(false);
    });
  });

  it('sets, reads, and toggles the current value', () => {
    expect(getDebugMode()).toBe(false);
    setDebugMode(true);
    expect(getDebugMode()).toBe(true);
    toggleDebugMode();
    expect(getDebugMode()).toBe(false);
  });

  it('persists the choice to localStorage', () => {
    setDebugMode(true);
    expect(localStorage.getItem('debugMode')).toBe('true');
    setDebugMode(false);
    expect(localStorage.getItem('debugMode')).toBe('false');
  });

  it('notifies subscribers on change only, and supports unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeDebugMode(() => {
      calls += 1;
    });

    setDebugMode(true);
    expect(calls).toBe(1);

    setDebugMode(true); // unchanged — no notification
    expect(calls).toBe(1);

    unsubscribe();
    setDebugMode(false);
    expect(calls).toBe(1);
  });
});
