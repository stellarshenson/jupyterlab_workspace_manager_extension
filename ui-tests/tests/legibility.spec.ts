import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  cut,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  layout,
  onlyWorkspaces,
  openCard,
  openPanel,
  openSection,
  PANEL,
  panelWidth,
  patchMeta,
  putWorkspace,
  refresh,
  rgba,
  sectionCount,
  sectionHeader,
  startTerminal,
  triangle
} from './helpers';

test.use({ autoGoto: false, mockState: false });

const COLOURS = ['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender'];
const DARK = 'Galaxa Dark Theme - Steel';
const LIGHT = 'JupyterLab Light';

/** One text of the panel as the browser draws it. */
interface IText {
  text: string;
  /** the computed colour of the text */
  colour: string;
  size: number;
  style: string;
  group: boolean;
  /** the panel title, a section label or a section count */
  heading: boolean;
  /** an empty-state line */
  empty: boolean;
  /** a row's time, status word or detail value */
  meta: boolean;
  /** the class of the element that draws the text */
  where: string;
}

/** Every text of the panel that is drawn: text nodes, and the placeholder of an empty field. */
function texts(page: Page): Promise<IText[]> {
  return page.locator(PANEL).evaluate(panel => {
    const measure = (el: Element, text: string, colour: string): IText => {
      const style = getComputedStyle(el);
      return {
        text,
        colour,
        size: parseFloat(style.fontSize),
        style: style.fontStyle,
        group: !!el.closest('.jp-WorkspaceManager-groupLabel'),
        heading: !!el.closest(
          '.jp-WorkspaceManager-title, .jp-WorkspaceManager-sectionLabel, .jp-WorkspaceManager-sectionCount'
        ),
        empty: !!el.closest('.jp-WorkspaceManager-empty'),
        meta: !!el.closest(
          '.jp-WorkspaceManager-row .jp-WorkspaceManager-age, .jp-WorkspaceManager-row .jp-WorkspaceManager-state, .jp-WorkspaceManager-rowDetail'
        ),
        where: el.getAttribute('class') ?? el.tagName
      };
    };

    const found: IText[] = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const el = node.parentElement!;
      const text = node.textContent!.trim();
      if (text && el.checkVisibility({ visibilityProperty: true })) {
        found.push(measure(el, text, getComputedStyle(el).color));
      }
    }
    for (const field of panel.querySelectorAll('input')) {
      if (!field.value && field.placeholder && field.checkVisibility()) {
        const placeholder = getComputedStyle(field, '::placeholder');
        found.push({
          ...measure(field, field.placeholder, placeholder.color),
          style: placeholder.fontStyle
        });
      }
    }
    return found;
  });
}

/** The size of a JupyterLab font-size variable, in px, as the panel resolves it. */
function fontSize(page: Page, name: string): Promise<number> {
  return page.locator(PANEL).evaluate((panel, name) => {
    const probe = document.createElement('span');
    probe.style.fontSize = `var(${name})`;
    panel.appendChild(probe);
    const size = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return size;
  }, name);
}

/**
 * This window in a workspace of its own; one workspace of each colour with a
 * purpose, the first with a document and a terminal tab; a hidden one; a
 * terminal in no workspace. The filter field is shown, empty.
 */
async function populate(page: IJupyterLabPageFixture) {
  const current = fresh('legible');
  const coloured = COLOURS.map(c => `${current}-${c}`);
  const hidden = `${current}-hidden`;
  const terminals = [await startTerminal(page), await startTerminal(page)];
  await Promise.all(
    coloured.map((id, i) =>
      putWorkspace(
        page,
        id,
        i === 0
          ? {
              'layout-restorer:data': {
                main: {
                  dock: {
                    type: 'tab-area',
                    currentIndex: 0,
                    widgets: [
                      'editor:docs/notes.md',
                      `terminal:${terminals[0]}`
                    ]
                  }
                }
              },
              'editor:docs/notes.md': {
                data: { path: 'docs/notes.md', factory: 'Editor' }
              },
              [`terminal:${terminals[0]}`]: { data: { name: terminals[0] } }
            }
          : {}
      )
    )
  );
  await Promise.all(
    coloured.map((id, i) =>
      patchMeta(page, id, {
        colour: COLOURS[i],
        purpose: `Purpose of the ${COLOURS[i]} workspace`
      })
    )
  );
  await putWorkspace(page, hidden);
  await patchMeta(page, hidden, { hidden: true });
  await gotoWorkspace(page, current);
  await openPanel(page);
  await refresh(page);
  await headerButton(page, 'Filter').click();
  await page.mouse.move(0, 0);
  const cleanup = async () => {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current, hidden, ...coloured]);
  };
  return { current, coloured, cleanup };
}

