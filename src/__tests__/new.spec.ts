import {
  cleanPurpose,
  NAME_RULE,
  nameProblem,
  newRecord,
  purposeCounter
} from '../model/new';

describe('new workspace', () => {
  it('ACC-PANEL-142-NEW-NAME: only letters, digits, - and _ enable Create', () => {
    expect(nameProblem('fb-review', [])).toBeNull();
    expect(nameProblem('fb_Review_2', [])).toBeNull();
    for (const name of ['', 'a b', 'a/b', 'a.b']) {
      expect(nameProblem(name, [])).toBe(NAME_RULE);
    }
  });

  it('ACC-PANEL-143-NEW-TAKEN: an existing name keeps Create disabled with the message', () => {
    expect(nameProblem('auto-6', ['default', 'auto-6'])).toBe(
      'A workspace named auto-6 exists'
    );
    expect(nameProblem('auto-7', ['default', 'auto-6'])).toBeNull();
  });

  it('ACC-PANEL-144-NEW-PURPOSE: at most 100 characters, no line break, no empty purpose', () => {
    expect(cleanPurpose('x'.repeat(101))).toBe('x'.repeat(100));
    expect(cleanPurpose('first line\nsecond\r\nthird')).toBe(
      'first line second third'
    );
    expect(cleanPurpose('a\nb')).not.toMatch(/[\r\n]/);
    // counted as the server counts: one emoji is one character
    expect(Array.from(cleanPurpose('😀'.repeat(101)))).toHaveLength(100);

    expect(newRecord('', 'rose')).toEqual({ colour: 'rose' });
    expect(newRecord('   ', 'rose')).toEqual({ colour: 'rose' });
    expect(newRecord('Review of fb', 'mint')).toEqual({
      colour: 'mint',
      purpose: 'Review of fb'
    });
  });

  it('ACC-PANEL-149-DESC-COUNT: the counter follows every keystroke', () => {
    expect(purposeCounter('')).toBe('0/100');
    const typed = 'y'.repeat(45);
    expect(purposeCounter(typed)).toBe('45/100');
    expect(purposeCounter(typed.slice(0, 40))).toBe('40/100');
  });
});
