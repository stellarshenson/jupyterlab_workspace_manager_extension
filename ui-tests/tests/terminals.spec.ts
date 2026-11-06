import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';
import * as path from 'path';

import {
  activeTab,
  card,
  cardHeader,
  commandOf,
  COLOURS,
  countOf,
  cut,
  cwdOf,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  expectRefused,
  fresh,
  fromRowMenu,
  languageServer,
  layout,
  menuItem,
  newTerminalTab,
  openCard,
  openDocument,
  openSection,
  PANEL,
  patchMeta,
  PROCESS_START,
  processOf,
  putNotebook,
  putWorkspace,
  refresh,
  rgba,
  rowLabel,
  rowOf,
  saved,
  savedTabs,
  secondWindow,
  sectionBody,
  sectionHeader,
  sendToTerminal,
  serverList,
  setSetting,
  shows,
  sidebarTo,
  sleepInTerminal,
  startSession,
  startTerminal,
  terminalNames,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

/** The terminal tabs of this window: each id, its session name, and whether its connection ended. */
const terminalTabs = (page: Page) =>
  page.evaluate(() => {
    const tabs: { id: string; name?: string; disposed: boolean }[] = [];
    for (const widget of Array.from<any>(
      (window as any).jupyterapp.shell.widgets('main')
    )) {
      const session = widget.content?.hasClass?.('jp-Terminal')
        ? widget.content.session
        : undefined;
      if (session) {
        tabs.push({
          id: widget.id,
          name: session.name,
          disposed: !!session.isDisposed
        });
      }
    }
    return tabs;
  });

/** The id of this window's active tab. */
const activeId = (page: Page): Promise<string> =>
  page.evaluate(() => (window as any).jupyterapp.shell.currentWidget.id);

/** The terminal tab this window shows. */
const terminalTab = (page: Page): Locator =>
  page.locator('#jp-main-dock-panel .jp-Terminal:visible');

/** Type into this window's terminal tab as a user types. */
async function typeInTerminal(page: Page, text: string): Promise<void> {
  await terminalTab(page).click();
  await page.keyboard.type(text);
}

/** A locator's text after a refresh of the panel: the reload that follows a change. */
const afterRefresh = (page: Page, locator: Locator) => async () => {
  await refresh(page);
  return locator.textContent();
};

/** This window in a new workspace with one terminal tab, its card open; the row of the terminal. */
async function terminalHere(
  page: IJupyterLabPageFixture,
  current: string
): Promise<{ name: string; row: Locator }> {
  await enterWorkspace(page, current);
  const name = await newTerminalTab(page);
  await cardHeader(page, current).click();
  const row = rowOf(card(page, current), rowLabel(name));
  await expect(row).toBeVisible();
  return { name, row };
}

const SELECTED = /jp-mod-selected/;
const LABEL = '.jp-WorkspaceManager-rowLabel';
const PROCESS = '.jp-WorkspaceManager-rowProcess';
const PATH = '.jp-WorkspaceManager-rowPath';
const SLOT = '.jp-WorkspaceManager-rowPathSlot';
const AGE = '.jp-WorkspaceManager-age';
const DETAIL = '.jp-WorkspaceManager-rowDetail';
/** The tab label a program sets in the tests of the tab name: OSC 0 sets the title the tab shows. */
const SET_TITLE = "printf '\\033]0;my tab\\007'\n";

/** The label of this window's current tab. */
const tabTitle = (page: Page): Promise<string> =>
  page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget.title.label
  );

/** The lines of a row's tooltip. */
const tooltip = async (row: Locator): Promise<string[]> =>
  (await row.getAttribute('title'))!.split('\n');

/** The whole text of a terminal row: its label (a card row drops the tN of a numbered terminal, ACC-TERM-275-CARD-LABEL; a TERMINALS row numbers it in a badge, ACC-TERM-285-NUMBER-BADGE), its process and path when one is known and its time. */
const rowText = (name: string, process = '', card = false): RegExp =>
  new RegExp(
    `^${card && /^\d+$/.test(name) ? '' : name}${process}${process && '(/.*)?'}(now|\\d+m ago)$`
  );

/** The whole text of a numbered terminal's row in a card or in TERMINALS: the label is optional. */
const rowTextEither = (name: string, process = ''): RegExp =>
  new RegExp(`^(?:${name})?${process}${process && '(/.*)?'}(now|\\d+m ago)$`);

/** A computed style of an element. */
const css = (l: Locator, property: string): Promise<string> =>
  l.evaluate(
    (n, property) => (getComputedStyle(n) as any)[property] as string,
    property
  );

/** The outline and number ink of a badge held by a workspace of `colour`: the hue at 45 % over inverse layout colour 1 (ACC-TERM-296-BADGE-INK). */
const holderInk = (colour: string): string =>
  `color-mix(in srgb, var(--wm-${colour}) 45%, var(--jp-inverse-layout-color1))`;

/** The name, the process and the time stand side by side on one line, in that order; a card's numbered terminal row has no name (ACC-TERM-302-ICON-GAP). */
const oneLine = (row: Locator): Promise<boolean> =>
  row.evaluate(
    (r, parts) => {
      const boxes = parts
        .map(s => r.querySelector(s))
        .filter((e): e is Element => e !== null)
        .map(e => e.getBoundingClientRect());
      const middle = (b: DOMRect) => b.top + b.height / 2;
      return boxes.every(
        (b, i) =>
          !i ||
          (boxes[i - 1].right <= b.left &&
            Math.abs(middle(b) - middle(boxes[0])) <= 1)
      );
    },
    [LABEL, PROCESS, AGE]
  );

/** Answer GET of the terminals route with each terminal's process replaced by what `process` gives, and its path by what `cwd` gives. */
const processIs = (
  page: Page,
  process: (name: string) => string | null,
  cwd?: () => string | null
) =>
  page.route(
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const response = await route.fetch();
      const json = response.ok()
        ? (await response.json()).map((t: any) => ({
            ...t,
            process: process(t.name),
            cwd: cwd ? cwd() : t.cwd
          }))
        : undefined;
      await route.fulfill({ response, json });
    }
  );

