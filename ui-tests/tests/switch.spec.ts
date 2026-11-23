import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

import {
  activeTab,
  card,
  cardHeader,
  closeLauncher,
  countOf,
  deleteWorkspaces,
  enterWorkspace,
  expectCurrent,
  expectRefused,
  fresh,
  gotoWorkspace,
  HEAVY_LOAD,
  layout,
  newTerminalTab,
  NEXT_POLL,
  openCard,
  openDocument,
  openPanel,
  putNotebook,
  putWorkspace,
  refresh,
  rowOf,
  saved,
  savedTabs,
  secondWindow,
  startTerminal,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces and the switch channel of the server
test.use({ autoGoto: false, mockState: false });
// the drain can wait out a request's 90 s expire, longer than the default test timeout
test.describe.configure({ timeout: 180000 });

/**
 * An unread switch request stays live 90 s for every window id that has not
 * read it, so a window of the next test would apply a request meant for the
 * previous one. Every test starts on an empty channel.
 */

const ROOT = path.resolve(__dirname, '../..');

/** The mockup page served beside the lab on WM_PAGE_PORT: its document title is TITLE. */
const PAGE_URL = `/proxy/${process.env.WM_PAGE_PORT}/workbench-card-mockup.html`;
const TITLE = 'WORKBENCH Card Mockup';

/** The URL of a workspace in this lab. */
const workspaceURL = (id: string) =>
  new RegExp(`/lab/workspaces/${id}(\\?.*)?$`);

/**
 * Run the CLI in this test process against the test server. The installed
 * `jupyterlab-workspace` command lags the working tree, so the module runs
 * from the repository root. The lab's own environment variables are removed:
 * the session that runs the tests is itself a lab window, and the first of
 * those variables set would send the request there instead.
 */
async function cli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const {
    JUPYTER_SERVER_URL,
    JUPYTERHUB_SERVICE_PREFIX,
    JUPYTERHUB_API_TOKEN,
    JPY_API_TOKEN,
    JUPYTER_TOKEN,
    JUPYTER_SERVER_ROOT,
    ...env
  } = process.env;
  try {
    const { stdout, stderr } = await promisify(execFile)(
      'python',
      ['-m', 'jupyterlab_workspace_manager_extension.cli', ...args],
      {
        cwd: ROOT,
        env: { ...env, JUPYTER_PORT: process.env.JUPYTER_TEST_PORT ?? '8888' },
        timeout: 60000
      }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? ''
    };
  }
}

/** Wait for the application of the document a switch navigated this window to. */
async function appStarted(
  page: IJupyterLabPageFixture,
  timeout = 30000
): Promise<void> {
  await page.waitForCondition(
    () =>
      page.evaluate(async () => {
        if (typeof (window as any).jupyterapp === 'object') {
          await (window as any).jupyterapp.started;
          return true;
        }
        return false;
      }),
    timeout
  );
}

/** Wait until the shell applied the workspace's saved layout, the left sidebar included. */
async function layoutRestored(
  page: IJupyterLabPageFixture,
  timeout = 30000
): Promise<void> {
  await page.waitForCondition(
    () =>
      page.evaluate(async () => {
        if (typeof (window as any).jupyterapp === 'object') {
          await (window as any).jupyterapp.restored;
          return true;
        }
        return false;
      }),
    timeout
  );
}

/** The right sidebar a workspace's file saves: its open panel's saved name and whether it is collapsed. */
const savedRight = async (
  page: IJupyterLabPageFixture,
  id: string
): Promise<{ current?: string; collapsed?: boolean }> =>
  (await saved(page, id))['layout-restorer:data']?.right ?? {};

/** The right sidebar panel this window shows. */
const liveRight = (
  page: IJupyterLabPageFixture
): Promise<{ current: string | null; collapsed: boolean }> =>
  page.evaluate(() => {
    const right = (window as any).jupyterapp.shell.saveLayout().rightArea;
    return {
      current: right.currentWidget?.id ?? null,
      collapsed: right.collapsed
    };
  });

/** Open a right sidebar panel through the command its tab and the palette run. */
const showRightPanel = (page: Page, command: string): Promise<void> =>
  page.evaluate(async command => {
    await (window as any).jupyterapp.commands.execute(command);
  }, command);

