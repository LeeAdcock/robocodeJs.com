import React from 'react';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import Dropdown from 'react-bootstrap/Dropdown';
import Form from 'react-bootstrap/Form';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { FaSearchMinus, FaSearchPlus } from 'react-icons/fa';

// Log console font-size bounds (mirrors the editor's zoom controls). Kept local
// rather than imported from appEditor so this page doesn't pull in Ace.
const LOG_FONT_MIN = 8;
const LOG_FONT_MAX = 30;
const LOG_FONT_DEFAULT = 12;

interface LogEntry {
  id: string;
  name: string;
  appId: string;
  tankIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
}

interface LogsProps {
  // Every application in the arena, its position (for the readable bot id), and how
  // many tanks it fields, so the filter lists them regardless of whether they've
  // logged yet.
  bots: { id: string; name: string; tankCount: number; index: number }[];
  // When set (from shift-double-clicking a tank), show only this application's
  // logs — and, if selectedTank is also set, only that one tank instance.
  selectedApp?: string;
  selectedTank?: number;
  // The tick the arena has played up to. Log lines stamped later than this are
  // held back so they surface in step with the (buffered) on-screen motion.
  playbackTime?: number;
  logEntries: {
    logs: (LogEntry | null)[];
    index: number;
  };
}

interface LogsState {
  search: string;
  hideLevels: string[];
  // Tanks the user has toggled off, keyed `${appId}:${tankIndex}`. An application
  // is "off" when all of its tanks are hidden — the single source of truth.
  hideTanks: string[];
  // Console font size, persisted so the preference survives reloads.
  fontSize: number;
}

// Identify one tank in the hide set.
const tankKey = (appId: string, tankIndex: number) => `${appId}:${tankIndex}`;

export default class Logs extends React.Component<LogsProps, LogsState> {
  constructor(props: LogsProps) {
    super(props);
    const savedFont = Number(localStorage.getItem('logFontSize'));
    this.state = {
      search: '',
      hideLevels: [],
      hideTanks: [],
      fontSize:
        savedFont >= LOG_FONT_MIN && savedFont <= LOG_FONT_MAX
          ? savedFont
          : LOG_FONT_DEFAULT,
    };
  }

  setFont(size: number) {
    const fontSize = Math.max(LOG_FONT_MIN, Math.min(LOG_FONT_MAX, size));
    localStorage.setItem('logFontSize', String(fontSize));
    this.setState({ fontSize });
  }

  logRef: React.RefObject<HTMLDivElement | null> =
    React.createRef<HTMLDivElement>();

  // Which URL selection (app[:tank]) we've already seeded the filter from, so a
  // shift-double-click applies once but the user's later toggles are preserved.
  appliedSelectionKey: string | null = null;

  componentDidMount() {
    this.applySelection();
  }

  componentDidUpdate() {
    // Once the bot list has loaded, reflect a shift-double-click selection in the
    // Bots filter itself (hide everything except the chosen app / tank), so the
    // dropdown matches what's shown and the user can toggle others back on.
    this.applySelection();

    // Pin to the bottom of the scroll area
    const el = this.logRef.current;
    if (!el) return;
    const parentHeight = (el.children[0] as HTMLElement).offsetHeight;
    const height = el.offsetHeight;
    const scrollTop = el.scrollTop;
    if (Math.abs(scrollTop - (parentHeight - height)) < 200) {
      el.scrollTo({ top: parentHeight });
    }
  }

  applySelection() {
    const { selectedApp, selectedTank, bots } = this.props;
    const hasSelection = !!selectedApp || selectedTank !== undefined;
    const selKey = `${selectedApp ?? ''}:${selectedTank ?? ''}`;
    if (!hasSelection) {
      this.appliedSelectionKey = selKey;
      return;
    }
    if (this.appliedSelectionKey === selKey) return;
    if (bots.length === 0) return; // wait until the bot list is known

    // Hide every tank except the selected app (and, if given, the selected tank).
    const hide: string[] = [];
    bots.forEach((bot) => {
      for (let i = 1; i <= bot.tankCount; i++) {
        const keep =
          bot.id === selectedApp &&
          (selectedTank === undefined || i === selectedTank);
        if (!keep) hide.push(tankKey(bot.id, i));
      }
    });
    this.appliedSelectionKey = selKey;
    this.setState({ hideTanks: hide });
  }

