import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  colourOf,
  COLOURS,
  deleteWorkspaces,
  displayName,
  expectRefused,
  fresh,
  fromMenu,
  fromRowMenu,
  gotoWorkspace,
  headerButton,
  kernelIds,
  languageServer,
  layout,
  menuItem,
  menuButton,
  onlyWorkspaces,
  openPanel,
  openSection,
  PANEL,
  PANEL_TAB,
  panelWidth,
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
  sendToTerminal,
  serverList,
  shownElsewhere,
  startSession,
  startTerminal,
  terminalNames,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

/** The cards of workspaces, in the order shown. */
const workspaceCards = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`);

const openCards = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card.jp-mod-open`);

const dialog = (page: Page) => page.locator('.jp-Dialog');

/** Answer GET `url` with only the entries `keep` accepts: the items of other tests are not this test's. */
const only = (page: Page, url: RegExp, keep: (x: any) => boolean) =>
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

/** The colour of a card's strip, its `::before`, as the page draws it. */
const stripColour = (c: Locator) =>
  c.evaluate(n => getComputedStyle(n, '::before').backgroundColor);

/**
 * This window in a workspace of its own, the panel showing only the
 * workspaces of this test, and `others` saved beside it.
 */
async function setUp(
  page: IJupyterLabPageFixture,
  prefix: string,
  others: Record<string, Record<string, unknown>> = {}
): Promise<string> {
  const current = fresh(prefix);
  await onlyWorkspaces(page, id => id.startsWith(current));
  for (const [suffix, data] of Object.entries(others)) {
    await putWorkspace(page, `${current}-${suffix}`, data);
  }
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  await page.mouse.move(0, 0);
  return current;
}

/** The ids of the workspaces of a test, for the cleanup. */
const ids = (current: string, ...suffixes: string[]) => [
  current,
  ...suffixes.map(s => `${current}-${s}`)
];

/** A + b mixed in sRGB as `color-mix(in srgb, a p%, b)` mixes them. */
const mix = (a: number[], p: number, b: number[]) =>
  a.map((v, i) => Math.round(v * p + b[i] * (1 - p)));

const near = (actual: number[], expected: number[], tolerance = 1) =>
  actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

test('ACC-ACCORD-10-PER-WORKSPACE: one section per workspace the server lists', async ({
  page
}) => {
  const current = await setUp(page, 'per', { a: {}, b: {}, c: {} });
  try {
    await expect(workspaceCards(page)).toHaveCount(4);
    const names = await workspaceCards(page)
      .locator('.jp-WorkspaceManager-name')
      .allTextContents();
    expect(names.sort()).toEqual(ids(current, 'a', 'b', 'c').sort());
  } finally {
    await deleteWorkspaces(page, ids(current, 'a', 'b', 'c'));
  }
});

