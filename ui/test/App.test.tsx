// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Network + streaming are stubbed so the component mounts in isolation. The
// value of this test is catching crash-on-render regressions (e.g. the lazy()
// temporal-dead-zone bug that blanked the whole app).
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import App from '../src/App';
import { setDarkMode } from '../src/util/theme';

class FakeEventSource {
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  close() {
    /* no-op */
  }
  addEventListener() {
    /* no-op */
  }
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.mocked(axios.get).mockImplementation((url: string) => {
      if (url.includes('/docs/'))
        return Promise.resolve({ data: '# Docs' } as never);
      if (url.includes('/arena'))
        return Promise.resolve({
          data: { clock: { time: 0 }, apps: [], running: false },
        } as never);
      return Promise.resolve({ data: {} } as never);
    });
    vi.mocked(axios.post).mockResolvedValue({ data: {} } as never);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setDarkMode(false);
    document.body.classList.remove('dark');
  });

  it('mounts and renders the arena without crashing (signed-out)', () => {
    const { container } = render(<App />);
    // The arena SVG renders regardless of auth state.
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('reflects the theme preference on the document body', () => {
    setDarkMode(true);
    render(<App />);
    expect(document.body.classList.contains('dark')).toBe(true);
  });

  it('opens an SSE connection on mount', () => {
    const spy = vi.fn();
    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url);
          spy(url);
        }
      }
    );
    render(<App />);
    expect(spy).toHaveBeenCalled();
    // Signed-out clients stream the public demo arena.
    expect(spy.mock.calls[0][0]).toContain('/api/demo/events');
  });

  it('runs the playback loop and cancels it on unmount', () => {
    let last: FakeEventSource | null = null;
    vi.stubGlobal(
      'EventSource',
      class extends FakeEventSource {
        constructor(url: string) {
          super(url);
          // Capturing the instance is the point: the test needs a handle on the
          // EventSource the component constructs internally.
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          last = this;
        }
      }
    );
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancel);

    const { unmount } = render(<App />);
    expect(raf).toHaveBeenCalled();

    // Feed a burst of buffered simulation events, then drive frames manually:
    // the loop should drain them without throwing.
    for (let t = 1; t <= 6; t++) {
      last!.onmessage?.({ data: JSON.stringify({ type: 'tick', time: t }) });
    }
    let now = 0;
    expect(() => {
      for (let i = 0; i < 10; i++) {
        const next = frames.pop();
        now += 100;
        next?.(now);
      }
    }).not.toThrow();

    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
