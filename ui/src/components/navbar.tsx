import React, { useEffect, useRef, useState } from 'react';
import Navbar from 'react-bootstrap/Navbar';
import Nav from 'react-bootstrap/Nav';
import NavDropdown from 'react-bootstrap/NavDropdown';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import {
  FaSyncAlt,
  FaPauseCircle,
  FaPlayCircle,
  FaSun,
  FaMoon,
  FaSignOutAlt,
  FaMedal,
} from 'react-icons/fa';
import { colors } from '../util/colors';
import { useDarkMode, toggleDarkMode } from '../util/theme';
import { Link, NavLink, useLocation } from 'react-router-dom';
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

// Outcome of the most recent "How do I..." search. Every Enter press ends in one
// of these — a navigation (back to 'idle') or a message the player can read.
type SearchStatus = 'idle' | 'pending' | 'none' | 'limited' | 'error';

const SEARCH_MESSAGES: Record<string, React.ReactNode> = {
  none: (
    <>
      No answer found — try the <Link to="/faq">FAQ</Link>.
    </>
  ),
  limited: <>Too many searches — try again in a moment.</>,
  error: (
    <>
      Search is unavailable — try the <Link to="/faq">FAQ</Link>.
    </>
  ),
};

const HelpSearch = function () {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<SearchStatus>('idle');

  const ask = () => {
    const trimmed = question.trim();
    if (!trimmed || status === 'pending') return;
    setStatus('pending');
    axios
      .get(`/api/ask?question=${encodeURIComponent(trimmed)}`)
      .then((res) => {
        // The server answers `null` when nothing matched; anything else is a route.
        if (!res.data?.answer) {
          setStatus('none');
          return;
        }
        setStatus('idle');
        // Reset the box and drop focus once we've navigated away.
        setQuestion('');
        inputRef.current?.blur();
        navigate(res.data.answer);
      })
      .catch((error) => {
        // 429 is the shared API rate limiter (E022) — worth naming, since waiting
        // actually fixes it. Everything else is an outage the player can't act on.
        setStatus(error?.response?.status === 429 ? 'limited' : 'error');
      });
  };

  return (
    <Form style={{ position: 'relative' }} onSubmit={(e) => e.preventDefault()}>
      <Form.Control
        ref={inputRef}
        size="sm"
        type="search"
        placeholder="How do I..."
        aria-label="Search"
        value={question}
        onChange={(event) => {
          setQuestion(event.target.value);
          // A stale outcome shouldn't hang over a new question.
          if (status !== 'pending') setStatus('idle');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            ask();
          }
        }}
      />
      {status === 'pending' && (
        <Spinner
          animation="border"
          size="sm"
          role="status"
          aria-label="Searching"
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            marginTop: '-0.5em',
            color: '#adb5bd',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Floated out of flow so a message never resizes the navbar. */}
      <div
        aria-live="polite"
        className="nav-search-feedback"
        style={{ display: status in SEARCH_MESSAGES ? 'block' : 'none' }}
      >
        {SEARCH_MESSAGES[status]}
      </div>
    </Form>
  );
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
        <Navbar.Brand as={Link} to="/" className="nav-item nav-brand">
          <span
            style={{
              fontWeight: '700',
              fontSize: '1.25em',
              fontFamily: 'Megrim',
              textDecoration: 'none!important',
            }}
          >
            robocodeJs
          </span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="nav-primary">
            <Navbar.Text className="nav-mobile-only">
              <NavLink
                to="/"
                end
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Home
              </NavLink>
            </Navbar.Text>
            <Navbar.Text>
              <NavLink
                to="/learn"
                end
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Learn
              </NavLink>
            </Navbar.Text>
            <Navbar.Text>
              <NavLink
                to="/learn/docs"
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Docs
              </NavLink>
            </Navbar.Text>
            <Navbar.Text>
              <NavLink
                to="/leaderboard"
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Rankings
              </NavLink>
            </Navbar.Text>
            <Navbar.Text>
              <NavLink
                to="/blog"
                className="nav-link"
                style={{ padding: '0px' }}
              >
                Blog
              </NavLink>
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
              </>
            )}
          </Nav>
          <Nav className="nav-tools">
            <HelpSearch />
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
                      border: '3px solid var(--accent)',
                      boxSizing: 'border-box',
                    }}
                  />
                }
              >
                <NavDropdown.Header>{props.user?.name}</NavDropdown.Header>
                <NavDropdown.Divider />
                <NavDropdown.Item onClick={() => navigate('/profile')}>
                  <FaMedal /> Your badges
                </NavDropdown.Item>
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