test("ACC-ACCORD-68-START-CLOSED: no card is open at load, this window's included", async ({
  page
}) => {
  const current = await setUp(page, 'closed', { a: {} });
  try {
    await expect(card(page, current)).toBeVisible();
    await expect(card(page, `${current}-a`)).toBeVisible();
    await expect(openCards(page)).toHaveCount(0);
    await expect(cardHeader(page, current)).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test("ACC-ACCORD-11-ONE-OPEN, ACC-ACCORD-162-TRIANGLE, ACC-ACCORD-77-CARET: one card open at a time; the triangle of another workspace's card opens and closes it and never switches; the triangle follows", async ({
  page
}) => {
  const current = await setUp(page, 'one', { a: {} });
  const other = `${current}-a`;
  const caret = (id: string) =>
    cardHeader(page, id).locator('.jp-WorkspaceManager-caret svg');
  const url = page.url();
  try {
    await expect(cardHeader(page, current)).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(caret(current)).toHaveAttribute(
      'data-icon',
      'ui-components:caret-right'
    );

    await cardHeader(page, current).click();
    await expect(cardHeader(page, current)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(caret(current)).toHaveAttribute(
      'data-icon',
      'ui-components:caret-down'
    );
    await expect(openCards(page)).toHaveCount(1);

    // ACC-ACCORD-11: opening another closes the open one
    await triangle(page, other).click();
    await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    await expect(triangle(page, other)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(card(page, current)).not.toHaveClass(/jp-mod-open/);
    await expect(caret(current)).toHaveAttribute(
      'data-icon',
      'ui-components:caret-right'
    );
    await expect(openCards(page)).toHaveCount(1);

    // ACC-ACCORD-162: a click on the open card's triangle leaves none open
    await triangle(page, other).click();
    await expect(openCards(page)).toHaveCount(0);
    await expect(triangle(page, other)).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(caret(other)).toHaveAttribute(
      'data-icon',
      'ui-components:caret-right'
    );
    // the window stays in its workspace; a switch would have loaded another page
    await page.waitForTimeout(1000);
    expect(page.url()).toBe(url);
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test('ACC-PANEL-4-OTHERS: a section another extension registers is not listed; the panel shows the workspace cards and the Kernels, Terminals and Language servers sections only', async ({
  page
}) => {
  const current = await setUp(page, 'others');
  try {
    // a manager another extension registers through IRunningSessionManagers
    await page.evaluate(async () => {
      const managers: any = await (window as any).galata.getPlugin(
        '@jupyterlab/running-extension:plugin'
      );
      managers.add({
        name: 'Debug sessions',
        running: () => [{ label: () => 'debug item', icon: () => '' }],
        refreshRunning: () => undefined,
        runningChanged: {
          connect: () => undefined,
          disconnect: () => undefined
        },
        shutdownAll: () => undefined
      });
    });
    await refresh(page);
    const labels = await page
      .locator(`${PANEL} .jp-WorkspaceManager-sectionLabel`)
      .allTextContents();
    expect(labels).not.toContain('DEBUG SESSIONS');
    expect(
      labels.every(label =>
        ['WORKSPACES', 'KERNELS', 'TERMINALS', 'LANGUAGE SERVERS'].includes(
          label
        )
      )
    ).toBe(true);
    const text = await page.locator(PANEL).textContent();
    expect(text).not.toContain('DEBUG SESSIONS');
    expect(text).not.toContain('debug item');
    // the built-in section list is absent
    await expect(page.locator('.jp-RunningSessions-section')).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-159-LANG-OTHERS: a language server is listed only in the LANGUAGE SERVERS section below the workspace cards, never inside a workspace card', async ({
  page
}) => {
  const current = await setUp(page, 'langothers');
  try {
    await languageServer(page, true);
    await cardHeader(page, current).click();
    await expect(card(page, current)).toHaveClass(/jp-mod-open/);
    expect(await card(page, current).textContent()).not.toContain('fake-lsp');
    await expect(sectionHeader(page, 'servers')).toContainText(
      'LANGUAGE SERVERS'
    );
    await openSection(page, 'servers');
    await expect(
      rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)')
    ).toBeVisible();
  } finally {
    await languageServer(page, false);
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-158-LANG-LISTED: a language server of the lab is listed in the LANGUAGE SERVERS section', async ({
  page
}) => {
  const current = await setUp(page, 'lang');
  try {
    await languageServer(page, true);
    await expect(sectionHeader(page, 'servers')).toContainText(
      'LANGUAGE SERVERS'
    );
    await expect(sectionCount(page, 'servers')).toHaveText('(1)');
    await openSection(page, 'servers');
    await expect(
      rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)')
    ).toBeVisible();
  } finally {
    await languageServer(page, false);
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-157-OTHERS-ACTIONS: the rows of the Kernels, Terminals and Language servers sections keep their shutdown buttons, and each header carries Shut down all with its confirmation', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = await setUp(page, 'forget');
  try {
    await languageServer(page, true);
    await expect(sectionHeader(page, 'terminals')).toContainText('TERMINALS');
    await expect(sectionHeader(page, 'servers')).toContainText(
      'LANGUAGE SERVERS'
    );
    // each section header carries Shut down all
    for (const name of ['terminals', 'servers']) {
      await expect(
        sectionHeader(page, name).getByRole('button', {
          name: 'Shut down all',
          exact: true
        })
      ).toBeVisible();
    }

    // a terminal row shuts its terminal down from its context menu
    await openSection(page, 'terminals');
    const row = rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`);
    await expect(row).toBeVisible();
    await fromRowMenu(row, 'Shut down terminal');
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    await expect(row).toHaveCount(0);

    // the language server row keeps its shutdown button
    await openSection(page, 'servers');
    await expect(
      rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)').locator(
        'button[aria-label="Shut Down"]'
      )
    ).toBeVisible();
    // and the header's Shut down all asks once, naming its items
    await sectionHeader(page, 'servers')
      .getByRole('button', { name: 'Shut down all', exact: true })
      .click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Shut down all?'
    );
    await expect(dialog(page).locator('.jp-Dialog-body')).toContainText(
      'language servers'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await languageServer(page, false);
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-182-SECTION-HEADS: WORKSPACES (3) stands above three accordions for the kernels, terminals and language servers in no workspace; one section is open at a time, a click closes and reopens a header, and an empty section is not shown', async ({
  page
}) => {
  // the terminals, kernels and language servers of other tests are in no workspace too
  let terminal = '';
  let kernelId = '';
  await only(
    page,
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    t => t.name === terminal
  );
  await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === kernelId);
  await only(page, /\/api\/sessions(\?.*)?$/, () => false);
  const current = await setUp(page, 'heads', { a: {}, b: {} });
  try {
    // nothing belongs to no workspace: WORKSPACES alone, with its count and body
    await expect(sectionHeader(page, 'workspaces')).toContainText('WORKSPACES');
    await expect(sectionCount(page, 'workspaces')).toHaveText('(3)');
    await expect(sectionBody(page, 'workspaces')).toBeVisible();
    await expect(
      sectionBody(page, 'workspaces').locator('.jp-WorkspaceManager-card')
    ).toHaveCount(3);
    for (const name of ['kernels', 'terminals', 'servers']) {
      await expect(
        page.locator(`${PANEL} [data-section="${name}"]`)
      ).toHaveCount(0);
    }

    // a terminal in no workspace: TERMINALS (1), the other two sections absent
    terminal = await startTerminal(page);
    await refresh(page);
    await expect(sectionCount(page, 'terminals')).toHaveText('(1)');
    await expect(page.locator(`${PANEL} [data-section="kernels"]`)).toHaveCount(
      0
    );
    await expect(page.locator(`${PANEL} [data-section="servers"]`)).toHaveCount(
      0
    );

    // a kernel in no workspace
    const response = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    kernelId = (await response.json()).id;
    await refresh(page);
    await expect(sectionCount(page, 'kernels')).toHaveText('(1)');

    // a language server
    await languageServer(page, true);
    await expect(sectionCount(page, 'servers')).toHaveText('(1)');
    const order = await page
      .locator(`${PANEL} .jp-WorkspaceManager-sectionLabel`)
      .allTextContents();
    expect(order).toEqual([
      'WORKSPACES',
      'KERNELS',
      'TERMINALS',
      'LANGUAGE SERVERS'
    ]);

    // a click on a header opens it and closes the open one, and a second click closes it
    for (const [name, text] of [
      ['kernels', 'Python'],
      ['terminals', `terminal ${terminal}`],
      ['servers', 'fake-lsp (python)']
    ] as const) {
      await sectionHeader(page, name).click();
      await expect(sectionHeader(page, name)).toHaveAttribute(
        'aria-expanded',
        'true'
      );
      await expect(sectionBody(page, name)).toBeVisible();
      await expect(sectionBody(page, name)).toContainText(text);
      await expect(
        sectionBody(page, name).locator('.jp-WorkspaceManager-row')
      ).toHaveCount(1);
      // WORKSPACES closed: its cards are not in the page
      await expect(card(page, current)).toHaveCount(0);
      await sectionHeader(page, name).click();
      await expect(sectionHeader(page, name)).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      await expect(
        page.locator(`${PANEL} .jp-WorkspaceManager-sectionBody`)
      ).toHaveCount(0);
    }
    await sectionHeader(page, 'terminals').click();
    await sectionHeader(page, 'servers').click();
    await expect(sectionHeader(page, 'terminals')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(sectionHeader(page, 'servers')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  } finally {
    await languageServer(page, false);
    if (terminal) {
      await page.request.delete(`/api/terminals/${terminal}`);
    }
    if (kernelId) {
      await page.request.delete(`/api/kernels/${kernelId}`);
    }
    await deleteWorkspaces(page, ids(current, 'a', 'b'));
  }
});

test('ACC-ACCORD-15-STRIP: each card shows a strip in its workspace colour', async ({
  page
}) => {
  const current = await setUp(page, 'strip', { a: {}, b: {} });
  const [a, b] = [`${current}-a`, `${current}-b`];
  try {
    const palette = await Promise.all(
      COLOURS.map(c => rgb(page, `var(--jp-workspace-manager-${c})`))
    );
    const strips: number[][] = [];
    for (const id of [a, b]) {
      // the colour the panel gave, stored on the server
      await expect.poll(() => colourOf(page, id), UNDER_LOAD).toBeTruthy();
      const colour = (await colourOf(page, id))!;
      await expect(card(page, id)).toHaveClass(new RegExp(`jp-mod-${colour}`));
      const strip = await rgb(page, await stripColour(card(page, id)));
      expect(strip).toEqual(palette[COLOURS.indexOf(colour)]);
      const width = await card(page, id).evaluate(
        n => getComputedStyle(n, '::before').width
      );
      expect(width).toBe('4px');
      strips.push(strip);
    }
    expect(strips[0]).not.toEqual(strips[1]);
  } finally {
    await deleteWorkspaces(page, ids(current, 'a', 'b'));
  }
});

test('ACC-ACCORD-16-ROTATION: after a reload, a new workspace takes the colour after the last one given', async ({
  page
}) => {
  // the retry budget below, 150 s, and the set-up and cleanup around it
  test.setTimeout(180000);
  const current = fresh('rotate');
  const seed = `${current}-seed`;
  const made: string[] = [];
  await onlyWorkspaces(page, id => id.startsWith(current));
  await putWorkspace(page, seed);
  // every card of this test has its colour, so the panel gives none by itself
  await patchMeta(page, seed, { colour: 'sky' });
  await putWorkspace(page, current);
  await patchMeta(page, current, { colour: 'sky' });
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    let attempt = 0;
    // other workers' windows give colours too; an attempt they interleave runs again
    await expect(async () => {
      attempt += 1;
      const [first, second] = [
        `${current}-x${attempt}`,
        `${current}-y${attempt}`
      ];
      made.push(first, second);
      // the last colour given is rose
      await patchMeta(page, seed, { colour: 'rose', given: true });
      await refresh(page);
      await createWorkspace(page, first);
      expect(await colourOf(page, first)).toBe('peach');

      await page.reload();
      await openPanel(page);
      await refresh(page);
      await createWorkspace(page, second);
      expect(await colourOf(page, second)).toBe('lemon');
      await expect(card(page, second)).toHaveClass(/jp-mod-lemon/);
    }).toPass({ timeout: 150000 });
  } finally {
    await deleteWorkspaces(page, [current, seed, ...made]);
  }
});

/** Create a workspace through the + dialog. */
async function createWorkspace(page: Page, name: string): Promise<void> {
  await headerButton(page, 'New workspace').click();
  await dialog(page).locator('input').fill(name);
  await dialog(page).locator('input').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, name)).toBeVisible();
}

test('ACC-ACCORD-17-STABLE-COLOUR: colours stay across a reload and the delete of another workspace', async ({
  page
}) => {
  const current = fresh('stable');
  const three = ['a', 'b', 'c'].map(s => `${current}-${s}`);
  await onlyWorkspaces(page, id => id.startsWith(current));
  await putWorkspace(page, current);
  // the last colour given is rose, so a colour lost and given again differs
  await patchMeta(page, current, { colour: 'rose', given: true });
  for (const id of three) {
    await putWorkspace(page, id);
  }
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    for (const id of three) {
      await expect.poll(() => colourOf(page, id), UNDER_LOAD).toBeTruthy();
    }
    const before = await Promise.all(
      three.map(async id => [
        await colourOf(page, id),
        await stripColour(card(page, id))
      ])
    );

    await deleteWorkspaces(page, [three[0]]);
    await page.reload();
    await openPanel(page);
    await refresh(page);
    await expect(card(page, three[0])).toHaveCount(0);
    for (const i of [1, 2]) {
      await expect(card(page, three[i])).toHaveClass(
        new RegExp(`jp-mod-${before[i][0]}`)
      );
      expect(await stripColour(card(page, three[i]))).toBe(before[i][1]);
      expect(await colourOf(page, three[i])).toBe(before[i][0]);
    }
  } finally {
    await deleteWorkspaces(page, [current, ...three]);
  }
});

test('ACC-ACCORD-18-PURPOSE: the purpose shows on the card that has one only', async ({
  page
}) => {
  const current = fresh('purpose');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a);
  await putWorkspace(page, b);
  await patchMeta(page, a, { purpose: 'Review of the feature branch' });
  try {
    await setUpExisting(page, current);
    await expect(
      card(page, a).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('Review of the feature branch');
    await expect(card(page, b)).toBeVisible();
    // no purpose line: the element holds no text and takes no width
    const purpose = card(page, b).locator('.jp-WorkspaceManager-purpose');
    await expect(purpose).toHaveText('');
    expect((await purpose.boundingBox())?.height ?? 0).toBe(0);
  } finally {
    await deleteWorkspaces(page, [current, a, b]);
  }
});

/** As setUp, for workspaces the test saved before. */
async function setUpExisting(
  page: IJupyterLabPageFixture,
  current: string
): Promise<void> {
  await onlyWorkspaces(page, id => id.startsWith(current));
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  await page.mouse.move(0, 0);
}

test('ACC-ACCORD-20-AGE: the header shows the age of the workspace', async ({
  page
}) => {
  const current = await setUp(page, 'age', { a: {} });
  try {
    for (const id of [current, `${current}-a`]) {
      // saved seconds ago
      await expect(
        card(page, id).locator('.jp-WorkspaceManager-age')
      ).toHaveText('now');
    }
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test.describe('kernels and sessions of the server', () => {
  // Galata lists only the kernels and sessions its page started; this test starts them by REST
  test.use({ kernels: null, sessions: null });

  test('ACC-ACCORD-22-COUNTS, ACC-ACCORD-70-COUNT-TABS: the header counts tabs, terminals and kernels', async ({
    page,
    tmpPath
  }) => {
    const terminals = [await startTerminal(page), await startTerminal(page)];
    const notebook = `${tmpPath}/counted.ipynb`;
    const response = await page.request.post('/api/sessions', {
      data: {
        path: notebook,
        name: 'counted.ipynb',
        type: 'notebook',
        kernel: { name: 'python3' }
      }
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    const current = fresh('counts');
    const [held, docs] = [`${current}-held`, `${current}-docs`];
    try {
      await putWorkspace(
        page,
        held,
        layout([...terminals.map(t => `terminal:${t}`), `notebook:${notebook}`])
      );
      await putWorkspace(
        page,
        docs,
        layout([`editor:${tmpPath}/a.md`, `editor:${tmpPath}/b.txt`])
      );
      await setUpExisting(page, current);
      const counts = (id: string) =>
        card(page, id)
          .locator('.jp-WorkspaceManager-count')
          .evaluateAll(nodes =>
            Object.fromEntries(
              nodes.map(n => [n.getAttribute('title'), n.textContent])
            )
          );
      // ACC-ACCORD-22: the notebook tab is a tab too
      expect(await counts(held)).toEqual({
        Tabs: '1',
        Terminals: '2',
        Kernels: '1'
      });
      // ACC-ACCORD-70
      expect(await counts(docs)).toEqual({
        Tabs: '2',
        Terminals: '0',
        Kernels: '0'
      });
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await Promise.all(
        terminals.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, held, docs]);
    }
  });

  test('ACC-PANEL-185-ROW-TOOLTIP: a terminal, a kernel, a language server and a tab row carry their details in a tooltip, one per line', async ({
    page,
    tmpPath
  }) => {
    const terminal = await startTerminal(page);
    const notebook = `${tmpPath}/tips.ipynb`;
    await putNotebook(page, notebook);
    const session = await startSession(page, notebook);
    const current = await setUp(page, 'tooltip', {
      doc: layout([`editor:${tmpPath}/note.md`])
    });
    try {
      // a tab row: its full path
      await triangle(page, `${current}-doc`).click();
      await expect(
        rowOf(card(page, `${current}-doc`), 'note.md')
      ).toHaveAttribute('title', `${tmpPath}/note.md`);

      // a terminal row: its name, the process and when it was last active
      await sendToTerminal(page, terminal, 'sleep 300\n');
      await openSection(page, 'terminals');
      const terminalRow = rowOf(
        sectionBody(page, 'terminals'),
        `terminal ${terminal}`
      );
      await expect
        .poll(async () => {
          await refresh(page);
          return terminalRow
            .locator('.jp-WorkspaceManager-rowLabel')
            .textContent();
        }, UNDER_LOAD)
        .toBe('sleep');
      const age = await terminalRow
        .locator('.jp-WorkspaceManager-age')
        .textContent();
      expect((await terminalRow.getAttribute('title'))!.split('\n')).toEqual([
        `terminal ${terminal}`,
        'sleep',
        age
      ]);

      // a kernel row: its kernelspec display name, the session path and its state
      const state = () =>
        serverList(page, '/api/kernels').then(
          list => list.find(k => k.id === session.kernel.id)?.execution_state
        );
      await expect.poll(state, UNDER_LOAD).toBe('idle');
      await openSection(page, 'kernels');
      await refresh(page);
      await expect(
        rowOf(sectionBody(page, 'kernels'), 'tips.ipynb')
      ).toHaveAttribute(
        'title',
        `${await displayName(page, session.kernel.name)}\n${notebook}\nidle`
      );

      // a language server row: its id and its language
      await languageServer(page, true);
      await openSection(page, 'servers');
      await expect(
        rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)')
      ).toHaveAttribute('title', 'fake-lsp\npython');
    } finally {
      await languageServer(page, false);
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, `${current}-doc`]);
    }
  });
});

test('ACC-ACCORD-23-OPEN: Open loads the workspace in this window with its tabs', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('open');
  const target = `${current}-target`;
  await putWorkspace(page, target, layout([`terminal:${terminal}`]));
  try {
    await setUpExisting(page, current);
    await cardHeader(page, target).hover();
    await card(page, target)
      .locator('button[aria-label="Open workspace"]')
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${target}(\\?.*)?$`)
    );
    // the terminal of the saved layout is a tab of this window
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            // absent until the page that loads the workspace has started
            const shell = (window as any).jupyterapp?.shell;
            return shell
              ? Array.from(shell.widgets('main')).map(
                  (w: any) => w.content?.session?.name
                )
              : [];
          }),
        { timeout: 30000 }
      )
      .toContain(terminal);
    await expect(
      page.locator('#jp-main-dock-panel .jp-Terminal')
    ).toBeVisible();
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, target]);
  }
});

