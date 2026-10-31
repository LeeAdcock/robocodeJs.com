import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Button from 'react-bootstrap/Button';
import { TournamentBoard } from '../../types/tournament';
import LeaderboardTable from './leaderboardTable';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';
import { copyText } from '../../util/copyText';

// A personal tournament board (GitHub #119) at /leaderboard/:tournamentId. The
// URL is the join link: anyone holding it can view the board (signed in or not),
// and a signed-in viewer can join (adding all of their rated apps to it) or
// leave. The creator can also rename or delete it. Rankings are the global Elo
// ratings, filtered to members' apps, so nothing here starts a match.
const REFRESH_MS = 30000;

const apiError = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: { error?: string } } })?.response
    ?.data;
  return data?.error ?? fallback;
};

export default function TournamentPage(props: { signedIn: boolean }) {
  const { tournamentId } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<TournamentBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  useDocumentTitle(brandTitle(board ? board.name : 'Tournament'));

  const load = useCallback(async () => {
    try {
      const res = await axios.get<TournamentBoard>(
        `/api/tournaments/${tournamentId}`
      );
      setBoard(res.data);
      setLoadError(null);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      setLoadError(
        status === 404 || status === 400
          ? 'This tournament doesn’t exist. It may have been deleted, or the link is incomplete.'
          : 'Could not load the tournament.'
      );
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
    // Reload when sign-in state changes, so join/owner state is current.
  }, [load, props.signedIn]);

  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(apiError(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const join = () =>
    act(
      () => axios.put(`/api/tournaments/${tournamentId}/members/me`),
      'Could not join the tournament.'
    );
  const leave = () =>
    act(
      () => axios.delete(`/api/tournaments/${tournamentId}/members/me`),
      'Could not leave the tournament.'
    );
  const rename = () =>
    act(async () => {
      await axios.patch(`/api/tournaments/${tournamentId}`, { name: newName });
      setRenaming(false);
    }, 'Could not rename the tournament.');
  const remove = async () => {
    if (
      !window.confirm(
        `Delete “${board?.name}”? Members’ bots and ratings are not affected, but the link will stop working.`
      )
    )
      return;
    setBusy(true);
    try {
      await axios.delete(`/api/tournaments/${tournamentId}`);
      navigate('/leaderboard');
    } catch (err) {
      setActionError(apiError(err, 'Could not delete the tournament.'));
      setBusy(false);
    }
  };

  const link = `${window.location.origin}/leaderboard/${tournamentId}`;
  const share = async () => {
    setNotice(
      (await copyText(link))
        ? 'Join link copied to your clipboard.'
        : `Could not copy. Link: ${link}`
    );
    setTimeout(() => setNotice(''), 5000);
  };

  if (loadError && !board)
    return (
      <div className="markdown">
        <h1>Tournament</h1>
        <p>{loadError}</p>
        <p>
          <Link to="/leaderboard">← Global rankings</Link>
        </p>
      </div>
    );

  if (!board)
    return (
      <div className="markdown">
        <h1>Tournament</h1>
        <p>Loading tournament…</p>
      </div>
    );

  return (
    <div>
      <div className="markdown">
        <h1>{board.name}</h1>
        <p>
          A personal tournament
          {board.ownerName ? ` created by ${board.ownerName}` : ''}. It ranks
          the bots of its {board.memberCount}{' '}
          {board.memberCount === 1 ? 'member' : 'members'} by their{' '}
          <Link to="/leaderboard">global Elo rating</Link>. There are no
          separate matches: joining adds all of your rated bots, and leaving
          takes them out. Share the link below to invite others.
        </p>
        {board.members.length > 0 && (
          <p style={{ color: '#888' }}>Members: {board.members.join(', ')}</p>
        )}
      </div>

      <div style={{ padding: '0 20px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <input
            readOnly
            value={link}
            aria-label="Join link"
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: '1 1 260px',
              minWidth: 0,
              padding: '4px 8px',
              background: 'var(--bg)',
              color: 'var(--fg)',
              border: '1px solid var(--rule)',
              borderRadius: 4,
            }}
          />
          <Button size="sm" variant="outline-secondary" onClick={share}>
            Copy join link
          </Button>
          {props.signedIn &&
            (board.joined ? (
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={busy}
                onClick={leave}
              >
                Leave tournament
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={busy || board.memberCount >= board.maxMembers}
                onClick={join}
              >
                Join tournament
              </Button>
            ))}
          {board.isOwner && !renaming && (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={busy}
              onClick={() => {
                setNewName(board.name);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
          )}
          {board.isOwner && (
            <Button
              size="sm"
              variant="outline-danger"
              disabled={busy}
              onClick={remove}
            >
              Delete
            </Button>
          )}
        </div>

        {renaming && (
          <form
            style={{ display: 'flex', gap: 8, marginBottom: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <input
              value={newName}
              maxLength={50}
              aria-label="Tournament name"
              onChange={(e) => setNewName(e.target.value)}
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                padding: '4px 8px',
                background: 'var(--bg)',
                color: 'var(--fg)',
                border: '1px solid var(--rule)',
                borderRadius: 4,
              }}
            />
            <Button size="sm" type="submit" disabled={busy || !newName.trim()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setRenaming(false)}
            >
              Cancel
            </Button>
          </form>
        )}

        {!props.signedIn && (
          <p>Sign in (top right) to join this tournament with your bots.</p>
        )}
        {notice && <p>{notice}</p>}
        {actionError && <p style={{ color: '#c0392b' }}>{actionError}</p>}

        {board.entries.length === 0 ? (
          <p>
            No ranked bots yet. A member’s bot appears here once it has played a
            ranked match on the global ladder.
          </p>
        ) : (
          <LeaderboardTable entries={board.entries} />
        )}
      </div>
    </div>
  );
}
