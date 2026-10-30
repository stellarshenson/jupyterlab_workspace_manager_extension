// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** An extension id that JupyterLab's URI parser reads as a scheme: the scheme must have no underscore. */
const ID = /^[a-z0-9_]+:[a-z-]+$/;
const QUOTED = /(['"`])([^'"`\n]*)\1/g;

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sources(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe('extension ids', () => {
  const root = join(__dirname, '..');

  it('ACC-PACK-234-ID-SAFE: no src string literal is an unscoped id with an underscore before the colon', () => {
    const bad: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      const quoted = new RegExp(QUOTED.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = quoted.exec(text))) {
        const value = match[2];
        const colon = value.indexOf(':');
        if (ID.test(value) && value.slice(0, colon).includes('_')) {
          bad.push(`${file.slice(root.length + 1)} ${value}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('ACC-PACK-234-ID-SAFE: the plugin id is the scoped name', () => {
    const index = readFileSync(join(root, 'index.ts'), 'utf8');
    const id = /id:\s*'([^']+)'/.exec(index)?.[1];
    expect(
      id?.startsWith('@stellarshenson/jupyterlab-workspace-manager-extension')
    ).toBe(true);
  });
});
