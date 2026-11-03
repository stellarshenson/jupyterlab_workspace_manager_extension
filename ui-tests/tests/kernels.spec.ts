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
  kernelIds,
  layout,
  menuItem,
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
  setSetting,
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

for (const kernelShutdown of [true, false]) {
  test(`ACC-LISTS-266-DETACH, ACC-PANEL-245-ROW-MENU: with kernelShutdown ${kernelShutdown} the menu of a notebook row with a kernel lists its four entries and Detach from workspace closes the notebook's tab; its kernel keeps running and shows in KERNELS`, async ({
    page,
    tmpPath
  }) => {
    const current = fresh('detachkernel');
    const notebook = `${tmpPath}/detached.ipynb`;
    await putNotebook(page, notebook);
    let session: any;
    try {
      await enterWorkspace(page, current);
      await setSetting(
        page,
        '@jupyterlab/notebook-extension:tracker',
        'kernelShutdown',
        kernelShutdown
      );
      await openDocument(page, notebook);
      session = await sessionOf(page, notebook);
      // the notebook took the setting: the guard has something to override
      expect(
        await page.evaluate(
          () =>
            (window as any).jupyterapp.shell.currentWidget.sessionContext
              .kernelPreference.shutdownOnDispose
        )
      ).toBe(kernelShutdown);
      // the kernel's spec and its language info each mark a new notebook unsaved as they arrive, the language
      // first as a placeholder with an empty name; saved after both, it closes without a question
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const { context, sessionContext } = (window as any).jupyterapp
                .shell.currentWidget;
              const { model } = context;
              const written =
                !!model.getMetadata('language_info')?.name &&
                model.getMetadata('kernelspec')?.display_name ===
                  sessionContext.kernelDisplayName;
              if (written && model.dirty) {
                await context.save();
              }
              return written && !model.dirty;
            }),
          UNDER_LOAD
        )
        .toBe(true);
      await openCard(page, current);
      const row = rowOf(card(page, current), 'detached.ipynb');
      await expect(row.locator('.jp-WorkspaceManager-state')).toHaveCount(
        1,
        UNDER_LOAD
      );

      await row.click({ button: 'right' });
      await expect(
        page.locator('.jp-WorkspaceManager-menu .lm-Menu-itemLabel')
      ).toHaveText([
        'Close tab',
        'Detach from workspace',
        'Move to workspace',
        'Shut down kernel'
      ]);
      await menuItem(page, 'Detach from workspace').click();
      await expect(row).toHaveCount(0, UNDER_LOAD);
      await refresh(page);
      expect(await kernelIds(page)).toContain(session.kernel.id);
      await openSection(page, 'kernels');
      await expect(
        rowOf(sectionBody(page, 'kernels'), 'detached.ipynb')
      ).toBeVisible(UNDER_LOAD);
    } finally {
      await page.request.delete(`/api/sessions/${session?.id}`);
      await deleteWorkspaces(page, [current]);
    }
  });
}

