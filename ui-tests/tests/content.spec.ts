import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  activeTab,
  card,
  cardHeader,
  countOf,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  expectRefused,
  fresh,
  fromRowMenu,
  group,
  kernelIds,
  layout,
  menuItem,
  newTerminalTab,
  NEXT_POLL,
  nobodyCard,
  openDocument,
  PANEL,
  putNotebook,
  putWorkspace,
  rowOf,
  saved,
  secondWindow,
  startSession,
  startTerminal,
  terminalNames,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

const ROW = '.jp-WorkspaceManager-row';

/** The paths of the documents open in this window's main area. */
const openPaths = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from((window as any).jupyterapp.shell.widgets('main'))
      .map((w: any) => w.context?.path)
      .filter(Boolean)
  );

test.describe('terminals, kernels and sessions of the server', () => {
  // Galata lists only what its page started; these tests start terminals and kernels by REST
  test.use({ kernels: null, sessions: null, terminals: null });

  test('ACC-LISTS-33-ORDER, ACC-LISTS-134-GROUP-COUNT: an open card lists tabs, then terminals, then kernels, each group under its name and count', async ({
    page,
    tmpPath
  }) => {
    const terminals: string[] = [];
    for (let i = 0; i < 5; i++) {
      terminals.push(await startTerminal(page));
    }
    const notebook = `${tmpPath}/grouped.ipynb`;
    const session = await startSession(page, notebook);
    const current = fresh('order');
    const other = `${current}-other`;
    // the saved layout mixes the kinds; the card groups them
    await putWorkspace(
      page,
      other,
      layout([
        `terminal:${terminals[0]}`,
        `notebook:${notebook}`,
        `editor:${tmpPath}/a.md`,
        ...terminals.slice(1).map(t => `terminal:${t}`),
        `editor:${tmpPath}/b.txt`
      ])
    );
    try {
      await enterWorkspace(page, current);
      await cardHeader(page, other).click();
      const c = card(page, other);
      await expect(c.locator('.jp-WorkspaceManager-groupLabel')).toHaveText([
        'TABS 3',
        'TERMINALS 5',
        'KERNELS 1'
      ]);
      // each row is in the group of its kind; the notebook tab is a tab
      await expect(
        group(c, 'TABS').locator('.jp-WorkspaceManager-rowLabel')
      ).toHaveText(['grouped.ipynb', 'a.md', 'b.txt']);
      for (const t of terminals) {
        await expect(rowOf(group(c, 'TERMINALS'), `terminal ${t}`)).toHaveCount(
          1
        );
      }
      await expect(group(c, 'KERNELS').locator(ROW)).toHaveCount(1);
      await expect(
        rowOf(group(c, 'KERNELS'), 'grouped.ipynb').locator(
          '.jp-WorkspaceManager-rowLabel'
        )
      ).toHaveText(session.kernel.name);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await Promise.all(
        terminals.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, other]);
    }
  });

  test('ACC-LISTS-38-NO-WORKSPACE: a terminal of no workspace is under In no workspace, after the last workspace; a click or Enter opens it here', async ({
    page
  }) => {
    const [first, second] = [
      await startTerminal(page),
      await startTerminal(page)
    ];
    const current = fresh('nobody');
    await putWorkspace(page, `${current}-a`);
    try {
      await enterWorkspace(page, current);
      await expect(nobodyCard(page)).toBeVisible();
      const kinds = await page
        .locator(`${PANEL} .jp-WorkspaceManager-card`)
        .evaluateAll(nodes =>
          nodes.map(n =>
            n.classList.contains('jp-mod-nobody')
              ? 'nobody'
              : n.hasAttribute('data-workspace')
                ? 'workspace'
                : 'other'
          )
        );
      expect(kinds.lastIndexOf('workspace')).toBe(1);
      expect(kinds.indexOf('nobody')).toBe(2);

      await nobodyCard(page).locator('.jp-WorkspaceManager-cardHeader').click();
      await rowOf(nobodyCard(page), `terminal ${first}`).click();
      // a terminal tab on that terminal, not a new one
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(first);
      await expect(
        page.locator('#jp-main-dock-panel .jp-Terminal:visible')
      ).toHaveCount(1);

      await rowOf(nobodyCard(page), `terminal ${second}`).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(second);
      expect(await terminalNames(page)).toEqual(
        expect.arrayContaining([first, second])
      );
    } finally {
      await page.request.delete(`/api/terminals/${first}`);
      await page.request.delete(`/api/terminals/${second}`);
      await deleteWorkspaces(page, [current, `${current}-a`]);
    }
  });

  test('ACC-LISTS-110-SHUTDOWN-ALL: Shut down all of In no workspace asks once, naming its terminal and kernel, and ends both', async ({
    page
  }) => {
    const terminal = await startTerminal(page);
    const response = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    expect(response.ok()).toBe(true);
    const kernel: string = (await response.json()).id;
    // the terminals, kernels and sessions other tests run at the same time are in no workspace too
    const only = (url: RegExp, keep: (x: any) => boolean) =>
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
    await only(
      /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
      t => t.name === terminal
    );
    await only(/\/api\/kernels(\?.*)?$/, k => k.id === kernel);
    await only(/\/api\/sessions(\?.*)?$/, () => false);
    const current = fresh('shutall');
    try {
      await enterWorkspace(page, current);
      const nobody = nobodyCard(page);
      await expect(countOf(nobody, 'Terminals')).toHaveText('1');
      await expect(countOf(nobody, 'Kernels')).toHaveText('1', NEXT_POLL);

      await nobody
        .locator('button[aria-label="Menu of In no workspace"]')
        .click();
      await menuItem(page, 'Shut down all').click();
      await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
        'Shut down all?'
      );
      await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
        'Shut down 1 terminal and 1 kernel that are in no workspace.'
      );
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect
        .poll(() => terminalNames(page), UNDER_LOAD)
        .not.toContain(terminal);
      await expect
        .poll(() => kernelIds(page), UNDER_LOAD)
        .not.toContain(kernel);
      await expect(nobody).toHaveCount(0, NEXT_POLL);
    } finally {
      await page.request.delete(`/api/terminals/${terminal}`);
      await page.request.delete(`/api/kernels/${kernel}`);
      await deleteWorkspaces(page, [current]);
    }
  });
});

