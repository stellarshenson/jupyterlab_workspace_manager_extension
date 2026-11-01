// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { assignColours, COLOURS } from '../model/palette';

const ROOT = join(__dirname, '..', '..');
const css = () => readFileSync(join(ROOT, 'style', 'base.css'), 'utf8');

/** A hex, rgb() or hsl() colour. */
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** The value of each workspace colour: the coloured tabs palette's default light active shade (DQ-27). */
const SHADES: Record<string, string> = {
  rose: '#e39fb1',
  peach: '#d2ab82',
  lemon: '#bab56d',
  mint: '#87c086',
  sky: '#77bae0',
  lavender: '#bfa9da'
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

  it('ACC-ACCORD-86-OWN-PALETTE: each workspace colour rule sets its value and nothing else, for the strip and the swatch', () => {
    const text = css();
    for (const colour of COLOURS) {
      const rule = text.match(
        new RegExp(
          `\\.jp-WorkspaceManager-card\\.jp-mod-${colour},\\s*\\.jp-WorkspaceManager-swatch\\.jp-mod-${colour}\\s*\\{([^}]*)\\}`
        )
      );
      expect(rule?.[1].trim()).toBe(`--wm-strip: ${SHADES[colour]};`);
    }
    expect(text).not.toMatch(
      /--jp-workspace-manager-(rose|peach|lemon|mint|sky|lavender)/
    );
    expect(text).not.toContain('--jp-colourful-tab-');
  });

  it('ACC-PANEL-203-TOKENS-ONLY: the only literal colours in the stylesheet and the TypeScript are the six values, each once in its workspace colour rule, and there is no light or dark branch', () => {
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
    // a seventh literal, or a literal in any other rule, is an entry not in this list
    const lines = css().split('\n');
    expect(found.sort()).toEqual(
      COLOURS.map(colour => {
        const at = lines.indexOf(
          `.jp-WorkspaceManager-swatch.jp-mod-${colour} {`
        );
        return `style/base.css:${at + 2}: --wm-strip: ${SHADES[colour]};`;
      }).sort()
    );
  });
});
