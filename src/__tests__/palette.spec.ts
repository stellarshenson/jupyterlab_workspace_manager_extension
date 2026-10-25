// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

/** The hue in degrees, the saturation and the lightness in percent. */
function hexToHls(hex: string): { h: number; s: number; l: number } {
  const value = parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

/** The shorter distance between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return distance > 180 ? 360 - distance : distance;
}

/** The value of `--jp-workspace-manager-<name>` in a block of style/base.css. */
function cssColour(block: string, name: string): string {
  const match = block.match(
    new RegExp(`--jp-workspace-manager-${name}: (#[0-9a-f]{6});`)
  );
  if (!match) {
    throw new Error(`style/base.css has no --jp-workspace-manager-${name}`);
  }
  return match[1];
}

describe('palette', () => {
  it('ACC-ACCORD-16-ROTATION: seven workspaces take the six colours, then sky again', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { colours, given, last } = assignColours(ids, {}, null);
    expect(ids.map(id => colours[id])).toEqual([
      'sky',
      'lavender',
      'rose',
      'peach',
      'lemon',
      'mint',
      'sky'
    ]);
    expect(given).toEqual(colours);
    expect(last).toBe('sky');
  });

  it('ACC-ACCORD-17-STABLE-COLOUR: deleting a workspace moves no other colour', () => {
    const first = assignColours(['a', 'b', 'c'], {}, null);
    expect(first.colours).toEqual({ a: 'sky', b: 'lavender', c: 'rose' });

    const stored = { b: first.colours.b, c: first.colours.c };
    const again = assignColours(['b', 'c'], stored, first.last);
    expect(again.colours).toEqual({ b: 'lavender', c: 'rose' });
    expect(again.given).toEqual({});

    // a new workspace takes the colour after the last one given, not the freed sky
    const next = assignColours(['b', 'c', 'd'], stored, again.last);
    expect(next.colours).toEqual({ b: 'lavender', c: 'rose', d: 'peach' });
    expect(next.given).toEqual({ d: 'peach' });
  });

  it('ACC-ACCORD-86-OWN-PALETTE: the stylesheet defines the six colours per theme and no colourful tab variable', () => {
    const css = readFileSync(
      join(__dirname, '..', '..', 'style', 'base.css'),
      'utf8'
    );
    const [light, dark] = css.split("[data-jp-theme-light='false']");
    expect(dark).toBeDefined();
    for (const theme of [light, dark]) {
      for (const colour of COLOURS) {
        for (const name of [colour, `${colour}-active`]) {
          expect(theme).toMatch(
            new RegExp(`--jp-workspace-manager-${name}: #[0-9a-f]{6};`)
          );
        }
      }
    }
    expect(css).not.toContain('--jp-colourful-tab-');
  });

  it('ACC-ACCORD-188-STRIP-SATURATION: each strip colour keeps its hue and gains saturation in both themes', () => {
    const css = readFileSync(
      join(__dirname, '..', '..', 'style', 'base.css'),
      'utf8'
    );
    const [light, dark] = css.split("[data-jp-theme-light='false']");
    expect(dark).toBeDefined();
    const blocks = { light, dark };
    const previous = {
      light: '#e39fb1 #d2ab82 #bab56d #87c086 #77bae0 #bfa9da'.split(' '),
      dark: '#e8bbc6 #ddc2a7 #ccc8a6 #b3cdb1 #a5cce5 #cfc1e1'.split(' ')
    };
    const active = {
      light: previous.light,
      dark: '#3a2328 #3a3126 #3a3825 #253b2a #1d2a38 #30253a'.split(' ')
    };
    for (const theme of ['light', 'dark'] as const) {
      COLOURS.forEach((colour, index) => {
        const before = hexToHls(previous[theme][index]);
        const after = hexToHls(cssColour(blocks[theme], colour));
        expect(after.s - before.s).toBeGreaterThanOrEqual(15);
        expect(after.s).toBeGreaterThanOrEqual(48);
        expect(hueDistance(before.h, after.h)).toBeLessThanOrEqual(3);
      });
      const shades = COLOURS.map(colour =>
        cssColour(blocks[theme], `${colour}-active`)
      );
      expect(shades).toEqual(active[theme]);
    }
  });
});
