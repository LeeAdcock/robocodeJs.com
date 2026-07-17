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
const renderToolbar = (doDelete: () => void) =>
  render(
    <EditorToolbar
      code="bot.setName('x')"
      appName="My Bot"
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

describe('EditorToolbar labels', () => {
  it('labels the two save actions in text, and leaves the rest icon-only', () => {
    renderToolbar(noop);

    // The lessons have to name these two in prose, so the buttons name
    // themselves rather than relying on a tooltip.
    // trim(): the icon and the label are separated by a text-node space.
    expect(screen.getByLabelText('Deploy bot').textContent?.trim()).toBe(
      'Deploy'
    );
    expect(screen.getByLabelText('Reboot bot').textContent?.trim()).toBe(
      'Reboot'
    );

    // Secondary actions stay icon-only — tooltips are enough, and the toolbar
    // is tight at narrow pane widths.
    expect(screen.getByLabelText('Check for errors').textContent).toBe('');
    expect(screen.getByLabelText('Reformat code').textContent).toBe('');
    expect(screen.getByLabelText('Copy share link').textContent).toBe('');
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

describe('EditorToolbar accessible names (#132)', () => {
  // Every icon-only button needs an aria-label so screen-reader users get an
  // accessible name (the icon alone exposes nothing). The Download button was
  // the one missing it.
  it('labels the Download button', () => {
    renderToolbar(noop);
    expect(screen.getByLabelText('Download app')).toBeTruthy();
  });

  it('leaves no icon button without an accessible name', () => {
    renderToolbar(noop);
    for (const button of screen.getAllByRole('button')) {
      const name =
        button.getAttribute('aria-label') || button.textContent?.trim();
      expect(name).toBeTruthy();
    }
  });
});
