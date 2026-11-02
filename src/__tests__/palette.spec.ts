// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

const ROOT = join(__dirname, '..', '..');
const css = () => readFileSync(join(ROOT, 'style', 'base.css'), 'utf8');

/** A hex, rgb() or hsl() colour. */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** The workspace palette (DQ-28): a card takes the muted shade, this window's card the active shade. */
const PALETTE = {
  light: {
    rose: '#f1b2c4',
    'rose-active': '#f191ae',
    peach: '#e5ba90',
    'peach-active': '#dfa465',
    lemon: '#d5cea2',
    'lemon-active': '#cbc061',
    mint: '#a7cfa5',
    'mint-active': '#73c973',
    sky: '#98cff2',
    'sky-active': '#62c0f5',
    lavender: '#cebbe7',
    'lavender-active': '#be9fe4'
  },
  dark: {
    rose: '#542b36',
    'rose-active': '#3f1e26',
    peach: '#4a3827',
    'peach-active': '#342a1d',
    lemon: '#57512e',
    'lemon-active': '#423e23',
    mint: '#294d30',
    'mint-active': '#1d3924',
    sky: '#213854',
    'sky-active': '#182a3d',
    lavender: '#402c54',
    'lavender-active': '#30213e'
  }
};

/** The declarations of the workspace colour rule of `colour`, in order (DQ-28). */
const SHADE_RULE = (colour: string) =>
  `--wm-shade: var(--wm-${colour}); ` +
  `--wm-shade-active: var(--wm-${colour}-active); ` +
  '--wm-strip: var(--wm-shade);';

/** The --wm- declarations of a palette block, in the order they are stated. */
function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--wm-([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(m => [
      m[1],
      m[2]
    ])
  );
}

/** The .ts and .tsx files under `dir`, the tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? e.name === '__tests__'
        ? []
        : sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : []
  );
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

  it('ACC-ACCORD-86-OWN-PALETTE: each workspace colour rule sets its shade, its active shade and the strip from the palette, and nothing else, for the card and the swatch', () => {
    const text = css();
    let rest = text;
    for (const colour of COLOURS) {
      const rule = new RegExp(
        `\\.jp-WorkspaceManager-card\\.jp-mod-${colour},\\s*\\.jp-WorkspaceManager-swatch\\.jp-mod-${colour}\\s*\\{([^}]*)\\}`
      );
      const body = text.match(rule)?.[1] ?? '';
      expect(body.trim().replace(/\s+/g, ' ')).toBe(SHADE_RULE(colour));
      rest = rest.replace(rule, '');
    }
    // no rule names the palette variables outside the six colour rules and the two blocks
    expect(rest).not.toMatch(/var\(--wm-(rose|peach|lemon|mint|sky|lavender)/);
  });

  it("ACC-PANEL-203-TOKENS-ONLY: the stylesheet and the TypeScript hold exactly the 24 palette values in the two palette blocks and the one black of the recessed filter field, with exactly one data-jp-theme-light='false' selector, the dark palette block", () => {
    const text = css();
    const light = text.match(/:root\s*\{([^}]*--wm-rose:[^}]*)\}/)?.[1] ?? '';
    const dark =
      text.match(/\[data-jp-theme-light='false'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(declarations(light)).toEqual(PALETTE.light);
    expect(declarations(dark)).toEqual(PALETTE.dark);
    expect(Object.keys(declarations(light))).toHaveLength(12);
    expect(Object.keys(declarations(dark))).toHaveLength(12);

    // outside the palette values the one colour word is the design language's named black
    // of the recessed filter field; every other colour is a --jp-* token
    const bare = text
      .replace(/--wm-[a-z-]+:\s*#[0-9a-f]{6};/gi, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare.match(/\bblack\b/gi)).toHaveLength(1);
    expect(bare).toMatch(/--jp-workspace-manager-filter-background:[^;]*black/);
    const typescript = sources(join(ROOT, 'src'))
      .map(file => readFileSync(file, 'utf8'))
      .join('\n');
    expect(`${bare}\n${typescript}`).not.toMatch(LITERAL);
    // the dark palette block is the only theme branch
    expect(text.match(/data-jp-theme-light/g)).toHaveLength(1);
  });
});