test('ACC-TERM-42-PROCESS, ACC-TERM-46-NAME, ACC-TERM-113-PROCESS-LIVE: a terminal row, in a card and in TERMINALS, shows its short label, the process the server reports and its age with no selection, the process in inverse layout colour 1 at the row text size; selecting the row adds no text; another program shows at the next reload', async ({
  page
}) => {
  // a shell starts and then runs a program, twice over
  test.setTimeout(180000);
  const current = fresh('process');
  try {
    const { name, row } = await terminalHere(page, current);
    await sleepInTerminal(page, name);
    await refresh(page);
    await expect(row).not.toHaveClass(SELECTED);
    const process = row.locator(PROCESS);
    await expect(process).toBeVisible();
    await expect(process).toHaveText((await processOf(page, name))!);
    await expect(row).toHaveText(rowText(name, 'sleep', true));
    expect(await oneLine(row)).toBe(true);
    expect(await shows(row, PROCESS)).toMatchObject({
      inside: true,
      whole: true
    });
    await expect(row.locator(DETAIL)).toHaveCount(0);
    expect(await rgba(page, await css(process, 'color'))).toEqual(
      await rgba(page, 'var(--jp-inverse-layout-color1)')
    );
    // the row text size, which a label inherits; the card row of a numbered terminal has no label (ACC-TERM-302-ICON-GAP)
    expect(await css(process, 'fontSize')).toBe(await css(row, 'fontSize'));

    // selected: the process once, in the line, and no detail line
    await row.focus();
    await expect(row).toHaveClass(SELECTED);
    await expect(row.getByText('sleep', { exact: true })).toHaveCount(1);
    await expect(row).toHaveText(rowText(name, 'sleep', true));
    await expect(row.locator(DETAIL)).toHaveCount(0);
    // the selection stays while the terminal tab has the focus
    await terminalTab(page).click();
    await expect(row).toHaveClass(SELECTED);

    // the TERMINALS section, with no selection and then selected
    await openSection(page, 'terminals');
    const listed = rowOf(sectionBody(page, 'terminals'), rowLabel(name));
    await expect(listed).not.toHaveClass(SELECTED);
    await expect(listed.locator(PROCESS)).toBeVisible();
    await expect(listed).toHaveText(rowText(name, 'sleep'));
    expect(await oneLine(listed)).toBe(true);
    await listed.focus();
    await expect(listed).toHaveClass(SELECTED);
    await expect(listed.getByText('sleep', { exact: true })).toHaveCount(1);
    await expect(listed.locator(DETAIL)).toHaveCount(0);

    // ACC-TERM-113: the program ends and the shell is the process again
    await sendToTerminal(page, name, '\x03');
    await expect
      .poll(() => processOf(page, name), PROCESS_START)
      .not.toBe('sleep');
    const shell = (await processOf(page, name))!;
    await refresh(page);
    await expect(listed).toHaveText(rowText(name, shell));
    await expect(listed).toHaveClass(SELECTED);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-TERM-272-TOOLTIP-NUMBER, ACC-TERM-275-CARD-LABEL, ACC-TERM-285-NUMBER-BADGE: in a card and in TERMINALS the first tooltip line of a numbered terminal reads terminal <n> and of a named one terminal <name>; the card row drops the tN, the TERMINALS row draws the number in a box badge, and a named terminal keeps its name', async ({
  page
}) => {
  const current = fresh('tooltipnum');
  const other = `${current}-other`;
  const created: string[] = [];
  try {
    await enterWorkspace(page, current);
    const numbered = await newTerminalTab(page);
    expect(numbered).toMatch(/^\d+$/);
    created.push(numbered);
    const named = await startTerminal(page);
    created.push(named);
    await refresh(page);
    await cardHeader(page, current).click();
    const inCard = rowOf(card(page, current), rowLabel(numbered));
    await expect(inCard).toBeVisible();
    expect((await tooltip(inCard))[0]).toBe(`terminal ${numbered}`);
    // a card row drops the tN of a numbered terminal (ACC-TERM-275-CARD-LABEL) and renders no label (ACC-TERM-302-ICON-GAP)
    await expect(inCard.locator(LABEL)).toHaveCount(0);
    // the colour of the workspace holding the numbered terminal, from its card
    const colour = await card(page, current).evaluate(
      (n, colours) => colours.find(c => n.classList.contains(`jp-mod-${c}`))!,
      COLOURS
    );

    // the same terminal and the named one in TERMINALS
    await openSection(page, 'terminals');
    const listed = sectionBody(page, 'terminals');
    const numberedRow = rowOf(listed, rowLabel(numbered));
    const namedRow = rowOf(listed, rowLabel(named));
    await expect(numberedRow).toBeVisible();
    await expect(namedRow).toBeVisible();
    // ACC-TERM-285-NUMBER-BADGE: the number in a box badge, read as the number; a badge holding a workspace colour takes that hue at 45 % over --jp-inverse-layout-color1 (ACC-TERM-296-BADGE-INK)
    await expect(numberedRow.locator(LABEL)).toHaveText(numbered);
    const badge = numberedRow.locator(
      `${LABEL} .jp-WorkspaceManager-terminalBadge`
    );
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveClass(new RegExp(`jp-mod-${colour}`));
    await expect(badge).toHaveAttribute('role', 'img');
    await expect(badge).toHaveAttribute('aria-label', numbered);
    const box = await badge.locator('rect').evaluate(n => {
      const svg = n.ownerSVGElement!.getBoundingClientRect();
      const s = getComputedStyle(n);
      return {
        width: svg.width,
        height: svg.height,
        radius: n.getAttribute('rx'),
        stroke: s.stroke,
        strokeWidth: n.getAttribute('stroke-width')
      };
    });
    expect({ ...box, stroke: await rgba(page, box.stroke) }).toEqual({
      // ACC-TERM-290-BADGE-TINT: the smaller box
      width: 18,
      height: 13.5,
      radius: '3',
      // ACC-TERM-285-NUMBER-BADGE, ACC-TERM-296-BADGE-INK: the coloured badge's outline in its holder's ink, resolved from the tokens
      stroke: await rgba(page, holderInk(colour)),
      strokeWidth: '1.2'
    });
    // the number sits centred in its box
    expect(
      await badge.evaluate(n => {
        const svg = n.getBoundingClientRect();
        const text = n.querySelector('text')!.getBoundingClientRect();
        return Math.abs(
          text.left + text.width / 2 - (svg.left + svg.width / 2)
        );
      })
    ).toBeLessThanOrEqual(1);
    expect((await tooltip(numberedRow))[0]).toBe(`terminal ${numbered}`);
    expect((await tooltip(namedRow))[0]).toBe(`terminal ${named}`);

    // a named terminal in another workspace's card: the same first tooltip line as in TERMINALS
    await putWorkspace(page, other, layout([`terminal:${named}`]));
    await refresh(page);
    await openSection(page, 'workspaces');
    await openCard(page, other);
    const namedInCard = rowOf(card(page, other), rowLabel(named));
    await expect(namedInCard).toBeVisible();
    expect((await tooltip(namedInCard))[0]).toBe(`terminal ${named}`);
  } finally {
    await Promise.all(
      created.map(name => page.request.delete(`/api/terminals/${name}`))
    );
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-TERM-290-BADGE-TINT, ACC-TERM-296-BADGE-INK: a numbered terminal in TERMINALS draws its badge 18 x 13.5 px filled with the 24 % wash of the first workspace holding it, its outline and number in that hue at 45 % over inverse layout colour 1, in JupyterLab Light, JupyterLab Dark and Galaxa Dark Theme - Steel; for all six colours the number keeps 4.5:1 on its wash and the outline 3:1 on the section, while an unheld terminal keeps the empty box in the row ink', async ({
  page
}) => {
  test.setTimeout(180000);
  const current = fresh('tint');
  const unheld = String(100000 + Math.floor(Math.random() * 899999));
  const created: string[] = [];
  // WCAG relative luminance of a colour as the page draws it
  const luminance = (colour: number[]) => {
    const [r, g, b] = colour.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  try {
    await enterWorkspace(page, current);
    created.push(await newTerminalTab(page));
    expect(
      (
        await page.request.post('/api/terminals', {
          data: { name: unheld }
        })
      ).ok()
    ).toBe(true);
    created.push(unheld);
    // the held numbered terminal reads as 9 days old, so its row is stale
    await page.route(
      /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
      async route => {
        if (route.request().method() !== 'GET') {
          return route.fallback();
        }
        const response = await route.fetch();
        const json = response.ok()
          ? (await response.json()).map((t: any) =>
              t.name === created[0]
                ? {
                    ...t,
                    last_activity: new Date(
                      Date.now() - 9 * 24 * 3600 * 1000
                    ).toISOString()
                  }
                : t
            )
          : undefined;
        await route.fulfill({ response, json });
      }
    );
    await refresh(page);
    // the colour of this window's workspace, from its card
    const colour = await card(page, current).evaluate(
      (n, colours) => colours.find(c => n.classList.contains(`jp-mod-${c}`))!,
      COLOURS
    );
    await openSection(page, 'terminals');
    const body = sectionBody(page, 'terminals');
    const heldRow = rowOf(body, rowLabel(created[0]));
    const unheldRow = rowOf(body, rowLabel(unheld));
    await expect(heldRow).toBeVisible();
    await expect(unheldRow).toBeVisible();
    // the stale row keeps its badge at full strength: the fade stays on bare labels
    await expect(heldRow).toHaveClass(/jp-mod-stale/, UNDER_LOAD);
    expect(await css(heldRow.locator(LABEL), 'opacity')).toBe('1');
    const badge = heldRow.locator(
      `${LABEL} .jp-WorkspaceManager-terminalBadge`
    );
    const empty = unheldRow.locator(
      `${LABEL} .jp-WorkspaceManager-terminalBadge`
    );
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveClass(/jp-mod-coloured/);
    await expect(badge).toHaveClass(new RegExp(`jp-mod-${colour}`));
    const box = await badge.evaluate(n => {
      const r = n.getBoundingClientRect();
      return [r.width, r.height];
    });
    expect(box[0]).toBeCloseTo(18, 1);
    expect(box[1]).toBeCloseTo(13.5, 1);
    // a terminal in no workspace keeps the empty box
    await expect(empty).toHaveCount(1);
    await expect(empty).not.toHaveClass(/jp-mod-coloured/);
    /** A badge's computed rect fill, rect stroke and number fill. */
    const paint = (svg: Element) => {
      const rect = getComputedStyle(svg.querySelector('rect')!);
      return {
        fill: rect.fill,
        stroke: rect.stroke,
        number: getComputedStyle(svg.querySelector('text')!).fill
      };
    };
    for (const theme of [
      'JupyterLab Light',
      'JupyterLab Dark',
      'Galaxa Dark Theme - Steel'
    ]) {
      await page.theme.setTheme(theme);
      const wash = await rgba(
        page,
        `color-mix(in srgb, var(--wm-${colour}) 24%, var(--jp-layout-color1))`
      );
      // ACC-TERM-296-BADGE-INK: the held badge's outline and number take its holder's ink, from the tokens
      const ink = await rgba(page, holderInk(colour));
      const held = await badge.evaluate(paint);
      const fill = await rgba(page, held.fill);
      expect(fill, theme).toEqual(wash);
      expect(await rgba(page, held.stroke), theme).toEqual(ink);
      const number = await rgba(page, held.number);
      expect(number, theme).toEqual(ink);
      expect(contrast(number, fill), theme).toBeGreaterThanOrEqual(4.5);
      // the unheld badge keeps no fill and the row ink
      const rowInk = await rgba(
        page,
        await css(unheldRow.locator(LABEL), 'color')
      );
      const bare = await empty.evaluate(paint);
      expect(bare.fill, theme).toBe('none');
      expect(await rgba(page, bare.stroke), theme).toEqual(rowInk);
      expect(await rgba(page, bare.number), theme).toEqual(rowInk);
      // the section body's background: the first painted surface under it
      const ground = await rgba(
        page,
        await body.evaluate(n => {
          let e: Element = n;
          while (getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') {
            e = e.parentElement!;
          }
          return getComputedStyle(e).backgroundColor;
        })
      );
      // every colour: a probe badge with the held badge's classes in the TERMINALS body, measured and removed
      for (const c of COLOURS) {
        const probe = await badge.evaluate((n, c) => {
          const svg = n.cloneNode(true) as SVGElement;
          svg.setAttribute(
            'class',
            `jp-WorkspaceManager-terminalBadge jp-mod-${c} jp-mod-coloured`
          );
          n.closest('.jp-WorkspaceManager-sectionBody')!.appendChild(svg);
          const rect = getComputedStyle(svg.querySelector('rect')!);
          const measured = {
            fill: rect.fill,
            stroke: rect.stroke,
            number: getComputedStyle(svg.querySelector('text')!).fill
          };
          svg.remove();
          return measured;
        }, c);
        const tinted = await rgba(page, probe.fill);
        const digits = await rgba(page, probe.number);
        const outline = await rgba(page, probe.stroke);
        expect(digits, `${theme} ${c}`).toEqual(await rgba(page, holderInk(c)));
        expect(outline, `${theme} ${c}`).toEqual(digits);
        const n = contrast(digits, tinted);
        const o = contrast(outline, ground);
        console.log(
          `${theme} ${c} number ${n.toFixed(2)}:1 outline ${o.toFixed(2)}:1`
        );
        expect(n, `${theme} ${c} number`).toBeGreaterThanOrEqual(4.5);
        expect(o, `${theme} ${c} outline`).toBeGreaterThanOrEqual(3);
      }
      // evidence for review; no assertion reads it
      const shots = process.env.WM_SHOTS_DIR;
      if (shots) {
        const name = theme.toLowerCase().replace(/[^a-z]+/g, '-');
        await heldRow.screenshot({
          path: path.join(shots, `badge-ink-held-${name}.png`)
        });
        await unheldRow.screenshot({
          path: path.join(shots, `badge-ink-unheld-${name}.png`)
        });
      }
    }
  } finally {
    await Promise.all(
      created.map(name => page.request.delete(`/api/terminals/${name}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-TERM-291-ATTACH-TOOLTIP: a TERMINALS row states its attachment in a Workspaces line, naming every holder or reading none, and a card row names its own workspace', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('attach');
  const unheld = String(100000 + Math.floor(Math.random() * 899999));
  const created: string[] = [];
  try {
    await enterWorkspace(page, current);
    created.push(await newTerminalTab(page));
    expect(
      (
        await page.request.post('/api/terminals', {
          data: { name: unheld }
        })
      ).ok()
    ).toBe(true);
    created.push(unheld);
    await refresh(page);
    const workspaces = async (row: Locator) =>
      (await tooltip(row)).filter(line => line.startsWith('Workspaces:'));
    // a card row's holders include its own workspace; the card is checked before a
    // section opens, because an open section closes WORKSPACES and its cards
    await openCard(page, current);
    expect(
      await workspaces(rowOf(card(page, current), rowLabel(created[0])))
    ).toEqual([`Workspaces: ${current}`]);
    await openSection(page, 'terminals');
    const body = sectionBody(page, 'terminals');
    expect(await workspaces(rowOf(body, rowLabel(created[0])))).toEqual([
      `Workspaces: ${current}`
    ]);
    expect(await workspaces(rowOf(body, rowLabel(unheld)))).toEqual([
      'Workspaces: none'
    ]);
  } finally {
    await Promise.all(
      created.map(name => page.request.delete(`/api/terminals/${name}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-LISTS-273-CURRENT-ROW: a tab switch moves jp-mod-current from the first tab row to the second, and a hovered or a selected row paints over the current tint', async ({
  page
}) => {
  const current = fresh('rowlight');
  const names: string[] = [];
  try {
    await enterWorkspace(page, current);
    names.push(await newTerminalTab(page), await newTerminalTab(page));
    await refresh(page);
    await cardHeader(page, current).click();
    const cardEl = card(page, current);
    const [first, second] = names.map(n => rowOf(cardEl, rowLabel(n)));
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    // the last terminal tab this window opened is its current tab
    await expect(second).toHaveClass(/jp-mod-current/);
    await expect(second).toHaveAttribute('aria-current', 'true');
    await expect(first).not.toHaveClass(/jp-mod-current/);
    await expect(first).not.toHaveAttribute('aria-current');

    // a tab switch moves the class and the attribute
    await page.evaluate(name => {
      const app = (window as any).jupyterapp;
      const w = Array.from<any>(app.shell.widgets('main')).find(
        (w: any) => w.content?.session?.name === name
      );
      app.shell.activateById(w.id);
    }, names[0]);
    // the 10 s _reload poll re-renders the rows and restores aria-current, so read it once with no retry
    expect(await first.getAttribute('aria-current')).toBe('true');
    expect(await second.getAttribute('aria-current')).toBeNull();
    await expect(first).toHaveClass(/jp-mod-current/);
    await expect(second).not.toHaveClass(/jp-mod-current/);

    // hover and selection paint their own surface over the current tint
    const surface = async (l: Locator) =>
      rgba(page, await css(l, 'backgroundColor'));
    // every listed card takes a rotation colour, so the row is in a coloured card
    const colour = await cardEl.evaluate(
      (n, colours) => colours.find(c => n.classList.contains(`jp-mod-${c}`))!,
      COLOURS
    );
    expect(await surface(first)).toEqual(
      await rgba(
        page,
        `color-mix(in srgb, var(--wm-${colour}) 24%, var(--jp-layout-color1))`
      )
    );
    const hover = await rgba(
      page,
      `color-mix(in srgb, var(--wm-${colour}) 9.6%, var(--jp-layout-color2))`
    );
    await first.hover();
    expect(await surface(first)).toEqual(hover);
    await page.mouse.move(0, 0);
    await first.focus();
    await expect(first).toHaveClass(SELECTED);
    expect(await surface(first)).toEqual(hover);

    // the TERMINALS row of the current terminal takes no current tint: the tint marks the workspace's own row
    await openSection(page, 'terminals');
    const listed = rowOf(sectionBody(page, 'terminals'), rowLabel(names[0]));
    await expect(listed).toHaveClass(/jp-mod-current/);
    await expect(listed).toHaveAttribute('aria-current', 'true');
    expect(await css(listed, 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
  } finally {
    await Promise.all(
      names.map(name => page.request.delete(`/api/terminals/${name}`))
    );
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-TERM-236-PROCESS-NARROW: at a 250 px sidebar the process of a terminal row, in a card and in TERMINALS, is the element cut, with an ellipsis, while the name and the time stay whole on one line; a name too long for the row is cut only once the process has no width left', async ({
  page
}) => {
  const long = 'a-program-whose-name-has-forty-letters-x';
  expect(long).toHaveLength(40);
  await processIs(page, () => long);
  // short enough to stand whole beside the icon and the time at this width
  const short = `t${Math.floor(Math.random() * 46656).toString(36)}`;
  const terminal = (name: string) =>
    page.request.post('/api/terminals', { data: { name } });
  expect((await terminal(short)).ok()).toBe(true);
  const wide = await (
    await terminal(
      `${fresh('wm').replace('-', '')}${'withalongname'.repeat(4)}`
    )
  ).json();
  const current = fresh('narrow');
  const held = `${current}-held`;
  await putWorkspace(
    page,
    held,
    layout([`terminal:${short}`, `terminal:${wide.name}`])
  );
  const check = async (scope: Locator) => {
    const row = rowOf(scope, rowLabel(short));
    await expect(row.locator(PROCESS)).toHaveText(long);
    expect(await cut(row, PROCESS)).toEqual([long]);
    expect(await css(row.locator(PROCESS), 'textOverflow')).toBe('ellipsis');
    expect(await cut(row, LABEL)).toEqual([]);
    expect(await shows(row, AGE)).toMatchObject({ inside: true, whole: true });
    expect((await shows(row, PROCESS)).inside).toBe(true);
    expect(await oneLine(row)).toBe(true);

    const cramped = rowOf(scope, rowLabel(wide.name));
    expect((await shows(cramped, PROCESS)).width).toBe(0);
    expect(await cut(cramped, LABEL)).toEqual([rowLabel(wide.name)]);
    expect(await shows(cramped, AGE)).toMatchObject({
      inside: true,
      whole: true
    });
  };
  try {
    await enterWorkspace(page, current);
    await sidebarTo(page, 250);
    await triangle(page, held).click();
    await check(card(page, held));
    await openSection(page, 'terminals');
    await check(sectionBody(page, 'terminals'));
  } finally {
    await page.request.delete(`/api/terminals/${short}`);
    await page.request.delete(`/api/terminals/${wide.name}`);
    await deleteWorkspaces(page, [current, held]);
  }
});

test('ACC-TERM-44-PROCESS-UNREAD: a terminal row whose process cannot be read, selected or not, in a card and in TERMINALS, shows its name and its time, no process and no placeholder', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  let unread = false;
  await processIs(page, () => (unread ? null : 'known'));
  const current = fresh('unread');
  const held = `${current}-held`;
  await putWorkspace(page, held, layout([`terminal:${terminal}`]));
  const check = async (row: Locator) => {
    await expect(row.locator(PROCESS)).toHaveCount(0);
    await expect(row).toHaveText(rowTextEither(terminal));
    await row.focus();
    await expect(row).toHaveClass(SELECTED);
    await expect(row).toHaveText(rowTextEither(terminal));
    await expect(row.locator(DETAIL)).toHaveCount(0);
  };
  try {
    await enterWorkspace(page, current);
    await triangle(page, held).click();
    const row = rowOf(card(page, held), rowLabel(terminal));
    // the same row shows the process while the server reports one
    await expect(row.locator(PROCESS)).toHaveText('known');
    unread = true;
    await refresh(page);
    await check(row);
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), rowLabel(terminal)));
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, held]);
  }
});

