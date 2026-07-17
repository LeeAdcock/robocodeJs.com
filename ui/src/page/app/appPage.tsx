import Editor, {
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
  EDITOR_FONT_DEFAULT,
} from './appEditor';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Toolbar from './appEditorToolbar';
import SaveIndicator, { SaveState } from './appSaveIndicator';
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
  // The last source we know is persisted on the server (from the initial load
  // or an explicit/auto save). Used to skip redundant no-op saves — most
  // importantly the just-loaded source, which the debounced effect would
  // otherwise PUT straight back unchanged on every editor open. It's state
  // rather than a ref because the toolbar's saved/unsaved indicator is derived
  // from it, so a save has to re-render.
  const [savedCode, setSavedCode] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // What the arena is running versus what's in the buffer. Undefined savedCode
  // means the initial load hasn't landed yet, so there is nothing to compare
  // and nothing worth telling the user.
  const saveState: SaveState = saving
    ? 'saving'
    : savedCode === undefined
      ? 'loading'
      : code === savedCode
        ? 'saved'
        : 'unsaved';

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
    axios.get(`/api/user/${userId}/app/${appId}/source`).then((res) => {
      // The freshly loaded source is already what's on the server.
      setSavedCode(res.data);
      setCode(res.data);
    });
    axios
      .get(`/api/user/${userId}/app/${appId}`)
      .then((res) => setApp(res.data));
  }, [userId, appId]);

  // The one path that persists source. `savedCode` only advances once the PUT
  // resolves, so a failed save leaves the indicator reading "Unsaved changes"
  // — the point of the indicator is that it never claims the arena has code it
  // doesn't have.
  const saveSource = (source: string) => {
    setSaving(true);
    return axios
      .put(`/api/user/${userId}/app/${appId}/source`, source, {
        headers: { 'content-type': 'application/octet-stream' },
      })
      .then(() => {
        setSavedCode(source);
      })
      .catch(() => {
        setNotice('');
        setError('Could not save your changes. Check your connection.');
        setTimeout(() => setError(''), 15000);
        throw new Error('save failed');
      })
      .finally(() => setSaving(false));
  };

  // Debounced auto-save of the current code (30s after the last edit).
  useEffect(() => {
    // Nothing changed since the last save/load, or the load hasn't landed yet
    // — skip the pointless PUT.
    if (savedCode === undefined || code === savedCode) return;
    const timer = setTimeout(() => {
      saveSource(code)
        .then(() => {
          setNotice('Saved automatically.');
          setTimeout(() => setNotice(''), 4000);
        })
        // saveSource already surfaced the failure in the error banner.
        .catch(() => undefined);
    }, 30000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, savedCode, userId, appId]);

  const doExecute = () => {
    saveSource(code)
      .then(() => axios.post(`/api/user/${userId}/app/${appId}/compile`))
      .then(() => {
        setNotice('Saved — the arena is running your latest code.');
        setTimeout(() => setNotice(''), 4000);
      })
      .catch(() => undefined);
  };

  // Reboot: save the current code, then re-run the bot's START handler. Plain
  // saving updates the logic without re-initializing, so this is the explicit
  // way to re-run startup setup.
  const doReboot = () => {
    saveSource(code)
      .then(() => axios.post(`/api/user/${userId}/app/${appId}/reboot`))
      .then(() => {
        setNotice('Saved — your bots restarted with your latest code.');
        setTimeout(() => setNotice(''), 4000);
      })
      .catch(() => undefined);
  };

  const doDelete = () => {
    axios
      .delete(`/api/user/${userId}/app/${appId}`)
      .then(props.doDelete)
      // The just-deleted app's editor route no longer points at anything, so
      // return to the homepage (the arena stays in the right pane; the navbar's
      // app list is refreshed by props.doDelete).
      .then(() => navigate(`/`));
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
    setError('');
    setNotice('');
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
      setNotice(
        prettyCode === code ? 'Code is already tidy.' : 'Code reformatted.'
      );
      setTimeout(() => setNotice(''), 4000);
    } catch {
      // Leave the code unchanged if it can't be parsed/formatted. Prettier only
      // fails here on a syntax error, so point at Check rather than repeating
      // its parse message in different words.
      setError(
        'Could not reformat — the code has a syntax error. Use Check for errors (Ctrl-Enter) to find it.'
      );
      setTimeout(() => setError(''), 15000);
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
            <SaveIndicator saveState={saveState} />
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
