import type { Kernel, Session } from '@jupyterlab/services';

import { filterSections } from '../model/filter';
import {
  buildSections,
  IModelInput,
  ISection,
  kernelDot,
  tabsOf
} from '../model/model';

/** A saved workspace whose main area holds `keys`, with their saved data. */
const ws = (
  id: string,
  last_modified: string,
  keys: string[] = [],
  data: { [key: string]: any } = {}
) => ({
  metadata: { id, last_modified },
  data: {
    'layout-restorer:data': {
      main: { dock: { type: 'tab-area', currentIndex: 0, widgets: keys } }
    },
    ...data
  }
});

const kernel = (id: string, execution_state = 'idle'): Kernel.IModel => ({
  id,
  name: 'python3',
  execution_state,
  last_activity: '2026-10-24T11:00:00.000000Z'
});

const session = (
  path: string,
  k: Kernel.IModel,
  type = 'notebook',
  name = path
): Session.IModel => ({ id: `s-${k.id}-${type}`, name, path, type, kernel: k });

const input = (over: Partial<IModelInput>): IModelInput => ({
  workspaces: [],
  records: {},
  terminals: [],
  kernels: [],
  sessions: [],
  specs: null,
  current: 'default',
  liveTabs: [],
  ...over
});

/** The kernelspecs JupyterLab loads, holding one spec. */
const specs = (name: string, display_name: string) => ({
  default: name,
  kernelspecs: {
    [name]: { name, display_name, language: '', argv: [], resources: {} }
  }
});

const byId = (sections: ISection[], id: string | null) =>
  sections.find(s => s.id === id)!;

