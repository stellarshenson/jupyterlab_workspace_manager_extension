import { expect, type IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

/** The palette in the order of the rotation. */
export const COLOURS = ['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender'];

/** The menu labels of the palette colours, in the same order. */
export const COLOUR_LABELS = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Purple'
];

/** A palette hue as the page draws it: the extension's --wm-<colour> (DQ-28). */
export const shade = (page: Page, colour: string): Promise<string> =>
  // on the body, where the panel's inheritance starts
  page.evaluate(
    name => getComputedStyle(document.body).getPropertyValue(name).trim(),
    `--wm-${colour}`
  );

/** The workspace colour of a card: its 4 px left border, as the page draws it. */
export const stripColour = (c: Locator): Promise<string> =>
  c.evaluate(n => getComputedStyle(n).borderLeftColor);

/** The workspace panel. */
export const PANEL = '#jp-running-sessions';

/** The width of the panel: the left sidebar at JupyterLab's default 250 px. */
export const panelWidth = (page: Page): Promise<number> =>
  page.locator(PANEL).evaluate(n => n.getBoundingClientRect().width);

/** Drag the left sidebar to `width` px. */
export async function sidebarTo(page: Page, width: number): Promise<void> {
  const handle = page
    .locator('#jp-main-split-panel > .lm-SplitPanel-handle')
    .first();
  const at = (await handle.boundingBox())!;
  const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + width - (await panelWidth(page)), y, { steps: 5 });
  await page.mouse.up();
  // the split panel can land 1/64 px short: within 0.5 px
  await expect.poll(() => panelWidth(page)).toBeCloseTo(width, 0);
}

/** The texts of the elements under `selector` that are cut: scrollWidth over clientWidth. */
export const cut = (scope: Locator, selector: string): Promise<string[]> =>
  scope
    .locator(selector)
    .evaluateAll(nodes =>
      nodes.filter(n => n.scrollWidth > n.clientWidth).map(n => n.textContent!)
    );

/**
 * How the element under `selector` in a row shows its text: `width` of its box,
 * `start` the width of its first four characters, `inside` its box within the
 * row's, `whole` nothing cut. A 0 px element still holds its text, so a test
 * of a row's layout reads widths.
 */
export const shows = (
  row: Locator,
  selector: string
): Promise<{ width: number; start: number; inside: boolean; whole: boolean }> =>
  row.evaluate((r, selector) => {
    const e = r.querySelector(selector)!;
    const text = document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode()!;
    const start = document.createRange();
    start.setStart(text, 0);
    start.setEnd(text, Math.min(4, text.textContent!.length));
    const [box, outer] = [e.getBoundingClientRect(), r.getBoundingClientRect()];
    return {
      width: box.width,
      start: start.getBoundingClientRect().width,
      inside: box.left >= outer.left && box.right <= outer.right,
      whole: e.scrollWidth <= e.clientWidth
    };
  }, selector);

/** The sidebar tab of the panel. */
export const PANEL_TAB = '.jp-SideBar [data-id="jp-running-sessions"]';