test('ACC-LISTS-266-DETACH: Detach from workspace on a notebook with unsaved changes asks as Close tab asks; Cancel keeps the tab, Discard closes it and the kernel runs on', async ({
  page,
  tmpPath
}) => {
  const current = fresh('detachdirty');
  const notebook = `${tmpPath}/dirty.ipynb`;
  await putNotebook(page, notebook);
  let session: any;
  try {
    await enterWorkspace(page, current);
    await setSetting(
      page,
      '@jupyterlab/notebook-extension:tracker',
      'kernelShutdown',
      true
    );
    await openDocument(page, notebook);
    session = await sessionOf(page, notebook);
    await page.evaluate(() => {
      (window as any).jupyterapp.shell.currentWidget.context.model.dirty = true;
    });
    await openCard(page, current);
    const row = rowOf(card(page, current), 'dirty.ipynb');
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveCount(
      1,
      UNDER_LOAD
    );

    await fromRowMenu(row, 'Detach from workspace');
    await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
      'Save your work'
    );
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Cancel' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row).toBeVisible();

    await fromRowMenu(row, 'Detach from workspace');
    await dialog(page)
      .locator('.jp-Dialog-button', { hasText: 'Discard' })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row).toHaveCount(0, UNDER_LOAD);
    await refresh(page);
    expect(await kernelIds(page)).toContain(session.kernel.id);
  } finally {
    await page.request.delete(`/api/sessions/${session?.id}`);
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-KERNEL-48-ROW, ACC-KERNEL-49-STATE, ACC-KERNEL-114-SHUTDOWN: a card document row shows its notebook, its kernel state word and dot, and its age and, selected, its folder; Shut down kernel ends the kernel and the notebook stays open', async ({
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
    const row = rowOf(card(page, current), 'kernelled.ipynb');
    await expect(row).toHaveCount(1);
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
    await expect(row).toHaveAttribute('title', notebook);
    // DQ-13: the line holds the notebook, the state word and the age; the word is also the state span's title and the dot's aria-label
    await expect(row).toHaveText('kernelled.ipynbidlenow');
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveAttribute(
      'title',
      'idle'
    );
    await expect(
      row.locator('.jp-WorkspaceManager-state .jp-WorkspaceManager-dot')
    ).toHaveAttribute('aria-label', 'idle');
    // selected, the detail line: the folder
    await row.focus();
    await expect(row).toHaveClass(/jp-mod-selected/);
    await expect(
      row.locator('.jp-WorkspaceManager-rowDetail > span')
    ).toHaveText([tmpPath]);
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
    // the notebook row stays, without a state dot, and nothing asks to close it
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveCount(
      0,
      NEXT_POLL
    );
    await expect(row).toBeVisible();
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
    await expect(row.locator('.jp-WorkspaceManager-state')).toHaveText(
      'idle',
      UNDER_LOAD
    );
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
      // the split panel can land 1/64 px short: within 0.5 px
      await expect.poll(() => panelWidth(page)).toBeCloseTo(width, 0);
      // per part of the detail line: its text, the width of the whole text, whether it is cut, whether it lies inside the row; the line's content width and gap
      const { parts, content, gap } = await longRow.evaluate(r => {
        const box = r.getBoundingClientRect();
        const line = r.querySelector<HTMLElement>(
          '.jp-WorkspaceManager-rowDetail'
        )!;
        const style = getComputedStyle(line);
        return {
          content: line.clientWidth - parseFloat(style.paddingLeft),
          gap: parseFloat(style.columnGap),
          parts: Array.from(
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
              width: text.getBoundingClientRect().width,
              cut: text.getBoundingClientRect().width - b.width > 1 / 64,
              inside: b.right <= box.right + 0.5,
              style: `${getComputedStyle(e).textOverflow} ${getComputedStyle(e).direction}`
            };
          })
        };
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
        expect(folder).toMatchObject({ cut: true, style: 'ellipsis rtl' });
        expect(type.style).toBe('ellipsis ltr');
        // a whole type is a type whose line fits; a cut type gave way, since the figures stay whole
        if (!type.cut) {
          expect(
            type.width + memory.width + cpu.width + 2 * gap
          ).toBeLessThanOrEqual(content + 0.5);
        }
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

      // B is a live tab now: its document row is in this window's card too
      await refresh(page);
      await openSection(page, 'workspaces');
      await cardHeader(page, current).click();
      const c = card(page, current);
      await expect(rowOf(c, `${tag}-b.ipynb`)).toBeVisible();
      await rowOf(c, `${tag}-a.ipynb`).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => activeTab(page), UNDER_LOAD).toBe(a);

      await triangle(page, other).click();
      await rowOf(card(page, other), `${tag}-c.ipynb`).click();
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
    const row = () => rowOf(card(page, a), 'shared.ipynb');
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
