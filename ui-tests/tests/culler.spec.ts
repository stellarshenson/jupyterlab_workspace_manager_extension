import { expect, test } from '@jupyterlab/galata';

import {
  card,
  countOf,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  kernelIds,
  layout,
  listed,
  PANEL,
  putWorkspace,
  refresh,
  saved,
  startSession,
  startTerminal,
  terminalNames,
  UNDER_LOAD
} from './helpers';

// the workspaces, terminals and kernels of the server, as the culler extension sees them
test.use({ autoGoto: false, mockState: false, kernels: null, sessions: null });

test('ACC-CULLER-65-CULLED: a workspace, a terminal and a kernel removed outside the panel leave it at the next reload, without an error', async ({
  page,
  tmpPath
}) => {
  const terminal = await startTerminal(page);
  const notebook = `${tmpPath}/culled.ipynb`;
  const session = await startSession(page, notebook);
  const current = fresh('culled');
  const [held, gone] = [`${current}-held`, `${current}-gone`];
  await putWorkspace(
    page,
    held,
    layout([`terminal:${terminal}`, `notebook:${notebook}`])
  );
  await putWorkspace(page, gone);
  const errors: string[] = [];
  try {
    await enterWorkspace(page, current);
    await expect(card(page, gone)).toBeVisible();
    await expect(countOf(card(page, held), 'Terminals')).toHaveText('1');
    await expect(countOf(card(page, held), 'Kernels')).toHaveText('1');
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      // the browser logs the 500 jupyter_server answers on the kernel list while
      // another test's kernel starts; the panel asks again, and a second 500
      // shows the error line
      const starting =
        message.text().startsWith('Failed to load resource') &&
        message.text().includes('status of 500') &&
        /\/api\/kernels(\?|$)/.test(message.location().url);
      if (message.type() === 'error' && !starting) {
        errors.push(message.text());
      }
    });

    // removed as the culler removes them
    await page.request.delete(`/lab/api/workspaces/${gone}`);
    await page.request.delete(`/api/terminals/${terminal}`);
    await page.request.delete(`/api/kernels/${session.kernel.id}`);
    await refresh(page);

    await expect(card(page, gone)).toHaveCount(0);
    // the server's list lags the DELETE; the row leaves at the next 10 s poll
    await expect(countOf(card(page, held), 'Terminals')).toHaveText(
      '0',
      UNDER_LOAD
    );
    await expect(countOf(card(page, held), 'Kernels')).toHaveText('0');
    await expect(
      page.locator(PANEL).getByText(`terminal ${terminal}`, { exact: true })
    ).toHaveCount(0, UNDER_LOAD);
    await expect(
      page.locator(`${PANEL} .jp-WorkspaceManager-error`)
    ).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
    await page.request.delete(`/api/kernels/${session.kernel.id}`);
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, held, gone]);
  }
});

test('ACC-CULLER-67-NO-SHUTDOWN: thirty seconds of the open panel and its polls end no terminal or kernel and delete no workspace', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const terminal = await startTerminal(page);
  const notebook = `${tmpPath}/kept.ipynb`;
  const session = await startSession(page, notebook);
  const current = fresh('kept');
  const [held, empty] = [`${current}-held`, `${current}-empty`];
  await putWorkspace(
    page,
    held,
    layout([`terminal:${terminal}`, `notebook:${notebook}`])
  );
  await putWorkspace(page, empty);
  const deletes: string[] = [];
  let polls = 0;
  page.on('request', request => {
    if (request.method() === 'DELETE') {
      deletes.push(request.url());
    }
    if (
      request
        .url()
        .includes('/jupyterlab-workspace-manager-extension/terminals')
    ) {
      polls += 1;
    }
  });
  try {
    await enterWorkspace(page, current);
    await expect(countOf(card(page, held), 'Kernels')).toHaveText('1');
    const before = [await saved(page, held), await saved(page, empty)];
    const start = polls;

    await page.waitForTimeout(30000);

    // the panel polled all along
    expect(polls - start).toBeGreaterThanOrEqual(2);
    expect(deletes).toEqual([]);
    expect(await terminalNames(page)).toContain(terminal);
    expect(await kernelIds(page)).toContain(session.kernel.id);
    expect(await listed(page)).toEqual(
      expect.arrayContaining([current, held, empty])
    );
    expect([await saved(page, held), await saved(page, empty)]).toEqual(before);
    await expect(countOf(card(page, held), 'Terminals')).toHaveText('1');
    await expect(countOf(card(page, held), 'Kernels')).toHaveText('1');
  } finally {
    await page.request.delete(`/api/sessions/${session.id}`);
    await page.request.delete(`/api/kernels/${session.kernel.id}`);
    await page.request.delete(`/api/terminals/${terminal}`);
    await deleteWorkspaces(page, [current, held, empty]);
  }
});
