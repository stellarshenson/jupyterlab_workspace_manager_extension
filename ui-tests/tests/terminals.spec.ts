import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator, Page } from '@playwright/test';

import {
  card,
  cardHeader,
  countOf,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  fromRowMenu,
  layout,
  newTerminalTab,
  PANEL,
  putWorkspace,
  refresh,
  rowOf,
  serverList,
  startTerminal,
  terminalNames,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

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

test('ACC-TERM-42-PROCESS, ACC-TERM-46-NAME, ACC-TERM-113-PROCESS-LIVE: a terminal row shows its foreground process, then the terminal name; another program shows at the next reload', async ({
  page
}) => {
  const current = fresh('process');
  try {
    const { name, row } = await terminalHere(page, current);
    const label = row.locator('.jp-WorkspaceManager-rowLabel');
    // the shell of the Galata test server
    await expect.poll(afterRefresh(page, label), UNDER_LOAD).toBe('bash');
    await expect(
      row.locator(
        '.jp-WorkspaceManager-rowLabel, .jp-WorkspaceManager-rowDetail'
      )
    ).toHaveText(['bash', `terminal ${name}`]);

    await typeInTerminal(page, 'sleep 300\n');
    await expect.poll(afterRefresh(page, label), UNDER_LOAD).toBe('sleep');
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      `terminal ${name}`
    );

    await terminalTab(page).click();
    await page.keyboard.press('Control+c');
    await expect.poll(afterRefresh(page, label), UNDER_LOAD).toBe('bash');
  } finally {
    await deleteWorkspaces(page, [current]);
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
    await expect(when).toHaveText('1m', { timeout: 100000 });
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
    const label = row.locator('.jp-WorkspaceManager-rowLabel');
    await expect
      .poll(async () => {
        await refresh(page);
        return label.textContent();
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

test('ACC-TERM-111-SHUTDOWN: Shut down terminal ends the terminal, and its row leaves every card', async ({
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
      'Shut down terminal'
    );
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    // one workspace holds it: no question
    await expect(dialog(page)).toHaveCount(0);
    // at load the server lists the terminal for seconds after the DELETE, until
    // its pty closes; the panel drops the row at its next 10 s poll
    await expect(
      page.locator(PANEL).getByText(`terminal ${terminal}`, { exact: true })
    ).toHaveCount(0, UNDER_LOAD);
    await expect(countOf(card(page, other), 'Terminals')).toHaveText('0');
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

    await fromRowMenu(row(), 'Shut down terminal');
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

    await fromRowMenu(row(), 'Shut down terminal');
    await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(terminal);
    // the server's list lags the DELETE; the row leaves at the next 10 s poll
    await expect(
      page.locator(PANEL).getByText(`terminal ${terminal}`, { exact: true })
    ).toHaveCount(0, UNDER_LOAD);
    for (const id of [a, b]) {
      await expect(countOf(card(page, id), 'Terminals')).toHaveText('0');
    }
  } finally {
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, a, b]);
  }
});
