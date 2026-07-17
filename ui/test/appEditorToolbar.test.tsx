// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';

// The toolbar imports font bounds from appEditor, which pulls in the heavy Ace
// editor; stub the module so the test exercises just the toolbar.
vi.mock('../src/page/app/appEditor', () => ({
  default: () => null,
  EDITOR_FONT_MIN: 8,
  EDITOR_FONT_MAX: 30,
  EDITOR_FONT_DEFAULT: 12,
}));
import EditorToolbar from '../src/page/app/appEditorToolbar';

const noop = () => undefined;
const renderToolbar = (doDelete: () => void, saveState: any = 'saved') =>
  render(
    <EditorToolbar
      code="bot.setName('x')"
      appName="My Bot"
      saveState={saveState}
      doDelete={doDelete}
      doShare={noop}
      doClean={noop}
      doCheck={noop}
      doExecute={noop}
      doReboot={noop}
      fontSize={12}
      doZoomIn={noop}
      doZoomOut={noop}
      doZoomReset={noop}
    />
  );

afterEach(cleanup);

describe('EditorToolbar save indicator', () => {
  it('names each save state', () => {
    renderToolbar(noop, 'saved');
    expect(screen.getByRole('status').textContent).toBe('Saved');
    cleanup();

    renderToolbar(noop, 'unsaved');
    expect(screen.getByRole('status').textContent).toBe('Unsaved changes');
    cleanup();

    renderToolbar(noop, 'saving');
    expect(screen.getByRole('status').textContent).toBe('Saving…');
  });

  it('says nothing until the source has loaded — there is no state to report yet', () => {
    renderToolbar(noop, 'loading');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('EditorToolbar delete confirmation', () => {
  it('does not delete on the first click — it opens a confirmation instead', () => {
    const doDelete = vi.fn();
    renderToolbar(doDelete);

    // Confirmation is not shown until the trash button is clicked.
    expect(screen.queryByText('Delete this app?')).toBeNull();

    fireEvent.click(screen.getByLabelText('Delete app'));

    // The dialog appears and the destructive action has NOT fired yet.
    expect(screen.getByText('Delete this app?')).toBeTruthy();
    expect(doDelete).not.toHaveBeenCalled();
  });

  it('deletes only after confirming', async () => {
    const doDelete = vi.fn();
    renderToolbar(doDelete);

    fireEvent.click(screen.getByLabelText('Delete app'));
    fireEvent.click(screen.getByLabelText('Confirm delete app'));

    expect(doDelete).toHaveBeenCalledTimes(1);
    // Dialog closes after confirming (react-bootstrap fades it out).
    await waitFor(() =>
      expect(screen.queryByText('Delete this app?')).toBeNull()
    );
  });

  it('cancelling dismisses the dialog without deleting', async () => {
    const doDelete = vi.fn();
    renderToolbar(doDelete);

    fireEvent.click(screen.getByLabelText('Delete app'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(doDelete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Delete this app?')).toBeNull()
    );
  });
});
