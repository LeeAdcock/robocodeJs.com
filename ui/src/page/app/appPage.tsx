import Editor, {
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
  EDITOR_FONT_DEFAULT,
} from './appEditor';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import Toolbar from './appEditorToolbar';
import * as prettier from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Alert from 'react-bootstrap/Alert';
import { colors } from '../../util/colors';
import { useNavigate } from 'react-router-dom';
import { titleCase } from '../../util/titleCase';
import Arena from '../../types/arena';
import App from '../../types/app';
import { Emitter } from '../../util/emitter';

interface AppPageProps {
  arena: Arena;
  doDelete: () => void;
  emitter: Emitter;
}

export default function AppPage(props: AppPageProps) {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [app, setApp] = useState<App | null>(null);
  // A server-reported fault location to mark in the editor gutter (jump-to-line).
  const [faultAnnotation, setFaultAnnotation] = useState<{
    line: number;
    message: string;
  } | null>(null);
  // Bumped to tell the editor to clear all gutter markers (e.g. after a clean
  // recompile), regardless of whether a fault annotation was set.
  const [clearMarkers, setClearMarkers] = useState(0);
  const { userId, appId } = useParams();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  // Editor font size, persisted so the preference survives reloads.
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

  const navigate = useNavigate();

  const appRenamedListener = (event: unknown) => {
    const e = event as { appId: string; name: string };
    setApp((app) => {
      if (e.appId === appId && app) {
        app.name = e.name;
        return { ...app, name: e.name };
      }
      return app;
    });
  };

  // A crash in this bot (any fatal fault: load/handler/timer/init/…) arrives as a
  // structured `botFault`. Surface the code + message prominently, and — when the
  // sandbox reported a line — mark that line in the editor gutter.
  const botFaultListener = (event: unknown) => {
    const e = event as {
      appId: string;
      code: string;
      message: string;
      line?: number;
    };
    if (e.appId !== appId) return;
    setError(`${e.code}: ${e.message}`);
    setTimeout(() => setError(() => ''), 15000);
    if (typeof e.line === 'number')
      setFaultAnnotation({ line: e.line, message: `${e.code}: ${e.message}` });
  };

  useEffect(() => {
    props.emitter.addListener('appRenamed', appRenamedListener);
    props.emitter.addListener('botFault', botFaultListener);
    return () => {
      props.emitter.removeListener('appRenamed', appRenamedListener);
      props.emitter.removeListener('botFault', botFaultListener);
    };
  });

  useEffect(() => {
    axios
      .get(`/api/user/${userId}/app/${appId}/source`)
      .then((res) => setCode(res.data));
    axios
      .get(`/api/user/${userId}/app/${appId}`)
      .then((res) => setApp(res.data));
  }, [userId, appId]);

  // Debounced auto-save of the current code (30s after the last edit).
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      axios.put(`/api/user/${userId}/app/${appId}/source`, code, {
        headers: { 'content-type': 'application/octet-stream' },
      });
    }, 30000);
    return () => clearTimeout(saveTimer.current);
  }, [code, userId, appId]);

  const doExecute = () => {
    axios
      .put(`/api/user/${userId}/app/${appId}/source`, code, {
        headers: { 'content-type': 'application/octet-stream' },
      })
      .then(() => axios.post(`/api/user/${userId}/app/${appId}/compile`));
  };

  // Reboot: save the current code, then re-run the bot's START handler. Plain
  // saving updates the logic without re-initializing, so this is the explicit
  // way to re-run startup setup.
  const doReboot = () => {
    axios
      .put(`/api/user/${userId}/app/${appId}/source`, code, {
        headers: { 'content-type': 'application/octet-stream' },
      })
      .then(() => axios.post(`/api/user/${userId}/app/${appId}/reboot`));
  };

  const doDelete = () => {
    axios
      .delete(`/api/user/${userId}/app/${appId}`)
      .then(props.doDelete)
      .then(() => navigate(`/user/${userId}`));
  };

  // Copy a share link for this app to the clipboard. The link points at the
  // /add-app/:appId landing page, which lets whoever follows it add this app to
  // their own arena by reference (its source stays owner-private). Uses the
  // async Clipboard API where available (needs a secure context), with a
  // legacy execCommand fallback for plain-http / older browsers.
  const doShare = () => {
    const link = `${window.location.origin}/add-app/${appId}`;
    const done = () => {
      setError('');
      setNotice('Share link copied to your clipboard.');
      setTimeout(() => setNotice(''), 4000);
    };
    const fallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        setNotice('');
        setError(`Could not copy the link. Copy it manually: ${link}`);
      }
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(fallback);
    } else {
      fallback();
    }
  };

  // Dry-run compile the current (possibly unsaved) buffer without deploying it,
  // and surface the result: a green notice when clean, or the error code + message
  // in the red banner when not. See the /error-codes docs for what each code means.
  const doCheck = () => {
    setError('');
    setNotice('');
    axios
      .post(`/api/user/${userId}/app/${appId}/check`, code, {
        headers: { 'content-type': 'application/octet-stream' },
      })
      .then((res) => {
        const result = res.data as {
          valid: boolean;
          errorCode?: string;
          message?: string;
        };
        if (result.valid) {
          // A clean recompile clears any lingering error banner and the editor's
          // gutter marker from the previous failure.
          setError('');
          setFaultAnnotation(null);
          setClearMarkers((n) => n + 1);
          setNotice('No errors found.');
          setTimeout(() => setNotice(''), 4000);
        } else {
          setError(
            `${result.errorCode ?? 'Error'}: ${
              result.message ?? 'The bot has errors.'
            }`
          );
          setTimeout(() => setError(''), 15000);
        }
      })
      .catch(() => {
        setError('Could not check the bot right now.');
        setTimeout(() => setError(''), 15000);
      });
  };

  const doClean = async () => {
    try {
      // Prettier 3's format() returns a Promise — await it before setting the
      // code, otherwise the editor would be filled with "[object Promise]".
      const prettyCode = await prettier.format(code || ' ', {
        parser: 'babel',
        semi: false,
        trailingComma: 'none',
        plugins: [babel, estree],
      });
      setCode(prettyCode);
    } catch {
      // Leave the code unchanged if it can't be parsed/formatted.
    }
  };

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
            {app && props.arena && (
              <>
                {props.arena.apps.map((a) => a.id).includes(app.id) && (
                  <img
                    src={
                      '/sprites/tank_' +
                      colors[
                        props.arena.apps.findIndex(
                          (otherApp) => otherApp.id === app.id
                        )
                      ] +
                      '.png'
                    }
                    style={{
                      height: '1em',
                      marginRight: '5px',
                    }}
                  />
                )}
                {titleCase(app?.name)}
              </>
            )}
          </Col>
          <Col style={{ paddingRight: '0' }}>
            <Toolbar
              appName={app?.name ?? ''}
              code={code}
              doDelete={doDelete}
              doShare={doShare}
              doExecute={doExecute}
              doReboot={doReboot}
              doClean={doClean}
              doCheck={doCheck}
              fontSize={fontSize}
              doZoomIn={zoomIn}
              doZoomOut={zoomOut}
              doZoomReset={zoomReset}
            />
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
      {notice && (
        <Alert
          variant="success"
          style={{
            position: 'absolute',
            width: '90%',
            left: '5%',
            bottom: '10px',
            zIndex: '100',
          }}
        >
          {notice}
        </Alert>
      )}
      <Editor
        code={code}
        onChange={(value) => {
          setCode(value);
          // Editing invalidates a prior server fault marker.
          setFaultAnnotation(null);
        }}
        faultAnnotation={faultAnnotation}
        clearMarkersSignal={clearMarkers}
        doExecute={doExecute}
        doReboot={doReboot}
        doClean={doClean}
        doCheck={doCheck}
        fontSize={fontSize}
        doZoomIn={zoomIn}
        doZoomOut={zoomOut}
        doZoomReset={zoomReset}
      />
    </>
  );
}
