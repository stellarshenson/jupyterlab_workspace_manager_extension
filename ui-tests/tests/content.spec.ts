import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  activeTab,
  card,
  cardHeader,
  closeLauncher,
  countOf,
  cut,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  expectRefused,
  fresh,
  fromRowMenu,
  headerButton,
  HEAVY_LOAD,
  kernelIds,
  languageServer,
  layout,
  menuItem,
  moveTo,
  newTerminalTab,
  NEXT_POLL,
  only,
  openCard,
  openDocument,
  openPanel,
  openSection,
  PANEL,
  PANEL_TAB,
  patchMeta,
  putNotebook,
  putWorkspace,
  refresh,
  rgb,
  rowLabel,
  rowOf,
  saved,
  savedTabs,
  secondWindow,
  sectionBody,
  sectionCount,
  sectionHeader,
  serverList,
  shows,
  sidebarTo,
  startSession,
  startTerminal,
  terminalNames,
  triangle,
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

/** The ids of the document tabs of the main area, in the order of their rows. */
const openIds = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from((window as any).jupyterapp.shell.widgets('main'))
      .filter((w: any) => w.context?.path)
      .map((w: any) => w.id as string)
  );

/** The id of this window's active tab. */
const activeId = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as any).jupyterapp.shell.currentWidget?.id);

/** The number of language server connections in this page's manager. */
const serverConnections = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const { connections } = await (window as any).galata.getPlugin(
      '@jupyterlab/lsp-extension:plugin'
    );
    return connections.size;
  });

