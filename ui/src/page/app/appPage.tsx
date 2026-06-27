import Editor, {
  EDITOR_FONT_MIN,
  EDITOR_FONT_MAX,
  EDITOR_FONT_DEFAULT,
} from './appEditor';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import Toolbar from './appEditorToolbar';
import prettier from 'prettier/standalone';
import babel from 'prettier/parser-babel';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Alert from 'react-bootstrap/Alert';
import { colors } from '../../util/colors';
import { useNavigate } from 'react-router-dom';
import { titleCase } from '../../util/titleCase';
import Arena from '../../types/arena';
import App from '../../types/tankApp';
import { Emitter } from '../../util/emitter';

interface AppPageProps {
  arena: Arena;
  doDelete: () => void;
  emitter: Emitter;
}

export default function AppPage(props: AppPageProps) {
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [app, setApp] = useState<App | null>(null);
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

  const appErrorListener = (event: unknown) => {
    const e = event as { appId: string; error: string };
    setError((prevError) => {
      if (e.appId === appId && app) {
        setTimeout(() => setError(() => ''), 15000);
        return e.error;
      }
      return prevError;
    });
  };

  useEffect(() => {
    props.emitter.addListener('appRenamed', appRenamedListener);
    props.emitter.addListener('appError', appErrorListener);
    return () => {
      props.emitter.removeListener('appRenamed', appRenamedListener);
      props.emitter.removeListener('appError', appErrorListener);
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

  const doClean = () => {
    try {
      const prettyCode = prettier.format(code || ' ', {
        semi: false,
        trailingComma: 'none',
        plugins: [babel],
      });
      setCode(prettyCode);
    } catch {
      // do nothing
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
              doExecute={doExecute}
              doReboot={doReboot}
              doClean={doClean}
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
      <Editor
        code={code}
        onChange={setCode}
        doExecute={doExecute}
        doReboot={doReboot}
        doClean={doClean}
        fontSize={fontSize}
        doZoomIn={zoomIn}
        doZoomOut={zoomOut}
        doZoomReset={zoomReset}
      />
    </>
  );
}
