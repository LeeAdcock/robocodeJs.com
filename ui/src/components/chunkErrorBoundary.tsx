import { Component, type ErrorInfo, type ReactNode } from 'react';

// Every route below the arena is code-split (React.lazy), and every deploy
// re-hashes the chunk filenames. A browser still running the previous build's
// HTML therefore asks for chunks that no longer exist — either because the tab
// was open across the deploy, or because it loaded index.html from one instance
// during the immutable swap and the chunk request landed on the other.
//
// A rejected lazy import throws during render. React unmounts the entire tree
// when nothing catches it, and <Suspense fallback={null}> means the user is
// left staring at a completely blank page with no way forward but a manual
// reload. This boundary turns that into a one-shot reload: the fresh HTML
// points at chunks that exist, so the page simply blinks and recovers.

// When we last reloaded to recover. Persisted so the check survives the reload
// itself — otherwise a genuinely broken build would reload forever.
const RELOAD_STAMP_KEY = 'robocodejs.chunkReloadAt';

// A recovery reload should fix things immediately. If the same failure comes
// back within this window the new build is not the problem, so stop reloading
// and show the fallback instead of spinning.
const RELOAD_COOLDOWN_MS = 30_000;

// Browsers and bundlers each phrase a failed dynamic import differently, and
// the wording is not standardized — match on all of them. The MIME-type variant
// is what the server used to produce by answering a missing chunk with
// index.html; it is fixed server-side now, but a browser can still hold a
// cached response from before that fix.
const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'unable to preload css',
  'importing a module script failed',
  'expected a javascript module script',
  'loading chunk',
  'loading css chunk',
];

export const isChunkLoadError = (error: unknown): boolean => {
  if (!error) return false;
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

// Reload only if we have not just tried it. `lastReloadAt` is null when no
// recovery reload has happened yet.
export const shouldReloadForChunkError = (
  now: number,
  lastReloadAt: number | null,
  cooldownMs: number = RELOAD_COOLDOWN_MS
): boolean => lastReloadAt === null || now - lastReloadAt >= cooldownMs;

const readReloadStamp = (): number | null => {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_STAMP_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeReloadStamp = (at: number): void => {
  try {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(at));
  } catch {
    /* storage unavailable — the cooldown degrades to "always reload once
       per page load", which is still bounded because the reload replaces
       this component instance */
  }
};

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  recovering: boolean;
}

class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, recovering: false };

  static getDerivedStateFromError(error: unknown): State {
    // Keep rendering children only if we are about to reload anyway; otherwise
    // show the fallback rather than the blank page React would leave behind.
    return { failed: true, recovering: isChunkLoadError(error) };
  }

  componentDidMount(): void {
    // Vite raises this on the window when a preloaded chunk fails to fetch,
    // which can happen before React ever tries to render the route.
    window.addEventListener(
      'vite:preloadError',
      this.handlePreloadError as EventListener
    );
  }

  componentWillUnmount(): void {
    window.removeEventListener(
      'vite:preloadError',
      this.handlePreloadError as EventListener
    );
  }

  handlePreloadError = (): void => {
    this.recover();
  };

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (!isChunkLoadError(error)) {
      // A real render bug. Reloading would not help and could loop, so leave
      // the fallback up and make the error findable.
      console.error('Unhandled render error', error, info.componentStack);
      return;
    }
    this.recover();
  }

  // Reload once into the current build.
  recover(): void {
    const now = Date.now();
    if (!shouldReloadForChunkError(now, readReloadStamp())) {
      this.setState({ failed: true, recovering: false });
      return;
    }
    writeReloadStamp(now);
    window.location.reload();
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    // While a recovery reload is in flight, render nothing — the page is about
    // to be replaced and a flash of error text would be pure noise.
    if (this.state.recovering) return null;
    return (
      <div className="m-4">
        <h4>Something went wrong</h4>
        <p>
          This page failed to load. Reloading usually fixes it — the site may
          have been updated while you had it open.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ChunkErrorBoundary;
