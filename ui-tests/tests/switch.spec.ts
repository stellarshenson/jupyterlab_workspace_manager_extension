import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';

import {
  activeTab,
  card,
  cardHeader,
  deleteWorkspaces,
  enterWorkspace,
  expectRefused,
  fresh,
  layout,
  openDocument,
  openPanel,
  putWorkspace,
  refresh,
  rowOf,
  secondWindow,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces and the switch channel of the server
test.use({ autoGoto: false, mockState: false });
// the drain can wait out a request's 90 s expire, longer than the default test timeout
test.describe.configure({ timeout: 180000 });

/**
 * An unread switch request stays live 90 s for every window id that has not
 * read it, so a window of the next test would apply a request meant for the
 * previous one. Every test starts on an empty channel.
 */

const ROOT = path.resolve(__dirname, '../..');

/** The URL of a workspace in this lab. */
const workspaceURL = (id: string) =>
  new RegExp(`/lab/workspaces/${id}(\\?.*)?$`);

/**
 * Run the CLI in this test process against the test server. The installed
 * `jupyterlab-workspace` command lags the working tree, so the module runs
 * from the repository root. The lab's own environment variables are removed:
 * the session that runs the tests is itself a lab window, and the first of
 * those variables set would send the request there instead.
 */
async function cli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const {
    JUPYTER_SERVER_URL,
    JUPYTERHUB_SERVICE_PREFIX,
    JUPYTERHUB_API_TOKEN,
    JPY_API_TOKEN,
    JUPYTER_TOKEN,
    JUPYTER_SERVER_ROOT,
    ...env
  } = process.env;
  try {
    const { stdout, stderr } = await promisify(execFile)(
      'python',
      ['-m', 'jupyterlab_workspace_manager_extension.cli', ...args],
      {
        cwd: ROOT,
        env: { ...env, JUPYTER_PORT: process.env.JUPYTER_TEST_PORT ?? '8888' },
        timeout: 60000
      }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? ''
    };
  }
}

/** Wait for the application of the document a switch navigated this window to. */
async function appStarted(page: IJupyterLabPageFixture): Promise<void> {
  await page.waitForCondition(
    () =>
      page.evaluate(async () => {
        if (typeof (window as any).jupyterapp === 'object') {
          await (window as any).jupyterapp.started;
          return true;
        }
        return false;
      }),
    30000
  );
}

/** The id the panel uses for this window: window.name, which survives a reload. */
const windowId = (page: IJupyterLabPageFixture): Promise<string> =>
  page.evaluate(() => window.name);

/**
 * Wait until no switch request is live. A read marks a request delivered to
 * the reading window only, so each poll uses a new id: a fixed one would hide
 * the request after its first read. A request naming no workspace has no file
 * to drop it, so it stays live until its 90 s expire; the poll waits that long.
 */
