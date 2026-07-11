import { useState, useEffect } from 'react';
import axios from 'axios';
import LeaderboardEntry from '../../types/leaderboardEntry';
import { colors } from '../../util/colors';

// The global bot ladder (GitHub #151). A read-only, public view of the top
// rated bots across all users — reachable from the main nav even when logged
// out. Ratings drift as bots are edited and keep playing, so the board is polled
// on a slow interval to pick up changes without a reload. Themed via the app's
// CSS variables (var(--fg)/--bg/--rule/--link), so it follows light/dark.
const REFRESH_MS = 30000;

// A stable little tank sprite per bot: hash the appId into the shared color
// palette so each bot always shows the same color, matching the arena/roster
// visual language (there's no arena index here, so we derive it from the id).
const tankSrc = (appId: string): string => {
  let h = 0;
  for (let i = 0; i < appId.length; i++)
    h = (h * 31 + appId.charCodeAt(i)) >>> 0;
  return `/sprites/tank_${colors[h % colors.length]}.png`;
};

// Podium markers for the top three (shown in the far-left column). 1st gets a
// trophy, 2nd/3rd the silver/bronze medals.
const medal = (rank: number): string =>
  rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
const placeLabel = (rank: number): string | undefined =>
  ({ 1: 'First place', 2: 'Second place', 3: 'Third place' })[rank];

const cell: React.CSSProperties = {
  padding: '6px 12px',
  borderBottom: '1px solid var(--rule)',
  textAlign: 'left',
  verticalAlign: 'middle',
};
const numCell: React.CSSProperties = { ...cell, textAlign: 'right' };

// Top-3 rows get a pale, translucent gold wash — a lighter take on the app's
// gold accent that reads over both the light and dark page background (so no
// separate per-theme value is needed).
const GOLD_WASH = 'rgba(255, 215, 0, 0.12)';
const goldCell = (base: React.CSSProperties): React.CSSProperties => ({
  ...base,
  background: GOLD_WASH,
});
// Left accent bar on the first cell. boxShadow (not border) survives
// border-collapse without shifting column widths.
const goldFirstCell = (base: React.CSSProperties): React.CSSProperties => ({
  ...goldCell(base),
  boxShadow: 'inset 3px 0 0 gold',
});

interface LeaderboardPageProps {
  // App ids owned by the signed-in user; their rows are bolded. Empty when
  // logged out.
  ownAppIds?: Set<string>;
}

export default function LeaderboardPage({
  ownAppIds,
}: LeaderboardPageProps = {}) {
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
          These are the top bots across all players, ranked by an Elo rating —
          the same head-to-head scoring used in chess. In the background, each
          bot is matched one-on-one against another at random and they battle;
          the winner's rating goes up and the loser's goes down (an upset win
          counts for more). A bot's rating follows its current code, so
          improving it climbs the board — and neglecting it drifts back down.
        </p>
      </div>

      <div style={{ padding: '0 20px' }}>
        {error && <p style={{ color: '#c0392b' }}>{error}</p>}

        {!error && entries === null && <p>Loading rankings…</p>}

        {!error && entries !== null && entries.length === 0 && (
          <p>No ranked matches yet — check back once bots have battled.</p>
        )}

        {entries !== null && entries.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {/* podium column (medal) for the top three, far left */}
                <th style={numCell} aria-hidden="true"></th>
                <th style={numCell}>#</th>
                <th style={cell}>Bot</th>
                <th style={cell}>Owner</th>
                <th style={numCell}>Rating</th>
                <th style={numCell}>Win%</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const top3 = e.rank <= 3;
                const isOwn = ownAppIds?.has(e.appId) ?? false;
                const first = top3 ? goldFirstCell(numCell) : numCell;
                const c = top3 ? goldCell(cell) : cell;
                const n = top3 ? goldCell(numCell) : numCell;
                return (
                  <tr key={e.appId} style={{ fontWeight: isOwn ? 700 : 400 }}>
                    <td style={first} aria-label={placeLabel(e.rank)}>
                      {medal(e.rank)}
                    </td>
                    <td style={n}>{e.rank}</td>
                    <td style={c}>
                      <img
                        src={tankSrc(e.appId)}
                        style={{
                          height: '1.1em',
                          marginRight: '8px',
                          verticalAlign: 'middle',
                        }}
                        alt=""
                      />
                      {e.name}
                    </td>
                    <td style={{ ...c, color: '#888' }}>{e.ownerName}</td>
                    <td style={n}>{e.rating}</td>
                    <td style={n}>{Math.round(e.winRate * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
