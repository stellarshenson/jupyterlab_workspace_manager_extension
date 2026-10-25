import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  activeTab,
  card,
  cardHeader,
  deleteWorkspaces,
  dialog,
  displayName,
  enterWorkspace,
  fresh,
  fromRowMenu,
  group,
  kernelIds,
  layout,
  NEXT_POLL,
  openDocument,
  openSection,
  panelWidth,
  putNotebook,
  putWorkspace,
  refresh,
  rowOf,
  sectionBody,
  serverList,
  shows,
  startSession,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

const ROW = '.jp-WorkspaceManager-row';

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

test('ACC-KERNEL-48-ROW, ACC-KERNEL-156-DISPLAY-NAME, ACC-KERNEL-114-SHUTDOWN: a kernel row shows the display name of its kernelspec, its details in its tooltip, its notebook and age; Shut down kernel ends it and the notebook stays open', async ({
  page,
  tmpPath
}) => {
  const current = fresh('kernel');
  const notebook = `${tmpPath}/kernelled.ipynb`;
  await putNotebook(page, notebook);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, notebook);
    const session = await sessionOf(page, notebook);
    await refresh(page);
    await cardHeader(page, current).click();
    const kernels = group(card(page, current), 'KERNELS');
    const row = kernels.locator(ROW);
    await expect(row).toHaveCount(1);
    const display = await displayName(page, session.kernel.name);
    expect(display).not.toBe(session.kernel.name);
    await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
      display
    );
    // ACC-PANEL-185: the display name, the session path and the state, one per line
    await expect
      .poll(() => serverList(page, '/api/kernels'), UNDER_LOAD)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: session.kernel.id,
            execution_state: 'idle'
          })
        ])
      );
    await refresh(page);
    await expect(row).toHaveAttribute('title', `${display}\n${notebook}\nidle`);
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveText(
      'kernelled.ipynb'
    );
    await expect(row.locator('.jp-WorkspaceManager-age')).toHaveText('now');
    // at the 250 px sidebar the name and the notebook each show their first characters, the age whole
    expect(await panelWidth(page)).toBe(250);
    for (const part of [
      '.jp-WorkspaceManager-rowLabel',
      '.jp-WorkspaceManager-rowDetail'
    ]) {
      const s = await shows(row, part);
      expect(s.inside, part).toBe(true);
      expect(s.width, part).toBeGreaterThanOrEqual(s.start);
    }
    expect(await shows(row, '.jp-WorkspaceManager-age')).toMatchObject({
      inside: true,
      whole: true
    });
    // the age is the server's last_activity: a kernel idle for over 5 minutes shows 5m
    const idle = new Date(Date.now() - 330000).toISOString();
    const list = /\/api\/kernels(\?.*)?$/;
    await page.route(list, async route => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({
        response,
        json: response.ok()
          ? json.map((k: any) =>
              k.id === session.kernel.id ? { ...k, last_activity: idle } : k
            )
          : json
      });
    });
    await refresh(page);
    await expect(row.locator('.jp-WorkspaceManager-age')).toHaveText(
      '5m',
      NEXT_POLL
    );
    await page.unroute(list);

    await fromRowMenu(row, 'Shut down kernel');
    await expect
      .poll(() => kernelIds(page), UNDER_LOAD)
      .not.toContain(session.kernel.id);
    await expect(kernels).toHaveCount(0, NEXT_POLL);
    // the notebook tab stays, without a kernel, and nothing asks to close it
    await expect
      .poll(
        () =>
          page.evaluate(path => {
            const tab: any = Array.from(
              (window as any).jupyterapp.shell.widgets('main')
            ).find((w: any) => w.context?.path === path);
            const kernel = tab?.sessionContext.session?.kernel;
            return !tab
              ? 'closed'
              : !kernel || kernel.isDisposed || kernel.status === 'dead'
                ? 'no kernel'
                : kernel.status;
          }, notebook),
        UNDER_LOAD
      )
      .toBe('no kernel');
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      rowOf(group(card(page, current), 'TABS'), 'kernelled.ipynb')
    ).toBeVisible();
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test.describe('kernels and sessions of the server', () => {
  // Galata lists only the kernels and sessions its page started; this test starts one by REST
  test.use({ kernels: null, sessions: null });

  test('ACC-KERNEL-151-ROW-CLICK: a click or Enter on a kernel row opens its notebook: here, from the KERNELS section, or in its workspace', async ({
    page,
    tmpPath
  }) => {
    const tag = fresh('nb');
    const [a, b, c] = ['a', 'b', 'c'].map(x => `${tmpPath}/${tag}-${x}.ipynb`);
    for (const path of [a, b, c]) {
      await putNotebook(page, path);
    }
    const current = fresh('kclick');
    const other = `${current}-other`;
    // B's session is in no workspace; C's notebook is a tab of another workspace
    const sessionB = await startSession(page, b);
    await startSession(page, c);
    await putWorkspace(page, other, layout([`notebook:${c}`]));
    try {
      await enterWorkspace(page, current);
      await openDocument(page, a);
      await sessionOf(page, a);
      await refresh(page);

      // B's kernel is in the KERNELS section: a click opens its notebook here
      await openSection(page, 'kernels');
      await rowOf(sectionBody(page, 'kernels'), `${tag}-b.ipynb`).click();
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(b);
      // the tab of B runs on the kernel of its session
      expect((await sessionOf(page, b)).kernel.id).toBe(sessionB.kernel.id);

      // B is a live tab now: its kernel row is in this window's card too
      await refresh(page);
      await openSection(page, 'workspaces');
      await cardHeader(page, current).click();
      const kernels = group(card(page, current), 'KERNELS');
      await expect(rowOf(kernels, `${tag}-b.ipynb`)).toBeVisible();
      await rowOf(kernels, `${tag}-a.ipynb`).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(a);

      await triangle(page, other).click();
      await rowOf(
        group(card(page, other), 'KERNELS'),
        `${tag}-c.ipynb`
      ).click();
      await expect(page).toHaveURL(
        new RegExp(`/lab/workspaces/${other}(\\?.*)?$`)
      );
    } finally {
      const sessions = await serverList(page, '/api/sessions');
      for (const s of sessions.filter(s => s.path.startsWith(tmpPath))) {
        await page.request.delete(`/api/sessions/${s.id}`);
        await page.request.delete(`/api/kernels/${s.kernel.id}`);
      }
      await deleteWorkspaces(page, [current, other]);
    }
  });
});