test.describe('terminals, kernels and sessions of the server', () => {
  // Galata lists only what its page started; these tests start terminals and kernels by REST
  test.use({ kernels: null, sessions: null, terminals: null });

  test('ACC-LISTS-33-ORDER, ACC-LISTS-134-GROUP-COUNT: an open card lists its documents, then its terminals, as one flat list with no group labels; the counts stay in the header and the notebook shows its kernel state dot', async ({
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
    // the saved layout mixes the kinds; the card lists them flat
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
      await triangle(page, other).click();
      const c = card(page, other);
      // no group labels: one list of rows
      await expect(c.locator('.jp-WorkspaceManager-groupLabel')).toHaveCount(0);
      await expect(c.locator('.jp-WorkspaceManager-group')).toHaveCount(0);
      await expect(c.locator('.jp-WorkspaceManager-rowLabel')).toHaveText([
        'grouped.ipynb',
        'a.md',
        'b.txt',
        ...terminals.map(rowLabel)
      ]);
      // the counts stay in the card header: Tabs counts documents and terminals (DQ-24)
      await expect(countOf(c, 'Tabs')).toHaveText('8');
      await expect(countOf(c, 'Terminals')).toHaveText('5');
      await expect(countOf(c, 'Kernels')).toHaveText('1');
      // the notebook's running kernel shows as its state dot and word; the word is also the
      // state span's title; a session made by REST with no client keeps the server's `starting` state
      const notebookRow = rowOf(c, 'grouped.ipynb');
      const state = notebookRow.locator('.jp-WorkspaceManager-state');
      await expect(state.locator('.jp-WorkspaceManager-dot')).toHaveCount(
        1,
        NEXT_POLL
      );
      const word = (await serverList(page, '/api/sessions')).find(
        s => s.id === session.id
      )?.kernel?.execution_state;
      expect(word).toBeTruthy();
      await expect(state).toHaveAttribute('title', word, NEXT_POLL);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await Promise.all(
        terminals.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, other]);
    }
  });

  test('ACC-LISTS-38-NO-WORKSPACE: a terminal of no workspace is in the TERMINALS section, after the last workspace; a click or Enter opens it here', async ({
    page
  }) => {
    const [first, second] = [
      await startTerminal(page),
      await startTerminal(page)
    ];
    const current = fresh('nobody');
    await putWorkspace(page, `${current}-a`);
    await only(
      page,
      /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
      t => [first, second].includes(t.name)
    );
    try {
      await enterWorkspace(page, current);
      // the sections that hold what belongs to no workspace come after WORKSPACES
      const last = await page
        .locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`)
        .last()
        .boundingBox();
      const terminals = await sectionHeader(page, 'terminals').boundingBox();
      expect(terminals!.y).toBeGreaterThan(last!.y);
      await expect(sectionCount(page, 'terminals')).toHaveText('(2)');

      await openSection(page, 'terminals');
      await rowOf(sectionBody(page, 'terminals'), rowLabel(first)).click();
      // a terminal tab on that terminal, not a new one
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(first);
      await expect(
        page.locator('#jp-main-dock-panel .jp-Terminal:visible')
      ).toHaveCount(1);

      await rowOf(sectionBody(page, 'terminals'), rowLabel(second)).focus();
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

  test("ACC-LISTS-110-SHUTDOWN-ALL: each of the KERNELS, TERMINALS and LANGUAGE SERVERS headers offers Shut down all; it asks once, naming its items, and shuts that section's items", async ({
    page
  }) => {
    const terminal = await startTerminal(page);
    const response = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    expect(response.ok()).toBe(true);
    const kernel: string = (await response.json()).id;
    // the terminals, kernels and sessions other tests run at the same time are listed too
    await only(
      page,
      /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
      t => t.name === terminal
    );
    await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === kernel);
    await only(page, /\/api\/sessions(\?.*)?$/, () => false);
    const current = fresh('shutall');
    try {
      await enterWorkspace(page, current);
      await languageServer(page, true);
      await expect(sectionCount(page, 'terminals')).toHaveText('(1)');
      await expect(sectionCount(page, 'kernels')).toHaveText('(1)');
      await expect(sectionCount(page, 'servers')).toHaveText('(1)');

      // TERMINALS: Shut down all names its terminal
      await openSection(page, 'terminals');
      await sectionHeader(page, 'terminals')
        .getByRole('button', { name: 'Shut down all', exact: true })
        .click();
      await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
        'Shut down all?'
      );
      await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
        'Shut down 1 terminal.'
      );
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect
        .poll(() => terminalNames(page), UNDER_LOAD)
        .not.toContain(terminal);

      // KERNELS: Shut down all names its kernel
      await openSection(page, 'kernels');
      await sectionHeader(page, 'kernels')
        .getByRole('button', { name: 'Shut down all', exact: true })
        .click();
      await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
        'Shut down 1 kernel.'
      );
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect
        .poll(() => kernelIds(page), UNDER_LOAD)
        .not.toContain(kernel);

      // LANGUAGE SERVERS: the manager's own confirmation, then the shutdown
      await openSection(page, 'servers');
      await sectionHeader(page, 'servers')
        .getByRole('button', { name: 'Shut down all', exact: true })
        .click();
      await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
        'Shut down all?'
      );
      await expect(dialog(page).locator('.jp-Dialog-body')).toContainText(
        'language servers'
      );
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect(dialog(page)).toHaveCount(0);
      await expect.poll(() => serverConnections(page), UNDER_LOAD).toBe(0);
      // the section stays, empty (ACC-PANEL-193)
      await expect(sectionCount(page, 'servers')).toHaveText('(0)');
    } finally {
      await languageServer(page, false);
      await page.request.delete(`/api/terminals/${terminal}`);
      await page.request.delete(`/api/kernels/${kernel}`);
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-LISTS-194-ALL-TERMINALS: TERMINALS lists a terminal open in a tab of this window, one in the layout of another workspace, one in a hidden workspace and one in no layout', async ({
    page
  }) => {
    const mine = [
      await startTerminal(page),
      await startTerminal(page),
      await startTerminal(page)
    ];
    const [other, hidden] = mine;
    await only(
      page,
      /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
      t => mine.includes(t.name)
    );
    const current = fresh('allterms');
    const [a, h] = [`${current}-a`, `${current}-hidden`];
    await putWorkspace(page, a, layout([`terminal:${other}`]));
    await putWorkspace(page, h, layout([`terminal:${hidden}`]));
    await patchMeta(page, h, { hidden: true });
    try {
      await enterWorkspace(page, current);
      mine.push(await newTerminalTab(page));
      await refresh(page);
      await expect(sectionCount(page, 'terminals')).toHaveText('(4)');
      await openSection(page, 'terminals');
      for (const name of mine) {
        await expect(
          rowOf(sectionBody(page, 'terminals'), rowLabel(name))
        ).toBeVisible();
      }
    } finally {
      await Promise.all(
        mine.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, a, h]);
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
    const row = rowOf(card(page, current), rowLabel(name));
    await expect(row).toBeVisible({ timeout: 2000 });
    await page.evaluate(() =>
      (window as any).jupyterapp.shell.currentWidget.close()
    );
    await expect(row).toHaveCount(0, { timeout: 2000 });
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-37-TWO-WORKSPACES: a terminal of two workspaces is a row of both cards and of TERMINALS, with no also in mark, and counted in both', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('two');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a, layout([`terminal:${terminal}`]));
  await putWorkspace(page, b, layout([`terminal:${terminal}`]));
  try {
    await enterWorkspace(page, current);
    for (const id of [a, b]) {
      await openCard(page, id);
      await expect(countOf(card(page, id), 'Terminals')).toHaveText('1');
      const row = rowOf(card(page, id), rowLabel(terminal));
      await expect(row).toBeVisible();
      await expect(row).not.toContainText('also in');
    }
    // the TERMINALS section lists it too (ACC-LISTS-194)
    await openSection(page, 'terminals');
    const listed = rowOf(sectionBody(page, 'terminals'), rowLabel(terminal));
    await expect(listed).toBeVisible();
    await expect(listed).not.toContainText('also in');
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test.describe('a kernel of the server in a narrow row', () => {
  // Galata lists only the kernels and sessions its page started; this test starts one by REST
  test.use({ kernels: null, sessions: null });

  test('ACC-LISTS-154-TAB-SHRINK: at a 300 px panel a terminal row of two workspaces with a long name keeps the first characters of its name and its time whole in the row, with no also in mark; a selected tab row in a deep folder shows its file name whole and cuts its folder; a selected notebook row whose kernel runs shows the state dot, its file name whole and its folder cut', async ({
    page,
    tmpPath
  }) => {
    const folder = `${tmpPath}/a/folder/deep/enough/to/fill/the/row/of/the/card`;
    // longer than half the room of a tab row, so a folder that shortens with it would cut it
    const file = 'notes-of-the-week.md';
    // a long terminal name, so the name cannot be whole in the row
    const response = await page.request.post('/api/terminals', {
      data: {
        name: `${fresh('wm').replace('-', '')}${'withalongname'.repeat(4)}`
      }
    });
    const terminal = (await response.json()).name;
    const notebook = `${tmpPath}/shrunk.ipynb`;
    const session = await startSession(page, notebook);
    const current = fresh('s');
    const a = `${current}-a`;
    const b = `${current}-b`;
    await putWorkspace(
      page,
      a,
      layout([
        `editor:${folder}/${file}`,
        `terminal:${terminal}`,
        `notebook:${notebook}`
      ])
    );
    await putWorkspace(page, b, layout([`terminal:${terminal}`]));
    try {
      await enterWorkspace(page, current);
      await sidebarTo(page, 300);
      await triangle(page, a).click();

      const shared = rowOf(card(page, a), rowLabel(terminal));
      await expect(shared).toBeVisible();
      await expect(shared).not.toContainText('also in');
      expect(await cut(shared, '.jp-WorkspaceManager-rowLabel')).toEqual([
        rowLabel(terminal)
      ]);
      const name = await shows(shared, '.jp-WorkspaceManager-rowLabel');
      expect(name.inside).toBe(true);
      expect(name.width).toBeGreaterThanOrEqual(name.start);
      expect(await shows(shared, '.jp-WorkspaceManager-age')).toMatchObject({
        inside: true,
        whole: true
      });

      // selected, the tab row shows its folder, cut; its file name stays whole
      const tab = rowOf(card(page, a), file);
      await tab.focus();
      await expect(tab.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
        folder
      );
      expect(await cut(tab, '.jp-WorkspaceManager-rowLabel')).toEqual([]);
      expect(await cut(tab, '.jp-WorkspaceManager-rowDetail > span')).toEqual([
        folder
      ]);

      // selected, the notebook row shows its kernel state dot and its folder, cut; its file name stays whole
      const kernel = rowOf(card(page, a), 'shrunk.ipynb');
      await expect(kernel).toBeVisible();
      // the notebook's kernel shows as its state dot, whatever state the server reports
      await expect(
        kernel.locator('.jp-WorkspaceManager-state .jp-WorkspaceManager-dot')
      ).toHaveCount(1, NEXT_POLL);
      await kernel.focus();
      const parts = kernel.locator('.jp-WorkspaceManager-rowDetail > span');
      await expect(parts).toHaveText([tmpPath], NEXT_POLL);
      expect(await cut(kernel, '.jp-WorkspaceManager-rowLabel')).toEqual([]);
      expect(
        await cut(kernel, '.jp-WorkspaceManager-rowDetail > span')
      ).toEqual([tmpPath]);
      expect(await shows(kernel, '.jp-WorkspaceManager-age')).toMatchObject({
        inside: true,
        whole: true
      });
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, a, b]);
    }
  });
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
    await rowOf(card(page, current), rowLabel(first)).click();
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
    await triangle(page, other).click();
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
    await triangle(page, empty).click();
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

test('ACC-LISTS-104-ROW-MENU, ACC-LISTS-265-MENU-ENTRIES: row actions open by right-click or the context-menu key with the entries of each kind of row, the danger entry last; tab and terminal rows hold no button, in a card and in KERNELS and TERMINALS; a language server row holds its shutdown button', async ({
  page,
  tmpPath
}) => {
  const current = fresh('rowmenu');
  const doc = `${tmpPath}/menu.txt`;
  const notebook = `${tmpPath}/menu.ipynb`;
  await page.contents.uploadContent('text', 'text', doc);
  await putNotebook(page, notebook);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, doc);
    await openDocument(page, notebook);
    const terminal = await newTerminalTab(page);
    await cardHeader(page, current).click();
    const c = card(page, current);
    await expect(rowOf(c, rowLabel(terminal))).toBeVisible();
    await expect(rowOf(c, 'menu.txt')).toBeVisible();
    await expect(rowOf(c, 'menu.ipynb')).toBeVisible(UNDER_LOAD);
    // the running kernel of the notebook shows as its state dot
    await expect(
      rowOf(c, 'menu.ipynb').locator('.jp-WorkspaceManager-state')
    ).toHaveCount(1, UNDER_LOAD);
    const buttons = `${ROW} button, ${ROW} [role="button"]`;
    await expect(c.locator(buttons)).toHaveCount(0);
    for (const name of ['kernels', 'terminals']) {
      await openSection(page, name);
      await expect(sectionBody(page, name).locator(ROW)).not.toHaveCount(0);
      await expect(sectionBody(page, name).locator(buttons)).toHaveCount(0);
    }
    await languageServer(page, true);
    await openSection(page, 'servers');
    await expect(
      sectionBody(page, 'servers').locator(`${ROW} button`)
    ).toHaveCount(1);

    // opening SERVERS closed WORKSPACES and unmounted its card: reopen it for the menu
    await openSection(page, 'workspaces');
    const labels = page.locator('.jp-WorkspaceManager-menu .lm-Menu-itemLabel');
    const danger = page.locator(
      '.jp-WorkspaceManager-menu .lm-Menu-item.jp-WorkspaceManager-danger .lm-Menu-itemLabel'
    );
    // a plain document leaves no process behind: no Detach
    await rowOf(c, 'menu.txt').click({ button: 'right' });
    await expect(labels).toHaveText(['Close tab', 'Move to workspace']);
    await expect(danger).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);

    // the notebook runs a kernel: Detach, and Shut down kernel last
    await rowOf(c, 'menu.ipynb').click({ button: 'right' });
    await expect(labels).toHaveText([
      'Close tab',
      'Detach from workspace',
      'Move to workspace',
      'Shut down kernel'
    ]);
    await expect(danger).toHaveText(['Shut down kernel']);
    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);

    // a terminal row: Detach, and Stop terminal last
    await rowOf(c, rowLabel(terminal)).focus();
    await page.keyboard.press('ContextMenu');
    await expect(labels).toHaveText([
      'Close tab',
      'Detach from workspace',
      'Move to workspace',
      'Stop terminal'
    ]);
    await expect(danger).toHaveText(['Stop terminal']);
    await page.keyboard.press('Escape');
    await expect(labels).toHaveCount(0);

    // the rows of KERNELS and TERMINALS do not change
    for (const [name, entry] of [
      ['kernels', 'Shut down kernel'],
      ['terminals', 'Shut down terminal']
    ]) {
      await openSection(page, name);
      await sectionBody(page, name)
        .locator(ROW)
        .first()
        .click({ button: 'right' });
      await expect(labels).toHaveText([entry]);
      await expect(danger).toHaveText([entry]);
      await page.keyboard.press('Escape');
      await expect(labels).toHaveCount(0);
    }
  } finally {
    await languageServer(page, false);
    await deleteWorkspaces(page, [current]);
  }
});

test('MENU-08 ACC-LISTS-212-DANGER-ENTRIES: Stop terminal and Shut down kernel are destructive entries; Close tab is an ordinary entry', async ({
  page,
  tmpPath
}) => {
  const current = fresh('danger');
  const doc = `${tmpPath}/danger.txt`;
  const notebook = `${tmpPath}/danger.ipynb`;
  await page.contents.uploadContent('text', 'text', doc);
  await putNotebook(page, notebook);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, doc);
    await openDocument(page, notebook);
    const terminal = await newTerminalTab(page);
    await cardHeader(page, current).click();
    const c = card(page, current);
    await expect(
      rowOf(c, 'danger.ipynb').locator('.jp-WorkspaceManager-state')
    ).toHaveCount(1, UNDER_LOAD);
    const error = JSON.stringify(await rgb(page, 'var(--jp-error-color1)'));
    const layout2 = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--jp-layout-color2)';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
    const read = async (label: string) => {
      const item = page
        .locator('.jp-WorkspaceManager-menu .lm-Menu-item')
        .filter({ hasText: new RegExp(`^${label}$`) });
      const style = async (part: string, property: string) =>
        item
          .locator(part)
          .first()
          .evaluate(
            (n, p) => (getComputedStyle(n) as any)[p] as string,
            property
          );
      return {
        item,
        danger: await item.evaluate(n =>
          n.classList.contains('jp-WorkspaceManager-danger')
        ),
        label: JSON.stringify(
          await rgb(page, await style('.lm-Menu-itemLabel', 'color'))
        ),
        fill: JSON.stringify(
          await rgb(
            page,
            await style('.lm-Menu-itemIcon .jp-icon3[fill]', 'fill')
          )
        )
      };
    };
    for (const [row, label] of [
      [rowOf(c, rowLabel(terminal)), 'Stop terminal'],
      [rowOf(c, 'danger.ipynb'), 'Shut down kernel']
    ] as [Locator, string][]) {
      await row.click({ button: 'right' });
      const entry = await read(label);
      expect(entry.danger, label).toBe(true);
      expect(entry.label, label).toBe(error);
      expect(entry.fill, label).toBe(error);
      // selected by the arrow keys: the error colour on the menu's selection background;
      // the entry follows Close tab and Detach from workspace, and the arrow keys skip
      // Move to workspace, disabled here because no other workspace shows
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(entry.item).toHaveClass(/lm-mod-active/);
      expect(
        await entry.item.evaluate(n => getComputedStyle(n).backgroundColor)
      ).toBe(layout2);
      expect(
        JSON.stringify(
          await rgb(
            page,
            await entry.item
              .locator('.lm-Menu-itemLabel')
              .evaluate(l => getComputedStyle(l).color)
          )
        )
      ).toBe(error);
      await page.keyboard.press('Escape');
      await expect(page.locator('.jp-WorkspaceManager-menu')).toHaveCount(0);
    }

    // Close tab is an ordinary entry: no danger class, the menu's text colour, no error-coloured icon
    await rowOf(c, 'danger.txt').click({ button: 'right' });
    const close = await read('Close tab');
    expect(close.danger).toBe(false);
    expect(close.label).toBe(
      JSON.stringify(await rgb(page, 'var(--jp-ui-font-color0)'))
    );
    expect(close.fill).not.toBe(error);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-105-DOC-ICON: a card document row shows the file-type icon of the document registry', async ({
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
      rowOf(card(page, current), label).locator(
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

test('DEF-PANEL-69-TABS-SAMEFILE: an editor and its Markdown preview of one file are two rows, no group labels and a tab count of 2; each row activates and closes its own tab', async ({
  page,
  tmpPath
}) => {
  const current = fresh('preview');
  const file = `${tmpPath}/preview.md`;
  await page.contents.uploadContent('# preview\n', 'text', file);
  try {
    await enterWorkspace(page, current);
    await page.evaluate(async path => {
      const { commands } = (window as any).jupyterapp;
      await commands.execute('docmanager:open', { path, factory: 'Editor' });
      await commands.execute('fileeditor:markdown-preview');
    }, file);
    await closeLauncher(page);
    await expect.poll(() => openPaths(page), UNDER_LOAD).toEqual([file, file]);
    await cardHeader(page, current).click();
    const c = card(page, current);
    const rows = c.locator('.jp-WorkspaceManager-row');
    await expect(rows).toHaveCount(2);
    await expect(c.locator('.jp-WorkspaceManager-groupLabel')).toHaveCount(0);
    await expect(countOf(c, 'Tabs')).toHaveText('2');

    const ids = await openIds(page);
    expect(new Set(ids).size).toBe(2);
    for (const i of [0, 1]) {
      await rows.nth(i).click();
      await expect.poll(() => activeId(page), UNDER_LOAD).toBe(ids[i]);
    }

    await fromRowMenu(rows.nth(1), 'Close tab');
    await expect.poll(() => openIds(page), UNDER_LOAD).toEqual([ids[0]]);
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await expect(countOf(c, 'Tabs')).toHaveText('1');
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('DEF-PANEL-10-SHARED-VIEW, DEF-PANEL-69-TABS-SAMEFILE: two New View tabs of one document are two rows and a tab count of 2; each row activates and closes its own tab; only the last view of an unsaved document asks', async ({
  page,
  tmpPath
}) => {
  const current = fresh('views');
  const shared = `${tmpPath}/shared.txt`;
  await page.contents.uploadContent('text', 'text', shared);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, shared);
    // New View for the document, as its tab's context menu runs it
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:clone')
    );
    await closeLauncher(page);
    await expect
      .poll(() => openPaths(page), UNDER_LOAD)
      .toEqual([shared, shared]);
    await cardHeader(page, current).click();
    const c = card(page, current);
    const rows = rowOf(c, 'shared.txt');
    await expect(rows).toHaveCount(2);
    await expect(countOf(c, 'Tabs')).toHaveText('2');

    const ids = await openIds(page);
    expect(new Set(ids).size).toBe(2);
    for (const i of [0, 1]) {
      await rows.nth(i).click();
      await expect.poll(() => activeId(page), UNDER_LOAD).toBe(ids[i]);
    }

    // an unsaved change, typed into the second view, which the click activated
    await page.locator(`[id="${ids[1]}"] .cm-content`).click();
    await page.keyboard.type('changed ');
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(2);

    // the other view stays open: no question, and only this row's tab closes
    await fromRowMenu(rows.nth(1), 'Close tab');
    await expect.poll(() => openIds(page), UNDER_LOAD).toEqual([ids[0]]);
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await expect(countOf(c, 'Tabs')).toHaveText('1');

    // the last view asks
    await fromRowMenu(rows.first(), 'Close tab');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Save your work'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Discard' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => openPaths(page), UNDER_LOAD).toEqual([]);
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
    await triangle(page, other).click();
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

/** Close the open row menu and its submenu. */
async function closeMenus(page: Page): Promise<void> {
  const menus = page.locator('.jp-WorkspaceManager-menu');
  await page.keyboard.press('Escape');
  if (await menus.count()) {
    await page.keyboard.press('Escape');
  }
  await expect(menus).toHaveCount(0);
}

test('ACC-LISTS-267-MOVE-MENU: Move to workspace lists the other workspaces of the panel in panel order, labelled by name, never a hidden one, on a terminal row and a document row', async ({
  page,
  tmpPath
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('movelist');
  const [source, near, hidden] = ['a', 'b', 'hidden'].map(
    s => `${current}-${s}`
  );
  const doc = `${tmpPath}/listed.txt`;
  await putWorkspace(
    page,
    source,
    layout([`terminal:${terminal}`, `editor:${doc}`])
  );
  await putWorkspace(page, near);
  await putWorkspace(page, hidden);
  await patchMeta(page, source, { position: 0 });
  await patchMeta(page, near, { position: 1 });
  await patchMeta(page, hidden, { position: 2, hidden: true });
  const submenu = async (row: Locator) => {
    await fromRowMenu(row, 'Move to workspace');
    const names = await page
      .locator('.jp-WorkspaceManager-menu')
      .last()
      .locator('.lm-Menu-itemLabel')
      .allTextContents();
    await closeMenus(page);
    return names;
  };
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    const c = card(page, source);
    const rows = [rowOf(c, rowLabel(terminal)), rowOf(c, 'listed.txt')];
    for (const row of rows) {
      expect(await submenu(row)).toEqual([near, current]);
    }
    // the panel's eye shows the hidden workspace; the submenu still leaves it out
    await page
      .locator(`${PANEL} button[aria-label="Show hidden workspaces"]`)
      .click();
    await expect(card(page, hidden)).toBeVisible();
    for (const row of rows) {
      expect(await submenu(row)).toEqual([near, current]);
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, source, near, hidden]);
  }
});

test('ACC-LISTS-267-MOVE-MENU: with no other shown workspace Move to workspace shows disabled, never absent', async ({
  page
}) => {
  const current = fresh('movenone');
  try {
    await enterWorkspace(page, current);
    const terminal = await newTerminalTab(page);
    await openCard(page, current);
    const row = rowOf(card(page, current), rowLabel(terminal));
    await row.click({ button: 'right' });
    await expect(menuItem(page, 'Move to workspace')).toHaveClass(
      /lm-mod-disabled/
    );
    await page.keyboard.press('Escape');
    await fromRowMenu(row, 'Stop terminal');
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("ACC-LISTS-268-MOVE-TAB: a terminal and a document of this window move to another workspace: the target's saved layout gains each with its saved entry, this window's tab closes, the terminal runs on", async ({
  page,
  tmpPath
}) => {
  const current = fresh('movefrom');
  const target = `${current}-target`;
  const doc = `${tmpPath}/moved.txt`;
  const kept = `editor:${tmpPath}/kept.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  await putWorkspace(page, target, layout([kept]));
  let terminal = '';
  try {
    await enterWorkspace(page, current);
    terminal = await newTerminalTab(page);
    await openDocument(page, doc);
    const [termKey, docKey] = [`terminal:${terminal}`, `editor:${doc}`];
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .toEqual(expect.arrayContaining([termKey, docKey]));
    const entries = await saved(page, current);
    await openCard(page, current);
    const c = card(page, current);

    await moveTo(rowOf(c, rowLabel(terminal)), target);
    await expect
      .poll(() => savedTabs(page, target), UNDER_LOAD)
      .toEqual([kept, termKey]);
    expect((await saved(page, target))[termKey]).toEqual(entries[termKey]);
    await expect(rowOf(c, rowLabel(terminal))).toHaveCount(0, UNDER_LOAD);
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .not.toContain(termKey);
    expect(await terminalNames(page)).toContain(terminal);

    await moveTo(rowOf(c, 'moved.txt'), target);
    await expect
      .poll(() => savedTabs(page, target), UNDER_LOAD)
      .toEqual([kept, termKey, docKey]);
    expect((await saved(page, target))[docKey]).toEqual(entries[docKey]);
    await expect.poll(() => openPaths(page), UNDER_LOAD).not.toContain(doc);
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .not.toContain(docKey);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, target]);
  }
});

