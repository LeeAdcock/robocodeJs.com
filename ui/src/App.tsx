import ArenaSvg from './components/arena/arena';
import ArenaLegend from './components/arena/arenaLegend';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from 'react-router-dom';
import Arena from './types/arena';
import NavBar from './components/navbar';
import MarkdownPage from './page/markdownPage';
import LessonPage from './page/lessonPage';
import BlogIndexPage from './page/blogIndexPage';
import NotFoundPage from './page/notFoundPage';
import BlogPostPage from './page/blogPostPage';
import User from './types/user';
import ArenaToolbar from './components/arena/arenaToolbar';
import Alert from 'react-bootstrap/Alert';
import 'bootstrap/dist/css/bootstrap.min.css';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import useArenaStream from './util/useArenaStream';
import { useDarkMode } from './util/theme';
import { useDebugMode } from './util/debugMode';
import { useIsMobile } from './util/useIsMobile';
import { Emitter } from './util/emitter';

// Lazy-loaded so the heavy editor chunk (ace-builds + prettier) isn't part of
// the initial arena/home bundle. Declared after the imports so the `lazy`
// binding is initialized before use (avoids a dev-mode temporal-dead-zone error).
const AppPage = lazy(() => import('./page/app/appPage'));
const ArenaLogPage = lazy(() => import('./page/arena/arenaLogsPage'));
const AddAppPage = lazy(() => import('./page/arena/addAppPage'));
const SamplePage = lazy(() => import('./page/sample/samplePage'));
const LeaderboardPage = lazy(
  () => import('./page/leaderboard/leaderboardPage')
);
const ProfilePage = lazy(() => import('./page/profile/profilePage'));
const McpAuthorizePage = lazy(() => import('./page/mcpAuthorize'));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const google: any;

interface NavProps {
  user: User;
  arena: Arena;
  isPaused: boolean;
  doCreateApp: () => void;
  doLogout: () => void;
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
      doRefresh={() => props.doCreateApp()}
      doLogout={props.doLogout}
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

// The arena SVG is rendered outside the <Router> (in the right pane), so it can't
// call useNavigate itself. This tiny component lives inside the Router and hands
// its navigate function up, letting the arena drive client-side navigation
// (double-click a bot → its source / logs) without a full page reload.
function NavBridge({
  onReady,
}: {
  onReady: (nav: (to: string) => void) => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    onReady(navigate);
  }, [navigate, onReady]);
  return null;
}

