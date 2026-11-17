import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';
import * as path from 'path';

import {
  atRest,
  card,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  gotoWorkspace,
  headerButton,
  layout,
  newButton,
  only,
  onlyWorkspaces,
  openCard,
  openPanel,
  openSection,
  PANEL,
  patchMeta,
  putWorkspace,
  refresh,
  sectionBody,
  sectionCount,
  sectionHeader,
  startTerminal,
  triangle,
  UNDER_LOAD
} from './helpers';

// The harmonica of the four sections (design system, Harmonica navigation). Headless
// Chromium hides scrollbars, so no list would draw one (ACC-PANEL-313-HARMONICA-EDGE);
// launchOptions forces a worker of its own, so it stands here and not in a group.
test.use({
  autoGoto: false,
  mockState: false,
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }
});

const SECTIONS = ['workspaces', 'kernels', 'terminals', 'servers'];
const KEY =
  '@stellarshenson/jupyterlab-workspace-manager-extension:closed-sections';
const ROW = '.jp-WorkspaceManager-row';
const TERMINALS = /\/jupyterlab-workspace-manager-extension\/terminals(\?.*)?$/;
const THEMES: [string, string][] = [
  ['JupyterLab Light', 'light'],
  ['JupyterLab Dark', 'dark'],
  ['Galaxa Dark Theme - Steel', 'steel']
];

const expanded = (page: Page) =>
  Promise.all(
    SECTIONS.map(name =>
      sectionHeader(page, name).getAttribute('aria-expanded')
    )
  );