test('ACC-ACCORD-25-CLOSE-CURRENT: Close all tabs of this window closes every main-area tab; an unsaved document asks', async ({
  page,
  tmpPath
}) => {
  const current = fresh('closecur');
  let terminal = '';
  const open = (path: string) =>
    page.evaluate(
      path =>
        (window as any).jupyterapp.commands.execute('docmanager:open', {
          path
        }),
      path
    );
  const widgets = () =>
    page.evaluate(() =>
      Array.from((window as any).jupyterapp.shell.widgets('main')).map(
        (w: any) => w.id
      )
    );
  try {
    await gotoWorkspace(page, current);
    for (const name of ['one.txt', 'two.txt']) {
      await page.contents.uploadContent(name, 'text', `${tmpPath}/${name}`);
    }
    await open(`${tmpPath}/one.txt`);
    // an unsaved change, typed as a user types it
    await page.locator('.jp-FileEditor .cm-content').click();
    await page.keyboard.type('changed ');
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(1);
    await open(`${tmpPath}/two.txt`);
    terminal = await page.evaluate(
      async () =>
        (
          await (window as any).jupyterapp.commands.execute(
            'terminal:create-new'
          )
        ).content.session.name
    );
    await expect(
      page.locator('#jp-main-dock-panel .jp-Terminal')
    ).toBeVisible();
    const before = await widgets();
    expect(before.length).toBeGreaterThanOrEqual(4); // the Launcher, 2 documents, the terminal
    await onlyWorkspaces(page, id => id === current);
    await openPanel(page);
    await refresh(page);
    await page.mouse.move(0, 0);

    await cardHeader(page, current).hover();
    await card(page, current)
      .locator('button[aria-label="Close all tabs"]')
      .click();
    // the terminal tab: Close all asks once (ACC-ACCORD-27)
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Close all tabs of ${current}?`
    );
    await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
    // JupyterLab's own question for the unsaved document
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Save your work'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Discard' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    // every tab is closed; JupyterLab then opens a new Launcher in the empty main area
    await expect
      .poll(
        async () => (await widgets()).filter(id => before.includes(id)),
        UNDER_LOAD
      )
      .toEqual([]);
    // JupyterLab adds the Launcher after a debounced layout change, so the
    // main area is empty for a moment after the last tab closes
    await expect
      .poll(widgets, UNDER_LOAD)
      .toEqual([expect.stringMatching(/^launcher-/)]);
  } finally {
    if (terminal) {
      await page.request.delete(`/api/terminals/${terminal}`);
    }
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('a kernel of the server', () => {
  // Galata lists only the kernels and sessions its page started; this test starts them by REST
  test.use({ kernels: null, sessions: null });

  test('ACC-ACCORD-26-CLOSE-OTHER: Close all tabs of another workspace empties its layout; the terminal and the kernel run on', async ({
    page,
    tmpPath
  }) => {
    const terminal = await startTerminal(page);
    const notebook = `${tmpPath}/held.ipynb`;
    const response = await page.request.post('/api/sessions', {
      data: {
        path: notebook,
        name: 'held.ipynb',
        type: 'notebook',
        kernel: { name: 'python3' }
      }
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    const current = fresh('closeother');
    const other = `${current}-other`;
    const keys = [`terminal:${terminal}`, `notebook:${notebook}`];
    await putWorkspace(page, other, layout(keys));
    try {
      await setUpExisting(page, current);
      const count = (title: string) =>
        card(page, other).locator(
          `.jp-WorkspaceManager-count[title="${title}"]`
        );
      // the kernel belongs to the workspace through its notebook tab
      await expect(count('Kernels')).toHaveText('1');
      await fromMenu(page, other, 'Close all tabs');
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect(dialog(page)).toHaveCount(0);

      await expect
        .poll(async () => JSON.stringify(await saved(page, other)), UNDER_LOAD)
        .not.toContain(terminal);
      const data = await saved(page, other);
      for (const key of keys) {
        expect(data).not.toHaveProperty([key]);
      }
      expect(data['layout-restorer:data'].main.dock).toBeNull();
      await expect(count('Terminals')).toHaveText('0');
      await expect(count('Kernels')).toHaveText('0');
      expect(await terminalNames(page)).toContain(terminal);
      expect(await kernelIds(page)).toContain(session.kernel.id);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, other]);
    }
  });
});

test('ACC-ACCORD-27-CLOSE-WARN: Close all tabs asks when the workspace holds a terminal; Cancel changes nothing', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('warn');
  const other = `${current}-other`;
  await putWorkspace(page, other, layout([`terminal:${terminal}`]));
  try {
    await setUpExisting(page, current);
    const before = await saved(page, other);
    await cardHeader(page, other).hover();
    await card(page, other)
      .locator('button[aria-label="Close all tabs"]')
      .click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Close all tabs of ${other}?`
    );
    await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
      'The workspace holds 1 terminal. They keep running without a tab, and the culler may then shut them down after its idle time.'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await refresh(page);
    expect(await saved(page, other)).toEqual(before);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-28-CLOSE-ELSEWHERE: actions on a workspace another window shows are refused', async ({
  page
}) => {
  // three windows load and ten actions are refused
  test.setTimeout(120000);
  const terminal = await startTerminal(page);
  const current = fresh('elsewhere');
  const [x, y] = [`${current}-x`, `${current}-y`];
  await putWorkspace(page, x, layout([`terminal:${terminal}`]));
  await putWorkspace(page, y);
  const opened: Page[] = [];
  try {
    opened.push(await secondWindow(page, x));
    await setUpExisting(page, current);
    // the second window saved its layout when it loaded
    const before = [await saved(page, x), await colourOf(page, x)];
    const url = page.url();
    const pages = page.context().pages().length;

    await cardHeader(page, x).hover();
    await card(page, x).locator('button[aria-label="Close all tabs"]').click();
    await expectRefused(page, 'Close all tabs');

    await cardHeader(page, x).hover();
    await card(page, x).locator('button[aria-label="Open workspace"]').click();
    await expectRefused(page, 'Open workspace');

    await fromMenu(page, x, 'Open workspace');
    await expectRefused(page, 'Open workspace');

    await fromMenu(page, x, 'Open in new browser tab');
    await expectRefused(page, 'Open in new browser tab');

    await fromMenu(page, x, 'Close all tabs');
    await expectRefused(page, 'Close all tabs');

    // Delete workspace: the first click arms, the second deletes
    await menuButton(page, x).click();
    await menuItem(page, 'Delete workspace').click();
    await menuItem(page, 'Confirm delete').click();
    await expectRefused(page, 'Delete workspace');

    // a header click switches, as Open workspace does
    await card(page, x).locator('.jp-WorkspaceManager-name').click();
    await expectRefused(page, 'Open workspace');

    // a row of the workspace opens it
    await triangle(page, x).click();
    await card(page, x).locator('.jp-WorkspaceManager-row').first().click();
    await expectRefused(page, 'Open workspace');

    expect(page.url()).toBe(url);
    expect(page.context().pages().length).toBe(pages);
    await refresh(page);
    await expect(card(page, x)).toBeVisible();
    expect([await saved(page, x), await colourOf(page, x)]).toEqual(before);

    // a browser tab this window opens is another window. The second window
    // closes first: the long-polling requests of the extensions of this lab
    // hold two of the browser's six connections per window, and three windows
    // leave none for the panel
    await opened.shift()!.close();
    const [third] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 20000 }),
      fromMenu(page, y, 'Open in new browser tab')
    ]);
    opened.push(third);
    await expect(third).toHaveURL(new RegExp(`/lab/workspaces/${y}$`));
    await onlyWorkspaces(third, id => id.startsWith(current));
    await openPanel(third);
    await refresh(third);
    await expect(card(third, current)).toBeVisible();
    await cardHeader(third, current).hover();
    await card(third, current)
      .locator('button[aria-label="Close all tabs"]')
      .click();
    await expectRefused(third, 'Close all tabs');
    await menuButton(third, current).click();
    await menuItem(third, 'Delete workspace').click();
    await menuItem(third, 'Confirm delete').click();
    await expectRefused(third, 'Delete workspace');
    await refresh(page);
    await expect(card(page, current)).toBeVisible();
  } finally {
    for (const p of opened) {
      await p.close();
    }
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, x, y]);
  }
});

