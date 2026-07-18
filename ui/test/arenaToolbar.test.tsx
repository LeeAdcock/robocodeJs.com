// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ArenaToolbar from '../src/components/arena/arenaToolbar';

const noop = () => undefined;

afterEach(cleanup);

// The arena toolbar's controls are icon-only, so each needs an aria-label to
// expose an accessible name to screen-reader users (GitHub #132).
describe('ArenaToolbar accessible names (#132)', () => {
  it('labels Resume when paused', () => {
    render(
      <ArenaToolbar
        isPaused={true}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
      />
    );
    expect(screen.getByLabelText('Resume')).toBeTruthy();
    expect(screen.getByLabelText('Reset')).toBeTruthy();
    // The pause/resume control swaps by state — only one is shown at a time.
    expect(screen.queryByLabelText('Pause')).toBeNull();
  });

  it('labels Pause when running', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
      />
    );
    expect(screen.getByLabelText('Pause')).toBeTruthy();
    expect(screen.queryByLabelText('Resume')).toBeNull();
  });

  it('labels the Share button when a share handler is provided', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        doShare={noop}
      />
    );
    expect(screen.getByLabelText('Copy public watch link')).toBeTruthy();
  });

  it('leaves no icon button without an accessible name', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        doShare={noop}
      />
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

// The single-tick Step control is a general arena control (not debug-only):
// shown whenever the arena is paused and a step handler is wired, hidden while
// running (there's nothing to step past a live tick).
describe('ArenaToolbar Step control', () => {
  it('shows Step when paused and a step handler is provided', () => {
    render(
      <ArenaToolbar
        isPaused={true}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        doStep={noop}
      />
    );
    expect(screen.getByLabelText('Step one tick')).toBeTruthy();
  });

  it('hides Step while the arena is running', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        doStep={noop}
      />
    );
    expect(screen.queryByLabelText('Step one tick')).toBeNull();
  });

  it('hides Step when paused but no step handler is wired', () => {
    render(
      <ArenaToolbar
        isPaused={true}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
      />
    );
    expect(screen.queryByLabelText('Step one tick')).toBeNull();
  });
});

// The bot-quantity dropdown sets how many bots each app fields (1–5). It is an
// owner control: it renders only when a doSetBotCount handler is wired (the
// spectator watch page mounts no toolbar at all, but the gating also covers any
// future read-only use of this component).
describe('ArenaToolbar bot quantity control', () => {
  it('is hidden without a doSetBotCount handler', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
      />
    );
    expect(screen.queryByLabelText('Bots per app')).toBeNull();
  });

  it('shows the current quantity on the toggle', () => {
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        botCount={3}
        doSetBotCount={noop}
      />
    );
    expect(screen.getByLabelText('Bots per app').textContent).toContain('3');
  });

  it('invokes the handler with the chosen quantity', () => {
    const doSetBotCount = vi.fn();
    render(
      <ArenaToolbar
        isPaused={false}
        doPause={noop}
        doResume={noop}
        doRestart={noop}
        botCount={3}
        doSetBotCount={doSetBotCount}
      />
    );
    fireEvent.click(screen.getByLabelText('Bots per app'));
    fireEvent.click(screen.getByRole('button', { name: '5 bots per app' }));
    expect(doSetBotCount).toHaveBeenCalledWith(5);
  });
});