function App() {
  const [user, setUser] = useState(null as unknown as User);
  // Transient confirmation shown under the arena toolbar after the Share button
  // copies the public watch link.
  const [shareNotice, setShareNotice] = useState('');
  // navigate captured from inside the Router (see NavBridge), so the arena — which
  // renders outside it — can open a bot's source/logs on double-click.
  const navigateRef = useRef<((to: string) => void) | null>(null);

  // Double-click a bot in the arena → open its bot's source; shift+double-click →
  // open the arena logs filtered to just that bot instance. Only for the
  // signed-in user's own arena (not the demo).
  const openBot = (appId: string, botIndex: number, shiftKey: boolean) => {
    if (!user) return;
    navigateRef.current?.(
      shiftKey
        ? `/user/${user.id}/arena/logs?app=${appId}&bot=${botIndex}`
        : `/user/${user.id}/app/${appId}`
    );
  };

  // The arena data-plane (REST snapshot bootstrap + SSE stream + jitter-buffered
  // interpolation) lives in a shared hook, so the public /watch page renders the
  // exact same live arena. Signed-in → the user's own arena; signed-out → the
  // public demo arena. `emitter` forwards raw events to the log console; the
  // appRenamed callback refetches the user so the sidebar shows the new name.
  const { arena, time, isPaused } = useArenaStream({
    snapshotUrl: user ? `/api/user/${user.id}/arena` : `/api/demo/arena`,
    eventsUrl: user
      ? `${window.location.protocol}//${window.location.host}/api/user/${user.id}/arena/events`
      : `${window.location.protocol}//${window.location.host}/api/demo/events`,
    emitter,
    onAppRenamed: () => {
      if (user) {
        axios.get(`/api/user/${user.id}`).then((res) => setUser(res.data));
      }
    },
  });

  // Copy a public "watch" link for the current arena to the clipboard. The link
  // points at /watch/:arenaId, a controls-free full-screen spectator view served
  // from the public (unauthenticated) /api/arena/:arenaId routes — anyone with
  // the link can watch, but bot source and console logs stay private. Mirrors the
  // clipboard pattern in page/app/appPage.tsx (async Clipboard API where
  // available, with a legacy execCommand fallback for plain-http / older
  // browsers). No-op until the snapshot has loaded the arena id.
  const doShare = () => {
    if (!arena.id) return;
    const link = `${window.location.origin}/watch/${arena.id}`;
    const done = () => {
      setShareNotice('Watch link copied to your clipboard.');
      setTimeout(() => setShareNotice(''), 4000);
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
        setShareNotice(`Could not copy. Link: ${link}`);
        setTimeout(() => setShareNotice(''), 8000);
      }
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(fallback);
    } else {
      fallback();
    }
  };

  // Whole-app theme: reflect the preference onto <body> so CSS (variables under
  // `body.dark`) re-themes the page, docs, and log console; the boolean is also
  // passed to the arena filter and the editor's Ace theme.
  const darkMode = useDarkMode();
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Arena "debug view": the schematic render toggled from the arena toolbar.
  const debugMode = useDebugMode();

  // On phone-sized viewports (below the navbar's `expand="sm"` breakpoint) the
  // 50/50 split is unusable, so the arena pane is dropped entirely and the
  // content pane widens to fill the screen. The arena data stream stays wired
  // up (see useArenaStream above) so the arena is instantly correct if the
  // viewport widens back (e.g. rotation) — only its render is gated.
  const isMobile = useIsMobile();

  // Reset the experience if the user session expires
  useEffect(() => {
    const interval = setInterval(() => {
      axios
        .get(`/api/user`)
        .catch(() => {
          setUser(null as unknown as User);
          /*setArena({
                        clock: { time: 0 },
                        apps: [] as App[],
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
    }

    // Restore an existing session on mount. Run it directly rather than from
    // window.onload: that event may have already fired by the time React mounts
    // (e.g. after an HMR update, or when the bundle loads after `load`), in which
    // case the handler never runs and the app is stuck on the sign-in button
    // until a manual refresh — the local-dev auth bypass looked "broken" for
    // exactly this reason. The `id` guard ignores a 200 that isn't the user JSON
    // (e.g. an SPA index.html returned when /api isn't proxied — see the Vite
    // dev proxy), so it can't cascade into a bogus /api/user/undefined call.
    axios
      .get(`/api/user`)
      .then((res) => {
        if (!res.data || !res.data.id) return; // not an authenticated user payload
        return axios
          .get(`/api/user/${res.data.id}`)
          .then((res) => setUser(res.data));
      })
      .catch(() => undefined);
  }, []);

  // (Re)render the Google sign-in button whenever the theme changes so it
  // matches light/dark mode. GSI has no post-render theme setter, so we
  // re-invoke renderButton with the matching variant (`filled_black` reads
  // correctly on the dark navbar; `outline` on the light one). The container
  // only exists while signed out (see navbar), so guard on both the GSI global
  // and the element; `user` in the deps re-renders it after a sign-out.
  useEffect(() => {
    const el = document.getElementById('GoogleLoginButton');
    if (typeof google !== 'undefined' && google.accounts?.id && el) {
      google.accounts.id.renderButton(el, {
        theme: darkMode ? 'filled_black' : 'outline',
        size: 'medium',
      });
    }
  }, [darkMode, user]);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          height: '100%',
          width: isMobile ? '100%' : '50%',
          top: 0,
          left: 0,
          padding: '10px 5px 10px 10px',
        }}
      >
        <Router>
          <NavBridge onReady={(nav) => (navigateRef.current = nav)} />
          <Nav
            user={user}
            arena={arena}
            isPaused={isPaused}
            doCreateApp={() => {
              axios
                .get(`/api/user/${user.id}`)
                .then((res) => setUser(res.data));
            }}
            doLogout={() => {
              // Stop Google from silently re-signing the user back in on the
              // next auth poll (see the session-expiry effect below).
              if (typeof google !== 'undefined' && google.accounts?.id) {
                google.accounts.id.disableAutoSelect();
              }
              // Clear the server-side HttpOnly session cookie, then drop the
              // client user so the UI returns to the signed-out state.
              axios
                .delete(`/api/session`)
                .finally(() => setUser(null as unknown as User));
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
                {/* Read-only, in-app viewer for an example bot with a
                    clone-into-your-arena action. Linked from examples.md. */}
                <Route
                  path="/samples/:name"
                  element={
                    <SamplePage
                      user={user}
                      onCloned={() =>
                        user &&
                        axios
                          .get(`/api/user/${user.id}`)
                          .then((res) => setUser(res.data))
                      }
                    />
                  }
                />
                <Route
                  path="/learn/docs"
                  element={<MarkdownPage path="dev" />}
                />
                {/* Old docs URL — redirect to the new one, preserving any
                    #section hash so existing deep links keep working. */}
                <Route
                  path="/dev"
                  element={
                    <Navigate
                      to={{
                        pathname: '/learn/docs',
                        hash: window.location.hash,
                      }}
                      replace
                    />
                  }
                />
                <Route path="/rules" element={<MarkdownPage path="rules" />} />
                <Route path="/faq" element={<MarkdownPage path="faq" />} />
                <Route
                  path="/error-codes"
                  element={<MarkdownPage path="error-codes" />}
                />
                <Route
                  path="/classic"
                  element={<MarkdownPage path="classic-robocode" />}
                />
                <Route path="/learn" element={<MarkdownPage path="learn" />} />
                <Route path="/learn/:slug" element={<LessonPage />} />
                {/* Global bot ladder — public, linked from the main nav. The
                    signed-in user's own bots are bolded; the server marks them
                    by including the real appId only on the viewer's own rows. */}
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                {/* Own badges (GitHub #121) — private, so the page gates itself
                    on the API's 401 rather than on the app's user state. */}
                <Route path="/profile" element={<ProfilePage />} />
                {/* Explainer for the global rankings/ladder. Distinct from
                    /leaderboard (the live board) so it doesn't collide. */}
                <Route
                  path="/rankings"
                  element={<MarkdownPage path="rankings" />}
                />
                {/* Dev blog — a manifest-driven index (posts appear once their
                    date arrives) + per-post markdown pages, mirroring /learn.
                    Posts are markdown at public/docs/blog/<slug>.md. */}
                <Route path="/blog" element={<BlogIndexPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
                <Route path="/about" element={<MarkdownPage path="about" />} />
                {/* MCP setup guide, linked from the homepage getting-started list. */}
                <Route path="/mcp" element={<MarkdownPage path="mcp" />} />
                {/* OAuth approval landing for MCP clients (see api/oauth.ts). */}
                <Route
                  path="/mcp/authorize"
                  element={<McpAuthorizePage user={user} />}
                />

                <Route
                  path="user/:userId/app/:appId"
                  element={
                    <AppPage
                      arena={arena}
                      doDelete={() => {
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
                <Route
                  path="/add-app/:appId"
                  element={
                    <AddAppPage
                      user={user}
                      onAdded={() =>
                        user &&
                        axios
                          .get(`/api/user/${user.id}`)
                          .then((res) => setUser(res.data))
                      }
                    />
                  }
                />
                {/* Catch-all: any unmatched URL gets a friendly 404 instead of
                    an empty content area. The server marks unknown routes
                    noindex (util/seo.ts). Keep this LAST. */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </div>
        </Router>
      </div>
      {!isMobile && (
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
                // The arena SVG below sets `isolation: isolate`, which gives it its
                // own stacking context in the positioned-paint layer; being later
                // in the DOM it would otherwise paint over this toolbar. Lift the
                // toolbar above it so the pause/resume/restart controls stay visible.
                zIndex: 1,
              }}
            >
              <ArenaToolbar
                isPaused={isPaused}
                doPause={() => axios.post(`/api/user/${user.id}/arena/pause`)}
                doResume={() => axios.post(`/api/user/${user.id}/arena/resume`)}
                doRestart={() =>
                  axios.post(`/api/user/${user.id}/arena/restart`)
                }
                doStep={() => axios.post(`/api/user/${user.id}/arena/step`)}
                doShare={arena.id ? doShare : undefined}
              />
              {shareNotice && (
                // The same green "success" theme as the bot share-link notice
                // (page/app/appPage.tsx), kept compact. Positioned absolutely (out
                // of flow) just below the toolbar: the toolbar's container shrinks
                // to fit and the ButtonToolbar is right-aligned, so an in-flow
                // notice wider than the buttons would widen the container and shove
                // them — this floats the toast without disturbing the layout.
                <Alert
                  variant="success"
                  className="py-1 px-2 mb-0"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '6px',
                    whiteSpace: 'nowrap',
                    fontSize: '0.8rem',
                  }}
                >
                  {shareNotice}
                </Alert>
              )}
            </div>
          )}
          {user && (
            <div
              style={{
                position: 'absolute',
                top: '22px',
                right: '22px',
                // Above the arena SVG's own stacking context (isolation: isolate),
                // mirroring the toolbar at top-left, so the roster legend stays
                // visible over the arena.
                zIndex: 1,
              }}
            >
              <ArenaLegend arena={arena} />
            </div>
          )}
          <ArenaSvg
            darkMode={darkMode}
            debugMode={debugMode}
            arena={arena}
            time={time}
            onOpenBot={openBot}
          ></ArenaSvg>
        </div>
      )}
    </>
  );
}

export default App;
