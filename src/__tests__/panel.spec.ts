// the tsconfig only auto-includes jest types; pull in node's for the real setImmediate
/// <reference types="node" />
import { PageConfig } from '@jupyterlab/coreutils';
import { RunningSessionManagers } from '@jupyterlab/running';
import { ServerConnection } from '@jupyterlab/services';
import {
  acceptDialog,
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
/** A section of the accordion: workspaces, kernels, terminals or servers. */
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
/** The Shut down all button of a section's header. */
const shutDownAll = (panel: Widget, key: string) =>
  Array.from(sectionHeader(panel, key).querySelectorAll('button')).find(
    b => b.textContent === 'Shut down all'
  )!;
const refreshButton = (panel: Widget) =>
  $(panel, 'button[aria-label="Refresh"]') as HTMLButtonElement;

afterEach(() => {
  panels.forEach(p => p.dispose());
  panels = [];
  document.body.innerHTML = '';
  jest.useRealTimers();
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
    await acceptDialog();
    await settle();
    expect(shutdownAll).toHaveBeenCalledTimes(1);
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
    await acceptDialog();
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

    openSection(panel, 'workspaces');
    const counts = (key: string) =>
      Array.from(
        header(panel, key).querySelectorAll('.jp-WorkspaceManager-count')
      ).map(c => c.textContent);
    expect(counts('w:auto-6')).toEqual(['1', '1', '1']);
    expect(counts('w:default')).toEqual(['0', '1', '0']);
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

  it('ACC-PANEL-8-POLL: a visible panel reloads every 10 s without the turning icon and keeps scroll, focus, open card and menu', async () => {
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

    // a card open, a row focused, the list scrolled
    triangle(panel, 'w:auto-6').click();
    const list = $(panel, '.jp-WorkspaceManager-list')!;
    list.scrollTop = 40;
    const row = card(panel, 'w:auto-6').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    row.focus();
    expect(document.activeElement).toBe(row);
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
    expect(card(panel, 'w:auto-6').textContent).toContain('fish');
    expect($(panel, '.jp-WorkspaceManager-list')).toBe(list);
    expect(list.scrollTop).toBe(40);
    expect(document.activeElement).toBe(row);
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
    expect(openSection(panel, 'kernels').textContent).toContain(PYTHON);
  });

  it('ACC-PANEL-96-LOAD-ERROR, DEF-PANEL-2-PARTIAL-RELOAD: a failed list keeps its rows under one line naming it, the other lists update; the next good reload removes the line', async () => {
    const server = standard();
    const { panel } = await mount(server);
    expect(openSection(panel, 'kernels').textContent).toContain(PYTHON);
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
    expect(sectionBody(panel, 'kernels').textContent).toContain(PYTHON);
    // the TERMINALS section lists the new terminal
    expect(openSection(panel, 'terminals').textContent).toContain('htop');

    server.failing = false;
    await panel.refresh();
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(sectionCount(panel, 'kernels')).toBe('(0)');
    expect(sectionBody(panel, 'terminals').textContent).toContain('htop');
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
    expect(sectionBody(panel, 'kernels').textContent).toContain('julia');
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
    expect(openSection(panel, 'terminals').textContent).toContain('htop');
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

  it('ACC-PANEL-168-COUNT-BRACKETS: a section count reads (N), a filtered card (N of M); the header icon counts stay bare', async () => {
    const { panel } = await mount(standard());
    expect(sectionCount(panel, 'workspaces')).toBe('(2)');
    expect(sectionCount(panel, 'kernels')).toBe('(1)');
    expect(
      Array.from(
        header(panel, 'w:auto-6').querySelectorAll('.jp-WorkspaceManager-count')
      ).map(c => c.textContent)
    ).toEqual(['1', '1', '0']);

    triangle(panel, 'w:auto-6').click();
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
    expect(labels).toContain(MARKUP);
    const details = $$(panel, '.jp-WorkspaceManager-rowDetail').map(
      d => d.textContent
    );
    expect(details).toContain(MARKUP);
    const terminalRow = $$(panel, '.jp-WorkspaceManager-row').find(r =>
      r.textContent!.includes('terminal 1')
    )!;
    expect(terminalRow.title).toBe(`terminal 1\n${MARKUP}\nnow`);
  });

  it('ACC-KERNEL-72-GLYPH, ACC-KERNEL-156-DISPLAY-NAME: a kernel row shows kernelIcon and the display name of its kernelspec, its tooltip the display name and state', async () => {
    const { panel } = await mount(standard());
    const row = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!;
    expect(
      row.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent
    ).toBe(PYTHON);
    expect(row.title).toBe(`${PYTHON}\nidle`);
    expect(
      row
        .querySelector('.jp-WorkspaceManager-rowIcon svg')!
        .getAttribute('data-icon')
    ).toBe('ui-components:kernel');
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: a KERNELS row shows the display name, the session path, the state, the memory and the CPU, refreshed by the poll; figures the server cannot read show a dash; a card kernel row keeps its file name and age', async () => {
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

    const shown = () =>
      Array.from(
        openSection(panel, 'kernels').querySelectorAll<HTMLElement>(
          '.jp-WorkspaceManager-row'
        )
      ).map(r => [
        r.querySelector('.jp-WorkspaceManager-rowLabel')!.textContent,
        r.querySelector('.jp-WorkspaceManager-rowDetail')?.textContent ?? '',
        ...Array.from(
          r.querySelectorAll(
            '.jp-WorkspaceManager-age > span:not(.jp-WorkspaceManager-dot)'
          )
        ).map(x => x.textContent)
      ]);
    expect(shown()).toEqual([
      [PYTHON, 'work/a.ipynb', 'idle', '150 MB', '13%'],
      [PYTHON, '', 'busy', '-', '-']
    ]);

    server.resources.k1 = { memory: 3 * 2 ** 30, cpu: 0.2 };
    await panel.refresh();
    expect(shown()[0]).toEqual([
      PYTHON,
      'work/a.ipynb',
      'idle',
      '3.0 GB',
      '0%'
    ]);

    openSection(panel, 'workspaces');
    triangle(panel, 'w:auto-6').click();
    const cardRow = Array.from(
      card(panel, 'w:auto-6').querySelectorAll<HTMLElement>(
        '.jp-WorkspaceManager-row'
      )
    ).find(r => r.title.startsWith(PYTHON))!;
    expect(cardRow.textContent).toBe(`${PYTHON}a.ipynb5m`);
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

  it('ACC-KERNEL-196-KERNEL-DETAILS: a console KERNELS row shows the console name, not the generated session path', async () => {
    const server = standard();
    server.sessions.push({
      id: 's1',
      name: 'Console 1',
      path: 'dir/console-1-0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
      type: 'console',
      kernel: server.kernels[0]
    });
    const { panel } = await mount(server);
    const text = openSection(panel, 'kernels').querySelector<HTMLElement>(
      '.jp-WorkspaceManager-row'
    )!.textContent!;
    expect(text).toContain('Console 1');
    expect(text).not.toContain('console-1-');
  });

  it('ACC-KERNEL-196-KERNEL-DETAILS: a failed read of memory and CPU after a good one shows dashes, and Shut down all in KERNELS and TERMINALS still shuts down', async () => {
    const server = standard();
    server.resources = { k1: { memory: 150 * 2 ** 20, cpu: 12.6 } };
    const { panel, app } = await mount(server);
    const figures = () =>
      Array.from(
        openSection(panel, 'kernels').querySelectorAll(
          '.jp-WorkspaceManager-age > span:not(.jp-WorkspaceManager-dot)'
        )
      ).map(x => x.textContent);
    expect(figures()).toEqual(['idle', '150 MB', '13%']);

    server.resourcesFailing = true;
    await panel.refresh();
    expect(figures()).toEqual(['idle', '-', '-']);
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();

    for (const key of ['kernels', 'terminals']) {
      openSection(panel, key);
      shutDownAll(panel, key).click();
      await waitForDialog();
      await acceptDialog();
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
    await acceptDialog();
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
    const shutDown = (index: number) => {
      openSection(panel, 'terminals')
        .querySelectorAll<HTMLElement>('.jp-WorkspaceManager-row')
        [index].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      chooseMenuItem(0); // Shut down terminal
    };
    // terminal 1, held by auto-6 alone
    shutDown(0);
    await settle();
    expect(dialogText()).toBeUndefined();
    expect(app.serviceManager.terminals.shutdown.mock.calls).toEqual([['1']]);

    // terminal 2, held by auto-7 and auto-8, neither this window's
    shutDown(1);
    await waitForDialog();
    const text = dialogText();
    await dismissDialog(); // before the assertion, so a failure leaves no dialog open
    expect(text).toContain('Workspaces auto-7 and auto-8 hold this terminal.');

    // terminal 3, held by this window's workspace and auto-7: only auto-7 is named
    shutDown(2);
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