async function channelEmpty(page: Page): Promise<void> {
  let probe = 0;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/jupyterlab-workspace-manager-extension/switch?window=switch-drain-${probe++}`
            )
          ).json()
        ).requests.length,
      { timeout: 95000, intervals: [2000] }
    )
    .toBe(0);
}

test.beforeEach(async ({ page }) => {
  await channelEmpty(page);
});

test('ACC-CLI-219-SWITCH-WORKSPACE: workspaces switch --window moves that window to the named workspace within 2 s and leaves the other window', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swone');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    await enterWorkspace(page, current);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);
    const stayed = other.url();
    const id = await windowId(page);

    const run = await cli(['workspaces', 'switch', target, '--window', id]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `requested switch to workspace ${target} in window ${id}`
    );
    // the criterion's 2 s, counted from the CLI's return, which follows its
    // request: the window polls the channel every second
    await page.waitForURL(workspaceURL(target), {
      timeout: 2000,
      waitUntil: 'commit'
    });

    // the other window was not named and stays where it was
    await other.waitForTimeout(2500);
    expect(other.url()).toBe(stayed);

    // the panel of the switched window shows the target workspace as its own
    await appStarted(page);
    await openPanel(page);
    await expect(
      cardHeader(page, target).getByRole('button', { name: 'Open workspace' })
    ).toBeDisabled();
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});

test('ACC-CLI-220-SWITCH-TAB: tabs activate activates the tab showing the path in the window and selects its row', async ({
  page,
  tmpPath
}) => {
  const current = fresh('swtab');
  const [one, two] = [`${tmpPath}/one.txt`, `${tmpPath}/two.txt`];
  for (const doc of [one, two]) {
    await page.contents.uploadContent('text', 'text', doc);
  }
  try {
    await enterWorkspace(page, current);
    await openDocument(page, one);
    await openDocument(page, two);
    await openDocument(page, one);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(one);
    // the CLI checks the tab against the saved workspaces: this window's
    // workspace saves the two tabs it shows
    await putWorkspace(
      page,
      current,
      layout([`editor:${one}`, `editor:${two}`])
    );

    const run = await cli(['tabs', 'activate', two]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested activation of tab ${two}`);

    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(two);
    await expect(
      card(page, current).locator('.jp-WorkspaceManager-row.jp-mod-selected')
    ).toHaveCount(1);
    await expect(rowOf(card(page, current), 'two.txt')).toHaveClass(
      /jp-mod-selected/
    );
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: an unknown workspace name is refused and nothing is sent', async ({
  page
}) => {
  const current = fresh('swnd');
  const missing = `${current}-missing`;
  await putWorkspace(page, current);
  try {
    await enterWorkspace(page, current);
    const run = await cli(['workspaces', 'switch', missing]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`workspace ${missing} does not exist`);
    expect(run.stdout).toBe('');

    // no request was posted: the window does not move, and no card changes
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(workspaceURL(current));
    await expect(
      cardHeader(page, current).getByRole('button', { name: 'Open workspace' })
    ).toBeDisabled();
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-CLI-220-SWITCH-TAB: tabs activate --workspace switches the window first and then makes that tab the active widget', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const current = fresh('swwst');
  const target = `${current}-target`;
  const [kept, wanted] = [`${tmpPath}/kept.txt`, `${tmpPath}/wanted.txt`];
  for (const doc of [kept, wanted]) {
    await page.contents.uploadContent('text', 'text', doc);
  }
  // the wanted tab is saved second, so the restored window shows the other one
  await putWorkspace(
    page,
    target,
    layout([`editor:${kept}`, `editor:${wanted}`])
  );
  try {
    await enterWorkspace(page, current);

    const run = await cli(['tabs', 'activate', wanted, '--workspace', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `requested activation of tab ${wanted} in workspace ${target}`
    );

    // the window switches first; the tab is activated once its workspace shows
    await page.waitForURL(workspaceURL(target), {
      timeout: 10000,
      waitUntil: 'commit'
    });
    await appStarted(page);
    await openPanel(page);
    await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(wanted);
    await expect(rowOf(card(page, target), 'wanted.txt')).toHaveClass(
      /jp-mod-selected/
    );
  } finally {
    await deleteWorkspaces(page, [current, target]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: a broadcast switch is refused in a window another window shows the workspace on, and no window moves', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swref');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    // this window shows the target, so the broadcast has nowhere to move it
    await enterWorkspace(page, target);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);
    const stayed = [page.url(), other.url()];

    const run = await cli(['workspaces', 'switch', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested switch to workspace ${target}`);

    // the refusal is the deterministic answer to a broadcast; a hidden tab's
    // slower read is not observable here, as the harness runs with
    // --disable-background-timer-throttling
    await other.waitForTimeout(2500);
    expect([page.url(), other.url()]).toEqual(stayed);
    await expect(other.locator('.jp-Dialog')).toBeVisible();
    await expect(other.locator('.jp-Dialog-body')).toContainText(target);
    await expectRefused(other, 'Switch to workspace');
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});

test('ACC-CLI-219-SWITCH-WORKSPACE: of two eligible windows a broadcast switch moves exactly one and the other refuses', async ({
  page
}) => {
  test.setTimeout(120000);
  const current = fresh('swtwo');
  const target = `${current}-target`;
  const bystander = `${current}-bystander`;
  await putWorkspace(page, current);
  await putWorkspace(page, target);
  await putWorkspace(page, bystander);
  let other: Page | undefined;
  try {
    // neither window shows the target
    await enterWorkspace(page, current);
    other = await secondWindow(page, bystander);
    await openPanel(other);
    await refresh(other);

    // the claim is one server operation: both windows post it, one is stored and one refused
    const presencePost = (window: Page) =>
      window.waitForResponse(
        r =>
          r.request().method() === 'POST' &&
          r.url().includes('/jupyterlab-workspace-manager-extension/presence')
      );
    const answers = Promise.all([presencePost(page), presencePost(other)]);

    const run = await cli(['workspaces', 'switch', target]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(`requested switch to workspace ${target}`);
    expect((await answers).map(r => r.status()).sort()).toEqual([204, 409]);

    // exactly one window moves
    await expect
      .poll(
        () =>
          [page.url(), other!.url()].filter(u => workspaceURL(target).test(u))
            .length,
        { timeout: 10000 }
      )
      .toBe(1);
    // the window that stayed is refused in the dialog the claim's 409 shows
    await expectRefused(
      workspaceURL(target).test(page.url()) ? other! : page,
      'Switch to workspace'
    );
  } finally {
    await other?.close();
    await deleteWorkspaces(page, [current, target, bystander]);
  }
});
