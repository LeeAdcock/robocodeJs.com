import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import securityHeaders from '../src/middleware/securityHeaders';

// Locks in the security headers (OWASP A05) and the specific CSP allowances the
// SPA needs — so a future CSP tweak that would silently break Google sign-in,
// Google Fonts, or the editor gets caught here.
describe('security headers', () => {
  const app = express();
  app.use(securityHeaders);
  app.get('/x', (_req, res) => {
    res.send('ok');
  });

  it('sets the core hardening headers', async () => {
    const res = await request(app).get('/x');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
    // Loosened so Google sign-in's popup flow isn't severed.
    expect(res.headers['cross-origin-opener-policy']).toBe(
      'same-origin-allow-popups'
    );
    // helmet strips this by default.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('emits a CSP that allows exactly the SPA’s external dependencies', async () => {
    const res = await request(app).get('/x');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();

    expect(csp).toContain("default-src 'self'");
    // Google Identity Services (sign-in).
    expect(csp).toContain('https://accounts.google.com/gsi/client');
    expect(csp).toContain('frame-src https://accounts.google.com/gsi/');
    // Google Fonts + profile avatars.
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain('https://*.googleusercontent.com');
    // Required by ace-builds/prettier (eval) and ace theme injection (styles)...
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'unsafe-inline'");
    // ...but inline/other-origin *scripts* stay blocked: script-src must NOT
    // carry 'unsafe-inline'. Isolate the script-src directive and check it.
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
