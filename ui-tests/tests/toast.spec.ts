import { expect, test } from '@jupyterlab/galata';

/**
 * A jupyterlab-notify toast's action button runs the command it was created with.
 * The store runs beside the lab: python3 tmp/mockups/serve.py <port>, WM_PAGE_PORT.
 */
const PORT = Number(process.env.WM_PAGE_PORT);
const PAGE = 'workbench-card-mockup.html';
const TITLE = 'WORKBENCH Card Mockup';
const PAGE_URL = `/proxy/${PORT}/${PAGE}`;
const ICON = `/proxy/${PORT}/icon.svg`;
const origin = `http://127.0.0.1:${PORT}`;

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

test('ACC-OPEN-287-PAGE-POLICY: a notification action opens the page with its title and icon', async ({
  page
}) => {
  test.setTimeout(120000);
  const status = await page.evaluate(
    async (args: Record<string, unknown>) => {
      const base = (window as any).jupyterapp.serviceManager.serverSettings
        .baseUrl;
      const reply = await fetch(
        `${base}jupyterlab-notifications-extension/ingest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Open the mockup',
            type: 'info',
            // autoClose 0 is JupyterLab's silent mode: no toast is created, and
            // the action could never be clicked.
            autoClose: false,
            immediate: true,
            actions: [
              {
                label: 'Open mockup',
                displayType: 'default',
                commandId: 'workspace-page:open',
                caption: 'Execute: workspace-page:open',
                args
              }
            ]
          })
        }
      );
      return reply.status;
    },
    { url: PAGE_URL, title: TITLE, icon: ICON, policy: { sandbox: null } }
  );
  expect(status).toBeLessThan(300);

  const action = page.getByRole('button', { name: 'Open mockup' }).first();
  await expect(action).toBeVisible({ timeout: 30000 });
  await action.click();

  const tab = page.locator('#jp-main-dock-panel .lm-TabBar-tab', {
    hasText: TITLE
  });
  await expect(tab).toHaveCount(1);
  const iframe = page.locator(`#jp-main-dock-panel iframe[src="${PAGE_URL}"]`);
  await expect(iframe).toHaveCount(1);
  expect(await iframe.getAttribute('sandbox')).toBeNull();
  await expect(tab.locator('svg image')).toHaveAttribute('href', ICON);

  const frame = page.frameLocator(
    `#jp-main-dock-panel iframe[src="${PAGE_URL}"]`
  );
  await expect(frame.locator('#sync')).toHaveAttribute('data-state', 'ok');

  await page.evaluate(() => {
    const shell = (window as any).jupyterapp.shell;
    Array.from(shell.widgets('main'))
      .filter((widget: any) => widget.node.querySelector('iframe'))
      .forEach((widget: any) => widget.close());
  });
});
