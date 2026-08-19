import { describe, it, expect } from 'vitest';
import { isUuid, extractAppId } from '../src/util/appRef';

const ID = '352dbcfe-9de6-4f2a-a2dc-7df12004fa68';

describe('isUuid', () => {
  it('accepts a canonical id, in either case, with stray whitespace', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid(`  ${ID}\n`)).toBe(true);
  });

  it('rejects names, partial ids, and near-misses', () => {
    expect(isUuid('S12-CORDON')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(ID.slice(0, 35))).toBe(false);
    expect(isUuid(`${ID}0`)).toBe(false);
    // Right shape, but 'g' is not hex.
    expect(isUuid('g52dbcfe-9de6-4f2a-a2dc-7df12004fa68')).toBe(false);
  });
});

describe('extractAppId', () => {
  it('passes through a bare id, normalising case and whitespace', () => {
    expect(extractAppId(`  ${ID.toUpperCase()} `)).toBe(ID);
  });

  it('pulls the id out of a pasted share link', () => {
    // The exact thing a user copies from the app page's Share button.
    expect(extractAppId(`https://robocodejs.com/add-app/${ID}`)).toBe(ID);
    expect(extractAppId(`http://localhost:3000/add-app/${ID}`)).toBe(ID);
    expect(extractAppId(`/add-app/${ID}`)).toBe(ID);
  });

  it('tolerates the debris a copy/paste drags along', () => {
    expect(extractAppId(`https://robocodejs.com/add-app/${ID}/`)).toBe(ID);
    expect(extractAppId(`https://robocodejs.com/add-app/${ID}?ref=chat`)).toBe(
      ID
    );
    expect(extractAppId(`https://robocodejs.com/add-app/${ID}#top`)).toBe(ID);
  });

  it('returns null for an app name — the mistake this exists to catch', () => {
    expect(extractAppId('S12-CORDON')).toBeNull();
    expect(extractAppId('Magnetic54321')).toBeNull();
    expect(extractAppId('   ')).toBeNull();
  });

  it('does not mine an id out of unrelated prose', () => {
    // Only a real /add-app/ link is treated as a reference; a bare id embedded
    // in other text is more likely a mistake than an intent.
    expect(extractAppId(`my bot is ${ID} i think`)).toBeNull();
  });

  it('returns null for a share link whose id is malformed', () => {
    expect(
      extractAppId('https://robocodejs.com/add-app/S12-CORDON')
    ).toBeNull();
  });
});
