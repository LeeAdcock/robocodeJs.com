// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getInitialDarkMode,
  getDarkMode,
  setDarkMode,
  toggleDarkMode,
  subscribeDarkMode,
} from '../src/util/theme';

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    setDarkMode(false); // reset the live store to a known baseline
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('getInitialDarkMode', () => {
    it('honors an explicit saved choice over everything else', () => {
      localStorage.setItem('darkMode', 'true');
      expect(getInitialDarkMode()).toBe(true);
      localStorage.setItem('darkMode', 'false');
      expect(getInitialDarkMode()).toBe(false);
    });

    it('falls back to the OS preference when nothing is saved', () => {
      localStorage.removeItem('darkMode');
      const matchMedia = (matches: boolean) =>
        vi.fn().mockReturnValue({ matches } as MediaQueryList);

      vi.stubGlobal('matchMedia', matchMedia(true));
      expect(getInitialDarkMode()).toBe(true);

      vi.stubGlobal('matchMedia', matchMedia(false));
      expect(getInitialDarkMode()).toBe(false);
    });
  });

  it('sets, reads, and toggles the current theme', () => {
    expect(getDarkMode()).toBe(false);
    setDarkMode(true);
    expect(getDarkMode()).toBe(true);
    toggleDarkMode();
    expect(getDarkMode()).toBe(false);
  });

  it('persists the choice to localStorage', () => {
    setDarkMode(true);
    expect(localStorage.getItem('darkMode')).toBe('true');
    setDarkMode(false);
    expect(localStorage.getItem('darkMode')).toBe('false');
  });

  it('notifies subscribers on change only, and supports unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDarkMode(listener);

    setDarkMode(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setDarkMode(true); // unchanged — no notification
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setDarkMode(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
