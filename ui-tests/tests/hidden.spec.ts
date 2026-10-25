import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  fresh,
  fromMenu,
  gotoWorkspace,
  headerButton,
  HEAVY_LOAD,
  menuButton,
  menuItem,
  onlyWorkspaces,
  openPanel,
  PANEL,
  putWorkspace,
  refresh,
  secondWindow
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

/** The line under the last card that counts the hidden workspaces. */
const countLine = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-note`, { hasText: 'hidden' });

const eye = (page: Page) => headerButton(page, 'Show hidden workspaces');

/** This window in a fresh workspace with `n` others beside it; the panel sees only these. */
async function setUp(
  page: IJupyterLabPageFixture,
  prefix: string,
  n: number
): Promise<string[]> {
  const current = fresh(prefix);
  const others = Array.from({ length: n }, (_, i) => `${current}-${i}`);
  await onlyWorkspaces(page, id => id.startsWith(current));
  for (const id of others) {
    await putWorkspace(page, id);
  }
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  return [current, ...others];
}

async function hide(page: Page, id: string): Promise<void> {
  await fromMenu(page, id, 'Hide workspace');
  await expect(card(page, id)).toHaveCount(0, HEAVY_LOAD);
}

/** The panel of `page` sees only the workspaces of `prefix`, reloaded. */
async function showOnly(page: Page, prefix: string): Promise<void> {
  await onlyWorkspaces(page, id => id.startsWith(prefix));
  await openPanel(page);
  await refresh(page);
}

test('ACC-HIDDEN-50-HIDE: Hide workspace removes its card', async ({
  page
}) => {
  const all = await setUp(page, 'hide', 2);
  try {
    await expect(card(page, all[1])).toBeVisible();
    await hide(page, all[1]);
    await expect(card(page, all[2])).toBeVisible();
    await refresh(page);
    await expect(card(page, all[1])).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, all);
  }
});

test("ACC-HIDDEN-52-SHOW-HIDDEN, ACC-HIDDEN-53-UNHIDE: the header eye shows hidden workspaces; a card's eye shows it again", async ({
  page
}) => {
  const all = await setUp(page, 'show', 1);
  const hidden = all[1];
  try {
    await hide(page, hidden);
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');

    // ACC-HIDDEN-52
    await eye(page).click();
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, hidden)).toBeVisible();
    await expect(card(page, hidden)).toHaveClass(/jp-mod-hiddenWorkspace/);
    await expect(
      card(page, hidden).locator('.jp-WorkspaceManager-hiddenWord')
    ).toHaveText('hidden');
    const again = card(page, hidden).locator(
      'button[aria-label="Show workspace again"]'
    );
    await expect(again).toBeVisible();
    await expect(again.locator('svg')).toHaveAttribute(
      'data-icon',
      /jupyterlab_workspace_manager_extension:eye/
    );

    // ACC-HIDDEN-53
    await again.click();
    await expect(card(page, hidden)).not.toHaveClass(/jp-mod-hiddenWorkspace/);
    await eye(page).click();
    await expect(eye(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page, hidden)).toBeVisible();
    await refresh(page);
    await expect(card(page, hidden)).toBeVisible();
    await expect(card(page, hidden)).not.toHaveClass(/jp-mod-hiddenWorkspace/);
  } finally {
    await deleteWorkspaces(page, all);
  }
});

test('ACC-HIDDEN-51-COUNT-LINE: the line under the last card counts the hidden workspaces, and is absent at 0', async ({
  page
}) => {
  const all = await setUp(page, 'count', 3);
  try {
    await expect(countLine(page)).toHaveCount(0, HEAVY_LOAD);
    await hide(page, all[1]);
    await expect(countLine(page)).toHaveText('1 hidden workspace', HEAVY_LOAD);
    await hide(page, all[2]);
    await expect(countLine(page)).toHaveText('2 hidden workspaces', HEAVY_LOAD);
    // under the last card
    const below = await page.locator(PANEL).evaluate(panel => {
      const cards = panel.querySelectorAll('.jp-WorkspaceManager-card');
      const line = Array.from(
        panel.querySelectorAll('.jp-WorkspaceManager-note')
      ).find(n => n.textContent?.includes('hidden'))!;
      return (
        line.getBoundingClientRect().top >=
        cards[cards.length - 1].getBoundingClientRect().bottom
      );
    });
    expect(below).toBe(true);

    await eye(page).click();
    for (const id of [all[1], all[2]]) {
      await card(page, id)
        .locator('button[aria-label="Show workspace again"]')
        .click();
      await expect(card(page, id)).not.toHaveClass(/jp-mod-hiddenWorkspace/);
    }
    await expect(countLine(page)).toHaveCount(0, HEAVY_LOAD);
    await eye(page).click();
    await refresh(page);
    await expect(countLine(page)).toHaveCount(0, HEAVY_LOAD);
  } finally {
    await deleteWorkspaces(page, all);
  }
});

test('ACC-HIDDEN-54-PERSIST: the hidden state is the same in another window and after a reload', async ({
  page
}) => {
  const all = await setUp(page, 'persist', 1);
  const [current, hidden] = all;
  await putWorkspace(page, `${current}-second`);
  const second = await secondWindow(page, `${current}-second`);
  try {
    await hide(page, hidden);

    await showOnly(second, current);
    await expect(card(second, `${current}-second`)).toBeVisible();
    await expect(card(second, hidden)).toHaveCount(0);
    await expect(countLine(second)).toHaveText('1 hidden workspace');
    // a lab window holds two of the browser's six connections with the
    // long-polling requests of this lab's extensions; the reload needs them
    await second.close();

    await page.reload();
    await openPanel(page);
    await refresh(page);
    await expect(card(page, current)).toBeVisible();
    await expect(card(page, hidden)).toHaveCount(0);
    await expect(countLine(page)).toHaveText('1 hidden workspace');
  } finally {
    await second.close();
    await deleteWorkspaces(page, [...all, `${current}-second`]);
  }
});

test("ACC-HIDDEN-87-NOT-CURRENT: this window's workspace keeps its card and cannot be hidden here", async ({
  page
}) => {
  const all = await setUp(page, 'notcur', 1);
  const [current] = all;
  await putWorkspace(page, `${current}-second`);
  const second = await secondWindow(page, `${current}-second`);
  try {
    await menuButton(page, current).click();
    await expect(menuItem(page, 'Hide workspace')).toHaveClass(
      /lm-mod-disabled/
    );
    await page.keyboard.press('Escape');

    // another window hides this window's workspace
    await showOnly(second, current);
    await fromMenu(second, current, 'Hide workspace');
    await expect(card(second, current)).toHaveCount(0);

    await refresh(page);
    const first = page.locator(`${PANEL} .jp-WorkspaceManager-card`).first();
    await expect(first).toHaveAttribute('data-workspace', current);
    await expect(first).toBeVisible();
    await expect(first).not.toHaveClass(/jp-mod-hiddenWorkspace/);
    await expect(countLine(page)).toHaveCount(0);
  } finally {
    await second.close();
    await deleteWorkspaces(page, [...all, `${current}-second`]);
  }
});
