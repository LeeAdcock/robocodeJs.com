import { useEffect } from 'react';
import ArenaSvg from '../../components/arena/arena';
import useArenaStream from '../../util/useArenaStream';
import { useDarkMode } from '../../util/theme';

// Public, read-only spectator view: nothing but the arena, maxed into the
// viewport. Reached via the "Share" link (/watch/:arenaId) and served to anyone,
// including logged-out visitors, off the public `/api/arena/:arenaId` routes. No
// navbar, no toolbar, no controls — spectators watch, they don't drive.
export default function WatchArenaPage({ arenaId }: { arenaId: string }) {
  // This page mounts instead of <App/> (see index.tsx), so it owns the body theme
  // class that App normally sets — without it the CSS-variable dark theme and the
  // arena's night-mode tint wouldn't apply.
  const darkMode = useDarkMode();
  useEffect(() => {
    document.body.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const { arena, time, notFound } = useArenaStream({
    snapshotUrl: `/api/arena/${arenaId}`,
    eventsUrl: `${window.location.protocol}//${window.location.host}/api/arena/${arenaId}/events`,
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px',
        boxSizing: 'border-box',
      }}
    >
      {notFound ? (
        // The arena is unknown (bad link) or was disposed (~30 min after it
        // stopped). ArenaSvg letterboxes via preserveAspectRatio, so a message
        // reads more clearly than an empty board.
        <div style={{ textAlign: 'center', opacity: 0.75 }}>
          <h2>Arena not found</h2>
          <p>This match has ended or the link is no longer valid.</p>
        </div>
      ) : (
        <ArenaSvg darkMode={darkMode} arena={arena} time={time} />
      )}
    </div>
  );
}
