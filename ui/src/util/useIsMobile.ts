// Whether the viewport is phone-sized (below Bootstrap's `sm` breakpoint).
//
// Mirrors theme.ts / playbackClock.ts: a tiny module-level store plus a
// useSyncExternalStore hook, so any component can read the current viewport
// class without prop-drilling. Backed by matchMedia so it updates live on
// resize/rotation. The 575.98px edge matches Bootstrap's `<576px` boundary,
// so the arena hides exactly when the navbar's `expand="sm"` hamburger appears.

import { useSyncExternalStore } from 'react';

// One below the `sm` breakpoint (576px), matching Bootstrap's own max-width
// media queries.
const QUERY = '(max-width: 575.98px)';

type Listener = () => void;
const listeners = new Set<Listener>();

function mediaQuery(): MediaQueryList | null {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return null;
  }
  return window.matchMedia(QUERY);
}

// Evaluated once for the initial snapshot; the store then tracks live changes.
// Defaults to false (desktop) when matchMedia is unavailable (SSR/tests).
let isMobile = mediaQuery()?.matches ?? false;

export function getIsMobile(): boolean {
  return isMobile;
}

export function subscribeIsMobile(listener: Listener): () => void {
  listeners.add(listener);
  // Lazily attach a single media-query listener while anyone is subscribed.
  const mql = mediaQuery();
  const onChange = (event: MediaQueryListEvent) => {
    if (event.matches === isMobile) return;
    isMobile = event.matches;
    listeners.forEach((l) => l());
  };
  mql?.addEventListener('change', onChange);
  return () => {
    mql?.removeEventListener('change', onChange);
    listeners.delete(listener);
  };
}

// React binding: re-renders the caller whenever the viewport crosses 576px.
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeIsMobile, getIsMobile);
}
