import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  menuItem,
  onlyWorkspaces,
  openPanel,
  PANEL,
  PANEL_TAB,
  patchMeta,
  putWorkspace,
  refresh,
  startTerminal,
  UNDER_LOAD
} from './helpers';

test.use({ autoGoto: false });

/** Press Tab from the refresh button until an element `selector` finds has the focus; that element. */
async function tabTo(page: Page, selector: string): Promise<Locator> {
  await headerButton(page, 'Refresh').focus();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const reached = await page.evaluate(
      s => !!document.activeElement?.matches(s),
      selector
    );
    if (reached) {
      return page.locator(`${selector}:focus`);
    }
  }
  throw new Error(`Tab never reached ${selector}`);
}

/** Press Tab from the refresh button until a card header has the focus. */
async function tabToCardHeader(page: Page): Promise<Locator> {
  // until the first load lands, the Other sessions card is the only card
  await expect(card(page, 'default')).toBeVisible();
  return tabTo(page, `${PANEL} .jp-WorkspaceManager-cardHeader`);
}

const openCards = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card.jp-mod-open`);

test('ACC-PANEL-165-TRIANGLE-KEYS: Tab reaches the triangle of a card, Enter opens the card, Space closes it', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  const triangle = await tabTo(
    page,
    `${PANEL} button.jp-WorkspaceManager-caret`
  );
  await expect(triangle).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(triangle).toHaveAttribute('aria-expanded', 'true');
  await expect(openCards(page)).toHaveCount(1);

  await page.keyboard.press(' ');
  await expect(triangle).toHaveAttribute('aria-expanded', 'false');
  await expect(openCards(page)).toHaveCount(0);
});

test('DEF-PANEL-7-MENU-FOCUS: closing a card or row menu, by Escape or by an action, returns the focus to what opened it', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await tabToCardHeader(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    if (
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') ===
          'Workspace menu'
      )
    ) {
      break;
    }
  }
  // mark the focused element: the locators below find that one element again
  const mark = (name: string) =>
    page.evaluate(
      n => document.activeElement!.setAttribute('data-test', n),
      name
    );
  await mark('menu-button');
  const button = page.locator('[data-test="menu-button"]');
  await expect(button).toHaveAttribute('aria-label', 'Workspace menu');
  const menu = page.locator('.jp-WorkspaceManager-menu');

  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  // an action: Set description... opens a dialog, Escape closes it
  await page.keyboard.press('Enter');
  await menuItem(page, 'Set description...').click();
  await expect(page.locator('.jp-Dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await expect(button).toBeFocused();

  // a row: the context-menu key opens its menu, Escape closes it
  await card(page, 'default')
    .locator('.jp-WorkspaceManager-cardHeader')
    .click();
  const row = card(page, 'default').locator('.jp-WorkspaceManager-row').first();
  await row.focus();
  await mark('row');
  await page.keyboard.press('ContextMenu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-test="row"]')).toBeFocused();
});

test('ACC-PANEL-92-ROW-KEYS: ArrowDown moves to the next row, Enter activates its tab', async ({
  page,
  tmpPath
}) => {
  await page.goto();
  for (const name of ['first.txt', 'second.txt']) {
    await page.contents.uploadContent(name, 'text', `${tmpPath}/${name}`);
    await page.evaluate(
      path =>
        (window as any).jupyterapp.commands.execute('docmanager:open', {
          path
        }),
      `${tmpPath}/${name}`
    );
  }
  await openPanel(page);
  await card(page, 'default')
    .locator('.jp-WorkspaceManager-cardHeader')
    .click();
  const rows = card(page, 'default').locator('.jp-WorkspaceManager-row');
  await expect(rows).toHaveCount(3); // the Launcher and the two files

  const labels = await rows
    .locator('.jp-WorkspaceManager-rowLabel')
    .allTextContents();
  const current = () =>
    page.evaluate(
      () => (window as any).jupyterapp.shell.currentWidget?.title.label
    );
  // the first row's tab is the current one, so activating the second is a change
  await rows.nth(0).click();
  await expect.poll(current, UNDER_LOAD).toBe(labels[0]);

  await rows.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(current, UNDER_LOAD).toBe(labels[1]);
  expect(labels[1]).not.toBe(labels[0]);
});

test('ACC-PANEL-93-FOCUS: keyboard focus shows a 1px brand outline, a click none', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  const brand = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--jp-brand-color1)';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const outline = (header: Locator) =>
    header.evaluate(n => {
      const style = getComputedStyle(n);
      return [style.outlineStyle, style.outlineWidth, style.outlineColor];
    });

  const header = await tabToCardHeader(page);
  expect(await outline(header)).toEqual(['solid', '1px', brand]);

  const clicked = card(page, 'default').locator(
    '.jp-WorkspaceManager-cardHeader'
  );
  await page.locator('#jp-main-dock-panel').click();
  await clicked.click();
  await expect(clicked).toBeFocused();
  expect((await outline(clicked))[0]).toBe('none');
});

test.describe('with the workspaces of the server', () => {
  test.use({ mockState: false });

  test("ACC-PANEL-166-HEADER-ENTER: Enter on the header of another workspace's card switches to it; on this window's card header it opens the card", async ({
    page
  }) => {
    const current = fresh('enter');
    const other = `${current}-other`;
    const header = `${PANEL} [data-workspace="${other}"] > .jp-WorkspaceManager-cardHeader`;
    await putWorkspace(page, other);
    try {
      await onlyWorkspaces(page, id => id.startsWith(current));
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await expect(card(page, other)).toBeVisible();
      await tabTo(page, header);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        new RegExp(`/lab/workspaces/${other}(\\?.*)?$`)
      );

      // the window is in the other workspace now: its card is this window's
      await expect(page.locator(PANEL_TAB)).toBeVisible({ timeout: 60000 });
      await openPanel(page);
      await refresh(page);
      const mine = await tabTo(page, header);
      await expect(mine).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(mine).toHaveAttribute('aria-expanded', 'true');
      await expect(card(page, other)).toHaveClass(/jp-mod-open/);
    } finally {
      await deleteWorkspaces(page, [current, other]);
    }
  });

  test('ACC-PANEL-138-ICON-LABELS: every icon button has a tooltip and an aria-label', async ({
    page
  }) => {
    const current = fresh('labels');
    const other = `${current}-other`;
    const hidden = `${current}-hidden`;
    await putWorkspace(page, other);
    await putWorkspace(page, hidden);
    await patchMeta(page, hidden, { hidden: true });
    const terminal = await startTerminal(page);
    try {
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await headerButton(page, 'Show hidden workspaces').click();
      await expect(card(page, hidden)).toBeVisible();

      const unnamed = () =>
        page.locator(PANEL).evaluate(panel =>
          Array.from(panel.querySelectorAll('button, jp-button'))
            .filter(b => !b.textContent?.trim())
            .map(b => ({
              title: b.getAttribute('title') ?? '',
              label: b.getAttribute('aria-label') ?? ''
            }))
        );
      // closed cards hold the open and close-all icons; a filter text adds its clear button
      const buttons = await unnamed();
      await headerButton(page, 'Filter').click();
      await page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`).fill('a');
      buttons.push(...(await unnamed()));
      const labels = buttons.map(b => b.label);
      // each kind of icon button is among them
      expect(labels).toEqual(
        expect.arrayContaining([
          'New workspace',
          'Filter',
          'Show hidden workspaces',
          'Refresh',
          'Clear filter',
          'Expand',
          'Open workspace',
          'Close all tabs',
          'Workspace menu',
          'Show workspace again',
          'Menu of In no workspace'
        ])
      );
      for (const b of buttons) {
        expect(b.title).not.toBe('');
        expect(b.label).not.toBe('');
      }
    } finally {
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, other, hidden]);
    }
  });
});
