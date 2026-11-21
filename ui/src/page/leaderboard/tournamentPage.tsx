import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Button from 'react-bootstrap/Button';
import { TournamentBoard, TournamentSettings } from '../../types/tournament';
import LeaderboardTable from './leaderboardTable';
import { brandTitle, useDocumentTitle } from '../../util/useDocumentTitle';
import { copyText } from '../../util/copyText';

// A personal tournament board (GitHub #119) at /leaderboard/:tournamentId. The
// URL is the join link: anyone holding it can view the board (signed in or not),
// and a signed-in viewer can join (adding all of their rated apps to it) or
// leave. The creator can also rename or delete it, and set the board's rules
// (see TournamentSettings): caps, a games floor, player-vs-bot ranking, hidden
// owners, public-only, a closed roster, an end date and an edited-since date.
// Rankings are the global Elo ratings, filtered to members' apps, so nothing
// here starts a match.
const REFRESH_MS = 30000;

const apiError = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: { error?: string } } })?.response
    ?.data;
  return data?.error ?? fallback;
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

// A few sentences describing the creator's board rules for every viewer, so a
// visitor knows they're looking at (say) each member's top three. Empty when
// the board is unrestricted — the default needs no explanation.
const describeSettings = (s: TournamentSettings, ended: boolean): string => {
  const out: string[] = [];
  const parts: string[] = [];
  if (s.rankBy === 'members') parts.push('each player’s best bot');
  else if (s.maxAppsPerMember !== null)
    parts.push(
      s.maxAppsPerMember === 1
        ? 'each member’s best bot'
        : `each member’s top ${s.maxAppsPerMember} bots`
    );
  if (s.maxEntries !== null) parts.push(`the top ${s.maxEntries} overall`);
  if (s.minGames !== null)
    parts.push(
      `bots with at least ${s.minGames} ranked ${s.minGames === 1 ? 'game' : 'games'}`
    );
  if (s.publicOnly) parts.push('public bots only');
  if (s.editedSince !== null)
    parts.push(`bots edited since ${fmtWhen(s.editedSince)}`);
  if (parts.length) out.push(`Showing ${parts.join(', ')}.`);
  if (s.hideOwners) out.push('Owner names are hidden.');
  if (s.endsAt !== null)
    out.push(
      ended
        ? `Final standings as of ${fmtWhen(s.endsAt)}.`
        : `Ends ${fmtWhen(s.endsAt)}.`
    );
  if (s.joinLocked && !ended) out.push('Joining is closed.');
  return out.join(' ');
};

// A number input holds the typed text; blank means "no limit".
const capText = (n: number | null) => (n === null ? '' : String(n));
const capValue = (text: string): number | null =>
  text.trim() === '' ? null : Number(text);

