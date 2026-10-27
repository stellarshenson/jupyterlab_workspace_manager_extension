import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  cardHeader,
  colourOf,
  COLOUR_LABELS,
  COLOURS,
  deleteWorkspaces,
  fresh,
  fromMenu,
  gotoWorkspace,
  listed,
  menuButton,
  menuItem,
  onlyWorkspaces,
  openPanel,
  patchMeta,
  putWorkspace,
  refresh,
  rgb,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

const MENU = [
  'Open workspace',
  'Open in new browser tab',
  'Close all tabs',
  'Set description...',
  'Colour',
  'Hide workspace',
  'Move up',
  'Move down',
  'Delete workspace'
];

/** The index of Delete workspace among the items. */
const BIN = MENU.indexOf('Delete workspace');

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
  return rgb(
    page,
    await card(page, id).evaluate(
      n => getComputedStyle(n, '::before').backgroundColor
    )
  );
}

async function openColours(page: Page, id: string): Promise<void> {
  await menuButton(page, id).click();
  await menuItem(page, 'Colour').click();
  await expect(items(page, '.jp-WorkspaceManager-colourMenu')).toHaveCount(6);
}

test('ACC-ACCORD-29-MENU: the ... button opens the workspace menu with its nine items in order', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'menu');
  try {
    await menuButton(page, other).click();
    await expect(items(page).locator('.lm-Menu-itemLabel')).toHaveText(MENU);
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-148-MENU-ICONS: a 16px icon before every label, the header icons, the swatch, the red bin only', async ({
  page
}) => {
  const { current, other } = await setUp(page, 'icons', 'mint');
  try {
    await cardHeader(page, other).hover();
    const headerIcon = (label: string) =>
      card(page, other)
        .locator(`button[aria-label="${label}"] svg`)
        .getAttribute('data-icon');
    const open = await headerIcon('Open workspace');
    const closeAll = await headerIcon('Close all tabs');

    await menuButton(page, other).click();
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
    expect(icons[0].icon).toBe(open);
    expect(icons[2].icon).toBe(closeAll);

    // Colour shows the swatch of the workspace's colour
    const swatch = await items(page)
      .nth(4)
      .locator('rect')
      .evaluate(r => getComputedStyle(r).fill);
    expect(await rgb(page, swatch)).toEqual(await strip(page, other));

    // only the bin takes the error colour; the label Delete workspace stays colour 0
    const error = JSON.stringify(await rgb(page, 'var(--jp-error-color1)'));
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
    const bin = await items(page)
      .nth(BIN)
      .locator('.lm-Menu-itemIcon .jp-icon3[fill]')
      .first()
      .evaluate(p => getComputedStyle(p).fill);
    expect(JSON.stringify(await rgb(page, bin))).toBe(error);
    const label = await items(page)
      .nth(BIN)
      .locator('.lm-Menu-itemLabel')
      .evaluate(l => getComputedStyle(l).color);
    expect(await rgb(page, label)).toEqual(
      await rgb(page, 'var(--jp-ui-font-color0)')
    );
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-150-COLOUR-SWATCH: the Colour submenu draws a 12px swatch with 2px corners and a layout colour 4 border before each colour', async ({
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
      expect(await rgb(page, s.fill)).toEqual(
        await rgb(page, `var(--jp-workspace-manager-${COLOURS[i]})`)
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
    const mint = await rgb(page, 'var(--jp-workspace-manager-mint)');
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
    await menuButton(page, other).click();
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

test('ACC-ACCORD-155-ARMED-COLOUR: Delete workspace shows a red bin and, armed, a red warning icon in its place; at rest, active and armed its label and background are those of Set description...', async ({
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
      await menuButton(page, other).click();
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
      const warning = 'jupyterlab_workspace_manager_extension:warning';

      // at rest: a red bin, the reference's label colour and background
      expect(await red(), theme).toEqual(['Delete workspace']);
      expect(await paint('Delete workspace'), theme).toEqual({
        background: plain.background,
        label: plain.label,
        icon: bin,
        fill: error
      });

      // active under the pointer: the reference's active label colour and background
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
        ...active,
        icon: bin,
        fill: error
      });

      // armed, still active: the warning sign takes the bin's place, the label and background stay
      await menuItem(page, 'Delete workspace').click();
      await expect(menuItem(page, 'Confirm delete')).toHaveClass(
        /lm-mod-active/
      );
      expect(await paint('Confirm delete'), theme).toEqual({
        ...active,
        icon: warning,
        fill: error
      });
      expect(await red(), theme).toEqual(['Confirm delete']);
      // armed, at rest: the pointer on the reference
      await menuItem(page, 'Set description...').hover();
      expect(await paint('Confirm delete'), theme).toEqual({
        ...plain,
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
    await menuButton(page, current).click();
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
    await menuButton(page, other).click();
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
  };
  try {
    await fromMenu(page, other, 'Set description...');
    await dialog(page).locator('textarea').fill('Firmware upload tests');
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Save' })
      .click();
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
    await expect(purpose).toHaveText('');
    await reload();
    await expect(purpose).toHaveText('');
    const response = await page.request.get(
      '/jupyterlab-workspace-manager-extension/meta'
    );
    expect((await response.json())[other]).not.toHaveProperty('purpose');
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});
