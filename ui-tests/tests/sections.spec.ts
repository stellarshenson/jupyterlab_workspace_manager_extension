import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  colourOf,
  COLOURS,
  countOf,
  cwdOf,
  deleteWorkspaces,
  displayName,
  expectRefused,
  fresh,
  fromMenu,
  fromRowMenu,
  gotoWorkspace,
  headerButton,
  kernelIds,
  KERNEL_START,
  languageServer,
  layout,
  openCardMenu,
  menuItem,
  newTerminalTab,
  only,
  onlyWorkspaces,
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
  rgba,
  rowLabel,
  rowOf,
  saved,
  savedTabs,
  secondWindow,
  sectionBody,
  sectionCount,
  sectionHeader,
  serverList,
  shade,
  shownElsewhere,
  sidebarTo,
  sleepInTerminal,
  startSession,
  startTerminal,
  stripColour,
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

/** The ids of the cards, in the order shown. */
const order = (page: Page) =>
  workspaceCards(page).evaluateAll(cards =>
    cards.map(c => c.getAttribute('data-workspace'))
  );

/** The ids sorted by the positions the server stores for them. */
async function stored(page: Page, ids: string[]): Promise<string[]> {
  const response = await page.request.get(
    '/jupyterlab-workspace-manager-extension/meta'
  );
  const records = await response.json();
  return [...ids].sort((x, y) => records[x].position - records[y].position);
}

/**
 * Save the workspaces `placed`, their positions in that order, then open this
 * window in `current`, one of them; the panel sees only these. Each position
 * is stored before its workspace exists, so no window gives it another.
 */
async function setUpPlaced(
  page: IJupyterLabPageFixture,
  current: string,
  placed: string[]
): Promise<void> {
  for (const [position, id] of placed.entries()) {
    await patchMeta(page, id, { position });
    await putWorkspace(page, id);
  }
  await onlyWorkspaces(page, id => id.startsWith(current));
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
}

test("ACC-ACCORD-190-FIXED-ORDER: a save and a switch of this window to the last card's workspace move no card; this window's card keeps its place", async ({
  page
}) => {
  const current = fresh('fixed');
  const [a, b] = [`${current}-a`, `${current}-b`];
  const placed = [a, current, b];
  await setUpPlaced(page, current, placed);
  try {
    await expect.poll(() => order(page)).toEqual(placed);
    // a save gives a the newest last_modified
    await putWorkspace(page, a, layout(['editor:notes.md']));
    await refresh(page);
    expect(await order(page)).toEqual(placed);

    await card(page, b).locator('.jp-WorkspaceManager-name').click();
    await expect(page).toHaveURL(new RegExp(`/lab/workspaces/${b}(\\?.*)?$`));
    await expect(page.locator(PANEL_TAB)).toBeVisible({ timeout: 60000 });
    await openPanel(page);
    await refresh(page);
    await expect(card(page, b)).toHaveClass(/jp-mod-current/);
    expect(await order(page)).toEqual(placed);
  } finally {
    await deleteWorkspaces(page, placed);
  }
});