/** The texts of each card opened in turn: this window's, a coloured one, and the TERMINALS section. */
async function textsOfOpenCards(
  page: Page,
  ids: { current: string; coloured: string[] }
): Promise<IText[]> {
  const found: IText[] = [];
  // every section is open: the cards and the TERMINALS rows render
  await openSection(page, 'workspaces');
  await openSection(page, 'terminals');
  for (const caret of [
    triangle(page, ids.current),
    triangle(page, ids.coloured[0])
  ]) {
    await caret.click();
    await expect(caret).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(0, 0);
    found.push(...(await texts(page)));
  }
  return found;
}

test('ACC-PANEL-202-TEXT-COLOURS: in Galaxa Steel dark and JupyterLab Light the root, a card name, the section and group labels and a row name are colour 1; a purpose, a time, a detail, a note, the counts, the carets and the empty lines are colour 2; no text is colour 3', async ({
  page
}) => {
  test.setTimeout(150000);
  const ids = await populate(page);
  // the server's file times cannot be set back: the list reports the second coloured workspace as three hours old
  const aged = ids.coloured[1];
  await page.route(/\/lab\/api\/workspaces\/?(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const json = await response.json();
    for (const w of json.workspaces.values) {
      if (w.metadata.id === aged) {
        w.metadata.last_modified = new Date(
          Date.now() - 3 * 3600 * 1000
        ).toISOString();
      }
    }
    await route.fulfill({ response, json });
  });
  try {
    await refresh(page);
    await openSection(page, 'workspaces');
    await openSection(page, 'terminals');
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      const [colour1, colour2, colour3] = [
        await rgba(page, 'var(--jp-ui-font-color1)'),
        await rgba(page, 'var(--jp-ui-font-color2)'),
        await rgba(page, 'var(--jp-ui-font-color3)')
      ];
      const colourOf = async (l: Locator, property = 'color') =>
        rgba(
          page,
          await l.evaluate((n, p) => (getComputedStyle(n) as any)[p], property)
        );
      // the panel root is #jp-running-sessions.jp-WorkspaceManager
      expect(await colourOf(page.locator(PANEL)), `${theme} root`).toEqual(
        colour1
      );

      // the aged card: its name colour 1, its time colour 2; open, its purpose colour 2 and its counts colour 2
      await openCard(page, aged);
      const header = cardHeader(page, aged);
      await expect(header.locator('.jp-WorkspaceManager-age')).toHaveText(
        '3h ago'
      );
      const checks: [string, Locator, number[]][] = [
        ['name', header.locator('.jp-WorkspaceManager-name'), colour1],
        [
          'time',
          header.locator(
            '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
          ),
          colour2
        ],
        ['purpose', header.locator('.jp-WorkspaceManager-purpose'), colour2],
        [
          'section label',
          sectionHeader(page, 'workspaces').locator(
            '.jp-WorkspaceManager-sectionLabel'
          ),
          colour1
        ],
        ['section count', sectionCount(page, 'workspaces'), colour2],
        [
          'note',
          page.locator(`${PANEL} .jp-WorkspaceManager-note`).first(),
          colour2
        ],
        [
          'empty line',
          page.locator(`${PANEL} .jp-WorkspaceManager-empty`).first(),
          colour2
        ]
      ];
      for (const c of await header
        .locator('.jp-WorkspaceManager-count')
        .all()) {
        checks.push(['count', c, colour2]);
      }
      // read while the aged card is open: one card is open at a time
      const check = async () => {
        for (const [what, l, token] of checks.splice(0)) {
          expect.soft(await colourOf(l), `${theme} ${what}`).toEqual(token);
        }
      };
      await check();
      // the first coloured card: a group label colour 1, its count colour 2; a row name colour 1, its detail colour 2
      await openCard(page, ids.coloured[0]);
      const body = card(page, ids.coloured[0]);
      const tab = body.locator('.jp-WorkspaceManager-row').first();
      await tab.focus();
      checks.push(
        [
          'group label',
          body.locator('.jp-WorkspaceManager-groupLabel').first(),
          colour1
        ],
        [
          'group count',
          body.locator('.jp-WorkspaceManager-groupLabel > span').first(),
          colour2
        ],
        ['row name', tab.locator('.jp-WorkspaceManager-rowLabel'), colour1],
        ['detail', tab.locator('.jp-WorkspaceManager-rowDetail'), colour2]
      );
      await check();
      // the design system's hover pair paints a hovered glyph colour 1: measure with the pointer off the triangle openCard clicked
      await page.mouse.move(0, 0);
      // the carets, of a section and of a card
      for (const caret of [
        sectionHeader(page, 'workspaces').locator(
          '.jp-WorkspaceManager-caret .jp-icon3[fill]'
        ),
        triangle(page, ids.coloured[0]).locator('.jp-icon3[fill]')
      ]) {
        expect
          .soft(await colourOf(caret.first(), 'fill'), `${theme} caret`)
          .toEqual(colour2);
      }
      // a terminal row: its name is colour 1 and its time colour 2, whether or not it is recent (DQ-21)
      const terminal = page
        .locator(`${PANEL} [data-section="terminals"] .jp-WorkspaceManager-row`)
        .first();
      for (const [part, token] of [
        ['.jp-WorkspaceManager-rowLabel', colour1],
        ['.jp-WorkspaceManager-age', colour2]
      ] as const) {
        expect
          .soft(
            await colourOf(terminal.locator(part)),
            `${theme} terminal ${part}`
          )
          .toEqual(token);
      }
      // no text in colour 3
      const colours = new Set((await texts(page)).map(t => t.colour));
      for (const c of colours) {
        expect.soft(await rgba(page, c), `${theme} ${c}`).not.toEqual(colour3);
      }
    }
  } finally {
    await ids.cleanup();
  }
});

