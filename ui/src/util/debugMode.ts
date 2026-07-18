// Arena "debug view" preference.
//
// Mirrors theme.ts: a tiny module-level store plus a useSyncExternalStore hook,
// so the arena toolbar (the toggle) and the arena SVG (the renderer) can read or
// flip the preference without prop-drilling. When on, the arena is drawn as a
// schematic — 50px grid, circle tanks, motion/aim vectors, bullet paths — instead
// of the terrain-and-sprites scene. Unlike the theme there is no OS default:
// debug view stays off until the user turns it on.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'debugMode';

type Listener = () => void;
const listeners = new Set<Listener>();

// Resolve the starting value: an explicit saved choice wins; otherwise off.
// Exported so it can be unit-tested independently of the live store's (one-time)
// initialization below.
export function getInitialDebugMode(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // localStorage may be unavailable (e.g. privacy mode) — fall through.
  }
  return false;
}

let debugMode = getInitialDebugMode();

export function getDebugMode(): boolean {
  return debugMode;
}

export function setDebugMode(value: boolean): void {
  if (value === debugMode) return;
  debugMode = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore persistence failures; the in-memory value still applies.
  }
  listeners.forEach((listener) => listener());
}

export function toggleDebugMode(): void {
  setDebugMode(!debugMode);
}

export function subscribeDebugMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// React binding: re-renders the caller whenever the preference changes.
export function useDebugMode(): boolean {
  return useSyncExternalStore(subscribeDebugMode, getDebugMode);
}