test("ACC-TERM-45-ACTIVITY: a terminal row shows the time since the terminal's last activity", async ({
  page
}) => {
  // the terminal stays idle for a minute
  test.setTimeout(180000);
  const current = fresh('activity');
  try {
    const { name, row } = await terminalHere(page, current);
    const when = row.locator('.jp-WorkspaceManager-age');
    await expect(when).toHaveText('now');
    // the polls move the age on while the terminal is idle
    await expect(when).toHaveText('1m ago', { timeout: 100000 });
    const model = (await serverList(page, '/api/terminals')).find(
      t => t.name === name
    );
    expect(Date.now() - Date.parse(model.last_activity)).toBeGreaterThan(60000);

    await typeInTerminal(page, 'echo active\n');
    await expect.poll(afterRefresh(page, when), UNDER_LOAD).toBe('now');
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-185-ROW-TOOLTIP: the tooltip of a terminal row is its name, the process, its path and when it was last active; a title a program sets takes its own Tab line, and the terminal keeps its own details', async ({
  page
}) => {
  const current = fresh('title');
  const title = fresh('wm-title');
  try {
    const { name, row } = await terminalHere(page, current);
    await expect
      .poll(async () => {
        await refresh(page);
        return (await tooltip(row))[1];
      }, UNDER_LOAD)
      .toBe('Process: bash');
    const age = await row.locator(AGE).textContent();
    const lines = await tooltip(row);
    expect(lines.slice(0, 4)).toEqual([
      `terminal ${name}`,
      'Process: bash',
      `Command: ${await commandOf(page, name)}`,
      `Path: ${await cwdOf(page, name)}`
    ]);
    expect(lines[4]).toMatch(/^Memory: (\d+(\.\d)? (MB|GB)|-)$/);
    expect(lines[5]).toContain(`Last activity: ${age} (`);

    // OSC 2 sets the window title, which the terminal tab shows; the tooltip
    // holds it on its own line and keeps the terminal's own details
    await typeInTerminal(page, `printf '\\033]2;%s\\007' ${title}\n`);
    await expect.poll(() => tabTitle(page), UNDER_LOAD).toBe(title);
    await refresh(page);
    expect((await tooltip(row)).slice(0, 3)).toEqual([
      `terminal ${name}`,
      `Tab: ${title}`,
      'Process: bash'
    ]);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

/** As terminalHere, with the shell moved to `path`, which it creates; the row shows that path. */
async function terminalIn(
  page: IJupyterLabPageFixture,
  current: string,
  path: string
): Promise<{ name: string; row: Locator }> {
  const { name, row } = await terminalHere(page, current);
  await sendToTerminal(page, name, `mkdir -p ${path} && cd ${path}\n`);
  await expect
    .poll(afterRefresh(page, row.locator(`${PATH} bdi`)), PROCESS_START)
    .toBe(path);
  return { name, row };
}

test('ACC-TERM-253-PATH-TOOLTIP, ACC-TERM-279-TOOLTIP-MEMORY: the tooltip of a terminal row, in a card and in TERMINALS, is its name, the process, the command, the path on its own line, the memory, the time and the workspaces', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('pathtip');
  const path = `/tmp/${fresh('wm-tip')}`;
  try {
    const { name, row } = await terminalIn(page, current, path);
    const process = await processOf(page, name);
    const command = await commandOf(page, name);
    const check = async (r: Locator) => {
      const age = await r.locator(AGE).textContent();
      const lines = await tooltip(r);
      expect(lines.slice(0, 4)).toEqual([
        `terminal ${name}`,
        `Process: ${process}`,
        `Command: ${command}`,
        `Path: ${path}`
      ]);
      // the route supplies the foreground process's resident bytes (ACC-TERM-279-TOOLTIP-MEMORY)
      expect(lines[4]).toMatch(/^Memory: (\d+(\.\d)? (MB|GB)|-)$/);
      expect(lines[5]).toContain(`Last activity: ${age} (`);
      expect(lines.slice(6)).toEqual([`Workspaces: ${current}`]);
    };
    await check(row);
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), rowLabel(name)));
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

/** The left and right edges of a terminal row's parts, and the width of the process text. */
const edges = (row: Locator) =>
  row.evaluate(
    (r, [label, process, path, age]) => {
      const box = (selector: string) => {
        const b = r.querySelector(selector)?.getBoundingClientRect();
        return { left: b?.left, right: b?.right };
      };
      const text = document.createRange();
      text.selectNodeContents(r.querySelector(process)!);
      return {
        label: box(label),
        process: box(process),
        path: box(path),
        age: box(age),
        processText: text.getBoundingClientRect().width
      };
    },
    [LABEL, PROCESS, PATH, AGE]
  );

test('ACC-TERM-254-PATH-WIDTH: the path, in a card and in TERMINALS, stands after the process in the free width: the name and the process stay whole at the widths they have without it, the time does not move, at a width with none left the path has zero width while the process gives way, and under 32 px of free width it is hidden', async ({
  page
}) => {
  const long = 'a-program-whose-name-has-forty-letters-x';
  let process = 'sleep';
  let cwd: string | null = null;
  await processIs(
    page,
    () => process,
    () => cwd
  );
  // short enough to stand whole beside the icon, the process and the time at 250 px
  const terminal = `t${Math.floor(Math.random() * 46656).toString(36)}`;
  expect(
    (
      await page.request.post('/api/terminals', { data: { name: terminal } })
    ).ok()
  ).toBe(true);
  const current = fresh('pathwidth');
  const held = `${current}-held`;
  await putWorkspace(page, held, layout([`terminal:${terminal}`]));
  const check = async (row: Locator) => {
    process = 'sleep';
    cwd = null;
    await sidebarTo(page, 500);
    await refresh(page);
    await expect(row.locator(PATH)).toHaveCount(0);
    const without = await edges(row);

    const path = `/tmp/${'a-directory-with-a-long-name/'.repeat(4)}end`;
    cwd = path;
    await refresh(page);
    await expect(row.locator(PATH)).toHaveCount(1);
    const shown = await edges(row);
    expect(shown.label).toEqual(without.label);
    expect(shown.process.left).toBe(without.process.left);
    expect(shown.processText).toBe(without.processText);
    expect(shown.age).toEqual(without.age);
    expect(await cut(row, LABEL)).toEqual([]);
    expect(await cut(row, PROCESS)).toEqual([]);
    expect(shown.process.right!).toBeLessThanOrEqual(shown.path.left!);
    expect(shown.path.left!).toBeLessThan(shown.path.right!);
    expect(shown.path.right!).toBeLessThan(shown.age.left!);
    expect(await oneLine(row)).toBe(true);

    // the name and the process fill the row: as ACC-TERM-236-PROCESS-NARROW, with no width for the path
    process = long;
    cwd = null;
    await sidebarTo(page, 250);
    await refresh(page);
    await expect(row.locator(PROCESS)).toHaveText(long);
    await expect(row.locator(PATH)).toHaveCount(0);
    const narrow = await edges(row);

    cwd = path;
    await refresh(page);
    await expect(row.locator(PATH)).toHaveCount(1);
    expect((await shows(row, PATH)).width).toBe(0);
    expect(await cut(row, PROCESS)).toEqual([long]);
    expect(await cut(row, LABEL)).toEqual([]);
    expect(await shows(row, AGE)).toMatchObject({ inside: true, whole: true });
    expect(await oneLine(row)).toBe(true);
    // a path of no width leaves the row as it is without one
    const squeezed = await edges(row);
    expect(squeezed.label).toEqual(narrow.label);
    expect(squeezed.process).toEqual(narrow.process);
    expect(squeezed.age).toEqual(narrow.age);

    // the 32 px threshold from both sides: the free width follows the sidebar 1:1 while the process stays whole
    await sidebarTo(page, 500);
    const free = await row
      .locator(SLOT)
      .evaluate(n => n.getBoundingClientRect().width);
    const at = async (width: number) => {
      await sidebarTo(page, 500 - Math.round(free - width));
      await expect(row.locator(PROCESS)).toHaveText(long);
      expect(await cut(row, PROCESS)).toEqual([]);
      return css(row.locator(PATH), 'visibility');
    };
    expect(await at(31)).toBe('hidden');
    expect(await at(33)).toBe('visible');
  };
  try {
    await enterWorkspace(page, current);
    await triangle(page, held).click();
    await check(rowOf(card(page, held), rowLabel(terminal)));
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), rowLabel(terminal)));
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, held]);
  }
});