test('ACC-PANEL-74-TEXT-SIZE, ACC-PANEL-75-NO-ITALIC: the title, the section labels and counts, the group labels, the empty states and the row time, status word and detail values at font size 0, every other text at size 1 or more; the empty-state lines are italic and colour 2, no other text is italic', async ({
  page
}) => {
  const ids = await populate(page);
  try {
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      const size0 = await fontSize(page, '--jp-ui-font-size0');
      const size1 = await fontSize(page, '--jp-ui-font-size1');
      expect(size0).toBeLessThan(size1);
      // the empty-state lines shown in each pass, whole
      const lines = new Set<string>();
      const shown = async () => {
        for (const line of await page
          .locator(`${PANEL} .jp-WorkspaceManager-empty`)
          .allTextContents()) {
          lines.add(line);
        }
        return texts(page);
      };
      const found = await textsOfOpenCards(page, ids);
      await shown();
      // an empty workspace's card open, then a filter that matches nothing
      await openCard(page, ids.coloured[2]);
      found.push(...(await shown()));
      await page
        .locator(`${PANEL} .jp-WorkspaceManager-filterInput`)
        .fill('zzzz');
      found.push(...(await shown()));
      await page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`).fill('');
      const small = found.filter(
        t => t.group || t.heading || t.empty || t.meta
      );
      expect(found.filter(t => t.group).length).toBeGreaterThan(0);
      // a row's time, status word and detail values are measured too
      expect(found.filter(t => t.meta).length).toBeGreaterThan(0);
      // WORKBENCH, four section labels and four counts in each pass
      expect(found.filter(t => t.heading).length).toBeGreaterThanOrEqual(9);
      expect(
        small.filter(t => t.size !== size0).map(t => `${t.text}: ${t.size}`),
        theme
      ).toEqual([]);
      expect(
        found
          .filter(
            t => !t.group && !t.heading && !t.empty && !t.meta && t.size < size1
          )
          .map(t => `${t.text}: ${t.size}`),
        theme
      ).toEqual([]);
      // DQ-08: the empty-state lines are italic and colour 2, nothing else is italic
      const empty = found.filter(t => t.empty);
      expect(lines, theme).toEqual(
        new Set([
          'No kernels',
          'No language servers',
          'No tabs, terminals or kernels',
          'Nothing matches'
        ])
      );
      const colour2 = await rgba(page, 'var(--jp-ui-font-color2)');
      for (const t of empty) {
        expect.soft(t.style, `${theme} ${t.text}`).toBe('italic');
        expect
          .soft(await rgba(page, t.colour), `${theme} ${t.text}`)
          .toEqual(colour2);
      }
      expect(
        found.filter(t => !t.empty && t.style === 'italic').map(t => t.text),
        theme
      ).toEqual([]);
    }
  } finally {
    await ids.cleanup();
  }
});

test('ACC-ACCORD-132-NAME-SIZE: a workspace name is set in font size 1 at normal weight', async ({
  page
}) => {
  const current = fresh('name');
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    const size1 = await fontSize(page, '--jp-ui-font-size1');
    const name = card(page, current).locator('.jp-WorkspaceManager-name');
    await expect(name).toHaveText(current);
    const style = await name.evaluate(n => {
      const s = getComputedStyle(n);
      return [parseFloat(s.fontSize), s.fontWeight];
    });
    expect(style).toEqual([size1, '400']);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-94-THEME: a theme change repaints the cards without a reload', async ({
  page
}) => {
  const current = fresh('theme');
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await page.theme.setTheme(LIGHT);
    await page.evaluate(() => ((window as any).notReloaded = true));
    const paint = () =>
      cardHeader(page, current).evaluate(n => [
        getComputedStyle(n).backgroundColor,
        getComputedStyle(n.querySelector('.jp-WorkspaceManager-name')!).color
      ]);
    const light = await paint();

    await page.theme.setTheme('JupyterLab Dark');
    const dark = await paint();
    expect(dark[0]).not.toBe(light[0]);
    expect(dark[1]).not.toBe(light[1]);
    expect(await page.evaluate(() => (window as any).notReloaded)).toBe(true);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-152-NARROW-LABELS: at the 250 px sidebar the title and each of the four section labels with its count show in full', async ({
  page
}) => {
  const current = fresh('narrow');
  // ten cards, so the WORKSPACES count has two digits
  const others = Array.from({ length: 9 }, (_, i) => `${current}-${i}`);
  await Promise.all(others.map(id => putWorkspace(page, id)));
  try {
    await onlyWorkspaces(page, id => id.startsWith(current));
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    expect(await panelWidth(page)).toBe(250);
    const panel = page.locator(PANEL);
    await expect(panel.locator('.jp-WorkspaceManager-titleLabel')).toHaveText(
      'WORKBENCH'
    );
    await expect(sectionCount(page, 'workspaces')).toHaveText('(10)');
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      expect(
        await cut(panel, '.jp-WorkspaceManager-titleLabel'),
        theme
      ).toEqual([]);
    }
    for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
      await expect(
        sectionHeader(page, name).locator(
          '.jp-WorkspaceManager-sectionLabel, .jp-WorkspaceManager-sectionCount'
        )
      ).toHaveCount(2);
      expect(
        await cut(
          sectionHeader(page, name),
          '.jp-WorkspaceManager-sectionLabel, .jp-WorkspaceManager-sectionCount'
        ),
        name
      ).toEqual([]);
    }
  } finally {
    await deleteWorkspaces(page, [current, ...others]);
  }
});

test('ACC-PANEL-181-PURPOSE-WRAP: a purpose wraps onto as many lines as it needs and shows in full, never shortened with an ellipsis', async ({
  page
}) => {
  const current = fresh('purpose');
  // 60 characters: wider than the 250 px card, so it must wrap
  const purpose =
    'A purpose sixty characters long, wrapping onto several lines';
  expect(purpose).toHaveLength(60);
  await putWorkspace(page, current);
  await patchMeta(page, current, { purpose });
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    expect(await panelWidth(page)).toBe(250);
    // DQ-17: the purpose shows while the card is open
    await openCard(page, current);
    const element = card(page, current).locator('.jp-WorkspaceManager-purpose');
    await expect(element).toHaveText(purpose);
    const drawn = await element.evaluate(n => {
      const style = getComputedStyle(n);
      return {
        overflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        clipped: n.scrollWidth > n.clientWidth,
        height: n.getBoundingClientRect().height,
        font: parseFloat(style.fontSize)
      };
    });
    expect(drawn.overflow).not.toBe('ellipsis');
    expect(drawn.whiteSpace).toBe('normal');
    expect(drawn.clipped).toBe(false);
    // more than one line: the card grew with the wrapped purpose
    expect(drawn.height).toBeGreaterThan(drawn.font * 2);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-168-COUNT-BRACKETS: the WORKSPACES count reads (4); the counts beside the header icons stay bare', async ({
  page
}) => {
  const current = fresh('brackets');
  const others = [1, 2, 3].map(i => `${current}-${i}`);
  const terminal = await startTerminal(page);
  await putWorkspace(
    page,
    others[0],
    layout([`terminal:${terminal}`, 'editor:docs/notes.md'])
  );
  await Promise.all(others.slice(1).map(id => putWorkspace(page, id)));
  try {
    await onlyWorkspaces(page, id => id.startsWith(current));
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    const header = sectionHeader(page, 'workspaces');
    await expect(
      header.locator('.jp-WorkspaceManager-sectionLabel')
    ).toHaveText('WORKSPACES');
    await expect(sectionCount(page, 'workspaces')).toHaveText('(4)');
    // the label and the count, as the page draws them
    expect(await header.evaluate(n => (n as HTMLElement).innerText)).toMatch(
      /^WORKSPACES\s*\(4\)$/
    );
    await openCard(page, others[0]);
    await expect(
      cardHeader(page, others[0]).locator('.jp-WorkspaceManager-count')
    ).toHaveText(['1', '1', '0']);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, ...others]);
  }
});
