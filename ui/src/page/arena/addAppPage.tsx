import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import axios from 'axios';
import User from '../../types/user';
import { titleCase } from '../../util/titleCase';

// Landing page for an app share link (`/add-app/:appId`). The share reference IS
// the app's id; a signed-in visitor confirms and the app is linked into their
// arena (add-by-reference — the app is never copied and its source stays
// owner-private; only its live bots are visible). If not signed in, prompt to
// sign in first.
interface AddAppPageProps {
  user: User;
  // Refresh the parent after a successful add (so the navbar Apps/arena reflect).
  onAdded?: () => void;
}

export default function AddAppPage(props: AddAppPageProps) {
  const { appId } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  // Resolve the app's metadata (name only) for the confirm prompt. Requires a
  // signed-in session (the /api/app route is auth-gated); skip while signed out.
  useEffect(() => {
    if (!appId || !props.user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    axios
      .get(`/api/app/${appId}`)
      .then((res) => setName(res.data.name || 'Unnamed app'))
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
            ? 'This app could not be added. Your arena may be full.'
            : 'Could not add this app. Please try again.'
        );
      })
      .finally(() => setAdding(false));
  };

  if (!props.user) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Add an app to your arena</h4>
        <p>Please sign in (top right) to add this app to your arena.</p>
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
        <h4>App not found</h4>
        <p>No app matches this link. Double-check the id and try again.</p>
      </div>
    );
  }

  if (added) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Added!</h4>
        <p>{titleCase(name || 'The app')} is now in your arena.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h4>Add {titleCase(name || 'this app')} to your arena?</h4>
      <p style={{ color: '#888' }}>
        This links the app into your arena so its bots battle alongside your
        other apps. You can remove it any time from the Arena → Manage apps
        menu.
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
