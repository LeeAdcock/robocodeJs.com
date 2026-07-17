import React, { useState, useEffect, useCallback } from 'react';
import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import InputGroup from 'react-bootstrap/InputGroup';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import { FaUnlink, FaPlus } from 'react-icons/fa';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import Arena from '../types/arena';
import ArenaMember from '../types/arenaMember';
import { colors } from '../util/colors';
import { titleCase } from '../util/titleCase';

// The arena roster: every app linked to the owner's arena — their own and any
// added by reference — with an enable/disable toggle and an unlink action, plus
// "New app" and "Add existing (by id)". Opened as a modal from the Arena menu.
// (Terminology: an "app" is the program/code; when enabled it fields "bots" —
// the live bot instances — in the arena.) The roster (GET .../arena/members)
// is the source of truth for membership INCLUDING disabled apps; live bot
// state flows separately over SSE.
interface ArenaRosterProps {
  show: boolean;
  onHide: () => void;
  userId: string;
  arena: Arena;
  // Refresh the parent's user (so the navbar's Apps list reflects a new app).
  onChanged?: () => void;
}

// A full app id (uuid) is 36 chars; use that to decide when to preview a pasted
// reference. Nothing security-sensitive — the server validates the id.
const UUID_LENGTH = 36;

// Match the arena color assignment used elsewhere (navbar's AppLink): an app's
// color is its index among the LIVE apps. A disabled / not-yet-live app has no
// live index, so it shows a muted neutral icon.
function MemberIcon({ arena, appId }: { arena: Arena; appId: string }) {
  const index = arena?.apps.map((app) => app.id).indexOf(appId) ?? -1;
  const src =
    index === -1
      ? '/sprites/tank_dark.png'
      : `/sprites/tank_${colors[index]}.png`;
  return (
    <img
      src={src}
      style={{
        height: '1.1em',
        marginRight: '8px',
        opacity: index === -1 ? 0.4 : 1,
      }}
      alt=""
    />
  );
}

