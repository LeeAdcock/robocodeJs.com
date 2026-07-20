// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react';
import AppLogsDock from '../src/page/app/appLogsDock';
import useLogsStream from '../src/util/useLogsStream';
import { Emitter } from '../src/util/emitter';

// jsdom doesn't implement Element.scrollTo; the log panel pins to the bottom.
Element.prototype.scrollTo = () => {};

// Capture every EventSource the shared store opens, so tests can push messages
// and assert on the connection count.
let sources: FakeEventSource[] = [];
class FakeEventSource {
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }
  close() {
    this.closed = true;
  }
}

let seq = 0;
const entry = (over: Record<string, unknown> = {}) => ({
  id: `dock-e${seq++}`,
  name: '<11>',
  appId: 'a1',
  botIndex: 1,
  level: 30,
  levelName: 'info',
  msg: 'hi',
  time: 0,
  ...over,
});

// Push a log line through the live SSE connection into the shared store.
const push = (over: Record<string, unknown> = {}) =>
  act(() => {
    sources[sources.length - 1].onmessage?.({
      data: JSON.stringify(entry(over)),
    });
  });

const arena = {
  clock: { time: 0 },
  apps: [
    { id: 'a1', name: 'alpha', bots: [{}, {}] },
    { id: 'a2', name: 'beta', bots: [{}] },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('AppLogsDock (editor-docked console)', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    localStorage.clear();
    sources = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderDock = (over: Record<string, unknown> = {}) =>
    render(
      <AppLogsDock
        userId="u1"
        appId="a1"
        arena={arena}
        emitter={new Emitter()}
        onJumpToLine={() => undefined}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...(over as any)}
      />
    );

  it('starts collapsed; opening shows the console filtered to this app', () => {
    renderDock();
    // Collapsed: just the bar.
    expect(screen.queryByText('hi')).toBeNull();

    push({ appId: 'a1', name: '<11>', msg: 'from alpha' });
    push({ appId: 'a2', name: '<21>', msg: 'from beta' });

    fireEvent.click(screen.getByLabelText('Open console'));
    // Auto-filtered to the app being edited.
    expect(screen.queryByText('from alpha')).toBeTruthy();
    expect(screen.queryByText('from beta')).toBeNull();
  });

  it('collapsed dock badges unread errors for this app, cleared on open', () => {
    renderDock();
    push({ appId: 'a1', levelName: 'error', level: 50, msg: 'boom' });
    push({ appId: 'a1', levelName: 'info', msg: 'fine' });
    push({ appId: 'a2', levelName: 'error', level: 50, msg: 'other app' });

    // Only this app's error counts.
    expect(screen.getByLabelText('1 unread problems').textContent).toBe('1');

    // Opening the dock clears the badge.
    fireEvent.click(screen.getByLabelText('Open console'));
    fireEvent.click(screen.getByLabelText('Close console'));
    expect(screen.queryByLabelText(/unread problems/)).toBeNull();
  });

  it('the console is hard-scoped: only this app in the Bots filter, no clear chip', () => {
    renderDock();
    push({ appId: 'a1', name: '<11>', msg: 'mine' });
    push({ appId: 'a2', name: '<21>', msg: 'theirs' });
    fireEvent.click(screen.getByLabelText('Open console'));

    // No escape hatch to other apps' logs: the clear-filter chip isn't shown
    // (the scope is a boundary, not a removable filter)...
    expect(screen.queryByLabelText('Show all bots')).toBeNull();

    // ...and the Bots filter offers only this app's individual bots — no
    // app-level checkbox row (unchecking the only app would show nothing) and
    // no other apps.
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot 11')).toBeTruthy();
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.queryByText('beta')).toBeNull();
  });

  it('a bot fault shows a clickable row that jumps the editor to the line', () => {
    const emitter = new Emitter();
    const onJumpToLine = vi.fn();
    render(
      <AppLogsDock
        userId="u1"
        appId="a1"
        arena={arena}
        emitter={emitter}
        onJumpToLine={onJumpToLine}
      />
    );
    fireEvent.click(screen.getByLabelText('Open console'));

    act(() => {
      emitter.emit('botFault', {
        appId: 'a1',
        code: 'E014',
        message: 'oops',
        line: 12,
      });
      // Another app's fault doesn't belong in this dock.
      emitter.emit('botFault', { appId: 'a2', code: 'E014', message: 'other' });
    });

    const row = screen.getByText(/E014: oops \(line 12\)/);
    expect(screen.queryByText(/other/)).toBeNull();
    fireEvent.click(row);
    expect(onJumpToLine).toHaveBeenCalledWith(12, 'E014: oops');
  });

  it('shares one SSE connection across consumers', () => {
    const SecondConsumer = () => {
      useLogsStream('u1');
      return null;
    };
    render(
      <>
        <AppLogsDock
          userId="u1"
          appId="a1"
          arena={arena}
          emitter={new Emitter()}
          onJumpToLine={() => undefined}
        />
        <SecondConsumer />
      </>
    );
    expect(sources.filter((s) => !s.closed).length).toBe(1);
  });

  it('remembers the open state across mounts', () => {
    const { unmount } = renderDock();
    fireEvent.click(screen.getByLabelText('Open console'));
    unmount();

    renderDock();
    // Reopens expanded (localStorage-persisted), no click needed.
    expect(screen.getByLabelText('Close console')).toBeTruthy();
  });
});
