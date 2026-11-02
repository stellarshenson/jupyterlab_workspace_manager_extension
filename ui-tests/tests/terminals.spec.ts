import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  countOf,
  cut,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  fromRowMenu,
  layout,
  newTerminalTab,
  openCard,
  openSection,
  PANEL,
  PROCESS_START,
  processOf,
  putWorkspace,
  refresh,
  rgba,
  rowOf,
  sectionBody,
  sendToTerminal,
  serverList,
  shows,
  sidebarTo,
  sleepInTerminal,
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
  const row = rowOf(card(page, current), `terminal ${name}`);
  await expect(row).toBeVisible();
  return { name, row };
}

const SELECTED = /jp-mod-selected/;
const LABEL = '.jp-WorkspaceManager-rowLabel';
const PROCESS = '.jp-WorkspaceManager-rowProcess';
const AGE = '.jp-WorkspaceManager-age';
const DETAIL = '.jp-WorkspaceManager-rowDetail';

/** The whole text of a terminal row: its name, its process when one is known and its time. */
const rowText = (name: string, process = ''): RegExp =>
  new RegExp(`^terminal ${name}${process}(now|\\d+m ago)$`);

/** A computed style of an element. */
const css = (l: Locator, property: string): Promise<string> =>
  l.evaluate(
    (n, property) => (getComputedStyle(n) as any)[property] as string,
    property
  );

/** The name, the process and the time stand side by side on one line, in that order. */
const oneLine = (row: Locator): Promise<boolean> =>
  row.evaluate(
    (r, parts) => {
      const boxes = parts.map(s => r.querySelector(s)!.getBoundingClientRect());
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

/** Answer GET of the terminals route with each terminal's process replaced by what `process` gives. */
const processIs = (page: Page, process: (name: string) => string | null) =>
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
            process: process(t.name)
          }))
        : undefined;
      await route.fulfill({ response, json });
    }
  );

test('ACC-TERM-42-PROCESS, ACC-TERM-46-NAME, ACC-TERM-113-PROCESS-LIVE: a terminal row, in a card and in TERMINALS, shows terminal <n>, the process the server reports and its age with no selection, the process in inverse layout colour 1 at the size of the time; selecting the row adds no text; another program shows at the next reload', async ({
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
    await expect(row).toHaveText(rowText(name, 'sleep'));
    expect(await oneLine(row)).toBe(true);
    expect(await shows(row, PROCESS)).toMatchObject({
      inside: true,
      whole: true
    });
    await expect(row.locator(DETAIL)).toHaveCount(0);
    expect(await rgba(page, await css(process, 'color'))).toEqual(
      await rgba(page, 'var(--jp-inverse-layout-color1)')
    );
    expect(await css(process, 'fontSize')).toBe(
      await css(row.locator(AGE), 'fontSize')
    );

    // selected: the process once, in the line, and no detail line
    await row.focus();
    await expect(row).toHaveClass(SELECTED);
    await expect(row.getByText('sleep', { exact: true })).toHaveCount(1);
    await expect(row).toHaveText(rowText(name, 'sleep'));
    await expect(row.locator(DETAIL)).toHaveCount(0);
    // the selection stays while the terminal tab has the focus
    await terminalTab(page).click();
    await expect(row).toHaveClass(SELECTED);

    // the TERMINALS section, with no selection and then selected
    await openSection(page, 'terminals');
    const listed = rowOf(sectionBody(page, 'terminals'), `terminal ${name}`);
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
    const row = rowOf(scope, `terminal ${short}`);
    await expect(row.locator(PROCESS)).toHaveText(long);
    expect(await cut(row, PROCESS)).toEqual([long]);
    expect(await css(row.locator(PROCESS), 'textOverflow')).toBe('ellipsis');
    expect(await cut(row, LABEL)).toEqual([]);
    expect(await shows(row, AGE)).toMatchObject({ inside: true, whole: true });
    expect((await shows(row, PROCESS)).inside).toBe(true);
    expect(await oneLine(row)).toBe(true);

    const cramped = rowOf(scope, `terminal ${wide.name}`);
    expect((await shows(cramped, PROCESS)).width).toBe(0);
    expect(await cut(cramped, LABEL)).toEqual([`terminal ${wide.name}`]);
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
    await expect(row).toHaveText(rowText(terminal));
    await row.focus();
    await expect(row).toHaveClass(SELECTED);
    await expect(row).toHaveText(rowText(terminal));
    await expect(row.locator(DETAIL)).toHaveCount(0);
  };
  try {
    await enterWorkspace(page, current);
    await triangle(page, held).click();
    const row = rowOf(card(page, held), `terminal ${terminal}`);
    // the same row shows the process while the server reports one
    await expect(row.locator(PROCESS)).toHaveText('known');
    unread = true;
    await refresh(page);
    await check(row);
    await openSection(page, 'terminals');
    await check(rowOf(sectionBody(page, 'terminals'), `terminal ${terminal}`));
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

test('ACC-PANEL-185-ROW-TOOLTIP: the tooltip of a terminal row is its name, the process and when it was last active, not the title of its tab', async ({
  page
}) => {
  const current = fresh('title');
  const title = fresh('wm-title');
  try {
    const { name, row } = await terminalHere(page, current);
    await expect
      .poll(async () => {
        await refresh(page);
        return (await row.getAttribute('title'))!.split('\n')[1];
      }, UNDER_LOAD)
      .toBe('bash');
    const tabTitle = () =>
      page.evaluate(
        () => (window as any).jupyterapp.shell.currentWidget.title.label
      );
    const age = await row.locator('.jp-WorkspaceManager-age').textContent();
    await expect(row).toHaveAttribute(
      'title',
      `terminal ${name}\nbash\n${age}`
    );

    // OSC 2 sets the window title, which the terminal tab shows; the tooltip
    // keeps the terminal's own details
    await typeInTerminal(page, `printf '\\033]2;%s\\007' ${title}\n`);
    await expect.poll(tabTitle, UNDER_LOAD).toBe(title);
    await refresh(page);
    const lines = (await row.getAttribute('title'))!.split('\n');
    expect(lines.slice(0, 2)).toEqual([`terminal ${name}`, 'bash']);
    expect(lines).not.toContain(title);
  } finally {
    await deleteWorkspaces(page, [current]);
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
      rowOf(card(page, other), `terminal ${terminal}`),
      'Stop terminal'
    );
    // the route leaves out the ended pty, so the row leaves at the load after the DELETE
    await expect(
      page.locator(PANEL).getByText(`terminal ${terminal}`, { exact: true })
    ).toHaveCount(0);
    await expect(countOf(card(page, other), 'Terminals')).toHaveText('0');
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
  const row = () => rowOf(card(page, a), `terminal ${terminal}`);
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
    await expect(
      page.locator(PANEL).getByText(`terminal ${terminal}`, { exact: true })
    ).toHaveCount(0);
    for (const id of [a, b]) {
      await openCard(page, id);
      await expect(countOf(card(page, id), 'Terminals')).toHaveText('0');
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
    const listed = () =>
      rowOf(sectionBody(page, 'terminals'), `terminal ${name}`);
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
    const cardRow = rowOf(card(page, current), `terminal ${name}`);
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
    const row = () => rowOf(sectionBody(page, 'terminals'), `terminal ${name}`);
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
