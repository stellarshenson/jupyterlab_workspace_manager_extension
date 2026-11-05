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
  rowLabel,
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
      rowOf(sectionBody(page, 'terminals'), rowLabel(first))
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
        rowOf(sectionBody(page, 'terminals'), rowLabel(second))
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

      await cardHeader(page, three[0]).click({ button: 'right' });
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
        expect(drawn, name).toEqual(['auto', '0px', 'auto', 'sticky', '0px']);
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

    test('ACC-PANEL-227-FLUSH-WIDTH: a workspace card keeps its 2 px edge inset (EDGE-TAB), and a KERNELS, TERMINALS and LANGUAGE SERVERS row spans its section body to both edges', async ({
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
          // the edge tab sits 2 px from the body's edges (EDGE-TAB); a tally row reaches them
          const inset = name === 'workspaces' ? 2 : 1;
          expect(Math.abs(drawn.left), name).toBeLessThanOrEqual(inset);
          expect(Math.abs(drawn.right), name).toBeLessThanOrEqual(inset);
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

    test('ACC-PANEL-230-DOCKED-BANDS: the three laboratory bands stand at the panel bottom only while WORKSPACES is open; while it is folded they follow it from the top; an open TERMINALS section is as tall as its rows, and past the panel height every band stays in view with its body the only scroll container', async ({
      page
    }) => {
      test.setTimeout(180000);
      const current = fresh('docked');
      await putWorkspace(page, current);
      const terminals: string[] = [];
      let listed = 2;
      try {
        for (let i = 0; i < 12; i++) {
          terminals.push(await startTerminal(page));
        }
        // the terminals of other tests are not this test's
        await only(
          page,
          /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
          t => terminals.slice(0, listed).includes(t.name)
        );
        await onlyWorkspaces(page, id => id === current);
        await gotoWorkspace(page, current);
        await openPanel(page);
        await refresh(page);
        await expect(card(page, current)).toBeVisible();
        await expect(sectionCount(page, 'workspaces')).toHaveText('(1)');
        await expect(sectionCount(page, 'terminals')).toHaveText('(2)');

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
              return {
                order: sections.map(s => s.dataset.section),
                // each band's top against the bottom of the section above it, its divider included
                gaps: sections
                  .slice(1)
                  .map((s, i) =>
                    Math.round(
                      Math.abs(
                        box(s).top - sections[i].getBoundingClientRect().bottom
                      )
                    )
                  ),
                // the height below the LANGUAGE SERVERS band
                free: Math.round(
                  c.bottom - box(sections[sections.length - 1]).bottom
                ),
                bands: sections.map(s => {
                  const r = box(s);
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

        // WORKSPACES open with one card: it grows, and nothing renders below the LANGUAGE SERVERS band
        const open = await drawn();
        expect(open.order).toEqual([
          'workspaces',
          'kernels',
          'terminals',
          'servers'
        ]);
        expect(open.bodies).toEqual(['workspaces', null, null, null]);
        expect(open.gaps).toEqual([0, 0, 0]);
        expect(open.free).toBeLessThanOrEqual(1);
        expect(open.bands).toEqual([true, true, true, true]);
        expect(open.scrollables).toEqual(['jp-WorkspaceManager-sectionBody']);

        // all four folded: each band follows the one above it and the free height stands below the last
        await sectionHeader(page, 'workspaces').click();
        await expect(sectionBody(page, 'workspaces')).toHaveCount(0);
        const folded = await drawn();
        expect(folded.bodies).toEqual([null, null, null, null]);
        expect(folded.gaps).toEqual([0, 0, 0]);
        expect(folded.free).toBeGreaterThan(24);
        expect(folded.scrollables).toEqual([]);

        // TERMINALS open with few rows: the band below it follows its last row and the free height stands below that band
        await sectionHeader(page, 'terminals').click();
        const body = sectionBody(page, 'terminals');
        await expect(rowOf(body, rowLabel(terminals[1]))).toBeVisible();
        const few = await drawn();
        expect(few.bodies).toEqual([null, null, 'terminals', null]);
        expect(few.gaps).toEqual([0, 0, 0]);
        expect(few.free).toBeGreaterThan(24);
        expect(few.scrollables).toEqual(['jp-WorkspaceManager-sectionBody']);

        // TERMINALS open with more rows than fit: the section shrinks and only its body scrolls
        listed = terminals.length;
        await refresh(page);
        await expect(sectionCount(page, 'terminals')).toHaveText('(12)');
        await page.setViewportSize({ width: 1280, height: 400 });
        await expect
          .poll(
            () => body.evaluate(n => n.scrollHeight > n.clientHeight),
            UNDER_LOAD
          )
          .toBe(true);
        const full = await drawn();
        expect(full.bodies).toEqual([null, null, 'terminals', null]);
        expect(full.bands).toEqual([true, true, true, true]);
        expect(full.scrollables).toEqual(['jp-WorkspaceManager-sectionBody']);
      } finally {
        await Promise.all(
          terminals.map(t => page.request.delete(`/api/terminals/${t}`))
        );
        await deleteWorkspaces(page, [current]);
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

test('ACC-PANEL-201-HEADER-BAND: the panel header is the standard 37 px band on layout colour 2; WORKBENCH is 600, uppercase, 1 px tracking, size 0, colour 1, on one line, on the x of the section labels', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  expect(await panelWidth(page)).toBe(250);
  const header = page.locator(`${PANEL} .jp-WorkspaceManager-header`);
  const box = (await header.boundingBox())!;
  expect(box.height).toBeCloseTo(37, 1);
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

test('DEF-PANEL-84-HEADER-HEIGHT: in JupyterLab Light and Galaxa Dark Theme - Steel the WORKBENCH header stands as tall as a standard .jp-SidePanel-header laid out by the live stylesheet, 37 px', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  for (const theme of ['JupyterLab Light', 'Galaxa Dark Theme - Steel']) {
    await page.theme.setTheme(theme);
    const [workbench, standard] = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(
        '.jp-WorkspaceManager-header'
      )!;
      // the standard header as JupyterLab lays it out: 2 px padding, a default 32 px toolbar and the 1 px border
      const probe = document.createElement('div');
      probe.className = 'jp-SidePanel-header';
      const toolbar = document.createElement('div');
      toolbar.className = 'jp-SidePanel-toolbar';
      probe.appendChild(toolbar);
      header.parentElement!.appendChild(probe);
      const heights: [number, number] = [
        header.offsetHeight,
        probe.offsetHeight
      ];
      probe.remove();
      return heights;
    });
    expect(workbench, theme).toBe(37);
    expect(workbench, theme).toBe(standard);
  }
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

test("ACC-PANEL-262-CARET-SIZE: each section band's triangle has the computed font size and weight of its label, weight 600, open and closed; a workspace card's caret does not read 600", async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  for (const open of [...SECTIONS.map(([name]) => name), undefined]) {
    await showSection(page, open);
    for (const [name] of SECTIONS) {
      const drawn = await sectionHeader(page, name).evaluate(band =>
        ['.jp-WorkspaceManager-caret', '.jp-WorkspaceManager-sectionLabel'].map(
          selector => {
            const s = getComputedStyle(band.querySelector(selector)!);
            return [s.fontSize, s.fontWeight];
          }
        )
      );
      const state = `${name}, ${open ?? 'all closed'} open`;
      expect.soft(drawn[0], state).toEqual(drawn[1]);
      expect.soft(drawn[0][1], state).toBe('600');
    }
  }
  await showSection(page, 'workspaces');
  expect(
    await cardHeader(page, 'default')
      .locator('.jp-WorkspaceManager-caret')
      .evaluate(n => getComputedStyle(n).fontWeight)
  ).not.toBe('600');
});

test('ACC-PANEL-237-SECTION-DIVIDER: a folded section with a section below it draws one 1 px --jp-layout-color3 bottom line, and an open section and the last section draw none; the WORKSPACES top line stands under the title band and gives way to the filter field; the band starts 1 px below a drawn top line and at the section top without one; all four sections touch; LANGUAGE SERVERS ends at the panel bottom with WORKSPACES open and never below it; in Light, Dark and Steel the title band line is 1 px solid --jp-border-color2', async ({
  page
}) => {
  await page.goto();
  await openPanel(page);
  await expect(card(page, 'default')).toBeVisible();
  const line = [
    'solid',
    '1px',
    await token(page, 'borderTopColor', 'var(--jp-layout-color3)')
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
              open: section.classList.contains('jp-mod-open'),
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
      // the line under the title band only while the band meets the band below it directly
      if (filtering) {
        expect
          .soft(workspaces.topRule.slice(0, 2), `${state}: WORKSPACES top`)
          .toEqual(['none', '0px']);
      } else {
        expect
          .soft(workspaces.topRule, `${state}: WORKSPACES top`)
          .toEqual(line);
      }
      // the line under a folded section that has a section below it, and none under an open
      // section or the last one, because the fills already differ there
      drawn.sections.forEach((section, i) => {
        if (!section.open && i < drawn.sections.length - 1) {
          expect
            .soft(section.bottomRule, `${state}: ${section.name} bottom`)
            .toEqual(line);
        } else {
          expect
            .soft(
              section.bottomRule.slice(0, 2),
              `${state}: ${section.name} bottom`
            )
            .toEqual(['none', '0px']);
        }
      });
      // the band starts 1 px below a drawn top line and at the section top without one
      expect
        .soft(
          Math.abs(
            workspaces.bandTop -
              workspaces.top -
              (filtering ? 0 : parseFloat(line[1]))
          ),
          `${state}: the band below the line above it`
        )
        .toBeLessThanOrEqual(WITHIN);
      if (filtering) {
        expect
          .soft(
            workspaces.top,
            `${state}: the band below the filter field, not above it`
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
      // the sections still touch, with no gap or line beyond the drawn one between them
      drawn.sections.slice(1).forEach((section, i) => {
        expect
          .soft(section.topRule[1], `${state}: ${section.name} top`)
          .toBe('0px');
        expect
          .soft(
            Math.abs(section.top - drawn.sections[i].bottom),
            `${state}: ${drawn.sections[i].name} to ${section.name}`
          )
          .toBeLessThanOrEqual(WITHIN);
      });
      // the lab bands stand at the panel bottom only while WORKSPACES is open (DQ-33)
      const below =
        drawn.panelBottom - drawn.sections[drawn.sections.length - 1].bottom;
      expect
        .soft(
          open === 'workspaces' ? Math.abs(below) : -below,
          `${state}: LANGUAGE SERVERS to the panel bottom`
        )
        .toBeLessThanOrEqual(WITHIN);
    }
  }
  await headerButton(page, 'Filter').click();
  await expect(
    page.locator(`${PANEL} .jp-WorkspaceManager-filter`)
  ).toHaveCount(0);

  // the title band keeps its --jp-border-color2 rule and the WORKSPACES band takes the
  // --jp-layout-color3 line; both rules paint, and each colour is the token resolved in that theme
  await showSection(page, 'workspaces');
  for (const theme of [
    'JupyterLab Light',
    'JupyterLab Dark',
    'Galaxa Dark Theme - Steel'
  ]) {
    await page.theme.setTheme(theme);
    await page.mouse.move(0, 0);
    const [titleLine, topLine] = [
      await token(page, 'borderBottomColor', 'var(--jp-border-color2)'),
      await token(page, 'borderTopColor', 'var(--jp-layout-color3)')
    ];
    const painted = await page.locator(PANEL).evaluate(panel => {
      const rule = (s: CSSStyleDeclaration, side: 'Top' | 'Bottom') => [
        s[`border${side}Style`],
        s[`border${side}Width`],
        s[`border${side}Color`]
      ];
      return {
        title: rule(
          getComputedStyle(panel.querySelector('.jp-WorkspaceManager-header')!),
          'Bottom'
        ),
        section: rule(
          getComputedStyle(
            panel.querySelector('.jp-WorkspaceManager-section')!
          ),
          'Top'
        )
      };
    });
    expect
      .soft(painted.title, `${theme}: the title band line`)
      .toEqual(['solid', '1px', titleLine]);
    expect
      .soft(painted.section, `${theme}: the WORKSPACES top line`)
      .toEqual(['solid', '1px', topLine]);
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
