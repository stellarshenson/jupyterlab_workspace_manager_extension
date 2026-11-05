import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  COLOUR_LABELS,
  colourOf,
  COLOURS,
  deleteWorkspaces,
  fresh,
  fromMenu,
  gotoWorkspace,
  headerButton,
  listed,
  openCardMenu,
  menuItem,
  onlyWorkspaces,
  openCard,
  openPanel,
  patchMeta,
  putWorkspace,
  refresh,
  rgb,
  sectionHeader,
  shade,
  stripColour,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

const MENU = [
  'Open workspace',
  'Open in new browser tab',
  'Clear workspace',
  'Set description...',
  'Colour',
  'Hide workspace',
  'Move up',
  'Move down',
  'Delete workspace'
];

const dialog = (page: Page) => page.locator('.jp-Dialog');

/** The items of the open menus, separators left out. */
const items = (page: Page, menu = '.jp-WorkspaceManager-menu') =>
  page.locator(`${menu} .lm-Menu-item:not([data-type="separator"])`);

/** This window in a fresh workspace; `other` beside it with a colour; the panel sees only these. */
async function setUp(
  page: IJupyterLabPageFixture,
  prefix: string,
  colour = 'sky'
): Promise<{ current: string; other: string }> {
  const current = fresh(prefix);
  const other = `${current}-other`;
  await onlyWorkspaces(page, id => id.startsWith(current));
  await putWorkspace(page, other);
  await patchMeta(page, other, { colour });
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  return { current, other };
}

/** The colour of a card's strip as 0-255 channels. */
async function strip(page: Page, id: string): Promise<number[]> {
  return rgb(page, await stripColour(card(page, id)));
}

async function openColours(page: Page, id: string): Promise<void> {
  await openCardMenu(page, id);
  await menuItem(page, 'Colour').click();
  await expect(items(page, '.jp-WorkspaceManager-colourMenu')).toHaveCount(6);
}

