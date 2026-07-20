// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import Logs from '../src/page/arena/logs';

// jsdom doesn't implement Element.scrollTo; the log panel calls it when it
// re-renders to keep pinned to the bottom.
Element.prototype.scrollTo = () => {};

interface Entry {
  id: string;
  name: string;
  appId: string;
  botIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
  // Lifecycle divider rows (see useLogsStream.addLogMarker).
  marker?: string;
}
let seq = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${seq++}`,
  name: '<11>',
  appId: 'a1',
  botIndex: 1,
  level: 30,
  levelName: 'info',
  msg: 'hi',
  time: 0,
  ...over,
});
const bots = [
  { id: 'a1', name: 'Bot A', botCount: 2, index: 0 },
  { id: 'a2', name: 'Bot B', botCount: 2, index: 1 },
];

afterEach(cleanup);

describe('Logs (per-bot filtering)', () => {
  it('selectedApp shows only the chosen bot’s messages', () => {
    render(
      <Logs
        bots={bots}
        selectedApp="a1"
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', msg: 'from A' }),
            entry({ appId: 'a2', msg: 'from B' }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from A')).toBeTruthy();
    expect(screen.queryByText('from B')).toBeNull();
  });

  it('selectedBot narrows to one bot instance and reflects it in the filter', () => {
    const { container } = render(
      <Logs
        bots={bots}
        selectedApp="a1"
        selectedBot={2}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', botIndex: 1, msg: 'a1 bot one' }),
            entry({ appId: 'a1', botIndex: 2, msg: 'a1 bot two' }),
            entry({ appId: 'a2', botIndex: 2, msg: 'a2 bot two' }),
          ],
          index: 3,
        }}
      />
    );
    // Only app a1's bot 2 is shown.
    expect(screen.queryByText('a1 bot two')).toBeTruthy();
    expect(screen.queryByText('a1 bot one')).toBeNull();
    expect(screen.queryByText('a2 bot two')).toBeNull();

    // ...and the Bots filter reflects it: only that bot's checkbox is checked.
    fireEvent.click(screen.getByText('Bots'));
    const selected = container.querySelector(
      '[id="bot-a1:2"]'
    ) as HTMLInputElement;
    const other = container.querySelector(
      '[id="bot-a1:1"]'
    ) as HTMLInputElement;
    expect(selected.checked).toBe(true);
    expect(other.checked).toBe(false);
  });

  it('labels a bot from its actual log name, not the computed index', () => {
    // index 5 would compute (5+1)*10+1 = 61, but the log name is authoritative.
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', botCount: 1, index: 5 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [entry({ appId: 'a1', botIndex: 1, name: '<99>', msg: 'x' })],
          index: 1,
        }}
      />
    );
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot 99')).toBeTruthy();
    expect(screen.queryByText('Bot 61')).toBeNull();
  });

  it('prefixes each line with the app’s color swatch and name, keeping the bot id', () => {
    const { container } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [entry({ appId: 'a2', name: '<21>', msg: 'from B' })],
          index: 1,
        }}
      />
    );
    // The team chip names the app (Bot B) and the internal id (<21>) is kept
    // after it; the swatch is the app's arena-index hue (a2 = index 1 → 'dark').
    expect(screen.getByText('Bot B')).toBeTruthy();
    expect(screen.getByText('<21>')).toBeTruthy();
    const swatch = container.querySelector('.team img') as HTMLImageElement;
    expect(swatch.getAttribute('src')).toContain('tank_dark.png');
  });

  it('shows a muted neutral swatch and no name for an app no longer in the arena', () => {
    const { container } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          // 'gone' isn't in `bots` (logged then removed mid-match), so it has no
          // live arena color — a neutral swatch, and no name (its only "name"
          // would be the raw id, already implied by <71>).
          logs: [entry({ appId: 'gone', name: '<71>', msg: 'orphan' })],
          index: 1,
        }}
      />
    );
    expect(screen.getByText('orphan')).toBeTruthy();
    const swatch = container.querySelector('.team img') as HTMLImageElement;
    expect(swatch.getAttribute('src')).toContain('tank_dark.png');
    expect(swatch.style.opacity).toBe('0.4');
  });

  it('zooms the log font in and out and persists the size', () => {
    localStorage.clear();
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{ logs: [], index: 0 }}
      />
    );
    // The reset button doubles as the current-size indicator (default 12).
    const reset = screen.getByLabelText('Reset log text size');
    expect(reset.textContent).toBe('12');

    fireEvent.click(screen.getByLabelText('Larger log text'));
    expect(reset.textContent).toBe('13');
    expect(localStorage.getItem('logFontSize')).toBe('13');

    fireEvent.click(screen.getByLabelText('Smaller log text'));
    fireEvent.click(screen.getByLabelText('Smaller log text'));
    expect(reset.textContent).toBe('11');
  });

  it('lists all arena bots in the filter even before any logs arrive', () => {
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{ logs: [], index: 0 }}
      />
    );
    // Open the Bots dropdown; both names are present despite an empty log buffer.
    fireEvent.click(screen.getByText('Bots'));
    expect(screen.getByText('Bot A')).toBeTruthy();
    expect(screen.getByText('Bot B')).toBeTruthy();
  });

  it('search matches the visible message/name, not the serialized record', () => {
    const { container } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'Enemy Spotted', levelName: 'info' }),
            entry({ msg: 'turning left', levelName: 'info' }),
          ],
          index: 2,
        }}
      />
    );
    const search = container.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;

    // "info" appears in every record's levelName (and appId-ish internals used
    // to match too) — but in no visible message, so nothing should match.
    fireEvent.change(search, { target: { value: 'info' } });
    expect(screen.queryByText('Enemy Spotted')).toBeNull();
    expect(screen.queryByText('turning left')).toBeNull();

    // Message text matches case-insensitively.
    fireEvent.change(search, { target: { value: 'enemy spotted' } });
    expect(screen.queryByText('Enemy Spotted')).toBeTruthy();
    expect(screen.queryByText('turning left')).toBeNull();

    // The bot name (the visible <id>) matches too.
    fireEvent.change(search, { target: { value: '<11>' } });
    expect(screen.queryByText('Enemy Spotted')).toBeTruthy();
  });

  it('pause freezes the display, counts held lines, and resume reveals them', () => {
    const first = entry({ msg: 'before pause' });
    const ring = (entries: Entry[]) => ({
      // A fixed-capacity ring like the real page's, so the held-line count can
      // be derived from the index delta.
      logs: [...entries, ...new Array(10 - entries.length).fill(null)],
      index: entries.length,
    });
    const { rerender } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={ring([first])}
      />
    );
    expect(screen.queryByText('before pause')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Pause log output'));

    // Two more lines land while paused: display frozen, held count on the button.
    const second = entry({ msg: 'while paused 1' });
    const third = entry({ msg: 'while paused 2' });
    rerender(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={ring([first, second, third])}
      />
    );
    expect(screen.queryByText('while paused 1')).toBeNull();
    const resume = screen.getByLabelText('Resume log output');
    expect(resume.textContent).toContain('2');

    // Resume reveals everything logged in between.
    fireEvent.click(resume);
    expect(screen.queryByText('while paused 1')).toBeTruthy();
    expect(screen.queryByText('while paused 2')).toBeTruthy();
  });

  it('scrolling up detaches the tail and shows a new-lines pill that re-attaches', () => {
    const first = entry({ msg: 'line one' });
    const ring = (entries: Entry[]) => ({
      logs: [...entries, ...new Array(10 - entries.length).fill(null)],
      index: entries.length,
    });
    const { container, rerender } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={ring([first])}
      />
    );
    const scroller = container.querySelector('.logs') as HTMLDivElement;

    // jsdom has no layout — fake a scrolled-up viewport (tall content, at top).
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    // Detached: no pill yet (nothing new)... until a line arrives.
    rerender(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={ring([first, entry({ msg: 'line two' })])}
      />
    );
    const pill = screen.getByLabelText('Scroll to latest logs');
    expect(pill.textContent).toContain('1 new line');

    // Clicking the pill re-attaches and clears the count.
    fireEvent.click(pill);
    expect(screen.queryByLabelText('Scroll to latest logs')).toBeNull();
  });

  it('level chips show live counts and toggle their level on click', () => {
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'ok one', levelName: 'info' }),
            entry({ msg: 'ok two', levelName: 'info' }),
            entry({ msg: 'boom', levelName: 'error' }),
          ],
          index: 3,
        }}
      />
    );
    const errorChip = screen.getByLabelText('Toggle ERROR logs');
    const infoChip = screen.getByLabelText('Toggle INFO logs');
    expect(errorChip.textContent).toContain('1');
    expect(infoChip.textContent).toContain('2');

    // Toggle ERROR off: the error line hides, the chip reads pressed=false.
    fireEvent.click(errorChip);
    expect(screen.queryByText('boom')).toBeNull();
    expect(screen.queryByText('ok one')).toBeTruthy();
    expect(errorChip.getAttribute('aria-pressed')).toBe('false');

    // ...and back on.
    fireEvent.click(errorChip);
    expect(screen.queryByText('boom')).toBeTruthy();
  });

  it('clicking a team chip filters to that app; "All bots ×" clears it', () => {
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', name: '<11>', msg: 'from A' }),
            entry({ appId: 'a2', name: '<21>', msg: 'from B' }),
          ],
          index: 2,
        }}
      />
    );
    // Click the team chip on A's line.
    const chips = screen.getAllByTitle("Show only this app's logs");
    fireEvent.click(chips[0]);
    expect(screen.queryByText('from A')).toBeTruthy();
    expect(screen.queryByText('from B')).toBeNull();

    // The clear chip restores the unfiltered view.
    fireEvent.click(screen.getByLabelText('Show all bots'));
    expect(screen.queryByText('from B')).toBeTruthy();
  });

  it('clicking a bot id filters to that one bot instance', () => {
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', botCount: 2, index: 0 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', botIndex: 1, name: '<11>', msg: 'bot one' }),
            entry({ appId: 'a1', botIndex: 2, name: '<12>', msg: 'bot two' }),
          ],
          index: 2,
        }}
      />
    );
    fireEvent.click(screen.getByText('<12>'));
    expect(screen.queryByText('bot two')).toBeTruthy();
    expect(screen.queryByText('bot one')).toBeNull();
  });

  it('persists filters to the URL and restores them on load', () => {
    window.history.replaceState(null, '', '/user/u1/arena/logs');
    const logEntries = {
      logs: [
        entry({ msg: 'needle in here', levelName: 'info' }),
        entry({ msg: 'boom', levelName: 'error' }),
      ],
      index: 2,
    };
    const { container, unmount } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={logEntries}
        persistFiltersToUrl
      />
    );
    const search = container.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'needle' } });
    fireEvent.click(screen.getByLabelText('Toggle ERROR logs'));
    expect(window.location.search).toContain('q=needle');
    expect(window.location.search).toContain('hideLevels=ERROR');
    unmount();

    // A fresh mount (reload) seeds the same view back from the URL.
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={logEntries}
        persistFiltersToUrl
      />
    );
    const restored = document.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;
    expect(restored.value).toBe('needle');
    expect(
      screen.getByLabelText('Toggle ERROR logs').getAttribute('aria-pressed')
    ).toBe('false');
    window.history.replaceState(null, '', '/');
  });

  it('renders lifecycle markers as dividers that bypass the bot/level filters', () => {
    render(
      <Logs
        bots={bots}
        // Filtered to app a1 only — the divider must still show.
        selectedApp="a1"
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ appId: 'a1', msg: 'before' }),
            entry({
              marker: 'restart',
              msg: 'Match restarted',
              appId: '',
              botIndex: 0,
              levelName: '',
              name: '',
            }),
            entry({ appId: 'a1', msg: 'after' }),
          ],
          index: 3,
        }}
      />
    );
    const divider = screen.getByText('Match restarted');
    expect(divider.className).toContain('log-divider');
    // Arrival order: before → divider → after.
    expect(screen.queryByText('before')).toBeTruthy();
    expect(screen.queryByText('after')).toBeTruthy();
  });

  it('collapses consecutive duplicate lines into one ×N row', () => {
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'scanning', time: 1 }),
            entry({ msg: 'scanning', time: 2 }),
            entry({ msg: 'scanning', time: 3 }),
            entry({ msg: 'firing', time: 4 }),
            entry({ msg: 'scanning', time: 5 }),
          ],
          index: 5,
        }}
      />
    );
    // The run of three renders once, with a ×3 counter; the later, non-adjacent
    // 'scanning' stays its own row.
    expect(screen.getAllByText('scanning').length).toBe(2);
    expect(screen.getByText('×3')).toBeTruthy();
    expect(screen.queryByText('×2')).toBeNull();
  });

  it('next/previous error jumps between ERROR rows', () => {
    const { container } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'fine', levelName: 'info', time: 1 }),
            entry({ msg: 'boom one', levelName: 'error', time: 2 }),
            entry({ msg: 'fine again', levelName: 'info', time: 3 }),
            entry({ msg: 'boom two', levelName: 'error', time: 4 }),
          ],
          index: 4,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText('Next error'));
    const flashed = () =>
      Array.from(container.querySelectorAll('.log-jump')).map(
        (el) => el.textContent
      );
    expect(flashed()[0]).toContain('boom one');

    fireEvent.click(screen.getByLabelText('Next error'));
    expect(flashed().some((t) => t?.includes('boom two'))).toBe(true);
  });

  it('highlight mode marks matches in place instead of filtering', () => {
    const { container } = render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'the needle is here', time: 1 }),
            entry({ msg: 'plain line', time: 2 }),
          ],
          index: 2,
        }}
      />
    );
    const search = container.querySelector(
      'input[type="search"]'
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'needle' } });
    // Filtering (default): the non-matching line is gone.
    expect(screen.queryByText('plain line')).toBeNull();

    fireEvent.click(
      screen.getByLabelText('Highlight matches instead of filtering')
    );
    // Highlighting: both lines visible, the match marked, a count shown.
    expect(screen.queryByText('plain line')).toBeTruthy();
    expect(container.querySelector('mark')?.textContent).toBe('needle');
    expect(screen.getByText('1 match')).toBeTruthy();
  });

  it('copies the visible (filtered) lines to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(
      <Logs
        bots={bots}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({ msg: 'kept', levelName: 'info', time: 1 }),
            entry({ msg: 'kept', levelName: 'info', time: 2 }),
            entry({ msg: 'hidden', levelName: 'debug', time: 3 }),
          ],
          index: 3,
        }}
      />
    );
    // Hide DEBUG, then copy: only the collapsed 'kept' row should be present.
    fireEvent.click(screen.getByLabelText('Toggle DEBUG logs'));
    fireEvent.click(screen.getByLabelText('Copy visible logs'));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('kept ×2');
    expect(text).not.toContain('hidden');
  });

  it('can hide an individual bot (labelled by its bot id) within an application', () => {
    render(
      <Logs
        bots={[{ id: 'a1', name: 'Bot A', botCount: 2, index: 0 }]}
        playbackTime={Number.POSITIVE_INFINITY}
        logEntries={{
          logs: [
            entry({
              appId: 'a1',
              botIndex: 1,
              name: '<11>',
              msg: 'from bot one',
            }),
            entry({
              appId: 'a1',
              botIndex: 2,
              name: '<12>',
              msg: 'from bot two',
            }),
          ],
          index: 2,
        }}
      />
    );
    expect(screen.queryByText('from bot one')).toBeTruthy();
    expect(screen.queryByText('from bot two')).toBeTruthy();

    // Open the Bots dropdown and hide just the first bot — labelled from its log
    // name "<11>" → "Bot 11".
    fireEvent.click(screen.getByText('Bots'));
    fireEvent.click(screen.getByText('Bot 11'));

    expect(screen.queryByText('from bot one')).toBeNull();
    expect(screen.queryByText('from bot two')).toBeTruthy();
  });
});
