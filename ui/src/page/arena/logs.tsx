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
  level: number;
  levelName: string;
  msg: string;
  time: number;
}

interface LogsProps {
  // All bots in the arena, so the Bots filter lists them regardless of whether
  // they've logged yet.
  bots: { id: string; name: string }[];
  // When set (from double-clicking a bot), show only this bot's logs.
  selectedApp?: string;
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
  // Bots (by appId) the user has toggled off in the Bots filter.
  hideApps: string[];
}

export default class Logs extends React.Component<LogsProps, LogsState> {
  constructor(props: LogsProps) {
    super(props);
    this.state = {
      search: '',
      hideLevels: [],
      hideApps: [],
    };
  }

  logRef: React.RefObject<HTMLDivElement | null> =
    React.createRef<HTMLDivElement>();

  componentDidUpdate() {
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

  render() {
    // The bots the filter offers: the arena's current bots, plus any that have
    // logged but aren't in the list (e.g. removed mid-match), so nothing vanishes.
    const bots = [...this.props.bots];
    this.props.logEntries.logs.forEach((entry) => {
      if (entry && !bots.some((b) => b.id === entry.appId))
        bots.push({ id: entry.appId, name: entry.appId });
    });
    bots.sort((a, b) => a.name.localeCompare(b.name));
    const allAppIds = bots.map((b) => b.id);

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
                {bots.map((bot) => (
                  <NavDropdown.Item
                    key={bot.id}
                    eventKey={bot.id}
                    onClick={() => {
                      // Toggle this bot in the log display
                      if (this.state.hideApps.includes(bot.id)) {
                        this.setState({
                          hideApps: this.state.hideApps.filter(
                            (id) => id !== bot.id
                          ),
                        });
                      } else
                        this.setState({
                          hideApps: [...this.state.hideApps, bot.id],
                        });
                    }}
                  >
                    <Form.Check
                      checked={!this.state.hideApps.includes(bot.id)}
                      inline
                      type="checkbox"
                      id={`bot-${bot.id}`}
                    />
                    {bot.name}
                  </NavDropdown.Item>
                ))}
                <NavDropdown.Divider />
                <NavDropdown.Item
                  eventKey="select-all"
                  onClick={() => this.setState({ hideApps: [] })}
                >
                  Select All
                </NavDropdown.Item>
                <NavDropdown.Item
                  eventKey="deselect-all"
                  onClick={() => this.setState({ hideApps: allAppIds })}
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
                      !this.state.hideApps.includes(record.appId) &&
                      !this.state.hideLevels.includes(
                        record.levelName.toUpperCase()
                      ) &&
                      (!this.props.selectedApp ||
                        record.appId === this.props.selectedApp) &&
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