export default function ArenaRoster(props: ArenaRosterProps) {
  const { show, onHide, userId, arena, onChanged } = props;
  const navigate = useNavigate();

  const [members, setMembers] = useState<ArenaMember[]>([]);
  // The signed-in user's own apps (id + name only) so they can be added to the
  // arena with one click, instead of pasting an id. Fetched alongside the roster.
  const [myApps, setMyApps] = useState<{ id: string; name?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // appIds with an in-flight mutation, so their row controls disable + spin.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  // "Add existing" form.
  const [addId, setAddId] = useState('');
  const [addPreview, setAddPreview] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const setBusyFor = (appId: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(appId);
      else next.delete(appId);
      return next;
    });

  const refetch = useCallback(() => {
    setLoading(true);
    // The user's own apps power the one-click add list; a failure there is
    // non-critical (the add-by-id form still works), so it's fetched separately.
    axios
      .get(`/api/user/${userId}/apps`)
      .then((res) => setMyApps(res.data))
      .catch(() => setMyApps([]));
    return axios
      .get(`/api/user/${userId}/arena/members`)
      .then((res) => setMembers(res.data))
      .catch(() => setError('Could not load the arena roster.'))
      .finally(() => setLoading(false));
  }, [userId]);

  // Load (and reset the add form) each time the dialog opens.
  useEffect(() => {
    if (!show) return;
    setError(null);
    setAddId('');
    setAddPreview(null);
    setAddError(null);
    refetch();
  }, [show, refetch]);

  // Preview a pasted id by resolving its metadata (name only). Runs once the
  // input looks like a complete id; failure just clears the preview/leaves an
  // error for the eventual Add attempt to report.
  useEffect(() => {
    const id = addId.trim();
    setAddError(null);
    if (id.length !== UUID_LENGTH) {
      setAddPreview(null);
      return;
    }
    let cancelled = false;
    axios
      .get(`/api/app/${id}`)
      .then((res) => {
        if (!cancelled) setAddPreview(res.data.name || 'Unnamed app');
      })
      .catch(() => {
        if (!cancelled) setAddPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [addId]);

  const atCapacity = members.length >= 5;

  // Render in a stable, deterministic order (add-time, then appId) so toggling
  // an app's enabled state never reshuffles the list, regardless of the order the
  // server happens to return.
  const orderedMembers = [...members].sort(
    (a, b) =>
      a.addedTimestamp - b.addedTimestamp || a.appId.localeCompare(b.appId)
  );

  // Your own apps not already in this arena — offered as a one-click add.
  const memberIds = new Set(members.map((m) => m.appId));
  const availableApps = myApps
    .filter((a) => !memberIds.has(a.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const toggleEnabled = (member: ArenaMember) => {
    setBusyFor(member.appId, true);
    axios
      .post(`/api/user/${userId}/arena/app/${member.appId}/enabled`, {
        enabled: !member.enabled,
      })
      .then(() => refetch())
      .catch(() => setError('Could not update that app.'))
      .finally(() => setBusyFor(member.appId, false));
  };

  const unlink = (member: ArenaMember) => {
    setBusyFor(member.appId, true);
    axios
      .delete(`/api/user/${userId}/arena/app/${member.appId}`)
      .then(() => refetch())
      .then(() => onChanged?.())
      .catch(() => setError('Could not remove that app.'))
      .finally(() => setBusyFor(member.appId, false));
  };

  const createNew = () => {
    setError(null);
    axios
      .post(`/api/user/${userId}/app`)
      .then((res) =>
        axios.put(`/api/user/${userId}/arena/app/${res.data.appId}`)
      )
      .then(() => refetch())
      .then(() => onChanged?.())
      .catch(() => setError('Could not create a new app.'));
  };

  const addOwnApp = (appId: string) => {
    setBusyFor(appId, true);
    setError(null);
    axios
      .put(`/api/user/${userId}/arena/app/${appId}`)
      .then(() => refetch())
      .then(() => onChanged?.())
      .catch(() => setError('Could not add that app.'))
      .finally(() => setBusyFor(appId, false));
  };

  const addExisting = () => {
    const id = addId.trim();
    if (!id) return;
    setAddBusy(true);
    setAddError(null);
    axios
      .put(`/api/user/${userId}/arena/app/${id}`)
      .then(() => {
        setAddId('');
        setAddPreview(null);
        return refetch();
      })
      .then(() => onChanged?.())
      .catch((err) => {
        const status = err?.response?.status;
        setAddError(
          status === 404
            ? 'No app found with that id.'
            : status === 400
              ? 'That app could not be added (invalid id or the arena is full).'
              : 'Could not add that app.'
        );
      })
      .finally(() => setAddBusy(false));
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Arena apps</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div
          style={{ fontSize: '0.85em', color: '#888', marginBottom: '12px' }}
        >
          Switch an app on to send its bots into the arena, or off to bench it
          (it stays in the list). Unlinking removes an app from this arena only.
          The app itself is never deleted.
        </div>

        {error && (
          <div className="text-danger" style={{ marginBottom: '10px' }}>
            {error}
          </div>
        )}

        {loading && members.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spinner animation="border" size="sm" /> Loading…
          </div>
        ) : members.length === 0 ? (
          <div style={{ color: '#888', padding: '6px 0' }}>
            No apps in this arena yet. Add one below.
          </div>
        ) : (
          <div>
            {orderedMembers.map((member) => {
              const isBusy = busy.has(member.appId);
              return (
                <div
                  key={member.appId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 0',
                    opacity: member.enabled ? 1 : 0.55,
                  }}
                >
                  <MemberIcon arena={arena} appId={member.appId} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        cursor: member.isOwn ? 'pointer' : 'default',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      onClick={() =>
                        member.isOwn &&
                        navigate(`/user/${userId}/app/${member.appId}`)
                      }
                    >
                      {titleCase(member.name || 'Unknown')}
                    </div>
                    <div style={{ fontSize: '0.8em', color: '#888' }}>
                      {member.isOwn
                        ? 'you'
                        : member.ownerName || 'another user'}
                    </div>
                  </div>
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip id={`roster-toggle-tip-${member.appId}`}>
                        {member.enabled
                          ? 'In the arena, switch off to bench this app'
                          : 'Benched, switch on to send this app into the arena'}
                      </Tooltip>
                    }
                  >
                    <span style={{ display: 'inline-flex' }}>
                      <Form.Check
                        type="switch"
                        id={`roster-toggle-${member.appId}`}
                        checked={member.enabled}
                        disabled={isBusy}
                        onChange={() => toggleEnabled(member)}
                        aria-label={`${member.enabled ? 'Disable' : 'Enable'} ${member.name || 'app'}`}
                        style={{ marginRight: '4px' }}
                      />
                    </span>
                  </OverlayTrigger>
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip id={`roster-unlink-tip-${member.appId}`}>
                        Remove from this arena (the app itself isn’t deleted)
                      </Tooltip>
                    }
                  >
                    <Button
                      variant="link"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => unlink(member)}
                      aria-label={`Unlink ${member.name || 'app'} from the arena`}
                      style={{ color: '#6c757d', padding: '0 6px' }}
                    >
                      <FaUnlink />
                    </Button>
                  </OverlayTrigger>
                </div>
              );
            })}
          </div>
        )}

        <hr />

        {availableApps.length > 0 && (
          <>
            <div
              style={{
                fontSize: '0.9em',
                color: '#888',
                marginBottom: '6px',
              }}
            >
              Add one of your apps
            </div>
            <div
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                marginBottom: '12px',
              }}
            >
              {availableApps.map((app) => (
                <div
                  key={app.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 0',
                  }}
                >
                  <MemberIcon arena={arena} appId={app.id} />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {titleCase(app.name || 'Unnamed app')}
                  </div>
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip id={`roster-add-tip-${app.id}`}>
                        {atCapacity
                          ? 'Arena is full. Remove an app first'
                          : 'Add this app to the arena'}
                      </Tooltip>
                    }
                  >
                    <span style={{ display: 'inline-flex' }}>
                      <Button
                        variant="link"
                        size="sm"
                        disabled={atCapacity || busy.has(app.id)}
                        onClick={() => addOwnApp(app.id)}
                        aria-label={`Add ${app.name || 'app'} to the arena`}
                        style={{ color: '#6c757d', padding: '0 6px' }}
                      >
                        {busy.has(app.id) ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          <FaPlus />
                        )}
                      </Button>
                    </span>
                  </OverlayTrigger>
                </div>
              ))}
            </div>
            <hr />
          </>
        )}

        <div style={{ fontSize: '0.9em', color: '#888', marginBottom: '6px' }}>
          Add someone else’s app by its id (or share link)
        </div>
        <InputGroup>
          <Form.Control
            size="sm"
            placeholder="App id"
            value={addId}
            disabled={atCapacity || addBusy}
            onChange={(e) => setAddId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addExisting();
              }
            }}
            aria-label="App id"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={atCapacity || addBusy || !addId.trim()}
            onClick={addExisting}
          >
            {addBusy ? <Spinner animation="border" size="sm" /> : <FaPlus />}{' '}
            Add
          </Button>
        </InputGroup>
        {addPreview && !addError && (
          <div style={{ fontSize: '0.8em', color: '#888', marginTop: '4px' }}>
            {titleCase(addPreview)}
          </div>
        )}
        {addError && (
          <div
            className="text-danger"
            style={{ fontSize: '0.8em', marginTop: '4px' }}
          >
            {addError}
          </div>
        )}
        {atCapacity && (
          <div style={{ fontSize: '0.8em', color: '#888', marginTop: '4px' }}>
            This arena is full (5 apps). Remove one to add another.
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={atCapacity}
          onClick={createNew}
        >
          <FaPlus /> New app
        </Button>
        <Button variant="secondary" size="sm" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