/** Wait out a switch: the page starts, restores its layout and shows the panel. */
async function switchedTo(
  page: IJupyterLabPageFixture,
  id: string
): Promise<void> {
  await page.waitForURL(workspaceURL(id), {
    timeout: HEAVY_LOAD.timeout,
    waitUntil: 'commit'
  });
  await appStarted(page, HEAVY_LOAD.timeout);
  await layoutRestored(page, HEAVY_LOAD.timeout);
  await openPanel(page);
  await expect(cardHeader(page, id)).toBeVisible({
    timeout: HEAVY_LOAD.timeout
  });
  await refresh(page);
}

/** The id the panel uses for this window: window.name, which survives a reload. */
const windowId = (page: IJupyterLabPageFixture): Promise<string> =>
  page.evaluate(() => window.name);

/** Run workspace-page:open with `args` in this window. */
const openPage = (page: Page, args: Record<string, unknown>) =>
  page.evaluate(async (openArgs: Record<string, unknown>) => {
    await (window as any).jupyterapp.commands.execute(
      'workspace-page:open',
      openArgs
    );
  }, args);

/** Open a file of the server in an Editor tab of this window. */
const openEditor = (page: Page, path: string) =>
  page.evaluate(async file => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: file,
      factory: 'Editor'
    });
  }, path);

