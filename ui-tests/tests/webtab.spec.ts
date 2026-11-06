import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  HEAVY_LOAD,
  moveTo,
  openCard,
  openPanel,
  putWorkspace,
  rowOf,
  saved,
  savedTabs,
  triangle,
  UNDER_LOAD
} from './helpers';

/**
 * The web page tabs a workspace saves, moved between workspaces
 * (DEF-PANEL-90-MOVE-WEBTAB), and a page tab reopened after a reload
 * (ACC-OPEN-303-PAGE-RESTORE). The pages come from the comment store beside
 * the lab, as in page.spec.ts: start `python3 tmp/mockups/serve.py <port>` and
 * pass the port as WM_PAGE_PORT; the lab reaches it through /proxy/<port>/.
 */
const PORT = Number(process.env.WM_PAGE_PORT);
const url = `/proxy/${PORT}/workbench-card-mockup.html`;
const ICON = `/proxy/${PORT}/icon.svg`;
const TABS = '#jp-main-dock-panel .lm-TabBar-tab';
const IFRAMES = '#jp-main-dock-panel iframe';
const REFUSED =
  'Move to workspace is refused: JupyterLab does not save this kind of tab in a workspace, so it cannot be moved. Open it again in the other workspace.';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

test.beforeEach(() => {
  if (!PORT) {
    throw new Error(
      'WM_PAGE_PORT is not set: start tmp/mockups/serve.py <port> first'
    );
  }
});

/** Run `command` with `args` in this window; the id and the url of the tab's content, which name its saved entry. */
function openWeb(
  page: Page,
  command: string,
  args: Record<string, unknown>
): Promise<{ id: string; url: string }> {
  return page.evaluate(
    async ({ command, args }) => {
      const { content } = await (window as any).jupyterapp.commands.execute(
        command,
        args
      );
      return { id: content.id, url: content.url };
    },
    { command, args }
  );
}

/** Whether this window's lab has `command`. */
const hasCommand = (page: Page, command: string): Promise<boolean> =>
  page.evaluate(
    command => (window as any).jupyterapp.commands.hasCommand(command),
    command
  );

/** The three kinds of web page tab: the command that opens one, its arguments, its label and the key it saves under. */
const KINDS = [
  {
    command: 'workspace-page:open',
    label: 'Moved page',
    args: { url, title: 'Moved page' },
    key: (c: { id: string }) => `workspace-page:${c.id}`
  },
  {
    command: 'server-proxy:open',
    label: 'Moved proxy page',
    args: {
      url,
      title: 'Moved proxy page',
      id: 'wm-moved-proxy',
      newBrowserTab: false
    },
    key: (c: { id: string }) => `server-proxy:${c.id}`
  },
  {
    command: 'help:open',
    label: 'Moved help page',
    args: { url, text: 'Moved help page' },
    key: (c: { url: string }) => `help-doc:${c.url}`
  }
];

for (const kind of KINDS) {
  test(`DEF-PANEL-90-MOVE-WEBTAB: a ${kind.command} tab of this window moves to another workspace: the target's saved layout gains its saved entry and the tab closes here`, async ({
    page
  }) => {
    const current = fresh('webout');
    const target = `${current}-target`;
    await putWorkspace(page, target);
    try {
      await enterWorkspace(page, current);
      // the test lab loads jupyter-server-proxy's lab extension only where it is installed
      test.skip(
        !(await hasCommand(page, kind.command)),
        `${kind.command} is not in this lab`
      );
      const key = kind.key(await openWeb(page, kind.command, kind.args));
      await expect(page.locator(TABS, { hasText: kind.label })).toHaveCount(1);
      await expect
        .poll(() => savedTabs(page, current), UNDER_LOAD)
        .toContain(key);
      const entries = await saved(page, current);
      await openCard(page, current);

      await moveTo(rowOf(card(page, current), kind.label), target);
      await expect
        .poll(() => savedTabs(page, target), UNDER_LOAD)
        .toEqual([key]);
      expect((await saved(page, target))[key]).toEqual(entries[key]);
      await expect(page.locator(TABS, { hasText: kind.label })).toHaveCount(
        0,
        UNDER_LOAD
      );
      await expect
        .poll(() => savedTabs(page, current), UNDER_LOAD)
        .not.toContain(key);
    } finally {
      await deleteWorkspaces(page, [current, target]);
    }
  });
}

