import { nullTranslator } from '@jupyterlab/translation';

import { age } from '../model/age';

const trans = nullTranslator.load(
  '@stellarshenson/jupyterlab-workspace-manager-extension'
);

// the form jupyterlab_server gives `last_modified`
const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const before = (seconds: number) =>
  new Date(NOW - seconds * 1000).toISOString().replace('Z', '123+00:00');

describe('age', () => {
  it('ACC-ACCORD-20-AGE: 30 s, 5 min, 3 h, 2 d, 45 d and 400 d read now, 5m ago, 3h ago, 2d ago, 1mo ago and 1y ago; no stamp reads never', () => {
    expect(before(30)).toMatch(/\.\d{6}\+00:00$/);
    expect(age(before(30), NOW, trans).label).toBe('now');
    expect(age(before(5 * 60), NOW, trans).label).toBe('5m ago');
    expect(age(before(3 * 3600), NOW, trans).label).toBe('3h ago');
    expect(age(before(2 * 86400), NOW, trans).label).toBe('2d ago');
    expect(age(before(45 * 86400), NOW, trans).label).toBe('1mo ago');
    expect(age(before(400 * 86400), NOW, trans).label).toBe('1y ago');
    expect(age(undefined, NOW, trans).label).toBe('never');
  });

  it('ACC-ACCORD-130-NOW-DOT: 59 s gives now and jp-mod-recentlyActive; 60 s gives 1m ago without it; 7 d is not stale, 8 d gives jp-mod-stale', () => {
    expect(age(before(59), NOW, trans)).toEqual({
      label: 'now',
      mod: 'jp-mod-recentlyActive'
    });
    expect(age(before(60), NOW, trans)).toEqual({ label: '1m ago', mod: '' });
    expect(age(before(7 * 86400), NOW, trans)).toEqual({
      label: '7d ago',
      mod: ''
    });
    expect(age(before(8 * 86400), NOW, trans)).toEqual({
      label: '8d ago',
      mod: 'jp-mod-stale'
    });
    expect(age(undefined, NOW, trans)).toEqual({ label: 'never', mod: '' });
  });
});
