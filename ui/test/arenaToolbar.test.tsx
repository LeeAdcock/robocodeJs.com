// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