test('ACC-TERM-255-PATH-TAIL: a path wider than the free width, in a card and in TERMINALS, keeps its end in view with the ellipsis at its start, and the characters stay in their own order', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('pathtail');
  const path = `/tmp/${fresh('wm-tail')}/${'a-directory-with-a-long-name/'.repeat(4)}end`;
  const check = async (row: Locator) => {
    await expect(row.locator(`${PATH} bdi`)).toHaveText(path);
    expect(await cut(row, PATH)).toEqual([path]);
    expect(await css(row.locator(PATH), 'textOverflow')).toBe('ellipsis');
    const { box, first, last } = await row.locator(PATH).evaluate(span => {
      const text = span.querySelector('bdi')!.firstChild as Text;
      const character = (at: number) => {
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        const { left, right } = range.getBoundingClientRect();
        return { left, right };
      };
      const { left, right } = span.getBoundingClientRect();
      return {
        box: { left, right },
        first: character(0),
        last: character(text.length - 1)
      };
    });
    expect(box.left).toBeLessThan(box.right);
    expect(last.left).toBeGreaterThanOrEqual(box.left);
    expect(last.right).toBeLessThanOrEqual(box.right);
    expect(first.right).toBeLessThan(box.left);
  };
  try {
    const { name, row } = await terminalIn(page, current, path);
    await check(row);
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), rowLabel(name)));
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-TERM-257-SHORT-LABEL, ACC-TERM-275-CARD-LABEL, ACC-TERM-285-NUMBER-BADGE: a numbered terminal reads no label in a card and its number in a box badge in TERMINALS, a named one reads its name in both; the tooltip and the shutdown dialog keep terminal <n>', async ({
  page
}) => {
  test.setTimeout(120000);
  const named = await startTerminal(page);
  const current = fresh('label');
  const other = `${current}-other`;
  try {
    const { name, row } = await terminalHere(page, current);
    expect(name).toMatch(/^\d+$/);
    // no label in a card (ACC-TERM-302-ICON-GAP)
    await expect(row.locator(LABEL)).toHaveCount(0);
    expect((await tooltip(row))[0]).toBe(`terminal ${name}`);

    await putWorkspace(page, other, layout([`terminal:${name}`]));
    await refresh(page);
    await fromRowMenu(row, 'Stop terminal');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Shut down terminal ${name}?`
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);

    await openSection(page, 'terminals');
    const list = sectionBody(page, 'terminals');
    await expect(rowOf(list, `t${name}`).locator(LABEL)).toHaveText(name);
    expect((await tooltip(rowOf(list, `t${name}`)))[0]).toBe(
      `terminal ${name}`
    );
    // a named terminal stays as it is: build must not read tbuild
    await expect(rowOf(list, named).locator(LABEL)).toHaveText(named);
    expect((await tooltip(rowOf(list, named)))[0]).toBe(`terminal ${named}`);
  } finally {
    await page.request.delete(`/api/terminals/${named}`);
    await deleteWorkspaces(page, [current, other]);
  }
});

/** The distance from the right edge of a row's icon to the left edge of its first text. */
const iconGap = (row: Locator): Promise<number> =>
  row.evaluate(r => {
    const icon = r.querySelector('.jp-WorkspaceManager-rowIcon')!;
    const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && (icon.contains(text) || !text.textContent!.trim())) {
      text = walker.nextNode();
    }
    const range = document.createRange();
    range.selectNodeContents(text!);
    return (
      range.getBoundingClientRect().left - icon.getBoundingClientRect().right
    );
  });

test("ACC-TERM-302-ICON-GAP: in a card a numbered terminal row's first text starts 6 px after its icon, within 1 px, the same offset as a document row's", async ({
  page
}) => {
  const current = fresh('icongap');
  const held = `${current}-held`;
  try {
    await enterWorkspace(page, current);
    const numbered = await newTerminalTab(page);
    expect(numbered).toMatch(/^\d+$/);
    await putWorkspace(
      page,
      held,
      layout([`terminal:${numbered}`, 'editor:docs/notes.md'])
    );
    await refresh(page);
    await triangle(page, held).click();
    const term = rowOf(card(page, held), rowLabel(numbered));
    const doc = rowOf(card(page, held), 'notes.md');
    await expect(term.locator(PROCESS)).toHaveCount(1, UNDER_LOAD);
    await expect(doc).toBeVisible();
    const [termGap, docGap] = [await iconGap(term), await iconGap(doc)];
    // HEAD rendered an empty label between them: 12 px, two column gaps
    expect(
      Math.abs(termGap - 6),
      `terminal gap ${termGap}`
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(docGap - 6), `document gap ${docGap}`).toBeLessThanOrEqual(
      1
    );
    expect(Math.abs(termGap - docGap)).toBeLessThanOrEqual(1);
    const shots = process.env.WM_SHOTS_DIR;
    if (shots) {
      await page.mouse.move(0, 0);
      await card(page, held)
        .locator('.jp-WorkspaceManager-cardBody')
        .screenshot({ path: path.join(shots, 'row-gap-card-body.png') });
    }
  } finally {
    await deleteWorkspaces(page, [current, held]);
  }
});

test('ACC-TERM-259-TOOLTIP-DETAILS, ACC-TERM-279-TOOLTIP-MEMORY: the tooltip of a terminal row, in a card and in TERMINALS, holds its eight lines in order, the exact local time among them, a memory figure after Path and no PID', async ({
  page
}) => {
  test.setTimeout(120000);
  const activity = '2026-10-02T10:15:30.000Z';
  await page.route(
    /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/,
    async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const response = await route.fetch();
      const json = response.ok()
        ? (await response.json()).map((t: any) => ({
            ...t,
            process: 'vim',
            command: 'vim notes.md',
            cwd: '/srv/work',
            last_activity: activity
          }))
        : undefined;
      await route.fulfill({ response, json });
    }
  );
  const current = fresh('tooltip');
  const other = `${current}-other`;
  try {
    const { name, row } = await terminalHere(page, current);
    await putWorkspace(page, other, layout([`terminal:${name}`]));
    await typeInTerminal(page, SET_TITLE);
    await expect.poll(() => tabTitle(page), PROCESS_START).toBe('my tab');
    await refresh(page);
    const exact = await page.evaluate(
      time => new Date(time).toLocaleString(),
      activity
    );
    const check = async (r: Locator) => {
      const age = await r.locator(AGE).textContent();
      const lines = await tooltip(r);
      expect(lines.slice(0, 5)).toEqual([
        `terminal ${name}`,
        'Tab: my tab',
        'Process: vim',
        'Command: vim notes.md',
        'Path: /srv/work'
      ]);
      expect(lines[5]).toMatch(/^Memory: (\d+(\.\d)? (MB|GB)|-)$/);
      expect(lines[6]).toBe(`Last activity: ${age} (${exact})`);
      expect(lines[7].replace('Workspaces: ', '').split(', ').sort()).toEqual(
        [current, other].sort()
      );
      expect(lines).toHaveLength(8);
    };
    await check(row);
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), rowLabel(name)));
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-TERM-261-TAB-NAME: a terminal row, in a card and in TERMINALS, shows the title a program gave its tab with no process text, and its tooltip holds the Tab and Process lines; a terminal with the default title, or with no tab, shows its process', async ({
  page
}) => {
  test.setTimeout(120000);
  const noTab = await startTerminal(page);
  const current = fresh('tabname');
  try {
    const { name, row } = await terminalHere(page, current);
    await expect
      .poll(afterRefresh(page, row.locator(PROCESS)), PROCESS_START)
      .toBe('bash');
    await expect
      .poll(() => tabTitle(page), UNDER_LOAD)
      .toBe(`Terminal ${name}`);
    expect((await tooltip(row))[1]).toBe('Process: bash');

    await typeInTerminal(page, SET_TITLE);
    await expect.poll(() => tabTitle(page), UNDER_LOAD).toBe('my tab');
    await refresh(page);
    const check = async (r: Locator) => {
      await expect(r.locator(PROCESS)).toHaveText('my tab');
      await expect(r).toHaveText(rowTextEither(name, 'my tab'));
      await expect(r.getByText('bash', { exact: true })).toHaveCount(0);
      expect((await tooltip(r)).slice(1, 3)).toEqual([
        'Tab: my tab',
        'Process: bash'
      ]);
    };
    await check(row);
    await openSection(page, 'terminals');
    const list = sectionBody(page, 'terminals');
    await check(rowOf(list, rowLabel(name)));
    await expect
      .poll(
        afterRefresh(page, rowOf(list, noTab).locator(PROCESS)),
        PROCESS_START
      )
      .toBe('bash');
  } finally {
    await page.request.delete(`/api/terminals/${noTab}`);
    await deleteWorkspaces(page, [current]);
  }
});

for (const shutdownOnClose of [true, false]) {
  test(`ACC-LISTS-266-DETACH, ACC-PANEL-245-ROW-MENU: with shutdownOnClose ${shutdownOnClose} the menu of a terminal row lists its four entries and Detach from workspace closes the terminal's tab in this window; the terminal keeps running and shows in TERMINALS`, async ({
    page
  }) => {
    const current = fresh('detach');
    const stops: string[] = [];
    page.on('request', request => {
      if (
        request.method() === 'DELETE' &&
        request.url().includes('/api/terminals/')
      ) {
        stops.push(request.url());
      }
    });
    let terminal = '';
    try {
      await enterWorkspace(page, current);
      await setSetting(
        page,
        '@jupyterlab/terminal-extension:plugin',
        'shutdownOnClose',
        shutdownOnClose
      );
      terminal = await newTerminalTab(page);
      // the tab took the setting: the guard has something to override
      expect(
        await page.evaluate(() =>
          (window as any).jupyterapp.shell.currentWidget.content.getOption(
            'shutdownOnClose'
          )
        )
      ).toBe(shutdownOnClose);
      await openCard(page, current);
      const row = rowOf(card(page, current), rowLabel(terminal));
      await expect(row).toBeVisible(UNDER_LOAD);

      await row.click({ button: 'right' });
      await expect(
        page.locator('.jp-WorkspaceManager-menu .lm-Menu-itemLabel')
      ).toHaveText([
        'Close tab',
        'Detach from workspace',
        'Move to workspace',
        'Stop terminal'
      ]);
      await menuItem(page, 'Detach from workspace').click();
      await expect
        .poll(
          async () => (await terminalTabs(page)).map(t => t.name),
          UNDER_LOAD
        )
        .not.toContain(terminal);
      await expect(row).toHaveCount(0, UNDER_LOAD);
      await refresh(page);
      expect(stops).toEqual([]);
      expect(await terminalNames(page)).toContain(terminal);
      await openSection(page, 'terminals');
      await expect(
        rowOf(sectionBody(page, 'terminals'), rowLabel(terminal))
      ).toBeVisible(UNDER_LOAD);
    } finally {
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current]);
    }
  });
}

