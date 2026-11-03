// the tsconfig only auto-includes jest types; pull in node's for the real setImmediate
/// <reference types="node" />
import { PageConfig } from '@jupyterlab/coreutils';
import { RunningSessionManagers } from '@jupyterlab/running';
import { ServerConnection } from '@jupyterlab/services';
import {
  dangerDialog,
  dismissDialog,
  waitForDialog
} from '@jupyterlab/testutils';
import { nullTranslator } from '@jupyterlab/translation';
import { CommandRegistry } from '@lumino/commands';
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Menu, Widget } from '@lumino/widgets';

import { withoutTabs } from '../model/model';
import { workspaceMenu } from '../panel/menus';
import { WorkspacePanel } from '../panel/panel';

const { setImmediate: realImmediate } = jest.requireActual('timers');
/** Let every pending request and render finish; immune to fake timers. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => realImmediate(resolve));
  }
};

const NS = 'jupyterlab-workspace-manager-extension';
const trans = nullTranslator.load(
  '@stellarshenson/jupyterlab-workspace-manager-extension'
);
const MARKUP = '<img src=x onerror=alert(1)>';
const iso = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60000).toISOString();
/** The labels of the rows under `root`. */
const rowLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('.jp-WorkspaceManager-rowLabel')).map(
    label => label.textContent
  );
/** The Last activity line of a terminal's tooltip, for a terminal active under a minute ago. */
const activeNow = (terminal: { last_activity?: string }) =>
  `Last activity: now (${new Date(terminal.last_activity!).toLocaleString()})`;

/** A saved workspace whose main area holds `keys`, with their saved data. */
function workspace(id: string, minutesAgo: number, keys: string[] = []) {
  const data: any = {
    'layout-restorer:data': {
      main: { dock: { type: 'tab-area', currentIndex: 0, widgets: keys } }
    }
  };
  for (const key of keys) {
    const [kind, rest] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
    data[key] = { data: kind === 'terminal' ? { name: rest } : { path: rest } };
  }
  return { data, metadata: { id, last_modified: iso(minutesAgo) } };
}

interface IServer {
  workspaces: any[];
  records: any;
  terminals: any[];
  kernels: any[];
  sessions: any[];
  /** the extension's `kernels` route: memory and CPU per kernel id */
  resources?: any;
  /** answer 404 on every route of the server extension */
  absent?: boolean;
  /** answer 500 on the extension's `kernels` route */
  resourcesFailing?: boolean;
  /** answer 500 on the extension's `meta` route, the records request */
  recordsFailing?: boolean;
  /** answer 500 on /api/kernels; `once` answers 500 to the next request only */
  failing?: boolean | 'once';
  /** the switch requests this window's next read delivers */
  switches?: { workspace: string | null; tab: string | null }[];
  /** the workspaces other windows show in the presence route */
  presence?: string[];
  /** answer 500 on the extension's `presence` route */
  presenceFailing?: boolean;
  /** what the panel saved last, per workspace id */
  saved?: { [id: string]: any };
  /** answer 500 to a save of this workspace */
  saveFailing?: string;
}

/** A fake Jupyter server behind `settings.fetch`; it logs every request. */
function fakeServer(server: IServer) {
  const log: string[] = [];
  let held: (() => void)[] | null = null;
  let holding: (method: string) => boolean = () => true;
  const reply = (status: number, body: unknown) =>
    ({
      ok: status < 300,
      status,
      statusText: '',
      headers: new Headers(),
      // a copy, as a real server sends: a later change to `server` must not reach data the panel holds
      json: async () =>
        body === undefined ? body : JSON.parse(JSON.stringify(body)),
      text: async () => (body === undefined ? '' : JSON.stringify(body))
    }) as unknown as Response;
  const route = (method: string, path: string, body: any): Response => {
    if (path.includes(NS)) {
      if (server.absent) {
        return reply(404, { message: 'Not Found' });
      }
      if (path.endsWith('/switch')) {
        // the route drops a request whose workspace file is gone and does not mark it delivered
        const all = server.switches ?? [];
        const requests = all.filter(
          s =>
            !s.workspace ||
            server.workspaces.some(w => w.metadata.id === s.workspace)
        );
        server.switches = all.filter(s => !requests.includes(s));
        return reply(200, { requests });
      }
      if (path.endsWith('/presence')) {
        if (method === 'POST') {
          if (server.presenceFailing) {
            return reply(500, { message: 'Unhandled error' });
          }
          // a claim is refused for a workspace another window shows
          const claim = JSON.parse(body);
          return claim.claim &&
            (server.presence ?? []).includes(claim.workspace)
            ? reply(409, {
                message: `workspace ${claim.workspace} is open in another window`
              })
            : reply(204, undefined);
        }
        return reply(200, { workspaces: server.presence ?? [] });
      }
      if (path.endsWith('/meta')) {
        return server.recordsFailing
          ? reply(500, { message: 'Unhandled error' })
          : reply(200, server.records);
      }
      if (path.endsWith('/terminals')) {
        return reply(200, server.terminals);
      }
      if (path.endsWith('/kernels')) {
        return server.resourcesFailing
          ? reply(500, { message: 'Unhandled error' })
          : reply(200, server.resources ?? {});
      }
      if (method === 'PATCH') {
        const id = decodeURIComponent(path.split('/').pop()!);
        server.records[id] = { ...server.records[id], ...JSON.parse(body) };
        return reply(200, server.records[id]);
      }
      return reply(200, { workspaces: [] });
    }
    if (path.endsWith('/api/workspaces')) {
      return reply(200, {
        workspaces: {
          ids: server.workspaces.map(w => w.metadata.id),
          values: server.workspaces
        }
      });
    }
    if (path.includes('/api/workspaces/')) {
      const id = decodeURIComponent(path.split('/').pop()!);
      if (method === 'PUT' && server.saveFailing === id) {
        return reply(500, { message: 'Unhandled error' });
      }
      if (method === 'PUT') {
        (server.saved ??= {})[id] = JSON.parse(body);
      }
      if (method !== 'GET') {
        return reply(204, undefined);
      }
      // jupyterlab_server answers a missing workspace with an empty one, no last_modified
      return reply(
        200,
        server.workspaces.find(w => w.metadata.id === id) ?? {
          data: {},
          metadata: { id: '/' + id }
        }
      );
    }
    if (path.endsWith('/api/terminals')) {
      return reply(
        200,
        server.terminals.map(({ name, last_activity }) => ({
          name,
          last_activity
        }))
      );
    }
    if (path.endsWith('/api/kernels')) {
      const failing = server.failing;
      if (failing === 'once') {
        server.failing = false;
      }
      return failing
        ? reply(500, { message: 'Unhandled error' })
        : reply(200, server.kernels);
    }
    if (path.endsWith('/api/sessions')) {
      return reply(200, server.sessions);
    }
    return reply(404, { message: 'Not Found' });
  };
  const fetch = async (request: Request) => {
    const path = new URL(request.url).pathname;
    log.push(`${request.method} ${path}`);
    const body = request.method === 'GET' ? null : await request.text();
    // answered as the server stands when the request arrives; a held one is delivered on release
    const response = route(request.method, path, body);
    if (held && holding(request.method)) {
      await new Promise<void>(resolve => held!.push(resolve));
    }
    return response;
  };
  const settings = ServerConnection.makeSettings({
    baseUrl: 'http://localhost/',
    wsUrl: 'ws://localhost/',
    appUrl: 'lab',
    fetch: fetch as any
  });
  return {
    settings,
    log,
    /** the number of reloads: each one lists the workspaces once */
    reloads: () => log.filter(l => l.endsWith('/lab/api/workspaces')).length,
    /** hold the requests of these methods, every request without them */
    hold: (methods?: string[]) => {
      held = [];
      holding = method => !methods || methods.includes(method);
    },
    release: () => {
      const waiting = held ?? [];
      held = null;
      waiting.forEach(resolve => resolve());
    }
  };
}

const PYTHON = 'Python 3 (ipykernel)';

function fakeApp(settings: ServerConnection.ISettings, live: Widget[] = []) {
  return {
    serviceManager: {
      serverSettings: settings,
      kernelspecs: {
        specs: {
          default: 'python3',
          kernelspecs: {
            python3: {
              name: 'python3',
              display_name: PYTHON,
              language: 'python',
              argv: [],
              resources: {}
            }
          }
        },
        specsChanged: new Signal<any, any>({})
      },
      terminals: { shutdown: jest.fn(async () => undefined) },
      kernels: { shutdown: jest.fn(async () => undefined) }
    },
    shell: {
      widgets: (area: string) =>
        (area === 'main' ? live : [])[Symbol.iterator](),
      activateById: jest.fn(),
      currentWidget: null,
      currentChanged: new Signal<any, any>({})
    },
    commands: new CommandRegistry(),
    docRegistry: { getFileTypesForPath: () => [] }
  } as any;
}

/**
 * default, this window's workspace, whose rows follow the live tabs; auto-6
 * holding a document and terminal 1; a kernel in no workspace.
 */
function standard(): IServer {
  return {
    workspaces: [
      workspace('default', 1),
      workspace('auto-6', 60 * 24 * 3, ['terminal:1', 'editor:docs/README.md'])
    ],
    records: {
      'auto-6': { colour: 'peach', purpose: 'Firmware upload tests' }
    },
    terminals: [{ name: '1', last_activity: iso(0), process: 'claude' }],
    kernels: [
      {
        id: 'k1',
        name: 'python3',
        last_activity: iso(5),
        execution_state: 'idle',
        connections: 0
      }
    ],
    sessions: []
  };
}

/** A fake section of another extension whose items have only a label. */
const manager = (name: string, labels: string[]) => ({
  name,
  running: () => labels.map(label => ({ label: () => label, icon: () => '' })),
  refreshRunning: () => undefined,
  runningChanged: new Signal<any, any>({}),
  shutdownAll: () => undefined
});

let panels: WorkspacePanel[] = [];

async function mount(
  server: IServer,
  options: { live?: Widget[]; managers?: RunningSessionManagers } = {}
) {
  const fake = fakeServer(server);
  const app = fakeApp(fake.settings, options.live);
  const panel = new WorkspacePanel({
    app,
    current: 'default',
    window: 'w1',
    managers: options.managers ?? null,
    trans
  });
  panels.push(panel);
  Widget.attach(panel, document.body);
  await settle();
  return { panel, fake, app, ...fake };
}

/** Choose the item at `index` of the open menu by keyboard; Lumino reads keyCode. */
function chooseMenuItem(index: number) {
  const menu = document.querySelector('.jp-WorkspaceManager-menu')!;
  for (let i = 0; i <= index; i++) {
    pressKey(menu, 40); // ArrowDown
  }
  pressKey(menu, 13); // Enter
}

function pressKey(menu: Element, keyCode: number) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true
  });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  menu.dispatchEvent(event);
}

/** The labels of the items of the open menus, the submenu's after its parent's. */
const menuLabels = () =>
  Array.from(
    document.querySelectorAll('.jp-WorkspaceManager-menu .lm-Menu-itemLabel')
  ).map(l => l.textContent);

/** Choose workspace `name` in the Move to workspace submenu at `index` of the open row menu. */
function moveTo(index: number, name: string) {
  chooseMenuItem(index);
  const menus = document.querySelectorAll('.jp-WorkspaceManager-menu');
  const submenu = menus[menus.length - 1];
  const labels = Array.from(submenu.querySelectorAll('.lm-Menu-itemLabel'));
  // the keyboard opens a submenu with its first item active
  for (let i = labels.findIndex(l => l.textContent === name); i > 0; i--) {
    pressKey(submenu, 40); // ArrowDown
  }
  pressKey(submenu, 13); // Enter
}

/** The shell moves its current tab, which it does on the focus event. */
function current(app: any, widget: Widget | null) {
  app.shell.currentWidget = widget;
  app.shell.currentChanged.emit({ oldValue: null, newValue: widget });
}

/** A tab of this window showing `path`, attached, holding a focusable element; `notebook` makes it a notebook's. */
function liveTab(path: string, notebook = false) {
  const tab = new Widget();
  (tab as any).context = { path };
  tab.title.label = path;
  if (notebook) {
    tab.addClass('jp-NotebookPanel');
  }
  const input = tab.node.appendChild(document.createElement('input'));
  Widget.attach(tab, document.body);
  return { tab, input };
}

const dialogText = () => document.querySelector('.jp-Dialog')?.textContent;
const dialogBody = () => document.querySelector('.jp-Dialog-body')?.textContent;

const $ = (panel: Widget, selector: string) =>
  panel.node.querySelector<HTMLElement>(selector);
const $$ = (panel: Widget, selector: string) =>
  Array.from(panel.node.querySelectorAll<HTMLElement>(selector));
const card = (panel: Widget, key: string) => $(panel, `[data-key="${key}"]`)!;
/** The workspace cards, top to bottom. */
const order = (panel: Widget) =>
  $$(panel, '[data-workspace]').map(c => c.dataset.workspace);
const header = (panel: Widget, key: string) =>
  card(panel, key).querySelector<HTMLElement>(
    '.jp-WorkspaceManager-cardHeader'
  )!;
/** The triangle of a card: it opens or closes the card. */
const triangle = (panel: Widget, key: string) =>
  header(panel, key).querySelector<HTMLElement>('.jp-WorkspaceManager-caret')!;
/** A section of the panel: workspaces, kernels, terminals or servers. */
const section = (panel: Widget, key: string) =>
  $(panel, `[data-section="${key}"]`);
const sectionHeader = (panel: Widget, key: string) =>
  section(panel, key)!.querySelector<HTMLElement>(
    '.jp-WorkspaceManager-sectionHeader'
  )!;
const sectionBody = (panel: Widget, key: string) =>
  section(panel, key)!.querySelector<HTMLElement>(
    '.jp-WorkspaceManager-sectionBody'
  )!;
const sectionCount = (panel: Widget, key: string) =>
  section(panel, key)!.querySelector<HTMLElement>(
    '.jp-WorkspaceManager-sectionCount'
  )!.textContent;
/** Open a section through its header, as a click does; its body. */
const openSection = (panel: Widget, key: string) => {
  if (sectionHeader(panel, key).getAttribute('aria-expanded') !== 'true') {
    sectionHeader(panel, key).click();
  }
  return sectionBody(panel, key);
};
/** The Shut down all button of a section's header: the icon button named by its aria-label. */
const shutDownAll = (panel: Widget, key: string) =>
  Array.from(sectionHeader(panel, key).querySelectorAll('button')).find(
    b => b.getAttribute('aria-label') === 'Shut down all'
  )!;
/** The clear-console button of the WORKSPACES band. */
const cleanButton = (panel: Widget) =>
  Array.from(
    sectionHeader(panel, 'workspaces').querySelectorAll('button')
  ).find(b => b.getAttribute('aria-label') === 'Clean up workspaces')!;
const refreshButton = (panel: Widget) =>
  $(panel, 'button[aria-label="Refresh"]') as HTMLButtonElement;

afterEach(() => {
  panels.forEach(p => p.dispose());
  panels = [];
  document.body.innerHTML = '';
  jest.useRealTimers();
  jest.restoreAllMocks();
  // the open state of the sections is kept here
  localStorage.clear();
});

