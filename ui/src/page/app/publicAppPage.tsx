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
  FaPlus,
} from 'react-icons/fa';

import SampleEditor from '../sample/sampleEditor';
import {
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
  EDITOR_FONT_DEFAULT,
} from './appEditor';
import { titleCase } from '../../util/titleCase';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';
import User from '../../types/user';

// The most a single arena roster can hold (enabled + disabled), enforced
// server-side in api/arena.ts. The clone button is only enabled below this.
const MAX_APPS_PER_ARENA = 5;

// Wire shape of GET /api/public/app/:appId (server/src/api/publicApp.ts).
interface PublicApp {
  id: string;
  name: string;
  ownerName: string;
  rating: number;
  games: number;
  wins: number;
  source: string;
  version: string;
}

interface PublicAppPageProps {
  user: User;
  // Refresh the parent (navbar app list / arena) after a successful clone.
  onCloned?: () => void;
}

// Read-only view of an app its owner made public (`/app/:appId`, GitHub #117),
// reached from the rankings page and from an arena roster the app was added to.
// Public like /leaderboard — no sign-in needed to read. Mirrors the sample-bot
// viewer (samplePage): the source in a read-only editor, Download, and for a
// signed-in user with room in their arena, "Clone this bot" (a fresh app seeded
// with this code) or "Add to my arena" (link the app by reference, as the
// share link does). A private, unknown, or since-withdrawn app is simply
// "not found": the server answers all three the same way.
export default function PublicAppPage(props: PublicAppPageProps) {
  const { appId } = useParams();
  const navigate = useNavigate();

  const [app, setApp] = useState<PublicApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');

  useDocumentTitle(brandTitle(app ? titleCase(app.name) : 'Bot source'));

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

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    setNotFound(false);
    axios
      .get<PublicApp>(`/api/public/app/${appId}`)
      .then((res) => setApp(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [appId]);

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
    ? 'Sign in (top right) to clone this bot or add it to your arena.'
    : rosterCount !== null && rosterCount >= MAX_APPS_PER_ARENA
      ? `Arena full (${MAX_APPS_PER_ARENA} apps). Remove one to add more.`
      : '';

  const doClone = () => {
    if (!props.user || !canClone || !app) return;
    const userId = props.user.id;
    setCloning(true);
    setError('');
    // create app -> save this source into it -> add to arena -> restart -> open.
    axios
      .post(`/api/user/${userId}/app`)
      .then((res) => {
        const newId = res.data.appId as string;
        return axios
          .put(`/api/user/${userId}/app/${newId}/source`, app.source, {
            headers: { 'content-type': 'application/octet-stream' },
          })
          .then(() => axios.put(`/api/user/${userId}/arena/app/${newId}`))
          .then(() => axios.post(`/api/user/${userId}/arena/restart`))
          .then(() => {
            props.onCloned?.();
            navigate(`/user/${userId}/app/${newId}`);
          });
      })
      .catch((err) => {
        const status = err?.response?.status;
        setError(
          status === 400
            ? 'Could not clone this bot. Your app or arena limit may be reached.'
            : 'Could not clone this bot right now. Please try again.'
        );
        setCloning(false);
      });
  };

  if (notFound) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>App not found</h4>
        <p>
          No public app matches this link. Its author may have made it private
          again, or the link may be wrong. See the{' '}
          <a href="/leaderboard">rankings</a> for bots whose source is public.
        </p>
      </div>
    );
  }

  const title = app ? titleCase(app.name) : '';

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
            {app && (
              <>
                <h1
                  style={{
                    margin: 0,
                    display: 'inline',
                    fontSize: '1.25em',
                    fontWeight: 500,
                    lineHeight: '31px',
                    position: 'relative',
                    top: '2px',
                  }}
                >
                  {title}
                </h1>
                <span style={{ color: '#888', marginLeft: '8px' }}>
                  by {app.ownerName}
                </span>
              </>
            )}
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
                      Download this bot&apos;s source as a js file.
                    </Tooltip>
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Download"
                    disabled={!app}
                    onClick={() => {
                      if (!app) return;
                      const link = document.createElement('a');
                      link.download = title.replaceAll(' ', '') + '.js';
                      link.href =
                        'data:text/javascript;charset=utf-8,' +
                        encodeURIComponent(app.source);
                      link.click();
                    }}
                  >
                    <FaDownload />
                  </Button>
                </OverlayTrigger>
                <OverlayTrigger
                  placement="bottom"
                  overlay={
                    <Tooltip id="add-to-arena">
                      {props.user
                        ? 'Add this app to your arena as-is (linked by reference, like a share link).'
                        : 'Sign in (top right) to add this app to your arena.'}
                    </Tooltip>
                  }
                >
                  {/* The span keeps the tooltip working while the button is
                      disabled, but it also sits between the ButtonGroup and
                      the Button, so Bootstrap's grouped-corner rules skipped
                      it and the button drew fully rounded beside Download.
                      As a nested btn-group it gets the group's corner and
                      -1px border treatment like a direct child would. */}
                  <span className="btn-group">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label="Add to my arena"
                      disabled={!props.user || !app}
                      onClick={() => navigate(`/add-app/${appId}`)}
                    >
                      <FaPlus /> Add to my arena
                    </Button>
                  </span>
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
                      aria-label="Clone this bot"
                      onClick={doClone}
                      disabled={!canClone || cloning || !app}
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
        app && (
          <SampleEditor
            code={app.source}
            fontSize={fontSize}
            doZoomIn={zoomIn}
            doZoomOut={zoomOut}
            doZoomReset={zoomReset}
          />
        )
      )}
    </>
  );
}
