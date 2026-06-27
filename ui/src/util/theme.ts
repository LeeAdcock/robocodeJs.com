// Whole-app light/dark theme preference.
//
// Mirrors playbackClock.ts: a tiny module-level store plus a
// useSyncExternalStore hook, so any component — the header toggle, the editor
// route, the logs route — can read or flip the theme without prop-drilling
// through the Router. The boolean drives non-CSS consumers (the arena SVG
// filter, the Ace editor theme); a `dark` class on <body> (set in App.tsx)
// drives the CSS-based theming of everything else.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'darkMode';

type Listener = () => void;
const listeners = new Set<Listener>();

// The user's OS-level preference, used when nothing has been chosen yet.
function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

// Resolve the starting theme: an explicit saved choice wins; otherwise follow
// the OS preference. Exported so it can be unit-tested independently of the
// live store's (one-time) initialization below.
export function getInitialDarkMode(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // localStorage may be unavailable (e.g. privacy mode) — fall through.
  }
  return prefersDark();
}

let darkMode = getInitialDarkMode();

export function getDarkMode(): boolean {
  return darkMode;
}

export function setDarkMode(value: boolean): void {
  if (value === darkMode) return;
  darkMode = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore persistence failures; the in-memory value still applies.
  }
  listeners.forEach((listener) => listener());
}

export function toggleDarkMode(): void {
  setDarkMode(!darkMode);
}

export function subscribeDarkMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// React binding: re-renders the caller whenever the theme changes.
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribeDarkMode, getDarkMode);
}
