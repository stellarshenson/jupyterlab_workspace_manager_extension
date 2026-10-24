import type { Kernel } from '@jupyterlab/services';

import { filterSections, fuzzyMatch } from '../model/filter';
import { buildSections, IModelInput } from '../model/model';

const k1: Kernel.IModel = {
  id: 'k1',
  name: 'julia-1.10',
  execution_state: 'idle'
};

/** Workspace alpha holds every searched field once; beta holds one terminal. */
const sections = (over: Partial<IModelInput> = {}) =>
  buildSections({
    current: 'alpha',
    workspaces: [
      {
        metadata: { id: 'beta', last_modified: '2026-10-22T10:00:00Z' },
        data: {}
      }
    ],
    records: { alpha: { purpose: 'Regression history' } },
    terminals: [
      { name: '7', process: 'claude' },
      { name: '8', process: 'fish' }
    ],
    kernels: [k1],
    sessions: [
      {
        id: 's1',
        name: 'model.ipynb',
        path: 'lab/model.ipynb',
        type: 'notebook',
        kernel: k1
      }
    ],
    liveTabs: [
      {
        key: 'editor:src/deep/widget.ts',
        path: 'src/deep/widget.ts',
        title: 'widget.ts'
      },
      {
        key: 'notebook:lab/model.ipynb',
        path: 'lab/model.ipynb',
        title: 'model.ipynb'
      },
      {
        key: 'console:console-3-ab12',
        path: 'console-3-ab12',
        name: 'Scratch console'
      },
      { key: 'terminal:7', title: 'Fixing the flux capacitor' },
      { key: 'terminal:8' }
    ],
    ...over
  });

describe('filter', () => {
  it('ACC-FILTER-57-MATCH: case, accents, spaces and separators are ignored; 10 characters allow one edit', () => {
    expect(fuzzyMatch('Foo-Bar', 'foobar')).toBe(true);
    expect(fuzzyMatch('foobar', 'Foo-Bar')).toBe(true);
    expect(fuzzyMatch('my_file.name/x y', 'MYFILENAMEXY')).toBe(true);
    expect(fuzzyMatch('Café Crème', 'cafe creme')).toBe(true);
    expect(fuzzyMatch('Café Crème', 'tea')).toBe(false);

    const twenty = 'regressionhistorywfx';
    expect(twenty).toHaveLength(20);
    expect(fuzzyMatch(`a ${twenty} b`, 'regressionhistoryqfx')).toBe(true);
    expect(fuzzyMatch(`a ${twenty} b`, 'regressionhistqryqfx')).toBe(false);

    expect(fuzzyMatch('abcdefghij', 'abcdefghiX')).toBe(true);
    expect(fuzzyMatch('abcdefghi', 'abcdefghX')).toBe(false);
  });

  it('ACC-FILTER-58-FIELDS: every field is searched', () => {
    const all = sections();
    const rowsFor = (query: string) =>
      filterSections(all, query, false).cards.map(c => [
        c.section.id,
        c.tabs.map(t => t.label),
        c.terminals.map(t => t.name),
        c.kernels.map(k => k.id)
      ]);
    // workspace name and purpose show the whole card
    const whole = [
      'alpha',
      ['widget.ts', 'model.ipynb', 'Scratch console'],
      ['7', '8'],
      ['k1']
    ];
    expect(rowsFor('alpha')).toEqual([whole]);
    expect(rowsFor('regression hist')).toEqual([whole]);
    expect(rowsFor('scratch console')).toEqual([
      ['alpha', ['Scratch console'], [], []]
    ]); // tab name
    expect(rowsFor('src/deep')).toEqual([['alpha', ['widget.ts'], [], []]]); // tab path
    expect(rowsFor('claude')).toEqual([['alpha', [], ['7'], []]]); // process name
    expect(rowsFor('terminal 8')).toEqual([['alpha', [], ['8'], []]]); // terminal name
    expect(rowsFor('flux capacitor')).toEqual([['alpha', [], ['7'], []]]); // tab title
    expect(rowsFor('julia')).toEqual([['alpha', [], [], ['k1']]]); // kernel name
    expect(rowsFor('model.ipynb')).toEqual([
      ['alpha', ['model.ipynb'], [], ['k1']] // the notebook, as a tab and as a kernel's notebook
    ]);
    expect(rowsFor('beta')).toEqual([['beta', [], [], []]]);
  });

  it('ACC-FILTER-116-HIDDEN-SEARCH: a hidden workspace is searched only while the eye shows it', () => {
    const all = sections({
      workspaces: [
        {
          metadata: { id: 'secret', last_modified: '2026-10-22T10:00:00Z' },
          data: {
            'layout-restorer:data': {
              main: { dock: { type: 'tab-area', widgets: ['terminal:9'] } }
            }
          }
        }
      ],
      records: { secret: { hidden: true } },
      terminals: [{ name: '9', process: 'htop' }]
    });
    expect(filterSections(all, 'htop', false).cards).toEqual([]);
    const shown = filterSections(all, 'htop', true).cards;
    expect(
      shown.map(c => [c.section.id, c.terminals.map(t => t.name)])
    ).toEqual([['secret', ['9']]]);
  });

  it('counts N of M and the workspaces without a match', () => {
    const all = sections();
    const { cards, unmatched } = filterSections(all, 'claude', false);
    expect(cards.map(c => [c.section.id, c.shown, c.total])).toEqual([
      ['alpha', 1, 6]
    ]);
    expect(unmatched).toBe(1);
    expect(filterSections(all, 'zzzz', false)).toEqual({
      cards: [],
      unmatched: 2
    });
    expect(filterSections(all, '', false).cards.map(c => c.shown)).toEqual([
      6, 0
    ]);
  });
});