test('ACC-LISTS-268-MOVE-TAB: a terminal and a document move between two other workspaces: the target is saved with the entry, the source without it', async ({
  page,
  tmpPath
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('movemid');
  const [source, target] = [`${current}-source`, `${current}-target`];
  const [termKey, docKey] = [
    `terminal:${terminal}`,
    `editor:${tmpPath}/moved.txt`
  ];
  const before = layout([termKey, docKey]);
  await putWorkspace(page, source, before);
  await putWorkspace(page, target);
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    const c = card(page, source);

    await moveTo(rowOf(c, rowLabel(terminal)), target);
    await expect
      .poll(() => savedTabs(page, target), UNDER_LOAD)
      .toEqual([termKey]);
    await expect
      .poll(() => savedTabs(page, source), UNDER_LOAD)
      .toEqual([docKey]);
    expect((await saved(page, target))[termKey]).toEqual(before[termKey]);
    expect(Object.keys(await saved(page, source))).not.toContain(termKey);
    expect(await terminalNames(page)).toContain(terminal);

    await moveTo(rowOf(c, 'moved.txt'), target);
    await expect
      .poll(() => savedTabs(page, target), UNDER_LOAD)
      .toEqual([termKey, docKey]);
    await expect.poll(() => savedTabs(page, source), UNDER_LOAD).toEqual([]);
    expect((await saved(page, target))[docKey]).toEqual(before[docKey]);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, source, target]);
  }
});