/** A name no other test of this run uses: presence refuses a closed tab's workspace for 90 s. */
export const fresh = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const card = (page: Page, id: string): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace="${id}"]`);

export const cardHeader = (page: Page, id: string): Locator =>
  card(page, id).locator('.jp-WorkspaceManager-cardHeader');

/** The triangle of a card: it opens or closes the card; a header click on another workspace's card switches to it. */
export const triangle = (page: Page, id: string): Locator =>
  card(page, id).locator('button.jp-WorkspaceManager-caret');

/** Open the card of `id` with its triangle unless it is open: the purpose and the counts show while it is (DQ-17). */
export async function openCard(page: Page, id: string): Promise<void> {
  if (!(await card(page, id).getAttribute('class'))!.includes('jp-mod-open')) {
    await triangle(page, id).click();
  }
  await expect(card(page, id)).toHaveClass(/jp-mod-open/);
}

export const headerButton = (page: Page, label: string): Locator =>
  page.locator(
    `${PANEL} .jp-WorkspaceManager-header button[aria-label="${label}"]`
  );

/** Open the workspace menu: a right-click on the card header, which carries no ... button (ACC-ACCORD-283-NO-DOTS). */
export async function openCardMenu(page: Page, id: string): Promise<void> {
  await cardHeader(page, id).click({ button: 'right' });
}

/** An item of the open workspace menu or of its Colour submenu. */
export const menuItem = (page: Page, label: string): Locator =>
  page
    .locator('.jp-WorkspaceManager-menu .lm-Menu-item')
    .filter({ hasText: new RegExp(`^${label}$`) });

/** Click a workspace menu item: the header's menu first, then the item. */
export async function fromMenu(
  page: Page,
  id: string,
  label: string
): Promise<void> {
  await openCardMenu(page, id);
  await menuItem(page, label).click();
}

/** This window shows workspace `id`: the Open workspace item of its ... menu is disabled. */
export async function expectCurrent(page: Page, id: string): Promise<void> {
  await openCardMenu(page, id);
  await expect(menuItem(page, 'Open workspace')).toHaveClass(/lm-mod-disabled/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.jp-WorkspaceManager-menu')).toHaveCount(0);
}

/** The colour the server records for a workspace. */
export async function colourOf(
  page: Page,
  id: string
): Promise<string | undefined> {
  const response = await page.request.get(
    '/jupyterlab-workspace-manager-extension/meta'
  );
  return (await response.json())[id]?.colour;
}

/** Any CSS colour, color-mix() and var() included, as the page draws it: 0-255 channels. */
export function rgb(page: Page, css: string): Promise<number[]> {
  return page.locator(PANEL).evaluate((panel, css) => {
    const probe = document.createElement('div');
    probe.style.color = css;
    panel.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, css);
}

/** Any CSS colour as the page draws it on nothing: 0-255 channels and 0-255 alpha. */
export function rgba(page: Page, css: string): Promise<number[]> {
  return page.locator(PANEL).evaluate((panel, css) => {
    const probe = document.createElement('div');
    probe.style.color = css;
    panel.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, css);
}

/** Show the panel in the left sidebar. */
export async function openPanel(page: Page): Promise<void> {
  const tab = page.locator(PANEL_TAB);
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
  }
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Press refresh and wait until its requests are back. */
export async function refresh(page: Page): Promise<void> {
  const button = headerButton(page, 'Refresh');
  await button.click();
  await expect(button).toBeEnabled(HEAVY_LOAD);
}

/** Save a workspace on the server; `data` is its state, such as a layout. */
export async function putWorkspace(
  page: Page,
  id: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  const response = await page.request.put(`/lab/api/workspaces/${id}`, {
    data: { data, metadata: { id } }
  });
  expect(response.ok()).toBe(true);
}

export async function deleteWorkspaces(
  page: Page,
  ids: string[]
): Promise<void> {
  await Promise.all(
    ids.map(id => page.request.delete(`/lab/api/workspaces/${id}`))
  );
}

/** The ids the server lists. */
export async function listed(page: Page): Promise<string[]> {
  const response = await page.request.get('/lab/api/workspaces');
  return (await response.json()).workspaces.ids;
}

/** Change a workspace's record (colour, purpose, hidden) on the server. */
export async function patchMeta(
  page: Page,
  id: string,
  change: Record<string, unknown>
): Promise<void> {
  const response = await page.request.patch(
    `/jupyterlab-workspace-manager-extension/meta/${id}`,
    { data: change }
  );
  expect(response.ok()).toBe(true);
}

/**
 * Open this window in its own new workspace, saved first so the first reload
 * lists it. Needs `mockState: false`.
 *
 * Galata waits 15 s for the app to start and offers no timeout for that wait,
 * so it is raised here for this navigation alone; at host load 88 a page took
 * longer and ACC-LISTS-135 failed at it.
 */
export async function gotoWorkspace(
  page: IJupyterLabPageFixture,
  id: string
): Promise<void> {
  await putWorkspace(page, id);
  const fixture = page as unknown as {
    waitForAppStarted: () => Promise<void>;
  };
  const wait = fixture.waitForAppStarted;
  fixture.waitForAppStarted = () =>
    page.waitForCondition(
      () =>
        page.evaluate(async () => {
          if (typeof (window as any).jupyterapp === 'object') {
            await (window as any).jupyterapp.started;
            return true;
          }
          return false;
        }),
      HEAVY_LOAD.timeout
    );
  try {
    await page.goto(`workspaces/${id}`, { timeout: HEAVY_LOAD.timeout });
  } finally {
    fixture.waitForAppStarted = wait;
  }
}

/**
 * Let the panel see only the workspaces `keep` accepts, so the specs that
 * other workers run at the same time add no card to a count.
 */
export async function onlyWorkspaces(
  page: Page,
  keep: (id: string) => boolean
): Promise<void> {
  await page.route(/\/lab\/api\/workspaces\/?(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const values = (await response.json()).workspaces.values.filter((w: any) =>
      keep(w.metadata.id)
    );
    await route.fulfill({
      response,
      json: {
        workspaces: { ids: values.map((w: any) => w.metadata.id), values }
      }
    });
  });
}

/** Answer GET `url` with only the entries `keep` accepts: the items of other tests are not this test's. */
export const only = (page: Page, url: RegExp, keep: (x: any) => boolean) =>
  page.route(url, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const json = response.ok()
      ? (await response.json()).filter(keep)
      : undefined;
    await route.fulfill({ response, json });
  });

/**
 * A saved layout holding these tab keys in the main area. A `terminal:<name>`
 * key gets the data the terminal tracker saves; any other key is a document
 * whose path follows the first colon.
 */
export function layout(keys: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {
    'layout-restorer:data': {
      main: { dock: { type: 'tab-area', currentIndex: 0, widgets: keys } }
    }
  };
  for (const key of keys) {
    const [kind, rest] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)];
    data[key] =
      kind === 'terminal'
        ? { data: { name: rest } }
        : {
            data: {
              path: rest,
              factory: kind === 'notebook' ? 'Notebook' : 'Editor'
            }
          };
  }
  return data;
}

/** A workspace's saved state as the server holds it. */
export async function saved(page: Page, id: string): Promise<any> {
  return (await (await page.request.get(`/lab/api/workspaces/${id}`)).json())
    .data;
}

/** The tab keys of a workspace's saved layout: its main area, depth first, then its down area. */
export async function savedTabs(page: Page, id: string): Promise<string[]> {
  const layout = (await saved(page, id))['layout-restorer:data'];
  const keys = (area: any): string[] =>
    !area
      ? []
      : area.type === 'tab-area'
        ? (area.widgets ?? [])
        : (area.children ?? []).flatMap(keys);
  return keys(layout?.main?.dock).concat(layout?.down?.widgets ?? []);
}

/** The workspaces windows other than `window` showed in the last 90 s. */
export async function shownElsewhere(
  page: Page,
  window = 'none'
): Promise<string[]> {
  const response = await page.request.get(
    `/jupyterlab-workspace-manager-extension/presence?window=${window}`
  );
  return (await response.json()).workspaces;
}

/**
 * A second browser window on the saved workspace `id`; it is up once its
 * report reached the server, so other windows refuse actions on `id`.
 */
export async function secondWindow(page: Page, id: string): Promise<Page> {
  const other = await page.context().newPage();
  await other.goto(`/lab/workspaces/${id}`);
  await expect(other.locator(PANEL_TAB)).toBeVisible({ timeout: 60000 });
  await expect.poll(() => shownElsewhere(page), UNDER_LOAD).toContain(id);
  return other;
}

/** A refusal for a workspace another window shows: its dialog names the action; dismiss it. */
export async function expectRefused(page: Page, action: string): Promise<void> {
  const dialog = page.locator('.jp-Dialog');
  await expect(dialog.locator('.jp-Dialog-header')).toHaveText(
    'Workspace open in another window'
  );
  await expect(dialog.locator('.jp-Dialog-body')).toContainText(
    `${action} is refused`
  );
  // JupyterLab's error dialog has one button, Close
  await dialog.locator('.jp-Dialog-button', { hasText: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Start a terminal through the REST API; the test shuts it down. Its name is
 * new: the server gives the lowest free number, so a terminal another test
 * started after this one ended would take this one's number. Letters and
 * digits only, as the routes of the terminals take `\w+`.
 */
export async function startTerminal(page: Page): Promise<string> {
  const response = await page.request.post('/api/terminals', {
    data: { name: fresh('wm').replace('-', '') }
  });
  return (await response.json()).name;
}

/**
 * This window in its own new workspace `current`, the panel showing only the
 * workspaces whose id starts with it, loaded and with no pointer over a card.
 */
export async function enterWorkspace(
  page: IJupyterLabPageFixture,
  current: string
): Promise<void> {
  await onlyWorkspaces(page, id => id.startsWith(current));
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  await page.mouse.move(0, 0);
}

/**
 * For a change of the kernel list whose criterion sets no time. The server
 * answers 500 to its kernel list while a kernel of another test starts; the
 * panel asks once more, keeps the last kernel list when that also fails, and
 * the next poll, 10 s later, shows the change.
 */
export const NEXT_POLL = { timeout: 15000 };

/**
 * For a wait whose criterion names no time: at Playwright's default worker
 * count (32 here) every browser shares the CPU with one test server, and a
 * typed command or a kernel start takes longer than the 5 s default. It stays
 * under the 30 s presence report, so a wait for the report at load cannot
 * pass on the periodic one.
 */
export const UNDER_LOAD = { timeout: 20000 };

/**
 * For a wait that failed at host load average 88 on this 64-core workstation:
 * the app started past Galata's 15 s, a refresh stayed disabled past 20 s, a
 * card count past Playwright's 5 s. It sits above the 30 s presence report, so
 * never use it to wait for the report: the periodic one would satisfy it.
 */
export const HEAVY_LOAD = { timeout: 60000 };

/**
 * For a kernel's execution state after a client connects to its session:
 * jupyter_server holds 'starting' until the kernel reports a status to the
 * client, so the wait follows the client's first request and covers startup
 * under CI load. A longer wait without a client never passes.
 */
export const KERNEL_START = { timeout: 60000 };

/** The header of the panel section `name`: workspaces, kernels, terminals or servers. */
export const sectionHeader = (page: Page, name: string): Locator =>
  page.locator(
    `${PANEL} .jp-WorkspaceManager-section[data-section="${name}"] .jp-WorkspaceManager-sectionHeader`
  );

/** The body of the panel section `name`; the section is open when it has one. */
export const sectionBody = (page: Page, name: string): Locator =>
  page.locator(
    `${PANEL} .jp-WorkspaceManager-section[data-section="${name}"] .jp-WorkspaceManager-sectionBody`
  );

/** The + button of the WORKSPACES section header, left of the eraser (ACC-PANEL-297-NEW-BAND). */
export const newButton = (page: Page): Locator =>
  sectionHeader(page, 'workspaces').locator(
    'button[aria-label="New workspace"]'
  );

/** The count in the header of the panel section `name`, such as (3). */
export const sectionCount = (page: Page, name: string): Locator =>
  page.locator(
    `${PANEL} .jp-WorkspaceManager-section[data-section="${name}"] .jp-WorkspaceManager-sectionCount`
  );

/** Open the panel section `name` if it is closed; the other sections stay as they are. */
export async function openSection(page: Page, name: string): Promise<void> {
  const header = sectionHeader(page, name);
  if ((await header.getAttribute('aria-expanded')) !== 'true') {
    await header.click();
  }
}

/** The label of a terminal's TERMINALS row (ACC-TERM-275-CARD-LABEL): t<n> for a name of digits, any other name as it is. */
export const rowLabel = (name: string): string =>
  /^\d+$/.test(name) ? `t${name}` : name;

/** The rows of a card whose label reads `text` exactly, or a terminal row named by its key; a card's numbered terminal row carries no tN (ACC-TERM-275-CARD-LABEL). */
export const rowOf = (c: Locator, text: string): Locator =>
  /^t\d+$/.test(text)
    ? c.locator(
        `.jp-WorkspaceManager-row[data-row-key="terminal:${text.slice(1)}"]`
      )
    : c
        .locator('.jp-WorkspaceManager-row')
        .filter({ has: c.page().getByText(text, { exact: true }) });

/** The row count of a card header: the tabs plus the terminals (ACC-ACCORD-276-NAME-COUNT). */
export const countOf = (c: Locator): Locator =>
  c.locator('.jp-WorkspaceManager-count');

export const dialog = (page: Page): Locator => page.locator('.jp-Dialog');

/**
 * A list of the server's REST API. The kernel and session lists answer 500
 * while a kernel of another test starts, so a failed answer is asked again.
 */
export async function serverList(page: Page, url: string): Promise<any[]> {
  let list: any[] = [];
  await expect
    .poll(async () => {
      const response = await page.request.get(url);
      if (response.ok()) {
        list = await response.json();
      }
      return response.ok();
    }, UNDER_LOAD)
    .toBe(true);
  return list;
}

/** The names of the terminals the server runs. */
export async function terminalNames(page: Page): Promise<string[]> {
  return (await serverList(page, '/api/terminals')).map(t => t.name);
}

/** The display name of a kernelspec, as the server lists it and the kernel picker shows it. */
export async function displayName(page: Page, name: string): Promise<string> {
  const specs = await (await page.request.get('/api/kernelspecs')).json();
  return specs.kernelspecs[name].spec.display_name;
}

/** The ids of the kernels the server runs. */
export async function kernelIds(page: Page): Promise<string[]> {
  return (await serverList(page, '/api/kernels')).map(k => k.id);
}

/** Right-click a row and click an item of its context menu. */
export async function fromRowMenu(row: Locator, label: string): Promise<void> {
  await row.click({ button: 'right' });
  await menuItem(row.page(), label).click();
}

/** Right-click a row, open its Move to workspace submenu and click workspace `target`. */
export async function moveTo(row: Locator, target: string): Promise<void> {
  await fromRowMenu(row, 'Move to workspace');
  await menuItem(row.page(), target).click();
}

/** Change a setting of the lab in this page; the default mockSettings keeps it in the browser. */
export async function setSetting(
  page: Page,
  plugin: string,
  key: string,
  value: boolean
): Promise<void> {
  await page.evaluate(
    async ({ plugin, key, value }) => {
      const registry = await (window as any).galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      await registry.set(plugin, key, value);
    },
    { plugin, key, value }
  );
}

/** Start a notebook session with a python3 kernel through the REST API; the test deletes it. */
export async function startSession(page: Page, path: string): Promise<any> {
  const response = await page.request.post('/api/sessions', {
    data: {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      type: 'notebook',
      kernel: { name: 'python3' }
    }
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

/** An empty notebook on the server whose kernel is python3, so it opens without a kernel dialog. */
export async function putNotebook(page: Page, path: string): Promise<void> {
  const content = {
    cells: [],
    metadata: {
      kernelspec: {
        name: 'python3',
        display_name: 'Python 3',
        language: 'python'
      }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
  const response = await page.request.put(`/api/contents/${path}`, {
    data: { type: 'notebook', format: 'json', content }
  });
  expect(response.ok()).toBe(true);
}

/** Send `text` to a terminal's standard input over its websocket, as a terminal tab does. */
export async function sendToTerminal(
  page: Page,
  name: string,
  text: string
): Promise<void> {
  await page.evaluate(
    async ({ name, text }) => {
      const { wsUrl } = (window as any).jupyterapp.serviceManager
        .serverSettings;
      const ws = new WebSocket(`${wsUrl}terminals/websocket/${name}`);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      ws.send(JSON.stringify(['stdin', text]));
      // the server reads the message before the socket closes
      await new Promise(resolve => setTimeout(resolve, 500));
      ws.close();
    },
    { name, text }
  );
}

/**
 * For a program sent to a terminal to reach the foreground of its pty: a new
 * shell reads its input only once it has started, which at host load takes
 * longer than UNDER_LOAD. The wait follows the state the server reports.
 */
export const PROCESS_START = { timeout: 45000 };

/** The foreground process the server reports for a terminal. */
export async function processOf(
  page: Page,
  name: string
): Promise<string | null | undefined> {
  const list = await serverList(
    page,
    '/jupyterlab-workspace-manager-extension/terminals'
  );
  return list.find(t => t.name === name)?.process;
}

/** The command line the server reports for a terminal's foreground process. */
export async function commandOf(
  page: Page,
  name: string
): Promise<string | null | undefined> {
  const list = await serverList(
    page,
    '/jupyterlab-workspace-manager-extension/terminals'
  );
  return list.find(t => t.name === name)?.command;
}

/** The working directory the server reports for a terminal's foreground process. */
export async function cwdOf(
  page: Page,
  name: string
): Promise<string | null | undefined> {
  const list = await serverList(
    page,
    '/jupyterlab-workspace-manager-extension/terminals'
  );
  return list.find(t => t.name === name)?.cwd;
}

/** Run `sleep` in a terminal and wait until the server reports it in the foreground. */
export async function sleepInTerminal(page: Page, name: string): Promise<void> {
  await sendToTerminal(page, name, 'sleep 600\n');
  await expect.poll(() => processOf(page, name), PROCESS_START).toBe('sleep');
}

/** Open a document of the server in a tab of this window. */
export async function openDocument(page: Page, path: string): Promise<void> {
  // the widget the command returns is not sent back: Playwright cannot serialize it
  await page.evaluate(async path => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path
    });
  }, path);
}

/** Close the Launcher tab, which a new workspace opens with and JupyterLab does not save. */
export async function closeLauncher(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const w of (window as any).jupyterapp.shell.widgets('main')) {
      if (w.node.querySelector('.jp-Launcher')) {
        w.close();
      }
    }
  });
}

/** Open a new terminal in a tab of this window; its name. */
export function newTerminalTab(page: Page): Promise<string> {
  return page.evaluate(
    async () =>
      (await (window as any).jupyterapp.commands.execute('terminal:create-new'))
        .content.session.name
  );
}

/** The terminal name or document path of this window's active tab. */
export function activeTab(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const w = (window as any).jupyterapp.shell.currentWidget;
    return w?.content?.session?.name ?? w?.context?.path;
  });
}

/**
 * Put a connection of a fake language server into the lab's connection manager
 * (`add`) or take it out, then tell the Language servers section, so the
 * LANGUAGE SERVERS section lists it as `fake-lsp (python)`. It carries what the
 * panel's shutdown reads: a document to unregister and a dispose. `servers`
 * gives the connection key and the server identifier of each, one by default.
 */
export async function languageServer(
  page: Page,
  add: boolean,
  servers: [string, string][] = [['workspace-manager-test', 'fake-lsp']]
): Promise<void> {
  await page.evaluate(
    async ({ add, servers }) => {
      const galata = (window as any).galata;
      const manager = await galata.getPlugin(
        '@jupyterlab/lsp-extension:plugin'
      );
      for (const [key, identifier] of servers) {
        if (add) {
          manager.connections.set(key, {
            serverIdentifier: identifier,
            serverLanguage: 'python',
            dispose: () => undefined
          });
          manager.documents.set(key, { uri: key });
        } else {
          manager.connections.delete(key);
          manager.documents.delete(key);
        }
      }
      const managers = await galata.getPlugin(
        '@jupyterlab/running-extension:plugin'
      );
      managers
        .items()
        .find((m: any) => m.name === 'Language servers')
        .runningChanged.emit(undefined);
    },
    { add, servers }
  );
}
