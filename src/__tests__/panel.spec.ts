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
import { CommandRegistry } from '@lumino/commands';
import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

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
const MARKUP = '<img src=x onerror=alert(1)>';
const iso = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60000).toISOString();

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
      if (method !== 'GET') {
        return reply(204, undefined);
      }
      const id = decodeURIComponent(path.split('/').pop()!);
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
      activateById: jest.fn()
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
    managers: options.managers ?? null
  });
  panels.push(panel);
  Widget.attach(panel, document.body);
  await settle();
  return { panel, fake, app, ...fake };
}

/** Choose the item at `index` of the open menu by keyboard; Lumino reads keyCode. */
function chooseMenuItem(index: number) {
  const menu = document.querySelector('.jp-WorkspaceManager-menu')!;
  const key = (keyCode: number) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(event, 'keyCode', { value: keyCode });
    menu.dispatchEvent(event);
  };
  for (let i = 0; i <= index; i++) {
    key(40); // ArrowDown
  }
  key(13); // Enter
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
/** The TABS, TERMINALS or KERNELS group of an open card. */
const group = (root: HTMLElement, label: string) =>
  Array.from(
    root.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-group')
  ).find(g => g.firstElementChild!.textContent!.startsWith(label))!;
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

  it('DEF-PANEL-10-SHARED-VIEW: two views of one document are one row; a click activates a view, Close tab closes both', async () => {
    const views = [0, 1].map(i => {
      const view = new Widget();
      view.id = `view-${i}`;
      view.title.label = 'a.md';
      (view as any).context = { path: 'a.md' };
      return view;
    });
    const closed = views.map(v => jest.spyOn(v, 'close'));
    const { panel, app } = await mount(standard(), { live: views });
    header(panel, 'w:default').click();
    const rows = card(panel, 'w:default').querySelectorAll<HTMLElement>(
      '.jp-WorkspaceManager-row'
    );
    expect(rows).toHaveLength(1);
    rows[0].click();
    expect(app.shell.activateById).toHaveBeenCalledWith('view-0');

    rows[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    chooseMenuItem(0); // Close tab
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(closed[0]).toHaveBeenCalledTimes(1);
    expect(closed[1]).toHaveBeenCalledTimes(1);
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

  it('ACC-PANEL-182-SECTION-HEADS: every section starts open; a header click closes or opens its section only; a new panel keeps the state', async () => {
    const { panel } = await mount(standard());
    const expanded = (p: Widget) =>
      ['workspaces', 'kernels', 'terminals', 'servers'].map(key =>
        sectionHeader(p, key).getAttribute('aria-expanded')
      );
    expect(expanded(panel)).toEqual(['true', 'true', 'true', 'true']);
    expect($$(panel, '.jp-WorkspaceManager-sectionBody')).toHaveLength(4);
    sectionHeader(panel, 'kernels').click();
    expect(expanded(panel)).toEqual(['true', 'false', 'true', 'true']);
    expect(
      section(panel, 'kernels')!.querySelector(
        '.jp-WorkspaceManager-sectionBody'
      )
    ).toBeNull();
    sectionHeader(panel, 'terminals').click();
    expect(expanded(panel)).toEqual(['true', 'false', 'false', 'true']);
    sectionHeader(panel, 'terminals').click();
    expect(expanded(panel)).toEqual(['true', 'false', 'true', 'true']);
    // the next page of this browser
    const { panel: next } = await mount(standard());
    expect(expanded(next)).toEqual(['true', 'false', 'true', 'true']);
  });

  it('ACC-PANEL-208-SECTION-STORE: a localStorage that throws, or an unreadable stored state, opens every section, and a click still closes one', async () => {
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
    expect(expanded(panel)).toEqual(['true', 'true', 'true', 'true']);
    sectionHeader(panel, 'kernels').click();
    expect(expanded(panel)).toEqual(['true', 'false', 'true', 'true']);
    failing.forEach(spy => spy.mockRestore());

    for (const stored of ['{', '{"kernels": false}']) {
      localStorage.setItem(
        'jupyterlab_workspace_manager_extension:closed-sections',
        stored
      );
      const { panel: other } = await mount(standard());
      expect(expanded(other)).toEqual(['true', 'true', 'true', 'true']);
      sectionHeader(other, 'servers').click();
      expect(expanded(other)).toEqual(['true', 'true', 'true', 'false']);
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
    expect(counts('w:auto-6')).toEqual(['1', '1', '1']);
    expect(counts('w:default')).toEqual(['0', '1', '0']);
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

  it('ACC-PANEL-8-POLL: a visible panel reloads every 10 s without the turning icon and keeps the section scroll, the closed section, the focus, the selected row, the open card and the menu', async () => {
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

    // a card open, a row focused, the WORKSPACES list scrolled, KERNELS closed
    triangle(panel, 'w:auto-6').click();
    const list = sectionBody(panel, 'workspaces');
    list.scrollTop = 40;
    sectionHeader(panel, 'kernels').click();
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
    expect(card(panel, 'w:auto-6').textContent).toContain('terminal 2');
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

  it('ACC-PANEL-9-POLL-HIDDEN: a hidden panel does not reload; shown, it reloads once', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const { panel, log, reloads } = await mount(standard());
    expect(reloads()).toBe(1);
    panel.hide();
    log.length = 0;
    jest.advanceTimersByTime(60000);
    await settle();
    expect(log).toEqual([]);
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
    expect(rows).toContain('terminal 1now');
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
    expect(openSection(panel, 'terminals').textContent).toContain('terminal 9');

    server.failing = false;
    await panel.refresh();
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(sectionCount(panel, 'kernels')).toBe('(0)');
    expect(sectionBody(panel, 'terminals').textContent).toContain('terminal 9');
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
    expect(openSection(panel, 'terminals').textContent).toContain('terminal 9');
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
      .querySelector<HTMLElement>('button[aria-label="Close all tabs"]')!
      .click();
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
      'jupyterlab_workspace_manager_extension:terminal',
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
    expect(counts()).toEqual(['1', '1', '0']);
    expect(
      Array.from(
        card(panel, 'w:auto-6').querySelectorAll(
          '.jp-WorkspaceManager-groupLabel'
        )
      ).map(l => l.textContent)
    ).toEqual(['TABS (1)', 'TERMINALS (1)']);

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
    // the folder of the document and the process of the terminal, each in its selected row's detail line
    const rows = card(panel, 'w:default').querySelectorAll<HTMLElement>(
      '.jp-WorkspaceManager-row'
    );
    const details = Array.from(rows).map(r => {
      r.focus();
      return $(panel, '.jp-mod-selected .jp-WorkspaceManager-rowDetail')!
        .textContent;
    });
    expect(details).toEqual([MARKUP, MARKUP]);
    expect(panel.node.querySelector('img')).toBeNull();
    const terminalRow = $$(panel, '.jp-WorkspaceManager-row').find(r =>
      r.textContent!.includes('terminal 1')
    )!;
    expect(terminalRow.title).toBe(`terminal 1\n${MARKUP}\nnow`);
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

  it('ACC-LISTS-209-ROW-LINE, ACC-KERNEL-49-STATE: an unselected tab, terminal or kernel row shows its name, a kernel its state word, and the time only; the state word is in the line, the title and the dot aria-label, in a card and in KERNELS', async () => {
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
      'a.ipynb',
      'terminal 1now',
      'a.ipynbidle5m ago'
    ]);
    expect(text(openSection(panel, 'kernels'))).toEqual(['a.ipynbidle5m ago']);
    expect(text(openSection(panel, 'terminals'))).toEqual(['terminal 1now']);
    expect($(panel, '.jp-WorkspaceManager-rowDetail')).toBeNull();
    // the process, the kernel type, the path, the folder, memory and CPU wait for the selection
    for (const hidden of ['claude', PYTHON, 'docs', 'work/', 'MB', '%']) {
      expect(
        panel.node.querySelector('.jp-WorkspaceManager-list')!.textContent
      ).not.toContain(hidden);
    }
    // ACC-KERNEL-49-STATE: the word in the line, the title and the dot's aria-label
    for (const root of [
      group(card(panel, 'w:auto-6'), 'KERNELS'),
      sectionBody(panel, 'kernels')
    ]) {
      const row = root.querySelector<HTMLElement>('.jp-WorkspaceManager-row')!;
      const dot = row.querySelector('.jp-WorkspaceManager-dot')!;
      expect(row.querySelector('.jp-WorkspaceManager-state')!.textContent).toBe(
        'idle'
      );
      expect(row.title.split('\n')).toContain('idle');
      expect(dot.getAttribute('role')).toBe('img');
      expect(dot.getAttribute('aria-label')).toBe('idle');
      expect(dot.classList).toContain('jp-mod-idle');
    }
  });

  it('ACC-LISTS-210-ROW-SELECT, ACC-TERM-42-PROCESS, ACC-TERM-44-PROCESS-UNREAD: a focused row is the one selected row and shows its detail line; the arrow keys move it; a terminal with no readable process shows no detail line', async () => {
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
    expect(detail()).toBe('claude');
    rows[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(selected()).toEqual([rows[2]]);
    expect(detail()).toBeNull();
    // a row of a section takes the selection from the card's row
    const listed = openSection(panel, 'terminals').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    listed.focus();
    expect(selected()).toEqual([listed]);
    expect(detail()).toBe('claude');
    // a reload keeps it while its item exists
    await panel.refresh();
    expect(selected()).toEqual([listed]);
    server.terminals = server.terminals.filter(t => t.name !== '1');
    await panel.refresh();
    expect(selected()).toEqual([]);
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: a selected KERNELS row shows the display name, the session path, the memory and the CPU, refreshed by the poll; figures the server cannot read show a dash; a kernel with no session shows no path; a card kernel row shows its file name, state and age', async () => {
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
    const row = $(panel, '[data-section="kernels"] .jp-WorkspaceManager-row')!;
    row.focus();
    expect(
      Array.from(row.querySelectorAll('.jp-WorkspaceManager-rowDetail')).map(
        d => d.textContent
      )
    ).toEqual([`${PYTHON}150 MB13%`, 'work/a.ipynb']);
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
    ).find(r => r.title.startsWith(PYTHON))!;
    expect(cardRow.textContent).toBe('a.ipynbidle5m ago');
  });

  it('ACC-LISTS-37-TWO-WORKSPACES, ACC-KERNEL-196-KERNEL-DETAILS: no terminal or kernel row, in a section or a card, shows an also in mark, and no hover text names another workspace', async () => {
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
      'terminal 1',
      PYTHON
    ]);
    for (const r of rows) {
      expect(r.textContent).not.toContain('also in');
      expect(r.title).not.toMatch(/also in|auto-7/);
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
    const shutDown = (path: string, root = card(panel, 'w:auto-6')) => {
      Array.from(root.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row'))
        .find(r => r.title === `${PYTHON}\n${path}\nidle`)!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      chooseMenuItem(0); // Shut down kernel
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
    shutDown('b.ipynb', openSection(panel, 'kernels'));
    await settle();
    expect(dialogText()).toBeUndefined();
    expect(app.serviceManager.kernels.shutdown.mock.calls).toEqual([
      ['k1'],
      ['k2'],
      ['k2']
    ]);

    // the shared kernel from the KERNELS section: neither holder is this window's, both are named
    shutDown('a.ipynb', openSection(panel, 'kernels'));
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
    chooseMenuItem(0); // Shut down terminal
    await waitForDialog();
    const three = dialogBody();
    await dismissDialog();
    expect(three).toBe('Workspaces auto-7 and auto-8 also hold this terminal.');
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
    const menu = workspaceMenu('rose', false, {
      open: jest.fn(),
      openInNewTab: jest.fn(),
      closeAll: jest.fn(),
      describe: jest.fn(),
      colour: jest.fn(),
      hide: jest.fn(),
      delete: deleted
    });
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
