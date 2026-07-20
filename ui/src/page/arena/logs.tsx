import React from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { FaPause, FaPlay, FaSearchMinus, FaSearchPlus } from 'react-icons/fa';
import { colors } from '../../util/colors';
import { titleCase } from '../../util/titleCase';

// Log console font-size bounds (mirrors the editor's zoom controls). Kept local
// rather than imported from appEditor so this page doesn't pull in Ace.
const LOG_FONT_MIN = 8;
const LOG_FONT_MAX = 30;
const LOG_FONT_DEFAULT = 12;

interface LogEntry {
  id: string;
  name: string;
  appId: string;
  botIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
}

interface LogsProps {
  // Every application in the arena, its position (for the readable bot id), and how
  // many bots it fields, so the filter lists them regardless of whether they've
  // logged yet.
  bots: { id: string; name: string; botCount: number; index: number }[];
  // When set (from shift-double-clicking a bot), show only this application's
  // logs — and, if selectedBot is also set, only that one bot instance.
  selectedApp?: string;
  selectedBot?: number;
  // The tick the arena has played up to. Log lines stamped later than this are
  // held back so they surface in step with the (buffered) on-screen motion.
  playbackTime?: number;
  logEntries: {
    logs: (LogEntry | null)[];
    index: number;
  };
  // Reflect filter state (search, hidden levels/bots) into the page URL via
  // replaceState, and seed it back on load — so a filtered view survives reload
  // and can be shared. Only the standalone logs page opts in; embedded uses
  // (the editor dock) leave the URL alone.
  persistFiltersToUrl?: boolean;
}

interface LogsState {
  search: string;
  hideLevels: string[];
  // Bots the user has toggled off, keyed `${appId}:${botIndex}`. An application
  // is "off" when all of its bots are hidden — the single source of truth.
  hideBots: string[];
  // Console font size, persisted so the preference survives reloads.
  fontSize: number;
  // Whether the view is attached to the live tail. Scrolling up detaches (new
  // lines stop moving the viewport); scrolling back to the bottom — or clicking
  // the "new lines" pill — re-attaches.
  follow: boolean;
  // A frozen copy of the log buffer taken when the user hit Pause, or null when
  // live. While set, the display renders this snapshot; the real buffer keeps
  // filling behind it.
  pausedLogs: { logs: (LogEntry | null)[]; index: number } | null;
  // Lines that arrived while detached and/or paused — the pill's "N new lines"
  // count and the held-line badge on the Pause button. Reset when the view is
  // both attached and unpaused again.
  newSince: number;
}

// Identify one bot in the hide set.
const botKey = (appId: string, botIndex: number) => `${appId}:${botIndex}`;

// Severity-first order for the toolbar level chips ("do I have errors?" reads
// left to right).
const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

export default class Logs extends React.Component<LogsProps, LogsState> {
  constructor(props: LogsProps) {
    super(props);
    const savedFont = Number(localStorage.getItem('logFontSize'));
    // On the standalone page, restore filter state from the URL (written back
    // by syncUrl below) so a reloaded or shared link reopens the same view.
    const params = props.persistFiltersToUrl
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const list = (key: string) =>
      (params.get(key) ?? '').split(',').filter(Boolean);
    this.state = {
      search: params.get('q') ?? '',
      hideLevels: list('hideLevels'),
      hideBots: list('hideBots'),
      fontSize:
        savedFont >= LOG_FONT_MIN && savedFont <= LOG_FONT_MAX
          ? savedFont
          : LOG_FONT_DEFAULT,
      follow: true,
      pausedLogs: null,
      newSince: 0,
    };
  }

  setFont(size: number) {
    const fontSize = Math.max(LOG_FONT_MIN, Math.min(LOG_FONT_MAX, size));
    localStorage.setItem('logFontSize', String(fontSize));
    this.setState({ fontSize });
  }

  logRef: React.RefObject<HTMLDivElement | null> =
    React.createRef<HTMLDivElement>();

  // Which URL selection (app[:bot]) we've already seeded the filter from, so a
  // shift-double-click applies once but the user's later toggles are preserved.
  appliedSelectionKey: string | null = null;

  componentDidMount() {
    this.applySelection();
  }

