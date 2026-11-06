import { expect, type IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  deleteWorkspaces,
  dialog,
  enterWorkspace,
  fresh,
  headerButton,
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

test('ACC-ACCORD-221-CLEAN-BUTTON, ACC-PANEL-240-CLEAR-CONSOLE, EDGE-CLEAN-UP-ICON: the WORKSPACES band carries the same 22 px button as the bands below it, named Clean up workspaces and enabled by a second workspace, with the eraser glyph; the three tally bands carry the power glyph; every band glyph stands under the reload glyph of the WORKBENCH band', async ({
  page
}: {
  page: IJupyterLabPageFixture;
}) => {
  const current = fresh('cleanbtn');
  const other = `${current}-other`;
  try {
    await enterWorkspace(page, current);
    const clean = sectionHeader(page, 'workspaces').getByRole('button', {
      name: 'Clean up workspaces',
      exact: true
    });
    await expect(clean).toBeVisible();
    // the three bands below carry the same 22 px button with a 14 px glyph
    const below = sectionHeader(page, 'kernels').getByRole('button', {
      name: 'Shut down',
      exact: true
    });
    const box = (await clean.boundingBox())!;
    const belowBox = (await below.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([
      Math.round(belowBox.width),
      Math.round(belowBox.height)
    ]);
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([22, 22]);
    const glyph = (await clean.locator('svg').boundingBox())!;
    expect(Math.round(glyph.width)).toBe(14);
    expect(Math.round(glyph.height)).toBe(14);
    // EDGE-CLEAN-UP-ICON: the clean-up control draws an eraser, the three band power
    // controls the power symbol; each is 14 px with 5 px above and below inside the 24 px band
    const powerName = (section: string) =>
      section === 'servers' ? 'Shut down all' : 'Shut down';
    const band = (section: string, name: string) =>
      sectionHeader(page, section)
        .getByRole('button', { name, exact: true })
        .locator('svg');
    const strokes = async (section: string, name: string) =>
      band(section, name).evaluate(svg => ({
        viewBox: svg.getAttribute('viewBox'),
        circles: svg.querySelectorAll('circle').length,
        paths: Array.from(svg.querySelectorAll('path')).map(p =>
          p.getAttribute('d')
        )
      }));
    // the glyphs of the section bands stand in one column under the reload glyph
    const centre = (b: { x: number; width: number }) => b.x + b.width / 2;
    const reload = centre(
      (await headerButton(page, 'Refresh').locator('svg').boundingBox())!
    );
    expect(await strokes('workspaces', 'Clean up workspaces')).toEqual({
      viewBox: '0 0 24 24',
      circles: 0,
      paths: ['M14.5 4.5 19.5 9.5 9.5 19.5 4.5 14.5z', 'M11.5 7.5 16.5 12.5']
    });
    for (const section of ['kernels', 'terminals', 'servers']) {
      expect(await strokes(section, powerName(section))).toEqual({
        viewBox: '0 0 24 24',
        circles: 0,
        paths: ['M12 3v8', 'M7.7 5.86A7.5 7.5 0 1 0 16.3 5.86']
      });
      // the 14 px glyph sits 5 px from the band's top edge and 5 px from its bottom edge
      const tallyGlyph = (await band(
        section,
        powerName(section)
      ).boundingBox())!;
      const tallyBand = (await sectionHeader(page, section).boundingBox())!;
      expect(centre(tallyGlyph), section).toBeCloseTo(reload, 1);
      expect(Math.round(tallyGlyph.width)).toBe(14);
      expect(Math.round(tallyGlyph.height)).toBe(14);
      expect(Math.round(tallyGlyph.y - tallyBand.y)).toBe(5);
      expect(
        Math.round(
          tallyBand.y + tallyBand.height - tallyGlyph.y - tallyGlyph.height
        )
      ).toBe(5);
    }
    expect(centre(glyph)).toBeCloseTo(reload, 1);
    const cleanBox = (await clean.boundingBox())!;
    const cleanGlyph = (await clean.locator('svg').boundingBox())!;
    expect(Math.round(cleanGlyph.height)).toBe(14);
    expect(Math.round(cleanGlyph.y - cleanBox.y)).toBe(4);
    const cleanBand = (await sectionHeader(page, 'workspaces').boundingBox())!;
    expect(Math.round(cleanGlyph.y - cleanBand.y)).toBe(5);
    expect(
      Math.round(
        cleanBand.y + cleanBand.height - cleanGlyph.y - cleanGlyph.height
      )
    ).toBe(5);

    await putWorkspace(page, other);
    await refresh(page);
    await expect(clean).toBeEnabled();
  } finally {
    await deleteWorkspaces(page, [current, other]);
  }
});

test.describe('at 4x device scale', () => {
  test.use({ deviceScaleFactor: 4 });

  test('ACC-PANEL-247-ICONS: the ink of the eraser glyph, read from pixels, stands as far from the top of the WORKSPACES band as from its bottom, within one device pixel', async ({
    page
  }: {
    page: IJupyterLabPageFixture;
  }) => {
    const current = fresh('eraserink');
    const other = `${current}-other`;
    try {
      await putWorkspace(page, other);
      await enterWorkspace(page, current);
      const band = sectionHeader(page, 'workspaces');
      const clean = band.getByRole('button', {
        name: 'Clean up workspaces',
        exact: true
      });
      await expect(clean).toBeEnabled();
      await page.mouse.move(0, 0);
      const S = 4; // device pixels per CSS pixel
      const bandBox = (await band.boundingBox())!;
      const glyph = (await clean.locator('svg').boundingBox())!;
      // the glyph's columns over the band's whole height
      const png = await page.screenshot({
        clip: {
          x: glyph.x,
          y: bandBox.y,
          width: glyph.width,
          height: bandBox.height
        }
      });
      const px = await page.evaluate(async b64 => {
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
          data: Array.from(
            ctx.getImageData(0, 0, image.width, image.height).data
          )
        };
      }, png.toString('base64'));
      expect(px.height).toBe(Math.round(bandBox.height * S));
      // each pixel row's strongest channel difference from the band's top-left pixel
      const rows = Array.from({ length: px.height }, (_, y) => {
        let strongest = 0;
        for (let x = 0; x < px.width; x++) {
          for (let c = 0; c < 3; c++) {
            strongest = Math.max(
              strongest,
              Math.abs(px.data[(y * px.width + x) * 4 + c] - px.data[c])
            );
          }
        }
        return strongest;
      });
      // ink is every pixel row at a fifth of the strongest difference or more
      const strongest = Math.max(...rows);
      expect(strongest).toBeGreaterThan(0);
      const inked = rows.flatMap((d, y) => (d >= strongest / 5 ? [y] : []));
      const above = inked[0];
      const below = px.height - 1 - inked[inked.length - 1];
      expect(above).toBeGreaterThan(0);
      expect(below).toBeGreaterThan(0);
      expect(
        Math.abs(above - below),
        `${above} device px above the ink, ${below} below`
      ).toBeLessThanOrEqual(1);
    } finally {
      await deleteWorkspaces(page, [current, other]);
    }
  });
});

test('ACC-ACCORD-223-CLEAN-ACTION: the WORKSPACES clear-console button deletes every workspace but this one, empties this one, and keeps the one another window shows', async ({
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

    const clean = sectionHeader(page, 'workspaces').getByRole('button', {
      name: 'Clean up workspaces',
      exact: true
    });
    await expect(clean).toBeVisible();
    await clean.click();
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