test('ACC-ACCORD-191-DRAG-ORDER: the third card dragged above the first stays there after a reload and in another window; Move up and Move down of the card menu move it by one', async ({
  page
}) => {
  const current = fresh('drag');
  const [a, b] = [`${current}-a`, `${current}-b`];
  const placed = [current, a, b];
  await setUpPlaced(page, current, placed);
  let second: Page | undefined;
  try {
    await expect.poll(() => order(page)).toEqual(placed);
    // dropped on the top edge of the first card: the line goes above it
    await cardHeader(page, b).dragTo(cardHeader(page, current), {
      sourcePosition: { x: 50, y: 10 },
      targetPosition: { x: 50, y: 2 }
    });
    const dragged = [b, current, a];
    await expect.poll(() => order(page)).toEqual(dragged);
    await expect.poll(() => stored(page, placed), UNDER_LOAD).toEqual(dragged);

    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    expect(await order(page)).toEqual(dragged);
    second = await secondWindow(page, a);
    await onlyWorkspaces(second, id => id.startsWith(current));
    await openPanel(second);
    await refresh(second);
    expect(await order(second)).toEqual(dragged);

    await fromMenu(page, current, 'Move up');
    await expect.poll(() => order(page)).toEqual([current, b, a]);
    await expect
      .poll(() => stored(page, placed), UNDER_LOAD)
      .toEqual([current, b, a]);
    await fromMenu(page, current, 'Move down');
    await expect.poll(() => order(page)).toEqual(dragged);
    await expect.poll(() => stored(page, placed), UNDER_LOAD).toEqual(dragged);
  } finally {
    await second?.close();
    await deleteWorkspaces(page, placed);
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

test('ACC-ACCORD-241-MANY-OPEN, ACC-ACCORD-162-TRIANGLE, ACC-ACCORD-77-CARET: two cards open in turn and both stay open; a triangle closes only its own card and never switches; the caret follows', async ({
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

    // this window's card still opens from its own header
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

    // ACC-ACCORD-241: another card's triangle opens it and the first stays open
    await triangle(page, other).click();
    await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    await expect(triangle(page, other)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(card(page, current)).toHaveClass(/jp-mod-open/);
    await expect(caret(current)).toHaveAttribute(
      'data-icon',
      'ui-components:caret-down'
    );
    await expect(openCards(page)).toHaveCount(2);

    // ACC-ACCORD-162: a click on a triangle closes that card alone; the other stays open
    await triangle(page, other).click();
    await expect(openCards(page)).toHaveCount(1);
    await expect(card(page, current)).toHaveClass(/jp-mod-open/);
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

test('ACC-ACCORD-241-MANY-OPEN: deleting a workspace closes its card and leaves no open state for its id', async ({
  page
}) => {
  const current = await setUp(page, 'deleteopen', { a: {} });
  const other = `${current}-a`;
  try {
    await triangle(page, other).click();
    await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    await openCardMenu(page, other);
    await menuItem(page, 'Delete workspace').click();
    // the first click arms; the menu stays
    await expect(menuItem(page, 'Confirm delete')).toBeVisible();
    await page.waitForTimeout(700);
    await menuItem(page, 'Confirm delete').click();
    await expect(card(page, other)).toHaveCount(0, UNDER_LOAD);
    // the id's open state is gone too: saved again under the same id, the workspace shows closed
    await putWorkspace(page, other);
    await refresh(page);
    await expect(card(page, other)).toBeVisible();
    await expect(card(page, other)).not.toHaveClass(/jp-mod-open/);
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

test('ACC-PANEL-157-OTHERS-ACTIONS: a TERMINALS row holds no button and shuts its terminal down from its context menu, a LANGUAGE SERVERS row keeps its shutdown button, and each of the three headers carries Shut down all with its confirmation', async ({
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
    for (const name of ['kernels', 'terminals', 'servers']) {
      await expect(
        sectionHeader(page, name).getByRole('button', {
          name: 'Shut down all',
          exact: true
        })
      ).toBeVisible();
    }

    // a terminal row shuts its terminal down from its context menu
    await openSection(page, 'terminals');
    const row = rowOf(sectionBody(page, 'terminals'), rowLabel(terminal));
    await expect(row).toBeVisible();
    await expect(row.locator('button')).toHaveCount(0);
    await fromRowMenu(row, 'Shut down terminal');
    // the route leaves out the ended pty at the load after the DELETE
    await expect(row).toHaveCount(0);
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);

    // the language server row keeps its shutdown button, shown on hover
    await openSection(page, 'servers');
    const server = rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)');
    await server.hover();
    await expect(
      server.locator('button[aria-label="Shut Down"]')
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

test('ACC-PANEL-182-SECTION-HEADS, ACC-PANEL-229-EXCLUSIVE: WORKSPACES (3) opens by default; opening a section closes the open one; clicking the open header closes all four; a reload keeps the one open section', async ({
  page
}) => {
  // the terminals, kernels and language servers of other tests are listed too
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
    // nothing runs: WORKSPACES with its count and body, the three others at (0)
    await expect(sectionHeader(page, 'workspaces')).toContainText('WORKSPACES');
    await expect(sectionCount(page, 'workspaces')).toHaveText('(3)');
    await expect(sectionBody(page, 'workspaces')).toBeVisible();
    await expect(
      sectionBody(page, 'workspaces').locator('.jp-WorkspaceManager-card')
    ).toHaveCount(3);
    for (const name of ['kernels', 'terminals', 'servers']) {
      await expect(sectionCount(page, name)).toHaveText('(0)');
    }

    // a terminal: TERMINALS (1)
    terminal = await startTerminal(page);
    await refresh(page);
    await expect(sectionCount(page, 'terminals')).toHaveText('(1)');

    // a kernel
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

    // WORKSPACES alone is open; its body holds every card
    const expanded = () =>
      Promise.all(
        ['workspaces', 'kernels', 'terminals', 'servers'].map(name =>
          sectionHeader(page, name).getAttribute('aria-expanded')
        )
      );
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);

    // opening a section closes the open one; a closed section shows its band only
    const steps: [string, string, string][] = [
      ['kernels', kernelId, 'workspaces'],
      ['terminals', rowLabel(terminal), 'kernels'],
      ['servers', 'fake-lsp (python)', 'terminals']
    ];
    for (const [name, text, was] of steps) {
      await sectionHeader(page, name).click();
      await expect(sectionBody(page, name)).toContainText(text);
      await expect(
        sectionBody(page, name).locator('.jp-WorkspaceManager-row')
      ).toHaveCount(1);
      await expect(sectionBody(page, was)).toHaveCount(0);
      expect(await expanded()).toEqual(
        ['workspaces', 'kernels', 'terminals', 'servers'].map(k =>
          k === name ? 'true' : 'false'
        )
      );
    }

    // a click on the open header closes every section
    await sectionHeader(page, 'servers').click();
    expect(await expanded()).toEqual(['false', 'false', 'false', 'false']);
    for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
      await expect(sectionBody(page, name)).toHaveCount(0);
    }

    // WORKSPACES opens again; the one open section outlives the page
    await sectionHeader(page, 'workspaces').click();
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);
    await page.reload();
    await openPanel(page);
    await refresh(page);
    await expect(card(page, current)).toBeVisible();
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);
    await sectionHeader(page, 'kernels').click();
    await expect(sectionBody(page, 'kernels')).toContainText(kernelId);
    await page.reload();
    await openPanel(page);
    await refresh(page);
    expect(await expanded()).toEqual(['false', 'true', 'false', 'false']);
    await expect(sectionBody(page, 'kernels')).toContainText(kernelId);
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

test('ACC-ACCORD-15-STRIP: each card shows a 4 px strip, its left border, in the value of its workspace colour', async ({
  page
}) => {
  const current = await setUp(page, 'strip', { a: {}, b: {} });
  const [a, b] = [`${current}-a`, `${current}-b`];
  try {
    const palette = await Promise.all(
      COLOURS.map(async colour => rgb(page, await shade(page, colour)))
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
        n => getComputedStyle(n).borderLeftWidth
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

test('ACC-ACCORD-18-PURPOSE: the purpose shows while its card is open, on the card that has one only; a closed card shows no purpose', async ({
  page
}) => {
  const current = fresh('purpose');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a);
  await putWorkspace(page, b);
  await patchMeta(page, a, { purpose: 'Review of the feature branch' });
  try {
    await setUpExisting(page, current);
    // DQ-17: closed cards show no purpose
    await expect(card(page, b)).toBeVisible();
    await expect(
      page.locator(`${PANEL} .jp-WorkspaceManager-purpose`)
    ).toHaveCount(0);
    await openCard(page, a);
    await expect(
      card(page, a).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('Review of the feature branch');
    await openCard(page, b);
    await triangle(page, a).click();
    await expect(
      card(page, a).locator('.jp-WorkspaceManager-purpose')
    ).toHaveCount(0);
    // no purpose line: the element is not rendered
    await expect(
      card(page, b).locator('.jp-WorkspaceManager-purpose')
    ).toHaveCount(0);
    // a hidden workspace's open card shows its purpose and counts too
    await patchMeta(page, a, { hidden: true });
    await refresh(page);
    await headerButton(page, 'Show hidden workspaces').click();
    await openCard(page, a);
    await expect(
      card(page, a).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('Review of the feature branch');
    await expect(
      card(page, a).locator('.jp-WorkspaceManager-count')
    ).toBeVisible();
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

test('ACC-ACCORD-20-AGE: the header shows the age of the workspace, now under 60 s', async ({
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

/** The row count of a card's header, with the keys of its flat rows. */
const holds = async (page: Page, id: string) => ({
  count: await countOf(card(page, id)).textContent(),
  rows: (
    await card(page, id)
      .locator('.jp-WorkspaceManager-row')
      .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-row-key')))
  ).sort()
});

test("ACC-ACCORD-70-COUNT-TABS: another workspace's card counts every tab of its saved layout, documents and terminals: 6 terminal tabs show 6; a saved key of a terminal that no longer runs does not count; the flat rows list each tab once", async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const terminals: string[] = [];
  for (let i = 0; i < 6; i++) {
    terminals.push(await startTerminal(page));
  }
  const ended = await startTerminal(page);
  await page.request.delete(`/api/terminals/${ended}`);
  await expect.poll(() => terminalNames(page), UNDER_LOAD).not.toContain(ended);
  const current = fresh('tabcount');
  const [six, mixed, kept, gone] = ['six', 'mixed', 'kept', 'gone'].map(
    s => `${current}-${s}`
  );
  const [one] = terminals.map(t => `terminal:${t}`);
  await putWorkspace(page, six, layout(terminals.map(t => `terminal:${t}`)));
  await putWorkspace(
    page,
    mixed,
    layout([`editor:${tmpPath}/a.md`, `editor:${tmpPath}/b.txt`, one])
  );
  await putWorkspace(page, kept, layout([one, `terminal:${ended}`]));
  await putWorkspace(page, gone, layout([`terminal:${ended}`]));
  try {
    await setUpExisting(page, current);
    await openCard(page, six);
    expect(await holds(page, six)).toEqual({
      count: '(6)',
      rows: terminals.map(t => `terminal:${t}`).sort()
    });
    await openCard(page, mixed);
    expect(await holds(page, mixed)).toEqual({
      count: '(3)',
      rows: [`editor:${tmpPath}/a.md`, `editor:${tmpPath}/b.txt`, one].sort()
    });
    await openCard(page, kept);
    expect(await holds(page, kept)).toEqual({ count: '(1)', rows: [one] });
    await openCard(page, gone);
    expect(await holds(page, gone)).toEqual({ count: '(0)', rows: [] });
  } finally {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, ids(current, 'six', 'mixed', 'kept', 'gone'));
  }
});

test("ACC-ACCORD-70-COUNT-TABS: this window's card counts its live tabs, documents and terminals; the kept tab of an ended terminal does not count", async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const doc = `${tmpPath}/counted.txt`;
  await page.contents.uploadContent('text', 'text', doc);
  const current = fresh('livecount');
  const shown = async () => {
    await refresh(page);
    return Number(
      (await countOf(card(page, current)).textContent())!.replace(/[()]/g, '')
    );
  };
  const names: string[] = [];
  try {
    await setUpExisting(page, current);
    await openCard(page, current);
    // the tabs the window opened with, such as the Launcher
    const base = await shown();

    names.push(await newTerminalTab(page), await newTerminalTab(page));
    await expect.poll(shown, UNDER_LOAD).toBe(base + 2);
    await openDocument(page, doc);
    await expect.poll(shown, UNDER_LOAD).toBe(base + 3);

    // the tab outlives its terminal, as a terminal with closeOnExit off does
    await page.evaluate(name => {
      const app = (window as any).jupyterapp;
      Array.from<any>(app.shell.widgets('main'))
        .find((w: any) => w.content?.session?.name === name)
        .content.setOption('closeOnExit', false);
    }, names[0]);
    await page.request.delete(`/api/terminals/${names[0]}`);
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(names[0]);
    await expect.poll(shown, UNDER_LOAD).toBe(base + 2);
  } finally {
    await Promise.all(
      names.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('kernels and sessions of the server', () => {
  // Galata lists only the kernels and sessions its page started; this test starts them by REST
  test.use({ kernels: null, sessions: null });

  test('ACC-ACCORD-276-NAME-COUNT, ACC-ACCORD-70-COUNT-TABS: a card header counts its tabs and terminals right after the name, folded or open, and counts no kernels', async ({
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
        card(page, id).locator('.jp-WorkspaceManager-count').textContent();
      // the count stands right after the name, folded or open
      expect(await counts(held)).toBe('(3)');
      expect(await counts(docs)).toBe('(2)');
      await openCard(page, held);
      // the notebook tab and the two terminal tabs; the kernel takes no row
      expect(await counts(held)).toBe('(3)');
      await openCard(page, docs);
      await triangle(page, held).click();
      expect(await counts(held)).toBe('(3)');
      expect(await counts(docs)).toBe('(2)');
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
    test.setTimeout(120000);
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

      // a terminal row: its name, the process, its path and when it was last active
      await sleepInTerminal(page, terminal);
      await openSection(page, 'terminals');
      const terminalRow = rowOf(
        sectionBody(page, 'terminals'),
        rowLabel(terminal)
      );
      await expect
        .poll(async () => {
          await refresh(page);
          return (await terminalRow.getAttribute('title'))!.split('\n')[1];
        }, UNDER_LOAD)
        .toBe('Process: sleep');
      const age = await terminalRow
        .locator('.jp-WorkspaceManager-age')
        .textContent();
      const lines = (await terminalRow.getAttribute('title'))!.split('\n');
      expect(lines.slice(0, 4)).toEqual([
        `terminal ${terminal}`,
        'Process: sleep',
        'Command: sleep 600',
        `Path: ${await cwdOf(page, terminal)}`
      ]);
      // the Memory line follows Path (ACC-TERM-279-TOOLTIP-MEMORY)
      expect(lines[4]).toMatch(/^Memory: /);
      expect(lines[5]).toContain(`Last activity: ${age} (`);
      expect(lines).toHaveLength(6);

      // a kernel row: its kernelspec display name, the session path, its state
      // and the memory (ACC-KERNEL-282-TOOLTIP-MEMORY)
      // a REST-created session has no client, so the server keeps 'starting' until one connects
      await openDocument(page, notebook);
      const state = () =>
        serverList(page, '/api/kernels').then(
          list => list.find(k => k.id === session.kernel.id)?.execution_state
        );
      await expect.poll(state, KERNEL_START).toBe('idle');
      await openSection(page, 'kernels');
      await refresh(page);
      const kernelLines = (await rowOf(
        sectionBody(page, 'kernels'),
        'tips.ipynb'
      ).getAttribute('title'))!.split('\n');
      expect(kernelLines.slice(0, 3)).toEqual([
        await displayName(page, session.kernel.name),
        notebook,
        'idle'
      ]);
      // the Memory line is last (ACC-KERNEL-282-TOOLTIP-MEMORY)
      expect(kernelLines[3]).toMatch(/^Memory: /);
      expect(kernelLines).toHaveLength(4);

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
    await fromMenu(page, target, 'Open workspace');
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

test('ACC-ACCORD-25-CLOSE-CURRENT, ACC-ACCORD-284-CLEAR-WORKSPACE: Clear workspace of this window closes every main-area tab and stops its terminal; an unsaved document asks', async ({
  page,
  tmpPath
}) => {
  const current = fresh('closecur');
  let terminal = '';
  const open = (path: string) =>
    page.evaluate(async path => {
      // the widget the command returns is not sent back: Playwright cannot serialize it
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path
      });
    }, path);
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

    await fromMenu(page, current, 'Clear workspace');
    // the terminal tab: Close all asks once (ACC-ACCORD-27)
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Clear workspace ${current}?`
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

  test('ACC-ACCORD-26-CLOSE-OTHER, ACC-ACCORD-284-CLEAR-WORKSPACE: Clear workspace of another workspace empties its layout and stops its terminal and its kernel', async ({
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
      const count = card(page, other).locator('.jp-WorkspaceManager-count');
      // the kernel belongs to the workspace through its notebook tab
      await openCard(page, other);
      await expect(count).toHaveText('(2)');
      await fromMenu(page, other, 'Clear workspace');
      // the one confirmation names the terminal it stops
      await expect(dialog(page).locator('.jp-Dialog-body')).toContainText(
        `terminal ${terminal}`
      );
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
      await expect(count).toHaveText('(0)');
      // the terminal and the kernel stop
      await expect
        .poll(() => terminalNames(page), UNDER_LOAD)
        .not.toContain(terminal);
      await expect
        .poll(() => kernelIds(page), UNDER_LOAD)
        .not.toContain(session.kernel.id);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, other]);
    }
  });
});

test('ACC-ACCORD-27-CLOSE-WARN, ACC-ACCORD-284-CLEAR-WORKSPACE: Clear workspace asks when the workspace holds a terminal and names it; Cancel changes nothing', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('warn');
  const other = `${current}-other`;
  await putWorkspace(page, other, layout([`terminal:${terminal}`]));
  try {
    await setUpExisting(page, current);
    const before = await saved(page, other);
    await fromMenu(page, other, 'Clear workspace');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Clear workspace ${other}?`
    );
    await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
      `The workspace holds terminal ${terminal}. Clearing it stops it and closes every tab.`
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
  // three windows load and eight actions are refused
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

    await fromMenu(page, x, 'Open workspace');
    await expectRefused(page, 'Open workspace');

    await fromMenu(page, x, 'Open in new browser tab');
    await expectRefused(page, 'Open in new browser tab');

    await fromMenu(page, x, 'Clear workspace');
    await expectRefused(page, 'Clear workspace');

    // Delete workspace: the first click arms, the second deletes
    await openCardMenu(page, x);
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
    await fromMenu(third, current, 'Clear workspace');
    await expectRefused(third, 'Clear workspace');
    await openCardMenu(third, current);
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

test("ACC-ACCORD-69-CARD, ACC-PANEL-242-EDGE-TAB: in Light and Dark every card, this window's included, open or closed, is an edge tab 2 px from the panel edge, square at the left with a 2 px right radius, its 4 px hue strip the left border, the header on the hue's 24% tint and the body on its 9.6% tint with no rule between them", async ({
  page
}) => {
  const current = fresh('card');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, current);
  await putWorkspace(page, a);
  await putWorkspace(page, b);
  await patchMeta(page, current, { colour: 'sky' });
  await patchMeta(page, a, { colour: 'mint' });
  await patchMeta(page, b, { colour: 'lavender' });
  const hues: Record<string, string> = {
    [current]: 'sky',
    [a]: 'mint',
    [b]: 'lavender'
  };
  const tint = (colour: string, percent: number) =>
    `color-mix(in srgb, var(--wm-${colour}) ${percent}%, var(--jp-layout-color1))`;
  try {
    await setUpExisting(page, current);
    for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
      await page.theme.setTheme(theme);
      // two cards open at once: this window's card from its header, another from its triangle
      await cardHeader(page, current).click();
      await expect(card(page, current)).toHaveClass(/jp-mod-open/);
      await triangle(page, a).click();
      await expect(card(page, a)).toHaveClass(/jp-mod-open/);
      await page.mouse.move(0, 0);
      for (const id of [current, a, b]) {
        const s = await card(page, id).evaluate(n => {
          const c = getComputedStyle(n);
          const header = getComputedStyle(
            n.querySelector('.jp-WorkspaceManager-cardHeader')!
          );
          const body = n.querySelector('.jp-WorkspaceManager-cardBody');
          return {
            radius: c.borderRadius,
            margins: [c.marginLeft, c.marginRight],
            widths: [
              c.borderLeftWidth,
              c.borderTopWidth,
              c.borderRightWidth,
              c.borderBottomWidth
            ],
            strip: c.borderLeftColor,
            card: c.backgroundColor,
            header: header.backgroundColor,
            rule: [
              header.borderBottomWidth,
              header.borderBottomStyle,
              header.borderBottomColor
            ],
            body: body && getComputedStyle(body).backgroundColor
          };
        });
        const what = `${theme} ${id}${id === b ? ' closed' : ' open'}`;
        // an edge tab 2 px from the panel edge: square at the left, a 2 px radius at the right
        expect(s.margins, what).toEqual(['2px', '2px']);
        expect(s.radius, what).toBe('0px 2px 2px 0px');
        // the one border is the 4 px full-strength hue strip on the left
        expect(s.widths, what).toEqual(['4px', '0px', '0px', '0px']);
        expect(await rgb(page, s.strip), what).toEqual(
          await rgb(page, `var(--wm-${hues[id]})`)
        );
        // the header takes the hue at 24 %, the body's surface at 9.6 %
        expect(await rgb(page, s.header), what).toEqual(
          await rgb(page, tint(hues[id], 24))
        );
        expect(await rgb(page, s.card), what).toEqual(
          await rgb(page, tint(hues[id], 9.6))
        );
        // ACC-PANEL-270-NO-DIVIDER: no rule joins the header to the body
        expect([s.rule[1], s.rule[0]], what).toEqual(['none', '0px']);
        // an open card's body paints nothing over the 9.6 % surface; a closed card has no body
        expect(s.body, what).toBe(id === b ? null : 'rgba(0, 0, 0, 0)');
      }
      // close both again: every theme starts from no open card
      await cardHeader(page, current).click();
      await triangle(page, a).click();
      await expect(openCards(page)).toHaveCount(0);
    }
  } finally {
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test("ACC-PANEL-239-HEADER-SHADE: in JupyterLab Light and JupyterLab Dark a coloured card takes the hue on its 4 px strip, the hue's 24% tint on its header and 9.6% tint on its body, the same for this window's card and the others, and a card with no colour keeps the plain header and a transparent strip", async ({
  page
}) => {
  const current = fresh('shade');
  const other = `${current}-a`;
  await putWorkspace(page, current);
  await putWorkspace(page, other);
  await patchMeta(page, current, { colour: 'sky' });
  const surfaces = (id: string) =>
    card(page, id).evaluate(n => {
      const header = n.querySelector('.jp-WorkspaceManager-cardHeader')!;
      return {
        card: getComputedStyle(n).backgroundColor,
        strip: getComputedStyle(n).borderLeftColor,
        header: getComputedStyle(header).backgroundColor,
        image: getComputedStyle(header).backgroundImage
      };
    });
  try {
    await setUpExisting(page, current);
    // the colour from the card's own menu, as a workspace gets it
    await fromMenu(page, other, 'Colour');
    await menuItem(page, 'Green').click();
    await expect(card(page, other)).toHaveClass(/jp-mod-mint/);

    // the hue lands on the card: a stylesheet that arrives after the card renders must not read as plain
    const mint = await rgb(page, await shade(page, 'mint'));
    await expect
      .poll(async () => rgb(page, (await surfaces(other)).strip), UNDER_LOAD)
      .toEqual(mint);

    const tint = (colour: string, percent: number) =>
      `color-mix(in srgb, var(--wm-${colour}) ${percent}%, var(--jp-layout-color1))`;
    for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
      await page.theme.setTheme(theme);
      const layout2 = 'var(--jp-layout-color2)';
      // a card with no colour: the class alone, no colour class (a reload gives every listed workspace a colour)
      const plain = await page.locator(PANEL).evaluate(panel => {
        const probe = document.createElement('div');
        probe.className = 'jp-WorkspaceManager-card';
        const header = document.createElement('div');
        header.className = 'jp-WorkspaceManager-cardHeader';
        probe.appendChild(header);
        panel.appendChild(probe);
        const drawn = {
          strip: getComputedStyle(probe).borderLeftColor,
          header: getComputedStyle(header).backgroundColor,
          image: getComputedStyle(header).backgroundImage
        };
        probe.remove();
        return drawn;
      });

      const drawn = {
        other: await surfaces(other),
        current: await surfaces(current)
      };
      for (const [id, s, colour] of [
        [other, drawn.other, 'mint'],
        [current, drawn.current, 'sky']
      ] as const) {
        const what = `${theme} ${id}`;
        expect(await rgb(page, s.header), what).toEqual(
          await rgb(page, tint(colour, 24))
        );
        expect(await rgb(page, s.strip), what).toEqual(
          await rgb(page, `var(--wm-${colour})`)
        );
        expect(await rgb(page, s.card), what).toEqual(
          await rgb(page, tint(colour, 9.6))
        );
        // no wash: the header carries the tint as its flat colour
        expect(s.image, what).toBe('none');
      }
      // the plain card: layout colour 2 and a transparent strip
      expect(await rgb(page, plain.header)).toEqual(await rgb(page, layout2));
      expect(await rgba(page, plain.strip)).toEqual([0, 0, 0, 0]);
      expect(plain.image).toBe('none');
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test("TINTS-CONTRAST: the inverse layout colours on every hue's 24% header tint, 9.6% body tint and 9.6% over layout colour 2 surface of a hovered or selected row keep at least 4.5:1 in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel", async ({
  page
}) => {
  const current = await setUp(page, 'contrast');
  // WCAG relative luminance of a colour as the page draws it
  const luminance = (colour: number[]) => {
    const [r, g, b] = colour.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  try {
    for (const theme of [
      'JupyterLab Light',
      'JupyterLab Dark',
      'Galaxa Dark Theme - Steel'
    ]) {
      await page.theme.setTheme(theme);
      // In JupyterLab Light the meta ink is --jp-inverse-layout-color1, #212121 (it was rgba(0, 0, 0, .54)); the name and row label take --jp-inverse-layout-color0, #111
      const inks = [
        await rgb(page, 'var(--jp-inverse-layout-color0)'),
        await rgb(page, 'var(--jp-inverse-layout-color1)')
      ];
      for (const colour of COLOURS) {
        for (const [percent, base] of [
          [24, 1],
          [9.6, 1],
          [9.6, 2]
        ]) {
          const tint = await rgb(
            page,
            `color-mix(in srgb, var(--wm-${colour}) ${percent}%, var(--jp-layout-color${base}))`
          );
          for (const ink of inks) {
            expect(
              contrast(ink, tint),
              `${theme} ${colour} at ${percent}% over layout colour ${base}: ${ink} on ${tint}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  } finally {
    await deleteWorkspaces(page, [current]);
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
    // the purpose, shown on the open card, is never shortened with an ellipsis
    await openCard(page, long);
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

test("ACC-ACCORD-98-HOVER-ACTIONS, ACC-ACCORD-283-NO-DOTS: the eye keeps its place on a closed, a hovered, a focused, an open, a hidden and this window's card, and no card carries a ... button; one that does not apply is disabled", async ({
  page
}) => {
  const suffix = 'a-name-too-long-for-the-card';
  const current = await setUp(page, 'hover', { [suffix]: {}, h: {} });
  const [other, hidden] = [`${current}-${suffix}`, `${current}-h`];
  const header = cardHeader(page, other);
  const name = header.locator('.jp-WorkspaceManager-name');
  /** The eye after the age: label, x, shown, disabled, pressed. */
  const buttons = (id: string) =>
    card(page, id)
      .locator('.jp-WorkspaceManager-cardActions button')
      .evaluateAll(nodes =>
        nodes.map(n => {
          const s = getComputedStyle(n);
          const r = n.getBoundingClientRect();
          return {
            label: n.getAttribute('aria-label'),
            x: Math.round(r.left),
            shown:
              s.display !== 'none' && s.visibility === 'visible' && r.width > 0,
            disabled: (n as HTMLButtonElement).disabled,
            pressed: n.getAttribute('aria-pressed')
          };
        })
      );
  const width = () => name.evaluate(n => n.getBoundingClientRect().width);
  try {
    await patchMeta(page, hidden, { hidden: true });
    await headerButton(page, 'Show hidden workspaces').click();
    await refresh(page);
    await expect(card(page, hidden)).toHaveClass(/jp-mod-hiddenWorkspace/);
    await expect(header).toHaveAccessibleName(other);
    await expect(cardHeader(page, hidden)).toHaveAccessibleName(
      `${hidden} hidden`
    );
    await page.mouse.move(0, 0);
    // the name is cut, so any width the buttons took would show less of it
    expect(await name.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
    const rest = await buttons(other);
    const xs = rest.map(b => b.x);
    const nameWidth = await width();
    expect(rest).toEqual([
      {
        label: 'Hide workspace',
        x: xs[0],
        shown: true,
        disabled: false,
        pressed: 'false'
      }
    ]);
    await expect(header.locator('.jp-WorkspaceManager-age')).toBeVisible();

    const same = async (id: string, what: string) => {
      const now = await buttons(id);
      expect(
        now.map(b => [b.x, b.shown]),
        what
      ).toEqual(xs.map(x => [x, true]));
      return now;
    };
    await header.hover();
    await same(other, 'hovered');
    expect(await width()).toBe(nameWidth);
    // Tab from the WORKSPACES header, above every card, until this one has the focus
    await sectionHeader(page, 'workspaces').focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await header.evaluate(n => n === document.activeElement)) {
        break;
      }
    }
    await expect(header).toBeFocused();
    await same(other, 'focused');
    expect(await width()).toBe(nameWidth);
    await triangle(page, other).click();
    await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    await page.mouse.move(0, 0);
    await same(other, 'open');
    expect(await width()).toBe(nameWidth);

    const mine = await same(current, "this window's card");
    expect(mine.map(b => b.disabled)).toEqual([true]);
    const shown = await same(hidden, 'hidden card');
    expect(shown.map(b => [b.label, b.disabled, b.pressed])).toEqual([
      ['Show workspace again', false, 'true']
    ]);
  } finally {
    await deleteWorkspaces(page, ids(current, suffix, 'h'));
  }
});

test('DEF-PANEL-12-HOVER-CLICK: after a click in a card header and on its buttons the buttons stay in their place when the pointer leaves; Tab reaches each enabled one', async ({
  page
}) => {
  const current = await setUp(page, 'hoverclick', { a: {} });
  const other = `${current}-a`;
  const header = cardHeader(page, other);
  const icons = header.locator('.jp-WorkspaceManager-cardActions button');
  const focused = (label: string) =>
    expect(header.locator(`button[aria-label="${label}"]`)).toBeFocused();
  try {
    // click an open card's header to close it, move the pointer off the card:
    // this window's card, as a header click on another workspace's card switches
    const mine = cardHeader(page, current);
    const myIcons = mine.locator('.jp-WorkspaceManager-cardActions button');
    await mine.click();
    await expect(mine).toHaveAttribute('aria-expanded', 'true');
    await mine.click();
    await expect(mine).toHaveAttribute('aria-expanded', 'false');
    await expect(mine).toBeFocused();
    await page.mouse.move(0, 0);
    await expect(myIcons).toHaveCount(1);
    await expect(myIcons.first()).toBeVisible();

    // a click on a button keeps the focus where it was: the triangle opens
    // the other card, and a second click closes it
    await triangle(page, other).click();
    await triangle(page, other).click();
    await page.mouse.move(0, 0);
    await expect(mine).toBeFocused();
    await expect(icons.first()).toBeVisible();

    // Tab moves from the header through the triangle and the eye;
    // Tab from the WORKSPACES header, above every card
    await sectionHeader(page, 'workspaces').focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await header.evaluate(n => n === document.activeElement)) {
        break;
      }
    }
    await expect(header).toBeFocused();
    await page.keyboard.press('Tab');
    await focused('Expand');
    await page.keyboard.press('Tab');
    await focused('Hide workspace');
    // the next Tab leaves the card: it holds no third button
    await page.keyboard.press('Tab');
    await expect(
      header.locator('button[aria-label="Workspace menu"]')
    ).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test("ACC-ACCORD-167-NO-BUTTONS: an open card's body ends with its last row, without Open or Clear workspace; both stay in its header menu and neither is in the card header", async ({
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
    for (const name of ['Open', 'Clear workspace']) {
      await expect(body.getByRole('button', { name, exact: true })).toHaveCount(
        0
      );
    }
    // the last row ends the card: the flat list puts the rows in the body itself, with no
    // group container or button after them
    expect(
      await body.evaluate(n =>
        n.lastElementChild?.classList.contains('jp-WorkspaceManager-row')
      )
    ).toBe(true);
    for (const name of ['Open workspace', 'Clear workspace']) {
      await expect(
        cardHeader(page, other).getByRole('button', { name, exact: true })
      ).toHaveCount(0);
    }

    await openCardMenu(page, other);
    await expect(menuItem(page, 'Open workspace')).toBeVisible();
    await expect(menuItem(page, 'Clear workspace')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await deleteWorkspaces(page, ids(current, 'a'));
  }
});

test('ACC-ACCORD-283-NO-DOTS: no card header has a ... button, the eye stays, the header right-click opens the workspace menu, and its actions work; the name keeps its text width and the count follows it', async ({
  page,
  tmpPath
}) => {
  const current = await setUp(page, 'twoicons', {
    target: {},
    held: layout([`editor:${tmpPath}/held.txt`]),
    h: {}
  });
  const [target, held, hidden] = ['target', 'held', 'h'].map(
    s => `${current}-${s}`
  );
  try {
    await patchMeta(page, hidden, { hidden: true });
    await headerButton(page, 'Show hidden workspaces').click();
    await refresh(page);
    await expect(card(page, hidden)).toHaveClass(/jp-mod-hiddenWorkspace/);
    await triangle(page, held).click();
    await expect(card(page, held)).toHaveClass(/jp-mod-open/);

    // a closed card, an open card, this window's card and a hidden card
    for (const [id, eye] of [
      [target, 'Hide workspace'],
      [held, 'Hide workspace'],
      [current, 'Hide workspace'],
      [hidden, 'Show workspace again']
    ]) {
      const buttons = card(page, id).locator(
        '.jp-WorkspaceManager-cardActions button'
      );
      expect(
        await buttons.evaluateAll(nodes =>
          nodes.map(n => n.getAttribute('aria-label'))
        ),
        id
      ).toEqual([eye]);
      for (const name of [
        'Open workspace',
        'Clear workspace',
        'Workspace menu'
      ]) {
        await expect(
          cardHeader(page, id).getByRole('button', { name, exact: true })
        ).toHaveCount(0);
      }
    }

    // the count follows the name by the line's 6 px gap; the age stays to its right
    const header = cardHeader(page, target);
    const name = (await header
      .locator('.jp-WorkspaceManager-name')
      .boundingBox())!;
    const counter = (await header
      .locator('.jp-WorkspaceManager-count')
      .boundingBox())!;
    const age = (await header
      .locator('.jp-WorkspaceManager-age')
      .boundingBox())!;
    expect(Math.round(counter.x - (name.x + name.width))).toBe(6);
    expect(age.x).toBeGreaterThan(counter.x);

    // a name shorter than the line keeps its text width: its box is no wider than its text
    await sidebarTo(page, 500);
    const [box, text] = await header
      .locator('.jp-WorkspaceManager-name')
      .evaluate(n => {
        const range = document.createRange();
        range.selectNodeContents(n);
        return [
          n.getBoundingClientRect().width,
          range.getBoundingClientRect().width
        ];
      });
    expect(box - text).toBeLessThan(1);

    await fromMenu(page, held, 'Clear workspace');
    await expect.poll(() => savedTabs(page, held), UNDER_LOAD).toEqual([]);

    await fromMenu(page, target, 'Open workspace');
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${target}(\\?.*)?$`)
    );
  } finally {
    await deleteWorkspaces(page, ids(current, 'target', 'held', 'h'));
  }
});

test('ACC-PANEL-243-HEADER, ACC-ACCORD-276-NAME-COUNT: the first line of a card header holds the caret, the name, the row count, the age and the eye; the second line of an open card holds the purpose only, with no count glyphs', async ({
  page
}) => {
  const current = await setUp(page, 'hdrline', { a: {} });
  const other = `${current}-a`;
  try {
    await triangle(page, other).click();
    await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    const lines = cardHeader(page, other).locator(
      '.jp-WorkspaceManager-headerLine'
    );
    await expect(lines).toHaveCount(1);
    const first = lines.first();
    await expect(
      first.locator('button.jp-WorkspaceManager-caret')
    ).toBeVisible();
    await expect(first.locator('.jp-WorkspaceManager-name')).toHaveText(other);
    await expect(first.locator('.jp-WorkspaceManager-count')).toHaveText('(0)');
    await expect(first.locator('.jp-WorkspaceManager-age')).toBeVisible();
    await expect(
      first.getByRole('button', { name: 'Hide workspace' })
    ).toBeVisible();
    await expect(
      first.getByRole('button', { name: 'Workspace menu' })
    ).toHaveCount(0);
    expect(await first.locator('.jp-WorkspaceManager-count svg').count()).toBe(
      0
    );
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

test('ACC-LISTS-273-CURRENT-ROW: in JupyterLab Light and Galaxa Dark Theme - Steel the current row takes brand colour 1 at 14 % over layout colour 1 on a plain card and the workspace hue at 24 % over layout colour 1 on a coloured card', async ({
  page
}) => {
  const current = fresh('rowtint');
  const names: string[] = [];
  try {
    await setUpExisting(page, current);
    names.push(await newTerminalTab(page), await newTerminalTab(page));
    await refresh(page);
    await openCard(page, current);
    const rows = names.map(n => rowOf(card(page, current), rowLabel(n)));
    await expect(rows[1]).toBeVisible();
    await expect(rows[1]).toHaveClass(/jp-mod-current/);
    // every listed card takes a rotation colour, so the live current row carries the coloured recipe
    const colour = await card(page, current).evaluate(
      (n, colours) => colours.find(c => n.classList.contains(`jp-mod-${c}`))!,
      COLOURS
    );
    const background = async (l: Locator) =>
      rgb(page, await l.evaluate(n => getComputedStyle(n).backgroundColor));
    for (const theme of ['JupyterLab Light', 'Galaxa Dark Theme - Steel']) {
      await page.theme.setTheme(theme);
      expect(await background(rows[1]), `${theme} coloured`).toEqual(
        await rgb(
          page,
          `color-mix(in srgb, var(--wm-${colour}) 24%, var(--jp-layout-color1))`
        )
      );
    }
    // a card with no colour, as the class alone paints it: the plain recipe (DQ-36)
    for (const theme of ['JupyterLab Light', 'Galaxa Dark Theme - Steel']) {
      await page.theme.setTheme(theme);
      const plain = await page.locator(PANEL).evaluate(panel => {
        const probe = document.createElement('div');
        probe.className = 'jp-WorkspaceManager-card';
        const row = document.createElement('div');
        row.className = 'jp-WorkspaceManager-row jp-mod-current';
        probe.appendChild(row);
        panel.appendChild(probe);
        const drawn = getComputedStyle(row).backgroundColor;
        probe.remove();
        return drawn;
      });
      expect(await rgb(page, plain), `${theme} plain`).toEqual(
        await rgb(
          page,
          'color-mix(in srgb, var(--jp-brand-color1) 14%, var(--jp-layout-color1))'
        )
      );
    }
  } finally {
    await Promise.all(
      names.map(name => page.request.delete(`/api/terminals/${name}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('at 4x device scale', () => {
  test.use({ deviceScaleFactor: 4 });

  /**
   * The device pixels of a region around a card's top-left corner, with the
   * card's corner at (0, `margin`) CSS px of the region: the region starts at
   * the card's left edge, 2 CSS px from the panel edge.
   */
  async function cornerPixels(page: Page, id: string, margin: number) {
    const box = (await card(page, id).boundingBox())!;
    const size = margin + 12;
    const png = await page.screenshot({
      clip: { x: box.x, y: box.y - margin, width: size, height: size }
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

  test("ACC-ACCORD-128-STRIP-PLAIN, ACC-ACCORD-129-FLUSH: the strip and the header stay inside the card's square left corners, 2 px from the panel edge; the outline lies against it; this window's strip shows its inner 2 px under its own 2 px outline", async ({
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
      for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
        await page.theme.setTheme(theme);
        await page.mouse.move(0, 0);
        // both cards carry the same hue; the header its 24 % tint (ACC-PANEL-239-HEADER-SHADE)
        const strip = await rgb(page, await shade(page, 'mint'));
        const header = await rgb(
          page,
          'color-mix(in srgb, var(--wm-mint) 24%, var(--jp-layout-color1))'
        );
        const panel = await rgb(page, 'var(--jp-layout-color1)');
        const outline = await rgb(page, 'var(--jp-brand-color2)');

        // ACC-ACCORD-128: the same strip on both cards; ACC-ACCORD-129: one clipped shape
        const shape = (id: string) =>
          card(page, id).evaluate(n => {
            const s = getComputedStyle(n);
            return [
              s.borderLeftWidth,
              s.borderLeftColor,
              s.borderRadius,
              s.overflow
            ];
          });
        const mine = await shape(current);
        const theirs = await shape(other);
        // square at the left, a 2 px radius at the right; both cards carry the same hue
        expect(mine.slice(2)).toEqual(['0px 2px 2px 0px', 'hidden']);
        expect(mine[0]).toBe('4px');
        expect([theirs[0], ...theirs.slice(2)]).toEqual([
          mine[0],
          ...mine.slice(2)
        ]);
        expect([await rgb(page, mine[1]), await rgb(page, theirs[1])]).toEqual([
          strip,
          strip
        ]);

        const S = 4; // device pixels per CSS pixel
        const W = 2 * S; // the outline width
        const R = 0; // the card's corner radius on the left, where the region is captured
        const at = (
          px: { width: number; data: number[] },
          x: number,
          y: number
        ) => px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3);
        const is = (c: number[], expected: number[]) => near(c, expected, 8);

        // the outline lies inside the card's own box, over the strip's outer 2 px
        const M = 3;
        for (const [id, outlined] of [
          [current, true],
          [other, false]
        ] as const) {
          const px = await cornerPixels(page, id, M);
          const wrong: string[] = [];
          for (let y = 0; y < px.width; y++) {
            for (let x = 0; x < px.width; x++) {
              const c = at(px, x, y);
              if (y + 0.5 < M * S) {
                // above the card's top edge: neither the card nor its outline stands there
                if (Math.abs(y + 0.5 - M * S) < 1.5) {
                  continue;
                }
                if (!is(c, panel)) {
                  wrong.push(`(${x},${y}) ${c} above, where ${panel}`);
                }
                continue;
              }
              if (!outlined) {
                continue;
              }
              // the left corner is square: skip only the 1 px seam where the screenshot anti-aliases against the panel
              if (x + 0.5 < R * S + 1 && y + 0.5 - M * S < R * S + 1) {
                continue;
              }
              // inside the box: the outline band runs along the left and top edges
              const inside = Math.min(x + 0.5, y + 0.5 - M * S);
              if (Math.abs(inside - W) < 1.5) {
                continue;
              }
              if (inside < W && !is(c, outline)) {
                wrong.push(`(${x},${y}) ${c} inside, where ${outline}`);
              }
            }
          }
          expect(
            wrong.slice(0, 5),
            `${theme} ${id}: ${wrong.length} pixels`
          ).toEqual([]);

          // ACC-ACCORD-128: the outline covers the strip's first 2 px; the strip shows from 2 to 4 px, then the header
          const row = M * S + 6 * S;
          const x0 = 0;
          expect(
            is(at(px, x0 + 1, row), outlined ? outline : strip),
            `${id} left edge`
          ).toBe(true);
          expect(
            is(at(px, x0 + 4 * S - 1, row), strip),
            `${id} strip end`
          ).toBe(true);
          expect(
            is(at(px, x0 + 4 * S, row), header),
            `${id} header start`
          ).toBe(true);
          if (outlined) {
            // the top band, away from the corner
            expect(
              is(at(px, x0 + 6 * S, M * S + 1), outline),
              `${id} top band`
            ).toBe(true);
          }
        }
      }
    } finally {
      await deleteWorkspaces(page, [current, other]);
    }
  });

  test("ACC-PANEL-231-OUTLINE-INSIDE: this window's card paints its 2 px brand colour 2 outline inside its own box on all four sides, and its left edge sits 2 px from the panel edge", async ({
    page
  }) => {
    test.setTimeout(120000);
    const current = fresh('inside');
    await putWorkspace(page, current);
    await patchMeta(page, current, { colour: 'mint' });
    try {
      await setUpExisting(page, current);
      await page.mouse.move(0, 0);
      const outline = await rgb(page, 'var(--jp-brand-color2)');
      const panel = await rgb(page, 'var(--jp-layout-color1)');
      const S = 4; // device pixels per CSS pixel
      const M = 3; // CSS px of panel captured around the card
      const box = (await card(page, current).boundingBox())!;
      // the edge tab sits 2 px from the panel edge, off the section bands' full width (DQ-28)
      const gap = await card(page, current).evaluate(
        (n, selector) =>
          n.getBoundingClientRect().left -
          document.querySelector(selector)!.getBoundingClientRect().left,
        PANEL
      );
      expect(Math.round(gap)).toBe(2);

      const [w, h] = [Math.round(box.width * S), Math.round(box.height * S)];
      const [x0, y0] = [M * S, M * S];
      const points: [string, number, number][] = [
        ['left band', x0 + 2, y0 + Math.round(h / 2)],
        ['right band', x0 + w - 4, y0 + Math.round(h / 2)],
        ['top band', x0 + Math.round(w / 2), y0 + 2],
        ['bottom band', x0 + Math.round(w / 2), y0 + h - 4],
        ['right outside', x0 + w + 2, y0 + Math.round(h / 2)],
        ['top outside', x0 + Math.round(w / 2), y0 - 2],
        ['bottom outside', x0 + Math.round(w / 2), y0 + h + 2]
      ];
      const png = await page.screenshot({
        clip: {
          x: box.x - M,
          y: box.y - M,
          width: box.width + 2 * M,
          height: box.height + 2 * M
        }
      });
      const samples = await page.evaluate(
        async ({ b64, points }: { b64: string; points: number[][] }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${b64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          return points.map(([x, y]) =>
            Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
          );
        },
        {
          b64: png.toString('base64'),
          points: points.map(([, x, y]) => [x, y])
        }
      );
      const is = (c: number[], expected: number[]) =>
        c.every((v, i) => Math.abs(v - expected[i]) <= 8);
      points.forEach(([what], i) => {
        const expected = what.includes('outside') ? panel : outline;
        expect(is(samples[i], expected), `${what}: ${samples[i]}`).toBe(true);
      });
    } finally {
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-PANEL-270-NO-DIVIDER: in JupyterLab Light and Galaxa Dark Theme - Steel an open card header has no border-bottom and no line pixel between it and its first row, in a coloured card and a plain one', async ({
    page
  }) => {
    const current = fresh('norule');
    const coloured = `${current}-c`;
    await putWorkspace(page, current);
    await putWorkspace(page, coloured, layout(['editor:docs/notes.md']));
    await patchMeta(page, coloured, { colour: 'sky' });
    try {
      await setUpExisting(page, current);
      // every listed card takes a rotation colour; this window's card is not a chosen one
      const hue = (id: string) =>
        card(page, id).evaluate(
          (n, colours) =>
            colours.find(c => n.classList.contains(`jp-mod-${c}`))!,
          COLOURS
        );
      // this window's coloured card and the sky one, both open
      await cardHeader(page, current).click();
      await triangle(page, coloured).click();
      await expect(openCards(page)).toHaveCount(2);
      // a card with no colour, as the class alone paints it, has no rule either
      const plain = await page.locator(PANEL).evaluate(panel => {
        const probe = document.createElement('div');
        probe.className = 'jp-WorkspaceManager-card';
        const header = document.createElement('div');
        header.className = 'jp-WorkspaceManager-cardHeader';
        probe.appendChild(header);
        panel.appendChild(probe);
        const s = getComputedStyle(header);
        const drawn = [s.borderBottomWidth, s.borderBottomStyle];
        probe.remove();
        return drawn;
      });
      expect(plain).toEqual(['0px', 'none']);
      for (const theme of ['JupyterLab Light', 'Galaxa Dark Theme - Steel']) {
        await page.theme.setTheme(theme);
        await page.mouse.move(0, 0);
        for (const id of [current, coloured]) {
          const colour = await hue(id);
          const header = cardHeader(page, id);
          expect(
            await header.evaluate(n => {
              const s = getComputedStyle(n);
              return [s.borderBottomWidth, s.borderBottomStyle];
            }),
            `${theme} ${id}`
          ).toEqual(['0px', 'none']);
          // the device pixels from 2 CSS px above the header's bottom edge to 4 below it, in the left padding
          const box = (await header.boundingBox())!;
          const png = await page.screenshot({
            clip: {
              x: Math.round(box.x + 2),
              y: Math.round(box.y + box.height - 2),
              width: 1,
              height: 6
            }
          });
          const px = await page.evaluate(async b64 => {
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
              data: Array.from(
                ctx.getImageData(0, 0, image.width, image.height).data
              )
            };
          }, png.toString('base64'));
          const [above, below] = [
            await rgb(
              page,
              `color-mix(in srgb, var(--wm-${colour}) 24%, var(--jp-layout-color1))`
            ),
            await rgb(
              page,
              `color-mix(in srgb, var(--wm-${colour}) 9.6%, var(--jp-layout-color1))`
            )
          ];
          const near = (c: number[], tint: number[]) =>
            c.every((v, i) => Math.abs(v - tint[i]) <= 8);
          // every pixel lies between the header's tint and the body's: no line of another colour
          const outside: number[][] = [];
          let headerPixels = 0;
          let bodyPixels = 0;
          for (let i = 0; i < px.data.length; i += 4) {
            const c = px.data.slice(i, i + 3);
            if (
              !c.every(
                (v, n) =>
                  v >= Math.min(above[n], below[n]) - 8 &&
                  v <= Math.max(above[n], below[n]) + 8
              )
            ) {
              outside.push(c);
            }
            if (near(c, above)) {
              headerPixels++;
            }
            if (near(c, below)) {
              bodyPixels++;
            }
          }
          expect(outside.slice(0, 4), `${theme} ${id}`).toEqual([]);
          expect(headerPixels, `${theme} ${id} header pixels`).toBeGreaterThan(
            0
          );
          expect(bodyPixels, `${theme} ${id} body pixels`).toBeGreaterThan(0);
        }
      }
    } finally {
      await deleteWorkspaces(page, [current, coloured]);
    }
  });
});