describe('model', () => {
  it('ACC-ACCORD-13-ORDER: this window first, the others newest first, then In no workspace', () => {
    const sections = buildSections(
      input({
        current: 'default',
        workspaces: [
          ws('older', '2026-10-20T10:00:00.000000+00:00'),
          ws('default', '2026-10-01T10:00:00.000000+00:00'),
          ws('newest', '2026-10-23T10:00:00.000000+00:00'),
          ws('middle', '2026-10-21T10:00:00.000000+00:00')
        ],
        terminals: [{ name: '9' }]
      })
    );
    expect(sections.map(s => s.id)).toEqual([
      'default',
      'newest',
      'middle',
      'older',
      null
    ]);
  });

  it('ACC-LISTS-34-ASSIGN-TERMINAL: a terminal goes to the workspace whose layout holds terminal:<name>', () => {
    const sections = buildSections(
      input({
        current: 'cur',
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', ['terminal:1'], {
            'terminal:1': { data: { name: '1' } }
          }),
          ws('b', '2026-10-22T10:00:00Z', ['terminal:2'], {
            'terminal:2': { data: { name: '2' } }
          })
        ],
        terminals: [
          { name: '1', process: 'claude', last_activity: 't1' },
          { name: '2', process: 'fish' },
          { name: '3' }
        ]
      })
    );
    expect(byId(sections, 'a').terminals).toEqual([
      {
        name: '1',
        process: 'claude',
        lastActivity: 't1',
        title: undefined,
        alsoIn: []
      }
    ]);
    expect(byId(sections, 'b').terminals.map(t => t.name)).toEqual(['2']);
    expect(byId(sections, 'cur').terminals).toEqual([]);
    expect(byId(sections, null).terminals.map(t => t.name)).toEqual(['3']);
    expect(byId(sections, null).terminals[0].process).toBeNull();
  });

  it('ACC-LISTS-35-ASSIGN-KERNEL: a kernel goes to the workspace whose notebook has a session on it', () => {
    const k1 = kernel('k1');
    const k2 = kernel('k2');
    const k3 = kernel('k3');
    const sections = buildSections(
      input({
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', ['notebook:work/x.ipynb'], {
            'notebook:work/x.ipynb': {
              data: { path: 'work/x.ipynb', factory: 'Notebook' }
            }
          }),
          ws('b', '2026-10-22T10:00:00Z', ['notebook:y.ipynb'])
        ],
        sessions: [session('work/x.ipynb', k1), session('y.ipynb', k2)],
        kernels: [k1, k2, k3]
      })
    );
    expect(byId(sections, 'a').kernels).toEqual([
      {
        id: 'k1',
        name: 'python3',
        label: 'python3',
        title: 'work/x.ipynb\npython3',
        path: 'work/x.ipynb',
        detail: 'x.ipynb',
        lastActivity: '2026-10-24T11:00:00.000000Z',
        dotClass: 'jp-WorkspaceManager-dot jp-mod-idle',
        alsoIn: []
      }
    ]);
    expect(byId(sections, 'b').kernels.map(k => k.id)).toEqual(['k2']);
    // a kernel without a session belongs to no workspace
    expect(byId(sections, null).kernels.map(k => k.id)).toEqual(['k3']);
    expect(byId(sections, null).kernels[0].path).toBe('');
  });

  it('ACC-LISTS-37-TWO-WORKSPACES: a terminal and a kernel in two workspaces show in both, marked with the other', () => {
    const k1 = kernel('k1');
    const keys = ['terminal:5', 'notebook:shared.ipynb'];
    const sections = buildSections(
      input({
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', keys),
          ws('b', '2026-10-22T10:00:00Z', keys)
        ],
        terminals: [{ name: '5' }],
        sessions: [session('shared.ipynb', k1)],
        kernels: [k1]
      })
    );
    for (const [id, other] of [
      ['a', 'b'],
      ['b', 'a']
    ]) {
      const section = byId(sections, id);
      expect(section.terminals.map(t => [t.name, t.alsoIn])).toEqual([
        ['5', [other]]
      ]);
      expect(section.kernels.map(k => [k.id, k.alsoIn])).toEqual([
        ['k1', [other]]
      ]);
    }
    expect(byId(sections, null)).toBeUndefined();
  });

  it('ACC-LISTS-81-ONCE: a document, a terminal and a notebook each in one group only', () => {
    const k1 = kernel('k1');
    const sections = buildSections(
      input({
        workspaces: [
          ws(
            'a',
            '2026-10-23T10:00:00Z',
            ['editor:docs/README.md', 'terminal:1', 'notebook:nb/x.ipynb'],
            {
              'editor:docs/README.md': {
                data: { path: 'docs/README.md', factory: 'Editor' }
              },
              'terminal:1': { data: { name: '1' } },
              'notebook:nb/x.ipynb': {
                data: { path: 'nb/x.ipynb', factory: 'Notebook' }
              }
            }
          )
        ],
        terminals: [{ name: '1' }],
        sessions: [session('nb/x.ipynb', k1)],
        kernels: [k1]
      })
    );
    const a = byId(sections, 'a');
    expect(a.tabs.map(t => [t.key, t.label, t.path])).toEqual([
      ['editor:docs/README.md', 'README.md', 'docs/README.md'],
      ['notebook:nb/x.ipynb', 'x.ipynb', 'nb/x.ipynb']
    ]);
    expect(a.terminals.map(t => t.name)).toEqual(['1']);
    expect(a.kernels.map(k => [k.id, k.detail])).toEqual([['k1', 'x.ipynb']]);
  });

  it('ACC-LISTS-109-CONSOLE: the kernel of a console tab carries the console name as its detail', () => {
    const k1 = kernel('k1');
    const k2 = kernel('k2');
    const path = 'console-1-7f3a';
    const sections = buildSections(
      input({
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', [`console:${path}`], {
            [`console:${path}`]: { data: { path, name: 'Console 1' } }
          })
        ],
        // a notebook session on the same path is not the console's
        sessions: [
          session(path, k1, 'console', 'Console 1'),
          session(path, k2, 'notebook')
        ],
        kernels: [k1, k2]
      })
    );
    const a = byId(sections, 'a');
    expect(a.kernels.map(k => [k.id, k.detail])).toEqual([['k1', 'Console 1']]);
    expect(a.tabs.map(t => t.label)).toEqual(['Console 1']);
    expect(byId(sections, null).kernels.map(k => k.id)).toEqual(['k2']);
  });

  it('ACC-KERNEL-49-STATE: idle and busy kernels take their dot classes', () => {
    const idle = kernel('k1', 'idle');
    const busy = kernel('k2', 'busy');
    const sections = buildSections(input({ kernels: [idle, busy] }));
    expect(byId(sections, null).kernels.map(k => k.dotClass)).toEqual([
      'jp-WorkspaceManager-dot jp-mod-idle',
      'jp-WorkspaceManager-dot jp-mod-busy'
    ]);
  });

  it('ACC-KERNEL-156-DISPLAY-NAME: a kernel row shows the display name of its kernelspec, the id in its tooltip; an unknown spec shows the id', () => {
    const k1 = kernel('k1');
    const k2 = { ...kernel('k2'), name: 'xpython' };
    const sections = buildSections(
      input({
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', ['notebook:work/x.ipynb'])
        ],
        sessions: [session('work/x.ipynb', k1)],
        kernels: [k1, k2],
        specs: specs('python3', 'Python 3 (ipykernel)')
      })
    );
    const [row] = byId(sections, 'a').kernels;
    expect(row.label).toBe('Python 3 (ipykernel)');
    expect(row.title).toBe('work/x.ipynb\npython3');
    const [unknown] = byId(sections, null).kernels;
    expect(unknown.label).toBe('xpython');
    expect(unknown.title).toBe('xpython');
    // before JupyterLab has loaded the kernelspecs
    const early = buildSections(input({ kernels: [k1] }));
    expect(byId(early, null).kernels[0].label).toBe('python3');
  });

  it('DEF-PANEL-10-SHARED-VIEW: two views of one document are one tab row', () => {
    const k1 = kernel('k1');
    const view = { key: 'notebook:a.ipynb', path: 'a.ipynb', title: 'a.ipynb' };
    const sections = buildSections(
      input({
        sessions: [session('a.ipynb', k1)],
        kernels: [k1],
        liveTabs: [view, { key: 'editor:b.md', path: 'b.md' }, { ...view }]
      })
    );
    const a = byId(sections, 'default');
    expect(a.tabs.map(t => t.key)).toEqual(['notebook:a.ipynb', 'editor:b.md']);
    expect(a.kernels.map(k => k.id)).toEqual(['k1']);
  });

  it('ACC-KERNEL-133-STATE-OTHER: every other state takes the unknown dot', () => {
    for (const state of [
      'starting',
      'restarting',
      'autorestarting',
      'dead',
      'unknown',
      undefined
    ]) {
      expect(kernelDot(state)).toBe('jp-WorkspaceManager-dot jp-mod-unknown');
    }
    const sections = buildSections(input({ kernels: [kernel('k', 'dead')] }));
    expect(byId(sections, null).kernels[0].dotClass).toBe(
      'jp-WorkspaceManager-dot jp-mod-unknown'
    );
  });

  it('ACC-HIDDEN-55-CONTENT: the terminal of a hidden workspace is in no visible group', () => {
    const sections = buildSections(
      input({
        workspaces: [ws('h', '2026-10-23T10:00:00Z', ['terminal:1'])],
        records: { h: { hidden: true } },
        terminals: [{ name: '1' }]
      })
    );
    expect(byId(sections, 'h').hidden).toBe(true);
    expect(byId(sections, null)).toBeUndefined();

    const { cards } = filterSections(sections, '', false);
    expect(cards.map(c => c.section.id)).toEqual(['default']);
    expect(cards.some(c => c.terminals.length)).toBe(false);

    const shown = filterSections(sections, '', true).cards;
    expect(shown.find(c => c.section.id === 'h')!.terminals[0].name).toBe('1');
  });

  it("follows this window's open tabs instead of its saved layout, and never hides it", () => {
    const sections = buildSections(
      input({
        current: 'default',
        workspaces: [ws('default', '2026-10-23T10:00:00Z', ['terminal:1'])],
        records: { default: { hidden: true, purpose: 'Dev', colour: 'sky' } },
        terminals: [{ name: '1' }, { name: '2' }],
        liveTabs: [{ key: 'terminal:2', title: 'vim notes.md' }]
      })
    );
    const current = byId(sections, 'default');
    expect(current).toMatchObject({
      current: true,
      hidden: false,
      purpose: 'Dev',
      colour: 'sky'
    });
    expect(current.terminals.map(t => [t.name, t.title])).toEqual([
      ['2', 'vim notes.md']
    ]);
    expect(byId(sections, null).terminals.map(t => t.name)).toEqual(['1']);
  });

  it("gives this window's workspace a card before its first save", () => {
    const sections = buildSections(
      input({
        current: 'fresh',
        workspaces: [ws('other', '2026-10-23T10:00:00Z')]
      })
    );
    expect(sections.map(s => s.id)).toEqual(['fresh', 'other']);
  });

  it('reads the tabs of split main areas and of the down area', () => {
    const tabs = tabsOf({
      'layout-restorer:data': {
        main: {
          dock: {
            type: 'split-area',
            orientation: 'horizontal',
            sizes: [0.5, 0.5],
            children: [
              { type: 'tab-area', currentIndex: 0, widgets: ['terminal:1'] },
              {
                type: 'split-area',
                children: [{ type: 'tab-area', widgets: ['notebook:a.ipynb'] }]
              }
            ]
          }
        },
        down: { size: 0, widgets: ['terminal:2'] }
      },
      'notebook:a.ipynb': { data: { path: 'a.ipynb', factory: 'Notebook' } }
    });
    expect(tabs).toEqual([
      { key: 'terminal:1', path: undefined, name: undefined },
      { key: 'notebook:a.ipynb', path: 'a.ipynb', name: undefined },
      { key: 'terminal:2', path: undefined, name: undefined }
    ]);
    expect(tabsOf({})).toEqual([]);
  });
});
