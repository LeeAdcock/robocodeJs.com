import { describe, it, expect, afterEach } from 'vitest';
import { sslConfig } from '../src/util/db';

// TLS posture for the RDS connection (OWASP A02-1). By default we verify the
// server certificate against the pinned AWS RDS CA bundle; two env escape
// hatches downgrade that. These lock the three branches in.
describe('sslConfig (RDS TLS)', () => {
  afterEach(() => {
    delete process.env.RDS_SSL;
    delete process.env.RDS_SSL_NO_VERIFY;
  });

  it('verifies against the pinned CA bundle by default', () => {
    const ssl = sslConfig() as { ca: string; rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(typeof ssl.ca).toBe('string');
    expect(ssl.ca).toContain('BEGIN CERTIFICATE');
  });

  it('RDS_SSL=false disables TLS entirely', () => {
    process.env.RDS_SSL = 'false';
    expect(sslConfig()).toBeUndefined();
  });

  it('RDS_SSL_NO_VERIFY=true keeps TLS but skips verification', () => {
    process.env.RDS_SSL_NO_VERIFY = 'true';
    expect(sslConfig()).toEqual({ rejectUnauthorized: false });
  });
});
