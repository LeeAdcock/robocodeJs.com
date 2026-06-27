// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Network + streaming are stubbed so the component mounts in isolation. The
// value of this test is catching crash-on-render regressions (e.g. the lazy()
// temporal-dead-zone bug that blanked the whole app).
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import axios from 'axios';
import App from '../src/App';

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
  });

  it('mounts and renders the arena without crashing (signed-out)', () => {
    const { container } = render(<App />);
    // The arena SVG renders regardless of auth state.
    expect(container.querySelector('svg')).toBeTruthy();
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
});
