import { age } from '../model/age';

// the form jupyterlab_server gives `last_modified`
const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const before = (seconds: number) =>
  new Date(NOW - seconds * 1000).toISOString().replace('Z', '123+00:00');

describe('age', () => {
  it('ACC-ACCORD-20-AGE: 30 s, 5 min, 3 h and 2 d read now, 5m, 3h and 2d', () => {
    expect(before(30)).toMatch(/\.\d{6}\+00:00$/);
    expect(age(before(30), NOW).label).toBe('now');
    expect(age(before(5 * 60), NOW).label).toBe('5m');
    expect(age(before(3 * 3600), NOW).label).toBe('3h');
    expect(age(before(2 * 86400), NOW).label).toBe('2d');
    expect(age(undefined, NOW).label).toBe('');
  });

  it('ACC-ACCORD-130-NOW-DOT: 59 s gives now, the semibold class and the dot; 60 s gives 1m without them', () => {
    const recent = age(before(59), NOW);
    expect(recent.label).toBe('now');
    expect(recent.className.split(' ')).toContain('jp-mod-now');
    expect(recent.dot).toBe(true);

    const older = age(before(60), NOW);
    expect(older.label).toBe('1m');
    expect(older.className.split(' ')).not.toContain('jp-mod-now');
    expect(older.dot).toBe(false);
  });
});
