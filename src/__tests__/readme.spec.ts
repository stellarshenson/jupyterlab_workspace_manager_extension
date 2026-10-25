// the tsconfig only auto-includes jest types; pull in node's for fs/path
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

describe('README', () => {
  it('ACC-DOCS-189-IMAGE-PATH: the one image without a scheme is docs/images/panel-full-window.png, a PNG', () => {
    const root = join(__dirname, '..', '..');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');

    const pattern = /!\[[^\]]*\]\(([^)]+)\)/g;
    const targets: string[] = [];
    let match = pattern.exec(readme);
    while (match) {
      targets.push(match[1]);
      match = pattern.exec(readme);
    }
    const local = targets.filter(
      target => !/^[a-z][a-z0-9+.-]*:/i.test(target)
    );
    expect(local).toEqual(['docs/images/panel-full-window.png']);
    expect(
      targets.some(target => target.includes('raw.githubusercontent'))
    ).toBe(false);

    const image = readFileSync(
      join(root, 'docs', 'images', 'panel-full-window.png')
    );
    expect([...image.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
  });
});
