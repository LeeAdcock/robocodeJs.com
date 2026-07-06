import React, { useState } from 'react';
import Navbar from 'react-bootstrap/Navbar';
import Nav from 'react-bootstrap/Nav';
import NavDropdown from 'react-bootstrap/NavDropdown';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import {
  FaSyncAlt,
  FaPauseCircle,
  FaPlayCircle,
  FaSun,
  FaMoon,
} from 'react-icons/fa';
import { colors } from '../util/colors';
import { useDarkMode, toggleDarkMode } from '../util/theme';
import { Link } from 'react-router-dom';
import TankApp from '../types/tankApp';
import User from '../types/user';
import Arena from '../types/arena';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { titleCase } from '../util/titleCase';
import ArenaRoster from './arenaRoster';

interface AppLinkProps {
  arena: Arena;
  app: TankApp;
}

const AppLink = function (props: AppLinkProps) {
  const appIndex = props.arena?.apps.map((app) => app.id).indexOf(props.app.id);
  if (appIndex === -1) {
    // The bot isn't in the arena (e.g. created via the MCP API rather than the
    // "new bot" button, which auto-adds it), so it has no arena color. Show a
    // muted neutral icon rather than a bare name, so the menu stays consistent
    // and the fade hints that it isn't currently in the arena.
    return (
      <>
        <img
          src={'/sprites/tank_dark.png'}
          style={{ height: '1em', marginRight: '5px', opacity: 0.4 }}
        />
        {titleCase(props.app.name || 'Unknown')}
      </>
    );
  } else {
    return (
      <>
        <img
          src={'/sprites/tank_' + colors[appIndex] + '.png'}
          style={{ height: '1em', marginRight: '5px' }}
        />
        {/* No hardcoded color — inherit the dropdown's theme-aware text color
            so the name stays readable in both light and dark mode. */}
        {titleCase(props.app.name || 'Unknown')}
      </>
    );
  }
};

interface NavBarProps {
  apps: TankApp[];
  user: User;
  arena: Arena;
  isPaused: boolean;
  doPause: () => void;
  doResume: () => void;
  doRestart: () => void;
  doSave: () => void;
  doCreateApp: () => void;
  // Refresh the parent's user after roster changes (so the Apps list reflects a
  // newly created bot). Optional so existing callers/tests need no change.
  doRefresh?: () => void;
}

