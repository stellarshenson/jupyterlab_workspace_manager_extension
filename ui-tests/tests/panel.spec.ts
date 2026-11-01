import { expect, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  languageServer,
  layout,
  only,
  onlyWorkspaces,
  openCard,
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
  sidebarTo,
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
    '@stellarshenson/jupyterlab-workspace-manager-extension:panel'
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

  test('ACC-PANEL-90-SCROLL: each open section body is its own scroll container under a sticky header; the panel header and the filter field stay in place', async ({
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
      await headerButton(page, 'Filter').click();

      // one section open at a time: each opened in turn is the only scroll container
      for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
        await openSection(page, name);
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
        // no ancestor of a list scrolls on its axis
        const scrolling = await sectionBody(page, name).evaluate(n => {
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
        expect(scrolling, name).toEqual([]);
      }

      await openSection(page, 'workspaces');
      const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
      const filter = page.locator(`${PANEL} .jp-WorkspaceManager-filter`);
      const list = sectionBody(page, 'workspaces');
      const before = [
        await header.boundingBox(),
        await filter.boundingBox(),
        await sectionHeader(page, 'workspaces').boundingBox()
      ];
      await list.hover();
      await page.mouse.wheel(0, 600);
      await expect
        .poll(() => list.evaluate(n => n.scrollTop), UNDER_LOAD)
        .toBeGreaterThan(0);
      expect([
        await header.boundingBox(),
        await filter.boundingBox(),
        await sectionHeader(page, 'workspaces').boundingBox()
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

  test('ACC-PANEL-232-ROW-CAP: WORKSPACES fills the height between the panel header and the three closed bands and shows more than ten rows before it scrolls', async ({
    page
  }) => {
    const current = fresh('cap');
    const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
    await Promise.all(many.map(id => putWorkspace(page, id)));
    await onlyWorkspaces(page, id => id.startsWith(current));
    try {
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await expect(card(page, many[29])).toBeAttached();
      const drawn = await sectionBody(page, 'workspaces').evaluate(n => ({
        client: n.clientHeight,
        scroll: n.scrollHeight,
        overflow: getComputedStyle(n).overflowY
      }));
      expect(drawn.overflow).toBe('auto');
      // the old clamp stopped at ten rows of 24 px; the open list fills the panel
      expect(drawn.client).toBeGreaterThan(10 * 24);
      expect(drawn.scroll).toBeGreaterThan(drawn.client);
      // the WORKSPACES band above the open body, the collapsed KERNELS band below it
      const workspacesHeader = (await sectionHeader(
        page,
        'workspaces'
      ).boundingBox())!;
      const body = (await sectionBody(page, 'workspaces').boundingBox())!;
      const kernelsHeader = (await sectionHeader(
        page,
        'kernels'
      ).boundingBox())!;
      expect(
        Math.abs(body.y - (workspacesHeader.y + workspacesHeader.height))
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(body.y + body.height - kernelsHeader.y)
      ).toBeLessThanOrEqual(1);
    } finally {
      await deleteWorkspaces(page, [current, ...many]);
    }
  });

  test.describe('with a real kernel', () => {
    test.use({ kernels: null });

    test('ACC-PANEL-227-FLUSH-WIDTH: a workspace card and a KERNELS, TERMINALS and LANGUAGE SERVERS row each span its section body to both edges', async ({
      page
    }) => {
      test.setTimeout(120000);
      const current = fresh('flush');
      await putWorkspace(page, current);
      const kernel = (
        await (
          await page.request.post('/api/kernels', {
            data: { name: 'python3' }
          })
        ).json()
      ).id;
      const terminal = await startTerminal(page);
      try {
        await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === kernel);
        await only(
          page,
          /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
          t => t.name === terminal
        );
        await onlyWorkspaces(page, id => id === current);
        await gotoWorkspace(page, current);
        await openPanel(page);
        await refresh(page);
        await languageServer(page, true);

        const boxes: [string, Locator][] = [
          ['workspaces', card(page, current)],
          [
            'kernels',
            sectionBody(page, 'kernels')
              .locator('.jp-WorkspaceManager-row')
              .first()
          ],
          [
            'terminals',
            sectionBody(page, 'terminals')
              .locator('.jp-WorkspaceManager-row')
              .first()
          ],
          [
            'servers',
            sectionBody(page, 'servers')
              .locator('.jp-WorkspaceManager-row')
              .first()
          ]
        ];
        // one section at a time: open each in turn, the card first
        for (const [name, box] of boxes) {
          await openSection(page, name);
          await expect(box, name).toBeVisible();
          const drawn = await box.evaluate(n => {
            const body = n.closest(
              '.jp-WorkspaceManager-sectionBody'
            ) as HTMLElement;
            const s = getComputedStyle(body);
            const b = body.getBoundingClientRect();
            // the content box ends before the borders and whatever strip the body keeps
            const bar =
              body.offsetWidth -
              body.clientWidth -
              parseFloat(s.borderLeftWidth) -
              parseFloat(s.borderRightWidth);
            const left =
              b.left +
              parseFloat(s.borderLeftWidth) +
              parseFloat(s.paddingLeft);
            const right =
              b.right -
              parseFloat(s.borderRightWidth) -
              parseFloat(s.paddingRight) -
              bar;
            const r = n.getBoundingClientRect();
            return {
              left: r.left - left,
              right: right - r.right
            };
          });
          expect(Math.abs(drawn.left), name).toBeLessThanOrEqual(1);
          expect(Math.abs(drawn.right), name).toBeLessThanOrEqual(1);
        }
      } finally {
        await page.request.delete(`/api/kernels/${kernel}`);
        await page.request.delete(`/api/terminals/${terminal}`);
        await deleteWorkspaces(page, [current]);
      }
    });
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
        // one section at a time: the empty LANGUAGE SERVERS list is opened to be read
        await openSection(page, 'servers');
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

    test('ACC-PANEL-230-DOCKED-BANDS: the three laboratory bands dock at the panel bottom in order, all three stay in view, and the open section body is the only scroll container', async ({
      page
    }) => {
      test.setTimeout(180000);
      const current = fresh('docked');
      const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
      await Promise.all(many.map(id => putWorkspace(page, id)));
      const terminals: string[] = [];
      try {
        for (let i = 0; i < 12; i++) {
          terminals.push(await startTerminal(page));
        }
        // the terminals of other tests are not this test's
        await only(
          page,
          /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
          t => terminals.includes(t.name)
        );
        await onlyWorkspaces(page, id => id.startsWith(current));
        await gotoWorkspace(page, current);
        await openPanel(page);
        await refresh(page);
        await expect(sectionCount(page, 'terminals')).toHaveText('(12)');

        const drawn = () =>
          page
            .locator(`${PANEL} .jp-WorkspaceManager-content`)
            .evaluate(content => {
              const c = content.getBoundingClientRect();
              const list = content.querySelector('.jp-WorkspaceManager-list')!;
              const sections = [...list.children] as HTMLElement[];
              const box = (e: Element) =>
                e
                  .querySelector('.jp-WorkspaceManager-sectionHeader')!
                  .getBoundingClientRect();
              const body = (e: Element) =>
                e.querySelector('.jp-WorkspaceManager-sectionBody');
              const last = box(sections[sections.length - 1]);
              return {
                order: sections.map(s => s.dataset.section),
                lastBottom: Math.round(last.bottom),
                contentBottom: Math.round(c.bottom),
                bands: [1, 2, 3].map(i => {
                  const r = box(sections[i]);
                  return (
                    Math.round(r.top) >= Math.round(c.top) &&
                    Math.round(r.bottom) <= Math.round(c.bottom)
                  );
                }),
                bodies: sections.map(s => (body(s) ? s.dataset.section : null)),
                scrollables: [...content.querySelectorAll('*')]
                  .filter(e =>
                    ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)
                  )
                  .map(e => e.className)
              };
            });

        const open = await drawn();
        expect(open.order).toEqual([
          'workspaces',
          'kernels',
          'terminals',
          'servers'
        ]);
        // nothing renders below the LANGUAGE SERVERS band
        expect(
          Math.abs(open.lastBottom - open.contentBottom)
        ).toBeLessThanOrEqual(1);
        expect(open.bands).toEqual([true, true, true]);
        expect(open.bodies).toEqual(['workspaces', null, null, null]);
        expect(open.scrollables).toEqual(['jp-WorkspaceManager-sectionBody']);
        const filled = await sectionBody(page, 'workspaces').evaluate(n => ({
          client: n.clientHeight,
          scroll: n.scrollHeight
        }));
        expect(filled.client).toBeGreaterThan(10 * 24);
        expect(filled.scroll).toBeGreaterThan(filled.client);

        // KERNELS opened: the three bands stay in view and the kernels body takes the space left
        await sectionHeader(page, 'kernels').click();
        await expect(sectionBody(page, 'workspaces')).toHaveCount(0);
        const kern = await drawn();
        expect(kern.order).toEqual([
          'workspaces',
          'kernels',
          'terminals',
          'servers'
        ]);
        expect(kern.bands).toEqual([true, true, true]);
        expect(
          Math.abs(kern.lastBottom - kern.contentBottom)
        ).toBeLessThanOrEqual(1);
        expect(kern.bodies).toEqual([null, 'kernels', null, null]);
        expect(kern.scrollables).toEqual(['jp-WorkspaceManager-sectionBody']);
        const kernelsHeader = (await sectionHeader(
          page,
          'kernels'
        ).boundingBox())!;
        const kernelsBody = (await sectionBody(page, 'kernels').boundingBox())!;
        const terminalsHeader = (await sectionHeader(
          page,
          'terminals'
        ).boundingBox())!;
        expect(
          Math.abs(kernelsBody.y - (kernelsHeader.y + kernelsHeader.height))
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(kernelsBody.y + kernelsBody.height - terminalsHeader.y)
        ).toBeLessThanOrEqual(1);

        // KERNELS closed again: no section grows, every band stays docked and no body is drawn
        await sectionHeader(page, 'kernels').click();
        await expect(sectionBody(page, 'kernels')).toHaveCount(0);
        const closed = await drawn();
        expect(closed.order).toEqual([
          'workspaces',
          'kernels',
          'terminals',
          'servers'
        ]);
        expect(
          Math.abs(closed.lastBottom - closed.contentBottom)
        ).toBeLessThanOrEqual(1);
        expect(closed.bodies).toEqual([null, null, null, null]);
        expect(closed.scrollables).toEqual([]);
      } finally {
        await Promise.all(
          terminals.map(t => page.request.delete(`/api/terminals/${t}`))
        );
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
      '@stellarshenson/jupyterlab-workspace-manager-extension:plugin'
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

test('ACC-PANEL-192-SECTION-TITLES: each section header is a full-width band on layout colour 2 with no corners and no shadow, 4 px above and below; caret, a 600 uppercase size 0 label at 18 px in colour 1, the count in colour 2 6 px after it; hover layout colour 3', async ({
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
    const caret = header.locator('.jp-WorkspaceManager-caret');
    await expect(caret).toHaveText(
      (await header.getAttribute('aria-expanded')) === 'true' ? '▾' : '▸'
    );
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
      band: [layout2, 'none', '0px', '4px', '4px'],
      fullWidth: true,
      label: ['600', 'uppercase', '1px', size0, colour1],
      // the band starts at the panel edge, so the label is 18 px from both (DQ-26)
      labelInset: 18,
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

/** Open the section `name`, or with no name close them all: a click on the open band closes every section (DQ-04). */
async function showSection(page: Page, name?: string): Promise<void> {
  if (name) {
    await openSection(page, name);
  } else {
    const open = page.locator(
      `${PANEL} .jp-WorkspaceManager-section.jp-mod-open > .jp-WorkspaceManager-sectionHeader`
    );
    if (await open.count()) {
      await open.click();
    }
  }
  await expect(
    page.locator(`${PANEL} .jp-WorkspaceManager-section.jp-mod-open`)
  ).toHaveCount(name ? 1 : 0);
}

const WITHIN = 0.5;

test('ACC-PANEL-192-SECTION-TITLES, DEF-PANEL-70-BAND-SPAN: each of the four bands has the left and the right of the title band and of the panel, with each section open and with all closed, at the default width and at 300 px', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  for (const width of [await panelWidth(page), 300]) {
    if (width !== (await panelWidth(page))) {
      await sidebarTo(page, width);
    }
    for (const open of [...SECTIONS.map(([name]) => name), undefined]) {
      await showSection(page, open);
      const drawn = await page.locator(PANEL).evaluate(panel => {
        const edges = (e: Element) => {
          const r = e.getBoundingClientRect();
          return [r.left, r.right];
        };
        return {
          panel: edges(panel),
          title: edges(panel.querySelector('.jp-WorkspaceManager-header')!),
          bands: Array.from(
            panel.querySelectorAll('.jp-WorkspaceManager-sectionHeader')
          ).map(edges)
        };
      });
      const state = `${width} px, ${open ?? 'all closed'} open`;
      [0, 1].forEach(side => {
        expect
          .soft(
            Math.abs(drawn.title[side] - drawn.panel[side]),
            `${state}: title band to panel, side ${side}`
          )
          .toBeLessThanOrEqual(WITHIN);
        drawn.bands.forEach((band, i) => {
          expect
            .soft(
              Math.abs(band[side] - drawn.title[side]),
              `${state}: ${SECTIONS[i][0]} band to title band, side ${side}`
            )
            .toBeLessThanOrEqual(WITHIN);
        });
      });
    }
  }
});

test('ACC-PANEL-192-SECTION-TITLES, DEF-PANEL-70-BAND-SPAN: the title label and the section labels share one left x, each 18 px from the left of its own band', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  const lefts = await page.locator(PANEL).evaluate(panel => {
    const left = (e: Element) => e.getBoundingClientRect().left;
    const title = panel.querySelector('.jp-WorkspaceManager-header')!;
    return {
      title: [
        left(title),
        left(title.querySelector('.jp-WorkspaceManager-titleLabel')!)
      ],
      sections: Array.from(
        panel.querySelectorAll('.jp-WorkspaceManager-sectionHeader')
      ).map(h => [
        left(h),
        left(h.querySelector('.jp-WorkspaceManager-sectionLabel')!)
      ])
    };
  });
  expect
    .soft(
      Math.abs(lefts.title[1] - lefts.title[0] - 18),
      'title label to the title band'
    )
    .toBeLessThanOrEqual(WITHIN);
  lefts.sections.forEach(([band, label], i) => {
    expect
      .soft(
        Math.abs(label - lefts.title[1]),
        `${SECTIONS[i][0]} label to the title label`
      )
      .toBeLessThanOrEqual(WITHIN);
    expect
      .soft(Math.abs(label - band - 18), `${SECTIONS[i][0]} label to its band`)
      .toBeLessThanOrEqual(WITHIN);
  });
});

test('ACC-PANEL-237-SECTION-DIVIDER: the WORKSPACES section has a top border of the width and colour of every section bottom border, with each section open, with all closed and with the filter field showing; flush neighbours touch; LANGUAGE SERVERS ends at the panel bottom', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  const line = [
    'solid',
    '1px',
    await token(page, 'borderTopColor', 'var(--jp-border-color3)')
  ];
  for (const filtering of [false, true]) {
    if (filtering) {
      await headerButton(page, 'Filter').click();
      await expect(
        page.locator(`${PANEL} .jp-WorkspaceManager-filter`)
      ).toBeVisible();
    }
    for (const open of [...SECTIONS.map(([name]) => name), undefined]) {
      await showSection(page, open);
      const drawn = await page.locator(PANEL).evaluate(panel => {
        const rule = (s: CSSStyleDeclaration, side: 'Top' | 'Bottom') => [
          s[`border${side}Style`],
          s[`border${side}Width`],
          s[`border${side}Color`]
        ];
        return {
          panelBottom: panel.getBoundingClientRect().bottom,
          titleBottom: panel
            .querySelector('.jp-WorkspaceManager-header')!
            .getBoundingClientRect().bottom,
          filterBottom: panel
            .querySelector('.jp-WorkspaceManager-filter')
            ?.getBoundingClientRect().bottom,
          sections: Array.from(
            panel.querySelectorAll<HTMLElement>('.jp-WorkspaceManager-section')
          ).map(section => {
            const s = getComputedStyle(section);
            const r = section.getBoundingClientRect();
            return {
              name: section.dataset.section,
              top: r.top,
              bottom: r.bottom,
              bandTop: section
                .querySelector('.jp-WorkspaceManager-sectionHeader')!
                .getBoundingClientRect().top,
              topRule: rule(s, 'Top'),
              bottomRule: rule(s, 'Bottom')
            };
          })
        };
      });
      const state = `${open ?? 'all closed'} open, filter ${filtering}`;
      const [workspaces] = drawn.sections;
      expect.soft(workspaces.topRule, `${state}: WORKSPACES top`).toEqual(line);
      for (const section of drawn.sections) {
        expect
          .soft(section.bottomRule, `${state}: ${section.name} bottom`)
          .toEqual(line);
      }
      // the line is the only thing between what stands above the WORKSPACES band and the band
      expect
        .soft(
          Math.abs(workspaces.bandTop - workspaces.top - parseFloat(line[1])),
          `${state}: the line directly above the WORKSPACES band`
        )
        .toBeLessThanOrEqual(WITHIN);
      if (filtering) {
        expect
          .soft(
            workspaces.top,
            `${state}: the line below the filter field, not above it`
          )
          .toBeGreaterThanOrEqual(drawn.filterBottom!);
      } else {
        expect
          .soft(
            Math.abs(workspaces.top - drawn.titleBottom),
            `${state}: the line directly below the title band`
          )
          .toBeLessThanOrEqual(WITHIN);
      }
      // one line between neighbours: the upper one's bottom border and no top border on the lower one
      drawn.sections.slice(1).forEach((section, i) => {
        expect
          .soft(section.topRule[1], `${state}: ${section.name} top`)
          .toBe('0px');
        // all closed, KERNELS alone stands apart: its margin docks the lab bands at the bottom
        if (open || section.name !== 'kernels') {
          expect
            .soft(
              Math.abs(section.top - drawn.sections[i].bottom),
              `${state}: ${drawn.sections[i].name} to ${section.name}`
            )
            .toBeLessThanOrEqual(WITHIN);
        }
      });
      expect
        .soft(
          Math.abs(
            drawn.sections[drawn.sections.length - 1].bottom - drawn.panelBottom
          ),
          `${state}: LANGUAGE SERVERS to the panel bottom`
        )
        .toBeLessThanOrEqual(WITHIN);
    }
  }
  await headerButton(page, 'Filter').click();
  await expect(
    page.locator(`${PANEL} .jp-WorkspaceManager-filter`)
  ).toHaveCount(0);

  // the title band draws its own --jp-border-color2 line above the new one, and a line in the
  // colour of the band beside it does not show: one of the two shows in each theme
  await showSection(page, 'workspaces');
  for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
    await page.theme.setTheme(theme);
    await page.mouse.move(0, 0);
    const shown = await page.locator(PANEL).evaluate(panel => {
      const title = getComputedStyle(
        panel.querySelector('.jp-WorkspaceManager-header')!
      );
      const section = panel.querySelector('.jp-WorkspaceManager-section')!;
      const band = getComputedStyle(
        section.querySelector('.jp-WorkspaceManager-sectionHeader')!
      );
      const top = getComputedStyle(section);
      return [
        title.borderBottomColor !== title.backgroundColor &&
          title.borderBottomWidth !== '0px',
        top.borderTopColor !== band.backgroundColor &&
          top.borderTopWidth !== '0px'
      ].filter(Boolean).length;
    });
    expect.soft(shown, `${theme}: visible lines above the band`).toBe(1);
  }
});

test.describe('a focus ring at the panel edge', () => {
  test.use({ mockState: false });

  test('ACC-PANEL-93-FOCUS: keyboard focus on the first and the last band, a card header, a card row and a section row draws a 1 px ring whose whole rectangle lies inside the panel and inside every ancestor that clips it', async ({
    page
  }) => {
    const current = fresh('ring');
    const other = `${current}-other`;
    const terminal = await startTerminal(page);
    await putWorkspace(page, other, layout(['editor:one.md']));
    try {
      await onlyWorkspaces(page, id => id.startsWith(current));
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);
      await openCard(page, other);

      const ring = async (name: string, target: Locator) => {
        // a keyboard focus: focus it, step back and Tab forward again
        await target.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(target, name).toBeFocused();
        const drawn = await target.evaluate((n, selector) => {
          const s = getComputedStyle(n);
          const grow = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
          const r = n.getBoundingClientRect();
          const inside = (left: number, top: number, w: number, h: number) =>
            r.left - grow >= left - 0.01 &&
            r.top - grow >= top - 0.01 &&
            r.right + grow <= left + w + 0.01 &&
            r.bottom + grow <= top + h + 0.01;
          const panel = document.querySelector(selector)!;
          const p = panel.getBoundingClientRect();
          // a clipping ancestor shows its padding box, without a scrollbar's gutter
          const clips: string[] = [];
          for (let a = n.parentElement!; a !== panel; a = a.parentElement!) {
            const o = getComputedStyle(a);
            const b = a.getBoundingClientRect();
            if (
              (o.overflowX !== 'visible' || o.overflowY !== 'visible') &&
              !inside(
                b.left + a.clientLeft,
                b.top + a.clientTop,
                a.clientWidth,
                a.clientHeight
              )
            ) {
              clips.push(a.className);
            }
          }
          return {
            ring: [s.outlineStyle, s.outlineWidth, s.outlineOffset],
            insidePanel: inside(p.left, p.top, p.width, p.height),
            clips
          };
        }, PANEL);
        expect.soft(drawn, name).toEqual({
          ring: ['solid', '1px', '-1px'],
          insidePanel: true,
          clips: []
        });
      };

      await ring('first band', sectionHeader(page, 'workspaces'));
      await ring('last band', sectionHeader(page, 'servers'));
      await ring('card header', cardHeader(page, other));
      await ring(
        'card row',
        card(page, other).locator('.jp-WorkspaceManager-row').first()
      );
      await openSection(page, 'terminals');
      await ring(
        'section row',
        sectionBody(page, 'terminals')
          .locator('.jp-WorkspaceManager-row')
          .first()
      );
    } finally {
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, other]);
    }
  });
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
