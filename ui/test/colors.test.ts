import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { colors } from '../src/util/colors';

// The five hues that have pre-rendered tank sprites; the palette can only use
// these.
const SPRITE_HUES = ['blue', 'dark', 'sand', 'red', 'green'];
// Hues a red-green-color-blind viewer can confuse with each other.
const CONFUSABLE = ['red', 'green'];

const spritesDir = fileURLToPath(
  new URL('../public/sprites/', import.meta.url)
);

describe('team color palette (#132)', () => {
  it('only uses hues that have pre-rendered sprites on disk', () => {
    for (const c of colors) {
      expect(SPRITE_HUES).toContain(c);
      expect(existsSync(`${spritesDir}tank_${c}.png`)).toBe(true);
    }
  });

  it('front-loads the color-blind-distinguishable hues', () => {
    // The first three apps (the common small-arena case) never draw the
    // confusable red/green pair — they get blue / dark / sand, which stay
    // separable under deuteranopia/protanopia/tritanopia.
    expect(colors.slice(0, 3).some((c) => CONFUSABLE.includes(c))).toBe(false);
  });

  it('introduces the confusable hues last, green last of all', () => {
    const firstIdx = (h: string) => colors.indexOf(h);
    // blue/dark/sand all come before red; red comes before green (green is the
    // most confusable — with both sand and red — so it is the last resort).
    expect(
      Math.max(firstIdx('blue'), firstIdx('dark'), firstIdx('sand'))
    ).toBeLessThan(firstIdx('red'));
    expect(firstIdx('red')).toBeLessThan(firstIdx('green'));
  });
});