/** The column of sections as the page draws it: each section's box, band, lines and list height. */
const column = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-list`).evaluate(list => {
    const box = (e: Element) => e.getBoundingClientRect();
    return {
      top: box(list).top,
      bottom: box(list).bottom,
      panelBottom: box(list.closest('#jp-running-sessions')!).bottom,
      sections: Array.from(list.children).map(s => {
        const style = getComputedStyle(s);
        const body = s.querySelector(
          ':scope > .jp-WorkspaceManager-sectionBody'
        );
        return {
          top: box(s).top,
          bottom: box(s).bottom,
          band: box(s.querySelector('.jp-WorkspaceManager-sectionHeader')!)
            .height,
          lines:
            parseFloat(style.borderTopWidth) +
            parseFloat(style.borderBottomWidth),
          body: body ? box(body).height : null
        };
      })
    };
  });

/** The computed value of `property` set to `value` on a probe in the panel: a token as the page resolves it. */
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

/** Start `n` kernels by REST and list only them. */
async function startKernels(page: Page, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const response = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    expect(response.ok()).toBe(true);
    ids.push((await response.json()).id);
  }
  await only(page, /\/api\/kernels(\?.*)?$/, k => ids.includes(k.id));
  // KERNELS also lists the kernel of every session; a session another spec left is not this test's
  await only(page, /\/api\/sessions(\?.*)?$/, s => ids.includes(s.kernel?.id));
  return ids;
}

/** Scroll the WORKSPACES list to its last entry with the wheel over `over`, the list itself by default. */
async function wheelToEnd(
  page: Page,
  over = sectionBody(page, 'workspaces')
): Promise<void> {
  const list = sectionBody(page, 'workspaces');
  await over.hover();
  await page.mouse.wheel(0, 100000);
  await expect
    .poll(() =>
      list.evaluate(n => n.scrollHeight - n.clientHeight - n.scrollTop)
    )
    .toBeLessThanOrEqual(1);
}

test.describe('with kernels of its own', () => {
  // the kernels are started by REST; Galata would list only its page's own
  test.use({ kernels: null, sessions: null });

  test('ACC-PANEL-307-HARMONICA-LAYOUT: one section open, WORKSPACES by default; an open KERNELS list takes the height the four bands leave, the bands above at the top and below at the panel bottom, each folded section its band only; a reload keeps it; a throwing localStorage and the all-closed value of release 1.0.9 open WORKSPACES', async ({
    page
  }) => {
    test.setTimeout(180000);
    const current = fresh('hlayout');
    const kernels = await startKernels(page, 2);
    try {
      await enterWorkspace(page, current);
      // a fresh profile: WORKSPACES alone is open
      expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
      await expect(sectionCount(page, 'kernels')).toHaveText('(2)', UNDER_LOAD);

      await openSection(page, 'kernels');
      await expect(sectionBody(page, 'kernels').locator(ROW)).toHaveCount(2);
      expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
      const drawn = await column(page);
      const [w, k, t, s] = drawn.sections;
      const bands = drawn.sections.reduce(
        (sum, x) => sum + x.band + x.lines,
        0
      );
      // the list of two rows takes the whole height the bands leave
      expect(
        Math.abs(k.body! - (drawn.bottom - drawn.top - bands))
      ).toBeLessThanOrEqual(1);
      expect(k.body!).toBeGreaterThan(2 * 24 + 100);
      // WORKSPACES at the top; TERMINALS and LANGUAGE SERVERS at the bottom edge
      expect(Math.abs(w.top - drawn.top)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.bottom - s.top)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(s.bottom - drawn.panelBottom)).toBeLessThanOrEqual(0.5);
      // a folded section is its band only
      for (const x of [w, t, s]) {
        expect(x.body).toBeNull();
        expect(
          Math.abs(x.bottom - x.top - x.band - x.lines)
        ).toBeLessThanOrEqual(0.5);
      }

      // a reload keeps KERNELS open
      await page.reload();
      await openPanel(page);
      await expect(sectionCount(page, 'kernels')).toHaveText('(2)', UNDER_LOAD);
      expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);

      // release 1.0.9 stored a panel with every section closed: WORKSPACES opens alone
      await page.evaluate(
        key =>
          localStorage.setItem(
            key,
            JSON.stringify(['workspaces', 'kernels', 'terminals', 'servers'])
          ),
        KEY
      );
      await page.reload();
      await openPanel(page);
      await expect(card(page, current)).toBeVisible(UNDER_LOAD);
      expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);

      // KERNELS stored open, then a localStorage that throws on the key: WORKSPACES opens
      await openSection(page, 'kernels');
      await page.addInitScript(key => {
        const [get, set] = [
          Storage.prototype.getItem,
          Storage.prototype.setItem
        ];
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
      }, KEY);
      await page.reload();
      await openPanel(page);
      await expect(card(page, current)).toBeVisible(UNDER_LOAD);
      expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
      await openSection(page, 'kernels');
      expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
    } finally {
      await Promise.all(
        kernels.map(id => page.request.delete(`/api/kernels/${id}`))
      );
      await deleteWorkspaces(page, [current]);
    }
  });

  test('ACC-PANEL-310-HARMONICA-PULL: under prefers-reduced-motion reduce, one wheel event past the WORKSPACES end eases the first KERNELS row in above the lower bands, and 500 ms later the bands are back in place', async ({
    page
  }) => {
    test.setTimeout(180000);
    const current = fresh('hpull');
    const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
    await Promise.all(many.map(id => putWorkspace(page, id)));
    const kernels = await startKernels(page, 1);
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await enterWorkspace(page, current);
      await expect(card(page, many[29])).toBeAttached();
      await expect(sectionCount(page, 'kernels')).toHaveText('(1)', UNDER_LOAD);
      const terminalsBand = () =>
        sectionHeader(page, 'terminals').evaluate(n => {
          const r = n.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
      const before = await terminalsBand();
      await wheelToEnd(page);
      // the panel as it draws the frame after the next wheel event
      await page.evaluate(() =>
        document.addEventListener(
          'wheel',
          () =>
            requestAnimationFrame(() => {
              const panel = document.querySelector('#jp-running-sessions')!;
              const body = panel.querySelector(
                '[data-section="kernels"] > .jp-WorkspaceManager-sectionBody'
              );
              (window as any).__pulled = body && {
                body: body.getBoundingClientRect().height,
                bodyTop: body.getBoundingClientRect().top,
                row: body
                  .querySelector('.jp-WorkspaceManager-row')!
                  .getBoundingClientRect().top,
                band: panel
                  .querySelector(
                    '[data-section="terminals"] > .jp-WorkspaceManager-sectionHeader'
                  )!
                  .getBoundingClientRect().top
              };
            }),
          { once: true }
        )
      );
      await page.mouse.wheel(0, 100);
      await expect
        .poll(() => page.evaluate(() => (window as any).__pulled))
        .toBeTruthy();
      const pulled = await page.evaluate(() => (window as any).__pulled);
      expect(pulled.body).toBe(3);
      // the first KERNELS row shows above the TERMINALS band
      expect(pulled.row).toBeGreaterThanOrEqual(pulled.bodyTop);
      expect(pulled.row).toBeLessThan(pulled.band);
      expect(
        await sectionHeader(page, 'kernels').getAttribute('aria-expanded')
      ).toBe('false');
      await page.waitForTimeout(500);
      await expect(sectionBody(page, 'kernels')).toHaveCount(0);
      expect(await terminalsBand()).toEqual(before);
      expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    } finally {
      await Promise.all(
        kernels.map(id => page.request.delete(`/api/kernels/${id}`))
      );
      await deleteWorkspaces(page, [current, ...many]);
    }
  });
});

test('ACC-PANEL-308-HARMONICA-WHEEL: over the open WORKSPACES list the browser scrolls it natively, 0.4 px steps included, and no wheel event is cancelled; over the folded TERMINALS band and over the title band each event is cancelled and scrolls the open WORKSPACES list, ten 0.4 px steps by their 4 px sum; TERMINALS stays folded, nothing else scrolls, and the title band, the filter field and the bands keep their boxes', async ({
  page
}) => {
  test.setTimeout(180000);
  const current = fresh('hwheel');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  await Promise.all(many.map(id => putWorkspace(page, id)));
  const terminals: string[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      terminals.push(await startTerminal(page));
    }
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    await headerButton(page, 'Filter').click();
    const list = sectionBody(page, 'workspaces');
    const drawn = () =>
      page.locator(PANEL).evaluate(panel => {
        const list = panel.querySelector(
          '[data-section="workspaces"] > .jp-WorkspaceManager-sectionBody'
        )!;
        const ancestors: Element[] = [];
        for (let e = panel.parentElement; e; e = e.parentElement) {
          ancestors.push(e);
        }
        return {
          boxes: [
            '.jp-WorkspaceManager-header',
            '.jp-WorkspaceManager-filter',
            ...['workspaces', 'kernels', 'terminals', 'servers'].map(
              n => `[data-section="${n}"] > .jp-WorkspaceManager-sectionHeader`
            )
          ].map(s => {
            const r = panel.querySelector(s)!.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          }),
          list: list.scrollTop,
          others: [...Array.from(panel.querySelectorAll('*')), ...ancestors]
            .filter(e => e !== list)
            .map(e => e.scrollTop)
        };
      });
    const before = await drawn();
    expect(before.list).toBe(0);
    // whether the panel cancelled each wheel event, read once `n` have arrived
    await page.evaluate(() => {
      (window as any).__cancelled = [];
      window.addEventListener('wheel', e =>
        (window as any).__cancelled.push(e.defaultPrevented)
      );
    });
    const cancelled = async (n: number): Promise<boolean[]> => {
      await expect
        .poll(() => page.evaluate(() => (window as any).__cancelled.length))
        .toBe(n);
      return page.evaluate(() => (window as any).__cancelled.splice(0));
    };
    /** The list's scrollTop once a native scroll has ended: two reads 100 ms apart agree. */
    const still = async (): Promise<number> => {
      let last = NaN;
      await expect
        .poll(
          async () => {
            const now = (await drawn()).list;
            const same = now === last;
            last = now;
            return same;
          },
          { intervals: [100] }
        )
        .toBe(true);
      return last;
    };
    const tenSteps = async (dy: number) => {
      for (let n = 0; n < 10; n++) {
        await page.mouse.wheel(0, dy);
      }
    };

    // over the open list at scrollTop 0 the browser scrolls it natively
    await list.hover();
    await page.mouse.wheel(0, 100);
    expect(await cancelled(1)).toEqual([false]);
    expect(await still()).toBeGreaterThan(0);
    const native = await drawn();
    // ten 0.4 px steps from scrollTop 0 move it natively too
    await list.evaluate(n => (n.scrollTop = 0));
    await tenSteps(0.4);
    expect(await cancelled(10)).toEqual(Array(10).fill(false));
    expect(await still()).toBeGreaterThan(0);
    const fraction = await drawn();

    // over the folded TERMINALS band ten 0.4 px steps move the list by their sum
    await sectionHeader(page, 'terminals').hover();
    await tenSteps(0.4);
    expect(await cancelled(10)).toEqual(Array(10).fill(true));
    const forwarded = await drawn();
    expect(Math.abs(forwarded.list - fraction.list - 4)).toBeLessThan(1);
    await page.mouse.wheel(0, 100);
    expect(await cancelled(1)).toEqual([true]);
    const first = await drawn();
    expect(first.list).toBeGreaterThan(forwarded.list);
    await expect(sectionHeader(page, 'terminals')).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    await page.locator(`${PANEL} .jp-WorkspaceManager-titleLabel`).hover();
    await page.mouse.wheel(0, 100);
    expect(await cancelled(1)).toEqual([true]);
    const second = await drawn();
    expect(second.list).toBeGreaterThan(first.list);
    expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    for (const after of [native, fraction, forwarded, first, second]) {
      expect(after.others).toEqual(before.others);
      expect(after.boxes).toEqual(before.boxes);
    }
  } finally {
    await Promise.all(
      terminals.map(t => page.request.delete(`/api/terminals/${t}`))
    );
    await deleteWorkspaces(page, [current, ...many]);
  }
});

test('ACC-PANEL-309-HARMONICA-SWITCH: the wheel to the WORKSPACES end stops there; 300 ms later the next wheel opens KERNELS', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hswitch');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  await Promise.all(many.map(id => putWorkspace(page, id)));
  try {
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    // every wheel event over the WORKSPACES band: the panel scrolls the list, pulls and switches
    await wheelToEnd(page, sectionHeader(page, 'workspaces'));
    // the first event at the last entry pulls and does not switch
    await page.mouse.wheel(0, 100);
    expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, 100);
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
  } finally {
    await deleteWorkspaces(page, [current, ...many]);
  }
});

test('DEF-PANEL-108-WHEEL-STUCK, ACC-PANEL-309-HARMONICA-SWITCH: with 30 workspaces and KERNELS at (0), from the WORKSPACES end one wheel pulls, 300 ms later one wheel opens KERNELS, then a wheel every 16 ms with no pause opens TERMINALS within 1500 ms', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hempty');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  await Promise.all(many.map(id => putWorkspace(page, id)));
  await only(page, /\/api\/kernels(\?.*)?$/, () => false);
  await only(page, /\/api\/sessions(\?.*)?$/, () => false);
  try {
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    await expect(sectionCount(page, 'kernels')).toHaveText('(0)', UNDER_LOAD);
    await wheelToEnd(page, sectionHeader(page, 'workspaces'));
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, 100);
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const start = Date.now();
    while (
      Date.now() - start < 1500 &&
      (await sectionHeader(page, 'terminals').getAttribute('aria-expanded')) !==
        'true'
    ) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(16);
    }
    expect(
      await sectionHeader(page, 'terminals').getAttribute('aria-expanded')
    ).toBe('true');
  } finally {
    await deleteWorkspaces(page, [current, ...many]);
  }
});

test('ACC-PANEL-311-HARMONICA-FOLD: under prefers-reduced-motion reduce a switch still folds: midway the entering KERNELS list is between 0 and its full height', async ({
  page
}) => {
  const current = fresh('hfold');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterWorkspace(page, current);
    const list = sectionBody(page, 'workspaces');
    await list.hover();
    // a list that does not overflow passes the wheel straight through: one event switches;
    // the KERNELS list 200 ms after that event, and after the fold
    await page.evaluate(() =>
      document.addEventListener(
        'wheel',
        () => {
          const kernels = () =>
            document
              .querySelector(
                '#jp-running-sessions [data-section="kernels"] > .jp-WorkspaceManager-sectionBody'
              )
              ?.getBoundingClientRect().height ?? 0;
          setTimeout(() => ((window as any).__midway = kernels()), 200);
          setTimeout(() => ((window as any).__full = kernels()), 900);
        },
        { once: true }
      )
    );
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => page.evaluate(() => (window as any).__full))
      .toBeGreaterThan(0);
    const [midway, full] = await page.evaluate(() => [
      (window as any).__midway,
      (window as any).__full
    ]);
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(full);
    expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-311-HARMONICA-FOLD: no settle follows a band click: with TERMINALS open, a click on the WORKSPACES band, then a wheel over the WORKSPACES list at most 200 ms after its fold ends scrolls it', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hsettle');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  await Promise.all(many.map(id => putWorkspace(page, id)));
  try {
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    await openSection(page, 'terminals');
    // the time the WORKSPACES list first has its full height, and the time of each wheel event
    await page.evaluate(() => {
      const w = window as any;
      w.__wheels = [];
      window.addEventListener('wheel', e => w.__wheels.push(e.timeStamp));
      const section = '#jp-running-sessions [data-section="workspaces"]';
      const watch = () => {
        const body = document.querySelector<HTMLElement>(
          `${section} > .jp-WorkspaceManager-sectionBody`
        );
        if (
          document
            .querySelector(`${section} > .jp-WorkspaceManager-sectionHeader`)
            ?.getAttribute('aria-expanded') === 'true' &&
          body?.style.flex === ''
        ) {
          w.__foldEnd = performance.now();
        } else {
          requestAnimationFrame(watch);
        }
      };
      requestAnimationFrame(watch);
    });
    const band = (await sectionHeader(page, 'workspaces').boundingBox())!;
    await sectionHeader(page, 'workspaces').click();
    // the pointer where the WORKSPACES list opens under its band
    await page.mouse.move(band.x + band.width / 2, band.y + band.height + 100);
    await page.waitForFunction(() => (window as any).__foldEnd, null, {
      polling: 'raf'
    });
    await page.mouse.wheel(0, 100);
    await expect
      .poll(() => sectionBody(page, 'workspaces').evaluate(n => n.scrollTop))
      .toBeGreaterThan(0);
    const [end, wheel] = await page.evaluate(() => [
      (window as any).__foldEnd,
      (window as any).__wheels[0]
    ]);
    // inside the 250 ms a settle would ignore
    expect(wheel - end).toBeLessThanOrEqual(200);
  } finally {
    await deleteWorkspaces(page, [current, ...many]);
  }
});

test('ACC-PANEL-312-HARMONICA-CLICK: a click on a folded band opens it and folds WORKSPACES; a click on the open band leaves it open; Enter opens a focused band and Space leaves it open; ArrowDown to the last row of a 30-row list scrolls it into view', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hclick');
  const other = `${current}-other`;
  const tabs = Array.from({ length: 30 }, (_, i) => `editor:notes-${i}.md`);
  await putWorkspace(page, other, layout(tabs));
  try {
    await enterWorkspace(page, current);
    expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    await sectionHeader(page, 'terminals').click();
    await expect(sectionHeader(page, 'terminals')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(sectionHeader(page, 'workspaces')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await atRest(page);
    await sectionHeader(page, 'terminals').click();
    await page.waitForTimeout(500);
    expect(await expanded(page)).toEqual(['false', 'false', 'true', 'false']);
    await expect(sectionBody(page, 'terminals')).toHaveCount(1);

    await sectionHeader(page, 'kernels').focus();
    await page.keyboard.press('Enter');
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await atRest(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);

    // the open list keeps its native keyboard scrolling
    await openSection(page, 'workspaces');
    await openCard(page, other);
    const rows = card(page, other).locator(ROW);
    await expect(rows).toHaveCount(30);
    await rows.first().focus();
    for (let i = 1; i < 30; i++) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(rows.last()).toBeFocused();
    const shown = await sectionBody(page, 'workspaces').evaluate(list => {
      const rows = list.querySelectorAll('.jp-WorkspaceManager-row');
      const last = rows[rows.length - 1].getBoundingClientRect();
      const box = list.getBoundingClientRect();
      return {
        scrolled: list.scrollTop,
        // its first line: a selected row grows by its detail lines
        inside: last.top >= box.top - 0.5 && last.top + 24 <= box.bottom + 0.5
      };
    });
    expect(shown.scrolled).toBeGreaterThan(0);
    expect(shown.inside).toBe(true);
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-PANEL-312-HARMONICA-CLICK: with 30 workspaces and the WORKSPACES list at scrollTop 200, a click on the TERMINALS band keeps that list at scrollTop 200 midway through the fold', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hkeep');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  await Promise.all(many.map(id => putWorkspace(page, id)));
  try {
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    const list = sectionBody(page, 'workspaces');
    await list.evaluate(n => (n.scrollTop = 200));
    expect(await list.evaluate(n => n.scrollTop)).toBe(200);
    // the WORKSPACES list 200 ms after the click, midway through the fold
    await page.evaluate(() =>
      document.addEventListener(
        'click',
        () =>
          setTimeout(() => {
            const body = document.querySelector(
              '#jp-running-sessions [data-section="workspaces"] > .jp-WorkspaceManager-sectionBody'
            );
            (window as any).__midway = body && {
              top: body.scrollTop,
              height: body.getBoundingClientRect().height
            };
          }, 200),
        { once: true, capture: true }
      )
    );
    await sectionHeader(page, 'terminals').click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__midway !== undefined))
      .toBe(true);
    const midway = await page.evaluate(() => (window as any).__midway);
    expect(midway.height).toBeGreaterThan(0);
    expect(midway.top).toBe(200);
  } finally {
    await deleteWorkspaces(page, [current, ...many]);
  }
});

test('ACC-PANEL-316-HARMONICA-FOCUS: a WORKSPACES row focused with the keyboard, then a wheel switch to KERNELS: the focus moves to the KERNELS band; the filter field focused, then a wheel switch back to WORKSPACES: the focus stays on the filter field', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hfocus');
  const other = `${current}-other`;
  await putWorkspace(
    page,
    other,
    layout(['editor:a.md', 'editor:b.md', 'editor:c.md'])
  );
  /** Where the focus is, for the failure message. */
  const focus = () =>
    page.evaluate(
      () =>
        `focus on ${document.activeElement?.tagName} ${document.activeElement?.className}`
    );
  try {
    await enterWorkspace(page, current);
    await openCard(page, other);
    const rows = card(page, other).locator(ROW);
    await expect(rows).toHaveCount(3);
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    // the WORKSPACES list does not overflow, so it passes the wheel straight through: one event switches
    await sectionBody(page, 'workspaces').hover();
    await page.mouse.wheel(0, 100);
    await expect(sectionHeader(page, 'kernels')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    // the fold has removed the WORKSPACES list and the focused row with it
    await atRest(page);
    await expect(sectionHeader(page, 'kernels'), await focus()).toBeFocused();

    const input = page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`);
    await headerButton(page, 'Filter').click();
    await expect(input).toBeFocused();
    // past the 250 ms settle; the fold left the KERNELS list at its top
    await page.waitForTimeout(300);
    // the KERNELS list does not overflow either: one event switches
    await sectionBody(page, 'kernels').hover();
    await page.mouse.wheel(0, -100);
    await expect(sectionHeader(page, 'workspaces')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await atRest(page);
    await expect(input, await focus()).toBeFocused();
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-PANEL-314-HARMONICA-SEPARATOR: with each section open in turn every folded section draws one 1 px --jp-layout-color3 line under its band, LANGUAGE SERVERS included at the panel bottom, and the open one none; the sections touch; the WORKSPACES top line shows without the filter field and not with it; the title band keeps its --jp-border-color2 rule; in Light, Dark and Steel', async ({
  page
}) => {
  test.setTimeout(240000);
  const current = fresh('hsep');
  try {
    await enterWorkspace(page, current);
    for (const [theme] of THEMES) {
      await page.theme.setTheme(theme);
      await page.mouse.move(0, 0);
      const line = [
        'solid',
        '1px',
        await token(page, 'borderBottomColor', 'var(--jp-layout-color3)')
      ];
      const title = [
        'solid',
        '1px',
        await token(page, 'borderBottomColor', 'var(--jp-border-color2)')
      ];
      for (const filtering of [false, true]) {
        if (filtering) {
          await headerButton(page, 'Filter').click();
        }
        await expect(
          page.locator(`${PANEL} .jp-WorkspaceManager-filter`)
        ).toHaveCount(filtering ? 1 : 0);
        for (const open of SECTIONS) {
          await openSection(page, open);
          const drawn = await page.locator(PANEL).evaluate(panel => {
            const rule = (s: CSSStyleDeclaration, side: 'Top' | 'Bottom') => [
              s[`border${side}Style`],
              s[`border${side}Width`],
              s[`border${side}Color`]
            ];
            return {
              panelBottom: panel.getBoundingClientRect().bottom,
              title: rule(
                getComputedStyle(
                  panel.querySelector('.jp-WorkspaceManager-header')!
                ),
                'Bottom'
              ),
              sections: Array.from(
                panel.querySelectorAll<HTMLElement>(
                  '.jp-WorkspaceManager-section'
                )
              ).map(section => {
                const s = getComputedStyle(section);
                const r = section.getBoundingClientRect();
                return {
                  name: section.dataset.section,
                  top: r.top,
                  bottom: r.bottom,
                  topRule: rule(s, 'Top'),
                  bottomRule: rule(s, 'Bottom')
                };
              })
            };
          });
          const state = `${theme}, ${open} open, filter ${filtering}`;
          expect.soft(drawn.title, `${state}: title band`).toEqual(title);
          const [workspaces] = drawn.sections;
          expect
            .soft(
              filtering ? workspaces.topRule.slice(0, 2) : workspaces.topRule,
              `${state}: WORKSPACES top`
            )
            .toEqual(filtering ? ['none', '0px'] : line);
          drawn.sections.forEach((section, i) => {
            expect
              .soft(
                section.name === open
                  ? section.bottomRule.slice(0, 2)
                  : section.bottomRule,
                `${state}: ${section.name} bottom`
              )
              .toEqual(section.name === open ? ['none', '0px'] : line);
            if (i > 0) {
              expect
                .soft(section.topRule[1], `${state}: ${section.name} top`)
                .toBe('0px');
              expect
                .soft(
                  Math.abs(section.top - drawn.sections[i - 1].bottom),
                  `${state}: ${drawn.sections[i - 1].name} to ${section.name}`
                )
                .toBeLessThanOrEqual(0.5);
            }
          });
          expect
            .soft(
              Math.abs(
                drawn.panelBottom - drawn.sections[SECTIONS.length - 1].bottom
              ),
              `${state}: LANGUAGE SERVERS to the panel bottom`
            )
            .toBeLessThanOrEqual(0.5);
        }
        if (filtering) {
          await headerButton(page, 'Filter').click();
        }
      }
    }
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-FILTER-315-HARMONICA-FILTER: typing in the filter field while KERNELS is open switches the panel to WORKSPACES with the matching cards in view; clearing the filter leaves the open TERMINALS open', async ({
  page
}) => {
  const current = fresh('hfilter');
  const [a, b, c] = [
    `${current}-kiwi-a`,
    `${current}-kiwi-b`,
    `${current}-plum`
  ];
  await Promise.all([a, b, c].map(id => putWorkspace(page, id)));
  try {
    await enterWorkspace(page, current);
    await expect(card(page, c)).toBeAttached();
    await openSection(page, 'kernels');
    await headerButton(page, 'Filter').click();
    const field = page.locator(`${PANEL} .jp-WorkspaceManager-filterInput`);
    await expect(field).toBeFocused();
    // the filter field alone switches nothing
    expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
    await field.fill('kiwi');
    await expect(sectionHeader(page, 'workspaces')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(await expanded(page)).toEqual(['true', 'false', 'false', 'false']);
    await expect(card(page, a)).toBeInViewport();
    await expect(card(page, b)).toBeInViewport();
    await expect(card(page, c)).toHaveCount(0);

    await openSection(page, 'terminals');
    await page.locator(`${PANEL} button[aria-label="Clear filter"]`).click();
    await expect(field).toHaveValue('');
    await page.waitForTimeout(500);
    expect(await expanded(page)).toEqual(['false', 'false', 'true', 'false']);
  } finally {
    await deleteWorkspaces(page, [current, a, b, c]);
  }
});

