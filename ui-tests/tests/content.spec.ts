import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  activeTab,
  card,
  cardHeader,
  countOf,
  cut,
  deleteWorkspaces,
  dialog,
  displayName,
  enterWorkspace,
  expectRefused,
  fresh,
  fromRowMenu,
  group,
  kernelIds,
  languageServer,
  layout,
  newTerminalTab,
  NEXT_POLL,
  only,
  openCard,
  openDocument,
  openSection,
  PANEL,
  patchMeta,
  putNotebook,
  putWorkspace,
  refresh,
  rgb,
  rowOf,
  saved,
  secondWindow,
  sectionBody,
  sectionCount,
  sectionHeader,
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
      await triangle(page, other).click();
      const c = card(page, other);
      await expect(c.locator('.jp-WorkspaceManager-groupLabel')).toHaveText([
        'TABS (3)',
        'TERMINALS (5)',
        'KERNELS (1)'
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
      // the kernel row is named by its notebook; selected, its detail line starts with the kernel type
      const kernel = rowOf(group(c, 'KERNELS'), 'grouped.ipynb');
      await expect(kernel.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
        'grouped.ipynb'
      );
      await kernel.focus();
      await expect(
        kernel.locator('.jp-WorkspaceManager-rowDetail > span').first()
      ).toHaveText(await displayName(page, session.kernel.name));
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
      await rowOf(sectionBody(page, 'terminals'), `terminal ${first}`).click();
      // a terminal tab on that terminal, not a new one
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(first);
      await expect(
        page.locator('#jp-main-dock-panel .jp-Terminal:visible')
      ).toHaveCount(1);

      await rowOf(sectionBody(page, 'terminals'), `terminal ${second}`).focus();
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
          rowOf(sectionBody(page, 'terminals'), `terminal ${name}`)
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
      const row = rowOf(card(page, id), `terminal ${terminal}`);
      await expect(row).toBeVisible();
      await expect(row).not.toContainText('also in');
    }
    // the TERMINALS section lists it too (ACC-LISTS-194)
    await openSection(page, 'terminals');
    const listed = rowOf(
      sectionBody(page, 'terminals'),
      `terminal ${terminal}`
    );
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

  test('ACC-LISTS-154-TAB-SHRINK: at a 300 px panel a terminal row of two workspaces with a long name keeps the first characters of its name and its time whole in the row, with no also in mark; a selected tab row in a deep folder shows its file name whole and cuts its folder; a selected kernel row whose kernel type is longer than the row shows its file name whole and cuts the type and the folder', async ({
    page,
    tmpPath
  }) => {
    const folder = `${tmpPath}/a/folder/deep/enough/to/fill/the/row/of/the/card`;
    // longer than half the room of a tab row, so a folder that shortens with it would cut it
    const file = 'notes-of-the-week.md';
    // a long terminal name, so the name cannot be whole in the row
    const response = await page.request.post('/api/terminals', {
      data: { name: `${fresh('wm').replace('-', '')}withalongname` }
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
    // the kernelspecs the page loads give every kernel a display name longer than the row
    await page.route(/\/api\/kernelspecs(\?.*)?$/, async route => {
      const answer = await route.fetch();
      const json = await answer.json();
      for (const k of Object.values<any>(json.kernelspecs)) {
        k.spec.display_name += ' with a display name longer than the row';
      }
      await route.fulfill({ response: answer, json });
    });
    try {
      await enterWorkspace(page, current);
      await sidebarTo(page, 300);
      await triangle(page, a).click();

      const shared = rowOf(card(page, a), `terminal ${terminal}`);
      await expect(shared).toBeVisible();
      await expect(shared).not.toContainText('also in');
      expect(await cut(shared, '.jp-WorkspaceManager-rowLabel')).toEqual([
        `terminal ${terminal}`
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

      // selected, the kernel row shows the kernel type, cut, and the path: the folder cut, the file name whole
      const kernel = group(card(page, a), 'KERNELS').locator(ROW);
      await expect(kernel.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
        'shrunk.ipynb',
        NEXT_POLL
      );
      await kernel.focus();
      const parts = kernel.locator('.jp-WorkspaceManager-rowDetail > span');
      await expect(parts).toHaveText(
        [/ longer than the row$/, `${tmpPath}/`, 'shrunk.ipynb'],
        NEXT_POLL
      );
      expect(
        await cut(kernel, '.jp-WorkspaceManager-rowDetail > span')
      ).toEqual([await parts.first().textContent(), `${tmpPath}/`]);
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

test('ACC-LISTS-104-ROW-MENU: row actions open by right-click or the context-menu key; tab, terminal and kernel rows hold no button, in a card and in KERNELS and TERMINALS; a language server row holds its shutdown button', async ({
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
    await expect(rowOf(c, `terminal ${terminal}`)).toBeVisible();
    await expect(rowOf(c, 'menu.txt')).toBeVisible();
    await expect(rowOf(group(c, 'KERNELS'), 'menu.ipynb')).toBeVisible(
      UNDER_LOAD
    );
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
    await languageServer(page, false);
    await deleteWorkspaces(page, [current]);
  }
});

test('MENU-08 ACC-LISTS-212-DANGER-ENTRIES: Shut down terminal and Shut down kernel are destructive entries; Close tab is an ordinary entry', async ({
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
    await expect(rowOf(group(c, 'KERNELS'), 'danger.ipynb')).toBeVisible(
      UNDER_LOAD
    );
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
      [rowOf(c, `terminal ${terminal}`), 'Shut down terminal'],
      [rowOf(group(c, 'KERNELS'), 'danger.ipynb'), 'Shut down kernel']
    ] as [Locator, string][]) {
      await row.click({ button: 'right' });
      const entry = await read(label);
      expect(entry.danger, label).toBe(true);
      expect(entry.label, label).toBe(error);
      expect(entry.fill, label).toBe(error);
      // selected by the arrow keys: the error colour on the menu's selection background
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

test('DEF-PANEL-10-SHARED-VIEW: two views of one document are one row; a click activates a view; Close tab asks once for an unsaved change, then closes both views', async ({
  page,
  tmpPath
}) => {
  const current = fresh('views');
  const [shared, other] = [`${tmpPath}/shared.txt`, `${tmpPath}/other.txt`];
  for (const path of [shared, other]) {
    await page.contents.uploadContent('text', 'text', path);
  }
  try {
    await enterWorkspace(page, current);
    await openDocument(page, shared);
    // New View for the document, as its tab's context menu runs it
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:clone')
    );
    await openDocument(page, other);
    await expect
      .poll(async () => (await openPaths(page)).sort(), UNDER_LOAD)
      .toEqual([other, shared, shared]);
    await cardHeader(page, current).click();
    const c = card(page, current);
    await expect(rowOf(c, 'shared.txt')).toHaveCount(1);

    await rowOf(c, 'shared.txt').click();
    await expect.poll(() => activeTab(page)).toBe(shared);

    // an unsaved change, typed into the view the click activated
    const view = await page.evaluate(
      () => (window as any).jupyterapp.shell.currentWidget.id
    );
    await page.locator(`[id="${view}"] .cm-content`).click();
    await page.keyboard.type('changed ');
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(2);
    await fromRowMenu(rowOf(c, 'shared.txt'), 'Close tab');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Save your work'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Discard' })
      .click();
    await expect.poll(() => openPaths(page), UNDER_LOAD).toEqual([other]);
    await expect(dialog(page)).toHaveCount(0);
    await expect(rowOf(c, 'shared.txt')).toHaveCount(0);
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