describe('panel', () => {
  it('ACC-PANEL-4-OTHERS: sections of other extensions are not listed: the panel shows the workspace cards and the Kernels, Terminals and Language servers sections only', async () => {
    const managers = new RunningSessionManagers();
    managers.add(manager('Debug sessions', ['debug-a', 'debug-b']));
    managers.add(manager('Language servers', ['pylsp (python)']));
    for (const name of ['Open Tabs', 'Kernels', 'Terminals', 'Workspaces']) {
      managers.add(manager(name, [`item of ${name}`]));
    }
    const { panel } = await mount(standard(), { managers });

    expect($$(panel, '[data-section]').map(s => s.dataset.section)).toEqual([
      'workspaces',
      'kernels',
      'terminals',
      'servers'
    ]);
    const text = panel.node.textContent!;
    expect(text).not.toContain('DEBUG SESSIONS');
    expect(text).not.toContain('debug-a');
    expect(text).not.toContain('item of');
    // the replaced sections' own items are not shown either
    expect(text).not.toContain('OTHER SESSIONS');
  });

  it('ACC-LISTS-158-LANG-LISTED: language servers are listed in the LANGUAGE SERVERS section, never inside a workspace card', async () => {
    const managers = new RunningSessionManagers();
    managers.add(
      manager('Language servers', ['pylsp (python)', 'bash-lsp (bash)'])
    );
    const { panel } = await mount(standard(), { managers });

    expect(sectionHeader(panel, 'servers').textContent).toContain(
      'LANGUAGE SERVERS'
    );
    expect(sectionCount(panel, 'servers')).toBe('(2)');
    // no workspace card holds a language server
    for (const key of ['w:default', 'w:auto-6']) {
      expect(card(panel, key).textContent).not.toContain('pylsp');
    }
    const body = openSection(panel, 'servers');
    const rows = Array.from(
      body.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
    );
    expect(rows.map(r => r.textContent)).toEqual([
      'pylsp (python)',
      'bash-lsp (bash)'
    ]);
    // ACC-PANEL-185: the label gives the id and the language, one per line
    expect(rows.map(r => r.title)).toEqual(['pylsp\npython', 'bash-lsp\nbash']);
  });

  it('ACC-LISTS-160-LANG-ONLY: the LANGUAGE SERVERS section shows when it holds a language server and no terminal or kernel is in no workspace', async () => {
    const server = standard();
    // the kernel of a notebook of auto-6; terminal 1 is in auto-6 already
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, [
      'terminal:1',
      'notebook:a.ipynb'
    ]);
    const managers = new RunningSessionManagers();
    managers.add(manager('Language servers', ['pylsp (python)']));
    const { panel } = await mount(server, { managers });

    // ACC-PANEL-193-SECTIONS-SHOWN: KERNELS and TERMINALS stay, listing auto-6's
    expect($$(panel, '[data-section]').map(s => s.dataset.section)).toEqual([
      'workspaces',
      'kernels',
      'terminals',
      'servers'
    ]);
    const body = openSection(panel, 'servers');
    expect(
      Array.from(
        body.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
      ).map(r => r.textContent)
    ).toEqual(['pylsp (python)']);
  });

  it('ACC-LISTS-161-LANG-ACTIONS: a language server row keeps its shutdown button; the section header Shut down all asks, then shuts all down', async () => {
    const managers = new RunningSessionManagers();
    const shutdown = jest.fn();
    const shutdownAll = jest.fn();
    managers.add({
      ...manager('Language servers', []),
      running: () => [
        { label: () => 'pylsp (python)', icon: () => '', shutdown }
      ],
      shutdownAll,
      shutdownLabel: 'Shut Down',
      shutdownAllLabel: 'Shut Down All',
      shutdownAllConfirmationText:
        'Are you sure you want to permanently shut down all running language servers?'
    });
    const { panel } = await mount(standard(), { managers });

    openSection(panel, 'servers')
      .querySelector<HTMLElement>('button[aria-label="Shut Down"]')!
      .click();
    expect(shutdown).toHaveBeenCalledTimes(1);

    const all = shutDownAll(panel, 'servers');
    all.click();
    await waitForDialog();
    expect(dialogText()).toContain('shut down all running language servers?');
    await dismissDialog();
    await settle();
    expect(shutdownAll).not.toHaveBeenCalled();
    all.click();
    await dangerDialog();
    await settle();
    expect(shutdownAll).toHaveBeenCalledTimes(1);
  });

  /** The clean-up example of DQ-22: this window's workspace holds two tabs, two terminals and a kernel, iconprobe2 is deleted and auto-6 is kept by another window. */
  function cleanup(): IServer {
    return {
      workspaces: [
        workspace('default', 1),
        workspace('iconprobe2', 30, ['notebook:notebooks/probe.ipynb']),
        workspace('auto-6', 60 * 24 * 3, ['terminal:1'])
      ],
      records: {},
      terminals: [
        { name: '7', last_activity: iso(0), process: 'vim' },
        { name: '11', last_activity: iso(0), process: 'htop' },
        { name: '1', last_activity: iso(0), process: 'claude' }
      ],
      kernels: [
        {
          id: 'k1',
          name: 'python3',
          last_activity: iso(5),
          execution_state: 'idle',
          connections: 0
        }
      ],
      sessions: [
        {
          id: 's1',
          name: 'design.ipynb',
          path: 'notebooks/design.ipynb',
          type: 'notebook',
          kernel: { id: 'k1', name: 'python3' }
        }
      ],
      presence: ['auto-6']
    };
  }

  /** The live tabs of this window for `cleanup`: a document, a notebook with its kernel and two terminals. */
  function cleanupWidgets(): Widget[] {
    const doc = new Widget();
    (doc as any).context = { path: 'docs/README.md' };
    doc.title.label = 'README.md';
    const notebook = new Widget();
    notebook.title.label = 'design.ipynb';
    (notebook as any).context = { path: 'notebooks/design.ipynb' };
    (notebook as any).hasClass = (name: string) => name === 'jp-NotebookPanel';
    const terminal = (name: string) => {
      const tab = new Widget();
      (tab as any).content = {
        hasClass: (name: string) => name === 'jp-Terminal',
        session: { name }
      };
      return tab;
    };
    return [doc, notebook, terminal('7'), terminal('11')];
  }

  it('ACC-ACCORD-221-CLEAN-BUTTON: the WORKSPACES band ends with Clean up workspaces, disabled while nothing would change and enabled by another workspace, a tab or a language server', async () => {
    const alone = (): IServer => ({
      workspaces: [workspace('default', 1)],
      records: {},
      terminals: [],
      kernels: [],
      sessions: []
    });
    const empty = await mount(alone());
    const button = cleanButton(empty.panel);
    expect(button.getAttribute('aria-label')).toBe('Clean up workspaces');
    expect(button.disabled).toBe(true);

    // a workspace to delete
    const second = await mount({
      ...alone(),
      workspaces: [workspace('default', 1), workspace('other', 2)]
    });
    expect(cleanButton(second.panel).disabled).toBe(false);

    // a tab this window's workspace holds
    const doc = new Widget();
    (doc as any).context = { path: 'docs/README.md' };
    doc.title.label = 'README.md';
    const third = await mount(alone(), { live: [doc] });
    expect(cleanButton(third.panel).disabled).toBe(false);

    // a running language server
    const managers = new RunningSessionManagers();
    managers.add(manager('Language servers', ['pylsp (python)']));
    const fourth = await mount(alone(), { managers });
    expect(cleanButton(fourth.panel).disabled).toBe(false);
  });

  it('ACC-ACCORD-222-CLEAN-DIALOG: the clear-console button asks with a dialog titled Clean up workspaces that counts the workspaces and names each one, what it holds and its outcome, Clean up at the far left and Cancel at the right', async () => {
    const { panel, fake } = await mount(cleanup(), { live: cleanupWidgets() });
    cleanButton(panel).click();
    await waitForDialog();

    const dialog = document.querySelector('.jp-Dialog')!;
    expect(dialog.querySelector('.jp-Dialog-header')!.textContent).toBe(
      'Clean up workspaces'
    );
    expect(
      dialog.querySelector('.jp-WorkspaceManager-cleanupSummary')!.textContent
    ).toBe(
      'Clean up 3 workspaces? 1 is deleted, default is emptied, and auto-6 is kept because another window shows it.'
    );
    const rows = new Map(
      Array.from(
        dialog.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-cleanupRow')
      ).map(row => [
        row.querySelector('.jp-WorkspaceManager-cleanupName')!.textContent!,
        {
          outcome: row.querySelector('.jp-WorkspaceManager-cleanupOutcome')!
            .textContent,
          holds: Array.from(
            row.querySelectorAll<HTMLElement>(
              '.jp-WorkspaceManager-cleanupHolds'
            )
          ).map(hold => hold.textContent)
        }
      ])
    );
    expect(rows.get('default')).toEqual({
      outcome: 'emptied',
      holds: [
        'Tabs: docs/README.md, notebooks/design.ipynb',
        'Terminals: terminal 7, terminal 11',
        `Kernels: ${PYTHON} (design.ipynb)`
      ]
    });
    expect(rows.get('iconprobe2')).toEqual({
      outcome: 'deleted',
      holds: ['Tabs: notebooks/probe.ipynb', 'Terminals: none', 'Kernels: none']
    });
    expect(rows.get('auto-6')).toEqual({
      outcome: 'kept',
      holds: ['Tabs: none', 'Terminals: terminal 1', 'Kernels: none']
    });
    // one line after the rows says the language servers restart on demand
    const notes = Array.from(
      dialog.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-cleanupNote'),
      note => note.textContent
    );
    expect(notes).toEqual(['Language servers restart on demand']);

    const buttons = Array.from(
      dialog.querySelectorAll<HTMLElement>('.jp-Dialog-button')
    );
    expect(buttons.map(b => b.textContent)).toEqual(['Clean up', 'Cancel']);
    expect(buttons[0].classList).toContain('jp-WorkspaceManager-danger');
    expect(buttons[1].classList).toContain('jp-WorkspaceManager-secondary');

    // nothing happens without the confirmation
    await dismissDialog();
    await settle();
    expect(
      fake.log.filter(l => l.startsWith('DELETE /lab/api/workspaces/'))
    ).toEqual([]);

    // the line is unconditional: a confirmation with no kept workspace says it too
    const unkept = cleanup();
    unkept.presence = [];
    const second = await mount(unkept, { live: cleanupWidgets() });
    cleanButton(second.panel).click();
    await waitForDialog();
    expect(
      document.querySelector<HTMLElement>('.jp-WorkspaceManager-cleanupNote')
        ?.textContent
    ).toBe('Language servers restart on demand');
    await dismissDialog();
    await settle();
  });

  it('ACC-ACCORD-222-CLEAN-NAME: the clean-up dialog carries an accessible name, which apputils gives only a string body', async () => {
    const { panel } = await mount(cleanup(), { live: cleanupWidgets() });
    cleanButton(panel).click();
    await waitForDialog();

    expect(
      document.querySelector('.jp-Dialog')!.getAttribute('aria-label')
    ).toBe('Clean up workspaces');

    await dismissDialog();
    await settle();
  });

  it('DEF-PANEL-56-ABSENT-BROOM: without the server extension the clear-console button refuses before the dialog and deletes nothing', async () => {
    const server = { ...standard(), absent: true };
    const { panel, log } = await mount(server);
    expect(card(panel, 'w:auto-6')).toBeTruthy();

    cleanButton(panel).click();
    await waitForDialog();
    expect(dialogText()).toContain(
      'Clean up needs the server extension: it cannot tell which workspaces another window shows.'
    );

    await dismissDialog();
    await settle();
    expect(
      log.filter(l => l.startsWith('DELETE /lab/api/workspaces/'))
    ).toEqual([]);
    expect(card(panel, 'w:auto-6')).toBeTruthy();
  });

  it('DEF-PANEL-58-ABSENT-MENU: without the server extension Close all tabs refuses', async () => {
    const { panel } = await mount({ ...standard(), absent: true });
    header(panel, 'w:auto-6')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    chooseMenuItem(2); // Close all tabs
    await waitForDialog();
    expect(dialogText()).toContain(
      'Close all tabs is refused: the server extension is not available, so the panel cannot tell which workspaces another window shows.'
    );
    await dismissDialog();
    await settle();
  });

  it('DEF-PANEL-58-ABSENT-MENU: without the server extension Close tab refuses', async () => {
    const { panel } = await mount({ ...standard(), absent: true });
    triangle(panel, 'w:auto-6').click();
    await settle();
    const row = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.textContent!.includes('README.md'))!;
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(0); // Close tab
    await waitForDialog();
    expect(dialogText()).toContain(
      'Close tab is refused: the server extension is not available, so the panel cannot tell which workspaces another window shows.'
    );
    await dismissDialog();
    await settle();
  });

  it('DEF-PANEL-58-ABSENT-MENU: without the server extension Delete issues no delete', async () => {
    const { panel, log } = await mount({ ...standard(), absent: true });
    log.length = 0;
    card(panel, 'w:auto-6')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    // Open workspace, Open in new browser tab, Close all tabs, Set description...,
    // Colour, Hide workspace, Move down, Delete workspace
    chooseMenuItem(7);
    // the first Enter arms Confirm delete, the second deletes
    const menu = document.querySelector<HTMLElement>(
      '.jp-WorkspaceManager-menu'
    )!;
    const enter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(enter, 'keyCode', { value: 13 });
    menu.dispatchEvent(enter);
    await settle();
    expect(
      log.filter(l => l.startsWith('DELETE /lab/api/workspaces/'))
    ).toEqual([]);
    expect(card(panel, 'w:auto-6')).toBeTruthy();
    await waitForDialog();
    expect(dialogText()).toContain(
      'Delete workspace is refused: the server extension is not available, so the panel cannot tell which workspaces another window shows.'
    );
    await dismissDialog();
    await settle();
  });

  it('DEF-PANEL-58-ABSENT-MENU: without the server extension Open workspace still opens the workspace', async () => {
    const { panel } = await mount({ ...standard(), absent: true });
    const url = jest
      .spyOn(panel as any, '_url')
      .mockImplementation(() => '#opened-auto-6');
    card(panel, 'w:auto-6')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    chooseMenuItem(0); // Open workspace
    await settle();
    expect(url).toHaveBeenCalledWith('auto-6');
  });

  it('ACC-ACCORD-223-CLEAN-ACTION: the confirmation deletes every other workspace and empties this one, closing its tabs and shutting down its terminals, kernels and language servers', async () => {
    const managers = new RunningSessionManagers();
    const shutdownAll = jest.fn();
    managers.add({
      ...manager('Language servers', ['pylsp (python)']),
      shutdownAll
    });
    const { panel, app, fake } = await mount(cleanup(), {
      live: cleanupWidgets(),
      managers
    });
    const closeAll = jest.fn();
    app.commands.addCommand('application:close-all', {
      execute: closeAll
    });

    cleanButton(panel).click();
    await waitForDialog();
    await dangerDialog();
    await settle();

    // every workspace but this one and the one another window shows
    expect(
      fake.log.filter(l => l.startsWith('DELETE /lab/api/workspaces/'))
    ).toEqual(['DELETE /lab/api/workspaces/iconprobe2']);
    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(
      app.serviceManager.terminals.shutdown.mock.calls.map((c: any[]) => c[0])
    ).toEqual(['7', '11']);
    expect(app.serviceManager.kernels.shutdown).toHaveBeenCalledWith('k1');
    expect(shutdownAll).toHaveBeenCalledTimes(1);
  });

  it('ACC-ACCORD-223-CLEAN-ACTION: a terminal that ended mid-clean-up does not stop the kernel, language-server and tab shutdowns', async () => {
    const managers = new RunningSessionManagers();
    const shutdownAll = jest.fn();
    managers.add({
      ...manager('Language servers', ['pylsp (python)']),
      shutdownAll
    });
    const { panel, app } = await mount(cleanup(), {
      live: cleanupWidgets(),
      managers
    });
    const closeAll = jest.fn();
    app.commands.addCommand('application:close-all', { execute: closeAll });
    // terminal 7 ended while the dialog was open: the server answers its shutdown with 404
    app.serviceManager.terminals.shutdown.mockImplementation(
      async (name: string) => {
        if (name === '7') {
          throw new Error('Terminal not found');
        }
      }
    );

    cleanButton(panel).click();
    await waitForDialog();
    await dangerDialog();
    await settle();

    expect(app.serviceManager.kernels.shutdown).toHaveBeenCalledWith('k1');
    expect(shutdownAll).toHaveBeenCalledTimes(1);
    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it('ACC-ACCORD-223-CLEAN-ACTION: a workspace created while the confirmation is open is not deleted', async () => {
    const server = cleanup();
    const { panel, fake, app } = await mount(server, {
      live: cleanupWidgets()
    });
    // the clean-up ends by closing this window's tabs
    app.commands.addCommand('application:close-all', { execute: jest.fn() });

    cleanButton(panel).click();
    await waitForDialog();
    // another window creates a workspace while the dialog waits for its answer
    server.workspaces.push(workspace('created-since', 1));
    await dangerDialog();
    await settle();

    expect(
      fake.log.filter(l => l.startsWith('DELETE /lab/api/workspaces/'))
    ).toEqual(['DELETE /lab/api/workspaces/iconprobe2']);
  });

  it('ACC-PANEL-207-BUTTON-ARROWS: ArrowDown and ArrowUp pressed on a row button move the focus between rows; Enter and Space on the button stay with it and do not open the row', async () => {
    const managers = new RunningSessionManagers();
    const shutdown = jest.fn();
    const open = jest.fn();
    managers.add({
      ...manager('Language servers', []),
      running: () => [
        { label: () => 'pylsp (python)', icon: () => '', shutdown, open },
        { label: () => 'bash-lsp (bash)', icon: () => '', shutdown, open }
      ],
      shutdownLabel: 'Shut Down'
    });
    const { panel } = await mount(standard(), { managers });
    const rows = Array.from(
      openSection(panel, 'servers').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    const button = (row: HTMLElement) =>
      row.querySelector<HTMLElement>('button')!;
    const key = (target: HTMLElement, name: string) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: name,
          bubbles: true,
          cancelable: true
        })
      );

    button(rows[0]).focus();
    key(button(rows[0]), 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    key(button(rows[1]), 'ArrowUp');
    expect(document.activeElement).toBe(rows[0]);

    // Enter and Space stay with the button: the row's own Enter does not open it
    button(rows[0]).focus();
    key(button(rows[0]), 'Enter');
    key(button(rows[0]), ' ');
    expect(open).not.toHaveBeenCalled();
    // the browser activates the button; its click shuts that server down and opens nothing
    button(rows[0]).click();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('ACC-PANEL-157-OTHERS-ACTIONS: a row of the KERNELS and TERMINALS sections keeps its shutdown action, and each section header carries Shut down all', async () => {
    const server = standard();
    server.terminals.push({
      name: '9',
      last_activity: iso(0),
      process: 'htop'
    });
    const { panel, app } = await mount(server);

    // terminal 9, in no workspace: terminal 1 above it is auto-6's
    const terminals = openSection(panel, 'terminals');
    terminals
      .querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')[1]
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(0); // Shut down terminal
    await settle();
    expect(app.serviceManager.terminals.shutdown).toHaveBeenCalledWith('9');

    const kernels = openSection(panel, 'kernels');
    kernels
      .querySelector<HTMLElement>('.jp-WorkspaceManager-row')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(0); // Shut down kernel
    await settle();
    expect(app.serviceManager.kernels.shutdown).toHaveBeenCalledWith('k1');

    for (const key of ['kernels', 'terminals']) {
      expect(shutDownAll(panel, key)).toBeTruthy();
    }
  });

  it('DEF-PANEL-10-SHARED-VIEW, DEF-PANEL-69-TABS-SAMEFILE: each open tab of one file has its own row and count; its click and Close tab act on that tab alone', async () => {
    // a third file whose name is the key the second view of a.md takes
    const views = ['a.md', 'a.md', 'a.md#2'].map((path, i) => {
      const view = new Widget();
      view.id = `view-${i}`;
      view.title.label = path;
      (view as any).context = { path };
      return view;
    });
    const closed = views.map(v => jest.spyOn(v, 'close'));
    const error = jest.spyOn(console, 'error');
    const { panel, app } = await mount(standard(), { live: views });
    header(panel, 'w:default').click();
    const rows = () =>
      card(panel, 'w:default').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      );
    expect(rows()).toHaveLength(3);
    expect(
      header(panel, 'w:default').querySelector(
        '.jp-WorkspaceManager-count[title="Tabs"]'
      )!.textContent
    ).toBe('3');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();

    rows().forEach((row, i) => {
      row.click();
      expect(app.shell.activateById).toHaveBeenLastCalledWith(`view-${i}`);
    });

    rows()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(0); // Close tab
    await settle();
    expect(closed.map(close => close.mock.calls.length)).toEqual([0, 1, 0]);
  });

  it('DEF-PANEL-11-SHUTDOWN-STALE: Shut down all shuts down the terminals running when the user confirms', async () => {
    const server = standard();
    // terminal 1 of auto-6 and two terminals in no workspace
    server.terminals.push(
      { name: '9', last_activity: iso(0), process: 'htop' },
      { name: '8', last_activity: iso(0), process: 'fish' }
    );
    const { panel, app } = await mount(server);
    openSection(panel, 'terminals');
    const all = shutDownAll(panel, 'terminals');
    all.click();
    await waitForDialog();
    expect(dialogText()).toContain('Shut down 3 terminals.');
    // while the dialog is open, terminal 9 ends
    server.terminals = server.terminals.filter(t => t.name !== '9');
    await dangerDialog();
    await settle();
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([
      ['1'],
      ['8']
    ]);
    expect(app.serviceManager.kernels.shutdown).not.toHaveBeenCalled();
  });

  it('ACC-PANEL-193-SECTIONS-SHOWN: with no kernel, terminal or language server the four sections show in order, each says it is empty, and Shut down all is disabled', async () => {
    const server = standard();
    server.terminals = [];
    server.kernels = [];
    // no language server manager is registered
    const { panel } = await mount(server);
    expect($$(panel, '[data-section]').map(s => s.dataset.section)).toEqual([
      'workspaces',
      'kernels',
      'terminals',
      'servers'
    ]);
    for (const [key, text] of [
      ['kernels', 'No kernels'],
      ['terminals', 'No terminals'],
      ['servers', 'No language servers']
    ]) {
      expect(sectionCount(panel, key)).toBe('(0)');
      expect(shutDownAll(panel, key).disabled).toBe(true);
      expect(openSection(panel, key).textContent).toBe(text);
    }
  });

  it('ACC-PANEL-182-SECTION-HEADS, ACC-PANEL-229-EXCLUSIVE: WORKSPACES opens by default; opening a section closes the open one; a click on the open header closes every section; a new panel keeps the state', async () => {
    const { panel } = await mount(standard());
    const expanded = (p: Widget) =>
      ['workspaces', 'kernels', 'terminals', 'servers'].map(key =>
        sectionHeader(p, key).getAttribute('aria-expanded')
      );
    expect(expanded(panel)).toEqual(['true', 'false', 'false', 'false']);
    expect($$(panel, '.jp-WorkspaceManager-sectionBody')).toHaveLength(1);
    sectionHeader(panel, 'kernels').click();
    expect(expanded(panel)).toEqual(['false', 'true', 'false', 'false']);
    expect(
      section(panel, 'workspaces')!.querySelector(
        '.jp-WorkspaceManager-sectionBody'
      )
    ).toBeNull();
    sectionHeader(panel, 'terminals').click();
    expect(expanded(panel)).toEqual(['false', 'false', 'true', 'false']);
    sectionHeader(panel, 'terminals').click();
    expect(expanded(panel)).toEqual(['false', 'false', 'false', 'false']);
    // the next page of this browser: every section closed stays closed
    const { panel: next } = await mount(standard());
    expect(expanded(next)).toEqual(['false', 'false', 'false', 'false']);
    sectionHeader(next, 'workspaces').click();
    expect(expanded(next)).toEqual(['true', 'false', 'false', 'false']);
    const { panel: again } = await mount(standard());
    expect(expanded(again)).toEqual(['true', 'false', 'false', 'false']);
  });

  it('ACC-PANEL-208-SECTION-STORE: a localStorage that throws, or an unreadable stored state, opens WORKSPACES alone, and a click opens one section and closes the other', async () => {
    const expanded = (p: Widget) =>
      ['workspaces', 'kernels', 'terminals', 'servers'].map(key =>
        sectionHeader(p, key).getAttribute('aria-expanded')
      );
    const failing = [
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      }),
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      })
    ];
    const { panel } = await mount(standard());
    expect(expanded(panel)).toEqual(['true', 'false', 'false', 'false']);
    sectionHeader(panel, 'kernels').click();
    expect(expanded(panel)).toEqual(['false', 'true', 'false', 'false']);
    failing.forEach(spy => spy.mockRestore());

    for (const stored of ['{', '{"kernels": false}']) {
      localStorage.setItem(
        '@stellarshenson/jupyterlab-workspace-manager-extension:closed-sections',
        stored
      );
      const { panel: other } = await mount(standard());
      expect(expanded(other)).toEqual(['true', 'false', 'false', 'false']);
      sectionHeader(other, 'servers').click();
      expect(expanded(other)).toEqual(['false', 'false', 'false', 'true']);
    }
  });

  it('ACC-LISTS-194-ALL-TERMINALS, ACC-LISTS-195-ALL-KERNELS: TERMINALS and KERNELS list what a workspace holds too; such a row acts as in its card; the card counts stay', async () => {
    const server = standard();
    // terminal 2 open in this window; the kernel's notebook is in auto-6
    server.terminals.push({ name: '2', last_activity: iso(0), process: 'vim' });
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, [
      'terminal:1',
      'notebook:a.ipynb'
    ]);
    const tab = new Widget();
    tab.id = 'terminal-2';
    (tab as any).content = {
      hasClass: (name: string) => name === 'jp-Terminal',
      session: { name: '2' }
    };
    const { panel, app } = await mount(server, { live: [tab] });
    const execute = jest.spyOn(app.commands, 'execute');
    app.commands.addCommand('docmanager:open', { execute: () => undefined });

    const terminals = Array.from(
      openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    expect(terminals.map(r => r.title.split('\n')[0])).toEqual([
      'terminal 1',
      'terminal 2'
    ]);
    // terminal 2 is this window's: the row activates its tab, as in the card
    terminals[1].click();
    expect(app.shell.activateById).toHaveBeenCalledWith('terminal-2');
    expect(execute).not.toHaveBeenCalled();

    const kernels = Array.from(
      openSection(panel, 'kernels').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    expect(kernels.map(r => r.title.split('\n')[0])).toEqual([PYTHON]);
    // a kernel held only by auto-6: its KERNELS row opens the notebook here, no switch
    const openWorkspace = jest.spyOn(panel as any, '_openWorkspace');
    kernels[0].click();
    expect(execute).toHaveBeenCalledWith('docmanager:open', {
      path: 'a.ipynb'
    });
    expect(openWorkspace).not.toHaveBeenCalled();

    openSection(panel, 'workspaces');
    // DQ-17: a card shows its counts while it is open
    const counts = (key: string) => {
      triangle(panel, key).click();
      return Array.from(
        header(panel, key).querySelectorAll('.jp-WorkspaceManager-count')
      ).map(c => c.textContent);
    };
    expect(counts('w:auto-6')).toEqual(['2', '1', '1']);
    expect(counts('w:default')).toEqual(['1', '1', '0']);
  });

  it('ACC-KERNEL-151-ROW-CLICK, ACC-LISTS-195-ALL-KERNELS: a KERNELS row of a console kernel held by another workspace switches to that workspace', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      name: 'Console 1',
      path: 'console-1-7f3a',
      type: 'console',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, ['console:console-1-7f3a']);
    const { panel } = await mount(server);
    const rows = Array.from(
      openSection(panel, 'kernels').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    expect(
      rows.map(
        r => r.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent
      )
    ).toEqual(['Console 1']);
    // a console has no tab here: the row switches to the workspace that holds it
    const openWorkspace = jest
      .spyOn(panel as any, '_openWorkspace')
      .mockResolvedValue(undefined);
    rows[0].click();
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auto-6' })
    );
  });

  it('ACC-TERM-215-TAB-MATCH: a terminal row activates the tab of its running terminal, never the kept tab of an ended one; without such a tab it opens one', async () => {
    const server = standard();
    server.terminals.push({ name: '2', last_activity: iso(0), process: 'vim' });
    // both terminals ended and left their tabs open: the connection is disposed
    const ended = (name: string) => {
      const tab = new Widget();
      tab.id = `stale-${name}`;
      (tab as any).content = {
        hasClass: (c: string) => c === 'jp-Terminal',
        session: { name, isDisposed: true }
      };
      return tab;
    };
    const created: Widget[] = [];
    const { panel, app } = await mount(server, {
      live: [ended('1'), ended('2')]
    });
    // terminal:open would activate the kept tab of an ended connection: the rows must not use it
    const opened: string[] = [];
    app.commands.addCommand('terminal:open', {
      execute: (args: any) => {
        opened.push(args.name);
      }
    });
    app.commands.addCommand('terminal:create-new', {
      execute: (args: any) => {
        const tab = new Widget();
        tab.id = `new-${args.name}`;
        (tab as any).content = {
          hasClass: (c: string) => c === 'jp-Terminal',
          session: { name: args.name }
        };
        created.push(tab);
        return tab;
      }
    });

    // this window's card: terminal 1 has a row, from its kept tab, though that tab is stale
    if (!card(panel, 'w:default').classList.contains('jp-mod-open')) {
      triangle(panel, 'w:default').click();
    }
    const cardRow = Array.from(
      card(panel, 'w:default').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.title.startsWith('terminal 1'))!;
    cardRow.click();
    await settle();
    expect(app.shell.activateById).toHaveBeenCalledWith('new-1');
    expect(app.shell.activateById).not.toHaveBeenCalledWith('stale-1');

    // the TERMINALS section: the same rule, and no such tab exists for terminal 2 either
    const sectionRow = Array.from(
      openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.title.startsWith('terminal 2'))!;
    sectionRow.click();
    await settle();
    expect(app.shell.activateById).toHaveBeenCalledWith('new-2');
    expect(app.shell.activateById).not.toHaveBeenCalledWith('stale-2');
    // each row opened a tab, since no open tab of its terminal existed
    expect(created.map(t => t.id)).toEqual(['new-1', 'new-2']);
    expect(opened).toEqual([]);
  });

  it('ACC-TERM-216-TAB-KEPT: a row activates the tab it opened on every later click, until the terminal ends or the tab closes; then it opens a new tab', async () => {
    const created: Widget[] = [];
    const server = standard();
    // terminal 9 is in no workspace: its TERMINALS row opens a tab, not a workspace
    server.terminals.push({
      name: '9',
      last_activity: iso(0),
      process: 'htop'
    });
    const { panel, app } = await mount(server);
    // terminal:open would find a tab by name alone: the rows must not use it
    const opened: string[] = [];
    app.commands.addCommand('terminal:open', {
      execute: (args: any) => {
        opened.push(args.name);
      }
    });
    app.commands.addCommand('terminal:create-new', {
      execute: (args: any) => {
        const tab = new Widget();
        tab.id = `new-${created.length + 1}`;
        (tab as any).content = {
          hasClass: (c: string) => c === 'jp-Terminal',
          session: { name: args.name }
        };
        created.push(tab);
        return tab;
      }
    });
    const row = () =>
      Array.from(
        openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      ).find(r => r.title.startsWith('terminal 9'))!;

    row().click();
    await settle();
    expect(app.shell.activateById.mock.calls).toEqual([['new-1']]);
    // the first tab is no longer active: the row activates it again, opening no second tab
    row().click();
    await settle();
    expect(app.shell.activateById.mock.calls).toEqual([['new-1'], ['new-1']]);
    expect(created).toHaveLength(1);

    // the terminal ends: the kept tab's connection is disposed, so the row opens a new tab
    (created[0] as any).content.session.isDisposed = true;
    row().click();
    await settle();
    expect(created).toHaveLength(2);
    expect(app.shell.activateById.mock.calls.slice(-1)).toEqual([['new-2']]);

    // the tab closes: the row opens a new tab again
    created[1].dispose();
    row().click();
    await settle();
    expect(created).toHaveLength(3);
    expect(app.shell.activateById.mock.calls.slice(-1)).toEqual([['new-3']]);
    expect(opened).toEqual([]);
  });

  it('DEF-PANEL-76-TWO-TABS: a second click on a terminal row while its tab is opening joins the first and opens no second tab; once the opening settles, by success or failure, a call opens a tab again', async () => {
    const server = standard();
    server.terminals.push({
      name: '9',
      last_activity: iso(0),
      process: 'htop'
    });
    const { panel, app } = await mount(server);
    const opening: {
      resolve: (tab: Widget) => void;
      reject: (reason: Error) => void;
    }[] = [];
    app.commands.addCommand('terminal:create-new', {
      execute: () =>
        new Promise((resolve, reject) => opening.push({ resolve, reject }))
    });
    const row = () =>
      Array.from(
        openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      ).find(r => r.title.startsWith('terminal 9'))!;

    row().click();
    row().click();
    await settle();
    expect(opening).toHaveLength(1);

    const tab = new Widget();
    tab.id = 'new-1';
    (tab as any).content = {
      hasClass: (c: string) => c === 'jp-Terminal',
      session: { name: '9' }
    };
    opening[0].resolve(tab);
    await settle();
    expect(app.shell.activateById.mock.calls).toEqual([['new-1']]);

    // settled by success: the tab closes, and a call opens a tab; called
    // directly from here so the test holds the rejection
    tab.dispose();
    const open = () => (panel as any)._openTerminal('9') as Promise<void>;
    const failed = open();
    await settle();
    expect(opening).toHaveLength(2);

    // settled by failure: a call opens a tab
    opening[1].reject(new Error('refused'));
    await expect(failed).rejects.toThrow('refused');
    void open();
    await settle();
    expect(opening).toHaveLength(3);
  });

  it('ACC-PANEL-7-REFRESH-BUSY: the refresh button turns and waits for the requests, at least 500 ms', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const { panel, hold, release } = await mount(standard());
    const button = refreshButton(panel);
    expect(button.disabled).toBe(false);

    // requests answered at once: disabled and turning for 500 ms
    hold();
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.classList).toContain('jp-mod-spinning');
    release();
    await settle();
    jest.advanceTimersByTime(499);
    await settle();
    expect(button.disabled).toBe(true);
    expect(button.classList).toContain('jp-mod-spinning');
    jest.advanceTimersByTime(1);
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.classList).not.toContain('jp-mod-spinning');

    // requests held past 500 ms: disabled until they return
    hold();
    button.click();
    await settle();
    jest.advanceTimersByTime(800);
    await settle();
    expect(button.disabled).toBe(true);
    release();
    await settle();
    expect(button.disabled).toBe(false);
    expect(button.classList).not.toContain('jp-mod-spinning');
  });

  it('ACC-ACCORD-241-MANY-OPEN: a triangle opens or closes only its own card, and every other open card stays open', async () => {
    const server = standard();
    server.workspaces.push(workspace('third', 5));
    const { panel } = await mount(server);
    openSection(panel, 'workspaces');
    const open = (key: string) =>
      card(panel, key).classList.contains('jp-mod-open');
    const expanded = (key: string) =>
      triangle(panel, key).getAttribute('aria-expanded');

    triangle(panel, 'w:auto-6').click();
    triangle(panel, 'w:default').click();
    expect([open('w:auto-6'), open('w:default')]).toEqual([true, true]);
    expect([expanded('w:auto-6'), expanded('w:default')]).toEqual([
      'true',
      'true'
    ]);

    triangle(panel, 'w:auto-6').click();
    expect([open('w:auto-6'), open('w:default')]).toEqual([false, true]);
    expect([expanded('w:auto-6'), expanded('w:default')]).toEqual([
      'false',
      'true'
    ]);
  });

  it('ACC-PANEL-8-POLL: a visible panel reloads every 10 s without the turning icon and keeps the section scroll, the closed section, the focus, the selected row, the open cards and the menu', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel, reloads, hold, release } = await mount(server);
    expect(reloads()).toBe(1);

    hold();
    jest.advanceTimersByTime(10000);
    await settle();
    expect(reloads()).toBe(2);
    expect(refreshButton(panel).classList).not.toContain('jp-mod-spinning');
    expect(refreshButton(panel).disabled).toBe(false);
    release();
    await settle();

    // cards open, a row focused, the WORKSPACES list scrolled, KERNELS closed by default
    triangle(panel, 'w:auto-6').click();
    triangle(panel, 'w:default').click();
    const list = sectionBody(panel, 'workspaces');
    list.scrollTop = 40;
    expect(section(panel, 'kernels')!.textContent).not.toContain('k1');
    const row = card(panel, 'w:auto-6').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    row.focus();
    expect(document.activeElement).toBe(row);
    expect($$(panel, '.jp-mod-selected')).toEqual([row]);
    // the next reload brings a change: a second terminal in the open card
    server.workspaces[1] = workspace('auto-6', 0, [
      'terminal:1',
      'terminal:2',
      'editor:docs/README.md'
    ]);
    server.terminals.push({
      name: '2',
      last_activity: iso(0),
      process: 'fish'
    });
    jest.advanceTimersByTime(10000);
    await settle();
    expect(reloads()).toBe(3);
    expect(rowLabels(card(panel, 'w:auto-6'))).toContain('t2');
    expect(sectionBody(panel, 'workspaces')).toBe(list);
    expect(list.scrollTop).toBe(40);
    expect(sectionHeader(panel, 'kernels').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(section(panel, 'kernels')!.textContent).not.toContain('k1');
    expect(document.activeElement).toBe(row);
    expect($$(panel, '.jp-mod-selected')).toEqual([row]);
    expect(card(panel, 'w:auto-6').classList).toContain('jp-mod-open');
    expect(triangle(panel, 'w:auto-6').getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(card(panel, 'w:default').classList).toContain('jp-mod-open');
    expect(triangle(panel, 'w:default').getAttribute('aria-expanded')).toBe(
      'true'
    );

    // the ... menu open
    card(panel, 'w:auto-6')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    const menu = document.querySelector('.jp-WorkspaceManager-menu');
    expect(menu?.isConnected).toBe(true);
    jest.advanceTimersByTime(10000);
    await settle();
    expect(reloads()).toBe(4);
    expect(menu?.isConnected).toBe(true);
  });

  it('ACC-CLI-220-SWITCH-TAB: a switch request activates the tab showing its path in this window and selects its row', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const live = new Widget();
    (live as any).context = { path: 'docs/README.md' };
    live.title.label = 'README.md';
    const server = standard();
    const { panel, app } = await mount(server, { live: [live] });

    server.switches = [{ workspace: null, tab: 'docs/README.md' }];
    jest.advanceTimersByTime(1000);
    await settle();

    expect(app.shell.activateById).toHaveBeenCalledWith(live.id);
    expect(
      $$(panel, '.jp-WorkspaceManager-row.jp-mod-selected').map(
        r => r.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent
      )
    ).toEqual(['README.md']);
    // the card of this window shows, holding the selected row
    expect(card(panel, 'w:default').classList).toContain('jp-mod-open');

    // ACC-LISTS-260-ROW-LIT: the row stays lit while that tab is current, and no longer
    current(app, live);
    expect($$(panel, '.jp-mod-selected')).toHaveLength(1);
    current(app, new Widget());
    expect($$(panel, '.jp-mod-selected')).toEqual([]);
  });

  it('ACC-CLI-219-SWITCH-WORKSPACE: a plain switch for a workspace newer than the last reload is applied once, and a second read consumes nothing', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel, fake } = await mount(server);
    const pending =
      '@stellarshenson/jupyterlab-workspace-manager-extension:pending-tab';
    sessionStorage.removeItem(pending);
    // created after the panel's last reload: the panel's model does not list it
    server.workspaces.push(workspace('created-since', 1));
    // a hash keeps jsdom in the page: the test reads the switch, not the navigation
    let atUrl = -1;
    const url = jest.spyOn(panel as any, '_url').mockImplementation(() => {
      atUrl = fake.log.length;
      return '#switched-created-since';
    });

    server.switches = [{ workspace: 'created-since', tab: null }];
    jest.advanceTimersByTime(1000);
    await settle();

    expect(url).toHaveBeenCalledTimes(1);
    expect(url).toHaveBeenCalledWith('created-since');
    // the window published the target before its page left
    const posted = fake.log.indexOf(`POST /${NS}/presence`);
    expect(posted).toBeGreaterThanOrEqual(0);
    expect(posted).toBeLessThan(atUrl);
    // a plain switch stores no pending tab
    expect(sessionStorage.getItem(pending)).toBeNull();

    // the server marked the request delivered: the next read returns nothing and nothing moves again
    jest.advanceTimersByTime(1000);
    await settle();
    expect(url).toHaveBeenCalledTimes(1);
    expect(fake.log.filter(l => l.endsWith('/switch'))).toHaveLength(2);
  });

  it('ACC-CLI-219-SWITCH-WORKSPACE: a request naming a deleted workspace is dropped by the server and not delivered', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel } = await mount(server);
    const pending =
      '@stellarshenson/jupyterlab-workspace-manager-extension:pending-tab';
    sessionStorage.removeItem(pending);
    const url = jest.spyOn(panel as any, '_url');

    server.switches = [{ workspace: 'deleted-since', tab: 'docs/README.md' }];
    jest.advanceTimersByTime(1000);
    await settle();

    expect(url).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pending)).toBeNull();
    // not delivered and not marked read: the request still waits for a workspace of that name
    expect(server.switches).toEqual([
      { workspace: 'deleted-since', tab: 'docs/README.md' }
    ]);
  });

  it('ACC-CLI-219-SWITCH-WORKSPACE: a switch to a workspace another window shows is refused and stores no pending tab', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    server.presence = ['auto-6'];
    const { panel, app } = await mount(server);
    const pending =
      '@stellarshenson/jupyterlab-workspace-manager-extension:pending-tab';
    sessionStorage.removeItem(pending);
    const url = jest.spyOn(panel as any, '_url');

    server.switches = [{ workspace: 'auto-6', tab: 'docs/README.md' }];
    jest.advanceTimersByTime(1000);
    await settle();

    expect(url).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pending)).toBeNull();
    expect(app.shell.activateById).not.toHaveBeenCalled();
    try {
      expect(dialogBody()).toContain('is open in another browser window');
      expect(dialogBody()).toContain('workspace auto-6');
    } finally {
      await dismissDialog();
    }
  });

  it('ACC-CLI-219-SWITCH-WORKSPACE: a failed presence request leaves the window where it is, stores no pending tab and shows no refusal dialog', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    server.presenceFailing = true;
    const { panel } = await mount(server);
    const pending =
      '@stellarshenson/jupyterlab-workspace-manager-extension:pending-tab';
    sessionStorage.removeItem(pending);
    const url = jest.spyOn(panel as any, '_url');

    server.switches = [{ workspace: 'auto-6', tab: 'docs/README.md' }];
    jest.advanceTimersByTime(1000);
    await settle();

    expect(url).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pending)).toBeNull();
    expect(document.querySelector('.jp-Dialog')).toBeNull();
  });

  it('ACC-HIDDEN-53-UNHIDE: a reload that started before Show workspace again does not hide the card again', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    server.workspaces.push(workspace('fb-review', 5));
    server.records['fb-review'] = { colour: 'mint', hidden: true };
    const { panel, reloads, hold, release } = await mount(server);
    $(panel, 'button[aria-label="Show hidden workspaces"]')!.click();
    const hidden = () =>
      card(panel, 'w:fb-review').classList.contains('jp-mod-hiddenWorkspace');
    expect(hidden()).toBe(true);

    // a poll reaches the server while the workspace is hidden; its answers wait
    hold(['GET']);
    jest.advanceTimersByTime(10000);
    await settle();
    expect(reloads()).toBe(2);
    card(panel, 'w:fb-review')
      .querySelector<HTMLElement>('button[aria-label="Show workspace again"]')!
      .click();
    await settle();
    expect(server.records['fb-review'].hidden).toBe(false);
    expect(hidden()).toBe(false);

    // the poll's answers, older than the change, arrive; a reload after the change follows
    release();
    await settle();
    expect(reloads()).toBe(3);
    expect(hidden()).toBe(false);
  });

  it('ACC-PANEL-9-POLL-HIDDEN: a hidden panel stops its 10 s reload but keeps reading switch requests; shown, it reloads once', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const { panel, log, reloads } = await mount(standard());
    expect(reloads()).toBe(1);
    panel.hide();
    log.length = 0;
    jest.advanceTimersByTime(60000);
    await settle();
    // the switch poll ignores visibility; the 10 s reload does not
    expect(log.filter(l => !l.endsWith('/switch'))).toEqual([]);
    expect(log.some(l => l.endsWith('/switch'))).toBe(true);
    panel.show();
    await settle();
    expect(reloads()).toBe(1);
  });

  it('ACC-PANEL-95-SERVER-ABSENT: without the server extension the cards list workspaces, terminals by name and kernels', async () => {
    PageConfig.setOption('terminalsAvailable', 'true');
    const server = { ...standard(), absent: true };
    const { panel, log } = await mount(server);
    expect(log).toContain('GET /api/terminals');
    expect(card(panel, 'w:default')).toBeTruthy();
    expect(card(panel, 'w:auto-6')).toBeTruthy();
    triangle(panel, 'w:auto-6').click();
    const rows = $$(panel, '.jp-WorkspaceManager-row').map(r => r.textContent);
    expect(rows).toContain('t1now');
    expect(card(panel, 'w:auto-6').textContent).not.toContain('claude');
    expect(openSection(panel, 'kernels').textContent).toContain('k1');
  });

  it('ACC-PANEL-96-LOAD-ERROR, DEF-PANEL-2-PARTIAL-RELOAD: a failed list keeps its rows under one line naming it, the other lists update; the next good reload removes the line', async () => {
    const server = standard();
    const { panel } = await mount(server);
    expect(openSection(panel, 'kernels').textContent).toContain('k1');
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();

    // the kernel list fails while its kernel ends and a terminal starts
    server.failing = true;
    server.kernels = [];
    server.terminals.push({
      name: '9',
      last_activity: iso(0),
      process: 'htop'
    });
    await panel.refresh();
    const lines = $$(panel, '.jp-WorkspaceManager-error');
    expect(lines.map(l => l.textContent)).toEqual([
      'Reload failed: kernels (Unhandled error)'
    ]);
    // the KERNELS section keeps its last rows under the line
    expect(sectionBody(panel, 'kernels').textContent).toContain('k1');
    // the TERMINALS section lists the new terminal
    expect(rowLabels(openSection(panel, 'terminals'))).toContain('t9');

    server.failing = false;
    await panel.refresh();
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(sectionCount(panel, 'kernels')).toBe('(0)');
    expect(rowLabels(sectionBody(panel, 'terminals'))).toContain('t9');
  });

  it('ACC-CULLER-65-CULLED: a kernel list that answers 500 once, as jupyter_server does while a kernel starts, is asked again and shows no line', async () => {
    const server = standard();
    const { panel, log } = await mount(server);
    openSection(panel, 'kernels');

    server.failing = 'once';
    server.kernels.push({ ...server.kernels[0], id: 'k2', name: 'julia' });
    log.length = 0;
    await panel.refresh();
    expect(log.filter(l => l.endsWith('/api/kernels'))).toHaveLength(2);
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(sectionBody(panel, 'kernels').textContent).toContain('k2');
  });

  it('DEF-PANEL-1-REFRESH-STALE: a refresh pressed while a poll load is in flight shows data asked for after the press', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel, reloads, hold, release } = await mount(server);

    // a poll reaches the server; its answers wait
    hold();
    jest.advanceTimersByTime(10000);
    await settle();
    expect(reloads()).toBe(2);
    // a terminal starts after the poll asked, then refresh is pressed
    server.terminals.push({
      name: '9',
      last_activity: iso(0),
      process: 'htop'
    });
    refreshButton(panel).click();
    release();
    await settle();
    expect(reloads()).toBe(3);
    expect(rowLabels(openSection(panel, 'terminals'))).toContain('t9');
    jest.advanceTimersByTime(500);
    await settle();
    expect(refreshButton(panel).disabled).toBe(false);
  });

  it('DEF-PANEL-4-DELETED-REVIVED: Close all tabs on a card whose workspace was deleted since the last reload does not save it again', async () => {
    const server = standard();
    server.workspaces.push(workspace('W', 5, ['editor:a.md']));
    const { panel, log } = await mount(server);
    server.workspaces.pop();
    header(panel, 'w:W')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    chooseMenuItem(2); // Close all tabs
    await settle();
    expect(log).toContain('GET /lab/api/workspaces/W');
    expect(log.filter(l => l.startsWith('PUT'))).toEqual([]);
    expect($(panel, '[data-key="w:W"]')).toBeNull();
    // close the error: a dialog left open holds back every later one
    await dismissDialog();
  });

  it('ACC-ACCORD-71-COUNT-ICONS: the header counts carry tabIcon, the terminal glyph and kernelIcon', async () => {
    const { panel } = await mount(standard());
    triangle(panel, 'w:default').click();
    const icons = Array.from(
      header(panel, 'w:default').querySelectorAll(
        '.jp-WorkspaceManager-count svg'
      )
    ).map(svg => svg.getAttribute('data-icon'));
    expect(icons).toEqual([
      'ui-components:tab',
      '@stellarshenson/jupyterlab-workspace-manager-extension:terminal',
      'ui-components:kernel'
    ]);
  });

  it('ACC-PANEL-168-COUNT-BRACKETS, ACC-ACCORD-22-COUNTS, ACC-ACCORD-70-COUNT-TABS: a section count reads (N), a filtered card (N of M); the header icon counts stay bare and show while the card is open only', async () => {
    const { panel } = await mount(standard());
    expect(sectionCount(panel, 'workspaces')).toBe('(2)');
    expect(sectionCount(panel, 'kernels')).toBe('(1)');
    const counts = () =>
      Array.from(
        header(panel, 'w:auto-6').querySelectorAll('.jp-WorkspaceManager-count')
      ).map(c => c.textContent);
    // DQ-17: a closed card shows no counts
    expect(counts()).toEqual([]);

    triangle(panel, 'w:auto-6').click();
    expect(counts()).toEqual(['2', '1', '0']);
    // one flat list of the card's tabs, no group labels
    const rows = () =>
      Array.from(
        card(panel, 'w:auto-6').querySelectorAll(
          '.jp-WorkspaceManager-rowLabel'
        )
      ).map(r => r.textContent);
    expect(rows()).toEqual(['README.md', 't1']);
    expect($(panel, '.jp-WorkspaceManager-groupLabel')).toBeNull();

    $(panel, 'button[aria-label="Filter"]')!.click();
    const input = $(panel, '.jp-WorkspaceManager-filterInput')!;
    // React reads a typed value through the input event
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, 'claude');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(sectionCount(panel, 'workspaces')).toBe('(1)');
    expect(
      header(panel, 'w:auto-6').querySelector('.jp-WorkspaceManager-counts')!
        .textContent
    ).toBe('(1 of 2)');
  });

  it('ACC-KERNEL-156-DISPLAY-NAME, ACC-PANEL-168-COUNT-BRACKETS: a query that matches only a kernel shows its document row, and the filtered count counts the rows drawn', async () => {
    const server = standard();
    server.kernels = [
      {
        id: 'k1',
        name: 'julia-1.10',
        last_activity: iso(5),
        execution_state: 'idle',
        connections: 0
      }
    ];
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, [
      'terminal:1',
      'notebook:a.ipynb'
    ]);
    const { panel } = await mount(server);
    $(panel, 'button[aria-label="Filter"]')!.click();
    const input = $(panel, '.jp-WorkspaceManager-filterInput')!;
    // React reads a typed value through the input event
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, 'julia-1.10');
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // the kernel matches, so its notebook's tab is the one row drawn; no kernel row and no empty card
    const rows = card(panel, 'w:auto-6').querySelectorAll(
      '.jp-WorkspaceManager-row'
    );
    expect(rows).toHaveLength(1);
    expect(
      rows[0].querySelector('.jp-WorkspaceManager-rowLabel')!.textContent
    ).toBe('a.ipynb');
    expect(
      header(panel, 'w:auto-6').querySelector('.jp-WorkspaceManager-counts')!
        .textContent
    ).toBe('(1 of 2)');
  });

  it.each([
    [
      '6 terminal tabs and no document',
      ['1', '2', '3', '4', '5', '6'].map(n => `terminal:${n}`),
      ['6', '6', '0'],
      ['t1', 't2', 't3', 't4', 't5', 't6']
    ],
    [
      'documents and terminals',
      ['editor:a.md', 'editor:b.md', 'terminal:1'],
      ['3', '1', '0'],
      ['a.md', 'b.md', 't1']
    ],
    [
      'a key the layout repeats for a second New View of one document',
      ['editor:a.md', 'editor:a.md'],
      ['1', '0', '0'],
      ['a.md']
    ],
    [
      'a saved key of a terminal that no longer runs',
      ['terminal:1', 'terminal:2', 'terminal:ended'],
      ['2', '2', '0'],
      ['t1', 't2']
    ]
  ])(
    'ACC-ACCORD-70-COUNT-TABS: the tab count of a saved layout with %s',
    async (_, keys, shown, flat) => {
      const server = standard();
      server.workspaces[1] = workspace('auto-6', 60, keys);
      server.terminals = ['1', '2', '3', '4', '5', '6'].map(name => ({
        name,
        last_activity: iso(0),
        process: 'claude'
      }));
      const { panel } = await mount(server);
      triangle(panel, 'w:auto-6').click();
      expect(
        Array.from(
          header(panel, 'w:auto-6').querySelectorAll(
            '.jp-WorkspaceManager-count'
          )
        ).map(c => c.textContent)
      ).toEqual(shown);
      expect(
        Array.from(
          card(panel, 'w:auto-6').querySelectorAll(
            '.jp-WorkspaceManager-rowLabel'
          )
        ).map(l => l.textContent)
      ).toEqual(flat);
    }
  );

  it('ACC-ACCORD-101-PURPOSE-TEXT:a workspace name, a purpose, a terminal tab title, a process name, a file name and a folder holding markup show as text', async () => {
    const server = standard();
    server.records.default = { purpose: MARKUP };
    server.workspaces[0] = workspace('default', 1, [
      'terminal:1',
      `editor:${MARKUP}/${MARKUP}.md`
    ]);
    server.workspaces.push(workspace(MARKUP, 2));
    server.terminals[0].process = MARKUP;
    const terminal = new Widget();
    terminal.title.label = MARKUP;
    (terminal as any).content = {
      hasClass: () => true,
      session: { name: '1' }
    };
    const doc = new Widget();
    doc.title.label = `${MARKUP}.md`;
    (doc as any).context = { path: `${MARKUP}/${MARKUP}.md` };
    const { panel } = await mount(server, { live: [terminal, doc] });
    header(panel, 'w:default').click();

    expect(panel.node.querySelector('img')).toBeNull();
    expect(
      header(panel, `w:${MARKUP}`).querySelector('.jp-WorkspaceManager-name')!
        .textContent
    ).toBe(MARKUP);
    expect(
      header(panel, 'w:default').querySelector('.jp-WorkspaceManager-purpose')!
        .textContent
    ).toBe(MARKUP);
    const labels = $$(panel, '.jp-WorkspaceManager-rowLabel').map(
      l => l.textContent
    );
    expect(labels).toContain(`${MARKUP}.md`);
    // the folder of the document in its selected row's detail line, the process of the terminal in its row's line
    const rows = card(panel, 'w:default').querySelectorAll<HTMLElement>(
      '.jp-WorkspaceManager-row'
    );
    rows[0].focus();
    expect(
      $(panel, '.jp-mod-selected .jp-WorkspaceManager-rowDetail')!.textContent
    ).toBe(MARKUP);
    expect(
      rows[1].querySelector('.jp-WorkspaceManager-rowProcess')!.textContent
    ).toBe(MARKUP);
    expect(panel.node.querySelector('img')).toBeNull();
    const terminalRow = $$(panel, '.jp-WorkspaceManager-row').find(r =>
      r.title.startsWith('terminal 1\n')
    )!;
    expect(terminalRow.title).toBe(
      [
        'terminal 1',
        `Tab: ${MARKUP}`,
        `Process: ${MARKUP}`,
        activeNow(server.terminals[0]),
        'Workspaces: default, auto-6'
      ].join('\n')
    );
  });

  it('ACC-KERNEL-72-GLYPH, ACC-KERNEL-156-DISPLAY-NAME, ACC-KERNEL-48-ROW: a kernel row shows kernelIcon and, with no session, its id in the code font; selected, the display name of its kernelspec; its tooltip the display name and state', async () => {
    const { panel } = await mount(standard());
    const row = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    const label = row.querySelector('.jp-WorkspaceManager-rowLabel')!;
    expect(label.textContent).toBe('k1');
    expect(label.classList).toContain('jp-WorkspaceManager-code');
    expect(row.textContent).not.toContain(PYTHON);
    row.focus();
    expect(
      row.querySelector('.jp-WorkspaceManager-rowDetail > span')!.textContent
    ).toBe(PYTHON);
    expect(row.title).toBe(`${PYTHON}\nidle`);
    expect(
      row
        .querySelector('.jp-WorkspaceManager-rowIcon svg')!
        .getAttribute('data-icon')
    ).toBe('ui-components:kernel');
  });

  it('ACC-LISTS-209-ROW-LINE, ACC-TERM-42-PROCESS, ACC-KERNEL-49-STATE: an unselected tab, terminal or kernel row shows its name, a terminal its process, a kernel its state word, and the time only; a card document row shows its kernel state word and dot, in a card and in KERNELS', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'work/a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, [
      'editor:docs/README.md',
      'terminal:1',
      'notebook:work/a.ipynb'
    ]);
    server.resources = { k1: { memory: 150 * 2 ** 20, cpu: 12.6 } };
    const { panel } = await mount(server);
    triangle(panel, 'w:auto-6').click();
    const text = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
      ).map(r => r.textContent);
    expect(text(card(panel, 'w:auto-6'))).toEqual([
      'README.md',
      'a.ipynbidle5m ago',
      't1claudenow'
    ]);
    expect($(panel, '.jp-WorkspaceManager-rowDetail')).toBeNull();
    // a card document row: the state word in the line, the state span's title and the dot's aria-label
    const document = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.title === 'work/a.ipynb')!;
    const dot = document.querySelector('.jp-WorkspaceManager-dot')!;
    expect(
      document.querySelector('.jp-WorkspaceManager-state')!.textContent
    ).toBe('idle');
    expect(
      document
        .querySelector('.jp-WorkspaceManager-state')!
        .getAttribute('title')
    ).toBe('idle');
    expect(dot.getAttribute('role')).toBe('img');
    expect(dot.getAttribute('aria-label')).toBe('idle');
    expect(dot.classList).toContain('jp-mod-idle');
    // ACC-KERNEL-49-STATE: the word in the line, the title and the dot's aria-label
    const state = (root: HTMLElement) => {
      const row = root.querySelector<HTMLElement>('.jp-WorkspaceManager-row')!;
      const dot = row.querySelector('.jp-WorkspaceManager-dot')!;
      expect(row.querySelector('.jp-WorkspaceManager-state')!.textContent).toBe(
        'idle'
      );
      expect(row.title.split('\n')).toContain('idle');
      expect(dot.getAttribute('role')).toBe('img');
      expect(dot.getAttribute('aria-label')).toBe('idle');
      expect(dot.classList).toContain('jp-mod-idle');
    };
    // one section open at a time: KERNELS is opened, then TERMINALS
    expect(text(openSection(panel, 'kernels'))).toEqual(['a.ipynbidle5m ago']);
    state(sectionBody(panel, 'kernels'));
    expect(text(openSection(panel, 'terminals'))).toEqual(['t1claudenow']);
    // the kernel type, the path, the folder, memory and CPU wait for the selection
    for (const hidden of [PYTHON, 'docs', 'work/', 'MB', '%']) {
      expect(
        panel.node.querySelector('.jp-WorkspaceManager-list')!.textContent
      ).not.toContain(hidden);
    }
  });

  it('ACC-TERM-253-PATH-TOOLTIP: a terminal row with a path shows it after the process, inside a bdi, and its tooltip carries it on its Path line', async () => {
    const server = standard();
    server.terminals[0].cwd = '/home/lab/work';
    const { panel } = await mount(server);
    triangle(panel, 'w:auto-6').click();
    const row = $$(panel, '.jp-WorkspaceManager-row').find(r =>
      r.title.startsWith('terminal 1\n')
    )!;
    expect(row.title).toBe(
      [
        'terminal 1',
        'Process: claude',
        'Path: /home/lab/work',
        activeNow(server.terminals[0]),
        'Workspaces: auto-6'
      ].join('\n')
    );
    expect(row.textContent).toBe('t1claude/home/lab/worknow');
    expect(
      row.querySelector(
        '.jp-WorkspaceManager-rowProcess + .jp-WorkspaceManager-rowPathSlot > .jp-WorkspaceManager-rowPath > bdi'
      )!.textContent
    ).toBe('/home/lab/work');
  });

  it('ACC-TERM-256-PATH-UNREAD: a terminal with cwd null or no cwd shows its row and tooltip as before, with no path element; with no process the path stays out of the line and in the tooltip', async () => {
    const server = standard();
    server.terminals.push(
      { name: '2', last_activity: iso(0), process: 'bash', cwd: null },
      { name: '3', last_activity: iso(0), process: null, cwd: '/srv' }
    );
    server.workspaces[1] = workspace('auto-6', 60, [
      'terminal:1',
      'terminal:2',
      'terminal:3'
    ]);
    const { panel } = await mount(server);
    triangle(panel, 'w:auto-6').click();
    const rows = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    expect(rows.map(r => r.textContent)).toEqual([
      't1claudenow',
      't2bashnow',
      't3now'
    ]);
    const [one, two, three] = server.terminals.map(activeNow);
    expect(rows.map(r => r.title)).toEqual([
      `terminal 1\nProcess: claude\n${one}\nWorkspaces: auto-6`,
      `terminal 2\nProcess: bash\n${two}\nWorkspaces: auto-6`,
      `terminal 3\nPath: /srv\n${three}\nWorkspaces: auto-6`
    ]);
    expect($(panel, '.jp-WorkspaceManager-rowPath')).toBeNull();
  });

  it('ACC-TERM-259-TOOLTIP-DETAILS, ACC-TERM-261-TAB-NAME: a terminal row shows its tab name, and its tooltip holds its seven lines in order in a card and in TERMINALS; a line with no value is left out, and with no last activity the exact time', async () => {
    const server = standard();
    Object.assign(server.terminals[0], {
      process: 'vim',
      command: 'vim notes.md',
      cwd: '/srv/work'
    });
    server.terminals.push(
      { name: '2', last_activity: iso(0), process: 'bash' },
      { name: '3' }
    );
    server.workspaces[0] = workspace('default', 1, ['terminal:1']);
    const tab = (name: string, title: string) => {
      const widget = new Widget();
      widget.title.label = title;
      (widget as any).content = { hasClass: () => true, session: { name } };
      return widget;
    };
    const { panel } = await mount(server, {
      live: [tab('1', 'my tab'), tab('2', 'Terminal 2')]
    });
    triangle(panel, 'w:default').click();
    const rows = () =>
      Array.from(
        panel.node.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
      );
    const [one, two, three] = server.terminals.map(t => t.last_activity);
    const every = [
      'terminal 1',
      'Tab: my tab',
      'Process: vim',
      'Command: vim notes.md',
      'Path: /srv/work',
      activeNow({ last_activity: one })
    ];
    // this window's card: its own workspace first, then the other holder
    expect(rows().map(r => r.textContent)).toEqual([
      't1my tab/srv/worknow',
      't2bashnow'
    ]);
    expect(rows().map(r => r.title)).toEqual([
      [...every, 'Workspaces: default, auto-6'].join('\n'),
      // a default tab name says nothing, so the row falls back to the process and has no Tab line
      ['terminal 2', 'Process: bash', activeNow({ last_activity: two })]
        .concat('Workspaces: default')
        .join('\n')
    ]);
    openSection(panel, 'terminals');
    expect(rows().map(r => r.textContent)).toEqual([
      't1my tab/srv/worknow',
      't2bashnow',
      't3never'
    ]);
    expect(rows().map(r => r.title)).toEqual([
      [...every, 'Workspaces: default, auto-6'].join('\n'),
      ['terminal 2', 'Process: bash', activeNow({ last_activity: two })]
        .concat('Workspaces: default')
        .join('\n'),
      // no process, no last activity and no workspace
      'terminal 3\nLast activity: never'
    ]);
    expect(three).toBeUndefined();
  });

  it('ACC-TERM-259-TOOLTIP-DETAILS: a tab title and a command holding two percent signs and a space read in the tooltip as they do in the row and on the server', async () => {
    const server = standard();
    Object.assign(server.terminals[0], { command: 'echo 50%% done' });
    server.workspaces[0] = workspace('default', 1, ['terminal:1']);
    const tab = new Widget();
    tab.title.label = '50%% done';
    (tab as any).content = {
      hasClass: () => true,
      session: { name: '1' }
    };
    const { panel } = await mount(server, { live: [tab] });
    triangle(panel, 'w:default').click();
    const row = $(panel, '.jp-WorkspaceManager-row') as HTMLElement;
    expect(row.textContent).toBe('t150%% donenow');
    expect(row.title.split('\n').slice(0, 4)).toEqual([
      'terminal 1',
      'Tab: 50%% done',
      'Process: claude',
      'Command: echo 50%% done'
    ]);
  });

  it('ACC-TERM-259-TOOLTIP-DETAILS: a newline in a tab name, a process or a path leaves each on its one tooltip line, and a run of carriage returns and newlines reads as one space', async () => {
    const server = standard();
    Object.assign(server.terminals[0], {
      process: 'wm-x\ny',
      cwd: '/tmp/wm-fix-a\r\n\nb'
    });
    server.workspaces[0] = workspace('default', 1, ['terminal:1']);
    const tab = new Widget();
    tab.title.label = 'first\nsecond';
    (tab as any).content = {
      hasClass: () => true,
      session: { name: '1' }
    };
    const { panel } = await mount(server, { live: [tab] });
    triangle(panel, 'w:default').click();
    const row = $(panel, '.jp-WorkspaceManager-row') as HTMLElement;
    expect(row.title.split('\n')).toEqual([
      'terminal 1',
      'Tab: first second',
      'Process: wm-x y',
      'Path: /tmp/wm-fix-a b',
      activeNow(server.terminals[0]),
      'Workspaces: default, auto-6'
    ]);
  });

  it('ACC-LISTS-210-ROW-SELECT, ACC-TERM-42-PROCESS, ACC-TERM-44-PROCESS-UNREAD: a focused row is the one selected row and shows its detail line; the arrow keys move it; a terminal row has no detail line, its process shows once in its line, and with no readable process it shows none', async () => {
    const server = standard();
    server.terminals.push({ name: '2', last_activity: iso(0), process: null });
    server.workspaces[1] = workspace('auto-6', 60, [
      'editor:docs/README.md',
      'terminal:1',
      'terminal:2'
    ]);
    const { panel } = await mount(server);
    triangle(panel, 'w:auto-6').click();
    const rows = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    const selected = () => $$(panel, '.jp-mod-selected');
    const detail = () =>
      $(panel, '.jp-mod-selected .jp-WorkspaceManager-rowDetail')
        ?.textContent ?? null;
    rows[0].focus();
    expect(selected()).toEqual([rows[0]]);
    expect(detail()).toBe('docs');
    rows[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(rows[1]);
    expect(selected()).toEqual([rows[1]]);
    expect(detail()).toBeNull();
    expect(rows[1].textContent).toBe('t1claudenow');
    rows[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(selected()).toEqual([rows[2]]);
    expect(detail()).toBeNull();
    expect(rows[2].textContent).toBe('t2now');
    // a row of a section takes the selection from the card's row
    const listed = openSection(panel, 'terminals').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    listed.focus();
    expect(selected()).toEqual([listed]);
    expect(detail()).toBeNull();
    expect(listed.textContent).toBe('t1claudenow');
    // a reload keeps it while its item exists
    await panel.refresh();
    expect(selected()).toEqual([listed]);
    server.terminals = server.terminals.filter(t => t.name !== '1');
    await panel.refresh();
    expect(selected()).toEqual([]);
  });

  it('ACC-LISTS-260-ROW-LIT: a row of this window stays lit while its tab takes the focus and stays current; another tab takes the light away and going back by the tab bar does not return it', async () => {
    const other = liveTab('other.md');
    const { tab, input } = liveTab('notes.md');
    const { panel, app } = await mount(standard(), {
      live: [tab, other.tab]
    });
    current(app, other.tab);
    triangle(panel, 'w:default').click();
    const row = Array.from(
      card(panel, 'w:default').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.textContent!.startsWith('notes.md'))!;
    const selected = () => $$(panel, '.jp-mod-selected');

    row.focus();
    expect(selected()).toEqual([row]);
    // the focus lands in the tab while the shell still names the other tab
    input.focus();
    expect(app.shell.currentWidget).toBe(other.tab);
    expect(selected()).toEqual([row]);
    current(app, tab);
    expect(selected()).toEqual([row]);
    await panel.refresh();
    expect(selected()).toEqual([row]);

    // the shell's current tab follows the focus
    other.input.focus();
    current(app, other.tab);
    expect(selected()).toEqual([]);
    input.focus();
    current(app, tab);
    expect(selected()).toEqual([]);
  });

  it('ACC-LISTS-260-ROW-LIT: a row with no tab is lit while it holds the focus: a browser window losing the focus keeps the light, the focus leaving for an element or for nothing takes it away, the arrow keys still move it', async () => {
    const server = standard();
    server.kernels.push({ ...server.kernels[0], id: 'k2' });
    const { tab, input } = liveTab('notes.md');
    const { panel, app } = await mount(server, { live: [tab] });
    current(app, tab);
    const rows = Array.from(
      openSection(panel, 'kernels').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    );
    const selected = () => $$(panel, '.jp-mod-selected');

    rows[0].focus();
    expect(selected()).toEqual([rows[0]]);
    // a window that loses the focus: no target, and the row stays the active element
    rows[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(selected()).toEqual([rows[0]]);
    // the shell moves its current tab while the row holds the focus
    current(app, null);
    expect(selected()).toEqual([rows[0]]);

    rows[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(rows[1]);
    expect(selected()).toEqual([rows[1]]);

    input.focus();
    expect(selected()).toEqual([]);
    rows[1].focus();
    expect(selected()).toEqual([rows[1]]);
    rows[1].blur();
    expect(selected()).toEqual([]);
  });

  it('ACC-LISTS-260-ROW-LIT: a KERNELS row stays lit with its detail lines while the tab of its document is current, a tab its click opened included', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      path: 'eda.ipynb',
      name: 'eda.ipynb',
      type: 'notebook',
      kernel: { id: 'k1', name: 'python3' }
    });
    const other = liveTab('other.md');
    const live: Widget[] = [other.tab];
    const { panel, app } = await mount(server, { live });
    current(app, other.tab);
    const row = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    const selected = () => $$(panel, '.jp-mod-selected');
    row.focus();
    expect(selected()).toEqual([row]);

    // the tab opens after the panel's last render, and takes the focus
    const { tab, input } = liveTab('eda.ipynb', true);
    live.push(tab);
    input.focus();
    expect(selected()).toEqual([row]);
    current(app, tab);
    expect(selected()).toEqual([row]);
    expect(row.querySelector('.jp-WorkspaceManager-rowDetail')).not.toBeNull();

    other.input.focus();
    current(app, other.tab);
    expect(selected()).toEqual([]);
    expect(row.querySelector('.jp-WorkspaceManager-rowDetail')).toBeNull();
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: a selected KERNELS row shows the display name, the session path, the memory and the CPU, refreshed by the poll; figures the server cannot read show a dash; a kernel with no session shows no path; a card document row shows its file name, its kernel state word and dot, and age', async () => {
    const server = standard();
    server.kernels.push({
      ...server.kernels[0],
      id: 'k2',
      execution_state: 'busy'
    });
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'work/a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, ['notebook:work/a.ipynb']);
    server.resources = {
      k1: { memory: 150 * 2 ** 20, cpu: 12.6 },
      k2: { memory: null, cpu: null }
    };
    const { panel } = await mount(server);

    // each row selected in turn: its name, then the parts of its detail line
    const shown = () =>
      Array.from(
        openSection(panel, 'kernels').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      ).map(r => {
        r.focus();
        return [
          r.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent,
          ...Array.from(
            r.querySelectorAll('.jp-WorkspaceManager-rowDetail > span')
          ).map(x => x.textContent)
        ];
      });
    // the path on a second detail line
    openSection(panel, 'kernels');
    const row = $(panel, '[data-section="kernels"] .jp-WorkspaceManager-row')!;
    row.focus();
    expect(
      Array.from(row.querySelectorAll('.jp-WorkspaceManager-rowDetail')).map(
        d => d.textContent
      )
    ).toEqual([`${PYTHON}150 MB13%`, 'work/a.ipynb']);
    expect(
      row.querySelector('.jp-WorkspaceManager-rowDetail > span')!.className
    ).toBe('jp-mod-shrink jp-WorkspaceManager-type');
    expect(shown()).toEqual([
      ['a.ipynb', PYTHON, '150 MB', '13%', 'work/', 'a.ipynb'],
      ['k2', PYTHON, '-', '-']
    ]);

    server.resources.k1 = { memory: 3 * 2 ** 30, cpu: 0.2 };
    await panel.refresh();
    expect(shown()[0]).toEqual([
      'a.ipynb',
      PYTHON,
      '3.0 GB',
      '0%',
      'work/',
      'a.ipynb'
    ]);

    openSection(panel, 'workspaces');
    triangle(panel, 'w:auto-6').click();
    const cardRow = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.title === 'work/a.ipynb')!;
    expect(cardRow.textContent).toBe('a.ipynbidle5m ago');
    cardRow.focus();
    const cardDetail = cardRow.querySelector(
      '.jp-WorkspaceManager-rowDetail > span'
    )!;
    expect(cardDetail.className).toBe('jp-WorkspaceManager-code');
    expect(cardDetail.textContent).toBe('work');
  });

  it('ACC-LISTS-37-TWO-WORKSPACES, ACC-KERNEL-196-KERNEL-DETAILS: no terminal or kernel row, in a section or a card, shows an also in mark; the hover text of a kernel or a tab names no other workspace, and that of a terminal lists every holder', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      name: 'a.ipynb',
      path: 'a.ipynb',
      type: 'notebook',
      kernel: server.kernels[0]
    });
    server.workspaces[1] = workspace('auto-6', 60, [
      'terminal:1',
      'notebook:a.ipynb'
    ]);
    server.workspaces.push(
      workspace('auto-7', 30, ['terminal:1', 'notebook:a.ipynb'])
    );
    const { panel } = await mount(server);

    const kernel = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    expect(kernel.title).toBe(`${PYTHON}\na.ipynb\nidle`);
    const terminal = openSection(panel, 'terminals').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    openSection(panel, 'workspaces');
    triangle(panel, 'w:auto-6').click();
    const rows = [
      kernel,
      terminal,
      ...Array.from(
        card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
    ];
    expect(rows.map(r => r.title.split('\n')[0])).toEqual([
      PYTHON,
      'terminal 1',
      'a.ipynb',
      'terminal 1'
    ]);
    for (const r of rows) {
      expect(r.textContent).not.toContain('also in');
      expect(r.title).not.toContain('also in');
    }
    const [kernelRow, listed, tab, inCard] = rows;
    expect(kernelRow.title).not.toContain('auto-7');
    expect(tab.title).not.toContain('auto-7');
    // ACC-TERM-259-TOOLTIP-DETAILS: the terminal's own Workspaces line
    for (const r of [listed, inCard]) {
      expect(r.title.split('\n').pop()).toBe('Workspaces: auto-6, auto-7');
    }
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS, ACC-LISTS-109-CONSOLE: a console KERNELS row is named by the console name, not the generated session path, also in its detail line', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      name: 'Console 1',
      path: 'dir/console-1-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
      type: 'console',
      kernel: server.kernels[0]
    });
    const { panel } = await mount(server);
    const row = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    expect(
      row.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent
    ).toBe('Console 1');
    row.focus();
    expect(
      Array.from(
        row.querySelectorAll('.jp-WorkspaceManager-rowDetail > span')
      ).map(x => x.textContent)
    ).toEqual([PYTHON, '-', '-', 'dir/', 'Console 1']);
    expect(row.textContent).not.toContain('console-1-');
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: a failed read of memory and CPU after a good one shows dashes, and Shut down all in KERNELS and TERMINALS still shuts down', async () => {
    const server = standard();
    server.resources = { k1: { memory: 150 * 2 ** 20, cpu: 12.6 } };
    const { panel, app } = await mount(server);
    const figures = () => {
      openSection(panel, 'kernels')
        .querySelector<HTMLElement>('.jp-WorkspaceManager-row')!
        .focus();
      return $$(
        panel,
        '.jp-mod-selected .jp-WorkspaceManager-rowDetail > span'
      ).map(x => x.textContent);
    };
    expect(figures()).toEqual([PYTHON, '150 MB', '13%']);

    server.resourcesFailing = true;
    await panel.refresh();
    expect(figures()).toEqual([PYTHON, '-', '-']);
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();

    for (const key of ['kernels', 'terminals']) {
      openSection(panel, key);
      shutDownAll(panel, key).click();
      await waitForDialog();
      await dangerDialog();
      await settle();
    }
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([['k1']]);
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([['1']]);
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
  });

  it('ACC-KERNEL-199-SHUTDOWN-SHARED: Shut down kernel on a kernel another workspace holds asks first and names that workspace, Cancel keeps it; a kernel no other workspace holds stops at once', async () => {
    const server = standard();
    server.kernels.push({ ...server.kernels[0], id: 'k2' });
    server.sessions.push(
      {
        id: 's1',
        name: 'a.ipynb',
        path: 'a.ipynb',
        type: 'notebook',
        kernel: server.kernels[0]
      },
      {
        id: 's2',
        name: 'b.ipynb',
        path: 'b.ipynb',
        type: 'notebook',
        kernel: server.kernels[1]
      }
    );
    // k1 of a.ipynb in auto-6 and auto-7; k2 of b.ipynb in auto-6 alone
    server.workspaces[1] = workspace('auto-6', 60, [
      'notebook:a.ipynb',
      'notebook:b.ipynb'
    ]);
    server.workspaces.push(workspace('auto-7', 30, ['notebook:a.ipynb']));
    const { panel, app } = await mount(server);
    openSection(panel, 'workspaces');
    triangle(panel, 'w:auto-6').click();
    const shutDown = (
      path: string,
      root = card(panel, 'w:auto-6'),
      // a card document row lists Close tab, Detach from workspace and Move to workspace first; a KERNELS row its one action
      index = 3
    ) => {
      Array.from(root.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row'))
        .find(r => r.title === path || r.title === `${PYTHON}\n${path}\nidle`)!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      chooseMenuItem(index); // Shut down kernel
    };

    shutDown('a.ipynb');
    await waitForDialog();
    expect(dialogText()).toContain(`Shut down kernel ${PYTHON}?`);
    expect(dialogText()).toContain('Workspace auto-7 also holds this kernel.');
    await dismissDialog();
    await settle();
    expect(app.serviceManager.kernels.shutdown).not.toHaveBeenCalled();

    shutDown('a.ipynb');
    await dangerDialog();
    await settle();
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([['k1']]);

    shutDown('b.ipynb');
    await settle();
    expect(dialogText()).toBeUndefined();
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([
      ['k1'],
      ['k2']
    ]);

    // the same kernel from the KERNELS section: auto-6 alone holds it
    shutDown('b.ipynb', openSection(panel, 'kernels'), 0);
    await settle();
    expect(dialogText()).toBeUndefined();
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([
      ['k1'],
      ['k2'],
      ['k2']
    ]);

    // the shared kernel from the KERNELS section: neither holder is this window's, both are named
    shutDown('a.ipynb', openSection(panel, 'kernels'), 0);
    await waitForDialog();
    const text = dialogText();
    await dismissDialog(); // before the assertion, so a failure leaves no dialog open
    expect(text).toContain('Workspaces auto-6 and auto-7 hold this kernel.');
  });

  it('ACC-TERM-112-SHUTDOWN-SHARED: Shut down terminal from the TERMINALS section on a terminal one workspace holds stops at once; on a terminal two other workspaces hold it names both', async () => {
    const server = standard();
    server.terminals.push(
      ...['2', '3', '4'].map(name => ({
        name,
        last_activity: iso(0),
        process: 'bash'
      }))
    );
    // terminal 3 in this window's workspace and auto-7; terminal 4 in auto-6, auto-7 and auto-8
    server.workspaces[0] = workspace('default', 1, ['terminal:3']);
    server.workspaces[1] = workspace('auto-6', 60 * 24 * 3, [
      'terminal:1',
      'editor:docs/README.md',
      'terminal:4'
    ]);
    server.workspaces.push(
      workspace('auto-7', 30, ['terminal:2', 'terminal:3', 'terminal:4']),
      workspace('auto-8', 20, ['terminal:2', 'terminal:4'])
    );
    const shown = new Widget();
    (shown as any).content = { hasClass: () => true, session: { name: '3' } };
    const { panel, app } = await mount(server, { live: [shown] });
    // by name: a terminal shut down leaves the section
    const shutDown = (name: string) => {
      Array.from(
        openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
        .find(r => r.title.startsWith(`terminal ${name}\n`))!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      chooseMenuItem(0); // Shut down terminal
    };
    // terminal 1, held by auto-6 alone
    shutDown('1');
    await settle();
    expect(dialogText()).toBeUndefined();
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([['1']]);

    // terminal 2, held by auto-7 and auto-8, neither this window's
    shutDown('2');
    await waitForDialog();
    const text = dialogText();
    await dismissDialog(); // before the assertion, so a failure leaves no dialog open
    expect(text).toContain('Workspaces auto-7 and auto-8 hold this terminal.');

    // terminal 3, held by this window's workspace and auto-7: only auto-7 is named
    shutDown('3');
    await waitForDialog();
    const shared = dialogBody();
    await dismissDialog();
    expect(shared).toBe('Workspace auto-7 also holds this terminal.');

    // terminal 4 from auto-6's card: the two other holders are named
    openSection(panel, 'workspaces');
    triangle(panel, 'w:auto-6').click();
    Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    )
      .find(r => r.title.startsWith('terminal 4\n'))!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(3); // Stop terminal, after Close tab, Detach from workspace and Move to workspace
    await waitForDialog();
    const three = dialogBody();
    await dismissDialog();
    expect(three).toBe('Workspaces auto-7 and auto-8 also hold this terminal.');
  });

  it('EDGE-ROW-MENU ACC-LISTS-265-MENU-ENTRIES: a card document row lists Close tab, Detach from workspace, Move to workspace then Shut down kernel, naming each kernel when the document runs more than one; a plain document row lists Close tab then Move to workspace; a terminal row lists Close tab, Detach from workspace, Move to workspace then Stop terminal', async () => {
    const server = standard();
    server.kernels.push({ ...server.kernels[0], id: 'k2', name: 'ir' });
    server.sessions.push(
      {
        id: 's1',
        name: 'a.ipynb',
        path: 'a.ipynb',
        type: 'notebook',
        kernel: server.kernels[0]
      },
      {
        id: 's2',
        name: 'a.ipynb',
        path: 'a.ipynb',
        type: 'notebook',
        kernel: server.kernels[1]
      }
    );
    server.workspaces[1] = workspace('auto-6', 60, [
      'notebook:a.ipynb',
      'editor:plain.txt',
      'terminal:1'
    ]);
    const { panel, app, log } = await mount(server);
    openSection(panel, 'workspaces');
    if (!card(panel, 'w:auto-6').classList.contains('jp-mod-open')) {
      triangle(panel, 'w:auto-6').click();
    }
    const rows = () =>
      Array.from(
        card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      );
    const open = (title: string) => {
      rows()
        .find(r => r.title.split('\n')[0] === title)!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    };
    /** The danger entries of the open menu. */
    const danger = () =>
      Array.from(
        document.querySelectorAll(
          '.jp-WorkspaceManager-menu .lm-Menu-item.jp-WorkspaceManager-danger .lm-Menu-itemLabel'
        )
      ).map(l => l.textContent);

    // the document runs two kernels: each entry names its kernel
    open('a.ipynb');
    expect(menuLabels()).toEqual([
      'Close tab',
      'Detach from workspace',
      'Move to workspace',
      `Shut down kernel ${PYTHON}`,
      'Shut down kernel ir'
    ]);
    expect(danger()).toEqual([
      `Shut down kernel ${PYTHON}`,
      'Shut down kernel ir'
    ]);
    chooseMenuItem(3);
    await settle();
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([['k1']]);

    // no process stays behind a plain document: no Detach
    open('plain.txt');
    expect(menuLabels()).toEqual(['Close tab', 'Move to workspace']);
    expect(danger()).toEqual([]);
    pressKey(document.querySelector('.jp-WorkspaceManager-menu')!, 27); // Escape

    // the terminal tab: Stop terminal last
    open('terminal 1');
    expect(menuLabels()).toEqual([
      'Close tab',
      'Detach from workspace',
      'Move to workspace',
      'Stop terminal'
    ]);
    expect(danger()).toEqual(['Stop terminal']);
    chooseMenuItem(3); // Stop terminal
    await settle();
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([['1']]);

    log.length = 0;
    open('terminal 1');
    chooseMenuItem(0); // Close tab
    await settle();
    expect(log.filter(l => l.startsWith('PUT'))).toEqual([
      'PUT /lab/api/workspaces/auto-6'
    ]);
  });

  describe('Detach and Move to workspace', () => {
    /** A live terminal tab of this window. */
    const liveTerminal = (name: string) => {
      const tab = new Widget();
      const content = {
        hasClass: () => true,
        session: { name },
        setOption: jest.fn()
      };
      (tab as any).content = content;
      return { tab, content, close: jest.spyOn(tab, 'close') };
    };
    /** A live notebook of this window with a kernel preference. */
    const liveNotebook = (path: string) => {
      const tab = liveTab(path, true).tab;
      const kernelPreference = { name: 'python3', shutdownOnDispose: true };
      const sessionContext = { path, kernelPreference };
      (tab as any).sessionContext = sessionContext;
      return { tab, sessionContext, close: jest.spyOn(tab, 'close') };
    };
    /** auto-6 holding a document and terminal 1, and this window's workspace holding `keys`; every workspace has saved. */
    const three = (keys: string[] = []) => {
      const server = standard();
      server.workspaces[0] = workspace('default', 1, keys);
      server.workspaces.push(workspace('auto-7', 30));
      return server;
    };
    const open = (panel: Widget, id: string, name: string) => {
      if (!card(panel, `w:${id}`).classList.contains('jp-mod-open')) {
        triangle(panel, `w:${id}`).click();
      }
      Array.from(
        card(panel, `w:${id}`).querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
        .find(r => r.title.split('\n')[0] === name)!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    };
    const saves = (log: string[]) => log.filter(l => l.startsWith('PUT'));
    const keysOf = (server: IServer, id: string) =>
      Object.keys(server.saved![id].data);

    it("ACC-LISTS-266-DETACH: on this window's card the guards go on before the close, keeping the other fields; nothing is saved", async () => {
      const terminal = liveTerminal('1');
      const notebook = liveNotebook('a.ipynb');
      const server = three();
      server.sessions.push({
        id: 's1',
        name: 'a.ipynb',
        path: 'a.ipynb',
        type: 'notebook',
        kernel: server.kernels[0]
      });
      const { panel, log } = await mount(server, {
        live: [terminal.tab, notebook.tab]
      });
      log.length = 0;

      open(panel, 'default', 'terminal 1');
      expect(menuLabels()[1]).toBe('Detach from workspace');
      chooseMenuItem(1);
      await settle();
      expect(terminal.content.setOption.mock.calls).toEqual([
        ['shutdownOnClose', false]
      ]);
      expect(terminal.close).toHaveBeenCalledTimes(1);
      expect(
        terminal.content.setOption.mock.invocationCallOrder[0]
      ).toBeLessThan(terminal.close.mock.invocationCallOrder[0]);

      open(panel, 'default', 'a.ipynb');
      chooseMenuItem(1);
      await settle();
      expect(notebook.sessionContext.kernelPreference).toEqual({
        name: 'python3',
        shutdownOnDispose: false
      });
      expect(notebook.close).toHaveBeenCalledTimes(1);
      expect(saves(log)).toEqual([]);
    });

    it("ACC-LISTS-266-DETACH: Close tab sets no guard: the lab's setting decides", async () => {
      const terminal = liveTerminal('1');
      const { panel } = await mount(three(), { live: [terminal.tab] });
      open(panel, 'default', 'terminal 1');
      chooseMenuItem(0); // Close tab
      await settle();
      expect(terminal.close).toHaveBeenCalledTimes(1);
      expect(terminal.content.setOption).not.toHaveBeenCalled();
    });

    it("ACC-LISTS-266-DETACH: on another workspace's card it removes the tab from the saved layout and stops nothing", async () => {
      const server = three();
      const { panel, app, log } = await mount(server);
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      chooseMenuItem(1);
      await settle();
      expect(saves(log)).toEqual(['PUT /lab/api/workspaces/auto-6']);
      expect(keysOf(server, 'auto-6')).not.toContain('terminal:1');
      expect(app.serviceManager.terminals.shutdown).not.toHaveBeenCalled();
    });

    it('ACC-LISTS-266-DETACH: it is refused as Close tab is when another window shows the workspace or presence is unknown', async () => {
      // without the server extension the terminals come from /api/terminals, listed only when the page allows terminals
      const terminals = PageConfig.setOption('terminalsAvailable', 'true');
      try {
        const shown = { ...three(), presence: ['auto-6'] };
        const first = await mount(shown);
        first.log.length = 0;
        open(first.panel, 'auto-6', 'terminal 1');
        chooseMenuItem(1);
        await waitForDialog();
        expect(dialogText()).toContain(
          'Detach from workspace is refused: workspace auto-6 is open in another browser window.'
        );
        await dismissDialog();
        await settle();
        expect(saves(first.log)).toEqual([]);

        const absent = await mount({ ...three(), absent: true });
        absent.log.length = 0;
        open(absent.panel, 'auto-6', 'terminal 1');
        chooseMenuItem(1);
        await waitForDialog();
        expect(dialogText()).toContain(
          'Detach from workspace is refused: the server extension is not available'
        );
        await dismissDialog();
        await settle();
        expect(saves(absent.log)).toEqual([]);
      } finally {
        PageConfig.setOption('terminalsAvailable', terminals);
      }
    });

    it('ACC-LISTS-267-MOVE-MENU: the submenu lists the other shown workspaces in panel order, without the hidden ones, the eye on or off', async () => {
      const server = three();
      server.workspaces.push(workspace('auto-8', 20));
      server.records['auto-8'] = { hidden: true };
      server.records['default'] = { position: 2 };
      server.records['auto-6'] = { ...server.records['auto-6'], position: 0 };
      server.records['auto-7'] = { position: 1 };
      const { panel } = await mount(server);
      const submenu = () => {
        open(panel, 'auto-6', 'terminal 1');
        chooseMenuItem(2);
        const menus = document.querySelectorAll('.jp-WorkspaceManager-menu');
        const labels = Array.from(
          menus[menus.length - 1].querySelectorAll('.lm-Menu-itemLabel')
        ).map(l => l.textContent);
        pressKey(menus[menus.length - 1], 27); // Escape
        pressKey(menus[0], 27);
        return labels;
      };
      expect(submenu()).toEqual(['auto-7', 'default']);
      $(panel, 'button[aria-label="Show hidden workspaces"]')!.click();
      expect(submenu()).toEqual(['auto-7', 'default']);
    });

    it('ACC-LISTS-267-MOVE-MENU: with nothing to list the entry shows disabled, a plain item', async () => {
      const terminal = liveTerminal('1');
      const server = standard();
      server.records['auto-6'].hidden = true;
      const { panel } = await mount(server, { live: [terminal.tab] });
      open(panel, 'default', 'terminal 1');
      expect(menuLabels()[2]).toBe('Move to workspace');
      const item = document.querySelectorAll(
        '.jp-WorkspaceManager-menu .lm-Menu-item'
      )[2];
      expect(item.classList).toContain('lm-mod-disabled');
      expect(item.getAttribute('data-type')).toBe('command');
      pressKey(document.querySelector('.jp-WorkspaceManager-menu')!, 27); // Escape
    });

    it('ACC-LISTS-268-MOVE-TAB: another workspace to another workspace saves the target first, then the source; the entry keeps its shape', async () => {
      const server = three();
      const { panel, log } = await mount(server);
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      moveTo(2, 'auto-7');
      await settle();
      expect(saves(log)).toEqual([
        'PUT /lab/api/workspaces/auto-7',
        'PUT /lab/api/workspaces/auto-6'
      ]);
      expect(server.saved!['auto-7'].data['terminal:1']).toEqual({
        data: { name: '1' }
      });
      expect(
        server.saved!['auto-7'].data['layout-restorer:data'].main.dock.widgets
      ).toEqual(['terminal:1']);
      expect(keysOf(server, 'auto-6')).not.toContain('terminal:1');
      expect(keysOf(server, 'auto-6')).toContain('editor:docs/README.md');
    });

    it('ACC-LISTS-268-MOVE-TAB: a failed source save leaves the tab in both workspaces', async () => {
      const server = { ...three(), saveFailing: 'auto-6' };
      const { panel, log } = await mount(server);
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      moveTo(2, 'auto-7');
      await waitForDialog();
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([
        'PUT /lab/api/workspaces/auto-7',
        'PUT /lab/api/workspaces/auto-6'
      ]);
      expect(keysOf(server, 'auto-7')).toContain('terminal:1');
      expect(server.saved!['auto-6']).toBeUndefined();
    });

    it('ACC-LISTS-268-MOVE-TAB: a failed target save leaves the source alone', async () => {
      const server = { ...three(), saveFailing: 'auto-7' };
      const { panel, log } = await mount(server);
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      moveTo(2, 'auto-7');
      await waitForDialog();
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual(['PUT /lab/api/workspaces/auto-7']);
    });

    it('ACC-LISTS-268-MOVE-TAB: this window to another workspace saves the target, then closes the live tab with the guard; this window is not saved', async () => {
      const terminal = liveTerminal('1');
      const server = three(['terminal:1']);
      const { panel, log } = await mount(server, { live: [terminal.tab] });
      log.length = 0;
      // the close goes into the request log, so the log holds the calls in order
      terminal.close.mockImplementation(() => {
        log.push('close terminal 1');
        Widget.prototype.close.call(terminal.tab);
      });
      open(panel, 'default', 'terminal 1');
      moveTo(2, 'auto-7');
      await settle();
      expect(
        log.filter(l => l.startsWith('PUT') || l.startsWith('close'))
      ).toEqual(['PUT /lab/api/workspaces/auto-7', 'close terminal 1']);
      expect(keysOf(server, 'auto-7')).toContain('terminal:1');
      expect(terminal.content.setOption).toHaveBeenCalledWith(
        'shutdownOnClose',
        false
      );
      expect(terminal.close).toHaveBeenCalledTimes(1);
    });

    it('ACC-LISTS-268-MOVE-TAB: a live document moves by its saved key, which differs from its live key', async () => {
      const { tab } = liveTab('docs/a.txt');
      const close = jest.spyOn(tab, 'close');
      const server = three(['editor:docs/a.txt']);
      server.workspaces[0].data['editor:docs/a.txt'].data.factory = 'Editor';
      const { panel } = await mount(server, { live: [tab] });
      open(panel, 'default', 'docs/a.txt');
      moveTo(1, 'auto-7');
      await settle();
      expect(server.saved!['auto-7'].data['editor:docs/a.txt']).toEqual({
        data: { path: 'docs/a.txt', factory: 'Editor' }
      });
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('ACC-LISTS-268-MOVE-TAB: another workspace to this window opens the terminal live, then saves the source; this window is not saved', async () => {
      const server = three();
      const { panel, app, log } = await mount(server);
      const view = new Widget();
      view.id = 'opened-terminal';
      const created = jest.fn(async () => view);
      app.commands.addCommand('terminal:create-new', {
        execute: created,
        describedBy: { args: null }
      });
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      moveTo(2, 'default');
      await settle();
      expect(created).toHaveBeenCalledWith({ name: '1' });
      expect(app.shell.activateById).toHaveBeenCalledWith('opened-terminal');
      expect(saves(log)).toEqual(['PUT /lab/api/workspaces/auto-6']);
      expect(keysOf(server, 'auto-6')).not.toContain('terminal:1');
    });

    it('ACC-LISTS-268-MOVE-TAB: another workspace to this window opens the document live with the path and factory of its entry', async () => {
      const server = three();
      server.workspaces[1].data['editor:docs/README.md'].data.factory =
        'Editor';
      const { panel, app, log } = await mount(server);
      const opened = jest.fn(async () => new Widget());
      app.commands.addCommand('docmanager:open', {
        execute: opened,
        describedBy: { args: null }
      });
      log.length = 0;
      open(panel, 'auto-6', 'docs/README.md');
      moveTo(1, 'default');
      await settle();
      expect(opened).toHaveBeenCalledWith({
        path: 'docs/README.md',
        factory: 'Editor'
      });
      expect(saves(log)).toEqual(['PUT /lab/api/workspaces/auto-6']);
    });

    it('ACC-LISTS-268-MOVE-TAB: a tab this window cannot open stays in its workspace', async () => {
      const server = three();
      const { panel, app, log } = await mount(server);
      app.commands.addCommand('docmanager:open', {
        execute: async () => undefined,
        describedBy: { args: null }
      });
      log.length = 0;
      open(panel, 'auto-6', 'docs/README.md');
      moveTo(1, 'default');
      await waitForDialog();
      expect(dialogText()).toContain(
        'This window cannot open editor:docs/README.md.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
    });

    it('DEF-PANEL-80-MOVE-CONSOLE: a console from another workspace to this window opens by console:create with its saved data, never as a document, then the source is saved without it', async () => {
      const server = three();
      server.workspaces[1] = workspace('auto-6', 60, ['console:docs/a.ipynb']);
      server.workspaces[1].data['console:docs/a.ipynb'].data = {
        path: 'docs/a.ipynb',
        name: 'Console 1',
        kernelPreference: {}
      };
      const { panel, app, log } = await mount(server);
      const opened = jest.fn(async () => new Widget());
      const created = jest.fn(async () => new Widget());
      app.commands.addCommand('docmanager:open', {
        execute: opened,
        describedBy: { args: null }
      });
      app.commands.addCommand('console:create', {
        execute: created,
        describedBy: { args: null }
      });
      log.length = 0;
      open(panel, 'auto-6', 'docs/a.ipynb');
      moveTo(1, 'default');
      await settle();
      expect(created).toHaveBeenCalledWith({
        path: 'docs/a.ipynb',
        name: 'Console 1',
        kernelPreference: {}
      });
      expect(opened).not.toHaveBeenCalled();
      expect(saves(log)).toEqual(['PUT /lab/api/workspaces/auto-6']);
      expect(keysOf(server, 'auto-6')).not.toContain('console:docs/a.ipynb');
    });

    it('ACC-LISTS-268-MOVE-TAB: a target deleted since the last reload is not saved again and the source stays', async () => {
      const server = three();
      const { panel, log } = await mount(server);
      server.workspaces.pop();
      log.length = 0;
      open(panel, 'auto-6', 'terminal 1');
      moveTo(2, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain('Workspace auto-7 no longer exists');
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
    });

    it('ACC-LISTS-269-MOVE-REFUSED: another window on the target or on the source refuses and saves nothing', async () => {
      for (const shown of ['auto-7', 'auto-6']) {
        const { panel, log } = await mount({
          ...three(),
          presence: [shown]
        });
        log.length = 0;
        open(panel, 'auto-6', 'terminal 1');
        moveTo(2, 'auto-7');
        await waitForDialog();
        expect(dialogText()).toContain(
          `Move to workspace is refused: workspace ${shown} is open in another browser window.`
        );
        await dismissDialog();
        await settle();
        expect(saves(log)).toEqual([]);
      }
    });

    it('ACC-LISTS-269-MOVE-REFUSED: presence unknown refuses and saves nothing', async () => {
      // without the server extension the terminals come from /api/terminals, listed only when the page allows terminals
      const terminals = PageConfig.setOption('terminalsAvailable', 'true');
      try {
        const { panel, log } = await mount({ ...three(), absent: true });
        log.length = 0;
        open(panel, 'auto-6', 'terminal 1');
        moveTo(2, 'auto-7');
        await waitForDialog();
        expect(dialogText()).toContain(
          'Move to workspace is refused: the server extension is not available'
        );
        await dismissDialog();
        await settle();
        expect(saves(log)).toEqual([]);
      } finally {
        PageConfig.setOption('terminalsAvailable', terminals);
      }
    });

    it('ACC-LISTS-269-MOVE-REFUSED: a tab not in the saved record is refused, the entry is never made up', async () => {
      const terminal = liveTerminal('1');
      const { panel, log } = await mount(three(), { live: [terminal.tab] });
      log.length = 0;
      open(panel, 'default', 'terminal 1');
      moveTo(2, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain(
        'Move to workspace is refused: workspace default has not saved this tab yet, or has saved more than one tab of its file.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
      expect(terminal.close).not.toHaveBeenCalled();
    });

    it('DEF-PANEL-79-MOVE-PATH: a live key that matches neither of two saved tabs of its path is refused as a tab not in the saved record; nothing is saved or closed', async () => {
      const { tab } = liveTab('docs/a.md');
      const close = jest.spyOn(tab, 'close');
      const server = three(['editor:docs/a.md', 'markdownviewer:docs/a.md']);
      server.workspaces[0].data['editor:docs/a.md'].data.factory = 'Editor';
      server.workspaces[0].data['markdownviewer:docs/a.md'].data.factory =
        'Markdown Preview';
      const { panel, log } = await mount(server, { live: [tab] });
      log.length = 0;
      open(panel, 'default', 'docs/a.md');
      moveTo(1, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain(
        'Move to workspace is refused: workspace default has not saved this tab yet, or has saved more than one tab of its file.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
      expect(close).not.toHaveBeenCalled();
    });

    it('DEF-PANEL-81-MOVE-EDITOR: a live document whose path is also saved as its own console moves by its editor entry; the console is not counted', async () => {
      const { tab } = liveTab('a.py');
      const close = jest.spyOn(tab, 'close');
      const server = three(['editor:a.py', 'console:a.py']);
      server.workspaces[0].data['editor:a.py'].data.factory = 'Editor';
      const { panel } = await mount(server, { live: [tab] });
      open(panel, 'default', 'a.py');
      moveTo(1, 'auto-7');
      await settle();
      expect(server.saved!['auto-7'].data['editor:a.py']).toEqual({
        data: { path: 'a.py', factory: 'Editor' }
      });
      expect(keysOf(server, 'auto-7')).not.toContain('console:a.py');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('DEF-PANEL-82-MOVE-VIEW: the second of two live tabs of a path saved once is refused; the saved tab is not moved, nothing is saved or closed', async () => {
      const editor = liveTab('a.md').tab;
      const preview = liveTab('a.md').tab;
      preview.title.label = 'Preview a.md';
      const closes = [
        jest.spyOn(editor, 'close'),
        jest.spyOn(preview, 'close')
      ];
      const server = three(['editor:a.md']);
      server.workspaces[0].data['editor:a.md'].data.factory = 'Editor';
      const { panel, log } = await mount(server, { live: [editor, preview] });
      log.length = 0;
      triangle(panel, 'w:default').click();
      Array.from(
        card(panel, 'w:default').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
        .find(r => r.textContent!.includes('Preview a.md'))!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      moveTo(1, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain(
        'Move to workspace is refused: workspace default has not saved this tab yet, or has saved more than one tab of its file.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
      closes.forEach(close => expect(close).not.toHaveBeenCalled());
    });

    /** Move to workspace on the row labelled `label` of this window's card, with `live` open and only `saved` saved, `entries` replacing their saved entries; expects the refusal, no save and no close. */
    const refusedMove = async (
      live: Widget[],
      saved: string[],
      label: string,
      entries: Record<string, unknown> = {}
    ) => {
      const closes = live.map(w => jest.spyOn(w, 'close'));
      const server = three(saved);
      Object.assign(server.workspaces[0].data, entries);
      const { panel, log } = await mount(server, { live });
      log.length = 0;
      triangle(panel, 'w:default').click();
      Array.from(
        card(panel, 'w:default').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
        .find(r => r.textContent!.includes(label))!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      moveTo(1, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain(
        'Move to workspace is refused: workspace default has not saved this tab yet, or has saved more than one tab of its file.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
      closes.forEach(close => expect(close).not.toHaveBeenCalled());
    };

    it('DEF-PANEL-83-MOVE-OWNKEY: a console whose path is saved only as its editor tab is refused; the editor entry is not moved, nothing is saved or closed', async () => {
      const editor = liveTab('a.py').tab;
      const panelOfConsole = new Widget();
      panelOfConsole.addClass('jp-ConsolePanel');
      (panelOfConsole as any).sessionContext = { path: 'a.py' };
      panelOfConsole.title.label = 'Console a.py';
      Widget.attach(panelOfConsole, document.body);
      await refusedMove(
        [editor, panelOfConsole],
        ['editor:a.py'],
        'Console a.py',
        { 'editor:a.py': { data: { path: 'a.py', factory: 'Editor' } } }
      );
    });

    it('DEF-PANEL-83-MOVE-OWNKEY: a notebook whose path is saved only as its editor tab is refused; the editor entry is not moved, nothing is saved or closed', async () => {
      const editor = liveTab('x.ipynb').tab;
      const notebook = liveNotebook('x.ipynb').tab;
      notebook.title.label = 'Notebook x.ipynb';
      await refusedMove(
        [editor, notebook],
        ['editor:x.ipynb'],
        'Notebook x.ipynb',
        { 'editor:x.ipynb': { data: { path: 'x.ipynb', factory: 'Editor' } } }
      );
    });

    /** x.ipynb in this window as a notebook, a cloned output view of it and an editor tab; the output view is JupyterLab's MainAreaWidget, with neither context nor sessionContext. */
    const notebookWithOutputView = () => {
      const notebook = liveNotebook('x.ipynb').tab;
      notebook.title.label = 'Notebook x.ipynb';
      const outputView = new Widget();
      outputView.title.label = 'Output View';
      Widget.attach(outputView, document.body);
      const editor = liveTab('x.ipynb').tab;
      editor.title.label = 'Editor x.ipynb';
      return [notebook, outputView, editor];
    };
    /** The notebook and the cloned output view of x.ipynb as JupyterLab saves them: the notebook with its factory, the output view with none. */
    const notebookEntries = {
      'notebook:x.ipynb': { data: { path: 'x.ipynb', factory: 'Notebook' } },
      'cloned-outputs:x.ipynb:3': { data: { path: 'x.ipynb', index: 3 } }
    };

    it('DEF-PANEL-81-MOVE-EDITOR: an editor tab of a notebook file not saved yet, beside a saved cloned output view of the notebook, is refused; the output view entry is not moved, nothing is saved or closed', async () => {
      await refusedMove(
        notebookWithOutputView(),
        ['notebook:x.ipynb', 'cloned-outputs:x.ipynb:3'],
        'Editor x.ipynb',
        notebookEntries
      );
    });

    it('DEF-PANEL-81-MOVE-EDITOR: a saved editor tab of a notebook file, beside a saved cloned output view of the notebook, moves by its editor entry; the output view is not counted, only the editor closes', async () => {
      const live = notebookWithOutputView();
      const closes = live.map(w => jest.spyOn(w, 'close'));
      const server = three([
        'notebook:x.ipynb',
        'cloned-outputs:x.ipynb:3',
        'editor:x.ipynb'
      ]);
      Object.assign(server.workspaces[0].data, notebookEntries);
      server.workspaces[0].data['editor:x.ipynb'].data.factory = 'Editor';
      const { panel } = await mount(server, { live });
      triangle(panel, 'w:default').click();
      Array.from(
        card(panel, 'w:default').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      )
        .find(r => r.textContent!.includes('Editor x.ipynb'))!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      moveTo(1, 'auto-7');
      await settle();
      expect(server.saved!['auto-7'].data['editor:x.ipynb']).toEqual({
        data: { path: 'x.ipynb', factory: 'Editor' }
      });
      expect(keysOf(server, 'auto-7')).not.toContain(
        'cloned-outputs:x.ipynb:3'
      );
      expect(closes.map(close => close.mock.calls.length)).toEqual([0, 0, 1]);
    });

    it('ACC-LISTS-269-MOVE-REFUSED: a document with unsaved changes is refused and stays open', async () => {
      const { tab } = liveTab('a.txt');
      (tab as any).context.model = { dirty: true };
      const close = jest.spyOn(tab, 'close');
      const { panel, log } = await mount(three(['editor:a.txt']), {
        live: [tab]
      });
      log.length = 0;
      open(panel, 'default', 'a.txt');
      moveTo(1, 'auto-7');
      await waitForDialog();
      expect(dialogText()).toContain(
        'Move to workspace is refused: the document has unsaved changes.'
      );
      await dismissDialog();
      await settle();
      expect(saves(log)).toEqual([]);
      expect(close).not.toHaveBeenCalled();
    });
  });

  it('ACC-ACCORD-263-HEADER-MENU: a right-click opens the ... menu at the pointer, a click on a header button included; a hidden card opens none; the context-menu key opens it at the header', async () => {
    const server = standard();
    server.workspaces.push(workspace('secret', 5));
    server.records.secret = { hidden: true };
    const { panel } = await mount(server);
    $(panel, 'button[aria-label="Show hidden workspaces"]')!.click();
    const opened = jest.spyOn(Menu.prototype, 'open');
    const dismiss = () =>
      pressKey(document.querySelector('.jp-WorkspaceManager-menu')!, 27);

    const right = { bubbles: true, button: 2, clientX: 40, clientY: 50 };
    const stopped = new MouseEvent('contextmenu', {
      ...right,
      cancelable: true
    });
    header(panel, 'w:auto-6').dispatchEvent(stopped);
    expect(stopped.defaultPrevented).toBe(true);
    expect(opened.mock.calls[0].slice(0, 2)).toEqual([40, 50]);
    expect(menuLabels()[0]).toBe('Open workspace');
    dismiss();

    header(panel, 'w:auto-6')
      .querySelector('button[aria-label="Hide workspace"]')!
      .dispatchEvent(new MouseEvent('contextmenu', right));
    expect(opened).toHaveBeenCalledTimes(2);
    dismiss();

    // the key reports the header's centre and no button
    const rect = { left: 7, bottom: 9 } as DOMRect;
    jest
      .spyOn(header(panel, 'w:auto-6'), 'getBoundingClientRect')
      .mockReturnValue(rect);
    header(panel, 'w:auto-6').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 90, clientY: 30 })
    );
    expect(opened.mock.calls[2].slice(0, 2)).toEqual([7, 9]);
    dismiss();

    const hidden = new MouseEvent('contextmenu', {
      ...right,
      cancelable: true
    });
    header(panel, 'w:secret').dispatchEvent(hidden);
    expect(hidden.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(3);
    opened.mockRestore();
  });

  it('EDGE-CLEAN-UP-ICON: the WORKSPACES header carries the eraser glyph, and the KERNELS, TERMINALS and LANGUAGE SERVERS headers the power glyph', async () => {
    const { panel } = await mount(standard());
    const glyph = (key: string) =>
      sectionHeader(panel, key)
        .querySelector('.jp-WorkspaceManager-iconButton svg')!
        .getAttribute('data-icon');
    expect(glyph('workspaces')).toBe(
      '@stellarshenson/jupyterlab-workspace-manager-extension:eraser'
    );
    for (const key of ['kernels', 'terminals', 'servers']) {
      expect(glyph(key)).toBe(
        '@stellarshenson/jupyterlab-workspace-manager-extension:power'
      );
    }
  });

  it('ACC-TERM-200-ROW-LEAVES: the panel keeps no map of shut-down terminals, so the route decides: a load that still lists a shut-down terminal keeps its row, whatever its fingerprint; the row and the card Terminals count leave when the route drops it; a new terminal of the same name shows; a failed shutdown keeps the row', async () => {
    // Jupyter lists a shut-down terminal while its pty closes; the old panel hid it by
    // the fingerprint of the row it shut down itself
    const server = standard();
    server.terminals[0].fingerprint = '101:1000.25';
    const { panel, app } = await mount(server);
    const rows = () =>
      Array.from(
        openSection(panel, 'terminals').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      ).map(r => r.title.split('\n')[0]);
    const terminalCount = () => {
      openSection(panel, 'workspaces');
      // DQ-17: the counts show while the card is open
      if (!card(panel, 'w:auto-6').classList.contains('jp-mod-open')) {
        triangle(panel, 'w:auto-6').click();
      }
      return header(panel, 'w:auto-6').querySelector(
        '.jp-WorkspaceManager-count[title="Terminals"]'
      )!.textContent;
    };
    const shutDown = async () => {
      openSection(panel, 'terminals')
        .querySelector<HTMLElement>('.jp-WorkspaceManager-row')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      chooseMenuItem(0); // Shut down terminal
      await settle();
    };
    const terminal = (name: string) => ({
      name,
      last_activity: iso(0),
      process: 'bash'
    });
    expect(rows()).toEqual(['terminal 1']);
    expect(terminalCount()).toBe('1');

    // no map hides the row: the route still lists it, so it stays
    await shutDown();
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([['1']]);
    expect(rows()).toEqual(['terminal 1']);
    expect(terminalCount()).toBe('1');

    // the route leaves the ended pty out, so the row and the count leave at the next load
    server.terminals = [];
    await panel.refresh();
    expect(rows()).toEqual([]);
    expect(sectionCount(panel, 'terminals')).toBe('(0)');
    expect(terminalCount()).toBe('0');

    // a new terminal of the same name shows
    server.terminals = [terminal('1')];
    await panel.refresh();
    expect(rows()).toEqual(['terminal 1']);
    expect(terminalCount()).toBe('1');

    // a failed shutdown keeps the row
    app.serviceManager.terminals.shutdown.mockRejectedValueOnce(
      new Error('Terminal not found')
    );
    await shutDown();
    await waitForDialog();
    await dismissDialog();
    expect(rows()).toEqual(['terminal 1']);
    expect(terminalCount()).toBe('1');

    // Shut down all reads the server afresh and shuts down every listed terminal
    server.terminals.push(terminal('2'));
    await panel.refresh();
    shutDownAll(panel, 'terminals').click();
    await waitForDialog();
    await dangerDialog();
    await settle();
    expect(app.serviceManager.terminals.shutdown.mock.calls.slice(2)).toEqual([
      ['1'],
      ['2']
    ]);
    // the route drops both ended ptys on the next load
    server.terminals = [];
    await panel.refresh();
    expect(rows()).toEqual([]);
    expect(terminalCount()).toBe('0');
  });

  it('ACC-ACCORD-191-DRAG-ORDER: Move up in the card menu moves the card at once with one stored position, the same in a second window; Move down is disabled on the last card', async () => {
    const server = standard();
    server.records['auto-6'].position = 0;
    server.records.default = { position: 1 };
    const { panel, log } = await mount(server);
    expect(order(panel)).toEqual(['auto-6', 'default']);

    card(panel, 'w:default')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    const item = (label: string) =>
      Array.from(
        document.querySelectorAll('.jp-WorkspaceManager-menu .lm-Menu-item')
      ).find(li => li.textContent === label)!;
    expect(item('Move up').classList).not.toContain('lm-mod-disabled');
    expect(item('Move down').classList).toContain('lm-mod-disabled');
    log.length = 0;
    // enabled in this window's menu: Close all tabs, Set description..., Colour, Move up
    chooseMenuItem(3);
    expect(order(panel)).toEqual(['default', 'auto-6']);
    await settle();
    expect(log.filter(l => l.startsWith('PATCH'))).toEqual([
      `PATCH /${NS}/meta/default`
    ]);
    expect(server.records.default.position).toBe(-1);
    expect(server.records['auto-6'].position).toBe(0);
    expect(order(panel)).toEqual(['default', 'auto-6']);

    const { panel: second } = await mount(server);
    expect(order(second)).toEqual(['default', 'auto-6']);
  });

  it('ACC-ACCORD-191-DRAG-ORDER: with the filter on, Move up on the second visible card makes it the first visible card', async () => {
    const server = standard();
    server.workspaces.push(workspace('notes', 2));
    server.records['auto-6'].position = 0;
    server.records.notes = { position: 1 };
    server.records.default = { position: 2, purpose: 'Firmware build' };
    const { panel } = await mount(server);
    expect(order(panel)).toEqual(['auto-6', 'notes', 'default']);

    $(panel, 'button[aria-label="Filter"]')!.click();
    const input = $(panel, '.jp-WorkspaceManager-filterInput')!;
    // React reads a typed value through the input event
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, 'firmware');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(order(panel)).toEqual(['auto-6', 'default']);

    card(panel, 'w:default')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    chooseMenuItem(3); // Move up
    expect(order(panel)).toEqual(['default', 'auto-6']);
  });

  it('ACC-ACCORD-191-DRAG-ORDER: a reload that started before a move does not put the card back', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    server.records['auto-6'].position = 0;
    server.records.default = { position: 1 };
    const { panel, reloads, hold, release } = await mount(server);

    // a poll reaches the server before the move; the move's write waits
    hold(['PATCH']);
    jest.advanceTimersByTime(10000);
    expect(reloads()).toBe(2);
    card(panel, 'w:default')
      .querySelector<HTMLElement>('button[aria-label="Workspace menu"]')!
      .click();
    chooseMenuItem(3); // Move up
    await settle();
    expect(order(panel)).toEqual(['default', 'auto-6']);

    release();
    await settle();
    expect(order(panel)).toEqual(['default', 'auto-6']);
  });

  it('DEF-PANEL-19-RECORDS-FAIL: a first load whose records request fails writes no position; a later good load gives a position only to a workspace without one', async () => {
    const server = standard();
    server.workspaces.push(workspace('notes', 2));
    // the dragged order: the reverse of the order given by creation
    server.records.default = { position: 0 };
    server.records['auto-6'].position = 1;
    server.recordsFailing = true;
    const { panel, log } = await mount(server);
    expect(server.records.default.position).toBe(0);
    expect(server.records['auto-6'].position).toBe(1);
    expect(server.records.notes?.position).toBeUndefined();

    server.recordsFailing = false;
    log.length = 0;
    await panel.refresh();
    expect(log.filter(l => l.startsWith('PATCH'))).toEqual([
      `PATCH /${NS}/meta/notes`
    ]);
    expect(server.records.notes.position).toBe(2);
    expect(server.records.default.position).toBe(0);
    expect(server.records['auto-6'].position).toBe(1);
    expect(order(panel)).toEqual(['default', 'auto-6', 'notes']);
  });

  it('ACC-ACCORD-198-NEW-LAST: a workspace deleted and created again under its name goes last', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel } = await mount(server);
    expect(order(panel)).toEqual(['auto-6', 'default']);

    // the CLI deletes auto-6, the server drops its record, and the CLI creates it again
    const auto6 = server.workspaces.pop();
    delete server.records['auto-6'];
    jest.advanceTimersByTime(10000);
    await settle();
    server.workspaces.push(auto6);
    jest.advanceTimersByTime(10000);
    await settle();
    expect(order(panel)).toEqual(['default', 'auto-6']);
  });

  it('ACC-ACCORD-31-DELETE: the menu stays open on the arming click; a double-click does not delete, a later click does', () => {
    const deleted = jest.fn();
    const menu = workspaceMenu(
      'rose',
      false,
      {
        open: jest.fn(),
        openInNewTab: jest.fn(),
        closeAll: jest.fn(),
        describe: jest.fn(),
        colour: jest.fn(),
        hide: jest.fn(),
        delete: deleted
      },
      trans
    );
    menu.open(0, 0);
    const index = menu.items.findIndex(i => i.command === 'delete');
    const item = () => menu.contentNode.children[index] as HTMLElement;
    const click = (detail: number, timeStamp: number) => {
      menu.activeIndex = index;
      const event = new MouseEvent('click', { bubbles: true, detail });
      Object.defineProperty(event, 'timeStamp', { value: timeStamp });
      item().dispatchEvent(event);
    };
    menu.activeIndex = index;
    menu.triggerActiveItem(); // the pointer release: nothing yet
    expect(item().textContent).toContain('Delete workspace');

    click(1, 1000);
    MessageLoop.flush(); // the menu draws its items on the next frame
    expect(menu.isAttached).toBe(true);
    expect(item().textContent).toContain('Confirm delete');
    click(2, 1300);
    expect(deleted).not.toHaveBeenCalled();
    click(1, 2000);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(menu.isAttached).toBe(false);
  });

  it('withoutTabs removes the tab keys from the layout and from data, and keeps the rest', () => {
    const ws = workspace('auto-6', 0, ['terminal:7', 'editor:a.md']);
    (ws.data as any)['file-browser-filebrowser:cwd'] = { path: 'x' };
    const one = withoutTabs(ws as any, ['terminal:7']) as any;
    expect(one.data['layout-restorer:data'].main.dock.widgets).toEqual([
      'editor:a.md'
    ]);
    expect(one.data['terminal:7']).toBeUndefined();
    expect(one.data['editor:a.md']).toBeDefined();
    const none = withoutTabs(ws as any, ['terminal:7', 'editor:a.md']) as any;
    expect(none.data['layout-restorer:data'].main.dock).toBeNull();
    expect(none.data['file-browser-filebrowser:cwd']).toEqual({ path: 'x' });
    expect(none.metadata).toEqual({ id: 'auto-6' });
    // the input is untouched
    expect((ws.data as any)['terminal:7']).toBeDefined();
  });
});
