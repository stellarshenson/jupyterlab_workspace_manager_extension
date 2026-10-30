import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import {
  activeTab,
  card,
  cardHeader,
  colourOf,
  COLOURS,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  fromRowMenu,
  gotoWorkspace,
  group,
  headerButton,
  HEAVY_LOAD,
  kernelIds,
  languageServer,
  layout,
  listed,
  menuButton,
  menuItem,
  newTerminalTab,
  only,
  onlyWorkspaces,
  openCard,
  openDocument,
  openPanel,
  openSection,
  PANEL,
  PANEL_TAB,
  panelWidth,
  patchMeta,
  putNotebook,
  putWorkspace,
  refresh,
  rgba,
  rowOf,
  sectionBody,
  sectionCount,
  sectionHeader,
  secondWindow,
  sendToTerminal,
  serverList,
  sidebarTo,
  startSession,
  startTerminal,
  stripColour,
  terminalNames,
  TOKENS,
  triangle,
  UNDER_LOAD
} from './helpers';

/*
 * The render pass of the design checklist (tmp/workflows/sections/checklist.json):
 * one test per 'check' item, or per unasserted part of one, that no other spec
 * asserts. Each title starts with the checklist id and the criterion id. The
 * scenario test saves screenshots as evidence; no test asserts on a screenshot alone.
 * Items of the checklist asserted by a criterion's own test elsewhere: HDR-01
 * (panel.spec.ts ACC-PANEL-201), HDR-02 (panel.spec.ts ACC-PANEL-147, ACC-PANEL-169),
 * SEC-01 (panel.spec.ts ACC-PANEL-193), SEC-02 (panel.spec.ts ACC-PANEL-192), SEC-03
 * (sections.spec.ts ACC-PANEL-182), SEC-09 (panel.spec.ts ACC-PANEL-90), the sizes of
 * LEG-02 (legibility.spec.ts ACC-PANEL-74), HDR-03 (keyboard.spec.ts ACC-PANEL-138), WS-08
 * (sections.spec.ts ACC-ACCORD-15, ACC-ACCORD-128), WS-11 (sections.spec.ts ACC-ACCORD-69),
 * WS-14 (sections.spec.ts ACC-ACCORD-129), the places and disabled states of WS-19 and the
 * card buttons of HID-01 (sections.spec.ts ACC-ACCORD-98), MENU-04 (menu.spec.ts
 * ACC-ACCORD-150, ACC-ACCORD-102, ACC-ACCORD-30), MENU-02 and MENU-05 (menu.spec.ts
 * ACC-ACCORD-148, ACC-ACCORD-155), MENU-08 (content.spec.ts ACC-LISTS-212), HID-02
 * (hidden.spec.ts ACC-HIDDEN-213), LEG-01 and the colour 2 note of HID-01
 * (legibility.spec.ts ACC-PANEL-202), the empty states of LEG-02 (legibility.spec.ts
 * ACC-PANEL-75), KERN-02 (kernels.spec.ts ACC-KERNEL-196), the purpose of MENU-06
 * (menu.spec.ts ACC-ACCORD-99).
 */

test.use({ autoGoto: false, mockState: false });

const LIGHT = 'JupyterLab Light';
const DARK = 'Galaxa Dark Theme - Steel';
const SHOTS =
  process.env.WM_SHOTS_DIR ??
  path.resolve(
    __dirname,
    '..',
    '..',
    'tmp',
    'workflows',
    'sections',
    'render',
    'pass-3'
  );
const shot = (name: string): string => path.join(SHOTS, `${name}.png`);

/** Requested by every reload of the panel and by nothing else. */
const POLLED = '/jupyterlab-workspace-manager-extension/terminals';
const TERMINALS = /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/;
const ROW = '.jp-WorkspaceManager-row';
const HEADER_BUTTONS = [
  'New workspace',
  'Filter',
  'Show hidden workspaces',
  'Refresh'
];

/** A computed style property of an element. */
const style = (l: Locator, property: string): Promise<string> =>
  l.evaluate((n, p) => (getComputedStyle(n) as any)[p] as string, property);

/** The colour a glyph paints: the fill of its jp-icon shapes, the stroke where the fill is none. */
const glyph = (svg: Locator): Promise<string[]> =>
  svg.evaluate(s =>
    Array.from(s.querySelectorAll('[class*="jp-icon"]')).map(e => {
      const c = getComputedStyle(e);
      return c.fill === 'none' ? c.stroke : c.fill;
    })
  );

/** The ids of the cards in the order the panel shows them. */
const order = (page: Page): Promise<string[]> =>
  page
    .locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`)
    .evaluateAll(nodes =>
      nodes.map(n => (n as HTMLElement).dataset.workspace!)
    );

/** The pixels of a PNG screenshot, decoded in the page. */
function pixels(
  page: Page,
  png: Buffer
): Promise<{ width: number; height: number; data: number[] }> {
  return page.evaluate(async b64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data)
    };
  }, png.toString('base64'));
}

/** The shutdown question's body as a sentence of the form the panel writes. */
function sentence(names: string[], also: boolean, item: string): string {
  if (names.length === 1) {
    return `Workspace ${names[0]}${also ? ' also' : ''} holds this ${item}.`;
  }
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Workspaces ${list}${also ? ' also' : ''} hold this ${item}.`;
}

/** Who a holders sentence names (sorted), whether it says also, whether its grammar is the panel's. */
function holders(text: string): {
  names: string[];
  also: boolean;
  grammar: boolean;
} {
  const m = /^Workspaces? (.+?)( also)? holds? this (terminal|kernel)\.$/.exec(
    text
  );
  if (!m) {
    return { names: [text], also: false, grammar: false };
  }
  const names = m[1].split(/, | and /);
  return {
    names: [...names].sort(),
    also: !!m[2],
    grammar: text === sentence(names, !!m[2], m[3])
  };
}

/**
 * This window in the new workspace `current` and the workspaces
 * `<current>-<suffix>`, each with a stored position in that order and a colour;
 * the panel sees only these. Returns every id.
 */
async function setUp(
  page: IJupyterLabPageFixture,
  current: string,
  others: {
    [suffix: string]: {
      data?: Record<string, unknown>;
      record?: Record<string, unknown>;
    };
  } = {}
): Promise<string[]> {
  const ids = [current];
  await putWorkspace(page, current);
  await patchMeta(page, current, { position: 0, colour: 'sky' });
  let position = 0;
  for (const [suffix, o] of Object.entries(others)) {
    const id = `${current}-${suffix}`;
    position += 1;
    ids.push(id);
    await putWorkspace(page, id, o.data ?? {});
    await patchMeta(page, id, {
      position,
      colour: COLOURS[position % 6],
      ...o.record
    });
  }
  await enterWorkspace(page, current);
  return ids;
}

/** Create a workspace through the + dialog. */
async function createWorkspace(page: Page, name: string): Promise<void> {
  await headerButton(page, 'New workspace').click();
  await dialog(page).locator('input').fill(name);
  await dialog(page).locator('input').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, name)).toBeVisible(UNDER_LOAD);
}

/** The x, display and visibility of the four header buttons. */
const headerPlaces = (page: Page): Promise<string[]> =>
  page.locator(`${PANEL} .jp-WorkspaceManager-header`).evaluate(
    (h, labels) =>
      labels.map(label => {
        const b = h.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
        if (!b) {
          return `${label}: absent`;
        }
        const s = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return `${label}: x ${Math.round(r.left)}, ${s.display}, ${s.visibility}, ${r.width > 0 ? 'drawn' : 'empty'}`;
      }),
    HEADER_BUTTONS
  );

/**
 * The scenario of the render pass: this window in a workspace of its own with a
 * notebook and a terminal tab; alpha with a purpose, a notebook, a document and a
 * terminal; beta holding the same terminal; gamma empty; each with a stored
 * position and a colour; a notebook kernel in alpha's layout, a terminal in no
 * workspace. The panel sees only these workspaces, kernels and terminals.
 */
async function seed(page: IJupyterLabPageFixture, tmpPath: string) {
  const current = fresh('render');
  const [alpha, beta, gamma] = ['alpha', 'beta', 'gamma'].map(
    x => `${current}-${x}`
  );
  const mine = `${tmpPath}/analysis.ipynb`;
  const theirs = `${tmpPath}/revenue_forecast.ipynb`;
  await putNotebook(page, mine);
  await putNotebook(page, theirs);
  const sessions = [
    await startSession(page, mine),
    await startSession(page, theirs)
  ];
  const kernels: string[] = sessions.map(s => s.kernel.id);
  const held = await startTerminal(page);
  const loose = await startTerminal(page);
  const terminals = [held, loose];
  await only(page, /\/api\/kernels(\?.*)?$/, k => kernels.includes(k.id));
  await only(page, /\/api\/sessions(\?.*)?$/, s =>
    kernels.includes(s.kernel?.id)
  );
  await only(page, TERMINALS, t => terminals.includes(t.name));
  await putWorkspace(
    page,
    alpha,
    layout([
      `notebook:${theirs}`,
      `editor:${tmpPath}/docs/notes.md`,
      `terminal:${held}`
    ])
  );
  await putWorkspace(page, beta, layout([`terminal:${held}`]));
  await putWorkspace(page, gamma);
  await putWorkspace(page, current);
  const records: { [id: string]: Record<string, unknown> } = {
    [current]: { position: 0, colour: 'sky' },
    [alpha]: {
      position: 1,
      colour: 'rose',
      purpose: 'Quarterly revenue model, its notebook and the notes beside it'
    },
    [beta]: { position: 2, colour: 'mint' },
    [gamma]: { position: 3, colour: 'lavender' }
  };
  for (const [id, record] of Object.entries(records)) {
    await patchMeta(page, id, record);
  }
  await onlyWorkspaces(page, id => id.startsWith(current));
  await gotoWorkspace(page, current);
  await openPanel(page);
  await openDocument(page, mine);
  await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(mine);
  const tab = await page.evaluate(
    async () =>
      (await (window as any).jupyterapp.commands.execute('terminal:create-new'))
        .content.session.name as string
  );
  terminals.push(tab);
  await refresh(page);
  await page.mouse.move(0, 0);
  const cleanup = async () => {
    for (const s of sessions) {
      await page.request.delete(`/api/sessions/${s.id}`);
    }
    await Promise.all(
      kernels.map(id => page.request.delete(`/api/kernels/${id}`))
    );
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current, alpha, beta, gamma]);
  };
  return {
    current,
    alpha,
    beta,
    gamma,
    mine,
    theirs,
    held,
    loose,
    tab,
    cleanup
  };
}

type Scenario = Awaited<ReturnType<typeof seed>>;

/** Close every open card of the WORKSPACES section. */
async function closeCards(page: Page): Promise<void> {
  await openSection(page, 'workspaces');
  const open = page.locator(
    `${PANEL} .jp-WorkspaceManager-card.jp-mod-open button.jp-WorkspaceManager-caret`
  );
  while ((await open.count()) > 0) {
    await open.first().click();
  }
}

/** The views the scenario is photographed in. */
const VIEWS: [string, (page: Page, s: Scenario) => Promise<void>][] = [
  ['closed', closeCards],
  [
    'current-open',
    async (page, s) => {
      await closeCards(page);
      await triangle(page, s.current).click();
      await expect(card(page, s.current)).toHaveClass(/jp-mod-open/);
    }
  ],
  [
    'other-open',
    async (page, s) => {
      await closeCards(page);
      await triangle(page, s.alpha).click();
      await expect(card(page, s.alpha)).toHaveClass(/jp-mod-open/);
    }
  ],
  [
    'kernels',
    async page => {
      await openSection(page, 'kernels');
      await expect(sectionBody(page, 'kernels')).toBeVisible();
      // the panel's one selected row, with its detail lines
      const row = sectionBody(page, 'kernels').locator(ROW).first();
      await row.focus();
      await expect(row).toHaveClass(/jp-mod-selected/);
    }
  ],
  [
    'terminals',
    async page => {
      await openSection(page, 'terminals');
      await expect(sectionBody(page, 'terminals')).toBeVisible();
    }
  ]
];

