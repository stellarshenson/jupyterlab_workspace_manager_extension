import { expect, test } from '@jupyterlab/galata';

import {
  card,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  onlyWorkspaces,
  openPanel,
  PANEL,
  putWorkspace,
  refresh,
  startTerminal,
  UNDER_LOAD
} from './helpers';

// Load the page inside the test, so every console message of the load is caught
test.use({ autoGoto: false });

/** The sections the cards replace; every other one is under Other sessions. */
const REPLACED = ['Open Tabs', 'Kernels', 'Terminals', 'Workspaces'];
/** Requested by every reload of the panel and by nothing else. */
const POLLED = '/jupyterlab-workspace-manager-extension/terminals';

test('ACC-PANEL-1-REPLACE: the workspace panel holds the sidebar place of the Running panel', async ({
  page
}) => {
  // a failed request of another extension installed in this lab is not ours
  const errors: string[] = [];
  page.on('console', message => {
    const foreign =
      message.text().startsWith('Failed to load resource') &&
      !message
        .location()
        .url.includes('jupyterlab-workspace-manager-extension');
    if (message.type() === 'error' && !foreign) {
      errors.push(`${message.text()} ${message.location().url}`);
    }
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto();

  const tabs = page.locator('.jp-SideBar [data-id="jp-running-sessions"]');
  await expect(tabs).toHaveCount(1);
  await tabs.click();
  const panel = page.locator('#jp-running-sessions');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/jp-WorkspaceManager/);
  // this window's workspace has its card once the first reload is in
  await expect(
    panel.locator('.jp-WorkspaceManager-card[data-workspace="default"]')
  ).toBeVisible();
  await expect(page.locator('.jp-RunningSessions')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('a layout the built-in Running panel saved', () => {
  // the state the built-in panel leaves: the left sidebar shows `running-sessions`
  test.use({
    mockState: {
      'layout-restorer:data': {
        main: { dock: null },
        left: {
          collapsed: false,
          visible: true,
          current: 'running-sessions',
          widgets: ['filebrowser', 'running-sessions']
        },
        right: { collapsed: true, visible: true, widgets: [] }
      }
    }
  });

  test('ACC-PANEL-2-RESTORE: a saved layout with the Running panel opens the workspace panel', async ({
    page
  }) => {
    await page.goto();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/jp-WorkspaceManager/);
    await expect(
      page.locator('.jp-SideBar [data-id="jp-running-sessions"]')
    ).toHaveAttribute('aria-selected', 'true');
  });
});

test('ACC-PANEL-3-SHOWCMD: running:show-panel shows the hidden panel', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await page.evaluate(() => (window as any).jupyterapp.shell.collapseLeft());
  await expect(page.locator(PANEL)).toBeHidden();

  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('running:show-panel')
  );
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveClass(/jp-WorkspaceManager/);
});

test('ACC-PANEL-137-OTHERS-CLOSED: Other sessions is closed at load and counts the sections of other extensions', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  const names: string[] = await page.evaluate(async () => {
    const managers: any = await (window as any).galata.getPlugin(
      '@jupyterlab/running-extension:plugin'
    );
    return managers.items().map((m: any) => m.name);
  });
  const others = names.filter(n => !REPLACED.includes(n));
  // the four the cards replace are registered, so the count below excludes them
  expect(names).toEqual(expect.arrayContaining(REPLACED));
  expect(others.length).toBeGreaterThan(0);

  const othersCard = page.locator(`${PANEL} [data-key="x:others"]`);
  const header = othersCard.locator('.jp-WorkspaceManager-cardHeader');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(othersCard).not.toHaveClass(/jp-mod-open/);
  await expect(header.locator('.jp-WorkspaceManager-counts')).toHaveText(
    `${others.length} ${others.length === 1 ? 'section' : 'sections'}`
  );
});

test('ACC-PANEL-5-ICON: the sidebar tab shows the extension icon of four panes', async ({
  page
}) => {
  await page.goto();
  const svg = page.locator(
    '.jp-SideBar [data-id="jp-running-sessions"] svg[data-icon]'
  );
  await expect(svg).toHaveAttribute(
    'data-icon',
    'jupyterlab_workspace_manager_extension:panel'
  );
  // four panes in a 2 by 2 grid, only the top-left one filled
  const panes = await svg.locator('rect').evaluateAll(rects =>
    rects.map(r => ({
      x: r.getAttribute('x'),
      y: r.getAttribute('y'),
      filled: getComputedStyle(r).fill !== 'none'
    }))
  );
  expect(panes).toEqual([
    { x: '3', y: '3', filled: true },
    { x: '13', y: '3', filled: false },
    { x: '3', y: '13', filled: false },
    { x: '13', y: '13', filled: false }
  ]);
});

test('ACC-PANEL-6-REFRESH: the refresh button shows a new terminal before the next poll', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  const first = await startTerminal(page);
  try {
    await refresh(page);
    const nobody = page.locator(`${PANEL} [data-key="x:none"]`);
    await nobody.locator('.jp-WorkspaceManager-cardHeader').click();
    await expect(nobody).toHaveClass(/jp-mod-open/);

    // right after a poll's reload the next poll is 10 s away
    await page.waitForResponse(r => r.url().includes(POLLED), {
      timeout: 15000
    });
    await page.waitForTimeout(500);
    const second = await startTerminal(page);
    try {
      await headerButton(page, 'Refresh').click();
      await expect(
        nobody.locator('.jp-WorkspaceManager-row', {
          has: page.getByText(`terminal ${second}`, { exact: true })
        })
      ).toBeVisible({ timeout: 2000 });
    } finally {
      await page.request.delete(`/api/terminals/${second}`);
    }
  } finally {
    await page.request.delete(`/api/terminals/${first}`);
  }
});

