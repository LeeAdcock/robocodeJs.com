import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Button from 'react-bootstrap/Button';
import { TournamentSummary } from '../../types/tournament';

// The "Personal tournaments" section of /leaderboard (GitHub #119): the
// tournaments the viewer created or joined, and a form to create one. Creating
// one goes straight to its board, whose URL is the join link to share.
export default function TournamentsPanel(props: { signedIn: boolean }) {
  const navigate = useNavigate();
  const [mine, setMine] = useState<TournamentSummary[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.signedIn) {
      setMine(null);
      return;
    }
    let cancelled = false;
    axios
      .get<TournamentSummary[]>('/api/tournaments')
      .then((res) => !cancelled && setMine(res.data))
      .catch(() => !cancelled && setMine([]));
    return () => {
      cancelled = true;
    };
  }, [props.signedIn]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await axios.post<{ id: string }>('/api/tournaments', {
        name,
      });
      navigate(`/leaderboard/${res.data.id}`);
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? 'Could not create the tournament.'
      );
      setBusy(false);
    }
  };

  return (
    // Its own .markdown block (outside the board's padded container) so the
    // heading gets the same grass-tile h1 treatment as the page title and the
    // prose lines up with the intro above.
    <section className="markdown" style={{ marginTop: 32 }}>
      <h1>Personal tournaments</h1>
      <p>
        Rank your bots against just your friends, class, or club. A personal
        tournament uses the same global ratings shown above, filtered to the
        bots of the people who join. Create one and share its link. Anyone with
        the link can view it, and joining adds all of your bots.
      </p>

      {!props.signedIn && <p>Sign in (top right) to create or join one.</p>}

      {props.signedIn && mine !== null && mine.length > 0 && (
        <ul>
          {mine.map((t) => (
            <li key={t.id}>
              <Link to={`/leaderboard/${t.id}`}>{t.name}</Link>{' '}
              <span style={{ color: '#888' }}>
                · {t.memberCount} {t.memberCount === 1 ? 'member' : 'members'}
                {t.isOwner ? ' · created by you' : ''}
                {!t.joined ? ' · you left' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {props.signedIn && (
        <form
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            maxWidth: 540,
            paddingLeft: 20,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            value={name}
            maxLength={50}
            placeholder="Tournament name"
            aria-label="New tournament name"
            onChange={(e) => setName(e.target.value)}
            style={{
              flex: '1 1 200px',
              minWidth: 0,
              padding: '4px 8px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              border: '1px solid var(--rule)',
              borderRadius: 4,
            }}
          />
          <Button size="sm" type="submit" disabled={busy || !name.trim()}>
            Create tournament
          </Button>
        </form>
      )}
      {error && <p style={{ color: '#c0392b' }}>{error}</p>}
    </section>
  );
}