// A datetime-local input wants "YYYY-MM-DDTHH:MM" in the viewer's zone and
// gives the same back; the server speaks ISO 8601 (UTC). Blank = no date.
const whenText = (iso: string | null): string => {
  if (iso === null) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const whenValue = (text: string): string | null =>
  text.trim() === '' ? null : new Date(text).toISOString();

// The settings form's working copy — text for the typed fields.
interface SettingsDraft {
  maxAppsPerMember: string;
  maxEntries: string;
  minGames: string;
  rankBy: 'bots' | 'members';
  hideOwners: boolean;
  publicOnly: boolean;
  joinLocked: boolean;
  endsAt: string;
  editedSince: string;
}
const toDraft = (s: TournamentSettings): SettingsDraft => ({
  maxAppsPerMember: capText(s.maxAppsPerMember),
  maxEntries: capText(s.maxEntries),
  minGames: capText(s.minGames),
  rankBy: s.rankBy,
  hideOwners: s.hideOwners,
  publicOnly: s.publicOnly,
  joinLocked: s.joinLocked,
  endsAt: whenText(s.endsAt),
  editedSince: whenText(s.editedSince),
});
const fromDraft = (d: SettingsDraft): TournamentSettings => ({
  maxAppsPerMember: capValue(d.maxAppsPerMember),
  maxEntries: capValue(d.maxEntries),
  minGames: capValue(d.minGames),
  rankBy: d.rankBy,
  hideOwners: d.hideOwners,
  publicOnly: d.publicOnly,
  joinLocked: d.joinLocked,
  endsAt: whenValue(d.endsAt),
  editedSince: whenValue(d.editedSince),
});

const fieldStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--rule)',
  borderRadius: 4,
};
const labelStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  margin: 0,
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
  const [editingSettings, setEditingSettings] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const edit = (patch: Partial<SettingsDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
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
  const saveSettings = () =>
    act(async () => {
      if (!draft) return;
      // A non-number would serialize as null and silently clear the rule.
      for (const text of [
        draft.maxAppsPerMember,
        draft.maxEntries,
        draft.minGames,
      ])
        if (text.trim() !== '' && !Number.isFinite(Number(text)))
          throw new Error('Each limit must be a whole number, or blank.');
      await axios.patch(`/api/tournaments/${tournamentId}`, fromDraft(draft));
      setEditingSettings(false);
    }, 'Could not save the tournament settings.');
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

  const rules = describeSettings(board.settings, board.ended);

  return (
    <div>
      <div className="markdown">
        <h1>{board.name}</h1>
        <p>
          A personal tournament
          {board.ownerName ? ` created by ${board.ownerName}` : ''}, ranked by{' '}
          <Link to="/leaderboard">global rating</Link>. {rules}
        </p>
        {/* The roster and the sharing/management controls below are the
          creator's; the server only sends `members` to them. */}
        {board.isOwner && board.members && board.members.length > 0 && (
          <p style={{ color: '#888' }}>
            {board.memberCount} {board.memberCount === 1 ? 'member' : 'members'}
            : {board.members.join(', ')}
          </p>
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
          {board.isOwner && (
            <input
              readOnly
              value={link}
              aria-label="Join link"
              onFocus={(e) => e.currentTarget.select()}
              style={{ ...fieldStyle, flex: '1 1 260px', minWidth: 0 }}
            />
          )}
          {board.isOwner && (
            <Button size="sm" variant="outline-secondary" onClick={share}>
              Copy join link
            </Button>
          )}
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
                disabled={
                  busy ||
                  board.memberCount >= board.maxMembers ||
                  board.joinClosed !== undefined
                }
                title={board.joinClosed}
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
          {board.isOwner && !editingSettings && (
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(toDraft(board.settings));
                setEditingSettings(true);
              }}
            >
              Settings
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

        {editingSettings && draft && (
          <form
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'end',
              marginBottom: 12,
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveSettings();
            }}
          >
            <label style={labelStyle}>
              <span>Rank</span>
              <select
                value={draft.rankBy}
                onChange={(e) =>
                  edit({ rankBy: e.target.value as 'bots' | 'members' })
                }
                style={{ ...fieldStyle, width: 170 }}
              >
                <option value="bots">Every bot</option>
                <option value="members">Players (best bot)</option>
              </select>
            </label>
            <label style={labelStyle}>
              <span>Bots per member</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={board.settingsLimits.maxAppsPerMember}
                step={1}
                value={draft.maxAppsPerMember}
                placeholder="All"
                disabled={draft.rankBy === 'members'}
                onChange={(e) => edit({ maxAppsPerMember: e.target.value })}
                style={{ ...fieldStyle, width: 110 }}
              />
            </label>
            <label style={labelStyle}>
              <span>Bots shown</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={board.settingsLimits.maxEntries}
                step={1}
                value={draft.maxEntries}
                placeholder="All"
                onChange={(e) => edit({ maxEntries: e.target.value })}
                style={{ ...fieldStyle, width: 110 }}
              />
            </label>
            <label style={labelStyle}>
              <span>Minimum ranked games</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={board.settingsLimits.minGames}
                step={1}
                value={draft.minGames}
                placeholder="1"
                onChange={(e) => edit({ minGames: e.target.value })}
                style={{ ...fieldStyle, width: 110 }}
              />
            </label>
            <label style={labelStyle}>
              <span>Count bots edited since</span>
              <input
                type="datetime-local"
                value={draft.editedSince}
                onChange={(e) => edit({ editedSince: e.target.value })}
                style={fieldStyle}
              />
            </label>
            <label style={labelStyle}>
              <span>Ends</span>
              <input
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => edit({ endsAt: e.target.value })}
                style={fieldStyle}
              />
            </label>
            <div
              style={{
                flexBasis: '100%',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <label style={checkStyle}>
                <input
                  type="checkbox"
                  checked={draft.hideOwners}
                  onChange={(e) => edit({ hideOwners: e.target.checked })}
                />{' '}
                Hide owner names
              </label>
              <label style={checkStyle}>
                <input
                  type="checkbox"
                  checked={draft.publicOnly}
                  onChange={(e) => edit({ publicOnly: e.target.checked })}
                />{' '}
                Public bots only
              </label>
              <label style={checkStyle}>
                <input
                  type="checkbox"
                  checked={draft.joinLocked}
                  onChange={(e) => edit({ joinLocked: e.target.checked })}
                />{' '}
                Close joining
              </label>
            </div>
            <Button size="sm" type="submit" disabled={busy}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => setEditingSettings(false)}
            >
              Cancel
            </Button>
            <p style={{ flexBasis: '100%', margin: 0, color: '#888' }}>
              Leave a field blank for no limit. Caps keep each member’s
              highest-rated bots, and ranks are renumbered over what is shown.
              Once the end date passes the standings are final; move or clear it
              to reopen the board.
            </p>
          </form>
        )}

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
              style={{ ...fieldStyle, flex: '1 1 auto', minWidth: 0 }}
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
        {props.signedIn && !board.joined && board.joinClosed && (
          <p>{board.joinClosed}</p>
        )}
        {notice && <p>{notice}</p>}
        {actionError && <p style={{ color: '#c0392b' }}>{actionError}</p>}

        {board.entries.length === 0 ? (
          <p>
            No ranked bots{board.ended ? '' : ' yet'}. A member’s bot appears
            here once it has played a ranked match on the global ladder
            {rules ? ' and meets the rules above' : ''}.
          </p>
        ) : (
          <LeaderboardTable
            entries={board.entries}
            rankBy={board.settings.rankBy}
          />
        )}
      </div>
    </div>
  );
}
