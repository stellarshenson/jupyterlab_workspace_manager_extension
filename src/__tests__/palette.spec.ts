// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

describe('palette', () => {
  it('ACC-ACCORD-16-ROTATION: seven workspaces take the six colours, then rose again', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { colours, given, last } = assignColours(ids, {}, null);
    expect(ids.map(id => colours[id])).toEqual([
      'rose',
      'peach',
      'lemon',
      'mint',
      'sky',
      'lavender',
      'rose'
    ]);
    expect(given).toEqual(colours);
    expect(last).toBe('rose');
  });

  it('ACC-ACCORD-17-STABLE-COLOUR: deleting a workspace moves no other colour', () => {
    const first = assignColours(['a', 'b', 'c'], {}, null);
    expect(first.colours).toEqual({ a: 'rose', b: 'peach', c: 'lemon' });

    const stored = { b: first.colours.b, c: first.colours.c };
    const again = assignColours(['b', 'c'], stored, first.last);
    expect(again.colours).toEqual({ b: 'peach', c: 'lemon' });
    expect(again.given).toEqual({});

    // a new workspace takes the colour after the last one given, not the freed rose
    const next = assignColours(['b', 'c', 'd'], stored, again.last);
    expect(next.colours).toEqual({ b: 'peach', c: 'lemon', d: 'mint' });
    expect(next.given).toEqual({ d: 'mint' });
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
});