  render() {
    // The applications (and their tank counts) the filter offers: the arena's
    // current bots, plus any that have logged but aren't listed (e.g. removed
    // mid-match), so nothing vanishes from the filter.
    const appMap = new Map<
      string,
      { name: string; tankCount: number; index?: number }
    >();
    this.props.bots.forEach((b) =>
      appMap.set(b.id, { name: b.name, tankCount: b.tankCount, index: b.index })
    );
    this.props.logEntries.logs.forEach((entry) => {
      if (!entry) return;
      const cur = appMap.get(entry.appId);
      if (!cur)
        appMap.set(entry.appId, {
          name: entry.appId,
          tankCount: entry.tankIndex,
        });
      else if (entry.tankIndex > cur.tankCount) cur.tankCount = entry.tankIndex;
    });
    const apps = [...appMap.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // The readable bot id ("11" = first app's first tank). Prefer the actual log
    // name "<11>" (authoritative), falling back to computing it from the app's
    // arena position only for tanks that haven't logged yet.
    const logIdByTank = new Map<string, string>();
    this.props.logEntries.logs.forEach((entry) => {
      if (!entry) return;
      const key = tankKey(entry.appId, entry.tankIndex);
      if (!logIdByTank.has(key)) {
        const num = (entry.name ?? '').replace(/\D/g, '');
        if (num) logIdByTank.set(key, num);
      }
    });
    const readableId = (
      app: { id: string; index?: number },
      tankIndex: number
    ) =>
      logIdByTank.get(tankKey(app.id, tankIndex)) ??
      (app.index !== undefined
        ? String((app.index + 1) * 10 + tankIndex)
        : String(tankIndex));

    const tanksOf = (app: { id: string; tankCount: number }) =>
      Array.from({ length: app.tankCount }, (_, i) => tankKey(app.id, i + 1));
    const allTankKeys = apps.flatMap(tanksOf);
    const hidden = new Set(this.state.hideTanks);
    // An application is shown while at least one of its tanks is visible.
    const appShown = (app: { id: string; tankCount: number }) =>
      tanksOf(app).some((k) => !hidden.has(k));
    const setHidden = (keys: string[], hide: boolean) => {
      const next = new Set(this.state.hideTanks);
      keys.forEach((k) => (hide ? next.add(k) : next.delete(k)));
      this.setState({ hideTanks: [...next] });
    };

    const levelColors: Record<string, string> = {
      trace: 'lightgrey',
      error: 'red',
      warn: 'yellow',
      debug: 'blue',
      info: 'green',
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
                    // Toggle the whole application (all of its tanks).
                    onClick={() => setHidden(tanksOf(app), appShown(app))}
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
                  {tanksOf(app).map((key, i) => (
                    <Dropdown.Item
                      as="button"
                      key={key}
                      style={{ paddingLeft: '2.5em' }}
                      // Toggle just this tank.
                      onClick={() => setHidden([key], !hidden.has(key))}
                    >
                      <Form.Check
                        checked={!hidden.has(key)}
                        readOnly
                        inline
                        type="checkbox"
                        id={`tank-${key}`}
                      />
                      Bot {readableId(app, i + 1)}
                    </Dropdown.Item>
                  ))}
                </React.Fragment>
              ))}
              <Dropdown.Divider />
              <Dropdown.Item
                as="button"
                onClick={() => setHidden(allTankKeys, false)}
              >
                Select All
              </Dropdown.Item>
              <Dropdown.Item
                as="button"
                onClick={() => setHidden(allTankKeys, true)}
              >
                Deselect All
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>

          <Dropdown as={ButtonGroup} autoClose="outside">
            <Dropdown.Toggle variant="secondary" size="sm" id="levels-filter">
              Levels
            </Dropdown.Toggle>
            <Dropdown.Menu>
              {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map((level) => (
                <Dropdown.Item
                  as="button"
                  key={level}
                  // Toggle this log level in the log display.
                  onClick={() =>
                    this.setState((s) => ({
                      hideLevels: s.hideLevels.includes(level)
                        ? s.hideLevels.filter((l) => l !== level)
                        : [...s.hideLevels, level],
                    }))
                  }
                >
                  <Form.Check
                    checked={!this.state.hideLevels.includes(level)}
                    readOnly
                    inline
                    type="checkbox"
                    id={`level-${level}`}
                  />
                  {level}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>

          <Form.Control
            value={this.state.search}
            onChange={(e) => this.setState({ search: e.target.value })}
            type="search"
            placeholder="Filter"
            size="sm"
            style={{ maxWidth: '12em' }}
          />
        </ButtonToolbar>

        {/* Log list — fills the remaining height and scrolls on its own. */}
        <div
          className="logs"
          ref={this.logRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            fontFamily:
              'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
            fontSize: `${this.state.fontSize}px`,
          }}
        >
          <div>
            {this.props.logEntries.logs
              .filter(
                (record) =>
                  record &&
                  record.time <=
                    (this.props.playbackTime ?? Number.POSITIVE_INFINITY) &&
                  !hidden.has(tankKey(record.appId, record.tankIndex)) &&
                  !this.state.hideLevels.includes(
                    record.levelName.toUpperCase()
                  ) &&
                  (this.state.search?.length === 0
                    ? true
                    : JSON.stringify(record).includes(this.state.search))
              )
              .sort((a, b) => (a !== null && b !== null ? a.time - b.time : 0))
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
                      <span
                        className="name"
                        style={{
                          marginRight: '5px',
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
      </div>
    );
  }
}
