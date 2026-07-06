import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import axios from 'axios';
import User from '../../types/user';
import { titleCase } from '../../util/titleCase';

// Landing page for a bot share link (`/add-bot/:appId`). The share reference IS
// the bot's app id; a signed-in visitor confirms and the bot is linked into
// their arena (add-by-reference — the underlying app is never copied and its
// source stays owner-private). If not signed in, prompt to sign in first.
interface AddBotPageProps {
  user: User;
  // Refresh the parent after a successful add (so the navbar Apps/arena reflect).
  onAdded?: () => void;
}

export default function AddBotPage(props: AddBotPageProps) {
  const { appId } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  // Resolve the bot's metadata (name only) for the confirm prompt. Requires a
  // signed-in session (the /api/app route is auth-gated); skip while signed out.
  useEffect(() => {
    if (!appId || !props.user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    axios
      .get(`/api/app/${appId}`)
      .then((res) => setName(res.data.name || 'Unnamed bot'))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [appId, props.user]);

  const add = () => {
    if (!appId || !props.user) return;
    setAdding(true);
    setError(null);
    axios
      .put(`/api/user/${props.user.id}/arena/app/${appId}`)
      .then(() => {
        setAdded(true);
        props.onAdded?.();
        setTimeout(() => navigate('/'), 1200);
      })
      .catch((err) => {
        const status = err?.response?.status;
        setError(
          status === 400
            ? 'This bot could not be added — your arena may be full.'
            : 'Could not add this bot. Please try again.'
        );
      })
      .finally(() => setAdding(false));
  };

  if (!props.user) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Add a bot to your arena</h4>
        <p>Please sign in (top right) to add this bot to your arena.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '20px' }}>
        <Spinner animation="border" size="sm" /> Loading…
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Bot not found</h4>
        <p>No bot matches this link. Double-check the id and try again.</p>
      </div>
    );
  }

  if (added) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Added!</h4>
        <p>{titleCase(name || 'The bot')} is now in your arena.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h4>Add {titleCase(name || 'this bot')} to your arena?</h4>
      <p style={{ color: '#888' }}>
        This links the bot into your arena so it battles alongside your other
        bots. You can remove it any time from the Arena → Manage bots menu.
      </p>
      {error && <div className="text-danger">{error}</div>}
      <div style={{ marginTop: '12px' }}>
        <Button variant="primary" onClick={add} disabled={adding}>
          {adding ? <Spinner animation="border" size="sm" /> : null} Add to my
          arena
        </Button>{' '}
        <Button variant="link" onClick={() => navigate('/')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
