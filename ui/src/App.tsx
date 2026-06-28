import './App.css';
import ArenaSvg from './components/arena/arena';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import TankApp from './types/tankApp';
import Arena from './types/arena';
import NavBar from './components/navbar';
import MarkdownPage from './page/markdownPage';
import LessonPage from './page/lessonPage';
import User from './types/user';
import ArenaToolbar from './components/arena/arenaToolbar';
import 'bootstrap/dist/css/bootstrap.min.css';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import PointInTime from './types/pointInTime';
import applyArenaEvent from './util/arenaReducer';
import PlaybackBuffer from './util/playbackBuffer';
import { setPlaybackTime } from './util/playbackClock';
import { useDarkMode } from './util/theme';
import { Emitter } from './util/emitter';

// High-frequency simulation events are played back through the jitter buffer on
// a steady local clock. Everything else (structural/control events: app & tank
// placement/removal, pause/resume/restart, renames, crashes) is applied the
// instant it arrives, so bootstrap and the toolbar controls stay responsive.
const CADENCE_EVENTS = new Set([
  'tick',
  'tankTurn',
  'tankAccelerate',
  'tankStop',
  'turretTurn',
  'radarTurn',
  'radarScan',
  'tankDamaged',
  'bulletFired',
  'bulletRemoved',
  'bulletExploded',
]);

// Lazy-loaded so the heavy editor chunk (ace-builds + prettier) isn't part of
// the initial arena/home bundle. Declared after the imports so the `lazy`
// binding is initialized before use (avoids a dev-mode temporal-dead-zone error).
const AppPage = lazy(() => import('./page/app/appPage'));
const ArenaLogPage = lazy(() => import('./page/arena/arenaLogsPage'));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any;

interface NavProps {
  user: User;
  arena: Arena;
  isPaused: boolean;
  doCreateApp: () => void;
}
const Nav = (props: NavProps) => {
  const navigate = useNavigate();

  return (
    <NavBar
      apps={props.user?.apps}
      arena={props.arena}
      user={props.user}
      isPaused={props.isPaused}
      doPause={() => axios.post(`/api/user/${props.user.id}/arena/pause`)}
      doResume={() => axios.post(`/api/user/${props.user.id}/arena/resume`)}
      doRestart={() => axios.post(`/api/user/${props.user.id}/arena/restart`)}
      doSave={() => {
        /* todo */
      }}
      doCreateApp={() => {
        axios.post(`/api/user/${props.user.id}/app`).then((res) => {
          const appId = res.data.appId;
          // automatically add to arena? if so need to refresh arena afterward
          axios
            .put(`/api/user/${props.user.id}/arena/app/${appId}`)
            .then(() => axios.post(`/api/user/${props.user.id}/arena/restart`));
          navigate(`/user/${props.user.id}/app/${appId}`);
          props.doCreateApp();
        });
      }}
    />
  );
};

const emitter = new Emitter();

