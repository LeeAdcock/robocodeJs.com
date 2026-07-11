import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import Spinner from 'react-bootstrap/Spinner';
import Alert from 'react-bootstrap/Alert';
import {
  FaDownload,
  FaSearchMinus,
  FaSearchPlus,
  FaClone,
} from 'react-icons/fa';

import SampleEditor from './sampleEditor';
import {
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
  EDITOR_FONT_DEFAULT,
} from '../app/appEditor';
import { titleCase } from '../../util/titleCase';
import User from '../../types/user';

// The most a single arena roster can hold (enabled + disabled), enforced
// server-side in api/arena.ts. The clone button is only enabled below this.
const MAX_APPS_PER_ARENA = 5;

// Nicer display titles for the known samples (the file names lose their
// intended casing, e.g. returnfire -> "ReturnFire"). Anything not listed
// falls back to titleCase(name).
const SAMPLE_TITLES: Record<string, string> = {
  lighthouse: 'Lighthouse',
  magnetic: 'Magnetic',
  pathfinder: 'Pathfinder',
  spirograph: 'Spirograph',
  chronometer: 'Chronometer',
  returnfire: 'ReturnFire',
  marksman: 'Marksman',
  survivor: 'Survivor',
  squad: 'Squad',
  firstbot: 'FirstBot',
  secondbot: 'SecondBot',
};

interface SamplePageProps {
  user: User;
  // Refresh the parent (navbar app list / arena) after a successful clone.
  onCloned?: () => void;
}