test.describe('the seeded scenario', () => {
  // the scenario starts kernels by REST; Galata would list only its page's own
  test.use({ kernels: null, sessions: null });

  test("SCENARIO, WS-21 ACC-LISTS-81-ONCE, ROW-01 ACC-LISTS-154-TAB-SHRINK, ACC-PANEL-202-TEXT-COLOURS: the panel at 300 px and wide, in Light and Galaxa Steel dark, a KERNELS row selected; each tab listed once; rows at least 24 px with a 16 px icon, name in colour 1 and time in colour 2 at every age, the selected row's detail in colour 2, age inside the row", async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(300000);
    const s = await seed(page, tmpPath);
    try {
      await expect(sectionCount(page, 'workspaces')).toHaveText('(4)');
      await expect(sectionCount(page, 'kernels')).toHaveText('(2)', UNDER_LOAD);
      await expect(sectionCount(page, 'terminals')).toHaveText(
        '(3)',
        UNDER_LOAD
      );
      for (const [theme, tag] of [
        [LIGHT, 'light'],
        [DARK, 'dark']
      ]) {
        await page.theme.setTheme(theme);
        for (const width of [300, 520]) {
          await sidebarTo(page, width);
          for (const [name, show] of VIEWS) {
            await show(page, s);
            await page.mouse.move(0, 0);
            await page
              .locator(PANEL)
              .screenshot({ path: shot(`${name}-${width}-${tag}`) });
          }
        }
      }

      await page.theme.setTheme(LIGHT);
      await sidebarTo(page, 300);
      // WS-21: the terminal tab once, under TERMINALS; the notebook under TABS, its kernel under KERNELS
      await closeCards(page);
      await triangle(page, s.current).click();
      const mineCard = card(page, s.current);
      await expect(rowOf(mineCard, `terminal ${s.tab}`)).toHaveCount(1);
      await expect(
        rowOf(group(mineCard, 'TERMINALS'), `terminal ${s.tab}`)
      ).toHaveCount(1);
      await expect(
        rowOf(group(mineCard, 'TABS'), 'analysis.ipynb')
      ).toHaveCount(1);
      await expect(
        rowOf(group(mineCard, 'KERNELS'), 'analysis.ipynb')
      ).toHaveCount(1);
      expect(
        await group(mineCard, 'TABS')
          .locator('.jp-WorkspaceManager-rowLabel')
          .allTextContents()
      ).not.toContainEqual(expect.stringMatching(/terminal/i));

      // ROW-01 in this window's card and in the TERMINALS section, at 300 px
      const [colour1, colour2] = [
        await rgba(page, 'var(--jp-ui-font-color1)'),
        await rgba(page, 'var(--jp-ui-font-color2)')
      ];
      const anatomy = async () =>
        page.locator(PANEL).evaluate(panel =>
          Array.from(panel.querySelectorAll('.jp-WorkspaceManager-row'))
            .filter(r => (r as HTMLElement).offsetParent !== null)
            .map(r => {
              const box = r.getBoundingClientRect();
              const icon = r
                .querySelector('.jp-WorkspaceManager-rowIcon')
                ?.getBoundingClientRect();
              const age = r
                .querySelector('.jp-WorkspaceManager-age')
                ?.getBoundingClientRect();
              const label = r.querySelector('.jp-WorkspaceManager-rowLabel');
              const detail = r.querySelector('.jp-WorkspaceManager-rowDetail');
              const time = r.querySelector('.jp-WorkspaceManager-age');
              return {
                text: r.textContent ?? '',
                tall: box.height >= 24,
                icon: icon
                  ? [Math.round(icon.width), Math.round(icon.height)]
                  : null,
                label: label ? getComputedStyle(label).color : '',
                time: time ? getComputedStyle(time).color : null,
                detail: detail ? getComputedStyle(detail).color : null,
                ageInside: !age || age.right <= box.right + 0.5
              };
            })
        );
      const checked: string[] = [];
      for (const show of [
        async () => undefined,
        () => openSection(page, 'terminals'),
        // a selected row and its detail
        async () => {
          await openSection(page, 'kernels');
          await sectionBody(page, 'kernels').locator(ROW).first().focus();
        }
      ]) {
        await show();
        await page.mouse.move(0, 0);
        for (const r of await anatomy()) {
          checked.push(r.text);
          expect.soft(r.tall, `${r.text} height`).toBe(true);
          expect.soft(r.icon, `${r.text} icon`).toEqual([16, 16]);
          expect
            .soft(await rgba(page, r.label), `${r.text} label colour`)
            .toEqual(colour1);
          if (r.time !== null) {
            expect
              .soft(await rgba(page, r.time), `${r.text} time colour`)
              .toEqual(colour2);
          }
          if (r.detail !== null) {
            expect
              .soft(await rgba(page, r.detail), `${r.text} detail colour`)
              .toEqual(colour2);
          }
          expect.soft(r.ageInside, `${r.text} age inside`).toBe(true);
        }
      }
      expect(checked.length).toBeGreaterThanOrEqual(6);
    } finally {
      await s.cleanup();
    }
  });

  test('KERN-05 ACC-KERNEL-199-SHUTDOWN-SHARED: from the KERNELS section in a window that holds it not, the question names every holder without also; Cancel keeps the kernel', async ({
    page,
    tmpPath
  }) => {
    const notebook = `${tmpPath}/shared.ipynb`;
    await putNotebook(page, notebook);
    const session = await startSession(page, notebook);
    await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === session.kernel.id);
    await only(
      page,
      /\/api\/sessions(\?.*)?$/,
      s => s.kernel?.id === session.kernel.id
    );
    const current = fresh('ksection');
    let ids: string[] = [];
    try {
      ids = await setUp(page, current, {
        a: { data: layout([`notebook:${notebook}`]) },
        b: { data: layout([`notebook:${notebook}`]) }
      });
      await openSection(page, 'kernels');
      await fromRowMenu(
        rowOf(sectionBody(page, 'kernels'), 'shared.ipynb'),
        'Shut down kernel'
      );
      expect(
        holders(
          (await dialog(page).locator('.jp-Dialog-body').textContent()) ?? ''
        )
      ).toEqual({ names: [ids[1], ids[2]].sort(), also: false, grammar: true });
      await dialog(page)
        .locator('.jp-Dialog-button', { hasText: 'Cancel' })
        .click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await kernelIds(page)).toContain(session.kernel.id);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await deleteWorkspaces(page, ids);
    }
  });

  test('LEG-07 ACC-PANEL-95-SERVER-ABSENT: with every endpoint of the extension answering 404 the panel lists the workspaces, the terminals by name and the kernels', async ({
    page,
    tmpPath
  }) => {
    const notebook = `${tmpPath}/absent.ipynb`;
    await putNotebook(page, notebook);
    const session = await startSession(page, notebook);
    const terminal = await startTerminal(page);
    await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === session.kernel.id);
    await only(
      page,
      /\/api\/sessions(\?.*)?$/,
      s => s.kernel?.id === session.kernel.id
    );
    await only(page, /\/api\/terminals(\?.*)?$/, t => t.name === terminal);
    // the server endpoints answer 404; the labextension's own files, served under
    // /lab/extensions/@stellarshenson/jupyterlab-workspace-manager-extension/, still load
    await page.route(
      /\/jupyterlab-workspace-manager-extension\/(terminals|kernels|meta|presence|switch)(\/[^?]*)?(\?.*)?$/,
      route => route.fulfill({ status: 404, json: { message: 'Not Found' } })
    );
    const current = fresh('absent');
    const other = `${current}-other`;
    await putWorkspace(page, other);
    try {
      await enterWorkspace(page, current);
      await expect(card(page, current)).toBeVisible();
      await expect(card(page, other)).toBeVisible();
      await openSection(page, 'terminals');
      const row = sectionBody(page, 'terminals').locator(ROW);
      await expect(row).toHaveCount(1);
      await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
        `terminal ${terminal}`
      );
      await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(
        0
      );
      await openSection(page, 'kernels');
      await expect(
        rowOf(sectionBody(page, 'kernels'), 'absent.ipynb')
      ).toHaveCount(1);
      await expect(
        page.locator(`${PANEL} .jp-WorkspaceManager-error`)
      ).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, [current, other]);
    }
  });
});

