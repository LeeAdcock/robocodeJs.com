// Shared test environment shims (vitest `setupFiles`).
//
// jsdom implements neither ResizeObserver nor layout, and react-window (the
// virtualized log list) constructs a ResizeObserver unconditionally in its
// dynamic-row-height hook. A no-op stand-in lets components render; with no
// real measurements the list falls back to its defaultHeight / defaultRowHeight
// estimates, which is exactly what the component tests rely on.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
