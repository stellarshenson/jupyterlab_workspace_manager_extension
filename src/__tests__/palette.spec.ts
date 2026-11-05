// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

const ROOT = join(__dirname, '..', '..');
const css = () => readFileSync(join(ROOT, 'style', 'base.css'), 'utf8');

/** A hex, rgb() or hsl() colour. */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** The workspace palette (DQ-28): six hues, mixed over the layout colour for a card's tints. */
const PALETTE = {
  rose: '#f191ae',
  peach: '#dfa465',
  lemon: '#cbc061',
  mint: '#73c973',
  sky: '#62c0f5',
  lavender: '#be9fe4'
};

/** The declarations of the workspace colour rule of `colour`, in order (DQ-28). */
const SHADE_RULE = (colour: string) =>
  `--wm-hue: var(--wm-${colour}); ` +
  '--wm-shade: color-mix(in srgb, var(--wm-hue) 24%, ' +
  'var(--jp-layout-color1)); ' +
  '--wm-rows: color-mix(in srgb, var(--wm-hue) 9.6%, ' +
  'var(--jp-layout-color1));';

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

  it('ACC-ACCORD-86-OWN-PALETTE: each workspace colour rule sets its hue and the two tints mixed from it, and nothing else, for the card and the swatch', () => {
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
    // no rule names the palette variables outside the six colour rules and the palette block
    expect(rest).not.toMatch(/var\(--wm-(rose|peach|lemon|mint|sky|lavender)/);
  });

  it('ACC-PANEL-270-NO-DIVIDER, ACC-PANEL-242-EDGE-TAB: the card is an edge tab 2 px from the panel edge, its hue strip the left border, and the header meets the body with no rule', () => {
    const text = css();
    const body = (selector: string) =>
      (text.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    const card = body('\\.jp-WorkspaceManager-card');
    expect(card).toContain('margin: 4px 2px;');
    expect(card).toContain('border-left: 4px solid var(--wm-hue);');
    expect(card).toContain('border-radius: 0 2px 2px 0;');
    expect(card).toContain('overflow: hidden;');
    expect(card).toContain('background: var(--wm-rows);');
    // no other border: the strip is the card's one edge
    expect(card).not.toMatch(/(^|[^-])border:/);
    // the header carries its tint and declares no border of any kind
    const header = body('\\.jp-WorkspaceManager-cardHeader');
    expect(header).toContain('background: var(--wm-shade);');
    expect(header).not.toMatch(/border/);
    // the removed groups leave no styles behind
    expect(text).not.toMatch(/jp-WorkspaceManager-group/);
  });

  it('ACC-TERM-271-NAME-SIZE: the size-0 meta list names no rowProcess, and no rule sets the process slot a size, so a terminal name takes the row size 1', () => {
    const text = css();
    const rules = [
      ...text.matchAll(
        /([^{}]*)\{([^{}]*font-size:\s*var\(--jp-ui-font-size0\);[^{}]*)\}/g
      )
    ];
    const meta = rules.find(m => m[1].includes('.jp-WorkspaceManager-rowPath'));
    expect(meta).toBeDefined();
    expect(meta![1]).not.toContain('.jp-WorkspaceManager-rowProcess');
    // the slot's own rules set no size: it inherits size 1 from its row
    const slot = [
      ...text.matchAll(/\.jp-WorkspaceManager-rowProcess[^{]*\{([^}]*)\}/g)
    ].map(m => m[1]);
    expect(slot.length).toBeGreaterThan(0);
    expect(slot.some(body => /font-size\s*:/.test(body))).toBe(false);
  });

  it('ACC-PANEL-203-TOKENS-ONLY: the stylesheet and the TypeScript hold exactly the six palette values in the one palette block and the one black of the recessed filter field, with no theme branch', () => {
    const text = css();
    const light = text.match(/:root\s*\{([^}]*--wm-rose:[^}]*)\}/)?.[1] ?? '';
    expect(declarations(light)).toEqual(PALETTE);
    expect(Object.keys(declarations(light))).toHaveLength(6);

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
    // the six hues need no dark-theme block: every tint mixes over the theme's layout colour
    expect(text).not.toMatch(/data-jp-theme-light/);
  });
});