export default function NavBar(props: NavBarProps) {
  const navigate = useNavigate();
  const darkMode = useDarkMode();
  const [showRoster, setShowRoster] = useState(false);

  return (
    <>
      <Navbar
        bg="dark"
        variant="dark"
        expand="sm"
        style={{ padding: '10px' }}
        className="topNavBar"
      >
        <Navbar.Brand className="nav-item">
          <span
            style={{
              fontWeight: '700',
              fontSize: '1.25em',
              color: 'gold',
              fontFamily: 'Megrim',
              textDecoration: 'none!important',
            }}
          >
            robocodeJs
          </span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav>
            <Navbar.Text>
              <Link to="/" className="nav-link" style={{ padding: '0px' }}>
                Home
              </Link>
            </Navbar.Text>
            <Navbar.Text style={{ margin: '0 10px 0 10px' }}>|</Navbar.Text>
            <Navbar.Text>
              <Link to="/dev" className="nav-link" style={{ padding: '0px' }}>
                Docs
              </Link>
            </Navbar.Text>
            <Navbar.Text style={{ margin: '0 10px 0 10px' }}>|</Navbar.Text>
            <Navbar.Text>
              <Link to="/learn" className="nav-link" style={{ padding: '0px' }}>
                Learn
              </Link>
            </Navbar.Text>
            <Navbar.Text style={{ margin: '0 10px 0 10px' }}>|</Navbar.Text>

            {props.user && (
              <>
                <NavDropdown title="Apps" id="basic-nav-dropdown">
                  {[...(props.apps || [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((app) => (
                      <NavDropdown.Item
                        key={app.id}
                        onClick={() =>
                          navigate(`/user/${props.user.id}/app/${app.id}`)
                        }
                      >
                        <AppLink arena={props.arena} app={app} />
                      </NavDropdown.Item>
                    ))}
                  {props.apps && props.apps.length > 0 && (
                    <NavDropdown.Divider />
                  )}
                  <NavDropdown.Item
                    disabled={props.apps?.length >= 9}
                    onClick={() => props.doCreateApp()}
                  >
                    Create new application
                  </NavDropdown.Item>
                  <NavDropdown.Item onClick={() => navigate('/examples')}>
                    View example applications
                  </NavDropdown.Item>
                </NavDropdown>
                <Navbar.Text style={{ margin: '0 10px 0 10px' }}>|</Navbar.Text>
                <NavDropdown title="Arena" id="basic-nav-dropdown">
                  <NavDropdown.Item onClick={() => setShowRoster(true)}>
                    Manage apps
                  </NavDropdown.Item>
                  <NavDropdown.Item
                    onClick={() =>
                      navigate(`/user/${props.user.id}/arena/logs`)
                    }
                  >
                    View Logs
                  </NavDropdown.Item>
                  <NavDropdown.Item onClick={() => props.doRestart()}>
                    <FaSyncAlt /> Restart
                  </NavDropdown.Item>
                  {!props.isPaused && (
                    <NavDropdown.Item onClick={() => props.doPause()}>
                      <FaPauseCircle /> Pause
                    </NavDropdown.Item>
                  )}
                  {props.isPaused && (
                    <NavDropdown.Item onClick={() => props.doResume()}>
                      <FaPlayCircle /> Resume
                    </NavDropdown.Item>
                  )}
                </NavDropdown>
                <Navbar.Text style={{ margin: '0 10px 0 10px' }}>|</Navbar.Text>
              </>
            )}
          </Nav>
          <Nav>
            <Form>
              <Form.Control
                size="sm"
                type="search"
                placeholder="How do I..."
                aria-label="Search"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    // Capture the input now; the synthetic event's currentTarget
                    // is nulled by the time the promise resolves.
                    const input = event.currentTarget;
                    axios
                      .get(
                        `/api/ask?question=${encodeURIComponent(input.value)}`
                      )
                      .then((res) => {
                        navigate(res.data.answer);
                        // Reset the box and drop focus once we've navigated away.
                        input.value = '';
                        input.blur();
                      });
                  }
                }}
              />
            </Form>
            <OverlayTrigger
              placement={'bottom'}
              overlay={
                <Tooltip id={`theme`}>
                  {darkMode ? 'Switch to light mode' : 'Switch to night mode'}
                </Tooltip>
              }
            >
              <Button
                variant="outline-light"
                size="sm"
                aria-label={
                  darkMode ? 'Switch to light mode' : 'Switch to night mode'
                }
                aria-pressed={darkMode}
                style={{ marginLeft: '8px', border: 'none' }}
                onClick={() => toggleDarkMode()}
              >
                {darkMode ? <FaSun /> : <FaMoon />}
              </Button>
            </OverlayTrigger>
          </Nav>
        </Navbar.Collapse>

        <Navbar.Collapse className="justify-content-end">
          <Nav>
            {props.user && (
              <Nav.Link>
                <OverlayTrigger
                  placement={'bottom'}
                  overlay={<Tooltip id={`user`}>{props.user?.name}</Tooltip>}
                >
                  <img
                    src={props.user?.picture}
                    style={{
                      borderRadius: '24px',
                      height: '24px',
                      width: '24px',
                    }}
                  />
                </OverlayTrigger>
              </Nav.Link>
            )}
            {!props.user && <div id="GoogleLoginButton"></div>}
          </Nav>
        </Navbar.Collapse>
      </Navbar>
      {props.user && (
        <ArenaRoster
          show={showRoster}
          onHide={() => setShowRoster(false)}
          userId={props.user.id}
          arena={props.arena}
          onChanged={props.doRefresh}
        />
      )}
    </>
  );
}