test('DEF-PANEL-90-MOVE-WEBTAB: a path-less tab of another kind JupyterLab saves, the Settings Editor, keys setting-editor:setting-editor and moves to another workspace: the target gains its saved entry and the tab closes here', async ({
  page
}) => {
  const current = fresh('websettings');
  const target = `${current}-target`;
  const key = 'setting-editor:setting-editor';
  await putWorkspace(page, target);
  try {
    await enterWorkspace(page, current);
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('settingeditor:open')
    );
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .toContain(key);
    const entries = await saved(page, current);
    await openCard(page, current);
    const row = card(page, current).locator(
      `.jp-WorkspaceManager-row[data-row-key="${key}"]`
    );
    await expect(row).toHaveCount(1, UNDER_LOAD);

    await moveTo(row, target);
    await expect.poll(() => savedTabs(page, target), UNDER_LOAD).toEqual([key]);
    expect((await saved(page, target))[key]).toEqual(entries[key]);
    await expect(row).toHaveCount(0, UNDER_LOAD);
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .not.toContain(key);
  } finally {
    await deleteWorkspaces(page, [current, target]);
  }
});

test("DEF-PANEL-90-MOVE-WEBTAB: a saved page tab of another workspace's card moves to this window: it opens here with its url and title and leaves the source's saved layout", async ({
  page
}) => {
  const current = fresh('webin');
  const source = `${current}-source`;
  const key = 'workspace-page:wm-moved-in';
  // the entry the page tracker saves
  await putWorkspace(page, source, {
    'layout-restorer:data': {
      main: { dock: { type: 'tab-area', currentIndex: 0, widgets: [key] } }
    },
    [key]: { data: { url, title: 'Moved in page', id: 'wm-moved-in' } }
  });
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    await moveTo(rowOf(card(page, source), 'Moved in page'), current);
    await expect(page.locator(TABS, { hasText: 'Moved in page' })).toHaveCount(
      1,
      UNDER_LOAD
    );
    await expect(page.locator(`${IFRAMES}[src="${url}"]`)).toHaveCount(
      1,
      UNDER_LOAD
    );
    await expect.poll(() => savedTabs(page, source), UNDER_LOAD).toEqual([]);
    expect(Object.keys(await saved(page, source))).not.toContain(key);
  } finally {
    await deleteWorkspaces(page, [current, source]);
  }
});

test('ACC-OPEN-303-PAGE-RESTORE, DEF-PANEL-90-MOVE-WEBTAB: a page tab saves in its workspace and reopens after a page reload with its url, title, icon and sandbox', async ({
  page
}) => {
  const current = fresh('webreload');
  try {
    await enterWorkspace(page, current);
    const { id } = await openWeb(page, 'workspace-page:open', {
      url,
      title: 'Reloaded page',
      icon: ICON,
      policy: { sandbox: 'allow-scripts' }
    });
    const key = `workspace-page:${id}`;
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .toContain(key);

    // the Launcher Galata waits for by default is not part of the restored
    // layout; the fixture's Page type leaves out Galata's waitForIsReady
    await page.reload({ waitForIsReady: false } as any);
    await openPanel(page);
    const tab = page.locator(TABS, { hasText: 'Reloaded page' });
    await expect(tab).toHaveCount(1, HEAVY_LOAD);
    await expect(tab.locator('image')).toHaveAttribute('href', ICON);
    const iframe = page.locator(`${IFRAMES}[src="${url}"]`);
    await expect(iframe).toHaveCount(1, UNDER_LOAD);
    // not the proxy default: the policy came back from the saved entry
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(await savedTabs(page, current)).toContain(key);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('DEF-PANEL-90-MOVE-WEBTAB: an iframe tab no tracker holds is refused in plain words: JupyterLab does not save it; it stays open and the target stays empty', async ({
  page
}) => {
  const current = fresh('webuntracked');
  const target = `${current}-target`;
  await putWorkspace(page, target);
  try {
    await enterWorkspace(page, current);
    await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      // the lab's own classes: a Launcher is a MainAreaWidget, the shell a Widget
      const launcher = await app.commands.execute('launcher:create');
      const MainAreaWidget = launcher.constructor;
      launcher.dispose();
      const Widget = Object.getPrototypeOf(app.shell.constructor);
      const frame = document.createElement('iframe');
      frame.src = 'data:text/html,<p>untracked</p>';
      const tab = new MainAreaWidget({ content: new Widget({ node: frame }) });
      tab.title.label = 'Untracked page';
      app.shell.add(tab, 'main');
    });
    await openCard(page, current);

    await moveTo(rowOf(card(page, current), 'Untracked page'), target);
    await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(REFUSED);
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Close' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(TABS, { hasText: 'Untracked page' })).toHaveCount(
      1
    );
    expect(await savedTabs(page, target)).toEqual([]);
  } finally {
    await deleteWorkspaces(page, [current, target]);
  }
});
