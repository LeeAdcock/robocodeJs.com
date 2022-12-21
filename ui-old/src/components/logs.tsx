import React from 'react'
import Navbar from 'react-bootstrap/Navbar'
import NavDropdown from 'react-bootstrap/NavDropdown'
import Form from 'react-bootstrap/Form'
import FormControl from 'react-bootstrap/FormControl'
import Container from 'react-bootstrap/Container'
import Row from 'react-bootstrap/Row'
import Col from 'react-bootstrap/Col'

import Moment from 'react-moment'
import { TankApp } from '@battletank/lib'

export default class Logs extends React.Component<
  {
    selectedTankApp: TankApp
    logs: any[]
  },
  {
    search: string
    hideLevels: string[]
    hideNames: string[]
  }
> {
  constructor(props: any) {
    super(props)
    this.state = {
      search: '',
      hideLevels: [],
      hideNames: [],
    }
  }

  logRef: React.RefObject<any> = React.createRef()

  componentDidUpdate() {
    // Pin to the bottom of the scroll area
    const parentHeight = this.logRef.current.children[0].offsetHeight
    const height = this.logRef.current.offsetHeight
    const scrollTop = this.logRef.current.scrollTop
    if (Math.abs(scrollTop - (parentHeight - height)) < 200) {
      this.logRef.current.scrollTo({ top: parentHeight })
    }
  }

  render() {
    const names: string[] = this.props.logs
      .filter(record => record)
      .reduce((prev, cur) => (prev.includes(cur.name) ? prev : [...prev, cur.name]), [])
      .filter(name => name.startsWith(this.props.selectedTankApp.name))
      .sort()

    return (
      <Container fluid className="h-100" style={{ padding: '0px' }}>
        <Row>
          <Col>
            <Navbar className="bg-light justify-content-end" style={{ padding: '4px 0px' }}>
              <NavDropdown title="Bots" id="nav-dropdown">
                {names.map(name => (
                  <NavDropdown.Item
                    key={name}
                    eventKey={name}
                    onClick={() => {
                      // Toggle this tank in the log display
                      if (this.state.hideNames.includes(name)) {
                        this.state.hideNames.splice(this.state.hideNames.indexOf(name), 1)
                        this.setState({ hideNames: this.state.hideNames })
                      } else this.setState({ hideNames: [...this.state.hideNames, name] })
                    }}
                  >
                    <Form.Check
                      checked={!this.state.hideNames.includes(name)}
                      inline
                      type="checkbox"
                      id={`bot-${name}`}
                    />
                    {name}
                  </NavDropdown.Item>
                ))}
                <NavDropdown.Divider />
                <NavDropdown.Item
                  eventKey="select-all"
                  onClick={() => this.setState({ hideNames: [] })}
                >
                  Select All
                </NavDropdown.Item>
                <NavDropdown.Item
                  eventKey="deselect-all"
                  onClick={() => this.setState({ hideNames: names })}
                >
                  Deselect All
                </NavDropdown.Item>
              </NavDropdown>
              <NavDropdown title="Levels" id="nav-dropdown">
                {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'].map(level => (
                  <NavDropdown.Item
                    key={level}
                    eventKey={level}
                    onClick={() => {
                      // Toggle this log level in the log display
                      if (this.state.hideLevels.includes(level)) {
                        this.state.hideLevels.splice(this.state.hideLevels.indexOf(level), 1)
                        this.setState({ hideLevels: this.state.hideLevels })
                      } else this.setState({ hideLevels: [...this.state.hideLevels, level] })
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
              <Form inline>
                <FormControl
                  value={this.state.search}
                  onChange={e => this.setState({ search: e.target.value })}
                  type="text"
                  placeholder="Search"
                  className=" mr-sm-2"
                  size="sm"
                />
              </Form>
            </Navbar>
          </Col>
        </Row>
        <Row className="h-100 flex-fill">
          <Col className="h-100 d-flex flex-column">
            <div
              className="logs"
              style={{
                padding: '0px 5px 0px 5px',
                position: 'absolute',
                top: '0px',
                bottom: '50px',
                left: '15px',
                right: '0px',
                marginRight: '15px',
                overflowY: 'scroll',
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace',
                fontSize: '12px',
              }}
              ref={this.logRef}
            >
              <div>
                {this.props.logs
                  .filter(
                    record =>
                      record &&
                      !this.state.hideNames.includes(record.name) &&
                      !this.state.hideLevels.includes(record.levelName.toUpperCase()) &&
                      record.name.startsWith(this.props.selectedTankApp.name) &&
                      (this.state.search?.length === 0
                        ? true
                        : JSON.stringify(record).match(this.state.search) ||
                          JSON.stringify(record).includes(this.state.search)),
                  )
                  .sort((a, b) => a.time.getTime() - b.time.getTime())
                  .map((record, index) => (
                    <span key={record.id}>
                      <span style={{ marginRight: '5px' }}>
                        [
                        <span className="date">
                          <Moment format="HH:mm:ss">{record.time}</Moment>
                        </span>
                        ]
                      </span>
                      <span style={{ marginRight: '5px' }}>
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
                      <span className="name" style={{ marginRight: '5px' }}>
                        {record.name}
                      </span>
                      <span className="message">{record.msg}</span>
                      <br />
                    </span>
                  ))}
              </div>
            </div>
          </Col>
        </Row>
      </Container>
    )
  }
}
