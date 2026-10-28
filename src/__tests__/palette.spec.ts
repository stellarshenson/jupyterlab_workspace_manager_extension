// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

const ROOT = join(__dirname, '..', '..');
const css = () => readFileSync(join(ROOT, 'style', 'base.css'), 'utf8');

/** A hex, rgb() or hsl() colour. */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** The theme token of each workspace colour (DQ-01). */
const TOKENS: Record<string, string> = {
  rose: '--jp-error-color1',
  peach: '--jp-warn-color1',
  lemon: '--jp-warn-color2',
  mint: '--jp-success-color1',
  sky: '--jp-brand-color1',
  lavender: '--jp-info-color1'
};

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

  it('ACC-ACCORD-86-OWN-PALETTE: each workspace colour rule sets its theme token and nothing else, for the strip and the swatch', () => {
    const text = css();
    for (const colour of COLOURS) {
      const rule = text.match(
        new RegExp(
          `\\.jp-WorkspaceManager-card\\.jp-mod-${colour},\\s*\\.jp-WorkspaceManager-swatch\\.jp-mod-${colour}\\s*\\{([^}]*)\\}`
        )
      );
      expect(rule?.[1].trim()).toBe(`--wm-strip: var(${TOKENS[colour]});`);
    }
    expect(text).not.toMatch(
      /--jp-workspace-manager-(rose|peach|lemon|mint|sky|lavender)/
    );
    expect(text).not.toContain('--jp-colourful-tab-');
  });

  it('ACC-PANEL-203-TOKENS-ONLY: the stylesheet and the TypeScript hold no literal colour and no light or dark branch', () => {
    const files = [
      join(ROOT, 'style', 'base.css'),
      ...sources(join(ROOT, 'src'))
    ];
    expect(files.length).toBeGreaterThan(10);
    const found = files.flatMap(f =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          LITERAL.test(line) || line.includes('data-jp-theme-light')
            ? [`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`]
            : []
        )
    );
    expect(found).toEqual([]);
  });
});
