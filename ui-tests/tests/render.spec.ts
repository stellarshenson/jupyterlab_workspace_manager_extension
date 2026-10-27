import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';
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
  only,
  onlyWorkspaces,
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
  rowOf,
  sectionBody,
  sectionCount,
  sectionHeader,
  serverList,
  startSession,
  startTerminal,
  terminalNames,
  triangle,
  UNDER_LOAD
} from './helpers';

/*
 * The render pass of the design checklist (tmp/workflows/sections/checklist.json):
 * one test per 'check' item, or per unasserted part of one, that no other spec
 * asserts. Each title starts with the checklist id and the criterion id. The
 * scenario test saves screenshots as evidence; no test asserts on a screenshot alone.
 */

test.use({ autoGoto: false, mockState: false });

const LIGHT = 'JupyterLab Light';
const DARK = 'Galaxa Dark Theme - Steel';
const SHOTS = path.resolve(
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

/** Any CSS colour as the page draws it on nothing: 0-255 channels and 0-255 alpha. */
function rgba(page: Page, css: string): Promise<number[]> {
  return page.locator(PANEL).evaluate((panel, css) => {
    const probe = document.createElement('div');
    probe.style.color = css;
    panel.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data);
  }, css);
}

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

/** Drag the left sidebar to `width` px. */
async function sidebarTo(page: Page, width: number): Promise<void> {
  const handle = page
    .locator('#jp-main-split-panel > .lm-SplitPanel-handle')
    .first();
  const at = (await handle.boundingBox())!;
  const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + width - (await panelWidth(page)), y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => panelWidth(page)).toBe(width);
}

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

  test('SCENARIO, WS-21 ACC-LISTS-81-ONCE, ROW-01 ACC-LISTS-154-TAB-SHRINK: the panel at 300 px and wide, in Light and Galaxa Steel dark; each tab listed once; rows at least 24 px with a 16 px icon, label in colour 0, detail in colour 1, age inside the row', async ({
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
      const [colour0, colour1] = [
        await rgba(page, 'var(--jp-ui-font-color0)'),
        await rgba(page, 'var(--jp-ui-font-color1)')
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
              const detail = r.querySelector(
                '.jp-WorkspaceManager-rowDetail:not(.jp-WorkspaceManager-rowPath)'
              );
              return {
                text: r.textContent ?? '',
                tall: box.height >= 24,
                icon: icon
                  ? [Math.round(icon.width), Math.round(icon.height)]
                  : null,
                label: label ? getComputedStyle(label).color : '',
                detail: detail ? getComputedStyle(detail).color : null,
                ageInside: !age || age.right <= box.right + 0.5
              };
            })
        );
      const checked: string[] = [];
      for (const show of [
        async () => undefined,
        () => openSection(page, 'terminals')
      ]) {
        await show();
        await page.mouse.move(0, 0);
        for (const r of await anatomy()) {
          checked.push(r.text);
          expect.soft(r.tall, `${r.text} height`).toBe(true);
          expect.soft(r.icon, `${r.text} icon`).toEqual([16, 16]);
          expect
            .soft(await rgba(page, r.label), `${r.text} label colour`)
            .toEqual(colour0);
          if (r.detail !== null) {
            expect
              .soft(await rgba(page, r.detail), `${r.text} detail colour`)
              .toEqual(colour1);
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
        rowOf(sectionBody(page, 'kernels'), notebook),
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
    await page.route('**/jupyterlab-workspace-manager-extension/**', route =>
      route.fulfill({ status: 404, json: { message: 'Not Found' } })
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
      await expect(rowOf(sectionBody(page, 'kernels'), notebook)).toHaveCount(
        1
      );
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

test('HDR-06 (skill design-language, no criterion): the four header buttons keep their place and stay shown in every view', async ({
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
    await expect(page.locator(`${PANEL} .jp-WorkspaceManager-note`)).toHaveText(
      'Nothing matches'
    );
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

test('HDR-07 (skill design-language, no criterion): the title WORKBENCH starts on the x of the section labels', async ({
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
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('HDR-08 ACC-PANEL-9-POLL-HIDDEN, ACC-PANEL-8-POLL: visible, the panel reloads every 10 s without the turning icon and keeps the open card and an open menu; hidden, it sends no reload; shown again, it reloads at once', async ({
  page
}) => {
  test.setTimeout(150000);
  const current = fresh('pollhidden');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {} });
    await triangle(page, ids[1]).click();
    await expect(card(page, ids[1])).toHaveClass(/jp-mod-open/);
    await menuButton(page, ids[1]).click();
    await expect(page.locator('.jp-WorkspaceManager-menu')).toBeVisible();
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

test('SEC-05 ACC-PANEL-157-OTHERS-ACTIONS: an enabled Shut down all is filled with layout colour 2 and its text is colour 0', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('fill');
  try {
    await enterWorkspace(page, current);
    const button = sectionHeader(page, 'terminals').getByRole('button', {
      name: 'Shut down all',
      exact: true
    });
    await expect(button).toBeEnabled();
    await page.mouse.move(0, 0);
    expect(await rgba(page, await style(button, 'backgroundColor'))).toEqual(
      await rgba(page, 'var(--jp-layout-color2)')
    );
    expect(await rgba(page, await style(button, 'color'))).toEqual(
      await rgba(page, 'var(--jp-ui-font-color0)')
    );
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('SEC-06 (skill design-system, no criterion): a section header is one button; its caret is an aria-hidden span 14 px wide and the label starts 18 px from the header edge', async ({
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
            .filter(b => b.textContent?.trim() !== 'Shut down all')
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
        labelInset: 18
      });
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('SEC-07 ACC-PANEL-182-SECTION-HEADS, ACC-PANEL-93-FOCUS: Tab reaches a section header; Enter opens it, Space closes it; a 1 px brand colour 1 outline on keyboard focus only', async ({
  page
}) => {
  const current = fresh('seckeys');
  try {
    await enterWorkspace(page, current);
    const brand1 = await rgba(page, 'var(--jp-brand-color1)');
    const kernels = sectionHeader(page, 'kernels');
    await sectionHeader(page, 'workspaces').focus();
    for (let i = 0; i < 16; i++) {
      if (await kernels.evaluate(n => n === document.activeElement)) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(kernels).toBeFocused();
    expect([
      await style(kernels, 'outlineStyle'),
      await style(kernels, 'outlineWidth'),
      await rgba(page, await style(kernels, 'outlineColor'))
    ]).toEqual(['solid', '1px', brand1]);
    await page.keyboard.press('Enter');
    await expect(kernels).toHaveAttribute('aria-expanded', 'true');
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

/** The active shades of jupyterlab_colourful_tab_extension (src/dynamicStyle.ts DEFAULT_PALETTE). */
const ACTIVE: { [theme: string]: { [colour: string]: string } } = {
  [LIGHT]: {
    rose: '#e39fb1',
    peach: '#d2ab82',
    lemon: '#bab56d',
    mint: '#87c086',
    sky: '#77bae0',
    lavender: '#bfa9da'
  },
  [DARK]: {
    rose: '#3a2328',
    peach: '#3a3126',
    lemon: '#3a3825',
    mint: '#253b2a',
    sky: '#1d2a38',
    lavender: '#30253a'
  }
};

test('WS-10 ACC-ACCORD-188-STRIP-SATURATION: each strip colour has HSL saturation of 48 percent or more in Galaxa Steel dark and JupyterLab Light; the active shades are those of the colourful tab extension', async ({
  page
}) => {
  const current = fresh('saturation');
  try {
    await enterWorkspace(page, current);
    for (const theme of [LIGHT, DARK]) {
      await page.theme.setTheme(theme);
      const values = await page.evaluate(colours => {
        // data-jp-theme-light, which the dark palette keys on, is an attribute of the body
        const s = getComputedStyle(document.body);
        return colours.map(c => [
          s.getPropertyValue(`--jp-workspace-manager-${c}`).trim(),
          s.getPropertyValue(`--jp-workspace-manager-${c}-active`).trim()
        ]);
      }, COLOURS);
      COLOURS.forEach((c, i) => {
        const [r, g, b] = [1, 3, 5].map(
          k => parseInt(values[i][0].slice(k, k + 2), 16) / 255
        );
        const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
        const l = (max + min) / 2;
        const saturation =
          max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
        expect
          .soft(saturation, `${theme} ${c} ${values[i][0]}`)
          .toBeGreaterThanOrEqual(0.48);
        expect
          .soft(values[i][1].toLowerCase(), `${theme} ${c}-active`)
          .toBe(ACTIVE[theme][c]);
      });
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('WS-02 ACC-ACCORD-190-FIXED-ORDER, WS-12 ACC-ACCORD-69-CARD: a description or colour change moves no card; opening another card keeps its x and width', async ({
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
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-15 ACC-ACCORD-132-NAME-SIZE, ACC-ACCORD-97-ELLIPSIS, WS-16 ACC-ACCORD-101-PURPOSE-TEXT, ACC-PANEL-181-PURPOSE-WRAP: the name in colour 0 ends in an ellipsis; the purpose is regular, size 1, colour 0, upright, never cut, markup shown as text; a card without a purpose shows no purpose text', async ({
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
    const purpose = card(page, ids[1]).locator('.jp-WorkspaceManager-purpose');
    await expect(purpose).toHaveText(markup);
    await expect(card(page, ids[1]).locator('img')).toHaveCount(0);
    const [colour0, size1] = [
      await rgba(page, 'var(--jp-ui-font-color0)'),
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
      colour: colour0
    });
    await expect(
      card(page, ids[2]).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('');
    const name = card(page, ids[1]).locator('.jp-WorkspaceManager-name');
    expect(await rgba(page, await style(name, 'color'))).toEqual(colour0);
    expect(await style(name, 'textOverflow')).toBe('ellipsis');
    expect(alerts).toEqual([]);
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-17 ACC-ACCORD-130-NOW-DOT, ACC-ACCORD-20-AGE: under 60 s the age reads now, semibold, colour 0, after an 8 px brand colour 2 dot; an older workspace reads its age in regular weight with no dot', async ({
  page
}) => {
  const current = fresh('nowdot');
  const [recent, old] = [`${current}-recent`, `${current}-old`];
  // the server's file times cannot be set back: the list reports old's as two hours ago
  await page.route(/\/lab\/api\/workspaces\/?(\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    const response = await route.fetch();
    const values = (await response.json()).workspaces.values.filter((w: any) =>
      w.metadata.id.startsWith(current)
    );
    for (const w of values) {
      if (w.metadata.id === old) {
        w.metadata.last_modified = new Date(
          Date.now() - 2 * 3600 * 1000
        ).toISOString();
      }
    }
    await route.fulfill({
      response,
      json: {
        workspaces: { ids: values.map((w: any) => w.metadata.id), values }
      }
    });
  });
  try {
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
    await expect(age(recent)).toHaveText('now');
    await expect(age(recent)).toHaveClass(/jp-mod-now/);
    const dot = age(recent).locator('.jp-WorkspaceManager-dot');
    await expect(dot).toHaveCount(1);
    expect({
      weight: await style(age(recent), 'fontWeight'),
      colour: await rgba(page, await style(age(recent), 'color')),
      dot: await dot.evaluate(n => {
        const r = n.getBoundingClientRect();
        return [r.width, r.height];
      }),
      fill: await rgba(page, await style(dot, 'backgroundColor'))
    }).toEqual({
      weight: '600',
      colour: await rgba(page, 'var(--jp-ui-font-color0)'),
      dot: [8, 8],
      fill: await rgba(page, 'var(--jp-brand-color2)')
    });
    await expect(age(old)).toHaveText('2h');
    await expect(age(old).locator('.jp-WorkspaceManager-dot')).toHaveCount(0);
    expect(await style(age(old), 'fontWeight')).toBe('400');
  } finally {
    await deleteWorkspaces(page, [current, recent, old]);
  }
});

test('WS-18 ACC-ACCORD-71-COUNT-ICONS: the three header counts each have their own glyph in colour 1 and a bare number in colour 0', async ({
  page
}) => {
  const current = fresh('glyphs');
  try {
    await enterWorkspace(page, current);
    const header = cardHeader(page, current);
    const [colour0, colour1] = [
      await rgba(page, 'var(--jp-ui-font-color0)'),
      await rgba(page, 'var(--jp-ui-font-color1)')
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
        expect.soft(await rgba(page, c), `${title} glyph`).toEqual(colour1);
      }
      expect
        .soft(await rgba(page, await style(count, 'color')), `${title} number`)
        .toEqual(colour0);
    }
    expect(new Set(icons).size).toBe(3);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test("WS-19 ACC-ACCORD-98-HOVER-ACTIONS, ACC-ACCORD-23-OPEN: Open workspace is disabled on this window's card; on another card it switches this window to that workspace", async ({
  page
}) => {
  const current = fresh('hoveropen');
  let ids: string[] = [];
  try {
    ids = await setUp(page, current, { a: {} });
    await cardHeader(page, current).hover();
    await expect(
      cardHeader(page, current).getByRole('button', { name: 'Open workspace' })
    ).toBeDisabled();
    await cardHeader(page, ids[1]).hover();
    const open = cardHeader(page, ids[1]).getByRole('button', {
      name: 'Open workspace'
    });
    await expect(open).toBeEnabled();
    await open.click();
    await page.waitForURL(new RegExp(`/lab/workspaces/${ids[1]}(\\?.*)?$`));
  } finally {
    await deleteWorkspaces(page, ids);
  }
});

test('WS-20 (design svg/b2-closed.svg, no criterion): every button in a card header is 24 x 24 px', async ({
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
              return `${b.getAttribute('aria-label')}: ${Math.round(r.width)} x ${Math.round(r.height)}`;
            })
        ),
      [ids[1], ids[2]]
    );
    expect(sizes.length).toBeGreaterThanOrEqual(6);
    expect(sizes).toEqual(sizes.map(s => s.replace(/\d+ x \d+$/, '24 x 24')));
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

test('ROW-07 (skill design-system, no criterion): the rows of an open card are one tab stop', async ({
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

test('TERM-02 ACC-TERM-43-PROCESS-SHELL, ACC-TERM-44-PROCESS-UNREAD: at the prompt a terminal row shows the shell; with no readable process it shows terminal <n> alone', async ({
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
    await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
      process
    );
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      `terminal ${terminal}`
    );
    unread = true;
    await refresh(page);
    await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
      `terminal ${terminal}`
    );
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('TERM-03 ACC-TERM-200-ROW-LEAVES, ACC-TERM-111-SHUTDOWN: a failed shutdown keeps the row; a new terminal of a shut-down name shows', async ({
  page
}) => {
  const terminal = await startTerminal(page);
  const current = fresh('termfail');
  // the lab adds a cache-busting query to every request
  const refuse = new RegExp(`/api/terminals/${terminal}(\\?.*)?$`);
  let refusing = true;
  try {
    await enterWorkspace(page, current);
    await openSection(page, 'terminals');
    const row = () =>
      rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`);
    await expect(row()).toHaveCount(1);

    await page.route(refuse, route =>
      refusing && route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 500,
            json: { message: 'refused by the test' }
          })
        : route.fallback()
    );
    await fromRowMenu(row(), 'Shut down terminal');
    await expect(dialog(page)).toHaveCount(1, UNDER_LOAD);
    await dialog(page).locator('.jp-Dialog-button').last().click();
    await expect(dialog(page)).toHaveCount(0);
    await refresh(page);
    await expect(row()).toHaveCount(1);
    expect(await terminalNames(page)).toContain(terminal);
    refusing = false;

    await fromRowMenu(row(), 'Shut down terminal');
    await expect(row()).toHaveCount(0, { timeout: 5000 });
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    const again = await page.request.post('/api/terminals', {
      data: { name: terminal }
    });
    expect(again.ok()).toBe(true);
    await refresh(page);
    await expect(row()).toHaveCount(1, UNDER_LOAD);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
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

test("KERN-03 ACC-KERNEL-49-STATE, ACC-LISTS-109-CONSOLE: in this window's card a kernel row's dot is success colour 1 while idle and brand colour 2 while busy; a console's kernel row names the console", async ({
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
    await expect(
      kernels.locator('.jp-WorkspaceManager-rowDetail', {
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

test('NEW-01 ACC-PANEL-142-NEW-NAME, ACC-PANEL-144-NEW-PURPOSE, ACC-PANEL-149-DESC-COUNT: a name other than letters, digits, - and _ keeps Create disabled under the rule; the description keeps 100 characters and no line break; the counter follows', async ({
  page
}) => {
  const current = fresh('newrules');
  try {
    await enterWorkspace(page, current);
    const before = (await listed(page)).sort();
    await headerButton(page, 'New workspace').click();
    const name = dialog(page).locator('input');
    await expect(name).toBeFocused();
    await name.fill('a b');
    await expect(dialog(page).locator('.jp-mod-accept')).toBeDisabled();
    const rule = dialog(page).locator('.jp-WorkspaceManager-rule');
    await expect(rule).toHaveText(
      'The name may contain letters, numbers, hyphens (-), and underscores (_).'
    );
    await expect(rule).toBeVisible();
    await expect(rule).not.toHaveClass(/jp-mod-error/);
    await name.fill('good_name-1');
    await expect(dialog(page).locator('.jp-mod-accept')).toBeEnabled();
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

test('LEG-04 (project CLAUDE.md, no criterion): the stylesheet of the panel holds no literal colour outside the palette rules', async ({
  page
}) => {
  const current = fresh('literal');
  try {
    await enterWorkspace(page, current);
    const found = await page.evaluate(() => {
      const literal = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
      const palette = [
        ':root',
        "[data-jp-theme-light='false']",
        '[data-jp-theme-light="false"]'
      ];
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
            !/--jp-workspace-manager-/.test(text)
          ) {
            continue;
          }
          ours += 1;
          if (
            palette.includes(r.selectorText) &&
            /--jp-workspace-manager-/.test(text)
          ) {
            continue;
          }
          if (literal.test(text)) {
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

test('LEG-05 ACC-PANEL-93-FOCUS: keyboard focus on a card header, a triangle, a row, a section header and a header button shows a whole 1 px solid brand colour 1 outline; a click shows none', async ({
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
    const targets: [string, Locator][] = [
      ['card-header', cardHeader(page, current)],
      ['triangle', triangle(page, current)],
      ['row', card(page, ids[1]).locator(ROW).nth(1)],
      ['section-header', sectionHeader(page, 'kernels')],
      ['header-button', headerButton(page, 'Filter')]
    ];
    const near = (a: number[], b: number[]) =>
      a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 24);
    for (const [name, target] of targets) {
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
            await rgba(page, await style(target, 'outlineColor'))
          ],
          name
        )
        .toEqual(['solid', '1px', brand1]);
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
      const px = await pixels(
        page,
        await page.screenshot({
          clip: { x: box.x, y: box.y, width: box.width, height: box.height }
        })
      );
      const at = (x: number, y: number) =>
        px.data.slice((y * px.width + x) * 4, (y * px.width + x) * 4 + 3);
      const [mx, my] = [Math.floor(px.width / 2), Math.floor(px.height / 2)];
      // the outermost or the next device pixel: a box at a fractional position snaps either way
      const either = (a: [number, number], b: [number, number]) =>
        near(at(...a), brand1) || near(at(...b), brand1);
      const sides = {
        top: either([mx, 0], [mx, 1]),
        right: either([px.width - 1, my], [px.width - 2, my]),
        bottom: either([mx, px.height - 1], [mx, px.height - 2]),
        left: either([0, my], [1, my])
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

test('LEG-06 ACC-PANEL-96-LOAD-ERROR: a failed reload shows one status line and keeps the rows; the next good reload removes it', async ({
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
    await expect(row).toHaveCount(1);
    fail = false;
    await refresh(page);
    await expect(error).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current]);
  }
});