test('ACC-SERVER-64-PRESENCE: a window that moves to another workspace no longer holds the first', async ({
  page
}) => {
  const w = fresh('presence-w');
  const [v, z] = [`${w}-v`, `${w}-z`];
  await putWorkspace(page, z);
  await putWorkspace(page, v);
  const second = await secondWindow(page, v);
  try {
    // page 1 on W
    await setUpExisting(page, w);
    await expect.poll(() => shownElsewhere(page), UNDER_LOAD).toContain(w);

    // page 1 opens Z and waits until Z has loaded; its report on W is replaced
    await fromMenu(page, z, 'Open workspace');
    await expect(page).toHaveURL(new RegExp(`/lab/workspaces/${z}$`));
    await expect(page.locator(PANEL_TAB)).toBeVisible({ timeout: 60000 });
    await expect.poll(() => shownElsewhere(page), UNDER_LOAD).toContain(z);
    expect(await shownElsewhere(page)).not.toContain(w);

    // page 2 refreshes, then opens W
    await onlyWorkspaces(second, id => id.startsWith(w));
    await openPanel(second);
    await refresh(second);
    await fromMenu(second, w, 'Open workspace');
    await expect(second).toHaveURL(new RegExp(`/lab/workspaces/${w}$`));
    await expect(second.locator('.jp-Dialog')).toHaveCount(0);
  } finally {
    await second.close();
    await deleteWorkspaces(page, [w, v, z]);
  }
});