test('RAIL-01 ACC-PANEL-5-ICON, ACC-PANEL-1-REPLACE: the sidebar tab has the caption Workspaces, Terminals and Kernels as its tooltip', async ({
  page
}) => {
  const current = fresh('rail');
  try {
    await enterWorkspace(page, current);
    const tab = page.locator(PANEL_TAB);
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute(
      'title',
      'Workspaces, Terminals and Kernels'
    );
    await expect(tab.locator('svg[data-icon]')).not.toHaveAttribute(
      'data-icon',
      'ui-components:running'
    );
    await expect(page.locator('.jp-RunningSessions')).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-04 ACC-FILTER-56-TOGGLE, ACC-HIDDEN-52-SHOW-HIDDEN: Filter and Show hidden workspaces are toggles: aria-pressed, the glyph in brand colour 1 on layout colour 3 while on, inverse layout colour 3 on nothing at rest, layout colour 3 on hover', async ({
  page
}) => {
  const current = fresh('toggle');
  try {
    await enterWorkspace(page, current);
    const [layout3, brand1, inverse3] = [
      await rgba(page, 'var(--jp-layout-color3)'),
      await rgba(page, 'var(--jp-brand-color1)'),
      await rgba(page, 'var(--jp-inverse-layout-color3)')
    ];
    for (const label of ['Filter', 'Show hidden workspaces']) {
      const b = headerButton(page, label);
      const look = async () => ({
        background: await rgba(page, await style(b, 'backgroundColor')),
        glyph: await Promise.all(
          (await glyph(b.locator('svg'))).map(c => rgba(page, c))
        )
      });
      await expect(b).toHaveAttribute('aria-pressed', 'false');
      const rest = await look();
      expect(rest.background[3], `${label} background at rest`).toBe(0);
      for (const c of rest.glyph) {
        expect(c, `${label} glyph at rest`).toEqual(inverse3);
      }
      await b.hover();
      expect((await look()).background, `${label} hover`).toEqual(layout3);
      await b.click();
      await expect(b).toHaveAttribute('aria-pressed', 'true');
      await page.mouse.move(0, 0);
      const on = await look();
      expect(on.background, `${label} background while on`).toEqual(layout3);
      for (const c of on.glyph) {
        expect(c, `${label} glyph while on`).toEqual(brand1);
      }
      await b.click();
      await expect(b).toHaveAttribute('aria-pressed', 'false');
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-05 ACC-PANEL-7-REFRESH-BUSY: a click on Refresh disables it and turns its icon at once and still 400 ms later; both end when the reload is back', async ({
  page
}) => {
  const current = fresh('busy');
  try {
    await enterWorkspace(page, current);
    const button = headerButton(page, 'Refresh');
    // the click and both reads in the page, so the runner's round trips add no time
    const states = await button.evaluate(async n => {
      const read = () =>
        `${(n as HTMLButtonElement).disabled ? 'disabled' : 'enabled'} ${n.classList.contains('jp-mod-spinning') ? 'spinning' : 'still'}`;
      (n as HTMLButtonElement).click();
      const first = read();
      await new Promise(resolve => setTimeout(resolve, 400));
      return [first, read()];
    });
    expect(states).toEqual(['disabled spinning', 'disabled spinning']);
    await expect(button).toBeEnabled(HEAVY_LOAD);
    await expect(button).not.toHaveClass(/jp-mod-spinning/);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-06 ACC-PANEL-214-HEADER-PLACE: the four header buttons keep their place and stay shown in every view', async ({
  page
}) => {
  const current = fresh('places');
  try {
    await enterWorkspace(page, current);
    const rest = await headerPlaces(page);
    expect(rest.every(p => p.endsWith('drawn'))).toBe(true);
    const views: { [view: string]: string[] } = {};
    await headerButton(page, 'Filter').click();
    views['filter field shown'] = await headerPlaces(page);
    await page
      .locator(`${PANEL} .jp-WorkspaceManager-filterInput`)
      .fill('zzzz');
    await expect(
      sectionBody(page, 'workspaces').locator('.jp-WorkspaceManager-empty')
    ).toHaveText('Nothing matches');
    views['filter matching nothing'] = await headerPlaces(page);
    await headerButton(page, 'Filter').click();
    views['filter field hidden again'] = await headerPlaces(page);
    await headerButton(page, 'Show hidden workspaces').click();
    views['hidden workspaces shown'] = await headerPlaces(page);
    await headerButton(page, 'Show hidden workspaces').click();
    await sectionHeader(page, 'workspaces').click();
    await expect(
      page.locator(`${PANEL} .jp-WorkspaceManager-card`)
    ).toHaveCount(0);
    views['no workspace card'] = await headerPlaces(page);
    await sectionHeader(page, 'workspaces').click();
    // during a refresh: read in the page right after the click
    views['during a refresh'] = await page
      .locator(`${PANEL} .jp-WorkspaceManager-header`)
      .evaluate((h, labels) => {
        h.querySelector<HTMLButtonElement>(
          'button[aria-label="Refresh"]'
        )!.click();
        return labels.map(label => {
          const b = h.querySelector<HTMLElement>(
            `button[aria-label="${label}"]`
          )!;
          const s = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          return `${label}: x ${Math.round(r.left)}, ${s.display}, ${s.visibility}, ${r.width > 0 ? 'drawn' : 'empty'}`;
        });
      }, HEADER_BUTTONS);
    for (const [view, places] of Object.entries(views)) {
      expect.soft(places, view).toEqual(rest);
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-07 ACC-PANEL-201-HEADER-BAND: the title WORKBENCH starts on the x of the section labels, 18 px from the panel edge', async ({
  page
}) => {
  const current = fresh('column');
  try {
    await enterWorkspace(page, current);
    const x = await page.locator(PANEL).evaluate(panel => {
      const left = (s: string) =>
        panel.querySelector(s)!.getBoundingClientRect().left -
        panel.getBoundingClientRect().left;
      return {
        title: left('.jp-WorkspaceManager-titleLabel'),
        label: left('.jp-WorkspaceManager-sectionLabel')
      };
    });
    expect(
      Math.abs(x.title - x.label),
      `title at ${x.title} px, section label at ${x.label} px from the panel edge`
    ).toBeLessThanOrEqual(1);
    expect(Math.round(x.title)).toBe(18);
    expect(Math.round(x.label)).toBe(18);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-08 ACC-PANEL-9-POLL-HIDDEN, ACC-PANEL-8-POLL: visible, the panel reloads every 10 s without the turning icon and keeps the open WORKSPACES section, its scroll, the selected row of the open card, the open card, an open menu and KERNELS closed; hidden, it sends no reload; shown again, it reloads at once', async ({
  page
}) => {
  test.setTimeout(150000);
  const current = fresh('pollhidden');
  let ids: string[] = [];
  try {
    ids = await setUp(
      page,
      current,
      Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `${i}`,
          i === 0 ? { data: layout(['editor:README.md']) } : {}
        ])
      )
    );
    // one section open: WORKSPACES, with KERNELS closed
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await triangle(page, ids[1]).click();
    await expect(card(page, ids[1])).toHaveClass(/jp-mod-open/);
    // a row of the open card, focused: the panel's one selected row
    const selected = rowOf(card(page, ids[1]), 'README.md');
    await selected.focus();
    await expect(selected).toHaveClass(/jp-mod-selected/);
    await menuButton(page, ids[1]).click();
    await expect(page.locator('.jp-WorkspaceManager-menu')).toBeVisible();
    // scrolled after the click, which scrolls the button into view
    const list = sectionBody(page, 'workspaces');
    await list.evaluate(n => (n.scrollTop = 80));
    const scrolled = await list.evaluate(n => n.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    // the turning icon, if a poll ever shows it
    await page.locator(PANEL).evaluate(panel => {
      const button = panel.querySelector('button[aria-label="Refresh"]')!;
      new MutationObserver(() => {
        if (button.classList.contains('jp-mod-spinning')) {
          (window as any).__spun = true;
        }
      }).observe(button, { attributes: true });
    });
    const requests = async (ms: number) => {
      let n = 0;
      const seen = (r: { url: () => string }) => {
        if (r.url().includes(POLLED)) {
          n += 1;
        }
      };
      page.on('request', seen);
      await page.waitForTimeout(ms);
      page.off('request', seen);
      return n;
    };
    const visible = await requests(21000);
    expect(visible).toBeGreaterThanOrEqual(2);
    expect(visible).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => (window as any).__spun ?? false)).toBe(
      false
    );
    await expect(card(page, ids[1])).toHaveClass(/jp-mod-open/);
    await expect(page.locator('.jp-WorkspaceManager-menu')).toBeVisible();
    expect(await list.evaluate(n => n.scrollTop)).toBe(scrolled);
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(sectionBody(page, 'kernels')).toHaveCount(0);
    await expect(selected).toHaveClass(/jp-mod-selected/);
    await expect(page.locator(`${PANEL} .jp-mod-selected`)).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.locator('.jp-SideBar [data-id="filebrowser"]').click();
    await expect(page.locator(PANEL)).toBeHidden();
    expect(await requests(21000)).toBe(0);

    const shown = page.waitForRequest(r => r.url().includes(POLLED), {
      timeout: 3000
    });
    await page.locator(PANEL_TAB).click();
    await shown;
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('SEC-05 ACC-PANEL-157-OTHERS-ACTIONS: on the section band an enabled Shut down all is a 22 px icon button carrying the broom glyph in inverse layout colour 3: no background, no border, a 14 px glyph, a pointer, in a band as tall as the WORKSPACES band; hovering one paints the glyph in UI font colour 1; a disabled one keeps that look at opacity 0.4', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('fill');
  try {
    await enterWorkspace(page, current);
    const button = (name: string) =>
      sectionHeader(page, name).getByRole('button', {
        name: 'Shut down all',
        exact: true
      });
    await expect(button('terminals')).toBeEnabled();
    await expect(button('terminals')).toHaveAttribute(
      'aria-label',
      'Shut down all'
    );
    await expect(button('terminals')).toHaveAttribute('title', 'Shut down all');
    await page.mouse.move(0, 0);
    const look = async (b: Locator) => ({
      // the band shows through: no background, no border
      background: await rgba(page, await style(b, 'backgroundColor')),
      border: await style(b, 'borderTopWidth'),
      glyph: await Promise.all(
        (await glyph(b.locator('svg'))).map(c => rgba(page, c))
      ),
      box: [
        Math.round((await b.boundingBox())!.width),
        Math.round((await b.boundingBox())!.height)
      ],
      glyphBox: Math.round((await b.locator('svg').boundingBox())!.width),
      cursor: await style(b, 'cursor')
    });
    const iconButton = {
      background: [0, 0, 0, 0],
      border: '0px',
      glyph: [await rgba(page, 'var(--jp-inverse-layout-color3)')],
      box: [22, 22],
      glyphBox: 14,
      cursor: 'pointer'
    };
    expect(await look(button('terminals'))).toEqual(iconButton);
    // the design system's Hover pair: the glyph takes UI font colour 1
    await button('terminals').hover();
    expect((await look(button('terminals'))).glyph).toEqual([
      await rgba(page, 'var(--jp-ui-font-color1)')
    ]);
    await page.mouse.move(0, 0);
    // the band keeps the height of a band without a button
    expect((await sectionHeader(page, 'terminals').boundingBox())!.height).toBe(
      (await sectionHeader(page, 'workspaces').boundingBox())!.height
    );
    // keyboard focus shows the design system's rim 1 px outside (DQ-19)
    await sectionHeader(page, 'terminals').focus();
    await page.keyboard.press('Tab');
    await expect(button('terminals')).toBeFocused();
    expect([
      await style(button('terminals'), 'outlineStyle'),
      await style(button('terminals'), 'outlineWidth'),
      await rgba(page, await style(button('terminals'), 'outlineColor')),
      await style(button('terminals'), 'outlineOffset')
    ]).toEqual([
      'solid',
      '1px',
      await rgba(page, 'var(--jp-brand-color1)'),
      '1px'
    ]);
    // no language server runs in this page
    await expect(button('servers')).toBeDisabled();
    expect(await look(button('servers'))).toEqual({
      ...iconButton,
      cursor: 'default'
    });
    expect(await style(button('servers'), 'opacity')).toBe('0.4');
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('SEC-06 (skill design-system, no criterion): a section header is one button; its caret is an aria-hidden span 14 px wide and the label starts 16 px from the header edge, 18 px from the panel edge', async ({
  page
}) => {
  const current = fresh('caret');
  try {
    await enterWorkspace(page, current);
    for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
      const found = await sectionHeader(page, name).evaluate(h => {
        const caret = h.firstElementChild as HTMLElement;
        const label = h.querySelector('.jp-WorkspaceManager-sectionLabel')!;
        return {
          otherButtons: Array.from(h.querySelectorAll('button'))
            .filter(
              b =>
                b.getAttribute('aria-label') !== 'Shut down all' &&
                b.getAttribute('aria-label') !== 'Clean up workspaces'
            )
            .map(b => b.getAttribute('aria-label') ?? b.className),
          caretTag: caret.tagName.toLowerCase(),
          caretHidden: caret.getAttribute('aria-hidden'),
          caretWidth: Math.round(caret.getBoundingClientRect().width),
          labelInset: Math.round(
            label.getBoundingClientRect().left - h.getBoundingClientRect().left
          )
        };
      });
      expect.soft(found, name).toEqual({
        otherButtons: [],
        caretTag: 'span',
        caretHidden: 'true',
        caretWidth: 14,
        // the band sits 2 px inside the panel edge for its focus rim (DQ-19)
        labelInset: 16
      });
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-228-BAND-HEIGHT: each section band is ~24 px and shorter than the WORKBENCH header with 4 px padding; its caret is a 14 px aria-hidden span reading ▾ open and ▸ closed', async ({
  page
}) => {
  const current = fresh('band');
  try {
    await enterWorkspace(page, current);
    const workbench = (await page
      .locator(`${PANEL} .jp-WorkspaceManager-header`)
      .boundingBox())!.height;
    for (const name of ['workspaces', 'kernels', 'terminals', 'servers']) {
      const header = sectionHeader(page, name);
      const caret = header.locator('.jp-WorkspaceManager-caret');
      const band = await header.evaluate(h => {
        const s = getComputedStyle(h);
        return {
          height: Math.round(h.getBoundingClientRect().height),
          paddingTop: s.paddingTop,
          paddingBottom: s.paddingBottom
        };
      });
      expect(
        Math.abs(band.height - 24),
        `${name} band ${band.height} px against the reference's 24 px`
      ).toBeLessThanOrEqual(2);
      expect(
        band.height,
        `${name} band ${band.height} px against the ${workbench} px WORKBENCH header`
      ).toBeLessThan(workbench);
      expect.soft(band, name).toMatchObject({
        paddingTop: '4px',
        paddingBottom: '4px'
      });
      const open = (await header.getAttribute('aria-expanded')) === 'true';
      const drawn = await caret.evaluate(n => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--jp-ui-font-color2)';
        n.parentElement!.appendChild(probe);
        const colour2 = getComputedStyle(probe).color;
        probe.remove();
        return {
          tag: n.tagName.toLowerCase(),
          hidden: n.getAttribute('aria-hidden'),
          width: Math.round(n.getBoundingClientRect().width),
          text: n.textContent,
          colour2: getComputedStyle(n).color === colour2
        };
      });
      expect.soft(drawn, name).toEqual({
        tag: 'span',
        hidden: 'true',
        width: 14,
        text: open ? '▾' : '▸',
        colour2: true
      });
      await header.click();
      await expect(header).toHaveAttribute('aria-expanded', String(!open));
      await expect(caret).toHaveText(open ? '▸' : '▾');
      await header.click();
      await expect(header).toHaveAttribute('aria-expanded', String(open));
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('SEC-07 ACC-PANEL-182-SECTION-HEADS, ACC-PANEL-229-EXCLUSIVE, ACC-PANEL-93-FOCUS: Tab reaches a section header; Enter opens the closed section and closes the open one, Space closes it; a 1 px brand colour 1 outline on keyboard focus only', async ({
  page
}) => {
  const current = fresh('seckeys');
  try {
    await enterWorkspace(page, current);
    const brand1 = await rgba(page, 'var(--jp-brand-color1)');
    const kernels = sectionHeader(page, 'kernels');
    const workspaces = sectionHeader(page, 'workspaces');
    await workspaces.focus();
    for (let i = 0; i < 16; i++) {
      if (await kernels.evaluate(n => n === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(kernels).toBeFocused();
    await expect(kernels).toHaveAccessibleName(/^KERNELS \(\d+\)$/);
    expect([
      await style(kernels, 'outlineStyle'),
      await style(kernels, 'outlineWidth'),
      await rgba(page, await style(kernels, 'outlineColor'))
    ]).toEqual(['solid', '1px', brand1]);
    // WORKSPACES opens by default; Enter opens KERNELS and closes WORKSPACES; Space closes KERNELS
    await expect(kernels).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(kernels).toHaveAttribute('aria-expanded', 'true');
    await expect(workspaces).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(kernels).toHaveAttribute('aria-expanded', 'false');
    // a click on a header that does not have the focus yet: a focused one keeps its keyboard state
    await page.locator('#jp-main-dock-panel').click();
    await kernels.click();
    await expect(kernels).toBeFocused();
    await expect(kernels).toHaveAttribute('aria-expanded', 'true');
    expect(await style(kernels, 'outlineStyle')).toBe('none');
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('SEC-08 ACC-PANEL-208-SECTION-STORE, ACC-PANEL-182-SECTION-HEADS: the open state is kept in localStorage; a localStorage that throws, or an unreadable value, opens WORKSPACES alone, and a click opens one section and closes the other', async ({
  page
}) => {
  const current = fresh('store');
  const expanded = () =>
    Promise.all(
      ['workspaces', 'kernels', 'terminals', 'servers'].map(name =>
        sectionHeader(page, name).getAttribute('aria-expanded')
      )
    );
  try {
    await enterWorkspace(page, current);
    // WORKSPACES opens by default; the other three are closed
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);
    const before = await page.evaluate(() => ({ ...localStorage }));
    await sectionHeader(page, 'kernels').click();
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(sectionHeader(page, 'workspaces')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    const after = await page.evaluate(() => ({ ...localStorage }));
    const changed = Object.keys(after).filter(k => after[k] !== before[k]);
    expect(changed).toHaveLength(1);
    const key = changed[0];

    // an unreadable value: WORKSPACES alone opens
    await page.evaluate(key => localStorage.setItem(key, '{'), key);
    await page.reload();
    await openPanel(page);
    await expect(card(page, current)).toBeVisible(UNDER_LOAD);
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);

    // a localStorage that throws on this key; JupyterLab keeps its own keys there too
    await page.addInitScript(key => {
      const [get, set] = [Storage.prototype.getItem, Storage.prototype.setItem];
      Storage.prototype.getItem = function (k: string) {
        if (k === key) {
          throw new Error('denied');
        }
        return get.call(this, k);
      };
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) {
          throw new Error('denied');
        }
        return set.call(this, k, v);
      };
    }, key);
    await page.reload();
    await openPanel(page);
    await expect(card(page, current)).toBeVisible(UNDER_LOAD);
    expect(await expanded()).toEqual(['true', 'false', 'false', 'false']);
    await sectionHeader(page, 'kernels').click();
    expect(await expanded()).toEqual(['false', 'true', 'false', 'false']);
    await expect(sectionBody(page, 'kernels')).toHaveCount(1);
    await expect(sectionBody(page, 'workspaces')).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('WS-03 ACC-ACCORD-191-DRAG-ORDER: while a card is dragged a brand colour 1 line shows above the card under the pointer', async ({
  page
}) => {
  const current = fresh('dropline');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {}, b: {} });
    await expect.poll(() => order(page)).toEqual(ids);
    const from = (await cardHeader(page, ids[2]).boundingBox())!;
    const to = (await cardHeader(page, ids[0]).boundingBox())!;
    await page.mouse.move(from.x + 60, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + 60, to.y + 4, { steps: 12 });
    await expect(card(page, ids[0])).toHaveClass(/jp-mod-dropBefore/);
    const shadow = await style(card(page, ids[0]), 'boxShadow');
    const colour = /^(rgba?\([^)]*\)|color\([^)]*\))/.exec(shadow)?.[1] ?? '';
    expect(await rgba(page, colour), shadow).toEqual(
      await rgba(page, 'var(--jp-brand-color1)')
    );
    expect(shadow).toContain('-3px');
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual([ids[2], ids[0], ids[1]]);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-09 ACC-ACCORD-187-BLUE-FIRST: with no colour given before, the first workspace given one takes sky (Blue); the next takes lavender', async ({
  page
}) => {
  // the server's last given colour, shared by every test of the run, reads as none
  await page.route(
    /\/jupyterlab-workspace-manager-extension\/meta(\?.*)?$/,
    async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const response = await route.fetch();
      const json = await response.json();
      delete json['/last-colour'];
      await route.fulfill({ response, json });
    }
  );
  const current = fresh('blue');
  const [first, second] = [`${current}-first`, `${current}-second`];
  try {
    // this window's workspace has its colour, so no other card takes one first
    await putWorkspace(page, current);
    await patchMeta(page, current, { colour: 'mint' });
    await enterWorkspace(page, current);
    await createWorkspace(page, first);
    expect(await colourOf(page, first)).toBe('sky');
    await expect(card(page, first)).toHaveClass(/jp-mod-sky/);
    await createWorkspace(page, second);
    expect(await colourOf(page, second)).toBe('lavender');
  } finally {
    await deleteWorkspaces(page, [current, first, second]);
  }
});

test('WS-10 ACC-ACCORD-86-OWN-PALETTE, ACC-ACCORD-15-STRIP: in JupyterLab Light and Galaxa Steel dark the strip of a card of each of the six colours is the theme token of that colour', async ({
  page
}) => {
  const current = fresh('tokens');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      a: {},
      b: {},
      c: {},
      d: {},
      e: {},
      f: {}
    });
    const colours = await Promise.all(
      ids.map(
        async id =>
          (await card(page, id).getAttribute('class'))!.match(
            /jp-mod-(rose|peach|lemon|mint|sky|lavender)\b/
          )![1]
      )
    );
    expect(new Set(colours)).toEqual(new Set(COLOURS));
    for (const theme of [LIGHT, DARK]) {
      await page.theme.setTheme(theme);
      const strips: number[][] = [];
      for (const [i, id] of ids.entries()) {
        const strip = await rgba(page, await stripColour(card(page, id)));
        expect
          .soft(strip, `${theme} ${colours[i]}`)
          .toEqual(
            await rgba(page, `var(${TOKENS[COLOURS.indexOf(colours[i])]})`)
          );
        strips.push(strip);
      }
      // the tokens are defined: a missing one gives the probe and the strip the text colour
      expect(strips, theme).not.toContainEqual(
        await rgba(page, 'var(--jp-ui-font-color0)')
      );
    }
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-02 ACC-ACCORD-190-FIXED-ORDER, WS-12 ACC-ACCORD-69-CARD: a description or colour change moves no card; opening another card keeps its x and width and its border colour 1 border', async ({
  page
}) => {
  const current = fresh('keep');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {}, b: {} });
    await expect.poll(() => order(page)).toEqual(ids);
    await menuButton(page, ids[0]).click();
    await menuItem(page, 'Set description...').click();
    await dialog(page).locator('textarea').fill('A purpose set here');
    await dialog(page).locator('textarea').press('Enter');
    await openCard(page, ids[0]);
    await expect(
      card(page, ids[0]).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('A purpose set here');
    expect(await order(page)).toEqual(ids);
    await menuButton(page, ids[1]).click();
    await menuItem(page, 'Colour').click();
    await page
      .locator('.jp-WorkspaceManager-colourMenu .lm-Menu-item')
      .filter({ hasText: /^Green/ })
      .click();
    await expect(card(page, ids[1])).toHaveClass(/jp-mod-mint/);
    expect(await order(page)).toEqual(ids);

    const box = () =>
      card(page, ids[2]).evaluate(n => {
        const r = n.getBoundingClientRect();
        return [r.left, r.width];
      });
    const closed = await box();
    await triangle(page, ids[2]).click();
    await expect(card(page, ids[2])).toHaveClass(/jp-mod-open/);
    expect(await box()).toEqual(closed);
    const border = await rgba(
      page,
      await style(card(page, ids[2]), 'borderTopColor')
    );
    expect(border).toEqual(await rgba(page, 'var(--jp-border-color1)'));
    expect(border).not.toEqual(
      await rgba(page, await stripColour(card(page, ids[2])))
    );
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

/**
 * Route the workspace list to report each id of `ages` that many ms old: the server's file times
 * cannot be set back. It answers before any route set up earlier, a list filter included.
 */
async function aged(page: Page, ages: Record<string, number>): Promise<void> {
  await page.route(/\/lab\/api\/workspaces\/?(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const json = await response.json();
    for (const w of json.workspaces.values) {
      if (w.metadata.id in ages) {
        w.metadata.last_modified = new Date(
          Date.now() - ages[w.metadata.id]
        ).toISOString();
      }
    }
    await route.fulfill({ response, json });
  });
}

const HOUR = 3600 * 1000;

test('WS-15 ACC-ACCORD-132-NAME-SIZE, ACC-ACCORD-97-ELLIPSIS, WS-16 ACC-ACCORD-18-PURPOSE, ACC-ACCORD-101-PURPOSE-TEXT, ACC-PANEL-181-PURPOSE-WRAP: the name of a card 3 h old is colour 1 and ends in an ellipsis; a closed card shows no purpose; open, the purpose is regular, size 1, colour 2, upright, never cut, markup shown as text; a card without a purpose shows no purpose text', async ({
  page
}) => {
  const alerts: string[] = [];
  page.on('dialog', d => {
    alerts.push(d.message());
    void d.dismiss();
  });
  const markup = '<img src=x onerror=alert(1)>';
  const current = fresh('texts');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      markup: { record: { purpose: markup } },
      plain: {}
    });
    // after the list filter of setUp, so that this route answers first
    await aged(page, { [ids[1]]: 3 * HOUR });
    await refresh(page);
    const purpose = card(page, ids[1]).locator('.jp-WorkspaceManager-purpose');
    // DQ-17: the purpose waits for the card to open
    await expect(card(page, ids[1])).toBeVisible();
    await expect(purpose).toHaveCount(0);
    await openCard(page, ids[1]);
    await expect(purpose).toHaveText(markup);
    await expect(card(page, ids[1]).locator('img')).toHaveCount(0);
    const [colour1, colour2, size1] = [
      await rgba(page, 'var(--jp-ui-font-color1)'),
      await rgba(page, 'var(--jp-ui-font-color2)'),
      await page.locator(PANEL).evaluate(panel => {
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--jp-ui-font-size1)';
        panel.appendChild(probe);
        const size = getComputedStyle(probe).fontSize;
        probe.remove();
        return size;
      })
    ];
    expect({
      weight: await style(purpose, 'fontWeight'),
      size: await style(purpose, 'fontSize'),
      italic: await style(purpose, 'fontStyle'),
      overflow: await style(purpose, 'textOverflow'),
      colour: await rgba(page, await style(purpose, 'color'))
    }).toEqual({
      weight: '400',
      size: size1,
      italic: 'normal',
      overflow: 'clip',
      colour: colour2
    });
    const name = card(page, ids[1]).locator('.jp-WorkspaceManager-name');
    await expect(
      cardHeader(page, ids[1]).locator('.jp-WorkspaceManager-age')
    ).toHaveText('3h ago');
    expect(await rgba(page, await style(name, 'color'))).toEqual(colour1);
    expect(await style(name, 'textOverflow')).toBe('ellipsis');
    await openCard(page, ids[2]);
    await expect(
      card(page, ids[2]).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('');
    expect(alerts).toEqual([]);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-17 ACC-ACCORD-130-NOW-DOT, ACC-ACCORD-20-AGE: under 60 s the time reads now and the header carries jp-mod-recentlyActive with no dot and no colour change; at 3 h the age reads 3h ago in colour 2; over 7 days the name alone is at opacity 0.65 with jp-mod-stale', async ({
  page
}) => {
  const current = fresh('recency');
  const [recent, hours, old] = ['recent', 'hours', 'old'].map(
    x => `${current}-${x}`
  );
  await aged(page, { [hours]: 3 * HOUR, [old]: 9 * 24 * HOUR });
  try {
    await putWorkspace(page, hours);
    await putWorkspace(page, old);
    await gotoWorkspace(page, current);
    await openPanel(page);
    await putWorkspace(page, recent);
    await refresh(page);
    await page.mouse.move(0, 0);
    const age = (id: string) =>
      cardHeader(page, id).locator(
        '.jp-WorkspaceManager-headerLine > .jp-WorkspaceManager-age'
      );
    const name = (id: string) =>
      cardHeader(page, id).locator('.jp-WorkspaceManager-name');
    const [colour1, colour2] = [
      await rgba(page, 'var(--jp-ui-font-color1)'),
      await rgba(page, 'var(--jp-ui-font-color2)')
    ];
    const look = async (id: string) => ({
      age: await age(id).textContent(),
      header: (await cardHeader(page, id).getAttribute('class'))!
        .split(' ')
        .filter(c => c.startsWith('jp-mod-')),
      name: await rgba(page, await style(name(id), 'color')),
      time: await rgba(page, await style(age(id), 'color')),
      nameOpacity: await style(name(id), 'opacity'),
      timeOpacity: await style(age(id), 'opacity'),
      dots: await cardHeader(page, id)
        .locator('.jp-WorkspaceManager-dot')
        .count()
    });
    await expect(age(recent)).toHaveText('now');
    expect(await look(recent)).toEqual({
      age: 'now',
      header: ['jp-mod-recentlyActive'],
      name: colour1,
      time: colour2,
      nameOpacity: '1',
      timeOpacity: '1',
      dots: 0
    });
    expect(await look(hours)).toEqual({
      age: '3h ago',
      header: [],
      name: colour1,
      time: colour2,
      nameOpacity: '1',
      timeOpacity: '1',
      dots: 0
    });
    expect(await look(old)).toEqual({
      age: '9d ago',
      header: ['jp-mod-stale'],
      name: colour1,
      time: colour2,
      nameOpacity: '0.65',
      timeOpacity: '1',
      dots: 0
    });
  } finally {
    await deleteWorkspaces(page, [current, recent, hours, old]);
  }
});

