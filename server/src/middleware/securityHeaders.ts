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
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
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
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
});

export default securityHeaders;
