import type { Kernel, Session } from '@jupyterlab/services';

import { filterSections } from '../model/filter';
import {
  buildModel,
  buildSections,
  formatCpu,
  formatMemory,
  IModelInput,
  ISection,
  kernelDot,
  tabsOf,
  terminalLabel,
  terminalTabName,
  withTab
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

const byId = (sections: ISection[], id: string) =>
  sections.find(s => s.id === id)!;

describe('model', () => {
  it('ACC-ACCORD-190-FIXED-ORDER: the stored positions order the cards; this window and last_modified take no part; the terminals come apart', () => {
    const model = buildModel(
      input({
        current: 'default',
        workspaces: [
          ws('older', '2026-10-20T10:00:00.000000+00:00'),
          ws('default', '2026-10-24T10:00:00.000000+00:00'),
          ws('middle', '2026-10-21T10:00:00.000000+00:00')
        ],
        records: {
          older: { position: 0 },
          middle: { position: 1.5 },
          default: { position: 2 }
        },
        terminals: [{ name: '9' }]
      })
    );
    expect(model.sections.map(s => s.id)).toEqual([
      'older',
      'middle',
      'default'
    ]);
    expect(model.terminals.map(t => t.name)).toEqual(['9']);
  });

  it('ACC-ACCORD-198-NEW-LAST: a workspace without a position sorts after those with one, oldest first by created, by id without created', () => {
    const created = (id: string, time?: string) => ({
      metadata: { id, created: time },
      data: {}
    });
    const order = (workspaces: any[]) =>
      buildSections(
        input({
          current: 'zz-unsaved',
          workspaces,
          records: { b: { position: 7 }, a: { position: 3 } }
        })
      ).map(s => s.id);
    expect(
      order([
        created('new', '2026-10-25T10:00:00.000000+00:00'),
        created('b', '2026-10-01T10:00:00.000000+00:00'),
        created('old', '2026-10-02T10:00:00.000000+00:00'),
        created('a', '2026-10-26T10:00:00.000000+00:00')
      ])
    ).toEqual(['a', 'b', 'old', 'new', 'zz-unsaved']);
    // this window's workspace before its first save has no created time either
    expect(order([created('y'), created('x'), created('b')])).toEqual([
      'b',
      'x',
      'y',
      'zz-unsaved'
    ]);
  });

  it('ACC-LISTS-34-ASSIGN-TERMINAL: a terminal goes to the workspace whose layout holds terminal:<name>', () => {
    const model = buildModel(
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
          {
            name: '1',
            process: 'claude',
            cwd: '/srv',
            command: 'claude --resume',
            last_activity: 't1'
          },
          { name: '2', process: 'fish' },
          { name: '3' }
        ]
      })
    );
    const sections = model.sections;
    expect(byId(sections, 'a').terminals).toEqual([
      {
        name: '1',
        process: 'claude',
        cwd: '/srv',
        command: 'claude --resume',
        memory: null,
        lastActivity: 't1',
        title: undefined,
        alsoIn: []
      }
    ]);
    expect(byId(sections, 'b').terminals.map(t => t.name)).toEqual(['2']);
    expect(byId(sections, 'cur').terminals).toEqual([]);
    // ACC-LISTS-194-ALL-TERMINALS: TERMINALS lists all three, each with its workspace
    expect(model.terminals.map(t => [t.name, t.alsoIn])).toEqual([
      ['1', ['a']],
      ['2', ['b']],
      ['3', []]
    ]);
    expect(model.terminals[2].process).toBeNull();
    expect(model.terminals[2].command).toBeNull();
  });

  it('ACC-TERM-257-SHORT-LABEL: a name of digits reads t<name>, any other name reads as it is', () => {
    expect(terminalLabel('7')).toBe('t7');
    expect(terminalLabel('12')).toBe('t12');
    expect(terminalLabel('build')).toBe('build');
    expect(terminalLabel('7a')).toBe('7a');
  });

  it('ACC-TERM-261-TAB-NAME: a title is the tab name; no title, the default Terminal <name> and the plain Terminal are none', () => {
    expect(terminalTabName({ name: '7', title: 'my tab' })).toBe('my tab');
    expect(terminalTabName({ name: '7' })).toBeNull();
    expect(terminalTabName({ name: '7', title: 'Terminal 7' })).toBeNull();
    expect(terminalTabName({ name: '7', title: 'Terminal' })).toBeNull();
    // the default title of another terminal says more than this one's label
    expect(terminalTabName({ name: '7', title: 'Terminal 8' })).toBe(
      'Terminal 8'
    );
  });

  it('ACC-TERM-256-PATH-UNREAD: a terminal with no cwd, as /api/terminals gives it, and one with cwd null both read null', () => {
    const { terminals } = buildModel(
      input({ terminals: [{ name: '1' }, { name: '2', cwd: null }] })
    );
    expect(terminals.map(t => t.cwd)).toEqual([null, null]);
  });

  it('ACC-LISTS-35-ASSIGN-KERNEL: a kernel goes to the workspace whose notebook has a session on it', () => {
    const k1 = kernel('k1');
    const k2 = kernel('k2');
    const k3 = kernel('k3');
    const model = buildModel(
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
    const sections = model.sections;
    expect(byId(sections, 'a').kernels).toEqual([
      {
        id: 'k1',
        name: 'python3',
        label: 'python3',
        title: 'python3\nwork/x.ipynb\nidle',
        path: 'work/x.ipynb',
        detail: 'x.ipynb',
        state: 'idle',
        lastActivity: '2026-10-24T11:00:00.000000Z',
        dotClass: 'jp-WorkspaceManager-dot jp-mod-idle',
        alsoIn: []
      }
    ]);
    expect(byId(sections, 'b').kernels.map(k => k.id)).toEqual(['k2']);
    // ACC-LISTS-195-ALL-KERNELS: KERNELS lists all three; one without a session belongs to no workspace
    expect(model.kernels.map(k => [k.id, k.alsoIn])).toEqual([
      ['k1', ['a']],
      ['k2', ['b']],
      ['k3', []]
    ]);
    expect(model.kernels[2].path).toBe('');
  });

  it('ACC-LISTS-37-TWO-WORKSPACES: a terminal and a kernel in two workspaces show in both, each with the other as a holder', () => {
    const k1 = kernel('k1');
    const keys = ['terminal:5', 'notebook:shared.ipynb'];
    const model = buildModel(
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
    const sections = model.sections;
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
    expect(model.terminals.map(t => [t.name, t.alsoIn])).toEqual([
      ['5', ['a', 'b']]
    ]);
    expect(model.kernels.map(k => [k.id, k.alsoIn])).toEqual([
      ['k1', ['a', 'b']]
    ]);
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

  it('ACC-LISTS-109-CONSOLE: the kernel of a console tab carries the console name, the name of its row', () => {
    const k1 = kernel('k1');
    const k2 = kernel('k2');
    const path = 'console-1-7f3a';
    const model = buildModel(
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
    const a = byId(model.sections, 'a');
    expect(a.kernels.map(k => [k.id, k.detail])).toEqual([['k1', 'Console 1']]);
    expect(a.tabs.map(t => t.label)).toEqual(['Console 1']);
    expect(model.kernels.map(k => [k.id, k.alsoIn])).toEqual([
      ['k1', ['a']],
      ['k2', []]
    ]);
  });

  it('ACC-KERNEL-49-STATE: idle and busy kernels take their dot classes', () => {
    const idle = kernel('k1', 'idle');
    const busy = kernel('k2', 'busy');
    const model = buildModel(input({ kernels: [idle, busy] }));
    expect(model.kernels.map(k => k.dotClass)).toEqual([
      'jp-WorkspaceManager-dot jp-mod-idle',
      'jp-WorkspaceManager-dot jp-mod-busy'
    ]);
  });

  it('ACC-KERNEL-156-DISPLAY-NAME, ACC-PANEL-185-ROW-TOOLTIP: a kernel row shows the display name of its kernelspec, its tooltip the display name, path and state; an unknown spec shows the id', () => {
    const k1 = kernel('k1');
    const k2 = { ...kernel('k2'), name: 'xpython' };
    const model = buildModel(
      input({
        workspaces: [
          ws('a', '2026-10-23T10:00:00Z', ['notebook:work/x.ipynb'])
        ],
        sessions: [session('work/x.ipynb', k1)],
        kernels: [k1, k2],
        specs: specs('python3', 'Python 3 (ipykernel)')
      })
    );
    const [row] = byId(model.sections, 'a').kernels;
    expect(row.label).toBe('Python 3 (ipykernel)');
    expect(row.title).toBe('Python 3 (ipykernel)\nwork/x.ipynb\nidle');
    const unknown = model.kernels[1];
    expect(unknown.label).toBe('xpython');
    expect(unknown.title).toBe('xpython\nidle');
    // before JupyterLab has loaded the kernelspecs
    const early = buildModel(input({ kernels: [k1] }));
    expect(early.kernels[0].label).toBe('python3');
  });

  it('DEF-PANEL-69-TABS-SAMEFILE: each open tab of this window is a row; a kernel its two views share is one row', () => {
    const k1 = kernel('k1');
    const view = { path: 'a.ipynb', title: 'a.ipynb' };
    const sections = buildSections(
      input({
        sessions: [session('a.ipynb', k1)],
        kernels: [k1],
        liveTabs: [
          { key: 'notebook:a.ipynb', ...view },
          { key: 'document:b.md', path: 'b.md' },
          { key: 'notebook:a.ipynb#2', ...view }
        ]
      })
    );
    const a = byId(sections, 'default');
    expect(a.tabs.map(t => t.key)).toEqual([
      'notebook:a.ipynb',
      'document:b.md',
      'notebook:a.ipynb#2'
    ]);
    expect(a.kernels.map(k => k.id)).toEqual(['k1']);
  });

  it('ACC-ACCORD-300-NO-LAUNCHER: a Launcher of this window and a launcher key of a saved layout make no row and no count', () => {
    const sections = buildSections(
      input({
        workspaces: [
          ws('saved', '2026-10-23T10:00:00Z', [
            'launcher:launcher',
            'notebook:b.ipynb',
            'terminal:1'
          ])
        ],
        terminals: [{ name: '1' }],
        liveTabs: [
          { key: 'launcher:launcher-0', title: 'Launcher' },
          { key: 'notebook:a.ipynb', path: 'a.ipynb', title: 'a.ipynb' },
          { key: 'terminal:1', title: 'Terminal 1' }
        ]
      })
    );
    for (const [id, notebook] of [
      ['default', 'notebook:a.ipynb'],
      ['saved', 'notebook:b.ipynb']
    ]) {
      const section = byId(sections, id);
      expect(section.tabs.map(t => t.key)).toEqual([notebook]);
      expect(section.terminals.map(t => t.name)).toEqual(['1']);
    }
    // the card's count, (N): its rows, the notebook and the terminal
    expect(
      filterSections(sections, '', false).cards.map(c => [
        c.section.id,
        c.total
      ])
    ).toEqual([
      ['default', 2],
      ['saved', 2]
    ]);
  });

  it('DEF-PANEL-69-TABS-SAMEFILE: a saved layout lists a key once per New View of one document, and holds one tab of it', () => {
    const shared = {
      type: 'tab-area',
      widgets: ['editor:a.md', 'editor:a.md']
    };
    const data = {
      'layout-restorer:data': { main: { dock: shared } },
      'editor:a.md': { data: { path: 'a.md', factory: 'Editor' } }
    };
    expect(tabsOf(data).map(t => t.key)).toEqual(['editor:a.md']);
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
    const model = buildModel(input({ kernels: [kernel('k', 'dead')] }));
    expect(model.kernels[0].dotClass).toBe(
      'jp-WorkspaceManager-dot jp-mod-unknown'
    );
  });

  it('ACC-LISTS-194-ALL-TERMINALS, ACC-LISTS-195-ALL-KERNELS: the terminal and kernel of a hidden workspace are listed; its card keeps them', () => {
    const k1 = kernel('k1');
    const model = buildModel(
      input({
        workspaces: [
          ws('h', '2026-10-23T10:00:00Z', ['terminal:1', 'notebook:h.ipynb'])
        ],
        records: { h: { hidden: true } },
        terminals: [{ name: '1' }],
        sessions: [session('h.ipynb', k1)],
        kernels: [k1]
      })
    );
    const sections = model.sections;
    expect(byId(sections, 'h').hidden).toBe(true);
    expect(model.terminals.map(t => [t.name, t.alsoIn])).toEqual([
      ['1', ['h']]
    ]);
    expect(model.kernels.map(k => [k.id, k.alsoIn])).toEqual([['k1', ['h']]]);
    // the counts of its card do not change
    expect(byId(sections, 'h').terminals.map(t => t.name)).toEqual(['1']);
    expect(byId(sections, 'h').kernels.map(k => k.id)).toEqual(['k1']);

    const { cards } = filterSections(sections, '', false);
    expect(cards.map(c => c.section.id)).toEqual(['default']);
    expect(cards.some(c => c.terminals.length)).toBe(false);

    const shown = filterSections(sections, '', true).cards;
    expect(shown.find(c => c.section.id === 'h')!.terminals[0].name).toBe('1');
  });

  it("follows this window's open tabs instead of its saved layout, and never hides it", () => {
    const model = buildModel(
      input({
        current: 'default',
        workspaces: [ws('default', '2026-10-23T10:00:00Z', ['terminal:1'])],
        records: { default: { hidden: true, purpose: 'Dev', colour: 'sky' } },
        terminals: [{ name: '1' }, { name: '2' }],
        liveTabs: [{ key: 'terminal:2', title: 'vim notes.md' }]
      })
    );
    const current = byId(model.sections, 'default');
    expect(current).toMatchObject({
      current: true,
      hidden: false,
      purpose: 'Dev',
      colour: 'sky'
    });
    expect(current.terminals.map(t => [t.name, t.title])).toEqual([
      ['2', 'vim notes.md']
    ]);
    expect(model.terminals.map(t => [t.name, t.alsoIn])).toEqual([
      ['1', []],
      ['2', ['default']]
    ]);
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
    expect(
      tabsOf({
        'layout-restorer:data': {
          main: { dock: { type: 'tab-area', widgets: ['workspace-page:p'] } }
        },
        'workspace-page:p': { data: { url: '/proxy/9001/', icon: 7 } }
      })[0].icon
    ).toBeUndefined();
  });

  it("DEF-PANEL-91-WEBTAB-LABEL: a saved web tab on another workspace's card is named by its saved title or menu text", () => {
    const help = 'help-doc:https://jupyterlab.readthedocs.io/en/stable/';
    const model = buildModel(
      input({
        workspaces: [
          ws('other', '2026-10-23T10:00:00Z', [help, 'workspace-page:id-x'], {
            [help]: {
              data: {
                url: 'https://jupyterlab.readthedocs.io/en/stable/',
                text: 'JupyterLab Reference'
              }
            },
            'workspace-page:id-x': {
              data: {
                url: '/proxy/5123/index.html',
                title: 'My app',
                id: 'id-x'
              }
            }
          })
        ]
      })
    );
    expect(byId(model.sections, 'other').tabs.map(t => t.label)).toEqual([
      'JupyterLab Reference',
      'My app'
    ]);
  });

  it("DEF-PANEL-97-PATHLESS-NAME, ACC-LISTS-306-PATHLESS-NAME: a saved tab without a path on another workspace's card reads the name its own window gives the tab; a document, a terminal and a titled web tab keep their names", () => {
    // each saved entry as its tracker saves it, and the row name expected
    const tabs: { [key: string]: [any, string] } = {
      'setting-editor:setting-editor': [{}, 'Settings'],
      'json-setting-editor:json-setting-editor': [
        {},
        'Advanced Settings Editor'
      ],
      'logconsole:logconsole': [{}, 'Log Console'],
      'inspector:inspector': [{}, 'Contextual Help'],
      'help-licenses:licenses': [{ packageFilter: {} }, 'Licenses'],
      'plugin-manager:plugins': [{ query: '' }, 'Advanced Plugin Manager'],
      'lsp-diagnostics:listing': [{}, 'Diagnostics Panel'],
      'codeviewer:cv-1': [
        {
          content: 'print(1)',
          label: 'Viewed code',
          mimeType: 'text/x-python',
          widgetId: 'cv-1'
        },
        'Viewed code'
      ],
      'editor:docs/README.md': [
        { path: 'docs/README.md', factory: 'Editor' },
        'README.md'
      ],
      'workspace-page:id-x': [
        { url: '/proxy/5123/index.html', title: 'My app', id: 'id-x' },
        'My app'
      ]
    };
    const entries: { [key: string]: any } = {};
    for (const [key, [data]] of Object.entries(tabs)) {
      entries[key] = { data };
    }
    const model = buildModel(
      input({
        workspaces: [
          ws(
            'other',
            '2026-10-23T10:00:00Z',
            [...Object.keys(tabs), 'terminal:7'],
            entries
          )
        ],
        terminals: [{ name: '7' }]
      })
    );
    const other = byId(model.sections, 'other');
    expect(other.tabs.map(t => [t.key, t.label])).toEqual(
      Object.entries(tabs).map(([key, [, label]]) => [key, label])
    );
    expect(other.terminals.map(t => t.name)).toEqual(['7']);
  });

  describe('ACC-LISTS-268-MOVE-TAB: withTab', () => {
    const entry = { data: { name: '7' } };
    const key = 'terminal:7';
    const dock = (workspace: any) =>
      workspace.data['layout-restorer:data'].main.dock;

    it('appends to the first tab area of a split dock, depth first, with currentIndex unchanged and the source untouched', () => {
      const saved = {
        metadata: { id: 'w', last_modified: 'then' },
        data: {
          'layout-restorer:data': {
            main: {
              dock: {
                type: 'split-area',
                orientation: 'horizontal',
                sizes: [0.5, 0.5],
                children: [
                  {
                    type: 'split-area',
                    orientation: 'vertical',
                    sizes: [0.5, 0.5],
                    children: [
                      {
                        type: 'tab-area',
                        currentIndex: 1,
                        widgets: ['editor:a.md', 'editor:b.md']
                      },
                      {
                        type: 'tab-area',
                        currentIndex: 0,
                        widgets: ['editor:c.md']
                      }
                    ]
                  },
                  {
                    type: 'tab-area',
                    currentIndex: 0,
                    widgets: ['editor:d.md']
                  }
                ]
              }
            },
            down: { size: 0, widgets: [] }
          },
          'editor:a.md': { data: { path: 'a.md' } }
        }
      };
      const before = JSON.stringify(saved);
      const moved: any = withTab(saved as any, key, entry);
      const [first, second] = dock(moved).children[0].children;
      expect(first).toEqual({
        type: 'tab-area',
        currentIndex: 1,
        widgets: ['editor:a.md', 'editor:b.md', key]
      });
      expect(second.widgets).toEqual(['editor:c.md']);
      expect(dock(moved).children[1].widgets).toEqual(['editor:d.md']);
      expect(moved.data[key]).toEqual(entry);
      expect(moved.metadata).toEqual({ id: 'w' });
      expect(tabsOf(moved.data).map(t => t.key)).toContain(key);
      expect(JSON.stringify(saved)).toBe(before);
    });

    it('makes a new tab area on an empty dock', () => {
      const empty: any = ws('w', 'then');
      empty.data['layout-restorer:data'].main.dock = null;
      expect(dock(withTab(empty, key, entry))).toEqual({
        type: 'tab-area',
        currentIndex: 0,
        widgets: [key]
      });
    });

    it('makes the layout when the workspace has none', () => {
      const moved: any = withTab(
        { data: {}, metadata: { id: 'w' } },
        key,
        entry
      );
      expect(tabsOf(moved.data)).toEqual([{ key, path: undefined, name: '7' }]);
      expect(moved.data[key]).toEqual(entry);
    });

    it('DEF-PANEL-78-MOVE-SIDEBARS: a layout it makes shows the file browser in the left area, as a workspace with no layout opens; a saved layout keeps its sidebars', () => {
      const moved: any = withTab(
        { data: {}, metadata: { id: 'w' } },
        key,
        entry
      );
      expect(moved.data['layout-restorer:data']).toEqual({
        left: { current: 'filebrowser' },
        main: { dock: { type: 'tab-area', currentIndex: 0, widgets: [key] } }
      });
      const collapsed: any = ws('w', 'then');
      collapsed.data['layout-restorer:data'].left = { collapsed: true };
      const kept: any = withTab(collapsed, key, entry);
      expect(kept.data['layout-restorer:data'].left).toEqual({
        collapsed: true
      });
    });

    it('returns a workspace that already holds the key unchanged, in the main or the down area', () => {
      const main = ws('w', 'then', [key], { [key]: { data: { name: 'x' } } });
      expect(withTab(main as any, key, entry)).toBe(main);
      const down: any = ws('w', 'then');
      down.data['layout-restorer:data'].down = { size: 0, widgets: [key] };
      expect(withTab(down, key, entry)).toBe(down);
    });
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: memory reads MB under 1 GB and GB from there, CPU a whole percent of one core, each a dash when unread', () => {
    expect(formatMemory(0)).toBe('0 MB');
    expect(formatMemory(150 * 2 ** 20)).toBe('150 MB');
    expect(formatMemory(1023.4 * 2 ** 20)).toBe('1023 MB');
    expect(formatMemory(2 ** 30)).toBe('1.0 GB');
    expect(formatMemory(2.54 * 2 ** 30)).toBe('2.5 GB');
    expect(formatCpu(0)).toBe('0%');
    expect(formatCpu(12.6)).toBe('13%');
    // percent of one core: a kernel on two cores reads above 100
    expect(formatCpu(187.2)).toBe('187%');
    for (const unread of [null, undefined]) {
      expect(formatMemory(unread)).toBe('-');
      expect(formatCpu(unread)).toBe('-');
    }
  });
});