test("ACC-LISTS-266-DETACH: Detach from workspace on another workspace's card takes the terminal out of its saved layout and the terminal runs on; refused while another window shows that workspace", async ({
  page
}) => {
  // a second window loads
  test.setTimeout(120000);
  const [gone, stays] = [await startTerminal(page), await startTerminal(page)];
  const current = fresh('detachother');
  const other = `${current}-other`;
  await putWorkspace(
    page,
    other,
    layout([`terminal:${gone}`, `terminal:${stays}`])
  );
  let second: Page | undefined;
  try {
    await enterWorkspace(page, current);
    await triangle(page, other).click();
    const c = card(page, other);
    await fromRowMenu(rowOf(c, rowLabel(gone)), 'Detach from workspace');
    await expect
      .poll(() => savedTabs(page, other), UNDER_LOAD)
      .toEqual([`terminal:${stays}`]);
    expect(Object.keys(await saved(page, other))).not.toContain(
      `terminal:${gone}`
    );
    expect(await terminalNames(page)).toContain(gone);

    second = await secondWindow(page, other);
    await fromRowMenu(rowOf(c, rowLabel(stays)), 'Detach from workspace');
    await expectRefused(page, 'Detach from workspace');
    expect(await savedTabs(page, other)).toEqual([`terminal:${stays}`]);
  } finally {
    await second?.close();
    for (const name of [gone, stays]) {
      await page.request.delete(`/api/terminals/${name}`);
    }
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-TERM-111-SHUTDOWN: Stop terminal ends the terminal, and its row leaves every card', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('shutdown');
  const other = `${current}-other`;
  await putWorkspace(page, other, layout([`terminal:${terminal}`]));
  try {
    await enterWorkspace(page, current);
    await triangle(page, other).click();
    await fromRowMenu(
      rowOf(card(page, other), rowLabel(terminal)),
      'Stop terminal'
    );
    // the route leaves out the ended pty, so the row leaves at the load after the DELETE
    await expect(
      card(page, other).locator(
        `.jp-WorkspaceManager-row[data-row-key="terminal:${terminal}"]`
      )
    ).toHaveCount(0);
    await expect(countOf(card(page, other))).toHaveText('(0)');
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    // one workspace holds it: no question
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-TERM-112-SHUTDOWN-SHARED: shutting down a terminal that another workspace holds asks first and names that workspace', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('shared');
  const [a, b] = [`${current}-a`, `${current}-b`];
  await putWorkspace(page, a, layout([`terminal:${terminal}`]));
  await putWorkspace(page, b, layout([`terminal:${terminal}`]));
  const row = () => rowOf(card(page, a), rowLabel(terminal));
  try {
    await enterWorkspace(page, current);
    await triangle(page, a).click();

    await fromRowMenu(row(), 'Stop terminal');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Shut down terminal ${terminal}?`
    );
    await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
      `Workspace ${b} also holds this terminal.`
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await terminalNames(page)).toContain(terminal);

    await fromRowMenu(row(), 'Stop terminal');
    await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
    // the route leaves out the ended pty at the load after the DELETE
    for (const id of [a, b]) {
      await openCard(page, id);
      await expect(
        card(page, id).locator(
          `.jp-WorkspaceManager-row[data-row-key="terminal:${terminal}"]`
        )
      ).toHaveCount(0);
      await expect(countOf(card(page, id))).toHaveText('(0)');
    }
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, a, b]);
  }
});

test('ACC-TERM-215-TAB-MATCH: a click on a terminal row activates the tab of its running terminal; the kept tab of an ended terminal never matches a new terminal of the same name', async ({
  page
}) => {
  // the tab of the ended terminal stays open while a new terminal takes its name
  test.setTimeout(120000);
  const name = await startTerminal(page);
  const current = fresh('tabmatch');
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const listed = () => rowOf(sectionBody(page, 'terminals'), rowLabel(name));
    // the row opens the running terminal in a tab of this window
    await listed().click();
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(1);
    const stale = (await terminalTabs(page))[0].id;
    // the tab outlives its terminal, as a terminal with closeOnExit off does
    await page.evaluate(id => {
      const app = (window as any).jupyterapp;
      const widget = Array.from<any>(app.shell.widgets('main')).find(
        (w: any) => w.id === id
      );
      widget.content.setOption('closeOnExit', false);
    }, stale);
    await page.request.delete(`/api/terminals/${name}`);
    await expect
      .poll(
        async () =>
          (await terminalTabs(page)).find(t => t.id === stale)?.disposed,
        UNDER_LOAD
      )
      .toBe(true);
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(name);

    const again = await page.request.post('/api/terminals', { data: { name } });
    expect(again.ok()).toBe(true);
    await refresh(page);
    // opening TERMINALS closed WORKSPACES and unmounted its card: reopen it
    await openSection(page, 'workspaces');
    // this window's card lists the new terminal through the kept tab of the old one
    await openCard(page, current);
    const cardRow = rowOf(card(page, current), rowLabel(name));
    await expect(cardRow).toHaveCount(1, UNDER_LOAD);
    await cardRow.click();
    // a new tab opens, and the tab of the ended terminal stays inactive
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(2);
    const tabs = await terminalTabs(page);
    const opened = tabs.find(t => t.id !== stale)!;
    expect(opened.name).toBe(name);
    expect(opened.disposed).toBe(false);
    expect(tabs.find(t => t.id === stale)!.disposed).toBe(true);
    expect(await activeId(page)).toBe(opened.id);
  } finally {
    await page.request.delete(`/api/terminals/${name}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-TERM-216-TAB-KEPT: once a row opened a tab, every later click activates that tab, never a second one; the tab closed, the next click opens one new tab', async ({
  page
}) => {
  test.setTimeout(120000);
  const name = await startTerminal(page);
  const current = fresh('tabkept');
  let other = '';
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const row = () => rowOf(sectionBody(page, 'terminals'), rowLabel(name));
    await row().click();
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(1);
    const kept = (await terminalTabs(page))[0].id;

    // another tab is active: the row activates the tab it opened, not a second tab
    other = await newTerminalTab(page);
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(2);
    const otherId = (await terminalTabs(page)).find(t => t.id !== kept)!.id;
    expect(await activeId(page)).toBe(otherId);
    await row().click();
    await expect.poll(() => activeId(page), UNDER_LOAD).toBe(kept);
    expect((await terminalTabs(page)).length).toBe(2);

    // the tab closes: the link ends and the next click opens one new tab
    await page.evaluate(() =>
      (window as any).jupyterapp.shell.currentWidget.close()
    );
    await expect
      .poll(
        async () => (await terminalTabs(page)).some(t => t.id === kept),
        UNDER_LOAD
      )
      .toBe(false);
    await row().click();
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(2);
    const opened = (await terminalTabs(page)).find(t => t.id !== otherId)!;
    expect(opened.name).toBe(name);
    expect(opened.id).not.toBe(kept);
  } finally {
    await page.request.delete(`/api/terminals/${name}`);
    if (other) {
      await page.request.delete(`/api/terminals/${other}`);
    }
    await deleteWorkspaces(page, [current]);
  }
});

test('DEF-PANEL-76-TWO-TABS: two clicks on a terminal row about 110 ms apart, the second while the first is opening the tab, open one tab', async ({
  page
}) => {
  test.setTimeout(120000);
  const name = await startTerminal(page);
  const current = fresh('twotabs');
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const row = rowOf(sectionBody(page, 'terminals'), rowLabel(name));
    await row.click();
    await page.waitForTimeout(110);
    // the mouse stays on the row: a locator's click would first spend time on its checks
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(async () => (await terminalTabs(page)).length, UNDER_LOAD)
      .toBe(1);
    // the second tab of the defect lands just after the first
    await page.waitForTimeout(1500);
    expect((await terminalTabs(page)).length).toBe(1);
  } finally {
    await page.request.delete(`/api/terminals/${name}`);
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('rows lit while they are worked with', () => {
  // the KERNELS row of a session started by REST; Galata would list only its page's own
  test.use({ kernels: null, sessions: null });

  /** The tab in the main area's tab bar that reads `label`. */
  const tabOf = (page: Page, label: string): Locator =>
    page
      .locator('#jp-main-dock-panel .lm-TabBar-tab')
      .filter({ has: page.getByText(label, { exact: true }) });

  /** The rows of the panel that are lit. */
  const lit = (page: Page): Locator =>
    page.locator(`${PANEL} .jp-mod-selected`);

  test('ACC-LISTS-260-ROW-LIT: a terminal row clicked in a card stays lit after its tab takes the focus; another tab leaves no row lit, and going back by the tab bar lights none; ArrowDown still moves the selection', async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(120000);
    const current = fresh('litterm');
    const doc = `${tmpPath}/lit.txt`;
    await page.contents.uploadContent('text', 'text', doc);
    try {
      const { name, row } = await terminalHere(page, current);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(name);
      const terminalTabLabel = await tabTitle(page);
      await openDocument(page, doc);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await expect(lit(page)).toHaveCount(0);

      // the click: the row lights, the terminal tab takes the focus, the row stays lit
      await row.click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(name);
      await expect(terminalTab(page).locator('textarea')).toBeFocused();
      await expect(row).toHaveClass(SELECTED);

      // another tab: no row is lit
      await tabOf(page, 'lit.txt').click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await expect(lit(page)).toHaveCount(0);

      // back by the tab bar: no row lights by itself
      await tabOf(page, terminalTabLabel).click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(name);
      await expect(terminalTab(page).locator('textarea')).toBeFocused();
      await expect(lit(page)).toHaveCount(0);

      const rows = card(page, current).locator('.jp-WorkspaceManager-row');
      await rows.first().focus();
      await expect(rows.first()).toHaveClass(SELECTED);
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await expect(rows.nth(1)).toHaveClass(SELECTED);
      await expect(lit(page)).toHaveCount(1);
    } finally {
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-LISTS-260-ROW-LIT: a language server row, which has no tab, is lit while it holds the focus; a click in the main area leaves no row lit', async ({
    page,
    tmpPath
  }) => {
    const current = fresh('litserver');
    const doc = `${tmpPath}/lit.txt`;
    await page.contents.uploadContent('text', 'text', doc);
    try {
      await enterWorkspace(page, current);
      await openDocument(page, doc);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await languageServer(page, true);
      await openSection(page, 'servers');
      const row = rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)');
      await row.focus();
      await expect(row).toHaveClass(SELECTED);

      await page.locator('#jp-main-dock-panel .jp-FileEditor:visible').click();
      await expect(row).not.toHaveClass(SELECTED);
      await expect(lit(page)).toHaveCount(0);
    } finally {
      await languageServer(page, false);
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-LISTS-260-ROW-LIT: a KERNELS row whose click opens its notebook stays lit with its detail lines while the notebook is current; another tab leaves it unlit', async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(120000);
    const current = fresh('litkernel');
    const notebook = `${tmpPath}/lit.ipynb`;
    const doc = `${tmpPath}/lit.txt`;
    await putNotebook(page, notebook);
    await page.contents.uploadContent('text', 'text', doc);
    const session = await startSession(page, notebook);
    try {
      await enterWorkspace(page, current);
      await openDocument(page, doc);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await openSection(page, 'kernels');
      const row = rowOf(sectionBody(page, 'kernels'), 'lit.ipynb');

      await row.click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(notebook);
      await expect(row).toHaveClass(SELECTED);
      await expect(row.locator(DETAIL).first()).toBeVisible();

      await tabOf(page, 'lit.txt').click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await expect(row).not.toHaveClass(SELECTED);
      await expect(row.locator(DETAIL)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-LISTS-260-ROW-LIT: a press held on the TERMINALS band opens it while a KERNELS row is lit; the lit row keeps its detail lines until the press ends, so the band stays under the pointer', async ({
    page,
    tmpPath
  }) => {
    const current = fresh('litpress');
    const notebook = `${tmpPath}/press.ipynb`;
    await putNotebook(page, notebook);
    const session = await startSession(page, notebook);
    try {
      await enterWorkspace(page, current);
      await openSection(page, 'kernels');
      const row = rowOf(sectionBody(page, 'kernels'), 'press.ipynb');
      await row.focus();
      await expect(row.locator(DETAIL).first()).toBeVisible();

      const band = sectionHeader(page, 'terminals');
      const box = (await band.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // a person's press lasts several frames, the panel renders inside it
      await page.waitForTimeout(150);
      expect((await band.boundingBox())!.y).toBe(box.y);
      await page.mouse.up();
      await expect(band).toHaveAttribute('aria-expanded', 'true');
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await deleteWorkspaces(page, [current]);
    }
  });

  test("DEF-PANEL-77-BAND-PRESS: a row lit by focus is unlit after another card's header is dragged above a third card's and dropped, with the focus on the dragged header", async ({
    page
  }) => {
    const current = fresh('litdrag');
    const [a, b] = [`${current}-a`, `${current}-b`];
    const placed = [current, a, b];
    const order = () =>
      page
        .locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`)
        .evaluateAll(cards => cards.map(c => c.getAttribute('data-workspace')));
    try {
      for (const [position, id] of placed.entries()) {
        await patchMeta(page, id, { position });
        await putWorkspace(
          page,
          id,
          id === a ? layout(['editor:held.txt']) : {}
        );
      }
      await enterWorkspace(page, current);
      await expect.poll(order).toEqual(placed);
      await openCard(page, a);
      const row = rowOf(card(page, a), 'held.txt');
      await row.focus();
      await expect(row).toHaveClass(SELECTED);

      // a native drag: Chromium sends pointercancel, drop and dragend, and no mouseup
      await cardHeader(page, b).dragTo(cardHeader(page, current), {
        sourcePosition: { x: 50, y: 10 },
        targetPosition: { x: 50, y: 2 }
      });
      await expect.poll(order).toEqual([b, current, a]);
      await expect(cardHeader(page, b)).toBeFocused();
      await expect(lit(page)).toHaveCount(0);
    } finally {
      await deleteWorkspaces(page, placed);
    }
  });

  test('ACC-LISTS-260-ROW-LIT: a row whose tab is not current loses the light while its context menu is open and lights again when the focus returns', async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(120000);
    const current = fresh('litmenu');
    const doc = `${tmpPath}/lit.txt`;
    await page.contents.uploadContent('text', 'text', doc);
    try {
      const { row } = await terminalHere(page, current);
      await openDocument(page, doc);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(doc);
      await row.focus();
      await expect(row).toHaveClass(SELECTED);

      const menu = page.locator('.jp-WorkspaceManager-menu');
      await row.click({ button: 'right' });
      await expect(menu).toBeVisible();
      await expect(lit(page)).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(row).toBeFocused();
      await expect(row).toHaveClass(SELECTED);
      await expect(lit(page)).toHaveCount(1);
    } finally {
      await deleteWorkspaces(page, [current]);
    }
  });
});
