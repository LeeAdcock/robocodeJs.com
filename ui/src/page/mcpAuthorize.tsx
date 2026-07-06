import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import Spinner from 'react-bootstrap/Spinner';
import axios from 'axios';
import User from '../types/user';

// OAuth approval page for the MCP flow (`/mcp/authorize`). An MCP client
// (claude.ai, Claude Desktop, Claude Code, the Inspector) sends the user's
// browser here via our authorization-server /authorize endpoint, which redirects
// with the OAuth params in the query string. Here — where the session cookie is
// available — we make sure the user is signed in (the normal Google sign-in in
// the navbar), then AUTO-APPROVE: because a token only ever grants access to the
// user's own bots/arenas, there is no Allow/Deny step. We POST the params to
// /api/oauth/authorize, which mints an authorization code and returns the client
// redirect; we navigate the browser there to complete the exchange.
interface McpAuthorizePageProps {
  user: User;
}

export default function McpAuthorizePage(props: McpAuthorizePageProps) {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // Guard so the auto-approve POST fires once even under React StrictMode's
  // double-invoked effects (a second code mint would be wasted).
  const submitted = useRef(false);

  const clientName = params.get('client_name') || 'an application';
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');

  const invalid = !clientId || !redirectUri || !codeChallenge;

  useEffect(() => {
    if (invalid || !props.user || submitted.current) return;
    submitted.current = true;
    axios
      .post('/api/oauth/authorize', {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: params.get('scope') || undefined,
        state: params.get('state') || undefined,
      })
      .then((res) => {
        // Hand control back to the MCP client to exchange the code for a token.
        window.location.assign(res.data.location);
      })
      .catch((err) => {
        submitted.current = false;
        const code = err?.response?.data?.error;
        setError(
          code === 'invalid_client'
            ? 'This application is not registered. Try reconnecting from your client.'
            : 'Could not complete the connection. Please try again from your client.'
        );
      });
  }, [invalid, props.user, clientId, redirectUri, codeChallenge, params]);

  if (invalid) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Invalid connection request</h4>
        <p>
          This link is missing required information. Start the connection again
          from your AI client.
        </p>
      </div>
    );
  }

  if (!props.user) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Connect {clientName} to RobocodeJs</h4>
        <p>
          Please sign in (top right) to allow {clientName} to access your bots
          and arenas.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px' }}>
        <h4>Connection failed</h4>
        <p className="text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h4>
        <Spinner animation="border" size="sm" /> Connecting {clientName}…
      </h4>
      <p style={{ color: '#888' }}>
        Authorizing {clientName} to manage your bots and arenas. You&rsquo;ll be
        returned to your client automatically.
      </p>
    </div>
  );
}