  componentDidUpdate(prevProps: LogsProps, prevState: LogsState) {
    // Once the bot list has loaded, reflect a shift-double-click selection in the
    // Bots filter itself (hide everything except the chosen app / bot), so the
    // dropdown matches what's shown and the user can toggle others back on.
    this.applySelection();

    // Mirror filter changes into the URL (replaceState — no history spam).
    if (
      this.props.persistFiltersToUrl &&
      (prevState.search !== this.state.search ||
        prevState.hideLevels !== this.state.hideLevels ||
        prevState.hideBots !== this.state.hideBots)
    ) {
      this.syncUrl();
    }

    // Count lines arriving while the user isn't watching the tail (detached
    // and/or paused) — the ring index only moves when an entry lands, so the
    // wrapped delta is the number of arrivals.
    const len = this.props.logEntries.logs.length;
    const delta =
      len > 0
        ? (this.props.logEntries.index - prevProps.logEntries.index + len) % len
        : 0;
    if (delta > 0 && (this.state.pausedLogs || !this.state.follow)) {
      this.setState((s) => ({ newSince: s.newSince + delta }));
    }

    // Attached and live: keep the viewport pinned to the newest line.
    if (this.state.follow && !this.state.pausedLogs) {
      const el = this.logRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight });
    }
  }

  // Scroll position is the follow/detach control: scrolling up detaches the
  // tail, scrolling back to the bottom re-attaches it. Only real scroll events
  // land here (content growth doesn't fire `scroll`), so the programmatic pin
  // above can't fight the user.
  onScroll = () => {
    const el = this.logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    if (atBottom && !this.state.follow) {
      this.setState((s) => ({
        follow: true,
        // Keep the held-line count while paused — those lines are still unseen.
        newSince: s.pausedLogs ? s.newSince : 0,
      }));
    } else if (!atBottom && this.state.follow) {
      this.setState({ follow: false });
    }
  };

  // The "N new lines" pill: jump to the bottom and re-attach.
  resumeFollow = () => {
    const el = this.logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
    this.setState((s) => ({
      follow: true,
      newSince: s.pausedLogs ? s.newSince : 0,
    }));
  };

  // Pause freezes the display on a snapshot of the buffer (the buffer itself
  // keeps filling — the button shows how many lines are being held). Note the
  // client ring buffer is finite: a long pause under heavy logging can evict
  // the oldest held lines before they're ever revealed.
  togglePause = () => {
    if (this.state.pausedLogs) {
      this.setState((s) => ({
        pausedLogs: null,
        newSince: s.follow ? 0 : s.newSince,
      }));
    } else {
      this.setState({
        pausedLogs: {
          logs: [...this.props.logEntries.logs],
          index: this.props.logEntries.index,
        },
      });
    }
  };

  // Write the current filter state into the query string. Empty filters are
  // dropped so an unfiltered view keeps a clean URL. The one-shot `app`/`bot`
  // seed params (from shift-double-clicking a bot) are removed once any filter
  // state is written — `hideBots` captures the same selection fully.
  syncUrl() {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key: string, value: string) =>
      value ? params.set(key, value) : params.delete(key);
    setOrDelete('q', this.state.search);
    setOrDelete('hideLevels', this.state.hideLevels.join(','));
    setOrDelete('hideBots', this.state.hideBots.join(','));
    params.delete('app');
    params.delete('bot');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    );
  }

  applySelection() {
    const { selectedApp, selectedBot, bots } = this.props;
    const hasSelection = !!selectedApp || selectedBot !== undefined;
    const selKey = `${selectedApp ?? ''}:${selectedBot ?? ''}`;
    if (!hasSelection) {
      this.appliedSelectionKey = selKey;
      return;
    }
    if (this.appliedSelectionKey === selKey) return;
    if (bots.length === 0) return; // wait until the bot list is known

    // Hide every bot except the selected app (and, if given, the selected bot).
    const hide: string[] = [];
    bots.forEach((bot) => {
      for (let i = 1; i <= bot.botCount; i++) {
        const keep =
          bot.id === selectedApp &&
          (selectedBot === undefined || i === selectedBot);
        if (!keep) hide.push(botKey(bot.id, i));
      }
    });
    this.appliedSelectionKey = selKey;
    this.setState({ hideBots: hide });
  }

  render() {
    // The applications (and their bot counts) the filter offers: the arena's
    // current bots, plus any that have logged but aren't listed (e.g. removed
    // mid-match), so nothing vanishes from the filter.
    const appMap = new Map<
      string,
      { name: string; botCount: number; index?: number }
    >();
    this.props.bots.forEach((b) =>
      appMap.set(b.id, { name: b.name, botCount: b.botCount, index: b.index })
    );
    this.props.logEntries.logs.forEach((entry) => {
      if (!entry) return;
      const cur = appMap.get(entry.appId);
      if (!cur)
        appMap.set(entry.appId, {
          name: entry.appId,
          botCount: entry.botIndex,
        });
      else if (entry.botIndex > cur.botCount) cur.botCount = entry.botIndex;
    });
    const apps = [...appMap.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // The readable bot id ("11" = first app's first bot). Prefer the actual log
    // name "<11>" (authoritative), falling back to computing it from the app's
    // arena position only for bots that haven't logged yet.
    const logIdByBot = new Map<string, string>();
    this.props.logEntries.logs.forEach((entry) => {
      if (!entry) return;
      const key = botKey(entry.appId, entry.botIndex);
      if (!logIdByBot.has(key)) {
        const num = (entry.name ?? '').replace(/\D/g, '');
        if (num) logIdByBot.set(key, num);
      }
    });
    const readableId = (
      app: { id: string; index?: number },
      botIndex: number
    ) =>
      logIdByBot.get(botKey(app.id, botIndex)) ??
      (app.index !== undefined
        ? String((app.index + 1) * 10 + botIndex)
        : String(botIndex));

    const botsOf = (app: { id: string; botCount: number }) =>
      Array.from({ length: app.botCount }, (_, i) => botKey(app.id, i + 1));
    const allBotKeys = apps.flatMap(botsOf);
    const hidden = new Set(this.state.hideBots);
    // An application is shown while at least one of its bots is visible.
    const appShown = (app: { id: string; botCount: number }) =>
      botsOf(app).some((k) => !hidden.has(k));
    const setHidden = (keys: string[], hide: boolean) => {
      const next = new Set(this.state.hideBots);
      keys.forEach((k) => (hide ? next.add(k) : next.delete(k)));
      this.setState({ hideBots: [...next] });
    };

    // Click-to-filter from a log line: the team chip narrows to that app's
    // bots, the bot id to that one instance (a key is `${appId}:${botIndex}`,
    // so the app is everything before the last colon).
    const filterToApp = (appId: string) =>
      this.setState({
        hideBots: allBotKeys.filter(
          (k) => k.slice(0, k.lastIndexOf(':')) !== appId
        ),
      });
    const filterToBot = (appId: string, botIndex: number) =>
      this.setState({
        hideBots: allBotKeys.filter((k) => k !== botKey(appId, botIndex)),
      });

    const levelColors: Record<string, string> = {
      trace: 'lightgrey',
      error: 'red',
      warn: 'yellow',
      debug: 'blue',
      info: 'green',
    };

    // Everything except the level filter, shared by the visible-line filter and
    // the per-level chip counts (a chip counts what toggling it would affect).
    const source = (this.state.pausedLogs ?? this.props.logEntries).logs;
    const passesBase = (record: LogEntry | null): record is LogEntry =>
      !!record &&
      record.time <= (this.props.playbackTime ?? Number.POSITIVE_INFINITY) &&
      !hidden.has(botKey(record.appId, record.botIndex)) &&
      // Free-text search matches what the user can actually see — the message
      // and the bot name — not the serialized record (which would hit internal
      // ids, levels, and timestamps).
      (this.state.search.length === 0 ||
        matchesSearch(record, this.state.search));

    const levelCounts: Record<string, number> = {};
    LEVELS.forEach((level) => (levelCounts[level] = 0));
    source.forEach((record) => {
      if (passesBase(record)) {
        const level = record.levelName.toUpperCase();
        levelCounts[level] = (levelCounts[level] ?? 0) + 1;
      }
    });

    // Team chip for a log line: the app's arena color swatch (the same mini tank
    // sprite the navbar/roster use) plus its name, so a line reads as its team at
    // a glance rather than only from the internal `<id>` — which is kept after it
    // to disambiguate a team's five bots (GitHub #253). An app with no live arena
    // index (logged then removed mid-match) gets a muted neutral swatch and no
    // name (its only "name" would be the raw id, already implied by `<id>`).
    // Clicking the chip narrows the filter to that app (GitHub #316).
    const teamChip = (appId: string) => {
      const app = appMap.get(appId);
      const index = app?.index;
      const src =
        index !== undefined
          ? `/sprites/tank_${colors[index]}.png`
          : '/sprites/tank_dark.png';
      const name = app && app.name !== appId ? titleCase(app.name) : '';
      return (
        <span
          className="team"
          role="button"
          title="Show only this app's logs"
          onClick={() => filterToApp(appId)}
          style={{ marginRight: '5px', cursor: 'pointer' }}
        >
          <img
            src={src}
            alt=""
            style={{
              height: '1em',
              marginRight: name ? '4px' : 0,
              verticalAlign: '-0.15em',
              opacity: index !== undefined ? 1 : 0.4,
            }}
          />
          {name}
        </span>
      );
    };

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          paddingRight: '15px',
        }}
      >
        {/* Toolbar — pinned above the scroll area, styled like the editor's. */}
        <ButtonToolbar
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 0',
            flexShrink: 0,
          }}
        >
          <ButtonGroup>
            <OverlayTrigger
              placement="bottom"
              overlay={<Tooltip id="log-zoom-out">Smaller text</Tooltip>}
            >
              <Button
                variant="secondary"
                size="sm"
                aria-label="Smaller log text"
                onClick={() => this.setFont(this.state.fontSize - 1)}
                disabled={this.state.fontSize <= LOG_FONT_MIN}
              >
                <FaSearchMinus />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger
              placement="bottom"
              overlay={<Tooltip id="log-zoom-reset">Reset text size</Tooltip>}
            >
              <Button
                variant="secondary"
                size="sm"
                aria-label="Reset log text size"
                onClick={() => this.setFont(LOG_FONT_DEFAULT)}
                style={{ minWidth: '2.5em' }}
              >
                {this.state.fontSize}
              </Button>
            </OverlayTrigger>
            <OverlayTrigger
              placement="bottom"
              overlay={<Tooltip id="log-zoom-in">Larger text</Tooltip>}
            >
              <Button
                variant="secondary"
                size="sm"
                aria-label="Larger log text"
                onClick={() => this.setFont(this.state.fontSize + 1)}
                disabled={this.state.fontSize >= LOG_FONT_MAX}
              >
                <FaSearchPlus />
              </Button>
            </OverlayTrigger>
          </ButtonGroup>

          {/* autoClose="outside" keeps the menu open while toggling checkboxes. */}
          <Dropdown as={ButtonGroup} autoClose="outside">
            <Dropdown.Toggle variant="secondary" size="sm" id="bots-filter">
              Bots
            </Dropdown.Toggle>
            <Dropdown.Menu>
              {apps.map((app) => (
                <React.Fragment key={app.id}>
                  <Dropdown.Item
                    as="button"
                    // Toggle the whole application (all of its bots).
                    onClick={() => setHidden(botsOf(app), appShown(app))}
                  >
                    <Form.Check
                      checked={appShown(app)}
                      readOnly
                      inline
                      type="checkbox"
                      id={`bot-${app.id}`}
                    />
                    <strong>{app.name}</strong>
                  </Dropdown.Item>
                  {botsOf(app).map((key, i) => (
                    <Dropdown.Item
                      as="button"
                      key={key}
                      style={{ paddingLeft: '2.5em' }}
                      // Toggle just this bot.
                      onClick={() => setHidden([key], !hidden.has(key))}
                    >
                      <Form.Check
                        checked={!hidden.has(key)}
                        readOnly
                        inline
                        type="checkbox"
                        id={`bot-${key}`}
                      />
                      Bot {readableId(app, i + 1)}
                    </Dropdown.Item>
                  ))}
                </React.Fragment>
              ))}
              <Dropdown.Divider />
              <Dropdown.Item
                as="button"
                onClick={() => setHidden(allBotKeys, false)}
              >
                Select All
              </Dropdown.Item>
              <Dropdown.Item
                as="button"
                onClick={() => setHidden(allBotKeys, true)}
              >
                Deselect All
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>

          {/* Level chips: one per level with a live count of matching lines —
              an at-a-glance health readout ("do I have errors?") that toggles
              the level on click. Replaces the old Levels dropdown. */}
          <ButtonGroup>
            {LEVELS.map((level) => {
              const isHidden = this.state.hideLevels.includes(level);
              return (
                <OverlayTrigger
                  key={level}
                  placement="bottom"
                  overlay={
                    <Tooltip id={`level-chip-${level}`}>
                      {isHidden ? `Show ${level} logs` : `Hide ${level} logs`}
                    </Tooltip>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Toggle ${level} logs`}
                    aria-pressed={!isHidden}
                    onClick={() =>
                      this.setState((s) => ({
                        hideLevels: isHidden
                          ? s.hideLevels.filter((l) => l !== level)
                          : [...s.hideLevels, level],
                      }))
                    }
                    style={{
                      opacity: isHidden ? 0.45 : 1,
                      textDecoration: isHidden ? 'line-through' : 'none',
                    }}
                  >
                    <span
                      style={{ color: levelColors[level.toLowerCase()] }}
                      // The colored token is the label; the count sits after it.
                    >
                      {level}
                    </span>{' '}
                    {levelCounts[level]}
                  </Button>
                </OverlayTrigger>
              );
            })}
          </ButtonGroup>

          {/* One-click way back to the unfiltered view once a click-to-filter
              (or any Bots toggle) has narrowed the stream. */}
          {this.state.hideBots.length > 0 && (
            <Button
              variant="outline-secondary"
              size="sm"
              aria-label="Show all bots"
              onClick={() => this.setState({ hideBots: [] })}
            >
              All bots ×
            </Button>
          )}

          <Form.Control
            value={this.state.search}
            onChange={(e) => this.setState({ search: e.target.value })}
            type="search"
            placeholder="Filter"
            size="sm"
            style={{ maxWidth: '12em' }}
          />

          <OverlayTrigger
            placement="bottom"
            overlay={
              <Tooltip id="log-pause">
                {this.state.pausedLogs
                  ? 'Resume log output'
                  : 'Pause log output'}
              </Tooltip>
            }
          >
            <Button
              variant={this.state.pausedLogs ? 'warning' : 'secondary'}
              size="sm"
              aria-label={
                this.state.pausedLogs ? 'Resume log output' : 'Pause log output'
              }
              onClick={this.togglePause}
            >
              {this.state.pausedLogs ? <FaPlay /> : <FaPause />}
              {this.state.pausedLogs && this.state.newSince > 0 && (
                <span style={{ marginLeft: '5px' }}>{this.state.newSince}</span>
              )}
            </Button>
          </OverlayTrigger>
        </ButtonToolbar>

        {/* Log list — fills the remaining height and scrolls on its own. The
            wrapper is the positioning context for the floating "new lines"
            pill so it stays put while the list scrolls under it. */}
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <div
            className="logs"
            ref={this.logRef}
            onScroll={this.onScroll}
            style={{
              height: '100%',
              overflowY: 'auto',
              fontFamily:
                'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
              fontSize: `${this.state.fontSize}px`,
            }}
          >
            <div>
              {source
                .filter(
                  (record) =>
                    passesBase(record) &&
                    !this.state.hideLevels.includes(
                      record.levelName.toUpperCase()
                    )
                )
                .sort((a, b) =>
                  a !== null && b !== null ? a.time - b.time : 0
                )
                .map(
                  (record) =>
                    record && (
                      <span key={record.id}>
                        <span
                          style={{
                            marginRight: '5px',
                          }}
                        >
                          [<span className="date">{record.time}</span>]
                        </span>
                        <span
                          style={{
                            marginRight: '5px',
                          }}
                        >
                          [
                          <span
                            style={{
                              color: levelColors[record.levelName] || 'white',
                            }}
                          >
                            {record.levelName.toUpperCase()}
                          </span>
                          ]
                        </span>
                        {teamChip(record.appId)}
                        <span
                          className="name"
                          role="button"
                          title="Show only this bot's logs"
                          onClick={() =>
                            filterToBot(record.appId, record.botIndex)
                          }
                          style={{
                            marginRight: '5px',
                            cursor: 'pointer',
                          }}
                        >
                          {record.name}
                        </span>
                        <span className="message">{record.msg}</span>
                        <br />
                      </span>
                    )
                )}
            </div>
          </div>

          {/* Detached from the tail: a floating pill offers the way back down,
              with a live count of the lines that have arrived meanwhile. Hidden
              while paused — the Pause button carries the held count then. */}
          {!this.state.follow && !this.state.pausedLogs && (
            <Button
              size="sm"
              variant="primary"
              onClick={this.resumeFollow}
              aria-label="Scroll to latest logs"
              style={{
                position: 'absolute',
                bottom: '10px',
                left: '50%',
                transform: 'translateX(-50%)',
                borderRadius: '1em',
                boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              ↓{' '}
              {this.state.newSince > 0
                ? `${this.state.newSince} new line${
                    this.state.newSince === 1 ? '' : 's'
                  }`
                : 'Latest'}
            </Button>
          )}
        </div>
      </div>
    );
  }
}

// Case-insensitive match against the fields a log line actually displays.
function matchesSearch(record: LogEntry, search: string): boolean {
  const q = search.toLowerCase();
  return (
    (record.msg ?? '').toLowerCase().includes(q) ||
    (record.name ?? '').toLowerCase().includes(q)
  );
}