test('ACC-PANEL-146-NEW-STAY: with KERNELS open, the + click opens the dialog and folds nothing; after Create the panel switches to WORKSPACES, the window stays and the new card is open and in view', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('hstay');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  const created = `${current}-new`;
  await Promise.all(many.map(id => putWorkspace(page, id)));
  try {
    await enterWorkspace(page, current);
    await expect(card(page, many[29])).toBeAttached();
    await openSection(page, 'kernels');
    const url = page.url();
    await newButton(page).click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'New workspace'
    );
    expect(await expanded(page)).toEqual(['false', 'true', 'false', 'false']);
    await dialog(page).locator('input').fill(created);
    await dialog(page).locator('input').press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect(sectionHeader(page, 'workspaces')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(triangle(page, created)).toHaveAttribute(
      'aria-expanded',
      'true',
      UNDER_LOAD
    );
    await expect(card(page, created)).toBeInViewport();
    expect(page.url()).toBe(url);
  } finally {
    await deleteWorkspaces(page, [current, created, ...many]);
  }
});

test.describe('in a 520 px window', () => {
  test.use({
    kernels: null,
    sessions: null,
    viewport: { width: 1024, height: 520 }
  });

  test('ACC-PANEL-313-HARMONICA-EDGE: the open list reserves no strip; a row keeps its time x and content width when its list starts to draw a scrollbar, and its fill reaches the panel edge without one and the scrollbar with one; a card header keeps its eye and time x', async ({
    page
  }) => {
    test.setTimeout(300000);
    const current = fresh('hedge');
    const terminals: string[] = [];
    let listed = 0;
    let shown = 1;
    const others = Array.from({ length: 20 }, (_, i) => `${current}-${i}`);
    try {
      for (let i = 0; i < 3; i++) {
        terminals.push(await startTerminal(page));
      }
      listed = 3;
      await only(page, TERMINALS, t =>
        terminals.slice(0, listed).includes(t.name)
      );
      // the current workspace and the first shown - 1 of the others
      await onlyWorkspaces(
        page,
        id => id === current || others.slice(0, shown - 1).includes(id)
      );
      await gotoWorkspace(page, current);
      await openPanel(page);
      await refresh(page);

      // a list's scrollbar, the rows' right edges, times and content widths
      const measure = (name: string) =>
        sectionBody(page, name).evaluate(list => {
          const panel = list.closest('#jp-running-sessions')!;
          const right = (e: Element) => e.getBoundingClientRect().right;
          const rows: Record<string, number[]> = {};
          for (const r of Array.from(
            list.querySelectorAll<HTMLElement>(
              ':scope > .jp-WorkspaceManager-row'
            )
          )) {
            const s = getComputedStyle(r);
            rows[r.dataset.rowKey!] = [
              right(r.querySelector('.jp-WorkspaceManager-age')!),
              r.clientWidth -
                parseFloat(s.paddingLeft) -
                parseFloat(s.paddingRight),
              right(r)
            ];
          }
          const header = panel.querySelector(
            '.jp-WorkspaceManager-card.jp-mod-current .jp-WorkspaceManager-cardHeader'
          );
          return {
            bar: (list as HTMLElement).offsetWidth - list.clientWidth,
            gutter: getComputedStyle(list).scrollbarGutter,
            panelRight: right(panel),
            clientRight:
              list.getBoundingClientRect().left +
              list.clientLeft +
              list.clientWidth,
            rows,
            eye:
              header &&
              right(
                header.querySelector('.jp-WorkspaceManager-cardActions button')!
              ),
            age:
              header && right(header.querySelector('.jp-WorkspaceManager-age')!)
          };
        });
      const hovered = async (name: string) => {
        const row = sectionBody(page, name).locator(ROW).first();
        await row.hover();
        return row.evaluate(r => [
          getComputedStyle(r).backgroundColor,
          r.getBoundingClientRect().right
        ]);
      };

      // TERMINALS with 3 rows draws no scrollbar: the fill reaches the panel edge
      await openSection(page, 'terminals');
      await expect(sectionBody(page, 'terminals').locator(ROW)).toHaveCount(3);
      const fit = await measure('terminals');
      expect(fit.bar).toBe(0);
      expect(fit.gutter).toBe('auto');
      const [fill, edge] = await hovered('terminals');
      expect(fill).not.toBe('rgba(0, 0, 0, 0)');
      expect(Math.abs((edge as number) - fit.panelRight)).toBeLessThanOrEqual(
        0.5
      );

      // terminals until the list overflows: it draws a scrollbar
      while (terminals.length < 40) {
        for (let i = 0; i < 4; i++) {
          terminals.push(await startTerminal(page));
        }
        listed = terminals.length;
        await refresh(page);
        await expect(sectionCount(page, 'terminals')).toHaveText(
          `(${listed})`,
          UNDER_LOAD
        );
        if ((await measure('terminals')).bar > 0) {
          break;
        }
      }
      const over = await measure('terminals');
      expect(over.bar).toBeGreaterThan(0);
      for (const key of Object.keys(fit.rows)) {
        const [time, width] = fit.rows[key];
        expect(
          Math.abs(over.rows[key][0] - time),
          `${key} time`
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(over.rows[key][1] - width),
          `${key} width`
        ).toBeLessThanOrEqual(0.5);
      }
      const [overFill, overEdge] = await hovered('terminals');
      expect(overFill).not.toBe('rgba(0, 0, 0, 0)');
      expect(
        Math.abs((overEdge as number) - over.clientRight)
      ).toBeLessThanOrEqual(0.5);

      // a card header keeps its eye and time x when WORKSPACES starts to draw a scrollbar
      await openSection(page, 'workspaces');
      const card1 = await measure('workspaces');
      expect(card1.bar).toBe(0);
      expect(card1.eye).not.toBeNull();
      await Promise.all(others.map(id => putWorkspace(page, id)));
      shown = others.length + 1;
      await refresh(page);
      await expect(sectionCount(page, 'workspaces')).toHaveText(
        `(${shown})`,
        UNDER_LOAD
      );
      const cards = await measure('workspaces');
      expect(cards.bar).toBeGreaterThan(0);
      expect(Math.abs(cards.eye! - card1.eye!)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cards.age! - card1.age!)).toBeLessThanOrEqual(0.5);
    } finally {
      await Promise.all(
        terminals.map(t => page.request.delete(`/api/terminals/${t}`))
      );
      await deleteWorkspaces(page, [current, ...others]);
    }
  });

  test('HARMONICA-RENDER ACC-PANEL-307-HARMONICA-LAYOUT, ACC-PANEL-310-HARMONICA-PULL, ACC-PANEL-313-HARMONICA-EDGE: screenshots in Light, Dark and Steel of WORKSPACES open with several cards, KERNELS open between the bands at the top and the bottom edge, the pull preview held at 22 px and a list that draws a scrollbar', async ({
    page
  }, testInfo) => {
    test.setTimeout(300000);
    const shots = process.env.WM_SHOTS_DIR ?? testInfo.outputDir;
    const current = fresh('hrender');
    const others = Array.from({ length: 14 }, (_, i) => `${current}-${i}`);
    let shown = 4;
    const kernels = await startKernels(page, 2);
    const terminal = await startTerminal(page);
    await only(page, TERMINALS, t => t.name === terminal);
    await Promise.all(
      others.map((id, i) =>
        putWorkspace(
          page,
          id,
          layout([
            ...(i === 0 ? [`terminal:${terminal}`] : []),
            ...Array.from(
              { length: (i % 3) + 1 },
              (_, j) => `editor:${id}-${j}.md`
            )
          ])
        )
      )
    );
    try {
      // the current workspace and the first shown - 1 of the others
      await onlyWorkspaces(
        page,
        id => id === current || others.slice(0, shown - 1).includes(id)
      );
      await gotoWorkspace(page, current);
      await openPanel(page);
      await Promise.all(
        others
          .slice(0, 3)
          .map((id, i) =>
            patchMeta(page, id, { colour: ['rose', 'mint', 'sky'][i] })
          )
      );
      await refresh(page);
      await expect(sectionCount(page, 'workspaces')).toHaveText('(4)');
      await expect(sectionCount(page, 'kernels')).toHaveText('(2)', UNDER_LOAD);
      await openCard(page, others[0]);
      await openCard(page, others[2]);
      for (const [theme, tag] of THEMES) {
        await page.theme.setTheme(theme);
        const shot = (name: string) =>
          page.locator(PANEL).screenshot({
            path: path.join(shots, `harmonica-${name}-${tag}.png`)
          });

        // WORKSPACES open with several cards
        shown = 4;
        await refresh(page);
        await openSection(page, 'workspaces');
        await expect(
          page.locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`)
        ).toHaveCount(4);
        await page.mouse.move(0, 0);
        await shot('workspaces');

        // KERNELS open: WORKSPACES at the top, TERMINALS and LANGUAGE SERVERS at the bottom edge
        await openSection(page, 'kernels');
        const drawn = await column(page);
        expect(Math.abs(drawn.sections[0].top - drawn.top)).toBeLessThanOrEqual(
          0.5
        );
        expect(
          Math.abs(drawn.sections[3].bottom - drawn.panelBottom)
        ).toBeLessThanOrEqual(0.5);
        await shot('kernels');

        // a list that draws a scrollbar
        await openSection(page, 'workspaces');
        shown = others.length + 1;
        await refresh(page);
        await expect(sectionCount(page, 'workspaces')).toHaveText(`(${shown})`);
        const bar = await sectionBody(page, 'workspaces').evaluate(
          n => (n as HTMLElement).offsetWidth - n.clientWidth
        );
        expect(bar).toBeGreaterThan(0);
        await page.mouse.move(0, 0);
        await shot('scrollbar');

        // the pull preview held at 22 px, on this list that overflows (a list that fits passes the
        // wheel straight through): eight wheel events at the last entry, then one every 100 ms
        // until 300 ms; a held pull never switches, and no spring starts before 460 ms
        const pull = await page.locator(PANEL).evaluate(panel => {
          const list = panel.querySelector<HTMLElement>(
            '[data-section="workspaces"] > .jp-WorkspaceManager-sectionBody'
          )!;
          list.scrollTop = list.scrollHeight;
          const wheel = () =>
            list.dispatchEvent(
              new WheelEvent('wheel', {
                deltaY: 100,
                bubbles: true,
                cancelable: true
              })
            );
          for (let i = 0; i < 8; i++) {
            wheel();
          }
          let n = 0;
          const timer = setInterval(() => {
            wheel();
            if (++n === 3) {
              clearInterval(timer);
            }
          }, 100);
          return panel
            .querySelector(
              '[data-section="kernels"] > .jp-WorkspaceManager-sectionBody'
            )!
            .getBoundingClientRect().height;
        });
        expect(pull).toBe(22);
        await shot('pull');
        await page.waitForTimeout(1200);
        await atRest(page);
        expect(await expanded(page)).toEqual([
          'true',
          'false',
          'false',
          'false'
        ]);
      }
    } finally {
      await Promise.all([
        ...kernels.map(id => page.request.delete(`/api/kernels/${id}`)),
        page.request.delete(`/api/terminals/${terminal}`)
      ]);
      await deleteWorkspaces(page, [current, ...others]);
    }
  });
});
