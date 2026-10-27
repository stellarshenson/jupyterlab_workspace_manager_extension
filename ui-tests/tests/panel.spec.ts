import { expect, test } from '@jupyterlab/galata';

import {
  card,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  onlyWorkspaces,
  openPanel,
  openSection,
  PANEL,
  panelWidth,
  putWorkspace,
  refresh,
  rowOf,
  sectionBody,
  sectionCount,
  sectionHeader,
  startTerminal,
  UNDER_LOAD
} from './helpers';

// Load the page inside the test, so every console message of the load is caught
test.use({ autoGoto: false });

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

test('ACC-PANEL-183-OTHERS-GONE: the panel shows no OTHER SESSIONS header and no text In no workspace; recently closed documents and the sessions of other windows are not listed', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  const text = await page.locator(PANEL).textContent();
  expect(text).not.toContain('OTHER SESSIONS');
  expect(text).not.toContain('In no workspace');
  expect(text).not.toContain('RECENTLY CLOSED');
  await expect(page.locator(`${PANEL} [data-key="x:others"]`)).toHaveCount(0);
  await expect(page.locator(`${PANEL} [data-key="x:none"]`)).toHaveCount(0);
});

test('ACC-PANEL-184-TITLE-NAME: the panel header reads WORKBENCH, with the add, filter, hidden and refresh buttons beside it; below it a WORKSPACES header carries the number of workspaces', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  expect(await panelWidth(page)).toBe(250);
  const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
  const title = header.locator('.jp-WorkspaceManager-titleLabel');
  await expect(title).toHaveText('WORKBENCH');
  // the title draws on one line at 250 px: one line box, not a wrapped second
  expect(
    await title.evaluate(n => {
      const r = document.createRange();
      r.selectNodeContents(n);
      return r.getClientRects().length;
    })
  ).toBe(1);
  for (const label of [
    'New workspace',
    'Filter',
    'Show hidden workspaces',
    'Refresh'
  ]) {
    await expect(headerButton(page, label)).toBeVisible();
  }
  await expect(sectionHeader(page, 'workspaces')).toContainText('WORKSPACES');
  await expect(sectionCount(page, 'workspaces')).toHaveText(/^\(\d+\)$/);
  // the cards follow their header, and the other sections follow the cards
  const [section, cards] = [
    await sectionHeader(page, 'workspaces').boundingBox(),
    await page
      .locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`)
      .first()
      .boundingBox()
  ];
  expect(section!.y).toBeLessThan(cards!.y);
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
    await expect(sectionHeader(page, 'terminals')).toContainText('TERMINALS');
    await openSection(page, 'terminals');
    await expect(
      rowOf(sectionBody(page, 'terminals'), `terminal ${first}`)
    ).toBeVisible();

    // right after a poll's reload the next poll is 10 s away
    await page.waitForResponse(r => r.url().includes(POLLED), {
      timeout: 15000
    });
    await page.waitForTimeout(500);
    const second = await startTerminal(page);
    try {
      await headerButton(page, 'Refresh').click();
      await expect(
        rowOf(sectionBody(page, 'terminals'), `terminal ${second}`)
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
      const count = sectionCount(page, 'workspaces');
      await expect(count).toHaveText('(4)');

      await card(page, three[0])
        .locator('button[aria-label="Workspace menu"]')
        .click();
      await page
        .locator('.jp-WorkspaceManager-menu .lm-Menu-item', {
          hasText: 'Hide workspace'
        })
        .click();
      await expect(card(page, three[0])).toHaveCount(0);
      await expect(count).toHaveText('(3)');

      await headerButton(page, 'Show hidden workspaces').click();
      await expect(card(page, three[0])).toBeVisible();
      await expect(count).toHaveText('(4)');
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

test('ACC-PANEL-169-NO-SEARCH, DEF-PANEL-13-SEARCH-ICON: no Search Tabs and Running Sessions button in the panel header; the command palette lists the command', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  // @jupyterlab/running-extension:search-tabs ran: it adds the command, and the button to the panel it finds
  expect(
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.hasCommand('running:show-modal')
    )
  ).toBe(true);
  const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
  await expect(
    header.locator('[data-command="running:show-modal"]')
  ).toHaveCount(0);
  await expect(
    header.locator('[title="Search Tabs and Running Sessions"]')
  ).toHaveCount(0);

  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute(
      'apputils:activate-command-palette'
    )
  );
  const palette = page.locator('.jp-ModalCommandPalette');
  await palette.locator('.lm-CommandPalette-input').fill('Search Tabs');
  await expect(
    palette.locator('.lm-CommandPalette-item', {
      hasText: 'Search Tabs and Running Sessions'
    })
  ).toHaveCount(1);
});

test('ACC-PANEL-147-HEADER-ORDER: new, filter, show hidden, refresh, then the buttons of other extensions, each 24px square', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  // a button another extension adds to the toolbar of the panel, as search-tabs did
  await page.evaluate(async () => {
    const panel: any = await (window as any).galata.getPlugin(
      'jupyterlab_workspace_manager_extension:plugin'
    );
    // the title is a plain Lumino widget: its class makes the item
    const Widget = panel.toolbar.layout.widgets[0].constructor;
    const node = document.createElement('button');
    node.className = 'jp-ToolbarButtonComponent';
    node.title = 'Button of another extension';
    node.setAttribute('aria-label', node.title);
    panel.toolbar.addItem('another-extension', new Widget({ node }));
  });
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
  expect(buttons[4].label).toBe('Button of another extension');
  for (const b of buttons) {
    expect([b.label, b.size]).toEqual([b.label, [24, 24]]);
  }
});

/** The four sections in the order of the panel, with their labels. */
const SECTIONS = [
  ['workspaces', 'WORKSPACES'],
  ['kernels', 'KERNELS'],
  ['terminals', 'TERMINALS'],
  ['servers', 'LANGUAGE SERVERS']
];

/** The computed style that makes a header a JupyterLab section title, not a card. */
const LOOK = [
  'backgroundColor',
  'borderBottomWidth',
  'borderBottomStyle',
  'borderBottomColor',
  'boxShadow',
  'textTransform',
  'borderRadius',
  'marginLeft',
  'marginRight'
];

test('ACC-PANEL-192-SECTION-TITLES: each section header is a flat title across the section list, drawn as JupyterLab draws an accordion title: caret, uppercase label, (N), no rounded corners, no side margin', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  // a title of JupyterLab's accordion panel, drawn in the panel by JupyterLab's stylesheet
  const title = await page.locator(PANEL).evaluate((panel, look) => {
    const accordion = document.createElement('div');
    accordion.className = 'lm-AccordionPanel';
    const h3 = document.createElement('h3');
    h3.className = 'lm-AccordionPanel-title jp-AccordionPanel-title';
    accordion.appendChild(h3);
    panel.appendChild(accordion);
    const s: any = getComputedStyle(h3);
    const drawn = look.map(p => s[p]);
    accordion.remove();
    return drawn;
  }, LOOK);
  expect(title.slice(LOOK.indexOf('textTransform'))).toEqual([
    'uppercase',
    '0px',
    '0px',
    '0px'
  ]);
  const list = await page
    .locator(`${PANEL} .jp-WorkspaceManager-list`)
    .evaluate(n => [n.getBoundingClientRect().left, n.clientWidth]);
  for (const [name, label] of SECTIONS) {
    const header = sectionHeader(page, name);
    await expect(
      header.locator('.jp-WorkspaceManager-caret svg')
    ).toHaveAttribute('data-icon', /^ui-components:caret-(right|down)$/);
    await expect(
      header.locator('.jp-WorkspaceManager-sectionLabel')
    ).toHaveText(label);
    await expect(sectionCount(page, name)).toHaveText(/^\(\d+\)$/);
    const drawn = await header.evaluate((n, look) => {
      const s: any = getComputedStyle(n);
      const box = n.getBoundingClientRect();
      return { look: look.map(p => s[p]), box: [box.left, box.width] };
    }, LOOK);
    expect(drawn, name).toEqual({ look: title, box: list });
  }
});

test('ACC-PANEL-193-SECTIONS-SHOWN: with no kernel, terminal or language server the four sections show in order; each empty one says so and its Shut down all is disabled', async ({
  page
}) => {
  // Galata lists only the kernels and sessions this page starts; the terminals of other tests are not this test's
  await page.route(
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    route => route.fulfill({ json: [] })
  );
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  await expect(
    page.locator(`${PANEL} .jp-WorkspaceManager-sectionLabel`)
  ).toHaveText(SECTIONS.map(([, label]) => label));
  for (const [name, label] of SECTIONS.slice(1)) {
    await expect(sectionCount(page, name)).toHaveText('(0)');
    await expect(
      sectionHeader(page, name).getByRole('button', {
        name: 'Shut down all',
        exact: true
      })
    ).toBeDisabled();
    await openSection(page, name);
    await expect(sectionBody(page, name)).toHaveText(
      `No ${label.toLowerCase()}`
    );
  }
});
