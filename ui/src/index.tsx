import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import WatchArenaPage from './page/watch/watchArenaPage';
import 'bootstrap/dist/css/bootstrap.min.css';

// The public /watch/:arenaId spectator page is a full-viewport, controls-free
// view of a single arena. It must NOT mount <App/>: App's data-plane effects run
// unconditionally on mount and would open the signed-in/demo stream instead of
// the shared-arena one. So branch here at the root, before App, and read the
// arena id straight from the path (no Router needed for this static shape).
const watchMatch = window.location.pathname.match(/^\/watch\/([^/]+)\/?$/);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    {watchMatch ? (
      <WatchArenaPage arenaId={decodeURIComponent(watchMatch[1])} />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