test('ACC-ACCORD-69-CARD: other cards have tinted headers; an open one has a neutral body and a border in its colour', async ({
  page
}) => {
  const current = fresh('card');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a);
  await putWorkspace(page, b);
  await patchMeta(page, a, { colour: 'mint' });
  await patchMeta(page, b, { colour: 'lavender' });
  try {
    await setUpExisting(page, current);
    const background = (l: Locator) =>
      l.evaluate(n => getComputedStyle(n).backgroundColor);
    expect(await background(cardHeader(page, a))).not.toBe(
      await background(cardHeader(page, b))
    );
    await triangle(page, a).click();
    await expect(card(page, a)).toHaveClass(/jp-mod-open/);
    const open = await card(page, a).evaluate(n => {
      const s = getComputedStyle(n);
      return {
        width: s.borderTopWidth,
        style: s.borderTopStyle,
        colour: s.borderTopColor,
        body: getComputedStyle(n).backgroundColor
      };
    });
    expect([open.width, open.style]).toEqual(['1px', 'solid']);
    expect(await rgb(page, open.colour)).toEqual(
      await rgb(page, 'var(--jp-workspace-manager-mint)')
    );
    expect(await rgb(page, open.body)).toEqual(
      await rgb(page, 'var(--jp-layout-color1)')
    );
  } finally {
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test("ACC-ACCORD-76-OUTLINE: only this window's card has the brand colour 2 outline", async ({
  page
}) => {
  const current = await setUp(page, 'outline', { a: {}, b: {} });
  try {
    await expect(workspaceCards(page)).toHaveCount(3);
    const outlined = page.locator(
      `${PANEL} .jp-WorkspaceManager-card.jp-mod-current`
    );
    await expect(outlined).toHaveCount(1);
    await expect(outlined).toHaveAttribute('data-workspace', current);
    const outline = (l: Locator) =>
      l.evaluate(n => {
        const s = getComputedStyle(n);
        return [s.outlineStyle, s.outlineWidth, s.outlineColor];
      });
    const [style, width, colour] = await outline(outlined);
    expect([style, width]).toEqual(['solid', '2px']);
    expect(await rgb(page, colour)).toEqual(
      await rgb(page, 'var(--jp-brand-color2)')
    );
    for (const id of [`${current}-a`, `${current}-b`]) {
      expect((await outline(card(page, id)))[0]).toBe('none');
    }
  } finally {
    await deleteWorkspaces(page, ids(current, 'a', 'b'));
  }
});

test("ACC-ACCORD-125-SELECTED-SHADE: this window's header takes the active shade, its body 40% of it; another header an 8% tint", async ({
  page
}) => {
  const current = fresh('shade');
  const other = `${current}-other`;
  await putWorkspace(page, current);
  await putWorkspace(page, other);
  await patchMeta(page, current, { colour: 'sky' });
  await patchMeta(page, other, { colour: 'rose' });
  try {
    await setUpExisting(page, current);
    await cardHeader(page, current).click();
    for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
      await page.theme.setTheme(theme);
      await page.mouse.move(0, 0);
      const layout1 = await rgb(page, 'var(--jp-layout-color1)');
      const active = await rgb(page, 'var(--jp-workspace-manager-sky-active)');
      const rose = await rgb(page, 'var(--jp-workspace-manager-rose)');
      const bg = async (l: Locator) =>
        rgb(page, await l.evaluate(n => getComputedStyle(n).backgroundColor));

      expect(await bg(cardHeader(page, current)), theme).toEqual(active);
      const body = await bg(card(page, current));
      expect(
        near(body, mix(active, 0.4, layout1)),
        `${theme} body ${body}`
      ).toBe(true);
      const tint = await bg(cardHeader(page, other));
      expect(
        near(tint, mix(rose, 0.08, layout1)),
        `${theme} tint ${tint}`
      ).toBe(true);
      // the shades differ from the panel, so the test can tell them apart
      expect(active).not.toEqual(layout1);
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-97-ELLIPSIS: a long name ends in an ellipsis, the purpose wraps in full; the tooltip holds the full name and purpose', async ({
  page
}) => {
  const current = fresh('long');
  const long = `${current}-${'n'.repeat(80 - current.length - 1)}`;
  const purpose =
    'A purpose long enough to be cut at the right edge of the card, so that it ends in an ellipsis';
  expect(long).toHaveLength(80);
  await putWorkspace(page, long);
  await patchMeta(page, long, { purpose });
  try {
    await setUpExisting(page, current);
    const name = await card(page, long)
      .locator('.jp-WorkspaceManager-name')
      .evaluate(n => ({
        overflow: getComputedStyle(n).textOverflow,
        clipped: n.scrollWidth > n.clientWidth
      }));
    expect(name).toEqual({ overflow: 'ellipsis', clipped: true });
    // the purpose is never shortened with an ellipsis
    const text = await card(page, long)
      .locator('.jp-WorkspaceManager-purpose')
      .evaluate(n => ({
        overflow: getComputedStyle(n).textOverflow,
        clipped: n.scrollWidth > n.clientWidth,
        content: n.textContent
      }));
    expect(text).toEqual({
      overflow: 'clip',
      clipped: false,
      content: purpose
    });
    await expect(cardHeader(page, long)).toHaveAttribute(
      'title',
      `${long}\n${purpose}`
    );
  } finally {
    await deleteWorkspaces(page, [current, long]);
  }
});

test('ACC-ACCORD-98-HOVER-ACTIONS: the open and close-all icons of a closed card show on hover and on keyboard focus', async ({
  page
}) => {
  const current = await setUp(page, 'hover', { a: {} });
  const other = `${current}-a`;
  const icons = card(page, other).locator(
    'button[aria-label="Open workspace"], button[aria-label="Close all tabs"]'
  );
  try {
    await expect(icons).toHaveCount(2);
    await expect(icons.nth(0)).toBeHidden();
    await expect(icons.nth(1)).toBeHidden();

    await cardHeader(page, other).hover();
    await expect(icons.nth(0)).toBeVisible();
    await expect(icons.nth(1)).toBeVisible();

    await page.mouse.move(0, 0);
    await expect(icons.nth(0)).toBeHidden();
    // Tab from the header before it until this one has the focus
    await cardHeader(page, current).focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (
        await cardHeader(page, other).evaluate(
          n => n === document.activeElement
        )
      ) {
        break;
      }
    }
    await expect(cardHeader(page, other)).toBeFocused();
    await expect(icons.nth(0)).toBeVisible();
    await expect(icons.nth(1)).toBeVisible();
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test('ACC-ACCORD-153-HOVER-NAME: on hover the icons take the place of the age, so a long name keeps its width', async ({
  page
}) => {
  const suffix = 'a-name-too-long-for-the-card';
  const current = await setUp(page, 'hovername', { [suffix]: {} });
  const header = cardHeader(page, `${current}-${suffix}`);
  const name = header.locator('.jp-WorkspaceManager-name');
  const age = header.locator('.jp-WorkspaceManager-age');
  const icons = header.locator('.jp-WorkspaceManager-hoverActions button');
  const width = () => name.evaluate(n => n.getBoundingClientRect().width);
  try {
    expect(await panelWidth(page)).toBe(250);
    // the name is cut, so any width the icons took would show less of it
    expect(await name.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
    await expect(age).toBeVisible();
    await expect(icons.nth(0)).toBeHidden();
    const before = await width();

    await header.hover();
    await expect(icons.nth(0)).toBeVisible();
    await expect(icons.nth(1)).toBeVisible();
    await expect(age).toBeHidden();
    expect(await width()).toBe(before);
  } finally {
    await deleteWorkspaces(page, ids(current, suffix));
  }
});

test('DEF-PANEL-12-HOVER-CLICK: after a click in a card header the icons hide when the pointer leaves; Tab still shows and reaches them', async ({
  page
}) => {
  const current = await setUp(page, 'hoverclick', { a: {} });
  const other = `${current}-a`;
  const header = cardHeader(page, other);
  const icons = header.locator('.jp-WorkspaceManager-hoverActions button');
  const focused = (label: string) =>
    expect(header.locator(`button[aria-label="${label}"]`)).toBeFocused();
  try {
    // click an open card's header to close it, move the pointer off the card:
    // this window's card, as a header click on another workspace's card switches
    const mine = cardHeader(page, current);
    const myIcons = mine.locator('.jp-WorkspaceManager-hoverActions button');
    await mine.click();
    await expect(mine).toHaveAttribute('aria-expanded', 'true');
    await mine.click();
    await expect(mine).toHaveAttribute('aria-expanded', 'false');
    await expect(mine).toBeFocused();
    await page.mouse.move(0, 0);
    await expect(myIcons.nth(0)).toBeHidden();
    await expect(myIcons.nth(1)).toBeHidden();

    // a click on an icon: Close all tabs of a workspace without terminals asks nothing
    await header.hover();
    await icons.nth(1).click();
    await page.mouse.move(0, 0);
    await expect(icons.nth(0)).toBeHidden();
    await expect(icons.nth(1)).toBeHidden();

    // keyboard focus shows them, and Tab moves from the header through both icons
    await cardHeader(page, current).focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (await header.evaluate(n => n === document.activeElement)) {
        break;
      }
    }
    await expect(header).toBeFocused();
    await expect(icons.nth(0)).toBeVisible();
    await page.keyboard.press('Tab');
    await focused('Expand');
    await page.keyboard.press('Tab');
    await focused('Open workspace');
    await page.keyboard.press('Tab');
    await focused('Close all tabs');
    await expect(icons.nth(0)).toBeVisible();
    await page.keyboard.press('Tab');
    await focused('Workspace menu');
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test('ACC-ACCORD-167-NO-BUTTONS: an open card ends with its last row, without Open or Close all tabs; both stay in its ... menu', async ({
  page,
  tmpPath
}) => {
  const current = await setUp(page, 'buttons', {
    a: layout([`editor:${tmpPath}/one.txt`, `editor:${tmpPath}/two.txt`])
  });
  const other = `${current}-a`;
  const body = card(page, other).locator('.jp-WorkspaceManager-cardBody');
  try {
    await triangle(page, other).click();
    await expect(body.locator('.jp-WorkspaceManager-row')).toHaveCount(2);
    for (const name of ['Open', 'Close all tabs']) {
      await expect(body.getByRole('button', { name, exact: true })).toHaveCount(
        0
      );
    }
    // the last row ends the card
    expect(
      await body.evaluate(n =>
        n.lastElementChild?.lastElementChild?.classList.contains(
          'jp-WorkspaceManager-row'
        )
      )
    ).toBe(true);

    await menuButton(page, other).click();
    await expect(menuItem(page, 'Open workspace')).toBeVisible();
    await expect(menuItem(page, 'Close all tabs')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test("ACC-ACCORD-163-HEADER-SWITCH: a click on the name of another workspace's card switches this window to it", async ({
  page
}) => {
  const current = await setUp(page, 'switch', { a: {} });
  const other = `${current}-a`;
  try {
    await card(page, other).locator('.jp-WorkspaceManager-name').click();
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${other}(\\?.*)?$`)
    );
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test("ACC-ACCORD-164-HEADER-TOGGLE: a header click opens and closes this window's card", async ({
  page
}) => {
  const current = await setUp(page, 'toggle');
  const url = page.url();
  try {
    const c = card(page, current);
    const header = c.locator('.jp-WorkspaceManager-cardHeader');
    await header.click();
    await expect(c).toHaveClass(/jp-mod-open/);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(page.url()).toBe(url);
    await header.click();
    await expect(c).not.toHaveClass(/jp-mod-open/);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(page.url()).toBe(url);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('at 4x device scale', () => {
  test.use({ deviceScaleFactor: 4 });

  /**
   * The device pixels of a region around a card's top-left corner, with the
   * card's corner at (`margin`, `margin`) CSS px of the region.
   */
  async function cornerPixels(page: Page, id: string, margin: number) {
    const box = (await card(page, id).boundingBox())!;
    const size = margin + 12;
    const png = await page.screenshot({
      clip: { x: box.x - margin, y: box.y - margin, width: size, height: size }
    });
    return page.evaluate(async b64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return {
        width: image.width,
        data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data)
      };
    }, png.toString('base64'));
  }

  test('ACC-ACCORD-128-STRIP-PLAIN, ACC-ACCORD-129-FLUSH: the strip and shade stay inside the rounded card; the outline lies against it', async ({
    page
  }) => {
    const current = fresh('fit');
    const other = `${current}-other`;
    await putWorkspace(page, current);
    await putWorkspace(page, other);
    await patchMeta(page, current, { colour: 'mint' });
    await patchMeta(page, other, { colour: 'mint' });
    try {
      await setUpExisting(page, current);
      // in Light the active shade is the strip colour, in Dark a darker one
      for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
        await page.theme.setTheme(theme);
        await page.mouse.move(0, 0);
        const strip = await rgb(page, 'var(--jp-workspace-manager-mint)');
        const panel = await rgb(page, 'var(--jp-layout-color1)');
        const outline = await rgb(page, 'var(--jp-brand-color2)');
        const shade = await rgb(
          page,
          await cardHeader(page, current).evaluate(
            n => getComputedStyle(n).backgroundColor
          )
        );
        if (theme === 'JupyterLab Dark') {
          expect(shade).not.toEqual(strip);
        }

        // ACC-ACCORD-128: the same strip on both cards
        const stripStyle = (id: string) =>
          card(page, id).evaluate(n => {
            const s = getComputedStyle(n, '::before');
            return [s.width, s.backgroundColor];
          });
        expect(await stripStyle(current)).toEqual(await stripStyle(other));

        const S = 4; // device pixels per CSS pixel
        const R = 3 * S; // the corner radius
        const W = 2 * S; // the outline width
        const at = (
          px: { width: number; data: number[] },
          x: number,
          y: number
        ) => px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3);
        const is = (c: number[], expected: number[]) => near(c, expected, 8);

        // the region of the other card ends 2px above it, under this window's outline
        for (const [id, outlined, M] of [
          [current, true, 4],
          [other, false, 2]
        ] as const) {
          const px = await cornerPixels(page, id, M);
          const [cx, cy] = [M * S + R, M * S + R]; // centre of the corner arc
          const wrong: string[] = [];
          for (let y = 0; y < px.width; y++) {
            for (let x = 0; x < px.width; x++) {
              const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
              // distance outside the card's edge; negative inside
              const out =
                dx < 0 && dy < 0
                  ? Math.hypot(dx, dy) - R
                  : Math.max(-(x + 0.5 - M * S), -(y + 0.5 - M * S));
              const c = at(px, x, y);
              // anti-aliased bands at the edge and at the outline's outer edge are not judged
              if (
                Math.abs(out) < 1.5 ||
                (outlined && Math.abs(out - W) < 1.5)
              ) {
                continue;
              }
              if (out < 0) {
                continue;
              }
              const expected = outlined && out < W ? outline : panel;
              if (!is(c, expected)) {
                wrong.push(`(${x},${y}) ${c} where ${expected}`);
              }
            }
          }
          expect(
            wrong.slice(0, 5),
            `${theme} ${id}: ${wrong.length} pixels`
          ).toEqual([]);

          // ACC-ACCORD-128: the strip, then at its right edge the header background
          const row = M * S + 2 * R;
          const x0 = M * S;
          expect(is(at(px, x0 + 1, row), strip), `${id} strip`).toBe(true);
          expect(
            is(at(px, x0 + 4 * S - 1, row), strip),
            `${id} strip end`
          ).toBe(true);
          const header = outlined
            ? shade
            : await rgb(
                page,
                await cardHeader(page, id).evaluate(
                  n => getComputedStyle(n).backgroundColor
                )
              );
          expect(is(at(px, x0 + 4 * S, row), header), `${id} shade start`).toBe(
            true
          );
        }
      }
    } finally {
      await deleteWorkspaces(page, [current, other]);
    }
  });
});
