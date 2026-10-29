import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  kernelIds,
  layout,
  listed,
  newTerminalTab,
  openDocument,
  putNotebook,
  putWorkspace,
  refresh,
  saved,
  secondWindow,
  sectionHeader,
  serverList,
  startTerminal,
  terminalNames,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

/** The keys of a saved workspace's main area. */
function mainTabs(data: any): string[] {
  const keys: string[] = [];
  const walk = (area: any) => {
    if (!area) {
      return;
    }
    if (area.type === 'tab-area') {
      keys.push(...(area.widgets ?? []));
      return;
    }
    for (const child of area.children ?? []) {
      walk(child);
    }
  };
  walk(data?.['layout-restorer:data']?.main?.dock);
  return keys;
}

/** The session the server runs for a notebook, once its kernel is up. */
async function sessionOf(page: Page, path: string): Promise<any> {
  let session: any;
  await expect
    .poll(async () => {
      const sessions = await serverList(page, '/api/sessions');
      session = sessions.find(s => s.path === path && s.kernel);
      return !!session;
    }, UNDER_LOAD)
    .toBe(true);
  return session;
}

/** One workspace row of the clean-up confirmation, found by its exact name. */
const cleanRow = (page: Page, id: string) =>
  dialog(page)
    .locator('.jp-WorkspaceManager-cleanupRow')
    .filter({ has: page.getByText(id, { exact: true }) });

test('ACC-ACCORD-221-CLEAN-BUTTON: the WORKSPACES band carries the same 22 px broom as the bands below it, named Clean up workspaces and enabled by a second workspace', async ({
  page
}: {
  page: IJupyterLabPageFixture;
}) => {
  const current = fresh('cleanbtn');
  const other = `${current}-other`;
  try {
    await enterWorkspace(page, current);
    const broom = sectionHeader(page, 'workspaces').getByRole('button', {
      name: 'Clean up workspaces',
      exact: true
    });
    await expect(broom).toBeVisible();
    // the three bands below carry the same broom, 22 px square with a 14 px glyph
    const below = sectionHeader(page, 'kernels').getByRole('button', {
      name: 'Shut down all',
      exact: true
    });
    const box = (await broom.boundingBox())!;
    const belowBox = (await below.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([
      Math.round(belowBox.width),
      Math.round(belowBox.height)
    ]);
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([22, 22]);
    const glyph = (await broom.locator('svg').boundingBox())!;
    expect(Math.round(glyph.width)).toBe(14);
    expect(Math.round(glyph.height)).toBe(14);

    await putWorkspace(page, other);
    await refresh(page);
    await expect(broom).toBeEnabled();
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test('ACC-ACCORD-223-CLEAN-ACTION: the WORKSPACES broom deletes every workspace but this one, empties this one, and keeps the one another window shows', async ({
  page,
  tmpPath
}: {
  page: IJupyterLabPageFixture;
  tmpPath: string;
}) => {
  test.setTimeout(180000);
  const current = fresh('clean');
  const other = `${current}-other`;
  const kept = `${current}-kept`;
  const notebook = `${tmpPath}/design.ipynb`;
  await putNotebook(page, notebook);
  await putWorkspace(page, other, layout(['editor:docs/README.md']));
  const keptTerminal = await startTerminal(page);
  await putWorkspace(page, kept, layout([`terminal:${keptTerminal}`]));
  let otherWindow: Page | undefined;
  let mine: string | undefined;
  let kernel: string | undefined;
  try {
    await enterWorkspace(page, current);
    // this window's workspace holds a notebook with its kernel and a terminal
    await openDocument(page, notebook);
    const session = await sessionOf(page, notebook);
    kernel = session.kernel.id;
    mine = await newTerminalTab(page);
    await refresh(page);
    // a second window shows `kept`: its report makes clean-up keep it
    otherWindow = await secondWindow(page, kept);
    await refresh(page);
    // the kernel's language info is in the notebook metadata now; save it so the
    // close needs no save question (ACC-ACCORD-25 keeps that question for an
    // unsaved document)
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:save-all')
    );
    await expect(
      page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-dirty')
    ).toHaveCount(0);

    const broom = sectionHeader(page, 'workspaces').getByRole('button', {
      name: 'Clean up workspaces',
      exact: true
    });
    await expect(broom).toBeVisible();
    await broom.click();
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Clean up workspaces'
    );
    // the count line names the outcomes; the list names every workspace and what it holds
    await expect(
      dialog(page).locator('.jp-WorkspaceManager-cleanupSummary')
    ).toHaveText(
      `Clean up 3 workspaces? 1 is deleted, ${current} is emptied, and ${kept} is kept because another window shows it.`
    );
    const own = cleanRow(page, current);
    await expect(own.locator('.jp-WorkspaceManager-cleanupOutcome')).toHaveText(
      'emptied'
    );
    await expect(own).toContainText(`Tabs: Launcher, ${notebook}`);
    await expect(own).toContainText(`Terminals: terminal ${mine}`);
    await expect(
      own.locator('.jp-WorkspaceManager-cleanupHolds', {
        hasText: /^Kernels: /
      })
    ).toContainText('design.ipynb');
    const deleted = cleanRow(page, other);
    await expect(
      deleted.locator('.jp-WorkspaceManager-cleanupOutcome')
    ).toHaveText('deleted');
    await expect(deleted).toContainText('Tabs: docs/README.md');
    await expect(deleted).toContainText('Terminals: none');
    await expect(deleted).toContainText('Kernels: none');
    const spared = cleanRow(page, kept);
    await expect(
      spared.locator('.jp-WorkspaceManager-cleanupOutcome')
    ).toHaveText('kept');
    await expect(spared).toContainText('Tabs: none');
    await expect(spared).toContainText(`Terminals: terminal ${keptTerminal}`);
    await expect(spared).toContainText('Kernels: none');

    await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
    await expect(dialog(page)).toHaveCount(0);

    // the other workspace is gone; this one and the one another window shows stay
    await expect.poll(() => listed(page), UNDER_LOAD).not.toContain(other);
    const remaining = await listed(page);
    expect(remaining).toEqual(expect.arrayContaining([current, kept]));

    // this window's workspace is emptied: its notebook and terminal tabs are closed
    await expect
      .poll(
        async () =>
          mainTabs(await saved(page, current)).filter(
            key =>
              key.startsWith('notebook:') ||
              key.startsWith('terminal:') ||
              key.startsWith('editor:')
          ),
        UNDER_LOAD
      )
      .toEqual([]);
    // its terminal and kernel are shut down
    await expect
      .poll(() => terminalNames(page), UNDER_LOAD)
      .not.toContain(mine);
    await expect.poll(() => kernelIds(page), UNDER_LOAD).not.toContain(kernel);

    // the workspace stays in the panel, as this window's own
    await refresh(page);
    await expect(card(page, current)).toBeVisible();
    // the window that showed the kept workspace still shows it
    expect(otherWindow!.url()).toContain(`/lab/workspaces/${kept}`);
  } finally {
    await otherWindow?.close();
    if (mine) {
      await page.request.delete(`/api/terminals/${mine}`);
    }
    await page.request.delete(`/api/terminals/${keptTerminal}`);
    if (kernel) {
      await page.request.delete(`/api/kernels/${kernel}`);
    }
    await deleteWorkspaces(page, [current, other, kept]);
  }
});
