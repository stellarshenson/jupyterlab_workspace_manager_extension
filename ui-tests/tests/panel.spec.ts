import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  only,
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

/** The computed value of a CSS property set to `value` on a probe in the panel: a token as the page resolves it. */
const token = (page: Page, property: string, value: string): Promise<string> =>
  page.locator(PANEL).evaluate(
    (panel, [property, value]) => {
      const probe = document.createElement('div');
      (probe.style as any)[property] = value;
      panel.appendChild(probe);
      const resolved = (getComputedStyle(probe) as any)[property];
      probe.remove();
      return resolved;
    },
    [property, value]
  );

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

  test('ACC-PANEL-8-POLL: a poll keeps the scroll position of the WORKSPACES list, refresh keeps the focus', async ({
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
      const list = sectionBody(page, 'workspaces');
      await expect(card(page, many[29])).toBeAttached();
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

  test('ACC-PANEL-90-SCROLL: each section list scrolls on its own under its header, 5 to 10 rows tall; the panel header and the filter field stay; nothing else scrolls', async ({
    page
  }) => {
    const current = fresh('scroll');
    const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
    await Promise.all(many.map(id => putWorkspace(page, id)));
    const terminals: string[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        terminals.push(await startTerminal(page));
      }
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await expect(card(page, many[29])).toBeAttached();
      await expect(
        sectionBody(page, 'terminals').locator('.jp-WorkspaceManager-row')
      ).not.toHaveCount(0);
      await headerButton(page, 'Filter').click();

      for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
        const drawn = await sectionBody(page, name).evaluate(n => {
          const s = getComputedStyle(n);
          const h = getComputedStyle(n.previousElementSibling!);
          return [
            s.overflowY,
            s.minHeight,
            s.scrollbarGutter,
            h.position,
            h.top
          ];
        });
        expect(drawn, name).toEqual(['auto', '0px', 'stable', 'sticky', '0px']);
      }
      // the two full lists: between 5 and 10 rows of 24 px
      for (const name of ['workspaces', 'terminals']) {
        const box = (await sectionBody(page, name).boundingBox())!;
        expect(box.height, name).toBeGreaterThanOrEqual(5 * 24);
        expect(box.height, name).toBeLessThanOrEqual(10 * 24);
      }
      // no ancestor of a list scrolls on its axis
      const scrolling = await sectionBody(page, 'workspaces').evaluate(n => {
        const found: string[] = [];
        for (
          let e = n.parentElement;
          e && e.id !== 'jp-running-sessions';
          e = e.parentElement
        ) {
          const y = getComputedStyle(e).overflowY;
          if (
            (y === 'auto' || y === 'scroll') &&
            e.scrollHeight > e.clientHeight
          ) {
            found.push(e.className);
          }
        }
        return found;
      });
      expect(scrolling).toEqual([]);

      const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
      const filter = page.locator(`${PANEL} .jp-WorkspaceManager-filter`);
      const list = sectionBody(page, 'workspaces');
      const terminalList = sectionBody(page, 'terminals');
      const before = [
        await header.boundingBox(),
        await filter.boundingBox(),
        await sectionHeader(page, 'workspaces').boundingBox(),
        await terminalList.evaluate(n => n.scrollTop)
      ];
      await list.hover();
      await page.mouse.wheel(0, 600);
      await expect
        .poll(() => list.evaluate(n => n.scrollTop), UNDER_LOAD)
        .toBeGreaterThan(0);
      expect([
        await header.boundingBox(),
        await filter.boundingBox(),
        await sectionHeader(page, 'workspaces').boundingBox(),
        await terminalList.evaluate(n => n.scrollTop)
      ]).toEqual(before);
      await expect(header).toBeInViewport();
      await expect(filter).toBeInViewport();
      await expect(sectionHeader(page, 'workspaces')).toBeInViewport();
    } finally {
      await Promise.all(
        terminals.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, ...many]);
    }
  });

  test.describe('in a 720 px window', () => {
    test.use({ kernels: null, viewport: { width: 1280, height: 720 } });

    test('ACC-PANEL-193-SECTIONS-SHOWN: with full WORKSPACES, KERNELS and TERMINALS lists every section header lies inside the panel and the empty LANGUAGE SERVERS list shows whole', async ({
      page
    }) => {
      test.setTimeout(120000);
      const current = fresh('full');
      const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
      await Promise.all(many.map(id => putWorkspace(page, id)));
      const kernels: string[] = [];
      const terminals: string[] = [];
      try {
        for (let i = 0; i < 10; i++) {
          const response = await page.request.post('/api/kernels', {
            data: { name: 'python3' }
          });
          expect(response.ok()).toBe(true);
          kernels.push((await response.json()).id);
        }
        for (let i = 0; i < 12; i++) {
          terminals.push(await startTerminal(page));
        }
        // the kernels, terminals and workspaces other tests run at the same time are not this test's
        await only(page, /\/api\/kernels(\?.*)?$/, k => kernels.includes(k.id));
        await only(
          page,
          /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
          t => terminals.includes(t.name)
        );
        await onlyWorkspaces(page, id => id.startsWith(current));
        await gotoWorkspace(page, current);
        await openPanel(page);
        await refresh(page);
        await expect(sectionCount(page, 'workspaces')).toHaveText('(31)');
        await expect(sectionCount(page, 'kernels')).toHaveText(
          '(10)',
          UNDER_LOAD
        );
        await expect(sectionCount(page, 'terminals')).toHaveText('(12)');
        await expect(sectionBody(page, 'servers')).toHaveText(
          'No language servers'
        );

        const drawn = await page
          .locator(`${PANEL} .jp-WorkspaceManager-content`)
          .evaluate(content => {
            const c = content.getBoundingClientRect();
            const within = (e: Element, box: DOMRect) => {
              const r = e.getBoundingClientRect();
              return (
                Math.round(r.top) >= Math.round(box.top) &&
                Math.round(r.bottom) <= Math.round(box.bottom)
              );
            };
            return {
              headers: [...content.querySelectorAll('[data-section]')].map(
                s => [
                  (s as HTMLElement).dataset.section,
                  within(
                    s.querySelector('.jp-WorkspaceManager-sectionHeader')!,
                    c
                  )
                ]
              ),
              empty: [
                ...content.querySelectorAll(
                  '.jp-WorkspaceManager-sectionBody > .jp-WorkspaceManager-empty'
                )
              ].map(e => [
                e.textContent,
                within(e, c) &&
                  within(e, e.parentElement!.getBoundingClientRect())
              ])
            };
          });
        expect(drawn).toEqual({
          headers: [
            ['workspaces', true],
            ['kernels', true],
            ['terminals', true],
            ['servers', true]
          ],
          empty: [['No language servers', true]]
        });
      } finally {
        await Promise.all([
          ...kernels.map(k => page.request.delete(`/api/kernels/${k}`)),
          ...terminals.map(t => page.request.delete(`/api/terminals/${t}`))
        ]);
        await deleteWorkspaces(page, [current, ...many]);
      }
    });
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

test('ACC-PANEL-147-HEADER-ORDER: new, filter, show hidden, refresh, then the buttons of other extensions, each 24px square with a 14 px glyph', async ({
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
        const svg = n.querySelector('svg')?.getBoundingClientRect();
        return {
          label: n.getAttribute('aria-label') ?? '',
          size: [Math.round(box.width), Math.round(box.height)],
          glyph: svg ? [Math.round(svg.width), Math.round(svg.height)] : null
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
  for (const b of buttons.slice(0, 4)) {
    expect([b.label, b.glyph]).toEqual([b.label, [14, 14]]);
  }
});

test('ACC-PANEL-201-HEADER-BAND: the panel header is a 24 to 30 px band on layout colour 2; WORKBENCH is 600, uppercase, 1 px tracking, size 0, colour 1, on one line, on the x of the section labels', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  expect(await panelWidth(page)).toBe(250);
  const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
  const box = (await header.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeLessThanOrEqual(30);
  expect(await header.evaluate(n => getComputedStyle(n).backgroundColor)).toBe(
    await token(page, 'backgroundColor', 'var(--jp-layout-color2)')
  );
  const title = page.locator(`${PANEL} .jp-WorkspaceManager-titleLabel`);
  await expect(title).toHaveText('WORKBENCH');
  const drawn = await title.evaluate(n => {
    const s = getComputedStyle(n);
    return {
      look: [
        s.fontWeight,
        s.textTransform,
        s.letterSpacing,
        s.fontSize,
        s.color
      ],
      oneLine: n.getBoundingClientRect().height < 2 * parseFloat(s.fontSize),
      whole: n.scrollWidth <= n.clientWidth
    };
  });
  expect(drawn).toEqual({
    look: [
      '600',
      'uppercase',
      '1px',
      await token(page, 'fontSize', 'var(--jp-ui-font-size0)'),
      await token(page, 'color', 'var(--jp-ui-font-color1)')
    ],
    oneLine: true,
    whole: true
  });
  const x = async (selector: string) =>
    (await page.locator(`${PANEL} ${selector}`).first().boundingBox())!.x;
  expect(
    Math.abs(
      (await x('.jp-WorkspaceManager-titleLabel')) -
        (await x('.jp-WorkspaceManager-sectionLabel'))
    )
  ).toBeLessThanOrEqual(1);
});

/** The four sections in the order of the panel, with their labels. */
const SECTIONS = [
  ['workspaces', 'WORKSPACES'],
  ['kernels', 'KERNELS'],
  ['terminals', 'TERMINALS'],
  ['servers', 'LANGUAGE SERVERS']
];

test('ACC-PANEL-192-SECTION-TITLES: each section header is a full-width band on layout colour 2 with no corners and no shadow, 6 px above and below; caret, a 600 uppercase size 0 label at 18 px in colour 1, the count in colour 2 6 px after it; hover layout colour 3', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  await page.mouse.move(0, 0);
  const [layout2, layout3, size0, colour1, colour2] = [
    await token(page, 'backgroundColor', 'var(--jp-layout-color2)'),
    await token(page, 'backgroundColor', 'var(--jp-layout-color3)'),
    await token(page, 'fontSize', 'var(--jp-ui-font-size0)'),
    await token(page, 'color', 'var(--jp-ui-font-color1)'),
    await token(page, 'color', 'var(--jp-ui-font-color2)')
  ];
  for (const [name, label] of SECTIONS) {
    const header = sectionHeader(page, name);
    await expect(
      header.locator('.jp-WorkspaceManager-caret svg')
    ).toHaveAttribute('data-icon', /^ui-components:caret-(right|down)$/);
    await expect(
      header.locator('.jp-WorkspaceManager-sectionLabel')
    ).toHaveText(label);
    await expect(sectionCount(page, name)).toHaveText(/^\(\d+\)$/);
    const drawn = await header.evaluate(n => {
      const s = getComputedStyle(n);
      const l = n.querySelector('.jp-WorkspaceManager-sectionLabel')!;
      const c = n.querySelector('.jp-WorkspaceManager-sectionCount')!;
      const ls = getComputedStyle(l);
      const [hb, lb, cb, sb] = [n, l, c, n.parentElement!].map(e =>
        e.getBoundingClientRect()
      );
      return {
        band: [
          s.backgroundColor,
          s.boxShadow,
          s.borderRadius,
          s.paddingTop,
          s.paddingBottom
        ],
        fullWidth: Math.round(hb.width) === Math.round(sb.width),
        label: [
          ls.fontWeight,
          ls.textTransform,
          ls.letterSpacing,
          ls.fontSize,
          ls.color
        ],
        labelInset: Math.round(lb.left - hb.left),
        count: [getComputedStyle(c).color, Math.round(cb.left - lb.right)]
      };
    });
    expect(drawn, name).toEqual({
      band: [layout2, 'none', '0px', '6px', '6px'],
      fullWidth: true,
      label: ['600', 'uppercase', '1px', size0, colour1],
      // the band sits 2 px inside the panel edge for its focus rim (DQ-19)
      labelInset: 16,
      count: [colour2, 6]
    });
    await header.locator('.jp-WorkspaceManager-sectionLabel').hover();
    expect(
      await header.evaluate(n => getComputedStyle(n).backgroundColor),
      `${name} hover`
    ).toBe(layout3);
    await page.mouse.move(0, 0);
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
