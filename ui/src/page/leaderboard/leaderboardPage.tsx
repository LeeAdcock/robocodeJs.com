import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LeaderboardEntry from '../../types/leaderboardEntry';
import LeaderboardTable from './leaderboardTable';
import TournamentsPanel from './tournamentsPanel';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';

// The global bot ladder (GitHub #151). A read-only, public view of the top
// rated bots across all users — reachable from the main nav even when logged
// out. Ratings drift as bots are edited and keep playing, so the board is polled
// on a slow interval to pick up changes without a reload. Themed via the app's
// CSS variables (var(--fg)/--bg/--rule/--link), so it follows light/dark.
const REFRESH_MS = 30000;

export default function LeaderboardPage(props: { signedIn: boolean }) {
  useDocumentTitle(brandTitle('Global Rankings'));
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get<LeaderboardEntry[]>('/api/leaderboard');
        if (cancelled) return;
        setEntries(res.data);
        setError(null);
      } catch {
        if (!cancelled) setError('Could not load the rankings.');
      }
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      {/* Reuse the shared markdown styling so the header (grass-tile h1 + tank
          icon) and body text (var(--fg)) match every other content page. The
          .markdown wrapper fills the pane, so the h1 spans full width like the
          doc pages. */}
      <div className="markdown">
        <h1>Global Rankings</h1>
        <p>
          These are the top bots across all players, ranked by an Elo rating,
          the same head-to-head scoring used in chess. In the background, each
          bot is matched one-on-one against another at random and they battle;
          the winner's rating goes up and the loser's goes down (an upset win
          counts for more). A bot's rating follows its current code, so
          improving it climbs the board, and neglecting it drifts back down.
        </p>
        <p>
          <Link to="/rankings">How rankings work →</Link>
        </p>
      </div>

      <div style={{ padding: '0 20px' }}>
        {error && <p style={{ color: '#c0392b' }}>{error}</p>}

        {!error && entries === null && <p>Loading rankings…</p>}

        {!error && entries !== null && entries.length === 0 && (
          <p>No ranked matches yet. Check back once bots have battled.</p>
        )}

        {entries !== null && entries.length > 0 && (
          <LeaderboardTable entries={entries} />
        )}

        <TournamentsPanel signedIn={props.signedIn} />
      </div>
    </div>
  );
}