test('WS-18 ACC-ACCORD-71-COUNT-ICONS, ACC-ACCORD-22-COUNTS: a closed card shows no counts; open, the three header counts each have their own glyph in inverse layout colour 3 and a bare number in colour 2', async ({
  page
}) => {
  const current = fresh('glyphs');
  try {
    await enterWorkspace(page, current);
    const header = cardHeader(page, current);
    await expect(header.locator('.jp-WorkspaceManager-count')).toHaveCount(0);
    await openCard(page, current);
    const [glyph3, colour2] = [
      await rgba(page, 'var(--jp-inverse-layout-color3)'),
      await rgba(page, 'var(--jp-ui-font-color2)')
    ];
    const icons: string[] = [];
    for (const title of ['Tabs', 'Terminals', 'Kernels']) {
      const count = header.locator(
        `.jp-WorkspaceManager-count[title="${title}"]`
      );
      await expect(count).toHaveText(/^\d+$/);
      const svg = count.locator('svg');
      icons.push((await svg.getAttribute('data-icon')) ?? '');
      for (const c of await glyph(svg)) {
        expect.soft(await rgba(page, c), `${title} glyph`).toEqual(glyph3);
      }
      expect
        .soft(await rgba(page, await style(count, 'color')), `${title} number`)
        .toEqual(colour2);
    }
    expect(new Set(icons).size).toBe(3);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("WS-19 ACC-ACCORD-98-HOVER-ACTIONS, ACC-ACCORD-23-OPEN: every card shows Open workspace, Close all tabs, the eye and ... at rest; Open workspace and the eye are disabled on this window's card; Open workspace on another card switches this window to that workspace", async ({
  page
}) => {
  const current = fresh('hoveropen');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {} });
    await page.mouse.move(0, 0);
    const labels = (id: string) =>
      card(page, id)
        .locator('.jp-WorkspaceManager-cardActions button')
        .evaluateAll(nodes =>
          nodes.map(
            n =>
              `${n.getAttribute('aria-label')}${(n as HTMLButtonElement).disabled ? ' disabled' : ''}${(n as HTMLElement).offsetParent === null ? ' not shown' : ''}`
          )
        );
    expect(await labels(current)).toEqual([
      'Open workspace disabled',
      'Close all tabs',
      'Hide workspace disabled',
      'Workspace menu'
    ]);
    expect(await labels(ids[1])).toEqual([
      'Open workspace',
      'Close all tabs',
      'Hide workspace',
      'Workspace menu'
    ]);
    const open = cardHeader(page, ids[1]).getByRole('button', {
      name: 'Open workspace'
    });
    await open.click();
    await page.waitForURL(new RegExp(`/lab/workspaces/${ids[1]}(\\?.*)?$`));
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-20 ACC-PANEL-214-HEADER-PLACE: every button in a card header is 24 x 24 px with a 14 x 14 px glyph', async ({
  page
}) => {
  const current = fresh('buttons');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      a: {},
      hidden: { record: { hidden: true } }
    });
    await headerButton(page, 'Show hidden workspaces').click();
    await expect(card(page, ids[2])).toBeVisible();
    await cardHeader(page, ids[1]).hover();
    await expect(
      cardHeader(page, ids[1]).getByRole('button', { name: 'Open workspace' })
    ).toBeVisible();
    const sizes = await page.locator(PANEL).evaluate(
      (panel, others) =>
        others.flatMap(id =>
          Array.from(
            panel.querySelectorAll(
              `[data-workspace="${id}"] .jp-WorkspaceManager-cardHeader button`
            )
          )
            .filter(b => (b as HTMLElement).offsetParent !== null)
            .map(b => {
              const r = b.getBoundingClientRect();
              const g = b.querySelector('svg')!.getBoundingClientRect();
              return `${b.getAttribute('aria-label')}: ${Math.round(r.width)} x ${Math.round(r.height)}, glyph ${Math.round(g.width)} x ${Math.round(g.height)}`;
            })
        ),
      [ids[1], ids[2]]
    );
    expect(sizes.length).toBeGreaterThanOrEqual(6);
    expect(sizes).toEqual(
      sizes.map(s =>
        s.replace(/\d+ x \d+, glyph \d+ x \d+$/, '24 x 24, glyph 14 x 14')
      )
    );
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('ROW-04 ACC-LISTS-161-LANG-ACTIONS (skill design-system Lists & rows): the shutdown button of a language server row is hidden at rest and shows on hover and on keyboard focus', async ({
  page
}) => {
  const current = fresh('lsphover');
  try {
    await enterWorkspace(page, current);
    await languageServer(page, true);
    await openSection(page, 'servers');
    const row = rowOf(sectionBody(page, 'servers'), 'fake-lsp (python)');
    const button = row.locator('button');
    await expect(button).toHaveCount(1);
    await page.mouse.move(0, 0);
    const rest = await style(button, 'visibility');
    await row.hover();
    const hover = await style(button, 'visibility');
    await page.mouse.move(0, 0);
    // keyboard focus: from the section header, Tab until the row has it
    await sectionHeader(page, 'servers').focus();
    for (let i = 0; i < 6; i++) {
      if (await row.evaluate(n => n === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(row).toBeFocused();
    const focus = await style(button, 'visibility');
    expect({ rest, hover, focus }).toEqual({
      rest: 'hidden',
      hover: 'visible',
      focus: 'visible'
    });
    // Tab from the row reaches the button, which stays visible
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    expect(await style(button, 'visibility')).toBe('visible');
  } finally {
    await languageServer(page, false);
    await deleteWorkspaces(page, [current]);
  }
});

test('ROW-07, ROW-06 ACC-LISTS-210-ROW-SELECT (skill design-system Panel construction): the rows of an open card are one tab stop; the focused row is the one selected row and ArrowDown moves the focus, the selection and the tab stop', async ({
  page
}) => {
  const current = fresh('roving');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      a: {
        data: layout(['editor:one.md', 'editor:two.md', 'editor:three.md'])
      }
    });
    await triangle(page, ids[1]).click();
    const rows = card(page, ids[1]).locator(ROW);
    await expect(rows).toHaveCount(3);
    const stops = await rows.evaluateAll(
      ns => ns.filter(n => (n as HTMLElement).tabIndex === 0).length
    );
    await rows.first().focus();
    await expect(rows.first()).toHaveClass(/jp-mod-selected/);
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveClass(/jp-mod-selected/);
    await expect(page.locator(`${PANEL} .jp-mod-selected`)).toHaveCount(1);
    expect(
      await rows.evaluateAll(ns => ns.map(n => (n as HTMLElement).tabIndex))
    ).toEqual([-1, 0, -1]);
    await page.keyboard.press('Tab');
    const left = await card(page, ids[1]).evaluate(
      c =>
        !c
          .querySelector('.jp-WorkspaceManager-cardBody')!
          .contains(document.activeElement)
    );
    expect({ stops, left }).toEqual({ stops: 1, left: true });
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('ROW-06 ACC-PANEL-207-BUTTON-ARROWS: ArrowDown pressed on a language server row button moves the focus to the next row; Enter on the button shuts that server down and opens nothing', async ({
  page
}) => {
  const current = fresh('buttonkeys');
  const servers: [string, string][] = [
    ['workspace-manager-a', 'fake-lsp-a'],
    ['workspace-manager-b', 'fake-lsp-b']
  ];
  try {
    await enterWorkspace(page, current);
    await languageServer(page, true, servers);
    await openSection(page, 'servers');
    const rows = sectionBody(page, 'servers').locator(ROW);
    await expect(rows).toHaveCount(2, UNDER_LOAD);
    const first = rowOf(sectionBody(page, 'servers'), 'fake-lsp-a (python)');
    // the button shows and takes focus from its row's keyboard focus
    await first.focus();
    await page.keyboard.press('Tab');
    await expect(first.locator('button')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();

    // Enter on the button shuts that server down; the row's own Enter opens nothing
    const url = page.url();
    await first.focus();
    await page.keyboard.press('Tab');
    await expect(first.locator('button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const galata = (window as any).galata;
            const manager = await galata.getPlugin(
              '@jupyterlab/lsp-extension:plugin'
            );
            return manager.connections.has('workspace-manager-a');
          }),
        UNDER_LOAD
      )
      .toBe(false);
    expect(page.url()).toBe(url);
    await expect(rows).toHaveCount(1, UNDER_LOAD);
  } finally {
    await languageServer(page, false, servers);
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('rows of terminals and kernels of the server', () => {
  // the tests start a kernel by REST; Galata would list only its page's own
  test.use({ kernels: null, sessions: null });

  test('ROW-01 ACC-LISTS-209-ROW-LINE, ACC-TERM-46-NAME, LEG-09 ACC-PANEL-206-CODE-FONT: unselected, a tab row reads its file name, a terminal row terminal <n> and its time, a kernel row with no session its id, its state and its time; a terminal 3 h idle has its name in colour 1 and 3h ago in colour 2; terminal names, kernel ids and paths are in the code font, workspace names, times and process names in the UI font', async ({
    page
  }) => {
    const terminal = await startTerminal(page);
    const started = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    expect(started.ok()).toBe(true);
    const kernel = (await started.json()).id;
    await only(page, /\/api\/kernels(\?.*)?$/, k => k.id === kernel);
    await only(page, /\/api\/sessions(\?.*)?$/, () => false);
    await page.route(TERMINALS, async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const response = await route.fetch();
      const json = response.ok()
        ? (await response.json()).map((t: any) =>
            t.name === terminal
              ? {
                  ...t,
                  last_activity: new Date(
                    Date.now() - 3 * 3600 * 1000
                  ).toISOString()
                }
              : t
          )
        : undefined;
      await route.fulfill({ response, json });
    });
    const current = fresh('rowline');
    let ids: string[] = [];
    try {
      ids = await setUp(page, current, {
        a: {
          data: layout(['editor:docs/deep/notes.md', `terminal:${terminal}`])
        }
      });
      await triangle(page, ids[1]).click();
      const c = card(page, ids[1]);
      const tab = rowOf(c, 'notes.md');
      const term = rowOf(c, `terminal ${terminal}`);
      await expect(tab).toHaveText('notes.md');
      await expect(term).toHaveText(`terminal ${terminal}3h ago`, UNDER_LOAD);
      await expect(
        page.locator(`${PANEL} .jp-WorkspaceManager-rowDetail`)
      ).toHaveCount(0);
      const [colour1, colour2] = [
        await rgba(page, 'var(--jp-ui-font-color1)'),
        await rgba(page, 'var(--jp-ui-font-color2)')
      ];
      expect(
        await rgba(
          page,
          await style(term.locator('.jp-WorkspaceManager-rowLabel'), 'color')
        )
      ).toEqual(colour1);
      expect(
        await rgba(
          page,
          await style(term.locator('.jp-WorkspaceManager-age'), 'color')
        )
      ).toEqual(colour2);

      // LEG-09: the code font on identifiers only
      const code = await page.locator(PANEL).evaluate(panel => {
        const probe = document.createElement('span');
        probe.style.fontFamily = 'var(--jp-code-font-family)';
        panel.appendChild(probe);
        const family = getComputedStyle(probe).fontFamily;
        probe.remove();
        return family;
      });
      await tab.focus();
      const font = (l: Locator) => style(l, 'fontFamily');
      expect({
        terminal: await font(term.locator('.jp-WorkspaceManager-rowLabel')),
        path: await font(tab.locator('.jp-WorkspaceManager-rowDetail > span'))
      }).toEqual({ terminal: code, path: code });
      await expect(tab.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
        'docs/deep'
      );
      await term.focus();
      await expect(term.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(
        1,
        UNDER_LOAD
      );
      for (const [what, l] of [
        [
          'workspace name',
          cardHeader(page, ids[1]).locator('.jp-WorkspaceManager-name')
        ],
        ['time', term.locator('.jp-WorkspaceManager-age')],
        ['process', term.locator('.jp-WorkspaceManager-rowDetail > span')],
        ['file name', tab.locator('.jp-WorkspaceManager-rowLabel')]
      ] as const) {
        expect(await font(l), what).not.toBe(code);
      }
      // one section open at a time: the KERNELS row renders with KERNELS opened
      await openSection(page, 'kernels');
      const kern = rowOf(sectionBody(page, 'kernels'), kernel);
      await expect(kern).toHaveText(
        /^[0-9a-f-]{36}(idle|starting|busy)(now|\d+m ago)$/
      );
      expect(await font(kern.locator('.jp-WorkspaceManager-rowLabel'))).toBe(
        code
      );
    } finally {
      await page.request.delete(`/api/kernels/${kernel}`);
      await page.request.delete(`/api/terminals/${terminal}`);
      await deleteWorkspaces(page, ids);
    }
  });
});

test('ROW-09 ACC-LISTS-211-ROW-HOVER, ROW-10 ACC-LISTS-210-ROW-SELECT, ACC-TERM-42-PROCESS: a hovered row, in a card and in a section, is layout colour 2 and keeps its text colours; a click selects a row: the one selected row, layout colour 2, its process in its detail line; ArrowDown moves the selection; a refresh keeps it', async ({
  page
}) => {
  const terminals = [await startTerminal(page), await startTerminal(page)];
  const current = fresh('select');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      a: { data: layout(['editor:docs/notes.md']) }
    });
    await sendToTerminal(page, terminals[0], 'sleep 60\n');
    await refresh(page);
    await triangle(page, ids[1]).click();
    const tab = rowOf(card(page, ids[1]), 'notes.md');
    const layout2 = await rgba(page, 'var(--jp-layout-color2)');
    const paint = async (row: Locator) => ({
      background: await rgba(page, await style(row, 'backgroundColor')),
      name: await rgba(
        page,
        await style(row.locator('.jp-WorkspaceManager-rowLabel'), 'color')
      )
    });

    // ROW-09: hover in a card
    await page.mouse.move(0, 0);
    const cardRest = await paint(tab);
    expect(cardRest.background).not.toEqual(layout2);
    await tab.hover();
    expect(await paint(tab)).toEqual({
      background: layout2,
      name: cardRest.name
    });
    await page.mouse.move(0, 0);
    // a tab row in a folder: its folder
    await tab.focus();
    await expect(tab.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      'docs'
    );

    // one section open at a time: the TERMINALS rows render with TERMINALS opened
    await openSection(page, 'terminals');
    const rows = terminals.map(t =>
      rowOf(sectionBody(page, 'terminals'), `terminal ${t}`)
    );

    // ROW-09: hover in a section
    await page.mouse.move(0, 0);
    const rowRest = await paint(rows[0]);
    expect(rowRest.background).not.toEqual(layout2);
    await rows[0].hover();
    expect(await paint(rows[0])).toEqual({
      background: layout2,
      name: rowRest.name
    });
    await page.mouse.move(0, 0);

    // ROW-10: a click selects the TERMINALS row; its detail line shows the process
    await rows[0].click();
    await expect(rows[0]).toHaveClass(/jp-mod-selected/);
    await expect(page.locator(`${PANEL} .jp-mod-selected`)).toHaveCount(1);
    await expect(rows[0].locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      'sleep',
      UNDER_LOAD
    );
    await page.mouse.move(0, 0);
    expect((await paint(rows[0])).background).toEqual(layout2);
    // ArrowDown moves the focus and the selection to the next row
    await rows[0].focus();
    const next = await rows[0].evaluate(
      r => (r.nextElementSibling as HTMLElement | null)?.title ?? ''
    );
    await page.keyboard.press('ArrowDown');
    const selected = page.locator(`${PANEL} .jp-mod-selected`);
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('title', next);
    await expect(rows[0]).not.toHaveClass(/jp-mod-selected/);
    // a refresh keeps it
    await refresh(page);
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('title', next);
  } finally {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, ids);
  }
});

test("ROW-05 ACC-LISTS-38-NO-WORKSPACE, ACC-LISTS-39-ROW-CURRENT, ACC-TERM-215-TAB-MATCH, ACC-TERM-216-TAB-KEPT: a click or Enter on a row opens its item; a terminal row activates the one tab it opened, in a card and in TERMINALS; another workspace's row switches this window", async ({
  page
}) => {
  test.setTimeout(120000);
  // a terminal in no workspace: its TERMINALS row opens a tab here, not a workspace
  const terminal = await startTerminal(page);
  const elsewhere = await startTerminal(page);
  const current = fresh('rowclick');
  const other = `${current}-other`;
  await putWorkspace(page, other, layout([`terminal:${elsewhere}`]));
  let second = '';
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const listed = () =>
      rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`);
    // TERMINALS: a click opens the running terminal in a tab of this window
    await listed().click();
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(terminal);
    // ACC-TERM-216: Enter on the row activates the tab it opened, no second tab
    second = await newTerminalTab(page);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(second);
    await listed().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(terminal);
    // another workspace's TERMINALS row opens its terminal here: this window stays
    await rowOf(
      sectionBody(page, 'terminals'),
      `terminal ${elsewhere}`
    ).click();
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(elsewhere);
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${current}(\\?.*)?$`)
    );
    // this window's card: the terminal row activates the same tab
    // (one section open at a time: WORKSPACES is opened for the card rows)
    await openSection(page, 'workspaces');
    await openCard(page, current);
    await rowOf(card(page, current), `terminal ${terminal}`).click();
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(terminal);
    // another workspace's card: its row switches this window to that workspace
    await openCard(page, other);
    await rowOf(card(page, other), `terminal ${elsewhere}`).click();
    await expect(page).toHaveURL(
      new RegExp(`/lab/workspaces/${other}(\\?.*)?$`)
    );
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await page.request.delete(`/api/terminals/${elsewhere}`);
    if (second) {
      await page.request.delete(`/api/terminals/${second}`);
    }
    await deleteWorkspaces(page, [current, other]);
  }
});