test('ACC-ACCORD-29-MENU: a right-click on the card header opens the workspace menu with its nine items in order', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'menu');
  try {
    await openCardMenu(page, other);
    await expect(items(page).locator('.lm-Menu-itemLabel')).toHaveText(MENU);
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test("ACC-ACCORD-263-HEADER-MENU: a right-click on a card header, the eye included, opens the workspace menu at the pointer; the context-menu key opens it below the header; a hidden card's header opens no menu; a section band opens no workspace menu", async ({
  page
}) => {
  const { current, other } = await setUp(page, 'hdrmenu');
  const hidden = `${current}-hidden`;
  const menu = page.locator('.jp-WorkspaceManager-menu');
  const labels = items(page).locator('.lm-Menu-itemLabel');
  const closed = async () => {
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  };
  const corner = async () => {
    const box = (await menu.boundingBox())!;
    return [Math.round(box.x), Math.round(box.y)];
  };
  try {
    await putWorkspace(page, hidden);
    await patchMeta(page, hidden, { hidden: true });
    await headerButton(page, 'Show hidden workspaces').click();
    await refresh(page);
    await expect(card(page, hidden)).toBeVisible();

    for (const id of [current, other]) {
      const box = (await cardHeader(page, id).boundingBox())!;
      // whole pixels: a mouse event's position has no fraction
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2].map(
        Math.round
      );
      await page.mouse.click(x, y, { button: 'right' });
      await expect(labels).toHaveText(MENU);
      expect(await corner()).toEqual([x, y]);
      await closed();
    }

    // a button of the header: the enabled eye of another card, the disabled eye of this one
    for (const id of [other, current]) {
      await cardHeader(page, id)
        .getByRole('button', { name: 'Hide workspace' })
        .click({ button: 'right', force: true });
      await expect(labels).toHaveText(MENU);
      await closed();
    }

    await cardHeader(page, other).focus();
    await page.keyboard.press('ContextMenu');
    await expect(labels).toHaveText(MENU);
    const header = (await cardHeader(page, other).boundingBox())!;
    expect(await corner()).toEqual([
      Math.round(header.x),
      Math.round(header.y + header.height)
    ]);
    await closed();

    await cardHeader(page, hidden).click({ button: 'right' });
    await expect(page.locator('.lm-Menu')).toHaveCount(0);

    for (const name of ['kernels', 'terminals', 'servers']) {
      await sectionHeader(page, name).click({ button: 'right' });
      await expect(menu).toHaveCount(0);
      await expect(
        page.locator('.lm-Menu-itemLabel', { hasText: 'Open workspace' })
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  } finally {
    await deleteWorkspaces(page, [current, other, hidden]);
  }
});

test('ACC-ACCORD-148-MENU-ICONS: a 16px icon before every label, openIcon and closeTabsIcon, the swatch, and the danger class on Delete workspace alone', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'icons', 'mint');
  try {
    await openCardMenu(page, other);
    const icons = await items(page).evaluateAll(nodes =>
      nodes.map(n => {
        const svg = n.querySelector('.lm-Menu-itemIcon svg');
        const box = svg?.getBoundingClientRect();
        const label = n.querySelector('.lm-Menu-itemLabel')!;
        return {
          label: label.textContent,
          icon: svg?.getAttribute('data-icon') ?? null,
          size: box ? [box.width, box.height] : null,
          // the icon comes before the label
          before: !!svg && box!.right <= label.getBoundingClientRect().left
        };
      })
    );
    expect(icons.map(i => i.label)).toEqual(MENU);
    for (const i of icons) {
      expect([i.label, i.size, i.before]).toEqual([i.label, [16, 16], true]);
    }
    expect(icons[0].icon).toBe(
      '@stellarshenson/jupyterlab-workspace-manager-extension:open'
    );
    expect(icons[2].icon).toBe(
      '@stellarshenson/jupyterlab-workspace-manager-extension:close-tabs'
    );

    // Colour shows the swatch of the workspace's colour
    const swatch = await items(page)
      .nth(4)
      .locator('rect')
      .evaluate(r => getComputedStyle(r).fill);
    expect(await rgb(page, swatch)).toEqual(await strip(page, other));

    // Delete workspace is the destructive entry (DQ-11): the danger class from its command;
    // no other item's label or icon takes the error colour
    const error = JSON.stringify(await rgb(page, 'var(--jp-error-color1)'));
    const labelOf = (item: Locator) =>
      item
        .locator('.lm-Menu-itemLabel')
        .evaluate(l => getComputedStyle(l).color);
    const fillOf = (item: Locator) =>
      item
        .locator('.lm-Menu-itemIcon .jp-icon3[fill]')
        .first()
        .evaluate(p => getComputedStyle(p).fill);
    const paints = await items(page).evaluateAll(nodes =>
      nodes.map(n =>
        Array.from(n.querySelectorAll('.lm-Menu-itemIcon svg *')).flatMap(e => [
          getComputedStyle(e).fill,
          getComputedStyle(e).stroke
        ])
      )
    );
    const red: boolean[] = [];
    for (const colours of paints) {
      const channels = await Promise.all(colours.map(c => rgb(page, c)));
      red.push(channels.some(c => JSON.stringify(c) === error));
    }
    expect(red).toEqual(MENU.map(label => label === 'Delete workspace'));
    const labels = await Promise.all(
      MENU.map(label => labelOf(menuItem(page, label)))
    );
    const labelColours = await Promise.all(labels.map(c => rgb(page, c)));
    expect(labelColours.map(c => JSON.stringify(c) === error)).toEqual(
      MENU.map(label => label === 'Delete workspace')
    );
    const binItem = menuItem(page, 'Delete workspace');
    await expect(binItem).toHaveClass(/jp-WorkspaceManager-danger/);
    expect(JSON.stringify(await rgb(page, await fillOf(binItem)))).toBe(error);
    expect(JSON.stringify(await rgb(page, await labelOf(binItem)))).toBe(error);

    // hovered and selected by the arrow keys: the same error colour, the menu's own selection background
    const background = (item: Locator) =>
      item.evaluate(n => getComputedStyle(n).backgroundColor);
    await menuItem(page, 'Set description...').hover();
    const active = await background(menuItem(page, 'Set description...'));
    await binItem.hover();
    await expect(binItem).toHaveClass(/lm-mod-active/);
    expect(await background(binItem)).toBe(active);
    expect(JSON.stringify(await rgb(page, await labelOf(binItem)))).toBe(error);
    await page.keyboard.press('Escape');
    await expect(items(page)).toHaveCount(0);

    await openCardMenu(page, other);
    const keyed = menuItem(page, 'Delete workspace');
    // ArrowDown steps over the one item that does not apply to this card
    let reached = false;
    for (let i = 0; i < MENU.length && !reached; i++) {
      await page.keyboard.press('ArrowDown');
      reached = await keyed.evaluate(n =>
        n.classList.contains('lm-mod-active')
      );
    }
    expect(reached, 'ArrowDown reaches Delete workspace').toBe(true);
    expect(await background(keyed)).toBe(active);
    expect(JSON.stringify(await rgb(page, await labelOf(keyed)))).toBe(error);
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-150-COLOUR-SWATCH, MENU-04: the Colour submenu lists Red, Orange, Yellow, Green, Blue, Purple, each after a 12px swatch with 2px corners and a layout colour 4 border filled with its value', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'swatch');
  try {
    await openColours(page, other);
    const colours = items(page, '.jp-WorkspaceManager-colourMenu');
    await expect(colours.locator('.lm-Menu-itemLabel')).toHaveText(
      COLOUR_LABELS
    );
    const border = await rgb(page, 'var(--jp-layout-color4)');
    for (let i = 0; i < 6; i++) {
      const s = await colours
        .nth(i)
        .locator('.lm-Menu-itemIcon rect')
        .evaluate((r: SVGRectElement) => {
          const box = r.getBoundingClientRect();
          const style = getComputedStyle(r);
          return {
            size: [box.width, box.height],
            radius: r.getAttribute('rx'),
            strokeWidth: style.strokeWidth,
            stroke: style.stroke,
            fill: style.fill
          };
        });
      expect([s.size, s.radius, s.strokeWidth]).toEqual([[12, 12], '2', '1px']);
      expect(await rgb(page, s.stroke)).toEqual(border);
      expect(await rgb(page, s.fill), COLOURS[i]).toEqual(
        await rgb(page, await shade(page, COLOURS[i]))
      );
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-102-COLOUR-CHECK: the Colour submenu marks the present colour', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'check', 'lemon');
  try {
    await openColours(page, other);
    const toggled = page.locator(
      '.jp-WorkspaceManager-colourMenu .lm-Menu-item.lm-mod-toggled'
    );
    await expect(toggled).toHaveCount(1);
    await expect(toggled.locator('.lm-Menu-itemLabel')).toHaveText('Yellow');
    const mark = await toggled
      .locator('.lm-Menu-itemLabel')
      .evaluate(l => getComputedStyle(l, '::after').content);
    expect(mark).toContain('✓');
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-30-SET-COLOUR: Colour sets the strip at once, and the colour survives a reload', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'colour', 'sky');
  try {
    const mint = await rgb(page, await shade(page, 'mint'));
    expect(await strip(page, other)).not.toEqual(mint);
    await openColours(page, other);
    await menuItem(page, 'Green').click();
    await expect(card(page, other)).toHaveClass(/jp-mod-mint/);
    expect(await strip(page, other)).toEqual(mint);

    await page.reload();
    await openPanel(page);
    await refresh(page);
    await expect(card(page, other)).toHaveClass(/jp-mod-mint/);
    expect(await strip(page, other)).toEqual(mint);
    expect(await colourOf(page, other)).toBe('mint');
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-31-DELETE: two separate clicks delete the workspace', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'delete');
  try {
    await openCardMenu(page, other);
    await menuItem(page, 'Delete workspace').click();
    // the first click arms; the menu stays
    await expect(menuItem(page, 'Confirm delete')).toBeVisible();
    expect(await listed(page)).toContain(other);
    await page.waitForTimeout(700);
    await menuItem(page, 'Confirm delete').click();
    await expect.poll(() => listed(page), UNDER_LOAD).not.toContain(other);
    await expect(card(page, other)).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-155-ARMED-COLOUR: Delete workspace and, armed, Confirm delete draw the error-coloured label and icon on the menu background, which stays that of Set description...', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'armed');
  // How an item is drawn: background, label colour, its icon and the fill of the icon's jp-icon3 path
  const paint = (label: string) =>
    menuItem(page, label).evaluate(n => ({
      background: getComputedStyle(n).backgroundColor,
      label: getComputedStyle(n.querySelector('.lm-Menu-itemLabel')!).color,
      icon: n.querySelector('.lm-Menu-itemIcon svg')!.getAttribute('data-icon'),
      fill: getComputedStyle(
        n.querySelector('.lm-Menu-itemIcon .jp-icon3[fill]')!
      ).fill
    }));
  try {
    for (const theme of ['JupyterLab Light', 'Galaxa Dark Theme - Steel']) {
      await page.theme.setTheme(theme);
      await openCardMenu(page, other);
      const error = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--jp-error-color1)';
        document.body.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      // the labels of the items with a red fill or stroke in their icon
      const red = () =>
        items(page).evaluateAll(
          (nodes, error) =>
            nodes
              .filter(n =>
                Array.from(n.querySelectorAll('.lm-Menu-itemIcon svg *')).some(
                  e =>
                    getComputedStyle(e).fill === error ||
                    getComputedStyle(e).stroke === error
                )
              )
              .map(n => n.querySelector('.lm-Menu-itemLabel')!.textContent),
          error
        );
      // the reference's pencil is a jp-icon3 path, as the bin and the warning sign are
      const plain = await paint('Set description...');
      expect(plain.fill, theme).not.toBe(error);
      const bin = 'ui-components:delete';
      const warning =
        '@stellarshenson/jupyterlab-workspace-manager-extension:warning';

      // at rest: the error-coloured label and bin, the reference's background
      expect(await red(), theme).toEqual(['Delete workspace']);
      expect(await paint('Delete workspace'), theme).toEqual({
        background: plain.background,
        label: error,
        icon: bin,
        fill: error
      });

      // active under the pointer: the reference's active background, the error colour kept
      await menuItem(page, 'Set description...').hover();
      await expect(menuItem(page, 'Set description...')).toHaveClass(
        /lm-mod-active/
      );
      const active = await paint('Set description...');
      expect(active.background, theme).not.toBe(plain.background);
      await menuItem(page, 'Delete workspace').hover();
      await expect(menuItem(page, 'Delete workspace')).toHaveClass(
        /lm-mod-active/
      );
      expect(await paint('Delete workspace'), theme).toEqual({
        background: active.background,
        label: error,
        icon: bin,
        fill: error
      });

      // armed, still active: the warning sign takes the bin's place, jp-mod-confirm marks the item
      await menuItem(page, 'Delete workspace').click();
      await expect(menuItem(page, 'Confirm delete')).toHaveClass(
        /lm-mod-active/
      );
      await expect(menuItem(page, 'Confirm delete')).toHaveClass(
        /jp-mod-confirm/
      );
      expect(await paint('Confirm delete'), theme).toEqual({
        background: active.background,
        label: error,
        icon: warning,
        fill: error
      });
      expect(await red(), theme).toEqual(['Confirm delete']);
      // armed, at rest: the pointer on the reference
      await menuItem(page, 'Set description...').hover();
      expect(await paint('Confirm delete'), theme).toEqual({
        background: plain.background,
        label: error,
        icon: warning,
        fill: error
      });
      await page.keyboard.press('Escape');
      await expect(items(page)).toHaveCount(0);
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test("ACC-ACCORD-32-DELETE-CURRENT: Delete workspace and Open in new browser tab are disabled on this window's workspace", async ({
  page
}) => {
  const { current, other } = await setUp(page, 'delcur');
  try {
    await openCardMenu(page, current);
    for (const label of ['Delete workspace', 'Open in new browser tab']) {
      await expect(menuItem(page, label)).toHaveClass(/lm-mod-disabled/);
      await expect(menuItem(page, label)).toHaveAttribute(
        'aria-disabled',
        'true'
      );
    }
    // a click on the disabled item arms nothing and deletes nothing
    await menuItem(page, 'Delete workspace').click({ force: true });
    await menuItem(page, 'Delete workspace').click({ force: true });
    await page.keyboard.press('Escape');
    expect(await listed(page)).toContain(current);
    // the others' menus have both
    await openCardMenu(page, other);
    await expect(menuItem(page, 'Delete workspace')).not.toHaveClass(
      /lm-mod-disabled/
    );
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-24-OPEN-TAB: Open in new browser tab opens the workspace in a new tab; this window stays', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'newtab');
  try {
    const url = page.url();
    const [opened] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 20000 }),
      fromMenu(page, other, 'Open in new browser tab')
    ]);
    try {
      await expect(opened).toHaveURL(new RegExp(`/lab/workspaces/${other}$`));
      expect(page.url()).toBe(url);
    } finally {
      await opened.close();
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-99-PURPOSE-DIALOG: Set description shows the purpose, focused; Enter saves', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'describe');
  await patchMeta(page, other, { purpose: 'First purpose' });
  try {
    await refresh(page);
    await fromMenu(page, other, 'Set description...');
    const area = dialog(page).getByLabel('Short description (optional)');
    await expect(area).toHaveValue('First purpose');
    await expect(area).toBeFocused();
    await expect(area).toHaveAttribute('rows', '3');
    await area.fill('Second purpose');
    await area.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    // DQ-17: the purpose shows on the open card
    await openCard(page, other);
    await expect(
      card(page, other).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('Second purpose');
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-100-PURPOSE-LENGTH: the description dialog keeps 100 of 150 characters', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'length');
  try {
    await fromMenu(page, other, 'Set description...');
    const area = dialog(page).getByLabel('Short description (optional)');
    await expect(area).toBeFocused();
    const typed = 'abcdefghij'.repeat(15);
    await page.keyboard.type(typed);
    await expect(area).toHaveValue(typed.slice(0, 100));
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    const response = await page.request.get(
      '/jupyterlab-workspace-manager-extension/meta'
    );
    expect((await response.json())[other].purpose).toBe(typed.slice(0, 100));
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-19-SET-PURPOSE: Set description sets and clears the purpose; both survive a reload', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'setpurpose');
  const purpose = card(page, other).locator('.jp-WorkspaceManager-purpose');
  const reload = async () => {
    await page.reload();
    await openPanel(page);
    await refresh(page);
    await expect(card(page, other)).toBeVisible();
    await openCard(page, other);
  };
  try {
    await fromMenu(page, other, 'Set description...');
    await dialog(page).locator('textarea').fill('Firmware upload tests');
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Save' })
      .click();
    // DQ-17: the purpose shows on the open card
    await openCard(page, other);
    await expect(purpose).toHaveText('Firmware upload tests');
    await reload();
    await expect(purpose).toHaveText('Firmware upload tests');

    await fromMenu(page, other, 'Set description...');
    await expect(dialog(page).locator('textarea')).toHaveValue(
      'Firmware upload tests'
    );
    await dialog(page).locator('textarea').fill('');
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Save' })
      .click();
    await expect(purpose).toHaveCount(0);
    await reload();
    await expect(purpose).toHaveCount(0);
    const response = await page.request.get(
      '/jupyterlab-workspace-manager-extension/meta'
    );
    expect((await response.json())[other]).not.toHaveProperty('purpose');
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});
