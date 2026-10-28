import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

import {
  card,
  colourOf,
  COLOURS,
  deleteWorkspaces,
  fresh,
  gotoWorkspace,
  headerButton,
  listed,
  onlyWorkspaces,
  openPanel,
  PANEL,
  putWorkspace,
  refresh,
  sectionBody,
  triangle,
  UNDER_LOAD
} from './helpers';

// every test reads and writes the workspaces of the server
test.use({ autoGoto: false, mockState: false });

const dialog = (page: Page) => page.locator('.jp-Dialog');

/** The cards of workspaces, in the order shown. */
const cards = (page: Page) =>
  page.locator(`${PANEL} .jp-WorkspaceManager-card[data-workspace]`);

async function openDialog(page: Page): Promise<void> {
  await headerButton(page, 'New workspace').click();
  await expect(dialog(page).locator('.jp-Dialog-header')).toHaveText(
    'New workspace'
  );
}

/** Create a workspace through the dialog; Enter in the name field creates. */
async function create(page: Page, name: string, purpose = ''): Promise<void> {
  await openDialog(page);
  if (purpose) {
    await dialog(page).locator('textarea').fill(purpose);
  }
  await dialog(page).locator('input').fill(name);
  await dialog(page).locator('input').press('Enter');
  await expect(dialog(page)).toHaveCount(0);
}

test('ACC-PANEL-140-NEW-BUTTON: the + button opens the New workspace dialog', async ({
  page
}) => {
  const current = fresh('plus');
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await expect(headerButton(page, 'New workspace')).toHaveAttribute(
      'title',
      'New workspace'
    );
    await openDialog(page);
    await expect(dialog(page)).toBeVisible();
  } finally {
    await deleteWorkspaces(page, [current]);
  }
});

test('ACC-PANEL-141-NEW-DIALOG: Name focused, a three-line description box that wraps; Escape changes nothing, Enter creates', async ({
  page
}) => {
  const current = fresh('dialog');
  const escaped = `${current}-esc`;
  const created = `${current}-new`;
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await openDialog(page);
    const name = dialog(page).getByLabel('Name', { exact: true });
    const area = dialog(page).getByLabel('Short description (optional)');
    await expect(name).toBeFocused();
    await expect(area).toHaveAttribute('rows', '3');
    // a line wider than the box wraps: the box never scrolls sideways
    await area.fill(
      'A description long enough to need more than one line of the box, so that the box has to wrap it'
    );
    const box = await area.evaluate((n: HTMLTextAreaElement) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = getComputedStyle(n).font;
      return {
        line: ctx.measureText(n.value).width,
        width: n.clientWidth,
        scroll: n.scrollWidth
      };
    });
    expect(box.line).toBeGreaterThan(box.width);
    expect(box.scroll).toBeLessThanOrEqual(box.width);
    await expect(dialog(page).locator('.jp-Dialog-button')).toHaveText([
      'Cancel',
      'Create'
    ]);

    await name.fill(escaped);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await listed(page)).not.toContain(escaped);

    await openDialog(page);
    await expect(name).toBeFocused();
    await page.keyboard.type(created);
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => listed(page), UNDER_LOAD).toContain(created);
  } finally {
    await deleteWorkspaces(page, [current, escaped, created]);
  }
});

test('ACC-PANEL-143-NEW-TAKEN: the name of an existing workspace is refused and its layout stays', async ({
  page
}) => {
  const current = fresh('taken');
  const taken = `${current}-auto`;
  const layout = {
    'layout-restorer:data': {
      main: {
        dock: {
          type: 'tab-area',
          currentIndex: 0,
          widgets: ['editor:notes.md']
        }
      }
    },
    'editor:notes.md': { data: { path: 'notes.md', factory: 'Editor' } }
  };
  await putWorkspace(page, taken, layout);
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await openDialog(page);
    await dialog(page).locator('input').fill(taken);
    await expect(dialog(page).locator('.jp-WorkspaceManager-rule')).toHaveText(
      `A workspace named ${taken} exists`
    );
    const accept = dialog(page).locator('.jp-Dialog-button.jp-mod-accept');
    await expect(accept).toBeDisabled();
    await dialog(page).locator('input').press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    const saved = await page.request.get(`/lab/api/workspaces/${taken}`);
    expect((await saved.json()).data).toEqual(layout);
  } finally {
    await deleteWorkspaces(page, [current, taken]);
  }
});

