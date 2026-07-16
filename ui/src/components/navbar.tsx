import React, { useEffect, useState } from 'react';
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
  FaSignOutAlt,
} from 'react-icons/fa';
import { colors } from '../util/colors';
import { useDarkMode, toggleDarkMode } from '../util/theme';
import { Link, useLocation } from 'react-router-dom';
import App from '../types/app';
import User from '../types/user';
import Arena from '../types/arena';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { titleCase } from '../util/titleCase';
import ArenaRoster from './arenaRoster';

interface AppLinkProps {
  arena: Arena;
  app: App;
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
  apps: App[];
  user: User;
  arena: Arena;
  isPaused: boolean;
  doPause: () => void;
  doResume: () => void;
  doRestart: () => void;
  doCreateApp: () => void;
  // Refresh the parent's user after roster changes (so the Apps list reflects a
  // newly created bot). Optional so existing callers/tests need no change.
  doRefresh?: () => void;
  // Sign the user out (clears the server session cookie). Optional so existing
  // callers/tests need no change.
  doLogout?: () => void;
}

export default function NavBar(props: NavBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const darkMode = useDarkMode();
  const [showRoster, setShowRoster] = useState(false);
  // Control the collapsed (hamburger) menu ourselves so we can close it on
  // navigation. react-bootstrap otherwise keeps this state internally, and none
  // of our navigation paths — the top-level <Link>s, the NavDropdown.Item
  // onClick→navigate() items, or the search box — would collapse it, so on a
  // phone the open menu stays over the page you just navigated to.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  return (
    <>
      <Navbar
        bg="dark"
        variant="dark"
        expand="sm"
        expanded={expanded}
        onToggle={setExpanded}
        style={{ padding: '10px' }}
        className="topNavBar"
      >
        <Navbar.Brand as={Link} to="/" className="nav-item">
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
            <Navbar.Text className="nav-mobile-only">
              <Link to="/" className="nav-link" style={{ padding: '0px' }}>
                Home
              </Link>
            </Navbar.Text>
            <Navbar.Text>
              <Link to="/learn" className="nav-link" style={{ padding: '0px' }}>
                Learn
              </Link>
            </Navbar.Text>
            <Navbar.Text
              className="nav-sep"
              style={{ margin: '0 10px 0 10px' }}
            >
              |
            </Navbar.Text>
            <Navbar.Text>
              <Link
                to="/learn/docs"
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Docs
              </Link>
            </Navbar.Text>
            <Navbar.Text
              className="nav-sep"
              style={{ margin: '0 10px 0 10px' }}
            >
              |
            </Navbar.Text>
            <Navbar.Text>
              <Link
                to="/leaderboard"
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Rankings
              </Link>
            </Navbar.Text>
            <Navbar.Text
              className="nav-sep"
              style={{ margin: '0 10px 0 10px' }}
            >
              |
            </Navbar.Text>
            <Navbar.Text>
              <Link to="/blog" className="nav-link" style={{ padding: '0px' }}>
                Blog
              </Link>
            </Navbar.Text>
            <Navbar.Text
              className="nav-sep"
              style={{ margin: '0 10px 0 10px' }}
            >
              |
            </Navbar.Text>

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
                <Navbar.Text
                  className="nav-sep"
                  style={{ margin: '0 10px 0 10px' }}
                >
                  |
                </Navbar.Text>
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
                <Navbar.Text
                  className="nav-sep"
                  style={{ margin: '0 10px 0 10px' }}
                >
                  |
                </Navbar.Text>
              </>
            )}
          </Nav>
          <Nav className="nav-tools">
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
              <NavDropdown
                align="end"
                id="user-nav-dropdown"
                style={{ marginRight: '5px' }}
                title={
                  <img
                    src={props.user?.picture}
                    alt={props.user?.name}
                    style={{
                      borderRadius: '24px',
                      height: '24px',
                      width: '24px',
                      border: '3px solid gold',
                      boxSizing: 'border-box',
                    }}
                  />
                }
              >
                <NavDropdown.Header>{props.user?.name}</NavDropdown.Header>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={() => props.doLogout?.()}>
                  <FaSignOutAlt /> Sign out
                </NavDropdown.Item>
              </NavDropdown>
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
