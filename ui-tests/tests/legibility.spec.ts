import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  cardHeader,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  openPanel,
  PANEL,
  patchMeta,
  putWorkspace,
  refresh,
  startTerminal
} from './helpers';

test.use({ autoGoto: false, mockState: false });

const COLOURS = ['rose', 'peach', 'lemon', 'mint', 'sky', 'lavender'];
const DARK = 'Galaxa Dark Theme - Steel';
const LIGHT = 'JupyterLab Light';

/** One text of the panel as the browser draws it. */
interface IText {
  text: string;
  contrast: number;
  size: number;
  style: string;
  group: boolean;
  /** the class of the element that draws the text */
  where: string;
}

/**
 * Every text of the panel that is drawn: text nodes, and the placeholder of
 * an empty field. The contrast is that of the text colour to the colours of
 * the boxes under it, composed from the outermost one.
 */
function texts(page: Page): Promise<IText[]> {
  return page.locator(PANEL).evaluate(panel => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // any CSS colour, color-mix() included, as 0-255 channels and alpha 0-1
    const rgba = (css: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: number[], under: number[]) =>
      [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3]));
    const luminance = (c: number[]) => {
      const [r, g, b] = c.map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const backdrop = (el: Element) => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        chain.unshift(e);
      }
      let colour = [255, 255, 255];
      for (const e of chain) {
        colour = over(rgba(getComputedStyle(e).backgroundColor), colour);
      }
      return colour;
    };
    const measure = (el: Element, text: string, colour: string): IText => {
      const style = getComputedStyle(el);
      let alpha = 1;
      for (let e: Element | null = el; e; e = e.parentElement) {
        alpha *= parseFloat(getComputedStyle(e).opacity);
      }
      const fg = rgba(colour);
      fg[3] *= alpha;
      const bg = backdrop(el);
      const [l1, l2] = [luminance(over(fg, bg)), luminance(bg)].sort(
        (a, b) => b - a
      );
      return {
        text,
        contrast: (l1 + 0.05) / (l2 + 0.05),
        size: parseFloat(style.fontSize),
        style: style.fontStyle,
        group: !!el.closest('.jp-WorkspaceManager-groupLabel'),
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

/** The texts of each card opened in turn: this window's, a coloured one, In no workspace. */
async function textsOfOpenCards(
  page: Page,
  ids: { current: string; coloured: string[] }
): Promise<IText[]> {
  const found: IText[] = [];
  for (const header of [
    cardHeader(page, ids.current),
    cardHeader(page, ids.coloured[0]),
    page.locator(`${PANEL} [data-key="x:none"] .jp-WorkspaceManager-cardHeader`)
  ]) {
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(0, 0);
    found.push(...(await texts(page)));
  }
  return found;
}

test('ACC-PANEL-73-TEXT-CONTRAST: every text reads at 4.5:1 or more in Galaxa Steel dark and JupyterLab Light', async ({
  page
}) => {
  const ids = await populate(page);
  try {
    const themes: string[] = await page.evaluate(async () => {
      const manager: any = await (window as any).galata.getPlugin(
        '@jupyterlab/apputils-extension:themes'
      );
      return manager.themes;
    });
    expect(themes).toContain(DARK);
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      // this window's card in each colour, as its header takes the active shade
      for (const colour of COLOURS) {
        await patchMeta(page, ids.current, { colour });
        await refresh(page);
        await expect(card(page, ids.current)).toHaveClass(
          new RegExp(`jp-mod-${colour}`)
        );
        const low = (await textsOfOpenCards(page, ids))
          .filter(t => t.contrast < 4.5)
          .map(t => `${t.text} (${t.where}): ${t.contrast.toFixed(2)}`);
        expect.soft(low, `${theme}, this window's card ${colour}`).toEqual([]);
      }
    }
  } finally {
    await ids.cleanup();
  }
});

test('ACC-PANEL-74-TEXT-SIZE, ACC-PANEL-75-NO-ITALIC: no text under font size 1 but the group labels at size 0, none in italics', async ({
  page
}) => {
  const ids = await populate(page);
  try {
    for (const theme of [DARK, LIGHT]) {
      await page.theme.setTheme(theme);
      const size0 = await fontSize(page, '--jp-ui-font-size0');
      const size1 = await fontSize(page, '--jp-ui-font-size1');
      expect(size0).toBeLessThan(size1);
      const found = await textsOfOpenCards(page, ids);
      const groups = found.filter(t => t.group);
      expect(groups.length).toBeGreaterThan(0);
      expect(
        groups.filter(t => t.size !== size0).map(t => `${t.text}: ${t.size}`),
        theme
      ).toEqual([]);
      expect(
        found
          .filter(t => !t.group && t.size < size1)
          .map(t => `${t.text}: ${t.size}`),
        theme
      ).toEqual([]);
      expect(
        found.filter(t => t.style === 'italic').map(t => t.text),
        theme
      ).toEqual([]);
    }
  } finally {
    await ids.cleanup();
  }
});

test('ACC-ACCORD-132-NAME-SIZE: a workspace name is set in font size 2, semibold', async ({
  page
}) => {
  const current = fresh('name');
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    const size2 = await fontSize(page, '--jp-ui-font-size2');
    const name = card(page, current).locator('.jp-WorkspaceManager-name');
    await expect(name).toHaveText(current);
    const style = await name.evaluate(n => {
      const s = getComputedStyle(n);
      return [parseFloat(s.fontSize), s.fontWeight];
    });
    expect(style).toEqual([size2, '600']);
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
