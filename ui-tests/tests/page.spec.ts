import { expect, test } from '@jupyterlab/galata';
import type { Page } from '@playwright/test';

/**
 * The comment store runs beside the lab, outside the bubblewrap sandbox,
 * because the runner mounts this project read-only:
 *   python3 tmp/mockups/serve.py <port>
 * Start it before the suite and pass the same port as WM_PAGE_PORT. The lab
 * reaches it through /proxy/<port>/.
 */
const PORT = Number(process.env.WM_PAGE_PORT);
const PAGE = 'workbench-card-mockup.html';
const TITLE = 'Workbench page';
const COMMENT = 'a comment saved through the lab proxy';
const origin = `http://127.0.0.1:${PORT}`;
const url = `/proxy/${PORT}/${PAGE}`;
const ICON = `/proxy/${PORT}/icon.svg`;

/** The comments the store holds now. */
async function comments(): Promise<{ text?: string }[]> {
  const reply = await fetch(`${origin}/comments`);
  return (await reply.json()) as { text?: string }[];
}

/** Open the page through the command and return its tab and iframe. */
async function openPage(page: Page, args: Record<string, unknown>) {
  await page.evaluate(async (openArgs: Record<string, unknown>) => {
    await (window as any).jupyterapp.commands.execute(
      'workspace-page:open',
      openArgs
    );
  }, args);
  return {
    tab: page.locator('#jp-main-dock-panel .lm-TabBar-tab', { hasText: TITLE }),
    iframe: page.locator(`#jp-main-dock-panel iframe[src="${url}"]`),
    frame: page.frameLocator(`#jp-main-dock-panel iframe[src="${url}"]`)
  };
}

/** Close every main-area widget showing an iframe. */
async function closePages(page: Page) {
  await page.evaluate(() => {
    const shell = (window as any).jupyterapp.shell;
    Array.from(shell.widgets('main'))
      .filter((widget: any) => widget.node.querySelector('iframe'))
      .forEach((widget: any) => widget.close());
  });
  await expect(page.locator('#jp-main-dock-panel iframe')).toHaveCount(0);
}

test.beforeEach(async () => {
  if (!PORT) {
    throw new Error(
      'WM_PAGE_PORT is not set: start tmp/mockups/serve.py <port> first'
    );
  }
  const empty = await fetch(`${origin}/comments`, {
    method: 'POST',
    body: '[]'
  });
  expect(empty.status).toBe(204);
});

test('ACC-OPEN-287-PAGE-POLICY: the default sandbox is allow-scripts, the page scripts run, and its comment does not reach the store', async ({
  page
}) => {
  test.setTimeout(120000);
  const { tab, iframe, frame } = await openPage(page, { url, title: TITLE });

  await expect(tab).toHaveCount(1);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  // the tab shows the command's standard page icon: the same path set, no image
  const expectedPaths = await page.evaluate(() => {
    const svgstr = (window as any).jupyterapp.commands.icon(
      'workspace-page:open'
    ).svgstr as string;
    const parsed = new DOMParser().parseFromString(svgstr, 'image/svg+xml');
    return Array.from(parsed.querySelectorAll('path')).map(node =>
      node.getAttribute('d')
    );
  });
  const icon = tab.locator('.lm-TabBar-tabIcon svg');
  const tabPaths = await icon
    .locator('path')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('d')));
  expect(tabPaths.sort()).toEqual(expectedPaths.sort());
  await expect(tab.locator('image')).toHaveCount(0);

  // the page's own script ran and its fetch was refused: storage is blocked too
  await expect(frame.locator('#sync')).toHaveAttribute('data-state', 'local');

  // a comment typed in the page stays in the page
  await frame.locator('#stage').click({ position: { x: 120, y: 200 } });
  await frame.locator('#c-text').fill(COMMENT);
  await frame.locator('#c-save').click();
  await expect(frame.locator('#pins .pin')).toHaveCount(1);
  await expect(frame.locator('#sync')).toHaveText(
    'stored in this browser only - press Copy comments'
  );
  expect((await comments()).some(c => c.text === COMMENT)).toBe(false);

  await closePages(page);
});

test('ACC-OPEN-287-PAGE-POLICY: policy sandbox null keeps the lab origin, so a comment saves through the proxy, and the tab shows the icon URL', async ({
  page
}) => {
  test.setTimeout(120000);
  const { tab, iframe, frame } = await openPage(page, {
    url,
    title: TITLE,
    icon: ICON,
    policy: { sandbox: null }
  });

  expect(await iframe.getAttribute('sandbox')).toBeNull();
  await expect(tab.locator('svg image')).toHaveAttribute('href', ICON);
  await expect(frame.locator('#sync')).toHaveAttribute('data-state', 'ok');

  await frame.locator('#stage').click({ position: { x: 120, y: 200 } });
  await frame.locator('#c-text').fill(COMMENT);
  await frame.locator('#c-save').click();
  await expect(frame.locator('#pins .pin')).toHaveCount(1);
  await expect
    .poll(async () => (await comments()).some(c => c.text === COMMENT))
    .toBe(true);

  await closePages(page);
});
