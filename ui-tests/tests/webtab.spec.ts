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

/**
 * The tabs without a path whose own icon and name a card draws from the saved
 * entry (DEF-PANEL-95-WEBTAB-ICON, DEF-PANEL-97-PATHLESS-NAME): the command that
 * opens one, its arguments, the namespace of the key it saves under and the name
 * its own window gives the tab. A server-proxy or Help tab is not here:
 * its icon is a page favicon no saved entry holds, and this test lab draws
 * neither tab with an icon of its own.
 */
const ICON_KINDS = [
  {
    name: 'a page tab with an icon',
    command: 'workspace-page:open',
    args: { url, title: 'Icon page', icon: ICON },
    namespace: 'workspace-page',
    label: 'Icon page'
  },
  {
    name: 'the Settings Editor',
    command: 'settingeditor:open',
    args: {},
    namespace: 'setting-editor',
    label: 'Settings'
  },
  {
    name: 'the Log Console',
    command: 'logconsole:open',
    args: {},
    namespace: 'logconsole',
    label: 'Log Console'
  },
  {
    name: 'Contextual Help',
    command: 'inspector:open',
    args: {},
    namespace: 'inspector',
    label: 'Contextual Help'
  },
  {
    name: 'Licenses',
    command: 'apputils:licenses',
    args: {},
    namespace: 'help-licenses',
    label: 'Licenses',
    // a newly opened tab adds the name of the bundle it shows once the bundles load
    live: /Licenses$/
  },
  {
    name: 'the Plugin Manager',
    command: 'pluginmanager:open',
    args: {},
    namespace: 'plugin-manager',
    label: 'Advanced Plugin Manager'
  },
  {
    name: 'a code viewer',
    command: 'code-viewer:open',
    args: {
      content: 'print(1)',
      label: 'Viewed code',
      mimeType: 'text/x-python'
    },
    namespace: 'codeviewer',
    label: 'Viewed code'
  }
];

for (const kind of ICON_KINDS) {
  test(`DEF-PANEL-95-WEBTAB-ICON, ACC-LISTS-304-PATHLESS-ICON, DEF-PANEL-97-PATHLESS-NAME, ACC-LISTS-306-PATHLESS-NAME: ${kind.name} moved to another workspace draws on that workspace's card the icon and the name its live row draws here, also after a page reload`, async ({
    page
  }) => {
    const current = fresh('webicon');
    const target = `${current}-target`;
    await putWorkspace(page, target);
    try {
      await enterWorkspace(page, current);
      test.skip(
        !(await hasCommand(page, kind.command)),
        `${kind.command} is not in this lab`
      );
      await page.evaluate(
        ({ command, args }) =>
          (window as any).jupyterapp.commands.execute(command, args),
        kind
      );
      const ofKind = (keys: string[]) =>
        keys.filter(k => k.startsWith(`${kind.namespace}:`));
      await expect
        .poll(async () => ofKind(await savedTabs(page, current)), UNDER_LOAD)
        .toHaveLength(1);
      const [key] = ofKind(await savedTabs(page, current));
      await openCard(page, current);
      const glyph = (id: string) =>
        card(page, id).locator(
          `.jp-WorkspaceManager-row[data-row-key="${key}"] .jp-WorkspaceManager-rowIcon svg`
        );
      const name = (id: string) =>
        card(page, id).locator(
          `.jp-WorkspaceManager-row[data-row-key="${key}"] .jp-WorkspaceManager-rowLabel`
        );
      await expect(glyph(current)).toHaveCount(1, UNDER_LOAD);
      await expect(name(current)).toHaveText(kind.live ?? kind.label);
      const own = (await glyph(current).getAttribute('data-icon'))!;
      // the live row draws the tab's own icon, so a file icon on the target fails the test
      expect(own).not.toBe('ui-components:file');

      await moveTo(
        card(page, current).locator(
          `.jp-WorkspaceManager-row[data-row-key="${key}"]`
        ),
        target
      );
      await expect
        .poll(() => savedTabs(page, target), UNDER_LOAD)
        .toEqual([key]);
      await openCard(page, target);
      await expect(glyph(target)).toHaveAttribute('data-icon', own, UNDER_LOAD);
      await expect(name(target)).toHaveText(kind.label);

      // the Launcher Galata waits for by default is not part of the restored layout
      await page.reload({ waitForIsReady: false } as any);
      await openPanel(page);
      await expect(card(page, target)).toHaveCount(1, HEAVY_LOAD);
      await openCard(page, target);
      await expect(glyph(target)).toHaveAttribute('data-icon', own, UNDER_LOAD);
      await expect(name(target)).toHaveText(kind.label);
    } finally {
      await deleteWorkspaces(page, [current, target]);
    }
  });
}