test('TERM-02 ACC-TERM-46-NAME, ACC-TERM-43-PROCESS-SHELL, ACC-TERM-44-PROCESS-UNREAD, ACC-ACCORD-130-NOW-DOT: a terminal row reads terminal <n> and now, its name in colour 1 and its time in colour 2; selected, its detail line shows the shell at the prompt and nothing with no readable process', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  let unread = false;
  await page.route(TERMINALS, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const json = response.ok()
      ? (await response.json()).map((t: any) =>
          unread && t.name === terminal ? { ...t, process: null } : t
        )
      : undefined;
    await route.fulfill({ response, json });
  });
  const current = fresh('shell');
  try {
    await enterWorkspace(page, current);
    const process = (await (await page.request.get(POLLED)).json()).find(
      (t: any) => t.name === terminal
    )?.process;
    expect(process).toMatch(/sh$/);
    await openSection(page, 'terminals');
    const row = rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`);
    await expect(row).toHaveText(`terminal ${terminal}now`);
    await expect(row).toHaveClass(/jp-mod-recentlyActive/);
    for (const [part, token] of [
      [
        '.jp-WorkspaceManager-rowLabel',
        await rgba(page, 'var(--jp-ui-font-color1)')
      ],
      ['.jp-WorkspaceManager-age', await rgba(page, 'var(--jp-ui-font-color2)')]
    ] as const) {
      expect(await rgba(page, await style(row.locator(part), 'color'))).toEqual(
        token
      );
    }
    await row.focus();
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      process
    );
    unread = true;
    await refresh(page);
    await expect(row).toHaveClass(/jp-mod-selected/);
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(0);
    await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
      `terminal ${terminal}`
    );
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('TERM-03 ACC-TERM-200-ROW-LEAVES, ACC-TERM-111-SHUTDOWN: a failed shutdown keeps the row; the route leaves out an ended pty and carries no fingerprint; a second window has no row at its next load; a new terminal of a shut-down name shows', async ({
  page
}) => {
  // a second window loads and the ended pty is held open until the test deletes the held file
  test.setTimeout(120000);
  const terminal = await startTerminal(page);
  const refused = await startTerminal(page);
  const current = fresh('termfail');
  const route = '/jupyterlab-workspace-manager-extension/terminals';
  // the shell of a terminal started by the route has the server's working directory,
  // not the server root, so the held file is an absolute path on this machine
  const held = `/tmp/wm-term03-${terminal}.held`;
  // the lab adds a cache-busting query to every request
  const refuse = new RegExp(`/api/terminals/${refused}(\\?.*)?$`);
  let refusing = true;
  const windows: Page[] = [];
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    // a job that ignores SIGHUP holds the pty open after the shell ends, as a real
    // terminal can: terminado then keeps listing the shut-down name
    await sendToTerminal(
      page,
      terminal,
      `(trap '' HUP; touch "${held}"; while [ -e "${held}" ]; do sleep 0.1; done) &\r`
    );
    await expect.poll(() => fs.existsSync(held), UNDER_LOAD).toBe(true);
    const row = (name: string) =>
      rowOf(sectionBody(page, 'terminals'), `terminal ${name}`);
    await expect(row(terminal)).toHaveCount(1);
    await expect(row(refused)).toHaveCount(1);

    // a second window lists the terminal too; it leaves at that window's next load
    windows.push(await secondWindow(page, current));
    const other = windows[0];
    await openPanel(other);
    await openSection(other, 'terminals');
    const otherRow = rowOf(
      sectionBody(other, 'terminals'),
      `terminal ${terminal}`
    );
    await expect(otherRow).toHaveCount(1, UNDER_LOAD);

    // the route's records carry name, last_activity and process, no fingerprint
    const records = await serverList(page, route);
    // another test's terminal may be live at this moment: ours are listed
    expect(records.map((r: any) => r.name)).toEqual(
      expect.arrayContaining([refused, terminal])
    );
    expect(records.some((r: any) => 'fingerprint' in r)).toBe(false);

    await page.route(refuse, route =>
      refusing && route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 500,
            json: { message: 'refused by the test' }
          })
        : route.fallback()
    );
    // the terminal is in no workspace, so the row shuts it down without a question;
    // the refused DELETE shows its notice
    await fromRowMenu(row(refused), 'Shut down terminal');
    const notice = dialog(page).locator('.jp-Dialog-button', {
      hasText: 'Close'
    });
    await expect(notice).toHaveCount(1, UNDER_LOAD);
    await notice.click();
    await expect(dialog(page)).toHaveCount(0);
    await refresh(page);
    await expect(row(refused)).toHaveCount(1);
    expect(await terminalNames(page)).toContain(refused);
    refusing = false;

    await fromRowMenu(row(terminal), 'Shut down terminal');
    await expect(row(terminal)).toHaveCount(0, { timeout: 5000 });
    // the second window's next load leaves it out, while its pty still holds the name
    await refresh(other);
    await expect(otherRow).toHaveCount(0, { timeout: 5000 });
    // the route leaves the ended pty out at its own next read
    await expect
      .poll(
        async () => (await serverList(page, route)).map((r: any) => r.name),
        UNDER_LOAD
      )
      .not.toContain(terminal);
    // the held pty ends and the name frees: a new terminal of that name shows
    fs.rmSync(held, { force: true });
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    const again = await page.request.post('/api/terminals', {
      data: { name: terminal }
    });
    expect(again.ok()).toBe(true);
    await refresh(page);
    await expect(row(terminal)).toHaveCount(1, UNDER_LOAD);
  } finally {
    fs.rmSync(held, { force: true });
    for (const p of windows) {
      await p.close();
    }
    await page.request.delete(`/api/terminals/${terminal}`);
    await page.request.delete(`/api/terminals/${refused}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('TERM-04 ACC-TERM-112-SHUTDOWN-SHARED: from a card the question names the two other holders with also; from TERMINALS in a window that holds it not, all three without also; Cancel keeps the terminal', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('holders');
  let ids: string[] = [];
  const body = async () =>
    holders(
      (await dialog(page).locator('.jp-Dialog-body').textContent()) ?? ''
    );
  const cancel = async () => {
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
  };
  try {
    const held = { data: layout([`terminal:${terminal}`]) };
    ids = await setUp(page, current, { a: held, b: held, c: held });
    const [a, b, c] = ids.slice(1);
    await triangle(page, a).click();
    await fromRowMenu(
      rowOf(card(page, a), `terminal ${terminal}`),
      'Shut down terminal'
    );
    expect(await body()).toEqual({
      names: [b, c].sort(),
      also: true,
      grammar: true
    });
    await cancel();
    await openSection(page, 'terminals');
    await fromRowMenu(
      rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`),
      'Shut down terminal'
    );
    expect(await body()).toEqual({
      names: [a, b, c].sort(),
      also: false,
      grammar: true
    });
    await cancel();
    expect(await terminalNames(page)).toContain(terminal);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, ids);
  }
});

test('DLG-01 ACC-PANEL-204-DIALOG-FOOTER, ACC-TERM-112-SHUTDOWN-SHARED, ACC-KERNEL-199-SHUTDOWN-SHARED, ACC-LISTS-110-SHUTDOWN-ALL: in the New workspace and Set description dialogs the affirmative action is the only filled button and Cancel the surface button; a destructive action is unfilled in the error colour at the far left; the pointer shows no rim, the keyboard one', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('footer');
  /** The open dialog's buttons: text, background, border, text colour, rim, left edge and focus. */
  const read = () =>
    dialog(page)
      .locator('.jp-Dialog-button')
      .evaluateAll(nodes =>
        nodes.map(n => {
          const s = getComputedStyle(n);
          return {
            label: (n.textContent ?? '').trim(),
            background: s.backgroundColor,
            border: s.borderTopColor,
            colour: s.color,
            outline: [s.outlineStyle, s.outlineWidth, s.outlineColor],
            offset: s.outlineOffset,
            left: Math.round(n.getBoundingClientRect().left),
            focused: n === document.activeElement
          };
        })
      );
  /** A declaration resolved inside the open dialog, where its buttons resolve theirs. */
  const resolved = (css: string, property = 'backgroundColor') =>
    dialog(page).evaluate(
      (d, [css, property]) => {
        const probe = document.createElement('span');
        (probe.style as any)[property] = css;
        d.appendChild(probe);
        const value = (getComputedStyle(probe) as any)[property] as string;
        probe.remove();
        return value;
      },
      [css, property] as [string, string]
    );
  try {
    await enterWorkspace(page, current);

    // New workspace: Create is the only filled button, Cancel the surface button
    await headerButton(page, 'New workspace').click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'New workspace'
    );
    const brand = await resolved('var(--jp-brand-color1)', 'color');
    const surface = await resolved(
      'color-mix(in srgb, var(--jp-ui-font-color0) 6%, var(--jp-layout-color1))'
    );
    const surfaceLook = async () => [
      surface,
      await resolved('var(--jp-border-color2)', 'color')
    ];
    const rim = ['solid', '1px', brand, '1px'];
    let buttons = await read();
    expect(buttons.map(b => b.label)).toEqual(['Cancel', 'Create']);
    let [cancel, accept] = buttons;
    expect([accept.background, accept.border]).toEqual([brand, brand]);
    expect(accept.colour).toBe(
      await resolved('var(--jp-ui-inverse-font-color0)', 'color')
    );
    expect([cancel.background, cancel.border]).toEqual(await surfaceLook());
    expect(cancel.colour).toBe(
      await resolved('var(--jp-ui-font-color0)', 'color')
    );
    // the keyboard gives a button the rim
    for (let i = 0; i < 4 && !(await read()).some(b => b.focused); i++) {
      await page.keyboard.press('Tab');
    }
    const keyed = (await read()).find(b => b.focused)!;
    expect(keyed).toBeTruthy();
    expect([
      keyed.outline[0],
      keyed.outline[1],
      keyed.outline[2],
      keyed.offset
    ]).toEqual(rim);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    // Set description: Save filled, Cancel the surface button
    await menuButton(page, current).click();
    await menuItem(page, 'Set description...').click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      `Set description of ${current}`
    );
    buttons = await read();
    expect(buttons.map(b => b.label)).toEqual(['Cancel', 'Save']);
    [cancel, accept] = buttons;
    expect(accept.background).toBe(brand);
    expect([cancel.background, cancel.border]).toEqual(await surfaceLook());
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    // Shut down all: unfilled in the error colour at the far left; the pointer shows no rim
    await openSection(page, 'terminals');
    await expect(
      rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`)
    ).toHaveCount(1, UNDER_LOAD);
    await sectionHeader(page, 'terminals')
      .getByRole('button', { name: 'Shut down all', exact: true })
      .click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Shut down all?'
    );
    buttons = await read();
    expect(buttons.map(b => b.label)).toEqual(['Shut down all', 'Cancel']);
    const [danger, keep] = buttons;
    const error = await resolved('var(--jp-error-color1)', 'color');
    expect([danger.background, danger.border, danger.colour]).toEqual([
      await resolved('transparent'),
      error,
      error
    ]);
    expect(danger.left).toBeLessThan(keep.left);
    expect(keep.background).toBe(surface);
    // the last button is the platform default: Cancel holds the focus, not the action
    expect(keep.focused).toBe(true);
    expect(keep.outline[0]).toBe('none');
    // Tab: Cancel -> the dialog's first focusable, the first footer button
    await page.keyboard.press('Tab');
    const rimmed = (await read()).find(b => b.focused)!;
    expect(rimmed.label).toBe('Shut down all');
    expect([
      rimmed.outline[0],
      rimmed.outline[1],
      rimmed.outline[2],
      rimmed.offset
    ]).toEqual(rim);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await terminalNames(page)).toContain(terminal);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test("KERN-03 ACC-KERNEL-49-STATE, ACC-LISTS-109-CONSOLE, ACC-KERNEL-156-DISPLAY-NAME: in this window's card a kernel row's dot is success colour 1 while idle and brand colour 2 while busy, its state word in the line, the title and the dot's aria-label; selected, its detail line starts with the display name; a console's kernel row is named by the console", async ({
  page,
  tmpPath
}) => {
  const notebook = `${tmpPath}/state.ipynb`;
  await putNotebook(page, notebook);
  const current = fresh('kstate');
  try {
    await enterWorkspace(page, current);
    await openDocument(page, notebook);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(notebook);
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('console:create', {
        kernelPreference: { name: 'python3' }
      })
    );
    await cardHeader(page, current).click();
    await expect(card(page, current)).toHaveClass(/jp-mod-open/);
    const kernels = group(card(page, current), 'KERNELS');
    const row = rowOf(kernels, 'state.ipynb');
    const dot = row.locator('.jp-WorkspaceManager-dot');
    await expect(async () => {
      await refresh(page);
      await expect(dot).toHaveClass(/jp-mod-idle/, { timeout: 1000 });
    }).toPass(UNDER_LOAD);
    expect(await rgba(page, await style(dot, 'backgroundColor'))).toEqual(
      await rgba(page, 'var(--jp-success-color1)')
    );
    // DQ-13: the word in the line, in the title and in the dot's aria-label
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveText('idle');
    expect((await row.getAttribute('title'))!.split('\n')).toContain('idle');
    await expect(dot).toHaveAttribute('aria-label', 'idle');
    await row.focus();
    await expect(
      row.locator('.jp-WorkspaceManager-rowDetail > span').first()
    ).toHaveText((await row.getAttribute('title'))!.split('\n')[0]);
    await expect(
      kernels.locator('.jp-WorkspaceManager-rowLabel', {
        hasText: /^Console \d+$/
      })
    ).toHaveCount(1, UNDER_LOAD);

    await page.evaluate(path => {
      const app = (window as any).jupyterapp;
      const panel = Array.from(app.shell.widgets('main') as Iterable<any>).find(
        w => w.context?.path === path
      );
      panel.sessionContext.session.kernel.requestExecute({
        code: 'import time; time.sleep(12)'
      });
    }, notebook);
    await expect(async () => {
      await refresh(page);
      await expect(dot).toHaveClass(/jp-mod-busy/, { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    expect(await rgba(page, await style(dot, 'backgroundColor'))).toEqual(
      await rgba(page, 'var(--jp-brand-color2)')
    );
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveText('busy');
    await expect(dot).toHaveAttribute('aria-label', 'busy');
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("MENU-03 ACC-ACCORD-32-DELETE-CURRENT, ACC-HIDDEN-87-NOT-CURRENT: on this window's card Open workspace, Open in new browser tab, Hide workspace and Delete workspace are disabled; on another card none of them is", async ({
  page
}) => {
  const current = fresh('menucur');
  let ids: string[] = [];
  const FOUR = [
    'Open workspace',
    'Open in new browser tab',
    'Hide workspace',
    'Delete workspace'
  ];
  const disabled = () =>
    page
      .locator(
        '.jp-WorkspaceManager-menu .lm-Menu-item.lm-mod-disabled .lm-Menu-itemLabel'
      )
      .allTextContents();
  try {
    ids = await setUp(page, current, { a: {}, b: {} });
    await menuButton(page, current).click();
    expect((await disabled()).filter(l => FOUR.includes(l)).sort()).toEqual(
      [...FOUR].sort()
    );
    await page.keyboard.press('Escape');
    await menuButton(page, ids[1]).click();
    expect((await disabled()).filter(l => FOUR.includes(l))).toEqual([]);
    await page.keyboard.press('Escape');
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('MENU-05 ACC-ACCORD-103-DELETE-DISARM: the second click of a double-click deletes nothing; the arm lapses after 4 s and when the menu closes', async ({
  page
}) => {
  const current = fresh('disarm');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {} });
    await menuButton(page, ids[1]).click();
    await menuItem(page, 'Delete workspace').dblclick();
    await page.waitForTimeout(500);
    expect(await listed(page)).toContain(ids[1]);
    await page.keyboard.press('Escape');

    await menuButton(page, ids[1]).click();
    await menuItem(page, 'Delete workspace').click();
    await expect(menuItem(page, 'Confirm delete')).toHaveCount(1);
    await page.waitForTimeout(4100);
    await expect(menuItem(page, 'Delete workspace')).toHaveCount(1);
    await expect(menuItem(page, 'Confirm delete')).toHaveCount(0);

    await menuItem(page, 'Delete workspace').click();
    await expect(menuItem(page, 'Confirm delete')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await menuButton(page, ids[1]).click();
    await expect(menuItem(page, 'Delete workspace')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await listed(page)).toContain(ids[1]);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('MENU-06 ACC-PANEL-149-DESC-COUNT: the Set description counter reads <n>/100 and follows every keystroke', async ({
  page
}) => {
  const current = fresh('counter');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: { record: { purpose: 'abc' } } });
    await menuButton(page, ids[1]).click();
    await menuItem(page, 'Set description...').click();
    const counter = dialog(page).locator('.jp-WorkspaceManager-counter');
    await expect(counter).toHaveText('3/100');
    await dialog(page).locator('textarea').press('End');
    await dialog(page).locator('textarea').press('d');
    await expect(counter).toHaveText('4/100');
    await dialog(page).locator('textarea').press('Backspace');
    await dialog(page).locator('textarea').press('Backspace');
    await expect(counter).toHaveText('2/100');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('NEW-01 DLG-02 ACC-PANEL-142-NEW-NAME, ACC-PANEL-144-NEW-PURPOSE, ACC-PANEL-149-DESC-COUNT, ACC-PANEL-205-DIALOG-STATE: a name other than letters, digits, - and _ keeps Create disabled under a state line; the description keeps 100 characters and no line break; the counter follows', async ({
  page
}) => {
  const current = fresh('newrules');
  try {
    await enterWorkspace(page, current);
    const before = (await listed(page)).sort();
    await headerButton(page, 'New workspace').click();
    const name = dialog(page).locator('input');
    await expect(name).toBeFocused();
    const rule = dialog(page).locator('.jp-WorkspaceManager-rule');
    // an empty name shows the rule as a colour 2 hint (NEW-01)
    await expect(rule).toHaveText(
      'The name may contain letters, numbers, hyphens (-), and underscores (_).'
    );
    await expect(rule).toBeVisible();
    expect(await rgba(page, await style(rule, 'color'))).toEqual(
      await rgba(page, 'var(--jp-ui-font-color2)')
    );

    // a typed problem turns the rule into a state line (DLG-02): 6 px 12 px on layout colour 2,
    // a 2 px error left border, colour 1 text, no dot
    const stateLine = async (): Promise<unknown[]> => [
      [
        await style(rule, 'paddingTop'),
        await style(rule, 'paddingLeft'),
        await style(rule, 'borderLeftWidth'),
        await style(rule, 'borderLeftStyle')
      ],
      await rgba(page, await style(rule, 'backgroundColor')),
      await rgba(page, await style(rule, 'borderLeftColor')),
      await rgba(page, await style(rule, 'color')),
      await rule.evaluate(el => getComputedStyle(el, '::before').content)
    ];
    const stateLook = [
      ['6px', '12px', '2px', 'solid'],
      await rgba(page, 'var(--jp-layout-color2)'),
      await rgba(page, 'var(--jp-error-color1)'),
      await rgba(page, 'var(--jp-ui-font-color1)'),
      'none'
    ];
    await name.fill('a b');
    await expect(dialog(page).locator('.jp-mod-accept')).toBeDisabled();
    await expect(rule).toHaveClass(/jp-mod-error/);
    expect(await stateLine()).toEqual(stateLook);

    // a name an existing workspace has is the same state line (NEW-01, ACC-PANEL-205)
    await name.fill(current);
    await expect(dialog(page).locator('.jp-mod-accept')).toBeDisabled();
    await expect(rule).toHaveText(`A workspace named ${current} exists`);
    await expect(rule).toHaveClass(/jp-mod-error/);
    expect(await stateLine()).toEqual(stateLook);

    await name.fill('good_name-1');
    await expect(dialog(page).locator('.jp-mod-accept')).toBeEnabled();
    await expect(rule).not.toHaveClass(/jp-mod-error/);
    expect(await rgba(page, await style(rule, 'color'))).toEqual(
      await rgba(page, 'var(--jp-ui-font-color2)')
    );
    const area = dialog(page).locator('textarea');
    const counter = dialog(page).locator('.jp-WorkspaceManager-counter');
    await expect(counter).toHaveText('0/100');
    await area.fill(`${'x'.repeat(60)}\n${'y'.repeat(89)}`);
    const value = await area.inputValue();
    expect([value.length, value.includes('\n')]).toEqual([100, false]);
    await expect(counter).toHaveText('100/100');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect((await listed(page)).sort()).toEqual(before);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('FILT-01 ACC-FILTER-56-TOGGLE: the filter field is a recessed surface: a 4 percent black mix over layout colour 1, a 1 px border colour 1 border, 2 px corners, 24 px tall; focused, a brand colour 1 border and no glow', async ({
  page
}) => {
  const current = fresh('recess');
  try {
    await enterWorkspace(page, current);
    await headerButton(page, 'Filter').click();
    const field = page.locator(`${PANEL} .jp-WorkspaceManager-filter`);
    await expect(
      page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`)
    ).toBeFocused();
    const drawn = {
      background: await rgba(page, await style(field, 'backgroundColor')),
      border: await style(field, 'borderTopWidth'),
      borderColour: await rgba(page, await style(field, 'borderTopColor')),
      radius: await style(field, 'borderTopLeftRadius'),
      height: (await field.boundingBox())!.height,
      shadow: await style(field, 'boxShadow')
    };
    expect(drawn).toEqual({
      background: await rgba(
        page,
        'color-mix(in srgb, var(--jp-layout-color1) 96%, black)'
      ),
      border: '1px',
      borderColour: await rgba(page, 'var(--jp-brand-color1)'),
      radius: '2px',
      height: 24,
      shadow: 'none'
    });
    await page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`).blur();
    expect(await rgba(page, await style(field, 'borderTopColor'))).toEqual(
      await rgba(page, 'var(--jp-border-color1)')
    );
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('FILT-02 ACC-FILTER-57-MATCH, ACC-FILTER-58-FIELDS, ACC-FILTER-116-HIDDEN-SEARCH: case, accents and separators are ignored and one edit in 15 characters matches; a hidden workspace is searched only while the eye shows it', async ({
  page
}) => {
  const current = fresh('match');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      cafe: { record: { purpose: 'Café Notes Review' } },
      plain: { record: { purpose: 'Unrelated' } },
      hid: { record: { purpose: 'Café notes hidden', hidden: true } }
    });
    const [cafe, , hid] = ids.slice(1);
    await headerButton(page, 'Filter').click();
    const input = page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`);
    for (const query of [
      'CAFE_notes',
      'cafe.notes/review',
      'cafe notes revuew'
    ]) {
      await input.fill(query);
      await expect.poll(() => order(page), query).toEqual([cafe]);
    }
    await input.fill('cafe notes');
    await expect.poll(() => order(page)).toEqual([cafe]);
    await headerButton(page, 'Show hidden workspaces').click();
    await expect.poll(() => order(page)).toEqual([cafe, hid]);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test("LEG-04 ACC-PANEL-203-TOKENS-ONLY, ACC-ACCORD-86-OWN-PALETTE: no stylesheet rule of the panel holds a literal colour or a light or dark branch; the filter field's black is the one colour word", async ({
  page
}) => {
  const current = fresh('literal');
  try {
    await enterWorkspace(page, current);
    const found = await page.evaluate(() => {
      const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
      const rules: string[] = [];
      let ours = 0;
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          const r = rule as CSSStyleRule & { cssRules?: CSSRuleList };
          if (r.cssRules && r.cssRules.length && !r.selectorText) {
            walk(r.cssRules);
            continue;
          }
          const text = r.cssText;
          if (
            !/WorkspaceManager|workspace-manager/.test(r.selectorText ?? '') &&
            !/--jp-workspace-manager-|--wm-/.test(text)
          ) {
            continue;
          }
          ours += 1;
          if (
            literal.test(text) ||
            (r.selectorText ?? '').includes('data-jp-theme-light')
          ) {
            rules.push(text);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          walk(sheet.cssRules);
        } catch {
          // a sheet of another origin cannot be read
        }
      }
      return { ours, rules };
    });
    expect(found.ours).toBeGreaterThan(50);
    expect(found.rules).toEqual([]);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('LEG-05 ACC-PANEL-93-FOCUS: keyboard focus on a card header, a triangle, a row, a section header and a header button shows a whole 1 px solid brand colour 1 outline, 1 px outside and 1 px inside a card, 2 px further inside the current card header; a click shows none', async ({
  page
}) => {
  const current = fresh('outline');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, {
      a: { data: layout(['editor:one.md', 'editor:two.md']) }
    });
    await triangle(page, ids[1]).click();
    await expect(card(page, ids[1])).toHaveClass(/jp-mod-open/);
    const brand1 = await rgba(page, 'var(--jp-brand-color1)');
    // the rim sits 1 px outside; inside a card, which clips its content, 1 px inside (DQ-19).
    // This window's card paints the 2 px current-card outline at its rim (DQ-19,
    // ACC-PANEL-231) over the header's rim, so that header's rim sits 2 px further in
    const targets: [string, Locator, string][] = [
      ['card-header', cardHeader(page, ids[1]), '-1px'],
      ['current-header', cardHeader(page, current), '-3px'],
      ['triangle', triangle(page, current), '-1px'],
      ['row', card(page, ids[1]).locator(ROW).nth(1), '-1px'],
      ['section-header', sectionHeader(page, 'kernels'), '1px'],
      ['header-button', headerButton(page, 'Filter'), '1px']
    ];
    const near = (a: number[], b: number[]) =>
      a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 24);
    for (const [name, target, offset] of targets) {
      // a keyboard focus: focus it, step back and Tab forward again; in the
      // toolbar, whose buttons are one tab stop, ArrowRight from the button before
      if (name === 'header-button') {
        await headerButton(page, 'New workspace').focus();
        await page.keyboard.press('ArrowRight');
      } else {
        await target.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
      }
      await expect(target, name).toBeFocused();
      expect
        .soft(
          [
            await style(target, 'outlineStyle'),
            await style(target, 'outlineWidth'),
            await rgba(page, await style(target, 'outlineColor')),
            await style(target, 'outlineOffset')
          ],
          name
        )
        .toEqual(['solid', '1px', brand1, offset]);
      const box = (await target.boundingBox())!;
      await page.screenshot({
        path: shot(`focus-${name}`),
        clip: {
          x: box.x - 6,
          y: box.y - 6,
          width: box.width + 12,
          height: box.height + 12
        }
      });
      const inside = offset.startsWith('-');
      const px = await pixels(
        page,
        await page.screenshot({
          clip: inside
            ? { x: box.x, y: box.y, width: box.width, height: box.height }
            : {
                x: box.x - 6,
                y: box.y - 6,
                width: box.width + 12,
                height: box.height + 12
              }
        })
      );
      const at = (x: number, y: number) =>
        px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3);
      const [mx, my] = [Math.floor(px.width / 2), Math.floor(px.height / 2)];
      // the outermost or the next device pixel: a box at a fractional position snaps either way
      const either = (a: [number, number], b: [number, number]) =>
        near(at(...a), brand1) || near(at(...b), brand1);
      // an inside rim sits at the box's edge, or 2 px in where it clears the current card's
      // 2 px outline; an outside rim sits 1 px beyond the 6 px margin
      const inset = offset === '-3px' ? 2 : 0;
      const pad = 6;
      const sides = inside
        ? {
            top: either([mx, inset], [mx, inset + 1]),
            right: either(
              [px.width - 1 - inset, my],
              [px.width - 2 - inset, my]
            ),
            bottom: either(
              [mx, px.height - 1 - inset],
              [mx, px.height - 2 - inset]
            ),
            left: either([inset, my], [inset + 1, my])
          }
        : {
            top: either([mx, pad - 2], [mx, pad - 1]),
            right: either([px.width - pad + 1, my], [px.width - pad + 2, my]),
            bottom: either(
              [mx, px.height - pad + 1],
              [mx, px.height - pad + 2]
            ),
            left: either([pad - 2, my], [pad - 1, my])
          };
      expect
        .soft(sides, `${name}: the outline on each side`)
        .toEqual({ top: true, right: true, bottom: true, left: true });
    }
    const clicked = sectionHeader(page, 'terminals');
    await page.locator('#jp-main-dock-panel').click();
    await clicked.click();
    await expect(clicked).toBeFocused();
    expect(await style(clicked, 'outlineStyle')).toBe('none');
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('LEG-06 ACC-PANEL-96-LOAD-ERROR: a failed reload shows one banner in the error colour and keeps the rows; the next good reload removes it', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  let fail = false;
  await page.route(TERMINALS, route =>
    fail
      ? route.fulfill({ status: 500, json: { message: 'failed by the test' } })
      : route.fallback()
  );
  const current = fresh('loaderror');
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const row = rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`);
    await expect(row).toHaveCount(1);
    fail = true;
    await refresh(page);
    const error = page.locator(
      `${PANEL} .jp-WorkspaceManager-error[role="status"]`
    );
    await expect(error).toHaveCount(1);
    await expect(error).toContainText('terminals');
    // a banner (DQ-15): the 15 percent wash inside the 35 percent border
    const mixes = await page.evaluate(() => {
      const probe = (style: string, read: string) => {
        const node = document.createElement('div');
        node.setAttribute('style', style);
        document.body.appendChild(node);
        const value = getComputedStyle(node)[read] as string;
        node.remove();
        return value;
      };
      return {
        background: probe(
          'background-color: color-mix(in srgb, var(--jp-error-color1) 15%, transparent)',
          'backgroundColor'
        ),
        border: probe(
          'border: 1px solid color-mix(in srgb, var(--jp-error-color1) 35%, transparent)',
          'borderTopColor'
        )
      };
    });
    expect(await style(error, 'backgroundColor')).toBe(mixes.background);
    expect(await style(error, 'borderTopColor')).toBe(mixes.border);
    expect(await style(error, 'borderTopWidth')).toBe('1px');
    expect(await style(error, 'borderTopStyle')).toBe('solid');
    await expect(row).toHaveCount(1);
    fail = false;
    await refresh(page);
    await expect(error).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});
