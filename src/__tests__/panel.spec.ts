// the tsconfig only auto-includes jest types; pull in node's for the real setImmediate
/// <reference types="node" />
import { PageConfig } from '@jupyterlab/coreutils';
import { RunningSessionManagers } from '@jupyterlab/running';
import { ServerConnection } from '@jupyterlab/services';
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
  /** answer 404 on every route of the server extension */
  absent?: boolean;
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
      json: async () => body,
      text: async () => (body === undefined ? '' : JSON.stringify(body))
    }) as unknown as Response;
  const route = (method: string, path: string, body: any): Response => {
    if (path.includes(NS)) {
      if (server.absent) {
        return reply(404, { message: 'Not Found' });
      }
      if (path.endsWith('/meta')) {
        return reply(200, server.records);
      }
      if (path.endsWith('/terminals')) {
        return reply(200, server.terminals);
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

function fakeApp(settings: ServerConnection.ISettings, live: Widget[] = []) {
  return {
    serviceManager: { serverSettings: settings },
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

let panels: WorkspacePanel[] = [];

async function mount(
  server: IServer,
  options: { live?: Widget[]; managers?: RunningSessionManagers } = {}
) {
  const fake = fakeServer(server);
  const panel = new WorkspacePanel({
    app: fakeApp(fake.settings, options.live),
    current: 'default',
    window: 'w1',
    managers: options.managers ?? null
  });
  panels.push(panel);
  Widget.attach(panel, document.body);
  await settle();
  return { panel, fake, ...fake };
}

const $ = (panel: Widget, selector: string) =>
  panel.node.querySelector<HTMLElement>(selector);
const $$ = (panel: Widget, selector: string) =>
  Array.from(panel.node.querySelectorAll<HTMLElement>(selector));
const card = (panel: Widget, key: string) => $(panel, `[data-key="${key}"]`)!;
const header = (panel: Widget, key: string) =>
  card(panel, key).querySelector<HTMLElement>(
    '.jp-WorkspaceManager-cardHeader'
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
  it('ACC-PANEL-4-OTHERS: sections of other extensions are listed under Other sessions, the replaced ones are not', async () => {
    const managers = new RunningSessionManagers();
    const manager = (name: string, labels: string[]) => ({
      name,
      running: () =>
        labels.map(label => ({ label: () => label, icon: () => '' })),
      refreshRunning: () => undefined,
      runningChanged: new Signal<any, any>({}),
      shutdownAll: () => undefined
    });
    managers.add(manager('Language servers', ['pylsp', 'bash-lsp']));
    for (const name of ['Open Tabs', 'Kernels', 'Terminals', 'Workspaces']) {
      managers.add(manager(name, [`item of ${name}`]));
    }
    const { panel } = await mount(standard(), { managers });

    const others = card(panel, 'x:others');
    expect(others.textContent).toContain('1 section');
    header(panel, 'x:others').click();
    const text = card(panel, 'x:others').textContent!;
    expect(text).toContain('LANGUAGE SERVERS');
    expect(text).toContain('pylsp');
    expect(text).toContain('bash-lsp');
    expect(panel.node.textContent).not.toMatch(/item of/);
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
    header(panel, 'w:auto-6').click();
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
    expect(header(panel, 'w:auto-6').getAttribute('aria-expanded')).toBe(
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
    header(panel, 'w:auto-6').click();
    const rows = $$(panel, '.jp-WorkspaceManager-row').map(r => r.textContent);
    expect(rows).toContain('terminal 1now');
    expect(card(panel, 'w:auto-6').textContent).not.toContain('claude');
    header(panel, 'x:none').click();
    expect(card(panel, 'x:none').textContent).toContain('python3');
  });

  it('ACC-PANEL-96-LOAD-ERROR, DEF-PANEL-2-PARTIAL-RELOAD: a failed list keeps its rows under one line naming it, the other lists update; the next good reload removes the line', async () => {
    const server = standard();
    const { panel } = await mount(server);
    header(panel, 'x:none').click();
    expect(card(panel, 'x:none').textContent).toContain('python3');
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
    expect(card(panel, 'x:none').textContent).toContain('python3');
    expect(card(panel, 'x:none').textContent).toContain('htop');

    server.failing = false;
    await panel.refresh();
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(card(panel, 'x:none').textContent).not.toContain('python3');
    expect(card(panel, 'x:none').textContent).toContain('htop');
  });

  it('ACC-CULLER-65-CULLED: a kernel list that answers 500 once, as jupyter_server does while a kernel starts, is asked again and shows no line', async () => {
    const server = standard();
    const { panel, log } = await mount(server);
    header(panel, 'x:none').click();

    server.failing = 'once';
    server.kernels.push({ ...server.kernels[0], id: 'k2', name: 'julia' });
    log.length = 0;
    await panel.refresh();
    expect(log.filter(l => l.endsWith('/api/kernels'))).toHaveLength(2);
    expect($(panel, '.jp-WorkspaceManager-error')).toBeNull();
    expect(card(panel, 'x:none').textContent).toContain('julia');
  });

  it('DEF-PANEL-1-REFRESH-STALE: a refresh pressed while a poll load is in flight shows data asked for after the press', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const server = standard();
    const { panel, reloads, hold, release } = await mount(server);
    header(panel, 'x:none').click();

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
    expect(card(panel, 'x:none').textContent).toContain('htop');
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

  it('ACC-ACCORD-101-PURPOSE-TEXT: a workspace name, a purpose, a terminal tab title, a process name, a file name and a folder holding markup show as text', async () => {
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
    expect(terminalRow.title).toBe(MARKUP);
  });

  it('ACC-KERNEL-72-GLYPH: a kernel row shows kernelIcon', async () => {
    const { panel } = await mount(standard());
    header(panel, 'x:none').click();
    const row = card(panel, 'x:none').querySelector(
      '.jp-WorkspaceManager-row'
    )!;
    expect(row.textContent).toContain('python3');
    expect(
      row
        .querySelector('.jp-WorkspaceManager-rowIcon svg')!
        .getAttribute('data-icon')
    ).toBe('ui-components:kernel');
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
