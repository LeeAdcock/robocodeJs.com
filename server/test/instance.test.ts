import { describe, it, expect, vi } from 'vitest';
import { resolveIdentity, localIdentity } from '../src/util/instance';

// Instance identity for the user home leases (GitHub #444): EC2 metadata in
// production, a synthetic per-process identity everywhere else.

const text = (body: string, ok = true) =>
  Promise.resolve({ ok, text: () => Promise.resolve(body) } as Response);

const imds = (values: Record<string, string>) =>
  vi.fn((url: string) => {
    if (url.endsWith('/api/token')) return text('tok');
    const key = url.split('/meta-data/')[1];
    return key in values ? text(values[key]) : text('', false);
  }) as unknown as typeof fetch;

describe('resolveIdentity', () => {
  it('uses a synthetic local identity outside production', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(await resolveIdentity(false, fetchFn)).toEqual(localIdentity());
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reads the instance id and private IP from IMDSv2 in production', async () => {
    const fetchFn = imds({
      'instance-id': 'i-0abc',
      'local-ipv4': '10.0.1.23\n',
    });
    expect(await resolveIdentity(true, fetchFn)).toEqual({
      id: 'i-0abc',
      address: 'http://10.0.1.23:8080',
    });
    // The metadata reads carry the session token from the PUT.
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/meta-data/instance-id'),
      expect.objectContaining({
        headers: { 'X-aws-ec2-metadata-token': 'tok' },
      })
    );
  });

  it('falls back to the local identity when metadata is incomplete', async () => {
    const fetchFn = imds({ 'instance-id': 'i-0abc' });
    expect(await resolveIdentity(true, fetchFn)).toEqual(localIdentity());
  });

  it('falls back to the local identity when IMDS is unreachable', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    expect(await resolveIdentity(true, fetchFn)).toEqual(localIdentity());
  });

  it('gives each process its own local id', () => {
    expect(localIdentity().id).toContain(String(process.pid));
  });
});
