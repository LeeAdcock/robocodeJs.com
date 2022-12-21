import React from 'react'
import Navbar from 'react-bootstrap/Navbar'
import Nav from 'react-bootstrap/Nav'
import NavDropdown from 'react-bootstrap/NavDropdown'
import OverlayTrigger from 'react-bootstrap/OverlayTrigger'
import Tooltip from 'react-bootstrap/Tooltip'
import {
  FaCloudUploadAlt,
  FaSlack,
  FaSyncAlt,
  FaPauseCircle,
  FaPlayCircle,
  FaSun,
} from 'react-icons/fa'
import { colors } from '../util/colors'
import Link from 'next/link'

const titleCase = (str: string) =>
  str
    .toLowerCase()
    .split(' ')
    .map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')

export default class NavBar extends React.PureComponent<
  {
    appNames: string[]
    isPaused: boolean
    pause: React.MouseEventHandler<any>
    resume: React.MouseEventHandler<any>
    restart: React.MouseEventHandler<any>
    save: React.MouseEventHandler<any>
    new: React.MouseEventHandler<any>
    toggleDarkMode: React.MouseEventHandler<any>
  },
  {}
> {
  constructor(props: any) {
    super(props)
    this.state = {
      error: null,
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    const arrayEquals = (a, b) =>
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((val, index) => val === b[index])

    return (
      nextProps.isPaused !== this.props.isPaused ||
      !arrayEquals(nextProps.appNames, this.props.appNames)
    )
  }

  render() {
    return (
      <>
        <Navbar bg="dark" variant="dark" expand="sm">
          <Navbar.Brand className="nav-item">
            <Link href="/">
              <a style={{ color: 'gold' }}>Battlebots.js</a>
            </Link>
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav>
              <Navbar.Text>
                <Link href={`/`}>
                  <a className="nav-link" style={{ padding: '0px' }}>
                    Home
                  </a>
                </Link>
              </Navbar.Text>
              <Navbar.Text style={{ marginLeft: '10px' }}>|</Navbar.Text>
              <NavDropdown title="Game" id="basic-nav-dropdown">
                <NavDropdown.Item onClick={this.props.restart}>
                  <FaSyncAlt /> Restart
                </NavDropdown.Item>
                {!this.props.isPaused && (
                  <NavDropdown.Item onClick={this.props.pause}>
                    <FaPauseCircle /> Pause
                  </NavDropdown.Item>
                )}
                {this.props.isPaused && (
                  <NavDropdown.Item onClick={this.props.resume}>
                    <FaPlayCircle /> Resume
                  </NavDropdown.Item>
                )}
                <NavDropdown.Item onClick={this.props.save}>
                  <FaCloudUploadAlt /> Save
                </NavDropdown.Item>
              </NavDropdown>
              <Navbar.Text>|</Navbar.Text>
              <NavDropdown title="Apps" id="basic-nav-dropdown">
                {this.props.appNames.map((appName, appIndex) => (
                  <NavDropdown.Item key={appIndex}>
                    <Link href={`/app/${appIndex}/source`}>
                      <a style={{ color: 'inherit' }}>
                        <img
                          src={'/Lee/battlebots/sprites/tank_' + colors[appIndex] + '.png'}
                          style={{ height: '1em', marginRight: '5px' }}
                        />
                        {titleCase(appName || 'Unknown')}
                      </a>
                    </Link>
                  </NavDropdown.Item>
                ))}
                <NavDropdown.Divider />
                <NavDropdown.Item
                  disabled={this.props.appNames.length >= 9}
                  onClick={this.props.new}
                >
                  Create new Bot application
                </NavDropdown.Item>
                <NavDropdown.Item
                  onClick={() => {
                    window.open(
                      'https://github.com/LeeAdcock/battletank.io/tree/master/docs/samples',
                      '_new',
                    )
                  }}
                >
                  View sample Bots applications
                </NavDropdown.Item>
              </NavDropdown>
              <Navbar.Text>|</Navbar.Text>
              <Nav.Link
                target="_new"
                href="https://github.com/LeeAdcock/battletank.io/blob/master/README.md"
              >
                Docs
              </Nav.Link>
            </Nav>
          </Navbar.Collapse>
          <Navbar.Collapse className="justify-content-end">
            <Nav.Link
              target="_new"
              href="https://app.slack.com/client/T6D0HNCP6/C01M18N543A/details/top"
              style={{ paddingRight: '0px' }}
            >
              <OverlayTrigger
                placement={'bottom'}
                overlay={<Tooltip id={`toggleDarkMode`}>Join the Slack discussion.</Tooltip>}
              >
                <FaSlack />
              </OverlayTrigger>
            </Nav.Link>

            <Nav.Link onClick={this.props.toggleDarkMode} style={{ paddingRight: '0px' }}>
              <OverlayTrigger
                placement={'bottom'}
                overlay={<Tooltip id={`toggleDarkMode`}>Toggle dark mode.</Tooltip>}
              >
                <FaSun />
              </OverlayTrigger>
            </Nav.Link>
          </Navbar.Collapse>
        </Navbar>
      </>
    )
  }
}
