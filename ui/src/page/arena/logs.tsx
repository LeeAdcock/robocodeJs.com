import React from 'react';
import Navbar from 'react-bootstrap/Navbar';
import NavDropdown from 'react-bootstrap/NavDropdown';
import Form from 'react-bootstrap/Form';
import FormControl from 'react-bootstrap/FormControl';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

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
}

// Identify one tank in the hide set.
const tankKey = (appId: string, tankIndex: number) => `${appId}:${tankIndex}`;

export default class Logs extends React.Component<LogsProps, LogsState> {
  constructor(props: LogsProps) {
    super(props);
    this.state = {
      search: '',
      hideLevels: [],
      hideTanks: [],
    };
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

    return (
      <Container fluid style={{ padding: '0px' }}>
        <Row>
          <Col>
            <Navbar
              className="bg-light justify-content-end"
              style={{ padding: '4px 0px' }}
            >
              <NavDropdown
                title="Bots"
                id="nav-dropdown"
                style={{ paddingRight: '20px' }}
              >
                {apps.map((app) => (
                  <React.Fragment key={app.id}>
                    <NavDropdown.Item
                      eventKey={app.id}
                      // Toggle the whole application (all of its tanks).
                      onClick={() => setHidden(tanksOf(app), appShown(app))}
                    >
                      <Form.Check
                        checked={appShown(app)}
                        inline
                        type="checkbox"
                        id={`bot-${app.id}`}
                      />
                      <strong>{app.name}</strong>
                    </NavDropdown.Item>
                    {tanksOf(app).map((key, i) => (
                      <NavDropdown.Item
                        key={key}
                        eventKey={key}
                        style={{ paddingLeft: '2.5em' }}
                        // Toggle just this tank.
                        onClick={() => setHidden([key], !hidden.has(key))}
                      >
                        <Form.Check
                          checked={!hidden.has(key)}
                          inline
                          type="checkbox"
                          id={`tank-${key}`}
                        />
                        Bot {readableId(app, i + 1)}
                      </NavDropdown.Item>
                    ))}
                  </React.Fragment>
                ))}
                <NavDropdown.Divider />
                <NavDropdown.Item
                  eventKey="select-all"
                  onClick={() => setHidden(allTankKeys, false)}
                >
                  Select All
                </NavDropdown.Item>
                <NavDropdown.Item
                  eventKey="deselect-all"
                  onClick={() => setHidden(allTankKeys, true)}
                >
                  Deselect All
                </NavDropdown.Item>
              </NavDropdown>
              <NavDropdown
                title="Levels"
                id="nav-dropdown"
                style={{ paddingRight: '20px' }}
              >
                {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map((level) => (
                  <NavDropdown.Item
                    key={level}
                    eventKey={level}
                    onClick={() => {
                      // Toggle this log level in the log display
                      if (this.state.hideLevels.includes(level)) {
                        this.setState({
                          hideLevels: this.state.hideLevels.filter(
                            (l) => l !== level
                          ),
                        });
                      } else
                        this.setState({
                          hideLevels: [...this.state.hideLevels, level],
                        });
                    }}
                  >
                    <Form.Check
                      checked={!this.state.hideLevels.includes(level)}
                      inline
                      type="checkbox"
                      id={`level-${level}`}
                    />
                    {level}
                  </NavDropdown.Item>
                ))}
              </NavDropdown>
              <Form>
                <FormControl
                  value={this.state.search}
                  onChange={(e) =>
                    this.setState({
                      search: e.target.value,
                    })
                  }
                  type="text"
                  placeholder="Filter"
                  className=" mr-sm-2"
                  size="sm"
                />
              </Form>
            </Navbar>
          </Col>
        </Row>
        <Row className="flex-fill">
          <Col className="d-flex flex-column">
            <div
              className="logs"
              style={{
                maxHeight: 'calc(100% - 70px)',
                marginRight: '15px',
                overflowY: 'scroll',
                fontFamily:
                  'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
                fontSize: '12px',
              }}
              ref={this.logRef}
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
                                color:
                                  {
                                    trace: 'lightgrey',
                                    error: 'red',
                                    warn: 'yellow',
                                    debug: 'blue',
                                    info: 'green',
                                  }[record.levelName] || 'white',
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
          </Col>
        </Row>
      </Container>
    );
  }
}
