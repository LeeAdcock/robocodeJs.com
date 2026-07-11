import { useState, useEffect } from 'react';
import axios from 'axios';
import LeaderboardEntry from '../../types/leaderboardEntry';

// The global bot ladder (GitHub #151). A read-only, public view of the top
// rated bots across all users — reachable from the main nav even when logged
// out. Ratings drift as bots are edited and keep playing, so the board is polled
// on a slow interval to pick up changes without a reload. Themed via the app's
// CSS variables (var(--fg)/--bg/--rule/--link), so it follows light/dark.
const REFRESH_MS = 30000;

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--rule)',
  textAlign: 'left',
  verticalAlign: 'top',
};
const numCell: React.CSSProperties = { ...cell, textAlign: 'right' };

export default function LeaderboardPage() {
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
    <div style={{ padding: '20px', maxWidth: '760px' }}>
      <h2>Global Rankings</h2>
      <p style={{ color: '#888' }}>
        The top bots across all players, ranked by Elo. Every bot battles others
        at random in the background; win and your rating climbs. Ratings follow
        a bot's current code, so improving it moves you up — and neglecting it
        lets you drift down.
      </p>

      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      {!error && entries === null && <p>Loading rankings…</p>}

      {!error && entries !== null && entries.length === 0 && (
        <p style={{ color: '#888' }}>
          No ranked matches yet — check back once bots have battled.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={numCell}>#</th>
              <th style={cell}>Bot</th>
              <th style={cell}>Owner</th>
              <th style={numCell}>Rating</th>
              <th style={numCell}>Games</th>
              <th style={numCell}>Win%</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.appId}>
                <td style={numCell}>{e.rank}</td>
                <td style={cell}>{e.name}</td>
                <td style={{ ...cell, color: '#888' }}>{e.ownerName}</td>
                <td style={numCell}>{e.rating}</td>
                <td style={numCell}>{e.games}</td>
                <td style={numCell}>{Math.round(e.winRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
