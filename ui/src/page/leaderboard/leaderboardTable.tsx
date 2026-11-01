import { Link } from 'react-router-dom';
import LeaderboardEntry from '../../types/leaderboardEntry';

// The ranked table shared by the global board (leaderboardPage) and personal
// tournament boards (tournamentPage, GitHub #119). Both are the same Elo ratings
// in the same order; a tournament just filters and renumbers the rows, so they
// render identically.

// Podium markers for the top three (shown in the far-left column). 1st gets a
// trophy, 2nd/3rd the silver/bronze medals.
const medal = (rank: number): string =>
  rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
const placeLabel = (rank: number): string | undefined =>
  ({ 1: 'First place', 2: 'Second place', 3: 'Third place' })[rank];

// Movement over the last day: compare the row's current rank to where it sat
// ~24h ago (server-provided `previousRank`). A lower rank number is better, so a
// previousRank *above* the current rank means the bot climbed. Only movers get a
// marker — green ▲ up / red ▼ down; unchanged rows render nothing. Colors read
// on light and dark.
const MOVE_UP = '#2e7d32';
const MOVE_DOWN = '#c0392b';
// The rating every app starts at (mirrors the server's DEFAULT_RATING). A brand
// -new entrant has no reconstructable previousRank, so we can't show a rank
// change — but if it's already above the starting line it has a winning record,
// which we surface as a ▲. New bots at or below the start show no marker (no
// need to paint a fresh bot red on day one).
const STARTING_RATING = 1500;
interface Move {
  symbol: string;
  color: string;
  label: string;
}
const movement = (e: LeaderboardEntry): Move | null => {
  if (e.previousRank == null)
    // New entrant (no ranked standing 24h ago): ▲ only if it's already winning.
    return e.rating > STARTING_RATING
      ? {
          symbol: '▲',
          color: MOVE_UP,
          label: `New, already above the ${STARTING_RATING} starting rating`,
        }
      : null;
  const delta = e.previousRank - e.rank;
  if (delta > 0)
    return {
      symbol: '▲',
      color: MOVE_UP,
      label: `Up ${delta} ${delta === 1 ? 'place' : 'places'} since yesterday`,
    };
  if (delta < 0)
    return {
      symbol: '▼',
      color: MOVE_DOWN,
      label: `Down ${-delta} ${delta === -1 ? 'place' : 'places'} since yesterday`,
    };
  return null; // unchanged — no marker
};

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

export default function LeaderboardTable({
  entries,
}: {
  entries: LeaderboardEntry[];
}) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          {/* podium column (medal) for the top three, far left */}
          <th style={numCell} aria-hidden="true"></th>
          <th style={cell} title="Rank, with change over the last 24h">
            #
          </th>
          <th style={cell}>Bot</th>
          <th style={cell}>Owner</th>
          <th style={numCell}>Rating</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const top3 = e.rank <= 3;
          // Server-authoritative: the viewer's own rows are bolded.
          const isOwn = e.own;
          // A bot its owner made public (GitHub #117) links to the read-only
          // view of its source; the server includes the appId exactly when
          // there is such a page to link to.
          const sourceLink = e.public && e.appId ? `/app/${e.appId}` : null;
          const first = top3 ? goldFirstCell(numCell) : numCell;
          const c = top3 ? goldCell(cell) : cell;
          const n = top3 ? goldCell(numCell) : numCell;
          const mv = movement(e);
          return (
            <tr key={e.rank} style={{ fontWeight: isOwn ? 700 : 400 }}>
              <td style={first} aria-label={placeLabel(e.rank)}>
                {medal(e.rank)}
              </td>
              <td style={c}>
                {e.rank}
                {mv && (
                  <span
                    style={{
                      color: mv.color,
                      marginLeft: 6,
                      fontSize: '0.85em',
                      whiteSpace: 'nowrap',
                    }}
                    aria-label={mv.label}
                    title={mv.label}
                  >
                    {mv.symbol}
                  </span>
                )}
              </td>
              <td style={c}>
                <img
                  src={`/sprites/tank_${e.color}.png`}
                  style={{
                    height: '1.1em',
                    marginRight: '8px',
                    verticalAlign: 'middle',
                  }}
                  alt=""
                />
                {sourceLink ? (
                  <Link
                    to={sourceLink}
                    title="Public bot: read its source"
                    aria-label={`${e.name}: read its source`}
                  >
                    {e.name}
                  </Link>
                ) : (
                  e.name
                )}
              </td>
              <td style={{ ...c, color: '#888' }}>{e.ownerName}</td>
              <td style={n}>{e.rating}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