test("ACC-LISTS-36-LIVE: this window's card follows its tabs without a refresh", async ({
  page
}) => {
  const current = fresh('live');
  try {
    await enterWorkspace(page, current);
    await cardHeader(page, current).click();
    const name = await newTerminalTab(page);
    const row = rowOf(card(page, current), `terminal ${name}`);
    await expect(row).toBeVisible({ timeout: 2000 });
    await page.evaluate(() =>
      (window as any).jupyterapp.shell.currentWidget.close()
    );
    await expect(row).toHaveCount(0, { timeout: 2000 });
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-37-TWO-WORKSPACES: a terminal of two workspaces is a row of both cards, marked with the other one, and counted in both', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('two');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a, layout([`terminal:${terminal}`]));
  await putWorkspace(page, b, layout([`terminal:${terminal}`]));
  try {
    await enterWorkspace(page, current);
    for (const [id, also] of [
      [a, b],
      [b, a]
    ]) {
      await expect(countOf(card(page, id), 'Terminals')).toHaveText('1');
      await cardHeader(page, id).click();
      const row = rowOf(card(page, id), `terminal ${terminal}`);
      await expect(row).toBeVisible();
      await expect(
        row.locator('.jp-WorkspaceManager-rowDetail', { hasText: 'also in' })
      ).toHaveText(`also in ${also}`);
    }
    await expect(rowOf(nobodyCard(page), `terminal ${terminal}`)).toHaveCount(
      0
    );
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test("ACC-LISTS-39-ROW-CURRENT: a row click in this window's card activates its tab", async ({
  page,
  tmpPath
}) => {
  const current = fresh('rowcur');
  const doc = `${tmpPath}/current.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, doc);
    const first = await newTerminalTab(page);
    const second = await newTerminalTab(page);
    expect(await activeTab(page)).toBe(second);
    await cardHeader(page, current).click();
    await rowOf(card(page, current), `terminal ${first}`).click();
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(first);
    await rowOf(card(page, current), 'current.txt').click();
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-40-ROW-OTHER: a row click in the card of another workspace opens that workspace in this window', async ({
  page,
  tmpPath
}) => {
  const current = fresh('rowother');
  const other = `${current}-other`;
  const doc = `${tmpPath}/elsewhere.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  await putWorkspace(page, other, layout([`editor:${doc}`]));
  try {
    await enterWorkspace(page, current);
    await cardHeader(page, other).click();
    await rowOf(card(page, other), 'elsewhere.txt').click();
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${other}(\\?.*)?$`)
    );
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-LISTS-41-EMPTY: the open card of a workspace without tabs shows one empty-state line', async ({
  page
}) => {
  const current = fresh('empty');
  const empty = `${current}-empty`;
  await putWorkspace(page, empty);
  try {
    await enterWorkspace(page, current);
    await cardHeader(page, empty).click();
    await expect(card(page, empty).locator(ROW)).toHaveCount(0);
    await expect(
      card(page, empty).locator('.jp-WorkspaceManager-empty')
    ).toHaveText(['No tabs, terminals or kernels']);
    // this window's card holds the Launcher: no such line
    await cardHeader(page, current).click();
    await expect(card(page, current).locator(ROW)).not.toHaveCount(0);
    await expect(
      card(page, current).locator('.jp-WorkspaceManager-empty')
    ).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current, empty]);
  }
});

test('ACC-LISTS-104-ROW-MENU: row actions open by right-click or the context-menu key; rows hold no button', async ({
  page,
  tmpPath
}) => {
  const current = fresh('rowmenu');
  const doc = `${tmpPath}/menu.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, doc);
    const terminal = await newTerminalTab(page);
    await cardHeader(page, current).click();
    const c = card(page, current);
    await expect(rowOf(c, `terminal ${terminal}`)).toBeVisible();
    await expect(rowOf(c, 'menu.txt')).toBeVisible();
    await expect(
      c.locator(`${ROW} button, ${ROW} [role="button"]`)
    ).toHaveCount(0);

    const labels = page.locator('.jp-WorkspaceManager-menu .lm-Menu-itemLabel');
    await rowOf(c, 'menu.txt').click({ button: 'right' });
    await expect(labels).toHaveText(['Close tab']);
    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);

    await rowOf(c, `terminal ${terminal}`).focus();
    await page.keyboard.press('ContextMenu');
    await expect(labels).toHaveText(['Shut down terminal']);
    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-105-DOC-ICON: rows under Tabs show the file-type icon of the document registry', async ({
  page,
  tmpPath
}) => {
  const current = fresh('icons');
  const [notebook, markdown] = [
    `${tmpPath}/iconic.ipynb`,
    `${tmpPath}/iconic.md`
  ];
  await putNotebook(page, notebook);
  await page.contents.uploadContent('# iconic', 'text', markdown);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, notebook);
    await openDocument(page, markdown);
    await cardHeader(page, current).click();
    const icon = (label: string) =>
      rowOf(group(card(page, current), 'TABS'), label).locator(
        '.jp-WorkspaceManager-rowIcon svg'
      );
    await expect(icon('iconic.ipynb')).toHaveAttribute(
      'data-icon',
      'ui-components:notebook'
    );
    await expect(icon('iconic.md')).toHaveAttribute(
      'data-icon',
      'ui-components:markdown'
    );
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("ACC-LISTS-106-CLOSE-TAB: Close tab on a row of this window's card closes that tab; an unsaved document asks first", async ({
  page,
  tmpPath
}) => {
  const current = fresh('closetab');
  const [one, two] = [`${tmpPath}/one.txt`, `${tmpPath}/two.txt`];
  for (const path of [one, two]) {
    await page.contents.uploadContent('text', 'text', path);
  }
  try {
    await enterWorkspace(page, current);
    await openDocument(page, one);
    await openDocument(page, two);
    await expect
      .poll(async () => (await openPaths(page)).sort(), UNDER_LOAD)
      .toEqual([one, two]);
    await cardHeader(page, current).click();
    const c = card(page, current);

    await fromRowMenu(rowOf(c, 'two.txt'), 'Close tab');
    await expect.poll(() => openPaths(page), UNDER_LOAD).toEqual([one]);
    await expect(dialog(page)).toHaveCount(0);
    await expect(rowOf(c, 'two.txt')).toHaveCount(0);
    await expect(rowOf(c, 'one.txt')).toBeVisible();

    // an unsaved change, typed as a user types it
    await page.locator('.jp-FileEditor .cm-content').click();
    await page.keyboard.type('changed ');
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(1);
    await fromRowMenu(rowOf(c, 'one.txt'), 'Close tab');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Save your work'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await openPaths(page)).toEqual([one]);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-107-TAB-OTHER: Close tab on a row of another workspace removes the tab from its saved layout; refused while another window shows it', async ({
  page,
  tmpPath
}) => {
  // a second window loads
  test.setTimeout(120000);
  const current = fresh('tabother');
  const other = `${current}-other`;
  const [a, b] = [`${tmpPath}/a.txt`, `${tmpPath}/b.txt`];
  for (const path of [a, b]) {
    await page.contents.uploadContent('text', 'text', path);
  }
  await putWorkspace(page, other, layout([`editor:${a}`, `editor:${b}`]));
  const tabKeys = async () =>
    Object.keys(await saved(page, other)).filter(k => k.startsWith('editor:'));
  const opened: Page[] = [];
  try {
    await enterWorkspace(page, current);
    await cardHeader(page, other).click();
    await fromRowMenu(rowOf(card(page, other), 'a.txt'), 'Close tab');
    await expect.poll(tabKeys, UNDER_LOAD).toEqual([`editor:${b}`]);
    expect(
      (await saved(page, other))['layout-restorer:data'].main.dock.widgets
    ).toEqual([`editor:${b}`]);
    await expect(card(page, other).locator(ROW)).toHaveCount(1);

    opened.push(await secondWindow(page, other));
    await fromRowMenu(rowOf(card(page, other), 'b.txt'), 'Close tab');
    await expectRefused(page, 'Close tab');
    expect(await tabKeys()).toEqual([`editor:${b}`]);
  } finally {
    for (const p of opened) {
      await p.close();
    }
    await deleteWorkspaces(page, [current, other]);
  }
});

test("ACC-LISTS-108-PATH-TOOLTIP: a document row's tooltip is the full path", async ({
  page,
  tmpPath
}) => {
  const current = fresh('tooltip');
  const other = `${current}-other`;
  const path = `${tmpPath}/sub/deeper/note.md`;
  await putWorkspace(page, other, layout([`editor:${path}`]));
  try {
    await enterWorkspace(page, current);
    await cardHeader(page, other).click();
    await expect(rowOf(card(page, other), 'note.md')).toHaveAttribute(
      'title',
      path
    );
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-LISTS-135-NOWS-COUNTS: In no workspace counts terminals and kernels only', async ({
  page
}) => {
  const terminals = [await startTerminal(page), await startTerminal(page)];
  // the terminals other tests run at the same time are in no workspace too
  await page.route(
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    async route => {
      const response = await route.fetch();
      const json = (await response.json()).filter((t: any) =>
        terminals.includes(t.name)
      );
      await route.fulfill({ response, json });
    }
  );
  const current = fresh('nows');
  try {
    await enterWorkspace(page, current);
    const counts = await nobodyCard(page)
      .locator('.jp-WorkspaceManager-count')
      .evaluateAll(nodes =>
        Object.fromEntries(
          nodes.map(n => [n.getAttribute('title'), n.textContent])
        )
      );
    expect(counts).toEqual({ Terminals: '2', Kernels: '0' });
  } finally {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});
