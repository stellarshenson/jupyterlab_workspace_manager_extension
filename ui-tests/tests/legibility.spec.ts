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

test("ACC-PANEL-202-TEXT-COLOURS: in Galaxa Steel dark and JupyterLab Light the root, a section label and a row name are colour 1; a row detail, a note, the section count, the carets and the empty lines are colour 2; a coloured card keeps its row text at inverse layout colour 0, and another window's dimmed card takes its name and caret at inverse layout colour 2 and its purpose, counts and header age at inverse layout colour 3 (ACC-PANEL-298-DIM-OTHERS); no text is colour 3", async ({
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
      const [
        colour1,
        colour2,
        colour3,
        inverse0,
        inverse1,
        inverse2,
        inverse3
      ] = [
        await rgba(page, 'var(--jp-ui-font-color1)'),
        await rgba(page, 'var(--jp-ui-font-color2)'),
        await rgba(page, 'var(--jp-ui-font-color3)'),
        await rgba(page, 'var(--jp-inverse-layout-color0)'),
        await rgba(page, 'var(--jp-inverse-layout-color1)'),
        await rgba(page, 'var(--jp-inverse-layout-color2)'),
        await rgba(page, 'var(--jp-inverse-layout-color3)')
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

      // the aged card, another window's: a dimmed coloured card takes its name at inverse layout colour 2, its purpose, counts and header age at inverse layout colour 3 (ACC-PANEL-298-DIM-OTHERS)
      await openCard(page, aged);
      const header = cardHeader(page, aged);
      await expect(header.locator('.jp-WorkspaceManager-age')).toHaveText(
        '3h ago'
      );
      const checks: [string, Locator, number[]][] = [
        ['name', header.locator('.jp-WorkspaceManager-name'), inverse2],
        [
          'time',
          header.locator(
            '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
          ),
          inverse3
        ],
        ['purpose', header.locator('.jp-WorkspaceManager-purpose'), inverse3],
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
        checks.push(['count', c, inverse3]);
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
      // the carets: the section's text glyph takes colour 2, and a dimmed coloured card's SVG fill inverse layout colour 2 (DQ-07, ACC-PANEL-239, ACC-PANEL-298-DIM-OTHERS)
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
          inverse2
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

test('ACC-PANEL-274-TIME-DIM: in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel a dimmed coloured card header age takes --jp-inverse-layout-color3 (ACC-PANEL-298-DIM-OTHERS), a body row age --jp-inverse-layout-color3, a hovered and a selected coloured row age --jp-inverse-layout-color2 and a plain section row age --jp-ui-font-color2, each card ink at least 4.5:1 on its surface', async ({
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
      // another window's card: the dimmed 12 % header tint (ACC-PANEL-298-DIM-OTHERS)
      expect(await colourOf(headerAge), `${theme} header`).toEqual(inverse3);
      const headerSurface = await colourOf(header, 'backgroundColor');
      expect(headerSurface[3], `${theme} header surface`).toBe(255);
      expect(
        contrast(
          drawn(await colourOf(headerAge), headerSurface),
          headerSurface
        ),
        `${theme} header`
      ).toBeGreaterThanOrEqual(4.5);

      // the dimmed 4.8 % body tint, at rest
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

test('ACC-PANEL-168-COUNT-BRACKETS, ACC-ACCORD-276-NAME-COUNT: the WORKSPACES count reads (4); a card name carries its row count in brackets', async ({
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

const THEMES = [LIGHT, 'JupyterLab Dark', DARK];

/**
 * A probe card carrying `classes`, built in the panel with a header and two
 * body rows, the second selected, measured and removed: the computed surface
 * of the header, the body and the selected row, and the computed ink of every
 * text and glyph, as the stylesheet paints a card with those classes.
 */
function probeCard(
  page: Page,
  classes: string
): Promise<Record<string, string>> {
  return page.locator(PANEL).evaluate((panel, classes) => {
    const el = (tag: string, cls: string, parent: Element, text = '') => {
      const e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      parent.appendChild(e);
      return e;
    };
    // an SVG glyph as LabIcon draws one: a jp-icon3 path with a fill attribute
    const glyph = (parent: Element) => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('class', 'jp-icon3');
      path.setAttribute('fill', '#616161');
      svg.appendChild(path);
      parent.appendChild(svg);
      return path;
    };
    const card = el('div', classes, panel);
    const header = el('div', 'jp-WorkspaceManager-cardHeader', card);
    const line = el('div', 'jp-WorkspaceManager-headerLine', header);
    const caret = glyph(
      el(
        'button',
        'jp-WorkspaceManager-iconButton jp-WorkspaceManager-caret',
        line
      )
    );
    const name = el('span', 'jp-WorkspaceManager-name', line, 'name');
    const count = el('span', 'jp-WorkspaceManager-count', line, '(2)');
    const word = el('span', 'jp-WorkspaceManager-hiddenWord', line, 'hidden');
    const time = el('span', 'jp-WorkspaceManager-age', line, '3h ago');
    const eye = glyph(
      el(
        'button',
        'jp-WorkspaceManager-iconButton',
        el('span', 'jp-WorkspaceManager-cardActions', line)
      )
    );
    const second = el('div', 'jp-WorkspaceManager-headerLine', header);
    const purpose = el(
      'span',
      'jp-WorkspaceManager-purpose',
      second,
      'purpose'
    );
    const counts = el('span', 'jp-WorkspaceManager-counts', second, '(1 of 2)');
    const body = el('div', 'jp-WorkspaceManager-cardBody', card);
    const row = (cls: string) => {
      const r = el('div', cls, body);
      return {
        row: r,
        label: el('span', 'jp-WorkspaceManager-rowLabel', r, 'label'),
        process: el('span', 'jp-WorkspaceManager-rowProcess', r, 'claude'),
        time: el('span', 'jp-WorkspaceManager-age', r, 'now'),
        detail: el('div', 'jp-WorkspaceManager-rowDetail', r, 'detail')
      };
    };
    const rest = row('jp-WorkspaceManager-row');
    const selected = row('jp-WorkspaceManager-row jp-mod-selected');
    const css = (e: Element, p = 'color'): string =>
      (getComputedStyle(e) as any)[p];
    const measured: Record<string, string> = {
      'header surface': css(header, 'backgroundColor'),
      'body surface': css(card, 'backgroundColor'),
      'selected surface': css(selected.row, 'backgroundColor'),
      'header name': css(name),
      'header caret': css(caret, 'fill'),
      'header count': css(count),
      'header shown-of-total': css(counts),
      'header purpose': css(purpose),
      'header hidden word': css(word),
      'header time': css(time),
      'header eye': css(eye, 'fill')
    };
    for (const [prefix, r] of [
      ['row', rest],
      ['selected row', selected]
    ] as const) {
      measured[`${prefix} label`] = css(r.label);
      measured[`${prefix} process`] = css(r.process);
      measured[`${prefix} time`] = css(r.time);
      measured[`${prefix} detail`] = css(r.detail);
    }
    card.remove();
    return measured;
  }, classes);
}

/** The surface a probed text stands on. */
const surfaceOf = (part: string) =>
  part.startsWith('header')
    ? 'header surface'
    : part.startsWith('selected')
      ? 'selected surface'
      : 'body surface';

test("ACC-PANEL-298-DIM-OTHERS: in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel this window's coloured card keeps its 24 % header, 9.6 % body, inks and outline, while another coloured card takes the 12 % header, the 4.8 % body, --jp-inverse-layout-color2 on its name and caret and --jp-inverse-layout-color3 on its count, purpose and time; its eye and rows keep their inks and its --wm-shade keeps the 24 % tint", async ({
  page
}) => {
  test.setTimeout(240000);
  const current = fresh('dim');
  const other = `${current}-lemon`;
  const terminal = await startTerminal(page);
  await putWorkspace(
    page,
    other,
    layout([`terminal:${terminal}`, 'editor:docs/notes.md'])
  );
  await patchMeta(page, other, {
    colour: 'lemon',
    purpose: 'Purpose of the dimmed card'
  });
  await putWorkspace(page, current);
  await patchMeta(page, current, {
    colour: 'sky',
    purpose: 'Purpose of this window'
  });
  const computed = async (l: Locator, property = 'color') =>
    rgba(
      page,
      await l.evaluate((n, p) => (getComputedStyle(n) as any)[p], property)
    );
  const shots = process.env.WM_SHOTS_DIR;
  try {
    await onlyWorkspaces(page, id => id.startsWith(current));
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    await openCard(page, current);
    await openCard(page, other);
    await expect(
      rowOf(card(page, other), 'notes.md').locator(
        '.jp-WorkspaceManager-rowLabel'
      )
    ).toBeVisible();
    const termRow = card(page, other).locator(
      `.jp-WorkspaceManager-row[data-row-key="terminal:${terminal}"]`
    );
    await expect(termRow.locator('.jp-WorkspaceManager-age')).toHaveCount(1);
    for (const theme of THEMES) {
      await page.theme.setTheme(theme);
      await page.mouse.move(0, 0);
      const inverse = [
        await rgba(page, 'var(--jp-inverse-layout-color0)'),
        await rgba(page, 'var(--jp-inverse-layout-color1)'),
        await rgba(page, 'var(--jp-inverse-layout-color2)'),
        await rgba(page, 'var(--jp-inverse-layout-color3)')
      ];
      const tint = (colour: string, percent: number) =>
        rgba(
          page,
          `color-mix(in srgb, var(--wm-${colour}) ${percent}%, var(--jp-layout-color1))`
        );
      const cards = [
        // this window's card: today's look (ACC-PANEL-278-TINT-ALPHA, ACC-PANEL-202-TEXT-COLOURS), its count in the dimmed count ink (ACC-ACCORD-299-COUNT-INK)
        {
          id: current,
          colour: 'sky',
          header: 24,
          body: 9.6,
          name: inverse[0],
          meta: inverse[2],
          purpose: inverse[1]
        },
        // another window's card: dimmed
        {
          id: other,
          colour: 'lemon',
          header: 12,
          body: 4.8,
          name: inverse[2],
          meta: inverse[3],
          purpose: inverse[3]
        }
      ];
      for (const c of cards) {
        const what = `${theme} ${c.id === current ? 'current' : 'other'}`;
        const head = cardHeader(page, c.id);
        expect(
          await computed(head, 'backgroundColor'),
          `${what} header`
        ).toEqual(await tint(c.colour, c.header));
        expect(
          await computed(card(page, c.id), 'backgroundColor'),
          `${what} body`
        ).toEqual(await tint(c.colour, c.body));
        expect
          .soft(
            await computed(head.locator('.jp-WorkspaceManager-name')),
            `${what} name`
          )
          .toEqual(c.name);
        expect
          .soft(
            await computed(
              triangle(page, c.id).locator('.jp-icon3[fill]').first(),
              'fill'
            ),
            `${what} caret`
          )
          .toEqual(c.name);
        expect
          .soft(
            await computed(head.locator('.jp-WorkspaceManager-count')),
            `${what} count`
          )
          .toEqual(c.meta);
        expect
          .soft(
            await computed(
              head.locator(
                '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
              )
            ),
            `${what} time`
          )
          .toEqual(c.meta);
        expect
          .soft(
            await computed(head.locator('.jp-WorkspaceManager-purpose')),
            `${what} purpose`
          )
          .toEqual(c.purpose);
        // the eye keeps inverse layout colour 0 on both
        expect
          .soft(
            await computed(
              head
                .locator(
                  ".jp-WorkspaceManager-cardActions [class*='jp-icon'][fill]"
                )
                .first(),
              'fill'
            ),
            `${what} eye`
          )
          .toEqual(inverse[0]);
      }
      // this window's card keeps its 2 px outline; the dimmed card has none
      const outline = await card(page, current).evaluate(n => {
        const s = getComputedStyle(n);
        return [s.outlineStyle, s.outlineWidth, s.outlineColor];
      });
      expect(outline.slice(0, 2), `${theme} outline`).toEqual(['solid', '2px']);
      expect(await rgba(page, outline[2])).toEqual(
        await rgba(page, 'var(--jp-brand-color2)')
      );
      expect(
        await card(page, other).evaluate(n => getComputedStyle(n).outlineStyle)
      ).toBe('none');
      // the dimmed card's rows keep their inks: label inverse 0, process inverse 1, time inverse 3
      expect
        .soft(
          await computed(
            rowOf(card(page, other), 'notes.md').locator(
              '.jp-WorkspaceManager-rowLabel'
            )
          ),
          `${theme} row label`
        )
        .toEqual(inverse[0]);
      expect
        .soft(
          await computed(termRow.locator('.jp-WorkspaceManager-rowProcess')),
          `${theme} row process`
        )
        .toEqual(inverse[1]);
      expect
        .soft(
          await computed(termRow.locator('.jp-WorkspaceManager-age')),
          `${theme} row time`
        )
        .toEqual(inverse[3]);
      // --wm-shade keeps the 24 % tint the terminal badge and the swatches read (ACC-TERM-290-BADGE-TINT)
      const shade = await card(page, other).evaluate(n =>
        getComputedStyle(n).getPropertyValue('--wm-shade').trim()
      );
      expect(await rgba(page, shade), `${theme} --wm-shade`).toEqual(
        await tint('lemon', 24)
      );
      if (shots) {
        await page.locator(`${PANEL} [data-section="workspaces"]`).screenshot({
          path: `${shots}/dim-cards-${theme.replace(/\W+/g, '-').toLowerCase()}.png`
        });
      }
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, other]);
  }
});

test("ACC-PANEL-298-DIM-OTHERS: in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel probe cards of the six colours, not this window's, take the 12 % header and 4.8 % body and the dimmed inks, and keep every header text and the row label, process, time and detail at 4.5:1 or more on the body and on the selected row, the glyphs and the focus ring at 3:1; a plain non-current card's name takes --jp-ui-font-color2", async ({
  page
}) => {
  test.setTimeout(180000);
  const current = fresh('dimprobe');
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    for (const theme of THEMES) {
      await page.theme.setTheme(theme);
      const token = (name: string) => rgba(page, `var(${name})`);
      const inverse = [
        await token('--jp-inverse-layout-color0'),
        await token('--jp-inverse-layout-color1'),
        await token('--jp-inverse-layout-color2'),
        await token('--jp-inverse-layout-color3')
      ];
      const ink: Record<string, number[]> = {
        'header name': inverse[2],
        'header caret': inverse[2],
        'header count': inverse[3],
        'header shown-of-total': inverse[3],
        'header purpose': inverse[3],
        'header hidden word': inverse[3],
        'header time': inverse[3],
        'header eye': inverse[0],
        'row label': inverse[0],
        'row process': inverse[1],
        'row time': inverse[3],
        'row detail': inverse[1],
        'selected row label': inverse[0],
        'selected row process': inverse[1],
        'selected row time': inverse[2],
        'selected row detail': inverse[1]
      };
      const glyphs = ['header caret', 'header eye'];
      for (const colour of COLOURS) {
        const probe = await probeCard(
          page,
          `jp-WorkspaceManager-card jp-mod-coloured jp-mod-${colour}`
        );
        const mix = (percent: number, base: number) =>
          rgba(
            page,
            `color-mix(in srgb, var(--wm-${colour}) ${percent}%, var(--jp-layout-color${base}))`
          );
        const surface: Record<string, number[]> = {
          'header surface': await rgba(page, probe['header surface']),
          'body surface': await rgba(page, probe['body surface']),
          'selected surface': await rgba(page, probe['selected surface'])
        };
        expect(surface['header surface'], `${theme} ${colour} header`).toEqual(
          await mix(12, 1)
        );
        expect(surface['body surface'], `${theme} ${colour} body`).toEqual(
          await mix(4.8, 1)
        );
        // the hovered and the selected row keep the hue at 9.6 % over layout colour 2
        expect(
          surface['selected surface'],
          `${theme} ${colour} selected`
        ).toEqual(await mix(9.6, 2));
        for (const [part, expected] of Object.entries(ink)) {
          const colourOfPart = await rgba(page, probe[part]);
          expect
            .soft(colourOfPart, `${theme} ${colour} ${part}`)
            .toEqual(expected);
          const on = surface[surfaceOf(part)];
          const ratio = contrast(drawn(colourOfPart, on), on);
          console.log(
            `CONTRAST ${theme} ${colour} ${part} ${ratio.toFixed(2)}:1`
          );
          expect
            .soft(ratio, `${theme} ${colour} ${part}`)
            .toBeGreaterThanOrEqual(glyphs.includes(part) ? 3 : 4.5);
        }
        // the focus ring of the header keeps inverse layout colour 0 (ACC-PANEL-93-FOCUS)
        const ring = contrast(inverse[0], surface['header surface']);
        console.log(
          `CONTRAST ${theme} ${colour} header focus ring ${ring.toFixed(2)}:1`
        );
        expect.soft(ring, `${theme} ${colour} ring`).toBeGreaterThanOrEqual(3);
      }
      // a plain card that is not this window's: its name takes the meta ink of its caret and count
      const plain = await probeCard(page, 'jp-WorkspaceManager-card');
      const colour2 = await token('--jp-ui-font-color2');
      const plainSurface = await rgba(page, plain['header surface']);
      for (const part of [
        'header name',
        'header caret',
        'header count',
        'header time'
      ]) {
        const colourOfPart = await rgba(page, plain[part]);
        expect.soft(colourOfPart, `${theme} plain ${part}`).toEqual(colour2);
        console.log(
          `CONTRAST ${theme} plain ${part} ${contrast(drawn(colourOfPart, plainSurface), plainSurface).toFixed(2)}:1`
        );
      }
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("ACC-ACCORD-299-COUNT-INK: in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel the card count (N) and the filter's (N of M) take --jp-inverse-layout-color2 on this window's coloured card, --jp-inverse-layout-color3 on another coloured card and --jp-ui-font-color2 on a plain card; the WORKSPACES band count keeps --jp-ui-font-color2", async ({
  page
}) => {
  test.setTimeout(150000);
  const current = fresh('countink');
  const other = `${current}-mint`;
  await putWorkspace(page, other, layout(['editor:docs/notes.md']));
  await patchMeta(page, other, { colour: 'mint' });
  await putWorkspace(page, current);
  await patchMeta(page, current, { colour: 'peach' });
  const computed = async (l: Locator) =>
    rgba(page, await l.evaluate(n => getComputedStyle(n).color));
  try {
    await onlyWorkspaces(page, id => id.startsWith(current));
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    // a filter matching both names: each card opens with its (N of M)
    await headerButton(page, 'Filter').click();
    await page
      .locator(`${PANEL} .jp-WorkspaceManager-filterInput`)
      .fill(current);
    for (const id of [current, other]) {
      await expect(
        cardHeader(page, id).locator('.jp-WorkspaceManager-counts')
      ).toBeVisible();
    }
    await page.mouse.move(0, 0);
    for (const theme of THEMES) {
      await page.theme.setTheme(theme);
      const [inverse2, inverse3, colour2] = [
        await rgba(page, 'var(--jp-inverse-layout-color2)'),
        await rgba(page, 'var(--jp-inverse-layout-color3)'),
        await rgba(page, 'var(--jp-ui-font-color2)')
      ];
      for (const [id, ink] of [
        [current, inverse2],
        [other, inverse3]
      ] as const) {
        for (const part of [
          '.jp-WorkspaceManager-count',
          '.jp-WorkspaceManager-counts'
        ]) {
          expect
            .soft(
              await computed(cardHeader(page, id).locator(part)),
              `${theme} ${id === current ? 'current' : 'other'} ${part}`
            )
            .toEqual(ink);
        }
      }
      const plain = await probeCard(page, 'jp-WorkspaceManager-card');
      for (const part of ['header count', 'header shown-of-total']) {
        expect
          .soft(await rgba(page, plain[part]), `${theme} plain ${part}`)
          .toEqual(colour2);
      }
      // this window's card in each of the six colours: the count ink holds 4.5:1 on the 24 % tint
      for (const colour of COLOURS) {
        const mine = await probeCard(
          page,
          `jp-WorkspaceManager-card jp-mod-coloured jp-mod-${colour} jp-mod-current`
        );
        const surface = await rgba(page, mine['header surface']);
        for (const part of ['header count', 'header shown-of-total']) {
          const ink = await rgba(page, mine[part]);
          expect
            .soft(ink, `${theme} ${colour} current ${part}`)
            .toEqual(inverse2);
          const ratio = contrast(drawn(ink, surface), surface);
          console.log(
            `CONTRAST ${theme} ${colour} current ${part} ${ratio.toFixed(2)}:1`
          );
          expect
            .soft(ratio, `${theme} ${colour} current ${part}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
      expect
        .soft(await computed(sectionCount(page, 'workspaces')), `${theme} band`)
        .toEqual(colour2);
    }
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});