test.describe('with the workspaces of the server', () => {
  test.use({ mockState: false });

  test('ACC-PANEL-8-POLL: a poll keeps the scroll position, refresh keeps the focus', async ({
    page
  }) => {
    const current = fresh('poll');
    const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
    await Promise.all(many.map(id => putWorkspace(page, id)));
    // another worker's new workspace would add a card above the scroll position
    await onlyWorkspaces(page, id => id.startsWith(current));
    try {
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      const list = page.locator(`${PANEL} .jp-WorkspaceManager-list`);
      await expect(card(page, many[29])).toBeVisible();
      await list.evaluate(n => (n.scrollTop = 300));
      expect(await list.evaluate(n => n.scrollTop)).toBe(300);

      // the next poll: its workspace list arrives, the cards render again
      await page.waitForResponse(r => r.url().includes(POLLED), {
        timeout: 15000
      });
      await page.waitForTimeout(500);
      expect(await list.evaluate(n => n.scrollTop)).toBe(300);

      const button = headerButton(page, 'Refresh');
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toBeDisabled();
      await expect(button).toBeEnabled();
      await expect(button).toBeFocused();
    } finally {
      await deleteWorkspaces(page, [current, ...many]);
    }
  });

  test('ACC-PANEL-80-WS-COUNT: the header counts the workspace cards shown', async ({
    page
  }) => {
    const current = fresh('count');
    const three = [1, 2, 3].map(i => `${current}-${i}`);
    await Promise.all(three.map(id => putWorkspace(page, id)));
    await onlyWorkspaces(page, id => id.startsWith(current));
    try {
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      const count = page.locator(`${PANEL} .jp-WorkspaceManager-titleCount`);
      await expect(count).toHaveText('4');

      await card(page, three[0])
        .locator('button[aria-label="Workspace menu"]')
        .click();
      await page
        .locator('.jp-WorkspaceManager-menu .lm-Menu-item', {
          hasText: 'Hide workspace'
        })
        .click();
      await expect(card(page, three[0])).toHaveCount(0);
      await expect(count).toHaveText('3');

      await headerButton(page, 'Show hidden workspaces').click();
      await expect(card(page, three[0])).toBeVisible();
      await expect(count).toHaveText('4');
    } finally {
      await deleteWorkspaces(page, [current, ...three]);
    }
  });

  test('ACC-PANEL-90-SCROLL: the card list scrolls under the header and the filter field', async ({
    page
  }) => {
    const current = fresh('scroll');
    const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
    await Promise.all(many.map(id => putWorkspace(page, id)));
    try {
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await expect(card(page, many[29])).toBeVisible();
      await headerButton(page, 'Filter').click();

      const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
      const filter = page.locator(`${PANEL} .jp-WorkspaceManager-filter`);
      const list = page.locator(`${PANEL} .jp-WorkspaceManager-list`);
      const before = [await header.boundingBox(), await filter.boundingBox()];
      await list.hover();
      await page.mouse.wheel(0, 600);
      await expect
        .poll(() => list.evaluate(n => n.scrollTop), UNDER_LOAD)
        .toBeGreaterThan(0);
      expect([await header.boundingBox(), await filter.boundingBox()]).toEqual(
        before
      );
      await expect(header).toBeInViewport();
      await expect(filter).toBeInViewport();
    } finally {
      await deleteWorkspaces(page, [current, ...many]);
    }
  });
});

test('ACC-PANEL-88-STATUSBAR: the status bar item of terminals and kernels shows the panel', async ({
  page
}) => {
  await page.goto();
  await page.evaluate(() => (window as any).jupyterapp.shell.collapseLeft());
  await expect(page.locator(PANEL)).toBeHidden();

  await page
    .locator('#jp-main-statusbar .jp-StatusBar-Item[title*="Kernel sessions"]')
    .click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveClass(/jp-WorkspaceManager/);
});

test('ACC-PANEL-89-SEARCH-TABS: the Search tabs button in the header opens its dialog', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await page
    .locator(
      `${PANEL} .jp-WorkspaceManager-header [data-command="running:show-modal"]`
    )
    .click();
  const dialog = page.locator('.jp-Dialog.jp-SearchableSessions-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.jp-Dialog-header')).toContainText(
    'Tabs and Running Sessions'
  );
});

test('ACC-PANEL-147-HEADER-ORDER: new, filter, show hidden, refresh, then the buttons of other extensions, each 24px square', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  const buttons = await page
    .locator(`${PANEL} .jp-WorkspaceManager-header`)
    .locator('button, jp-button')
    .evaluateAll(nodes =>
      nodes.map(n => {
        const box = n.getBoundingClientRect();
        return {
          label: n.getAttribute('aria-label') ?? '',
          size: [Math.round(box.width), Math.round(box.height)]
        };
      })
    );
  expect(buttons.slice(0, 4).map(b => b.label)).toEqual([
    'New workspace',
    'Filter',
    'Show hidden workspaces',
    'Refresh'
  ]);
  expect(buttons[4].label).toMatch(/^Search Tabs/);
  for (const b of buttons) {
    expect([b.label, b.size]).toEqual([b.label, [24, 24]]);
  }
});