/** A notebook of `cells` code cells on the server; opening it executes nothing. */
async function putManyCellNotebook(
  page: IJupyterLabPageFixture,
  path: string,
  cells: number
): Promise<void> {
  const content = {
    cells: Array.from({ length: cells }, (_, i) => ({
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: [`print(${i})`]
    })),
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

/** The notebook tab of this window: its window scroll, active cell and that cell's scroll. */
const notebookState = (page: IJupyterLabPageFixture) =>
  page.evaluate(() => {
    for (const w of Array.from<any>(
      (window as any).jupyterapp.shell.widgets('main')
    )) {
      if (w.hasClass('jp-NotebookPanel')) {
        return {
          scroll: w.content.outerNode.scrollTop,
          cell: w.content.activeCellIndex,
          cellScroll:
            w.content.activeCell?.editor?.editor?.scrollDOM?.scrollTop ?? 0
        };
      }
    }
    return null;
  });

/** The editor tab of this window: its scroller scroll and its cursor. */
const editorState = (page: IJupyterLabPageFixture) =>
  page.evaluate(() => {
    for (const w of Array.from<any>(
      (window as any).jupyterapp.shell.widgets('main')
    )) {
      if (w.content?.editor?.getCursorPosition) {
        return {
          scroll: w.content.editor.editor.scrollDOM.scrollTop,
          cursor: w.content.editor.getCursorPosition()
        };
      }
    }
    return null;
  });

/** Set the editor tab's cursor, then its scroller scroll, as a reader leaves it. */
const setEditor = (
  page: IJupyterLabPageFixture,
  scroll: number,
  cursor: { line: number; column: number }
) =>
  page.evaluate(
    ({ scroll, cursor }) => {
      const w = Array.from<any>(
        (window as any).jupyterapp.shell.widgets('main')
      ).find(w => w.content?.editor?.getCursorPosition);
      w.content.editor.setCursorPosition(cursor, { scroll: false });
      w.content.editor.editor.scrollDOM.scrollTop = scroll;
    },
    { scroll, cursor }
  );

/**
 * Wait until no switch request is live. A read marks a request delivered to
 * the reading window only, so each poll uses a new id: a fixed one would hide
 * the request after its first read. A request naming no workspace has no file
 * to drop it, so it stays live until its 90 s expire; the poll waits that long.
 */
async function channelEmpty(page: Page): Promise<void> {
  let probe = 0;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/jupyterlab-workspace-manager-extension/switch?window=switch-drain-${probe++}`
            )
          ).json()
        ).requests.length,
      { timeout: 95000, intervals: [2000] }
    )
    .toBe(0);
}

test.beforeEach(async ({ page }) => {
  await channelEmpty(page);
});

test('ACC-CLI-219-SWITCH-WORKSPACE: workspaces switch --window moves that window to the named workspace within 2 s and leaves the other window', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swone');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    await enterWorkspace(page, current);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);
    const stayed = other.url();
    const id = await windowId(page);

    const run = await cli(['workspaces', 'switch', target, '--window', id]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `requested switch to workspace ${target} in window ${id}`
    );
    // the criterion's 2 s, counted from the CLI's return, which follows its
    // request: the window polls the channel every second
    await page.waitForURL(workspaceURL(target), {
      timeout: 2000,
      waitUntil: 'commit'
    });

    // the other window was not named and stays where it was
    await other.waitForTimeout(2500);
    expect(other.url()).toBe(stayed);

    // the panel of the switched window shows the target workspace as its own
    await appStarted(page);
    await openPanel(page);
    await expectCurrent(page, target);
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});

test('ACC-CLI-220-SWITCH-TAB: tabs activate activates the tab showing the path in the window and selects its row', async ({
  page,
  tmpPath
}) => {
  const current = fresh('swtab');
  const [one, two] = [`${tmpPath}/one.txt`, `${tmpPath}/two.txt`];
  for (const doc of [one, two]) {
    await page.contents.uploadContent('text', 'text', doc);
  }
  try {
    await enterWorkspace(page, current);
    await openDocument(page, one);
    await openDocument(page, two);
    await openDocument(page, one);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(one);
    // the CLI checks the tab against the saved workspaces: this window's
    // workspace saves the two tabs it shows
    await putWorkspace(
      page,
      current,
      layout([`editor:${one}`, `editor:${two}`])
    );

    const run = await cli(['tabs', 'activate', two]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested activation of tab ${two}`);

    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(two);
    await expect(
      card(page, current).locator('.jp-WorkspaceManager-row.jp-mod-selected')
    ).toHaveCount(1);
    await expect(rowOf(card(page, current), 'two.txt')).toHaveClass(
      /jp-mod-selected/
    );
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: an unknown workspace name is refused and nothing is sent', async ({
  page
}) => {
  const current = fresh('swnd');
  const missing = `${current}-missing`;
  await putWorkspace(page, current);
  try {
    await enterWorkspace(page, current);
    const run = await cli(['workspaces', 'switch', missing]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`workspace ${missing} does not exist`);
    expect(run.stdout).toBe('');

    // no request was posted: the window does not move, and no card changes
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(workspaceURL(current));
    await expectCurrent(page, current);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-CLI-220-SWITCH-TAB: tabs activate --workspace switches the window first and then makes that tab the active widget', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const current = fresh('swwst');
  const target = `${current}-target`;
  const [kept, wanted] = [`${tmpPath}/kept.txt`, `${tmpPath}/wanted.txt`];
  for (const doc of [kept, wanted]) {
    await page.contents.uploadContent('text', 'text', doc);
  }
  // the wanted tab is saved second, so the restored window shows the other one
  await putWorkspace(
    page,
    target,
    layout([`editor:${kept}`, `editor:${wanted}`])
  );
  try {
    await enterWorkspace(page, current);

    const run = await cli(['tabs', 'activate', wanted, '--workspace', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `requested activation of tab ${wanted} in workspace ${target}`
    );

    // the window switches first; the tab is activated once its workspace shows
    await page.waitForURL(workspaceURL(target), {
      timeout: 10000,
      waitUntil: 'commit'
    });
    await appStarted(page);
    await openPanel(page);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(wanted);
    await expect(rowOf(card(page, target), 'wanted.txt')).toHaveClass(
      /jp-mod-selected/
    );
  } finally {
    await deleteWorkspaces(page, [current, target]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: a broadcast switch is refused in a window another window shows the workspace on, and no window moves', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swref');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    // this window shows the target, so the broadcast has nowhere to move it
    await enterWorkspace(page, target);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);
    const stayed = [page.url(), other.url()];

    const run = await cli(['workspaces', 'switch', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested switch to workspace ${target}`);

    // the refusal is the deterministic answer to a broadcast; a hidden tab's
    // slower read is not observable here, as the harness runs with
    // --disable-background-timer-throttling
    await other.waitForTimeout(2500);
    expect([page.url(), other.url()]).toEqual(stayed);
    await expect(other.locator('.jp-Dialog')).toBeVisible();
    await expect(other.locator('.jp-Dialog-body')).toContainText(target);
    await expectRefused(other, 'Switch to workspace');
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: of two eligible windows a broadcast switch moves exactly one and the other refuses', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swtwo');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    // neither window shows the target
    await enterWorkspace(page, current);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);

    // the claim is one server operation: both windows post it, one is stored and one refused
    const presencePost = (window: Page) =>
      window.waitForResponse(
        r =>
          r.request().method() === 'POST' &&
          r.url().includes('/jupyterlab-workspace-manager-extension/presence')
      );
    const answers = Promise.all([presencePost(page), presencePost(other)]);

    const run = await cli(['workspaces', 'switch', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested switch to workspace ${target}`);
    expect((await answers).map(r => r.status()).sort()).toEqual([204, 409]);

    // exactly one window moves
    await expect
      .poll(
        () =>
          [page.url(), other!.url()].filter(u => workspaceURL(target).test(u))
            .length,
        { timeout: 10000 }
      )
      .toBe(1);
    // the window that stayed is refused in the dialog the claim's 409 shows
    await expectRefused(
      workspaceURL(target).test(page.url()) ? other! : page,
      'Switch to workspace'
    );
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});

test('ACC-CLI-171-LIST-OUT, DEF-PANEL-69-TABS-SAMEFILE: the card and workspaces list agree on an editor and its Markdown preview; the Launcher counts in neither (ACC-ACCORD-300-NO-LAUNCHER) and a second New View counts only in the card', async ({
  page,
  tmpPath
}) => {
  const current = fresh('cardcli');
  const file = `${tmpPath}/agree.md`;
  const editor = `editor:${file}`;
  const preview = `markdownviewer-widget:${file}`;
  const inCli = async (): Promise<number | undefined> => {
    const run = await cli(['workspaces', 'list', '--json']);
    expect(run.code).toBe(0);
    return (JSON.parse(run.stdout) as { name: string; tabs: number }[]).find(
      row => row.name === current
    )?.tabs;
  };
  /** The tabs of the saved layout: the wait that makes a read of the CLI mean something. */
  const savedKeys = async (): Promise<string[]> => {
    const dock = (await saved(page, current))['layout-restorer:data']?.main
      ?.dock;
    const keys = (area: any): string[] =>
      area?.type === 'tab-area'
        ? area.widgets
        : (area?.children ?? []).flatMap(keys);
    return keys(dock).sort();
  };
  await page.contents.uploadContent('# agree\n', 'text', file);
  try {
    await enterWorkspace(page, current);
    await page.evaluate(async path => {
      const { commands } = (window as any).jupyterapp;
      await commands.execute('docmanager:open', { path, factory: 'Editor' });
      await commands.execute('fileeditor:markdown-preview');
    }, file);
    await cardHeader(page, current).click();
    const count = countOf(card(page, current));

    // the Launcher counts in neither (ACC-ACCORD-300-NO-LAUNCHER)
    await expect.poll(savedKeys, UNDER_LOAD).toEqual([editor, preview]);
    await expect(count).toHaveText('(2)');
    expect(await inCli()).toBe(2);

    // an editor and its preview: 2 in both
    await closeLauncher(page);
    await expect(count).toHaveText('(2)');
    expect(await inCli()).toBe(2);
    const listed = await cli(['tabs', 'list', current, '--json']);
    expect(
      (JSON.parse(listed.stdout) as { key: string }[]).map(t => t.key).sort()
    ).toEqual([editor, preview]);

    // a second New View of the active tab: the layout repeats its key, and the card alone counts it
    await expect
      .poll(
        () =>
          page.evaluate(
            () => !!(window as any).jupyterapp.shell.currentWidget?.context
          ),
        UNDER_LOAD
      )
      .toBe(true);
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:clone')
    );
    await expect
      .poll(async () => {
        const keys = await savedKeys();
        return [keys.length, new Set(keys).size];
      }, UNDER_LOAD)
      .toEqual([3, 2]);
    await expect(count).toHaveText('(3)');
    expect(await inCli()).toBe(2);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("ACC-ACCORD-300-NO-LAUNCHER: this window's card with a Launcher, a notebook and a terminal lists two rows and reads (2); a saved layout with a launcher key, a notebook and a terminal lists two rows, reads (2) on its card and 2 in the TABS column of workspaces list", async ({
  page,
  tmpPath
}) => {
  const current = fresh('nolaunch');
  const other = `${current}-saved`;
  const notebook = `${tmpPath}/launched.ipynb`;
  const terminal = await startTerminal(page);
  const tabsInCli = async (id: string): Promise<number | undefined> => {
    const run = await cli(['workspaces', 'list', '--json']);
    expect(run.code).toBe(0);
    return (JSON.parse(run.stdout) as { name: string; tabs: number }[]).find(
      row => row.name === id
    )?.tabs;
  };
  await putNotebook(page, notebook);
  await putWorkspace(
    page,
    other,
    layout([
      'launcher:launcher',
      `notebook:${notebook}`,
      `terminal:${terminal}`
    ])
  );
  let mine: string | undefined;
  try {
    // a new workspace opens with the Launcher
    await enterWorkspace(page, current);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Array.from((window as any).jupyterapp.shell.widgets('main')).some(
              (w: any) => !!w.node.querySelector('.jp-Launcher')
            )
          ),
        UNDER_LOAD
      )
      .toBe(true);
    await openDocument(page, notebook);
    mine = await newTerminalTab(page);
    await cardHeader(page, current).click();
    const own = card(page, current);
    await expect(own.locator('.jp-WorkspaceManager-row')).toHaveCount(
      2,
      UNDER_LOAD
    );
    await expect(countOf(own)).toHaveText('(2)');
    await expect(rowOf(own, 'Launcher')).toHaveCount(0);

    // another workspace whose saved layout holds a launcher key
    await refresh(page);
    await openCard(page, other);
    const stored = card(page, other);
    await expect(stored.locator('.jp-WorkspaceManager-row')).toHaveCount(2);
    await expect(
      stored.locator('.jp-WorkspaceManager-row[data-row-key^="launcher:"]')
    ).toHaveCount(0);
    await expect(countOf(stored)).toHaveText('(2)');
    expect(await tabsInCli(other)).toBe(2);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    if (mine) {
      await page.request.delete(`/api/terminals/${mine}`);
    }
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-PANEL-325-FILE-POSITION: a workspace returns to its own notebook scroll, active cell, editor scroll and cursor after a switch, and each workspace keeps its own', async ({
  page,
  tmpPath
}) => {
  const a = fresh('swpos');
  const b = `${a}-b`;
  const notebook = `${tmpPath}/many.ipynb`;
  const markdown = `${tmpPath}/long.md`;
  // the notebook's window at 600 px with cell 20 active; the editor at 300 px, cursor line 60
  const CELL = 20;
  const SCROLL = 600;
  const EDIT_SCROLL = 300;
  const CURSOR = { line: 60, column: 4 };
  // B's editor, on the same file, at another place
  const B_SCROLL = 500;
  const B_CURSOR = { line: 120, column: 2 };
  await putManyCellNotebook(page, notebook, 80);
  await page.contents.uploadContent(
    Array.from(
      { length: 400 },
      (_, i) => `line ${i} of the long markdown document`
    ).join('\n'),
    'text',
    markdown
  );
  await putWorkspace(
    page,
    a,
    layout([`notebook:${notebook}`, `editor:${markdown}`])
  );
  await putWorkspace(page, b, layout([`editor:${markdown}`]));

  // the enter helper PUTs an empty workspace; this opens the layout already saved
  const open = async (id: string): Promise<void> => {
    // Galata's page.goto waits 15 s for an active Launcher tab after the app
    // starts, and a saved notebook-and-editor layout has none; the raw
    // navigation skips that wait and the explicit waits below replace it
    const raw = page as unknown as { page: Page };
    await raw.page.goto(`${page.appPath}/workspaces/${id}`, {
      waitUntil: 'commit',
      timeout: HEAVY_LOAD.timeout
    });
    await page.waitForURL(workspaceURL(id), {
      timeout: HEAVY_LOAD.timeout,
      waitUntil: 'commit'
    });
    await appStarted(page, HEAVY_LOAD.timeout);
    await layoutRestored(page, HEAVY_LOAD.timeout);
    await openPanel(page);
    await expect(cardHeader(page, id)).toBeVisible({
      timeout: HEAVY_LOAD.timeout
    });
    await refresh(page);
  };

  // a card-header switch is a full page load: wait for this workspace itself,
  // not Galata's 15 s app wait
  const switchTo = async (id: string): Promise<void> => {
    await cardHeader(page, id).click();
    await page.waitForURL(workspaceURL(id), {
      timeout: HEAVY_LOAD.timeout,
      waitUntil: 'commit'
    });
    await appStarted(page, HEAVY_LOAD.timeout);
    await layoutRestored(page, HEAVY_LOAD.timeout);
    await openPanel(page);
    await expect(cardHeader(page, id)).toBeVisible({
      timeout: HEAVY_LOAD.timeout
    });
    await refresh(page);
  };

  try {
    await open(a);
    await page.waitForSelector('.jp-Notebook .jp-Cell');
    await page.evaluate(
      ({ cell, scroll }) => {
        const notebook = Array.from<any>(
          (window as any).jupyterapp.shell.widgets('main')
        ).find(w => w.hasClass('jp-NotebookPanel'));
        notebook.content.activeCellIndex = cell;
        notebook.content.outerNode.scrollTop = scroll;
      },
      { cell: CELL, scroll: SCROLL }
    );
    await expect
      .poll(() => notebookState(page), UNDER_LOAD)
      .toMatchObject({ cell: CELL, scroll: SCROLL });

    // the editor tab must be shown before its scroller takes a scroll
    await page.getByRole('tab', { name: /long\.md/ }).click();
    await page.waitForSelector('.jp-FileEditor .cm-content', {
      state: 'visible'
    });
    await setEditor(page, EDIT_SCROLL, CURSOR);
    await expect
      .poll(() => editorState(page), UNDER_LOAD)
      .toEqual({ scroll: EDIT_SCROLL, cursor: CURSOR });

    // away to B: a full page load, which stores A's positions and applies B's (none yet)
    await switchTo(b);
    await page.waitForSelector('.jp-FileEditor .cm-content', {
      state: 'visible'
    });
    await setEditor(page, B_SCROLL, B_CURSOR);
    await expect
      .poll(() => editorState(page), UNDER_LOAD)
      .toEqual({ scroll: B_SCROLL, cursor: B_CURSOR });

    // back to A: its own notebook scroll, active cell, editor scroll and cursor;
    // a tab hidden at the restore takes its place when it first shows
    await switchTo(a);
    await page.getByRole('tab', { name: /many\.ipynb/ }).click();
    await expect
      .poll(() => notebookState(page), HEAVY_LOAD)
      .toMatchObject({ scroll: SCROLL, cell: CELL });
    await page.getByRole('tab', { name: /long\.md/ }).click();
    await expect
      .poll(() => editorState(page), HEAVY_LOAD)
      .toEqual({ scroll: EDIT_SCROLL, cursor: CURSOR });

    // back to B: its own editor offset, not A's
    await switchTo(b);
    await expect
      .poll(() => editorState(page), HEAVY_LOAD)
      .toEqual({ scroll: B_SCROLL, cursor: B_CURSOR });
  } finally {
    await deleteWorkspaces(page, [a, b]);
  }
});

test('DEF-PANEL-110-RIGHT-PANEL: each workspace returns to its own right sidebar panel after a switch, while the other keeps its own', async ({
  page
}) => {
  const a = fresh('swright');
  const b = `${a}-b`;
  await putWorkspace(page, a);
  await putWorkspace(page, b);
  try {
    await enterWorkspace(page, a);

    // open the property inspector and leave at once, inside JupyterLab's 500 ms save window
    await showRightPanel(page, 'property-inspector:show-panel');
    await cardHeader(page, b).click();
    await switchedTo(page, b);

    // A's file carries the panel it had open
    await expect
      .poll(async () => savedRight(page, a), UNDER_LOAD)
      .toMatchObject({ current: 'jp-property-inspector', collapsed: false });

    // back to A: its own panel
    await cardHeader(page, a).click();
    await switchedTo(page, a);
    await expect
      .poll(() => liveRight(page), UNDER_LOAD)
      .toMatchObject({ current: 'jp-property-inspector', collapsed: false });

    // B gets its own, the debugger, and the departure at once saves it
    await cardHeader(page, b).click();
    await switchedTo(page, b);
    await showRightPanel(page, 'debugger:show-panel');
    await cardHeader(page, a).click();
    await switchedTo(page, a);
    await expect
      .poll(async () => savedRight(page, b), UNDER_LOAD)
      .toMatchObject({ current: 'debugger-sidebar', collapsed: false });

    // A still shows its own panel, not B's debugger
    await expect
      .poll(() => liveRight(page), UNDER_LOAD)
      .toMatchObject({ current: 'jp-property-inspector', collapsed: false });

    // B returns to the debugger it had
    await cardHeader(page, b).click();
    await switchedTo(page, b);
    await expect
      .poll(() => liveRight(page), UNDER_LOAD)
      .toMatchObject({ current: 'jp-debugger-sidebar', collapsed: false });
  } finally {
    await deleteWorkspaces(page, [a, b]);
  }
});

test("ACC-PANEL-326-TABNAMES-LIVE: a left workspace's card shows a page tab's saved document title and a renamed document's new name without switching back", async ({
  page
}) => {
  const a = fresh('swlive');
  const b = `${a}-b`;
  const doc = 'docs/README.md';
  const renamed = 'docs/README-live.md';
  // a retried or repeated run starts from no file of either name
  await page.contents.deleteFile(doc);
  await page.contents.deleteFile(renamed);
  expect(await page.contents.uploadContent('# readme\n', 'text', doc)).toBe(
    true
  );
  try {
    // this window on A; B is listed so the window can leave and come back
    await putWorkspace(page, b);
    await enterWorkspace(page, a);

    // a page opened with no title takes its document title, and A's file saves it
    await openPage(page, { url: PAGE_URL, id: 'wm-live' });
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab', { hasText: TITLE })
    ).toHaveCount(1, UNDER_LOAD);
    await expect
      .poll(
        async () =>
          (await saved(page, a))['workspace-page:wm-live']?.data?.documentTitle,
        NEXT_POLL
      )
      .toBe(TITLE);

    // a document open in A, named in A's saved layout
    await openEditor(page, doc);
    await expect
      .poll(() => savedTabs(page, a), NEXT_POLL)
      .toContain(`editor:${doc}`);

    // leave A: its card shows the page tab's saved document title
    await gotoWorkspace(page, b);
    await openPanel(page);
    await refresh(page);
    await expect(cardHeader(page, a)).toBeVisible({
      timeout: HEAVY_LOAD.timeout
    });
    await openCard(page, a);
    await expect(rowOf(card(page, a), TITLE)).toBeVisible(NEXT_POLL);

    // back on A, rename the document: the panel repoints A's saved layout
    await cardHeader(page, a).click();
    await page.waitForURL(workspaceURL(a), {
      timeout: HEAVY_LOAD.timeout,
      waitUntil: 'commit'
    });
    await appStarted(page, HEAVY_LOAD.timeout);
    await layoutRestored(page, HEAVY_LOAD.timeout);
    await openPanel(page);
    await refresh(page);
    // the rename goes through this window's own contents service, which moves
    // the open tab: Galata's in-page helper still holds the pre-navigation app
    await page.evaluate(
      async ([oldPath, newPath]) => {
        await (window as any).jupyterapp.serviceManager.contents.rename(
          oldPath,
          newPath
        );
      },
      [doc, renamed]
    );
    await expect
      .poll(() => savedTabs(page, a), NEXT_POLL)
      .toContain(`editor:${renamed}`);

    // back on B: A's card shows the renamed tab
    await cardHeader(page, b).click();
    await page.waitForURL(workspaceURL(b), {
      timeout: HEAVY_LOAD.timeout,
      waitUntil: 'commit'
    });
    await appStarted(page, HEAVY_LOAD.timeout);
    await layoutRestored(page, HEAVY_LOAD.timeout);
    await openPanel(page);
    await expect(cardHeader(page, a)).toBeVisible({
      timeout: HEAVY_LOAD.timeout
    });
    await openCard(page, a);
    await expect(rowOf(card(page, a), 'README-live.md')).toBeVisible(NEXT_POLL);
  } finally {
    await deleteWorkspaces(page, [a, b]);
    await page.contents.deleteFile(doc);
    await page.contents.deleteFile(renamed);
  }
});
