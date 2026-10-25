import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  enterWorkspace,
  fresh,
  headerButton,
  layout,
  PANEL,
  patchMeta,
  putWorkspace,
  refresh,
  rowOf,
  sendToTerminal,
  startTerminal,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server. The test titles
// avoid the queries: a tab path holds the test's folder, named after its title
test.use({ autoGoto: false, mockState: false });

const ROW = '.jp-WorkspaceManager-row';

const field = (page: Page): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`);

/** Every card the panel shows, In no workspace and Other sessions included. */
const cards = (page: Page): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card`);

const workspaceCards = (page: Page): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`);

const openCards = (page: Page): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card.jp-mod-open`);

const notes = (page: Page): Locator =>
  page.locator(`${PANEL} .jp-WorkspaceManager-note`);

/** Show the filter field and type a query into it. */
async function filter(page: Page, query: string): Promise<void> {
  await headerButton(page, 'Filter').click();
  await expect(field(page)).toBeFocused();
  await page.keyboard.type(query);
}

test('ACC-FILTER-56-TOGGLE: the filter button shows the field; pressed again it hides the field and clears the filter', async ({
  page,
  tmpPath
}) => {
  const current = fresh('toggle');
  const w = `${current}-w`;
  await putWorkspace(
    page,
    w,
    layout([`editor:${tmpPath}/alpha.txt`, `editor:${tmpPath}/beta.txt`])
  );
  try {
    await enterWorkspace(page, current);
    await triangle(page, w).click();
    const rows = card(page, w).locator(ROW);
    await expect(rows).toHaveCount(2);
    await expect(field(page)).toHaveCount(0);

    await filter(page, 'alpha');
    await expect(rows).toHaveCount(1);
    await expect(workspaceCards(page)).toHaveCount(1);

    await headerButton(page, 'Filter').click();
    await expect(field(page)).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(workspaceCards(page)).toHaveCount(2);
    // shown again, the field is empty
    await headerButton(page, 'Filter').click();
    await expect(field(page)).toHaveValue('');
  } finally {
    await deleteWorkspaces(page, [current, w]);
  }
});

test("ACC-FILTER-59-ROWS, ACC-FILTER-60-MATCH-COUNT: only matching rows and cards show, the header reads (N of M); a workspace's name shows all its rows", async ({
  page,
  tmpPath
}) => {
  const [named, plain] = [await startTerminal(page), await startTerminal(page)];
  const current = fresh('rows');
  const held = `${current}-held`;
  await putWorkspace(
    page,
    held,
    layout([`terminal:${named}`, `terminal:${plain}`])
  );
  await putWorkspace(
    page,
    `${current}-other`,
    layout([`editor:${tmpPath}/notes.txt`])
  );
  try {
    await enterWorkspace(page, current);
    // a program named claude runs in one of the two terminals; a terminal
    // starts in the server's working directory, not in its root
    const program = `"$JUPYTER_SERVER_ROOT/${tmpPath}/claude"`;
    await sendToTerminal(
      page,
      named,
      `ln -s "$(command -v sleep)" ${program} && ${program} 300\r`
    );
    await expect
      .poll(async () => {
        const response = await page.request.get(
          '/jupyterlab-workspace-manager-extension/terminals'
        );
        return (await response.json()).find((t: any) => t.name === named)
          ?.process;
      }, UNDER_LOAD)
      .toBe('claude');
    await refresh(page);

    await filter(page, 'claude');
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, held)).toHaveClass(/jp-mod-open/);
    await expect(page.locator(`${PANEL} ${ROW}`)).toHaveCount(1);
    await expect(rowOf(card(page, held), `terminal ${named}`)).toBeVisible();
    await expect(
      card(page, held).locator('.jp-WorkspaceManager-counts')
    ).toHaveText('(1 of 2)');

    await field(page).fill(held);
    await expect(cards(page)).toHaveCount(1);
    await expect(card(page, held)).toHaveClass(/jp-mod-open/);
    await expect(card(page, held).locator(ROW)).toHaveCount(2);
    await expect(
      card(page, held).locator('.jp-WorkspaceManager-counts')
    ).toHaveText('(2 of 2)');
  } finally {
    await Promise.all(
      [named, plain].map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current, held, `${current}-other`]);
  }
});

