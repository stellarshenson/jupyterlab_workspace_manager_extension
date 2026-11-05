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
  newTerminalTab,
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
  rowLabel,
  rowOf,
  sectionBody,
  sectionCount,
  sectionHeader,
  startTerminal,
  triangle,
  UNDER_LOAD
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
  /** the panel title, a section label, a section count or the section caret glyph */
  heading: boolean;
  /** an empty-state line */
  empty: boolean;
  /** the text sits in a coloured card */
  coloured: boolean;
  /** a time, on a row or in a card header, a hidden card's word, or a row's status word or detail value */
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
        heading: !!el.closest(
          '.jp-WorkspaceManager-title, .jp-WorkspaceManager-sectionLabel, .jp-WorkspaceManager-sectionCount, .jp-WorkspaceManager-sectionHeader .jp-WorkspaceManager-caret'
        ),
        empty: !!el.closest('.jp-WorkspaceManager-empty'),
        coloured: !!el.closest('.jp-WorkspaceManager-card.jp-mod-coloured'),
        meta: !!el.closest(
          '.jp-WorkspaceManager-age, .jp-WorkspaceManager-hiddenWord, .jp-WorkspaceManager-row .jp-WorkspaceManager-state, .jp-WorkspaceManager-rowDetail, .jp-WorkspaceManager-rowPath'
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

/** The WCAG contrast of two colours as the page draws them. */
function contrast(a: number[], b: number[]): number {
  const luminance = (colour: number[]) => {
    const [r, g, b] = colour.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A colour drawn over an opaque surface: the channels the browser paints, 0-255. */
function drawn(ink: number[], surface: number[]): number[] {
  const alpha = (ink[3] ?? 255) / 255;
  return [0, 1, 2].map(i =>
    Math.round(alpha * ink[i] + (1 - alpha) * surface[i])
  );
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
  // one section open at a time: the cards render with WORKSPACES open, the TERMINALS rows with TERMINALS open
  await openSection(page, 'workspaces');
  for (const id of [ids.current, ids.coloured[0]]) {
    await openCard(page, id);
    await page.mouse.move(0, 0);
    found.push(...(await texts(page)));
  }
  await openSection(page, 'terminals');
  found.push(...(await texts(page)));
  return found;
}

test('ACC-PANEL-202-TEXT-COLOURS: in Galaxa Steel dark and JupyterLab Light the root, a section label and a row name are colour 1; a row detail, a note, the section count, the carets and the empty lines are colour 2; a coloured card keeps its name and row text at inverse layout colour 0, its purpose and counts at inverse layout colour 1 and its header age at inverse layout colour 2; no text is colour 3', async ({
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
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      const [colour1, colour2, colour3, inverse0, inverse1, inverse2] = [
        await rgba(page, 'var(--jp-ui-font-color1)'),
        await rgba(page, 'var(--jp-ui-font-color2)'),
        await rgba(page, 'var(--jp-ui-font-color3)'),
        await rgba(page, 'var(--jp-inverse-layout-color0)'),
        await rgba(page, 'var(--jp-inverse-layout-color1)'),
        await rgba(page, 'var(--jp-inverse-layout-color2)')
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

      // the aged card: a coloured card keeps its name at inverse layout colour 0, its purpose and counts at inverse layout colour 1 and its header age at inverse layout colour 2
      await openCard(page, aged);
      const header = cardHeader(page, aged);
      await expect(header.locator('.jp-WorkspaceManager-age')).toHaveText(
        '3h ago'
      );
      const checks: [string, Locator, number[]][] = [
        ['name', header.locator('.jp-WorkspaceManager-name'), inverse0],
        [
          'time',
          header.locator(
            '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
          ),
          inverse2
        ],
        ['purpose', header.locator('.jp-WorkspaceManager-purpose'), inverse1],
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
        ]
      ];
      for (const c of await header
        .locator('.jp-WorkspaceManager-count')
        .all()) {
        checks.push(['count', c, inverse1]);
      }
      // read while the aged card is open; another card may be open beside it (ACC-ACCORD-241-MANY-OPEN)
      const check = async () => {
        for (const [what, l, token] of checks.splice(0)) {
          expect.soft(await colourOf(l), `${theme} ${what}`).toEqual(token);
        }
      };
      await check();
      // the first coloured card's rows sit on its 9.6% tint: a row name inverse layout colour 0, its detail inverse layout colour 1
      await openCard(page, ids.coloured[0]);
      const body = card(page, ids.coloured[0]);
      const tab = body.locator('.jp-WorkspaceManager-row').first();
      await tab.focus();
      checks.push(
        ['row name', tab.locator('.jp-WorkspaceManager-rowLabel'), inverse0],
        ['detail', tab.locator('.jp-WorkspaceManager-rowDetail'), inverse1]
      );
      await check();
      // the design system's hover pair paints a hovered glyph colour 1: measure with the pointer off the triangle openCard clicked
      await page.mouse.move(0, 0);
      // the carets: the section's text glyph takes colour 2, and a coloured card's SVG fill inverse layout colour 0 (DQ-07, ACC-PANEL-239)
      const carets: [Locator, string, number[]][] = [
        [
          sectionHeader(page, 'workspaces').locator(
            '.jp-WorkspaceManager-caret'
          ),
          'color',
          colour2
        ],
        [
          triangle(page, ids.coloured[0]).locator('.jp-icon3[fill]'),
          'fill',
          inverse0
        ]
      ];
      for (const [caret, property, expected] of carets) {
        expect
          .soft(await colourOf(caret.first(), property), `${theme} caret`)
          .toEqual(expected);
      }
      // the empty line: KERNELS holds no item, opened as the one open section
      await openSection(page, 'kernels');
      const emptyLine = page
        .locator(`${PANEL} .jp-WorkspaceManager-empty`)
        .first();
      expect
        .soft(await colourOf(emptyLine), `${theme} empty line`)
        .toEqual(colour2);
      // a terminal row: its name is colour 1 and its time colour 2, whether or not it is recent (DQ-21)
      await openSection(page, 'terminals');
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
      // WORKSPACES opens again for the next theme's card checks
      await openSection(page, 'workspaces');
    }
  } finally {
    await ids.cleanup();
  }
});

test('ACC-PANEL-202-TEXT-COLOURS: in Galaxa Steel dark and JupyterLab Light the path of a real terminal in a lemon card takes the inverse layout colour 1 ink and reaches 4.5:1 on the surface of its row', async ({
  page
}) => {
  test.setTimeout(150000);
  const terminal = await startTerminal(page);
  const current = fresh('pathink');
  const lemon = `${current}-lemon`;
  await putWorkspace(page, lemon, layout([`terminal:${terminal}`]));
  await patchMeta(page, lemon, { colour: 'lemon' });
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    await openCard(page, lemon);
    const path = card(page, lemon).locator('.jp-WorkspaceManager-rowPath');
    await expect(path).toHaveCount(1, UNDER_LOAD);
    await page.mouse.move(0, 0);
    const computed = async (l: Locator, property: string) =>
      rgba(
        page,
        await l.evaluate((n, p) => (getComputedStyle(n) as any)[p], property)
      );
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      const ink = await computed(path, 'color');
      expect(ink, `${theme} path`).toEqual(
        await rgba(page, 'var(--jp-inverse-layout-color1)')
      );
      // the row at rest is transparent over the card, which paints the hue at 9.6 %
      const surface = await computed(card(page, lemon), 'backgroundColor');
      expect(surface[3], `${theme} surface`).toBe(255);
      expect(
        contrast(ink, surface),
        `${theme} ${ink} on ${surface}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, lemon]);
  }
});

test('ACC-PANEL-274-TIME-DIM: in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel a coloured card header age takes --jp-inverse-layout-color2, a body row age --jp-inverse-layout-color3, a hovered and a selected coloured row age --jp-inverse-layout-color2 and a plain section row age --jp-ui-font-color2, each card ink at least 4.5:1 on its surface', async ({
  page
}) => {
  test.setTimeout(240000);
  const ids = await populate(page);
  let terminal: string | undefined;
  const colourOf = async (l: Locator, property = 'color') =>
    rgba(
      page,
      await l.evaluate((n, p) => (getComputedStyle(n) as any)[p], property)
    );
  try {
    // a terminal tab of this window: its row is this card's current row
    terminal = await newTerminalTab(page);
    await refresh(page);
    await openSection(page, 'workspaces');
    await openCard(page, ids.coloured[0]);
    await page.mouse.move(0, 0);
    for (const theme of [LIGHT, 'JupyterLab Dark', DARK]) {
      await page.theme.setTheme(theme);
      const [inverse2, inverse3, colour2] = [
        await rgba(page, 'var(--jp-inverse-layout-color2)'),
        await rgba(page, 'var(--jp-inverse-layout-color3)'),
        await rgba(page, 'var(--jp-ui-font-color2)')
      ];
      const cardEl = card(page, ids.coloured[0]);
      const header = cardHeader(page, ids.coloured[0]);
      const headerAge = header.locator(
        '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
      );
      await expect(headerAge).toHaveCount(1);
      // the 24 % header tint
      expect(await colourOf(headerAge), `${theme} header`).toEqual(inverse2);
      const headerSurface = await colourOf(header, 'backgroundColor');
      expect(headerSurface[3], `${theme} header surface`).toBe(255);
      expect(
        contrast(
          drawn(await colourOf(headerAge), headerSurface),
          headerSurface
        ),
        `${theme} header`
      ).toBeGreaterThanOrEqual(4.5);

      // the 9.6 % body tint, at rest
      await page.mouse.move(0, 0);
      const body = cardEl
        .locator('.jp-WorkspaceManager-cardBody .jp-WorkspaceManager-row')
        .filter({ has: page.locator('.jp-WorkspaceManager-age') })
        .first();
      const bodyAge = body.locator('.jp-WorkspaceManager-age');
      await expect(bodyAge).toHaveCount(1);
      expect(await colourOf(bodyAge), `${theme} body`).toEqual(inverse3);
      const bodySurface = await colourOf(cardEl, 'backgroundColor');
      expect(bodySurface[3], `${theme} body surface`).toBe(255);
      expect(
        contrast(drawn(await colourOf(bodyAge), bodySurface), bodySurface),
        `${theme} body`
      ).toBeGreaterThanOrEqual(4.5);

      // the hovered surface: the hue at 9.6 % over layout colour 2
      await body.hover();
      expect(await colourOf(bodyAge), `${theme} hovered`).toEqual(inverse2);
      const hoverSurface = await colourOf(body, 'backgroundColor');
      expect(hoverSurface[3], `${theme} hovered surface`).toBe(255);
      expect(
        contrast(drawn(await colourOf(bodyAge), hoverSurface), hoverSurface),
        `${theme} hovered`
      ).toBeGreaterThanOrEqual(4.5);

      // the selected surface, the same mix, with the pointer away
      await body.focus();
      await page.mouse.move(0, 0);
      await expect(body).toHaveClass(/jp-mod-selected/);
      expect(await colourOf(bodyAge), `${theme} selected`).toEqual(inverse2);
      const selectedSurface = await colourOf(body, 'backgroundColor');
      expect(selectedSurface[3], `${theme} selected surface`).toBe(255);
      expect(
        contrast(
          drawn(await colourOf(bodyAge), selectedSurface),
          selectedSurface
        ),
        `${theme} selected`
      ).toBeGreaterThanOrEqual(4.5);
      // release the selection before the card closes, so the next theme reads a row at rest
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
      );
      await expect(body).not.toHaveClass(/jp-mod-selected/);

      // a plain section row keeps the theme's own meta ink
      await openSection(page, 'terminals');
      await page.mouse.move(0, 0);
      const plain = page
        .locator(`${PANEL} [data-section="terminals"] .jp-WorkspaceManager-row`)
        .first();
      const plainAge = plain.locator('.jp-WorkspaceManager-age');
      await expect(plainAge).toHaveCount(1);
      expect(await colourOf(plainAge), `${theme} plain`).toEqual(colour2);
      const plainSurface = await colourOf(
        page.locator(PANEL),
        'backgroundColor'
      );
      const plainContrast = contrast(
        drawn(await colourOf(plainAge), plainSurface),
        plainSurface
      );
      // the 4.5 floor is the card ink's; Steel's own --jp-ui-font-color2 measures 3.25:1 on layout colour 1, a theme value this change does not touch
      expect(plainContrast, `${theme} plain`).toBeGreaterThanOrEqual(
        theme === DARK ? 3.2 : 4.5
      );
      // the next theme reads the card again
      await openSection(page, 'workspaces');
      await openCard(page, ids.coloured[0]);
    }

    // this window's card is coloured too: its current row at rest stands on the 24 % hue tint
    await openSection(page, 'workspaces');
    await openCard(page, ids.current);
    const currentRow = rowOf(card(page, ids.current), rowLabel(terminal));
    await expect(currentRow).toBeVisible();
    await expect(currentRow).toHaveClass(/jp-mod-current/);
    await expect(currentRow).not.toHaveClass(/jp-mod-selected/);
    const currentAge = currentRow.locator('.jp-WorkspaceManager-age');
    await expect(currentAge).toHaveCount(1);
    for (const theme of [LIGHT, 'JupyterLab Dark', DARK]) {
      await page.theme.setTheme(theme);
      await page.mouse.move(0, 0);
      expect(await colourOf(currentAge), `${theme} current`).toEqual(
        await rgba(page, 'var(--jp-inverse-layout-color2)')
      );
      const currentSurface = await colourOf(currentRow, 'backgroundColor');
      expect(currentSurface[3], `${theme} current surface`).toBe(255);
      expect(
        contrast(
          drawn(await colourOf(currentAge), currentSurface),
          currentSurface
        ),
        `${theme} current`
      ).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    if (terminal) {
      await page.request.delete(`/api/terminals/${terminal}`);
    }
    await ids.cleanup();
  }
});

test('ACC-TERM-271-NAME-SIZE: in JupyterLab Light and Galaxa Dark Theme - Steel a terminal row name, in a card and in TERMINALS, has the font size of a document row label and --jp-ui-font-size1, colour 2 in TERMINALS and inverse layout colour 1 in a coloured card', async ({
  page
}) => {
  test.setTimeout(150000);
  const terminal = await startTerminal(page);
  const current = fresh('namesize');
  const lemon = `${current}-lemon`;
  const keys = [`terminal:${terminal}`, 'editor:docs/notes.md'];
  await putWorkspace(page, lemon, layout(keys));
  await patchMeta(page, lemon, { colour: 'lemon' });
  const process = '.jp-WorkspaceManager-rowProcess';
  const label = '.jp-WorkspaceManager-rowLabel';
  const size = (l: Locator) =>
    l.evaluate(n => parseFloat(getComputedStyle(n).fontSize));
  const ink = (l: Locator) => l.evaluate(n => getComputedStyle(n).color);
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    await openCard(page, lemon);
    const size1 = await fontSize(page, '--jp-ui-font-size1');
    for (const theme of [LIGHT, DARK]) {
      await page.theme.setTheme(theme);
      const name = rowOf(card(page, lemon), rowLabel(terminal));
      await expect(name).toBeVisible();
      const nameSize = await size(name.locator(process));
      // the terminal name at the document label's size, which is size 1
      expect(nameSize, theme).toBe(size1);
      expect(nameSize, `${theme} label`).toBe(
        await size(rowOf(card(page, lemon), 'notes.md').locator(label))
      );
      expect(
        await rgba(page, await ink(name.locator(process))),
        `${theme} card ink`
      ).toEqual(await rgba(page, 'var(--jp-inverse-layout-color1)'));
    }
    // TERMINALS: the same name at the same size, in the section's colour 2
    await openSection(page, 'terminals');
    const listed = rowOf(sectionBody(page, 'terminals'), rowLabel(terminal));
    await expect(listed).toBeVisible();
    for (const theme of [LIGHT, DARK]) {
      await page.theme.setTheme(theme);
      expect(await size(listed.locator(process)), theme).toBe(size1);
      expect(
        await rgba(page, await ink(listed.locator(process))),
        `${theme} section ink`
      ).toEqual(await rgba(page, 'var(--jp-ui-font-color2)'));
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, lemon]);
  }
});

test('ACC-PANEL-74-TEXT-SIZE, ACC-PANEL-75-NO-ITALIC: the title, the section labels and counts, the empty states, the time on a row and in a card header and the status word and detail values of a row at font size 0, every other text at size 1 or more; the empty-state lines are italic, colour 2 in a section and inverse layout colour 1 in a coloured card, no other text is italic', async ({
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
      await openSection(page, 'workspaces');
      await openCard(page, ids.coloured[2]);
      found.push(...(await shown()));
      await page
        .locator(`${PANEL} .jp-WorkspaceManager-filterInput`)
        .fill('zzzz');
      found.push(...(await shown()));
      await page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`).fill('');
      // one section open at a time: the empty KERNELS and LANGUAGE SERVERS sections are opened to be read
      await openSection(page, 'kernels');
      found.push(...(await shown()));
      await openSection(page, 'servers');
      found.push(...(await shown()));
      const small = found.filter(t => t.heading || t.empty || t.meta);
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
          .filter(t => !t.heading && !t.empty && !t.meta && t.size < size1)
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
      const [colour2, inverse1] = [
        await rgba(page, 'var(--jp-ui-font-color2)'),
        await rgba(page, 'var(--jp-inverse-layout-color1)')
      ];
      for (const t of empty) {
        expect.soft(t.style, `${theme} ${t.text}`).toBe('italic');
        expect
          .soft(await rgba(page, t.colour), `${theme} ${t.text}`)
          .toEqual(t.coloured ? inverse1 : colour2);
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

test('ACC-PANEL-168-COUNT-BRACKETS, ACC-ACCORD-276-NAME-COUNT: the WORKSPACES count reads (4); a card name carries its row count in brackets and takes inverse layout colour 1', async ({
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
    // the caret glyph, the label and the count, as the page draws them
    const glyph = (
      (await header.locator('.jp-WorkspaceManager-caret').textContent()) ?? ''
    ).trim();
    expect(await header.evaluate(n => (n as HTMLElement).innerText)).toMatch(
      new RegExp(`^${glyph}\\s*WORKSPACES\\s*\\(4\\)$`)
    );
    await openCard(page, others[0]);
    // the terminal row and the document row
    await expect(
      cardHeader(page, others[0]).locator('.jp-WorkspaceManager-count')
    ).toHaveText('(2)');
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, ...others]);
  }
});