// Read-only, in-app viewer for an example bot (`/samples/:name`). Shows the
// sample's source in a read-only editor and, for a signed-in user with room in
// their arena, offers a "Clone this bot" button that creates a new app seeded
// with this code, adds it to their arena, and opens the editable editor for it.
export default function SamplePage(props: SamplePageProps) {
  const { name } = useParams();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');

  const title = name ? (SAMPLE_TITLES[name] ?? titleCase(name)) : 'Sample';

  // Editor font size, persisted (shared key with the editable editor).
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem('editorFontSize'));
    return saved >= EDITOR_FONT_MIN && saved <= EDITOR_FONT_MAX
      ? saved
      : EDITOR_FONT_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem('editorFontSize', String(fontSize));
  }, [fontSize]);
  const zoomIn = () =>
    setFontSize((size) => Math.min(EDITOR_FONT_MAX, size + 1));
  const zoomOut = () =>
    setFontSize((size) => Math.max(EDITOR_FONT_MIN, size - 1));
  const zoomReset = () => setFontSize(EDITOR_FONT_DEFAULT);

  // Load the sample source from the static /samples/<name>.js file.
  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setNotFound(false);
    axios
      .get(`/samples/${name}.js`, { responseType: 'text' })
      .then((res) => {
        // An unknown sample path is served the SPA index.html (200) rather than
        // a 404, so a plain success isn't enough — reject the HTML fallback.
        const contentType = String(res.headers?.['content-type'] || '');
        if (contentType.includes('html')) {
          setNotFound(true);
        } else {
          setCode(res.data);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [name]);

  // Fetch the current arena roster so we know whether there's room to clone.
  useEffect(() => {
    if (!props.user) {
      setRosterCount(null);
      return;
    }
    axios
      .get(`/api/user/${props.user.id}/arena/members`)
      .then((res) => setRosterCount(res.data.length))
      .catch(() => setRosterCount(null));
  }, [props.user]);

  const canClone =
    !!props.user && rosterCount !== null && rosterCount < MAX_APPS_PER_ARENA;

  // Reason shown under a disabled Clone button.
  const cloneReason = !props.user
    ? 'Sign in (top right) to clone this bot into your arena.'
    : rosterCount !== null && rosterCount >= MAX_APPS_PER_ARENA
      ? `Arena full (${MAX_APPS_PER_ARENA} apps) — remove one to add more.`
      : '';

  const doClone = () => {
    if (!props.user || !canClone) return;
    const userId = props.user.id;
    setCloning(true);
    setError('');
    // create app -> save this source into it -> add to arena -> restart -> open.
    axios
      .post(`/api/user/${userId}/app`)
      .then((res) => {
        const appId = res.data.appId as string;
        return axios
          .put(`/api/user/${userId}/app/${appId}/source`, code, {
            headers: { 'content-type': 'application/octet-stream' },
          })
          .then(() => axios.put(`/api/user/${userId}/arena/app/${appId}`))
          .then(() => axios.post(`/api/user/${userId}/arena/restart`))
          .then(() => {
            props.onCloned?.();
            navigate(`/user/${userId}/app/${appId}`);
          });
      })
      .catch((err) => {
        const status = err?.response?.status;
        setError(
          status === 400
            ? 'Could not clone this bot — your app or arena limit may be reached.'
            : 'Could not clone this bot right now. Please try again.'
        );
        setCloning(false);
      });
  };

  if (notFound) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Sample not found</h4>
        <p>
          No example bot matches this link. See the{' '}
          <a href="/examples">example bots</a>.
        </p>
      </div>
    );
  }

  return (
    <>
      <Container fluid style={{ marginTop: '10px', marginBottom: '10px' }}>
        <Row>
          <Col
            style={{
              verticalAlign: 'middle',
              lineHeight: '31px',
              paddingLeft: '0',
            }}
          >
            {title}
            <span style={{ color: '#888', marginLeft: '8px' }}>
              (read-only example)
            </span>
          </Col>
          <Col style={{ paddingRight: '0' }}>
            <ButtonToolbar style={{ justifyContent: 'flex-end' }}>
              <ButtonGroup style={{ marginRight: '5px' }}>
                <OverlayTrigger
                  placement="bottom"
                  overlay={
                    <Tooltip id="zoom-out">Smaller text (Ctrl--)</Tooltip>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Smaller text"
                    onClick={zoomOut}
                    disabled={fontSize <= EDITOR_FONT_MIN}
                  >
                    <FaSearchMinus />
                  </Button>
                </OverlayTrigger>
                <OverlayTrigger
                  placement="bottom"
                  overlay={
                    <Tooltip id="zoom-reset">Reset text size (Ctrl-0)</Tooltip>
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Reset text size"
                    onClick={zoomReset}
                    style={{ minWidth: '2.5em' }}
                  >
                    {fontSize}
                  </Button>
                </OverlayTrigger>
                <OverlayTrigger
                  placement="bottom"
                  overlay={<Tooltip id="zoom-in">Larger text (Ctrl-+)</Tooltip>}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Larger text"
                    onClick={zoomIn}
                    disabled={fontSize >= EDITOR_FONT_MAX}
                  >
                    <FaSearchPlus />
                  </Button>
                </OverlayTrigger>
              </ButtonGroup>

              <ButtonGroup style={{ marginRight: '5px' }}>
                <OverlayTrigger
                  placement="bottom"
                  overlay={
                    <Tooltip id="download">
                      Download this example as a js file.
                    </Tooltip>
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Download"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.download = title.replaceAll(' ', '') + '.js';
                      link.href =
                        'data:text/javascript;charset=utf-8,' +
                        encodeURIComponent(code);
                      link.click();
                    }}
                  >
                    <FaDownload />
                  </Button>
                </OverlayTrigger>
              </ButtonGroup>

              <ButtonGroup>
                <OverlayTrigger
                  placement="bottom"
                  overlay={
                    <Tooltip id="clone">
                      {cloneReason ||
                        'Copy this bot into your arena so you can edit and run it.'}
                    </Tooltip>
                  }
                >
                  {/* span wrapper so the tooltip still shows while disabled */}
                  <span>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={doClone}
                      disabled={!canClone || cloning}
                    >
                      {cloning ? (
                        <Spinner animation="border" size="sm" />
                      ) : (
                        <FaClone />
                      )}{' '}
                      Clone this bot
                    </Button>
                  </span>
                </OverlayTrigger>
              </ButtonGroup>
            </ButtonToolbar>
            {cloneReason && (
              <div
                style={{
                  textAlign: 'right',
                  color: '#888',
                  fontSize: '0.8em',
                  marginTop: '3px',
                }}
              >
                {cloneReason}
              </div>
            )}
          </Col>
        </Row>
      </Container>
      {error && (
        <Alert
          variant="danger"
          style={{
            position: 'absolute',
            width: '90%',
            left: '5%',
            bottom: '10px',
            zIndex: '100',
          }}
        >
          {error}
        </Alert>
      )}
      {loading ? (
        <div style={{ padding: '20px' }}>
          <Spinner animation="border" size="sm" /> Loading…
        </div>
      ) : (
        <SampleEditor
          code={code}
          fontSize={fontSize}
          doZoomIn={zoomIn}
          doZoomOut={zoomOut}
          doZoomReset={zoomReset}
        />
      )}
    </>
  );
}
