// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Same isolation approach as App.test.tsx: stub network + streaming so App
// mounts standalone. App is imported dynamically *after* matchMedia is stubbed,
// because useIsMobile reads matchMedia once at module-evaluation time — a static
// import would evaluate it before the stub is in place. vi.resetModules() between
// cases gives each dynamic import a fresh useIsMobile with the right viewport.
vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import axios from 'axios';

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

// The arena SVG is uniquely identified by its fixed viewBox (arena.tsx), which
// distinguishes it from the navbar's react-icons <svg>s that always render.
const ARENA_SVG = 'svg[viewBox="-10 -10 770 770"]';

function stubViewport(isMobile: boolean) {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: isMobile,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  );
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
}

describe('App responsive layout', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('hides the arena on phone-sized viewports (<576px)', async () => {
    stubViewport(true);
    const { default: App } = await import('../src/App');
    const { container } = render(<App />);
    expect(container.querySelector(ARENA_SVG)).toBeFalsy();
  });

  it('renders the arena on wider viewports', async () => {
    stubViewport(false);
    const { default: App } = await import('../src/App');
    const { container } = render(<App />);
    expect(container.querySelector(ARENA_SVG)).toBeTruthy();
  });
});