test('ACC-FILTER-61-CLEAR, ACC-FILTER-83-RESTORE: the clear button empties the field, keeps the caret in it, shows every row and returns the open card', async ({
  page,
  tmpPath
}) => {
  const current = fresh('clear');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(
    page,
    a,
    layout([`editor:${tmpPath}/apple.txt`, `editor:${tmpPath}/kiwi-a.txt`])
  );
  await putWorkspace(page, b, layout([`editor:${tmpPath}/kiwi-b.txt`]));
  try {
    await enterWorkspace(page, current);
    await triangle(page, a).click();
    await expect(openCards(page)).toHaveCount(1);

    await filter(page, 'kiwi');
    await expect(workspaceCards(page)).toHaveCount(2);
    await expect(openCards(page)).toHaveCount(2);
    await expect(card(page, a).locator(ROW)).toHaveCount(1);

    await page.locator(`${PANEL} button[aria-label="Clear filter"]`).click();
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    await expect(workspaceCards(page)).toHaveCount(3);
    // only the card open before the filter
    await expect(openCards(page)).toHaveCount(1);
    await expect(card(page, a)).toHaveClass(/jp-mod-open/);
    await expect(card(page, a).locator(ROW)).toHaveCount(2);
  } finally {
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test("ACC-FILTER-82-OPEN-MATCHES: every card with a match is open; a click on a card's triangle then opens or closes that card only, and the query stays", async ({
  page,
  tmpPath
}) => {
  const current = fresh('opens');
  const [a, b, c] = [`${current}-a`, `${current}-b`, `${current}-c`];
  await putWorkspace(page, a, layout([`editor:${tmpPath}/kiwi-one.txt`]));
  await putWorkspace(page, b, layout([`editor:${tmpPath}/kiwi-two.txt`]));
  await putWorkspace(page, c, layout([`editor:${tmpPath}/plain.txt`]));
  const expanded = (id: string) =>
    triangle(page, id).getAttribute('aria-expanded');
  try {
    await enterWorkspace(page, current);
    const url = page.url();
    await filter(page, 'kiwi');
    await expect(workspaceCards(page)).toHaveCount(2);
    await expect(triangle(page, a)).toHaveAttribute('aria-expanded', 'true');
    await expect(triangle(page, b)).toHaveAttribute('aria-expanded', 'true');

    await triangle(page, a).click();
    await expect(triangle(page, a)).toHaveAttribute('aria-expanded', 'false');
    await expect(card(page, a)).not.toHaveClass(/jp-mod-open/);
    expect(await expanded(b)).toBe('true');
    await expect(field(page)).toHaveValue('kiwi');

    await triangle(page, a).click();
    await expect(triangle(page, a)).toHaveAttribute('aria-expanded', 'true');
    await expect(card(page, a)).toHaveClass(/jp-mod-open/);
    expect(await expanded(b)).toBe('true');
    await expect(field(page)).toHaveValue('kiwi');
    expect(page.url()).toBe(url);
  } finally {
    await deleteWorkspaces(page, [current, a, b, c]);
  }
});

test('ACC-FILTER-139-UNMATCHED, ACC-FILTER-115-NO-MATCH: a line counts the workspaces without a match; with no match at all one line says so', async ({
  page
}) => {
  const current = fresh('unmatched');
  const others = ['a', 'b', 'c', 'd', 'e'].map(x => `${current}-${x}`);
  for (const id of others) {
    await putWorkspace(page, id);
  }
  await patchMeta(page, others[0], { purpose: 'Apple orchard' });
  await patchMeta(page, others[1], { purpose: 'Pear orchard' });
  try {
    await enterWorkspace(page, current);
    await expect(workspaceCards(page)).toHaveCount(6);

    await filter(page, 'orchard');
    await expect(workspaceCards(page)).toHaveCount(2);
    await expect(notes(page)).toHaveText([
      '4 workspaces without a match are not shown'
    ]);

    await field(page).fill('zzzz');
    await expect(cards(page)).toHaveCount(0);
    await expect(notes(page)).toHaveText(['Nothing matches']);
  } finally {
    await deleteWorkspaces(page, [current, ...others]);
  }
});
