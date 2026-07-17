// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SaveIndicator from '../src/page/app/appSaveIndicator';

afterEach(cleanup);

describe('SaveIndicator', () => {
  it('names each save state', () => {
    render(<SaveIndicator saveState="saved" />);
    expect(screen.getByRole('status').textContent).toBe('Saved');
    cleanup();

    render(<SaveIndicator saveState="unsaved" />);
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    cleanup();

    render(<SaveIndicator saveState="saving" />);
    expect(screen.getByRole('status').textContent).toBe('Saving…');
  });

  it('says nothing until the source has loaded — there is no state to report yet', () => {
    render(<SaveIndicator saveState="loading" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
