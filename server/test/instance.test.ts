import { describe, it, expect, vi } from 'vitest';
import {
  resolveIdentity,
  localIdentity,
  privateIpv4,
} from '../src/util/instance';

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

  it('falls back to the private IP, never loopback, when metadata is incomplete', async () => {
    const fetchFn = imds({ 'instance-id': 'i-0abc' });
    expect(await resolveIdentity(true, fetchFn, () => '10.0.1.9')).toEqual({
      id: localIdentity().id,
      address: 'http://10.0.1.9:8080',
    });
  });

  it('falls back to the private IP when IMDS is unreachable', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    expect(
      (await resolveIdentity(true, fetchFn, () => '10.0.1.9')).address
    ).toBe('http://10.0.1.9:8080');
  });

  it('uses loopback only if the machine has no private IPv4 at all', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    expect(await resolveIdentity(true, fetchFn, () => undefined)).toEqual(
      localIdentity()
    );
  });

  it('privateIpv4 picks the first external IPv4 interface', () => {
    const iface = (address: string, family: string, internal: boolean) =>
      ({ address, family, internal }) as never;
    expect(
      privateIpv4({
        lo: [iface('127.0.0.1', 'IPv4', true)],
        eth0: [
          iface('fe80::1', 'IPv6', false),
          iface('10.0.1.9', 'IPv4', false),
        ],
      })
    ).toBe('10.0.1.9');
    expect(
      privateIpv4({ lo: [iface('127.0.0.1', 'IPv4', true)] })
    ).toBeUndefined();
  });

  it('gives each process its own local id', () => {
    expect(localIdentity().id).toContain(String(process.pid));
  });
});
