import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  activeTab,
  card,
  cardHeader,
  countOf,
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
  only,
  openCard,
  openDocument,
  openSection,
  panelWidth,
  patchMeta,
  putNotebook,
  putWorkspace,
  refresh,
  rowOf,
  sectionBody,
  sectionCount,
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

test('ACC-KERNEL-48-ROW, ACC-KERNEL-156-DISPLAY-NAME, ACC-KERNEL-49-STATE, ACC-KERNEL-114-SHUTDOWN: a kernel row shows its notebook, its state and its age, its details in its tooltip and, selected, the display name of its kernelspec and the path; Shut down kernel ends it and the notebook stays open', async ({
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
      'kernelled.ipynb'
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
    // DQ-17, DQ-13: the line holds the notebook, the state word and the age only; the dot carries the word
    await expect(row).toHaveText('kernelled.ipynbidlenow');
    await expect(row.locator('.jp-WorkspaceManager-dot')).toHaveAttribute(
      'aria-label',
      'idle'
    );
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(0);
    // selected, the detail line: the kernel type and the path
    await row.focus();
    await expect(row).toHaveClass(/jp-mod-selected/);
    await expect(
      row.locator('.jp-WorkspaceManager-rowDetail > span')
    ).toHaveText([display, `${tmpPath}/`, 'kernelled.ipynb']);
    // at the 250 px sidebar the name shows its first characters, the age whole
    expect(await panelWidth(page)).toBe(250);
    const name = await shows(row, '.jp-WorkspaceManager-rowLabel');
    expect(name.inside).toBe(true);
    expect(name.width).toBeGreaterThanOrEqual(name.start);
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
      '5m ago',
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

test('ACC-KERNEL-196-KERNEL-DETAILS, ACC-KERNEL-48-ROW, ACC-LISTS-154-TAB-SHRINK: a KERNELS row shows its notebook, state and age; selected, its detail line shows the kernel type, the notebook path, the memory in MB or GB and the CPU percent; its path on a line of its own; from 300 to 560 px a 29-character file name shows whole and at 300 px the kernel type and the folder are cut first; the row has no also in mark and its hover text names no workspace', async ({
  page,
  tmpPath
}) => {
  const current = fresh('details');
  for (const folder of [
    'projects',
    'projects/clients',
    'projects/clients/acme'
  ]) {
    const made = await page.request.put(`/api/contents/${tmpPath}/${folder}`, {
      data: { type: 'directory' }
    });
    expect(made.ok()).toBe(true);
  }
  const notebook = `${tmpPath}/projects/clients/acme/eda.ipynb`;
  const long = `${tmpPath}/projects/clients/acme/quarterly_revenue_stats.ipynb`;
  await putNotebook(page, notebook);
  await putNotebook(page, long);
  try {
    await enterWorkspace(page, current);
    await openDocument(page, long);
    await sessionOf(page, long);
    await openDocument(page, notebook);
    const session = await sessionOf(page, notebook);
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
    // ACC-SERVER-197: the extension reads the kernel process
    const figures = (
      await (
        await page.request.get(
          '/jupyterlab-workspace-manager-extension/kernels'
        )
      ).json()
    )[session.kernel.id];
    expect(figures.memory).toBeGreaterThan(0);
    expect(typeof figures.cpu).toBe('number');

    await refresh(page);
    await openSection(page, 'kernels');
    const row = rowOf(sectionBody(page, 'kernels'), 'eda.ipynb');
    const display = await displayName(page, session.kernel.name);
    // DQ-17: the line holds the notebook, the state and the age; no also in mark, no workspace in the hover text
    await expect(row.locator('.jp-WorkspaceManager-rowLabel')).toHaveText(
      'eda.ipynb'
    );
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveText('idle');
    await expect(row.locator('.jp-WorkspaceManager-rowDetail')).toHaveCount(0);
    await expect(row).not.toContainText('also in');
    await expect(row).toHaveAttribute('title', `${display}\n${notebook}\nidle`);
    // selected, the detail line: the kernel type, the folder, the file name, the memory and the CPU
    await row.click();
    await expect(row).toHaveClass(/jp-mod-selected/);
    // the kernel type, the memory and the CPU; under them the path
    await expect(
      row.locator('.jp-WorkspaceManager-rowDetail > span')
    ).toHaveText([
      display,
      /^\d+(\.\d)? (MB|GB)$/,
      /^\d+%$/,
      `${tmpPath}/projects/clients/acme/`,
      'eda.ipynb'
    ]);

    const longRow = rowOf(
      sectionBody(page, 'kernels'),
      'quarterly_revenue_stats.ipynb'
    );
    await longRow.focus();
    await expect(longRow).toHaveClass(/jp-mod-selected/);
    await expect(row).not.toHaveClass(/jp-mod-selected/);
    const handle = page
      .locator('#jp-main-split-panel > .lm-SplitPanel-handle')
      .first();
    for (const width of [
      300, 330, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560
    ]) {
      // the sidebar dragged to the width
      const at = (await handle.boundingBox())!;
      const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + width - (await panelWidth(page)), y, {
        steps: 5
      });
      await page.mouse.up();
      expect(await panelWidth(page)).toBe(width);
      // per part of the detail line: its text, whether the text is cut, whether it lies inside the row
      const parts = await longRow.evaluate(r => {
        const box = r.getBoundingClientRect();
        return Array.from(
          r.querySelectorAll<HTMLElement>(
            '.jp-WorkspaceManager-rowDetail > span'
          )
        ).map(e => {
          // the whole text: scrollWidth and clientWidth round away a cut under 1 px
          const text = document.createRange();
          text.selectNodeContents(e);
          const b = e.getBoundingClientRect();
          return {
            text: e.textContent,
            cut: text.getBoundingClientRect().width - b.width > 1 / 64,
            inside: b.right <= box.right + 0.5,
            style: `${getComputedStyle(e).textOverflow} ${getComputedStyle(e).direction}`
          };
        });
      });
      const [type, memory, cpu, folder, file] = parts;
      expect(file, `file name at ${width} px`).toMatchObject({
        text: 'quarterly_revenue_stats.ipynb',
        cut: false,
        inside: true
      });
      for (const figure of [memory, cpu]) {
        expect(figure, `figure at ${width} px`).toMatchObject({
          cut: false,
          inside: true
        });
      }
      if (width === 300) {
        // the kernel type and the folder give way first (KERN-02); the folder is cut at its start
        expect(type).toMatchObject({ cut: true, style: 'ellipsis ltr' });
        expect(folder).toMatchObject({ cut: true, style: 'ellipsis rtl' });
      }
    }
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

  test('ACC-LISTS-195-ALL-KERNELS: KERNELS lists the kernel of a notebook open in this window, the kernel of a notebook in a hidden workspace and a kernel with no session', async ({
    page,
    tmpPath
  }) => {
    const [mine, hiddenNb] = [
      `${tmpPath}/mine.ipynb`,
      `${tmpPath}/hidden.ipynb`
    ];
    await putNotebook(page, mine);
    await putNotebook(page, hiddenNb);
    // started before this page loads, so its filter keeps them from the start
    const sessions = [
      await startSession(page, mine),
      await startSession(page, hiddenNb)
    ];
    const response = await page.request.post('/api/kernels', {
      data: { name: 'python3' }
    });
    expect(response.ok()).toBe(true);
    const ids = [...sessions.map(s => s.kernel.id), (await response.json()).id];
    // the kernels and sessions other tests run at the same time are not this test's
    await only(page, /\/api\/kernels(\?.*)?$/, k => ids.includes(k.id));
    await only(page, /\/api\/sessions(\?.*)?$/, s =>
      ids.includes(s.kernel?.id)
    );
    const current = fresh('allkernels');
    const hidden = `${current}-hidden`;
    await putWorkspace(page, hidden, layout([`notebook:${hiddenNb}`]));
    await patchMeta(page, hidden, { hidden: true });
    try {
      await enterWorkspace(page, current);
      // the notebook opens on the kernel of its session
      await openDocument(page, mine);
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(mine);
      await refresh(page);
      await expect(sectionCount(page, 'kernels')).toHaveText('(3)');
      await openSection(page, 'kernels');
      const body = sectionBody(page, 'kernels');
      await expect(body.locator(ROW)).toHaveCount(3);
      // each named by its notebook (DQ-17)
      await expect(rowOf(body, 'mine.ipynb')).toBeVisible();
      await expect(rowOf(body, 'hidden.ipynb')).toBeVisible();
    } finally {
      for (const s of sessions) {
        await page.request.delete(`/api/sessions/${s.id}`);
      }
      await Promise.all(
        ids.map(id => page.request.delete(`/api/kernels/${id}`))
      );
      await deleteWorkspaces(page, [current, hidden]);
    }
  });

  test('ACC-KERNEL-199-SHUTDOWN-SHARED: shutting down a kernel that another workspace holds asks first and names that workspace', async ({
    page,
    tmpPath
  }) => {
    const notebook = `${tmpPath}/shared.ipynb`;
    await putNotebook(page, notebook);
    const session = await startSession(page, notebook);
    const current = fresh('kshared');
    const [a, b] = [`${current}-a`, `${current}-b`];
    await putWorkspace(page, a, layout([`notebook:${notebook}`]));
    await putWorkspace(page, b, layout([`notebook:${notebook}`]));
    const row = () => rowOf(group(card(page, a), 'KERNELS'), 'shared.ipynb');
    try {
      await enterWorkspace(page, current);
      await triangle(page, a).click();

      await fromRowMenu(row(), 'Shut down kernel');
      await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
        `Shut down kernel ${await displayName(page, 'python3')}?`
      );
      await expect(dialog(page).locator('.jp-Dialog-body')).toHaveText(
        `Workspace ${b} also holds this kernel.`
      );
      await dialog(page)
        .locator('.jp-Dialog-button', { hasText: 'Cancel' })
        .click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await kernelIds(page)).toContain(session.kernel.id);

      await fromRowMenu(row(), 'Shut down kernel');
      await dialog(page).locator('.jp-Dialog-button.jp-mod-accept').click();
      await expect
        .poll(() => kernelIds(page), UNDER_LOAD)
        .not.toContain(session.kernel.id);
      for (const id of [a, b]) {
        await openCard(page, id);
        await expect(countOf(card(page, id), 'Kernels')).toHaveText(
          '0',
          NEXT_POLL
        );
      }
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/kernels/${session.kernel.id}`);
      await deleteWorkspaces(page, [current, a, b]);
    }
  });
});
