import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

// Security response headers (OWASP A05). helmet sets a Content-Security-Policy,
// X-Frame-Options / frame-ancestors (clickjacking), X-Content-Type-Options:
// nosniff, HSTS, Referrer-Policy, and strips X-Powered-By.
//
// The CSP is tuned to exactly what the built SPA loads (verified against
// server/dist/public/index.html and the bundle):
//   - our own bundle + assets ...................... 'self'
//   - Google Identity Services (sign-in) ........... accounts.google.com/gsi/*
//   - Google Fonts (CSS + font files) .............. fonts.googleapis.com / fonts.gstatic.com
//   - Google profile avatars ....................... *.googleusercontent.com
//
// Two relaxations, both required by bundled UI libraries and neither of which
// re-opens the XSS hole this policy is meant to close:
//   - script-src 'unsafe-eval' — ace-builds + prettier call eval()/Function() in
//     the editor chunk. This permits eval OF the app's own already-trusted code;
//     it does NOT permit injected inline <script> or scripts from other origins
//     (those still need 'unsafe-inline' / an allow-listed origin, which we don't
//     grant), so the latent markdown-XSS vector stays blocked.
//   - style-src 'unsafe-inline' — ace-builds injects <style> elements at runtime
//     for editor themes. Style injection is far lower risk than script injection.
//
// crossOriginOpenerPolicy is loosened to 'same-origin-allow-popups' so Google
// sign-in's popup/postMessage flow isn't severed by the default 'same-origin'.
// upgrade-insecure-requests is disabled so a plain-HTTP deploy (or local test of
// the production build) doesn't try to upgrade same-origin asset URLs to HTTPS
// and fail; production terminates TLS at the load balancer and HSTS covers transport.
const directives = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-eval'",
    'https://accounts.google.com/gsi/client',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
    'https://accounts.google.com/gsi/style',
  ],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com'],
  'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'upgrade-insecure-requests': null,
};

const siteHeaders = helmet({
  contentSecurityPolicy: { useDefaults: true, directives },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
});

// The public spectator page (/watch/:arenaId) is the one page that may be
// framed, and only by VS Code: the RobocodeJs extension shows the live arena
// in an editor panel by framing this page, so the arena keeps one renderer and
// one copy of the client physics. General embedding stays off (GitHub #126).
//
// frame-ancestors is checked against EVERY ancestor, not just the parent: the
// page sits in a webview iframe, which sits in the VS Code workbench. So both
// layers' origins are listed, for each way VS Code runs:
//   - desktop ............... webview vscode-webview:,  workbench vscode-file:
//   - Codespaces/github.dev . webview *.vscode-cdn.net, workbench *.github.dev
//   - vscode.dev ............ webview *.vscode-cdn.net, workbench (insiders.)vscode.dev
// The page is read-only and public (no session, no controls), so being framed
// exposes nothing a visitor couldn't already see at the URL; clickjacking needs
// something to click. X-Frame-Options is dropped here because it can't express
// an allow-list, and frame-ancestors supersedes it in every current browser.
export const VSCODE_FRAME_ANCESTORS = [
  "'self'",
  'vscode-webview:',
  'vscode-file:',
  'https://*.vscode-cdn.net',
  'https://*.github.dev',
  'https://vscode.dev',
  'https://insiders.vscode.dev',
];

const watchHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { ...directives, 'frame-ancestors': VSCODE_FRAME_ANCESTORS },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  xFrameOptions: false,
});

export const securityHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
) =>
  (req.path.startsWith('/watch/') ? watchHeaders : siteHeaders)(req, res, next);

export default securityHeaders;