/** The svgstr jupyterlab-vscode-icons-extension makes for a page favicon at `href`. */
const faviconSvg = (href: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><image x="0.5" y="0.5" width="13" height="13" href="${href}"/></svg>`;

/**
 * What jupyterlab-vscode-icons-extension does to a web page tab, which this test
 * lab does not load (ui-tests/jupyter_server_test_config.py): it defines its two
 * globes by name at load, and once a page has loaded it puts the page favicon,
 * `tab.href`, on the title of the tab labelled `tab.label`.
 */
function iconsExtension(
  page: Page,
  tab?: { label: string; href: string }
): Promise<void> {
  return page.evaluate(
    ({ tab, svgstr }) => {
      const app = (window as any).jupyterapp;
      // the lab's own LabIcon class, read off the icon of a side panel
      const LabIcon = ['left', 'right']
        .flatMap(area => [...app.shell.widgets(area)])
        .find((w: any) => w.title.icon?.svgstr).title.icon.constructor;
      for (const kind of ['local', 'remote']) {
        new LabIcon({
          name: `jupyterlab_vscode_icons_extension:${kind}-page`,
          svgstr:
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor"/></svg>'
        });
      }
      if (tab) {
        [...app.shell.widgets('main')].find(
          (w: any) => w.title.label === tab.label
        ).title.icon = new LabIcon({
          name: `jupyterlab_vscode_icons_extension:favicon:${tab.href}`,
          svgstr
        });
      }
    },
    { tab, svgstr: tab ? faviconSvg(tab.href) : '' }
  );
}

// the server-proxy:open and help:open kinds: their own icon is the page favicon, which no saved entry holds
for (const kind of KINDS.slice(1)) {
  test(`DEF-PANEL-95-WEBTAB-ICON, ACC-LISTS-305-COPIED-ICON: a ${kind.command} tab showing its page favicon, moved to another workspace, draws that favicon on the workspace's card, also after a page reload; moved back it opens as before`, async ({
    page
  }) => {
    const current = fresh('webfavicon');
    const target = `${current}-target`;
    await putWorkspace(page, target);
    try {
      await enterWorkspace(page, current);
      test.skip(
        !(await hasCommand(page, kind.command)),
        `${kind.command} is not in this lab`
      );
      const href = new URL(ICON, page.url()).href;
      const key = kind.key(await openWeb(page, kind.command, kind.args));
      await expect(page.locator(`${IFRAMES}[src="${url}"]`)).toHaveCount(
        1,
        UNDER_LOAD
      );
      await iconsExtension(page, { label: kind.label, href });
      await expect
        .poll(() => savedTabs(page, current), UNDER_LOAD)
        .toContain(key);
      const entries = await saved(page, current);
      const row = (id: string) =>
        card(page, id).locator(
          `.jp-WorkspaceManager-row[data-row-key="${key}"]`
        );
      const favicon = (id: string) =>
        row(id).locator('.jp-WorkspaceManager-rowIcon svg image');
      await openCard(page, current);
      // the live row draws the favicon the tab shows
      await expect(favicon(current)).toHaveAttribute('href', href, UNDER_LOAD);

      await moveTo(row(current), target);
      await expect
        .poll(() => savedTabs(page, target), UNDER_LOAD)
        .toEqual([key]);
      expect((await saved(page, target))[key].data.copiedIcon).toBe(
        faviconSvg(href)
      );
      await openCard(page, target);
      await expect(favicon(target)).toHaveAttribute('href', href, UNDER_LOAD);

      // the Launcher Galata waits for by default is not part of the restored layout
      await page.reload({ waitForIsReady: false } as any);
      await openPanel(page);
      await expect(card(page, target)).toHaveCount(1, HEAVY_LOAD);
      await openCard(page, target);
      await expect(favicon(target)).toHaveAttribute('href', href, UNDER_LOAD);

      // the restore command opens the entry holding the copy, and this window saves the tab again without it
      await moveTo(row(target), current);
      await expect(page.locator(`${IFRAMES}[src="${url}"]`)).toHaveCount(
        1,
        UNDER_LOAD
      );
      await expect
        .poll(async () => (await saved(page, current))[key]?.data, UNDER_LOAD)
        .toEqual(entries[key].data);
    } finally {
      await deleteWorkspaces(page, [current, target]);
    }
  });
}

test("DEF-PANEL-95-WEBTAB-ICON, ACC-LISTS-305-COPIED-ICON: a server-proxy and a Help tab never moved draw on another workspace's card the globe jupyterlab-vscode-icons-extension draws before a page loads, local-page for a page of the lab and remote-page for another site", async ({
  page
}) => {
  const current = fresh('webglobe');
  const other = `${current}-other`;
  const keys = [
    'server-proxy:wm-never-moved',
    'help-doc:https://jupyter.org/documentation'
  ];
  // the entries the server-proxy and Help trackers save
  await putWorkspace(page, other, {
    'layout-restorer:data': {
      main: { dock: { type: 'tab-area', currentIndex: 0, widgets: keys } }
    },
    [keys[0]]: {
      data: {
        url,
        title: 'Never moved proxy page',
        newBrowserTab: false,
        id: 'wm-never-moved'
      }
    },
    [keys[1]]: {
      data: {
        url: 'https://jupyter.org/documentation',
        text: 'Jupyter Reference'
      }
    }
  });
  try {
    await enterWorkspace(page, current);
    await iconsExtension(page);
    await openCard(page, other);
    for (const [i, key] of keys.entries()) {
      await expect(
        card(page, other).locator(
          `.jp-WorkspaceManager-row[data-row-key="${key}"] .jp-WorkspaceManager-rowIcon svg`
        )
      ).toHaveAttribute(
        'data-icon',
        `jupyterlab_vscode_icons_extension:${['local', 'remote'][i]}-page`,
        UNDER_LOAD
      );
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

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
