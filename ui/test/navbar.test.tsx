// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import NavBar from '../src/components/navbar';
import { getDarkMode, setDarkMode } from '../src/util/theme';

const noop = () => undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseProps: any = {
  apps: [],
  user: null,
  arena: { clock: { time: 0 }, apps: [] },
  isPaused: true,
  doPause: noop,
  doResume: noop,
  doRestart: noop,
  doSave: noop,
  doCreateApp: noop,
};

describe('NavBar night-mode toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setDarkMode(false);
  });
  afterEach(cleanup);

  it('flips the theme from the header and reflects the new state', () => {
    render(
      <MemoryRouter>
        <NavBar {...baseProps} />
      </MemoryRouter>
    );

    const toggle = screen.getByLabelText('Switch to night mode');
    expect(getDarkMode()).toBe(false);

    fireEvent.click(toggle);
    expect(getDarkMode()).toBe(true);
    // The control now offers the inverse action.
    expect(screen.getByLabelText('Switch to light mode')).toBeTruthy();
  });
});