test('ACC-LISTS-268-MOVE-TAB: a terminal and a document of another workspace move to this window: each opens live here and leaves the saved layout of the source', async ({
  page,
  tmpPath
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('moveto');
  const source = `${current}-source`;
  const doc = `${tmpPath}/moved.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  const [termKey, docKey] = [`terminal:${terminal}`, `editor:${doc}`];
  await putWorkspace(page, source, layout([termKey, docKey]));
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    const c = card(page, source);

    await moveTo(rowOf(c, rowLabel(terminal)), current);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(terminal);
    await expect
      .poll(() => savedTabs(page, source), UNDER_LOAD)
      .toEqual([docKey]);
    expect(await terminalNames(page)).toContain(terminal);

    await moveTo(rowOf(c, 'moved.txt'), current);
    await expect.poll(() => openPaths(page), UNDER_LOAD).toContain(doc);
    await expect.poll(() => savedTabs(page, source), UNDER_LOAD).toEqual([]);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, source]);
  }
});

test('DEF-PANEL-80-MOVE-CONSOLE: a console of a notebook path in another workspace moves to this window: a console tab of that path opens here and the key leaves the saved layout of the source', async ({
  page,
  tmpPath
}) => {
  const current = fresh('moveconsole');
  const source = `${current}-source`;
  const notebook = `${tmpPath}/linked.ipynb`;
  await putNotebook(page, notebook);
  const key = `console:${notebook}`;
  // the entry the layout restorer saves for a console
  const data = layout([key]);
  data[key] = {
    data: {
      path: notebook,
      name: 'Console 1',
      kernelPreference: { name: 'python3' }
    }
  };
  await putWorkspace(page, source, data);
  /** The session paths of the console tabs of this window's main area. */
  const consolePaths = (): Promise<string[]> =>
    page.evaluate(() =>
      Array.from((window as any).jupyterapp.shell.widgets('main'))
        .filter((w: any) => w.hasClass('jp-ConsolePanel'))
        .map((w: any) => w.console.sessionContext.path as string)
    );
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    await moveTo(rowOf(card(page, source), 'Console 1'), current);
    await expect.poll(consolePaths, UNDER_LOAD).toEqual([notebook]);
    await expect.poll(() => savedTabs(page, source), UNDER_LOAD).toEqual([]);
    expect(Object.keys(await saved(page, source))).not.toContain(key);
  } finally {
    // deleting a session shuts down its kernel
    for (const session of await serverList(page, '/api/sessions')) {
      if (session.path === notebook) {
        await page.request.delete(`/api/sessions/${session.id}`);
      }
    }
    await deleteWorkspaces(page, [current, source]);
  }
});

test('DEF-PANEL-78-MOVE-SIDEBARS: a workspace made with + and never shown, a tab moved into it, opens with the sidebars of a workspace made with + and no move', async ({
  page
}) => {
  // three page loads
  test.setTimeout(120000);
  const current = fresh('movenew');
  const [plain, target] = [`${current}-plain`, `${current}-target`];
  const create = async (name: string) => {
    await headerButton(page, 'New workspace').click();
    await dialog(page).locator('input').fill(name);
    await dialog(page).locator('input').press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(card(page, name)).toBeVisible(UNDER_LOAD);
  };
  const switchTo = async (id: string) => {
    await card(page, id).locator('.jp-WorkspaceManager-name').click();
    await expect(page).toHaveURL(new RegExp(`/lab/workspaces/${id}(\\?.*)?$`));
    await expect(page.locator(PANEL_TAB)).toBeVisible(HEAVY_LOAD);
  };
  /** The panel each sidebar shows once the layout is restored; null for a collapsed sidebar. */
  const sidebars = () =>
    page.evaluate(async () => {
      await (window as any).jupyterapp.shell.restored;
      const shown = (side: string) =>
        document
          .querySelector(
            `.jp-SideBar.jp-mod-${side} .lm-TabBar-tab.lm-mod-current`
          )
          ?.getAttribute('data-id') ?? null;
      return { left: shown('left'), right: shown('right') };
    });
  let terminal = '';
  try {
    await enterWorkspace(page, current);
    await create(plain);
    await create(target);
    terminal = await newTerminalTab(page);
    const termKey = `terminal:${terminal}`;
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .toContain(termKey);
    await openCard(page, current);
    await moveTo(rowOf(card(page, current), rowLabel(terminal)), target);
    await expect
      .poll(() => savedTabs(page, target), UNDER_LOAD)
      .toEqual([termKey]);

    await switchTo(plain);
    // read after the file browser shows: a workspace with no layout shows it once its load ends
    await expect
      .poll(sidebars, UNDER_LOAD)
      .toMatchObject({ left: 'filebrowser' });
    const none = await sidebars();
    await openPanel(page);
    await refresh(page);
    await switchTo(target);
    await expect.poll(sidebars, UNDER_LOAD).toEqual(none);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, plain, target]);
  }
});

test('ACC-LISTS-269-MOVE-REFUSED: another window on the target, then on the source, refuses the move and both saved layouts stay', async ({
  page
}) => {
  // two windows load
  test.setTimeout(120000);
  const terminal = await startTerminal(page);
  const current = fresh('moveno');
  const [source, target, spare] = ['source', 'target', 'spare'].map(
    s => `${current}-${s}`
  );
  await putWorkspace(page, source, layout([`terminal:${terminal}`]));
  await putWorkspace(page, target);
  await putWorkspace(page, spare);
  try {
    await enterWorkspace(page, current);
    await triangle(page, source).click();
    const row = rowOf(card(page, source), rowLabel(terminal));
    // a closed window stays in presence for 90 s: the second case aims at another target
    for (const [shown, aim] of [
      [target, target],
      [source, spare]
    ]) {
      const other = await secondWindow(page, shown);
      try {
        // the second window saves its layout after it loads: wait for that save, then for its saves to stop
        let last = '';
        await expect
          .poll(
            async () => {
              const data = await saved(page, shown);
              const now = JSON.stringify(data);
              const quiet =
                now === last && !!data['layout-restorer:data']?.left;
              last = now;
              return quiet;
            },
            { ...UNDER_LOAD, intervals: [1500] }
          )
          .toBe(true);
        const before = [await saved(page, source), await saved(page, aim)];
        await moveTo(row, aim);
        await expectRefused(page, 'Move to workspace');
        await refresh(page);
        expect([await saved(page, source), await saved(page, aim)]).toEqual(
          before
        );
      } finally {
        await other.close();
      }
    }
    expect(await terminalNames(page)).toContain(terminal);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, source, target, spare]);
  }
});

test('ACC-LISTS-269-MOVE-REFUSED: a document with unsaved changes is refused, stays open and both saved layouts stay', async ({
  page,
  tmpPath
}) => {
  const current = fresh('movedirty');
  const target = `${current}-target`;
  const doc = `${tmpPath}/unsaved.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  await putWorkspace(page, target);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, doc);
    await expect
      .poll(() => savedTabs(page, current), UNDER_LOAD)
      .toContain(`editor:${doc}`);
    await openCard(page, current);

    // an unsaved change, typed as a user types it
    await page.locator('.jp-FileEditor .cm-content').click();
    await page.keyboard.type('changed ');
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(1);
    const before = [await savedTabs(page, current), await saved(page, target)];

    await moveTo(rowOf(card(page, current), 'unsaved.txt'), target);
    await expect(dialog(page).locator('.jp-Dialog-body')).toContainText(
      'Move to workspace is refused: the document has unsaved changes'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Close' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await refresh(page);
    expect([await savedTabs(page, current), await saved(page, target)]).toEqual(
      before
    );
    expect(await openPaths(page)).toEqual([doc]);
  } finally {
    await deleteWorkspaces(page, [current, target]);
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
    await triangle(page, other).click();
    await expect(rowOf(card(page, other), 'note.md')).toHaveAttribute(
      'title',
      path
    );
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-LISTS-135-NOWS-COUNTS: the TERMINALS and KERNELS section headers count their rows and show no tab count', async ({
  page
}) => {
  const terminals = [await startTerminal(page), await startTerminal(page)];
  // the terminals and kernels other tests run at the same time are listed too
  await only(
    page,
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    t => terminals.includes(t.name)
  );
  await only(page, /\/api\/kernels(\?.*)?$/, () => false);
  await only(page, /\/api\/sessions(\?.*)?$/, () => false);
  const current = fresh('nows');
  try {
    await enterWorkspace(page, current);
    await expect(sectionCount(page, 'terminals')).toHaveText('(2)');
    // no kernel runs: the section shows (0)
    await expect(sectionCount(page, 'kernels')).toHaveText('(0)');
    // the header counts rows; the bare counts beside the icons of a card are not there
    await expect(
      sectionHeader(page, 'terminals').locator('.jp-WorkspaceManager-count')
    ).toHaveCount(0);
    await expect(sectionCount(page, 'terminals')).toHaveText('(2)');
  } finally {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});