function App() {
  const [user, setUser] = useState(null as unknown as User);
  const [arena, setArena] = useState({
    clock: { time: 0 },
    apps: [] as TankApp[],
  } as Arena);
  const [time, setTime] = useState(0);
  const [isPaused, setPaused] = useState(true);
  const eventSource = useRef<EventSource | undefined>(undefined);

  // The jitter buffer plus refs the rAF playback loop reads, so the loop sees
  // the latest arena/time without being re-created on every render.
  const buffer = useRef(new PlaybackBuffer());
  const arenaRef = useRef(arena);
  arenaRef.current = arena;
  const timeRef = useRef(time);
  timeRef.current = time;

  // Whole-app theme: reflect the preference onto <body> so CSS (variables under
  // `body.dark`) re-themes the page, docs, and log console; the boolean is also
  // passed to the arena filter and the editor's Ace theme.
  const darkMode = useDarkMode();
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Reset the experience if the user session expires
  useEffect(() => {
    const interval = setInterval(() => {
      axios
        .get(`/api/user`)
        .catch(() => {
          setUser(null as unknown as User);
          /*setArena({
                        clock: { time: 0 },
                        apps: [] as TankApp[],
                    } as Arena)
                    setPaused(true)*/
        })
        .catch(() => {
          // Google Identity may be absent in local dev (no GSI script / offline).
          if (typeof google !== 'undefined') google.accounts.id.prompt();
        });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const doReloadArena = () => {
    console.log('reloading arena');
    // Any buffered motion belongs to the pre-reload arena; discard it.
    buffer.current.flush();
    return new Promise((resolve) => {
      axios
        .get(user ? `/api/user/${user.id}/arena` : `/api/demo/arena`)
        .then((res) => {
          setTime(res.data.clock.time);
          setPlaybackTime(res.data.clock.time);
          res.data.apps.forEach((app: TankApp) =>
            app.tanks.forEach((tank) => {
              tank.path = Array<PointInTime>(20);
              tank.path[0] = {
                x: tank.x,
                y: tank.y,
                time,
              };
              tank.pathIndex = 1;
            })
          );
          setArena(res.data);
          setPaused(!res.data.running);
          resolve(res.data);
        });
    });
  };

  useEffect(() => {
    // Google Identity Services may be unavailable in local dev (the GSI script is
    // blocked/offline, or auth is bypassed server-side). Guard so the rest of the
    // app — including the on-load auth check below — still runs.
    if (typeof google !== 'undefined' && google.accounts?.id) {
      google.accounts.id.initialize({
        client_id:
          '926984742216-a5uuqefrrrvnn5pa87e357kld6rv2bsc.apps.googleusercontent.com',
        callback: (response: { credential: string }) => {
          // The server verifies the credential and sets an HttpOnly
          // session cookie (so it isn't readable by client-side JS).
          axios
            .post(`/api/session`, {
              credential: response.credential,
            })
            .then(() => axios.get(`/api/user`))
            .then((res) =>
              axios
                .get(`/api/user/${res.data.id}`)
                .then((res) => setUser(res.data))
                .then(() => google.accounts.id.cancel())
            )
            .catch((err) => {
              // Don't fail silently — a rejected /api/session (e.g. the server
              // couldn't verify the Google token) used to just close the popup
              // and do nothing. Surface it so it's diagnosable.
              const status = err?.response?.status;
              console.error(
                `Sign-in failed${status ? ` (HTTP ${status})` : ''}.` +
                  ' The server could not establish a session from the Google' +
                  ' credential. Check the server logs (event="auth.failed").',
                err
              );
              window.alert(
                'Sign-in failed — the server could not verify your Google ' +
                  'login. Please try again; if it persists, the site may be ' +
                  'misconfigured.'
              );
            });
        },
      });
      google.accounts.id.renderButton(
        document.getElementById('GoogleLoginButton'),
        { theme: 'outline', size: 'medium' } // customization attributes
      );
    }

    // On window open, try to authenticate
    window.onload = function () {
      axios
        .get(`/api/user`)
        .then((res) => {
          // already authenticated
          axios
            .get(`/api/user/${res.data.id}`)
            .then((res) => setUser(res.data));
        })
        .catch();
    };

    // pause on lost focus
    const pause = () => {
      if (user) axios.post(`/api/user/${user.id}/arena/pause`);
    };
    window.addEventListener('blur', pause);
    return () => {
      window.removeEventListener('blur', pause);
    };
  }, []);

  useEffect(() => {
    doReloadArena();
  }, [user]);

  // Playback loop: drain the jitter buffer on a steady local clock so buffered
  // simulation events are applied at an even cadence regardless of how bursty
  // their network arrival was. Mounted once; reads live state through refs.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      // First frame establishes the baseline; clamp big gaps (e.g. a
      // backgrounded tab) so we catch up over frames instead of one spike.
      const dt = last === 0 ? 0 : Math.min(now - last, 250);
      last = now;

      let latestTick: number | null = null;
      buffer.current.drain(dt, (event) => {
        applyArenaEvent(arenaRef.current, event, timeRef.current);
        if (event.type === 'tick') latestTick = event.time;
      });
      // A tick advanced the clock — trigger the React re-render ArenaSvg needs,
      // and publish the displayed time so the log panel reveals lines in step.
      if (latestTick !== null) {
        setTime(latestTick);
        setPlaybackTime(latestTick);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (eventSource.current) {
      eventSource.current.close();
      eventSource.current = undefined;
    }
    // A fresh stream replays current state; drop anything left from the old one.
    buffer.current.flush();
    // todo externalize the server
    const source = new EventSource(
      user
        ? `${window.location.protocol}//${window.location.host}/api/user/${user.id}/arena/events`
        : `${window.location.protocol}//${window.location.host}/api/demo/events`
    );
    eventSource.current = source;

    source.onmessage = (message) => {
      const data = JSON.parse(message.data);
      emitter.emit(data.type, data);

      // High-frequency simulation events: queue for steady playback. The rAF
      // loop applies them (and advances `time`) on its own cadence.
      if (CADENCE_EVENTS.has(data.type)) {
        buffer.current.push(data);
        return;
      }

      // Structural / control events: apply immediately.
      if (data.type === 'arenaPaused') {
        setPaused(true);
      } else if (data.type === 'arenaResumed') {
        setPaused(false);
      } else if (data.type === 'appRenamed') {
        if (user) {
          axios.get(`/api/user/${user.id}`).then((res) => setUser(res.data));
        }
      } else if (data.type === 'arenaRestart') {
        // The arena is being rebuilt — drop buffered motion for the old one.
        buffer.current.flush();
        setPaused((isPaused) => {
          if (isPaused) doReloadArena();
          else setArena((arena) => ({ ...arena, apps: [] }));
          return isPaused;
        });
        return;
      }

      setArena((arena) => applyArenaEvent(arena, data, timeRef.current));
    };

    return () => {
      source.close();
      eventSource.current = undefined;
    };
  }, [user]);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          height: '100%',
          width: '50%',
          top: 0,
          left: 0,
          padding: '10px 5px 10px 10px',
        }}
      >
        <Router>
          <Nav
            user={user}
            arena={arena}
            isPaused={isPaused}
            doCreateApp={() => {
              // todo
              axios
                .get(`/api/user/${user.id}`)
                .then((res) => setUser(res.data));
            }}
          />

          <div
            style={{
              height: 'calc(100% - 77px)',
              overflow: 'scroll',
              margin: '10px',
            }}
          >
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<MarkdownPage path="index" />} />
                <Route
                  path="/privacy"
                  element={<MarkdownPage path="privacy" />}
                />
                <Route
                  path="/examples"
                  element={<MarkdownPage path="examples" />}
                />
                <Route path="/dev" element={<MarkdownPage path="dev" />} />
                <Route path="/rules" element={<MarkdownPage path="rules" />} />
                <Route
                  path="/classic"
                  element={<MarkdownPage path="classic-robocode" />}
                />
                <Route path="/learn" element={<MarkdownPage path="learn" />} />
                <Route path="/learn/:slug" element={<LessonPage />} />
                {/* Unlisted: MCP setup guide, reachable only by direct URL. */}
                <Route path="/mcp" element={<MarkdownPage path="mcp" />} />

                <Route path="user/:userId" element={<>user</>} />
                <Route path="user/:userId/arena" element={<>user arena</>} />
                <Route
                  path="user/:userId/app/:appId"
                  element={
                    <AppPage
                      arena={arena}
                      doDelete={() => {
                        // todo
                        axios
                          .get(`/api/user/${user.id}`)
                          .then((res) => setUser(res.data));
                      }}
                      emitter={emitter}
                    />
                  }
                />
                <Route
                  path="user/:userId/arena/logs"
                  element={<ArenaLogPage />}
                />
              </Routes>
            </Suspense>
          </div>
        </Router>
      </div>
      <div
        style={{
          position: 'absolute',
          height: '100%',
          width: '50%',
          top: 0,
          left: '50%',
          padding: '10px 10px 10px 5px',
        }}
      >
        {user && (
          <div
            style={{
              position: 'absolute',
              top: '22px',
              left: '22px',
            }}
          >
            <ArenaToolbar
              isPaused={isPaused}
              doPause={() => axios.post(`/api/user/${user.id}/arena/pause`)}
              doResume={() => axios.post(`/api/user/${user.id}/arena/resume`)}
              doRestart={() => axios.post(`/api/user/${user.id}/arena/restart`)}
            />
          </div>
        )}
        <ArenaSvg darkMode={darkMode} arena={arena} time={time}></ArenaSvg>
      </div>
    </>
  );
}

export default App;