test('ACC-PANEL-145-NEW-CREATE: Create saves the workspace with its purpose and the next colour; the card shows age now', async ({
  page
}) => {
  const current = fresh('create');
  const review = `${current}-fb-review`;
  const made: string[] = [];
  // only this test's workspaces, so this window gives no colour to another worker's
  await onlyWorkspaces(page, id => id.startsWith(current));
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);

    await create(page, review, 'Review of the feature branch');
    await expect.poll(() => listed(page), UNDER_LOAD).toContain(review);
    await expect(
      card(page, review).locator('.jp-WorkspaceManager-purpose')
    ).toHaveText('Review of the feature branch');
    await expect(
      card(page, review).locator('.jp-WorkspaceManager-age')
    ).toHaveText('now');
    const first = (await colourOf(page, review))!;
    expect(COLOURS).toContain(first);
    await expect(card(page, review)).toHaveClass(new RegExp(`jp-mod-${first}`));

    // the last colour given is shared by every window, and other workers'
    // windows give colours too: an attempt they interleave runs again
    let attempt = 0;
    await expect(async () => {
      attempt += 1;
      const [one, two] = [`${current}-a${attempt}`, `${current}-b${attempt}`];
      made.push(one, two);
      await create(page, one);
      await create(page, two);
      await expect(card(page, two)).toBeVisible();
      const [c1, c2] = [await colourOf(page, one), await colourOf(page, two)];
      expect(c2).toBe(COLOURS[(COLOURS.indexOf(c1!) + 1) % 6]);
      await expect(card(page, two)).toHaveClass(new RegExp(`jp-mod-${c2}`));
    }).toPass({ timeout: 90000 });
  } finally {
    await deleteWorkspaces(page, [current, review, ...made]);
  }
});

test('ACC-PANEL-146-NEW-STAY: after Create the window stays and the new card is open and in view', async ({
  page
}) => {
  const current = fresh('stay');
  const many = Array.from({ length: 30 }, (_, i) => `${current}-${i}`);
  const created = `${current}-new`;
  await Promise.all(many.map(id => putWorkspace(page, id)));
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    // the new card comes last (ACC-ACCORD-198): scroll the WORKSPACES list to its top first
    const list = sectionBody(page, 'workspaces');
    await list.evaluate(n => (n.scrollTop = 0));
    await expect(cards(page).last()).not.toBeInViewport();
    const url = page.url();
    await page.evaluate(() => ((window as any).stayed = true));

    await create(page, created);
    await expect(triangle(page, created)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(card(page, created)).toBeInViewport();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => (window as any).stayed)).toBe(true);
  } finally {
    await deleteWorkspaces(page, [current, created, ...many]);
  }
});

test('ACC-ACCORD-198-NEW-LAST: a new workspace takes the last card and the next position after the highest', async ({
  page
}) => {
  const current = fresh('last');
  const others = [`${current}-a`, `${current}-b`];
  const created = `${current}-new`;
  await Promise.all(others.map(id => putWorkspace(page, id)));
  await onlyWorkspaces(page, id => id.startsWith(current));
  try {
    await gotoWorkspace(page, current);
    await openPanel(page);
    await refresh(page);
    await expect(cards(page)).toHaveCount(3);

    await create(page, created);
    await expect(cards(page)).toHaveCount(4, UNDER_LOAD);
    await expect(cards(page).last()).toHaveAttribute('data-workspace', created);
    // the panel stores it, so a save, which sets metadata.created again, moves no card
    await expect
      .poll(async () => {
        const records = await (
          await page.request.get('/jupyterlab-workspace-manager-extension/meta')
        ).json();
        const highest = Math.max(
          ...[current, ...others].map(id => records[id]?.position)
        );
        return records[created]?.position > highest;
      }, UNDER_LOAD)
      .toBe(true);
  } finally {
    await deleteWorkspaces(page, [current, created, ...others]);
  }
});
