import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';

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
const PROXY_SANDBOX =
  'allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals';
const TABS = '#jp-main-dock-panel .lm-TabBar-tab';
const IFRAMES = '#jp-main-dock-panel iframe';

/** The comments the store holds now. */
async function comments(): Promise<{ text?: string }[]> {
  const reply = await fetch(`${origin}/comments`);
  return (await reply.json()) as { text?: string }[];
}

/** Run workspace-page:open with `args`. */
async function execute(page: Page, args: Record<string, unknown>) {
  await page.evaluate(async (openArgs: Record<string, unknown>) => {
    await (window as any).jupyterapp.commands.execute(
      'workspace-page:open',
      openArgs
    );
  }, args);
}

/** Open the page through the command and return its tab and iframe. */
async function openPage(page: Page, args: Record<string, unknown>) {
  await execute(page, args);
  const iframe = `${IFRAMES}[src="${args.url}"]`;
  return {
    tab: page.locator(TABS, { hasText: args.title as string }),
    iframe: page.locator(iframe),
    frame: page.frameLocator(iframe)
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
  await expect(page.locator(IFRAMES)).toHaveCount(0);
}

/** Post a toast whose action `label` runs workspace-page:open with `args`, then click the action. */
async function openFromToast(
  page: Page,
  label: string,
  args: Record<string, unknown>
) {
  const status = await page.evaluate(
    async ({ actionLabel, actionArgs }) => {
      const base = (window as any).jupyterapp.serviceManager.serverSettings
        .baseUrl;
      const reply = await fetch(
        `${base}jupyterlab-notifications-extension/ingest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: actionLabel,
            type: 'info',
            autoClose: false,
            immediate: true,
            actions: [
              {
                label: actionLabel,
                displayType: 'default',
                commandId: 'workspace-page:open',
                caption: 'Execute: workspace-page:open',
                args: actionArgs
              }
            ]
          })
        }
      );
      return reply.status;
    },
    { actionLabel: label, actionArgs: args }
  );
  expect(status).toBeLessThan(300);
  const action = page.getByRole('button', { name: label }).first();
  await expect(action).toBeVisible({ timeout: 30000 });
  await action.click();
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

test('ACC-OPEN-287-PAGE-POLICY: a URL that is not a lab proxy URL gets the allow-scripts sandbox and the page script runs', async ({
  page
}) => {
  test.setTimeout(120000);
  // the lab's Content-Security-Policy frames only its own origin and data:, so
  // a data: page stands for any URL outside /proxy/<port>/
  const html =
    '<!doctype html><title>Sandboxed</title><p id="ran">no</p>' +
    "<script>document.getElementById('ran').textContent = 'ran';</script>";
  const { tab, iframe, frame } = await openPage(page, {
    url: `data:text/html,${encodeURIComponent(html)}`,
    title: TITLE
  });

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

  // the page's own script ran
  await expect(frame.locator('#ran')).toHaveText('ran');

  await closePages(page);
});

test('ACC-OPEN-293-PROXY-SANDBOX: a /proxy/<port>/ page opened with no policy gets the server-proxy:open sandbox and saves a comment through the proxy', async ({
  page
}) => {
  test.setTimeout(120000);
  const { tab, iframe, frame } = await openPage(page, { url, title: TITLE });

  await expect(tab).toHaveCount(1);
  await expect(iframe).toHaveAttribute('sandbox', PROXY_SANDBOX);
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

test('ACC-OPEN-294-PROXY-ARGS: newBrowserTab opens the url in a new browser page and no main-area tab', async ({
  page
}) => {
  test.setTimeout(120000);
  const before = await page.locator(TABS).count();

  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    execute(page, { url, title: TITLE, newBrowserTab: true })
  ]);
  await popup.waitForLoadState();

  expect(popup.url()).toBe(new URL(url, page.url()).href);
  await expect(page.locator(IFRAMES)).toHaveCount(0);
  await expect(page.locator(TABS, { hasText: TITLE })).toHaveCount(0);
  expect(await page.locator(TABS).count()).toBe(before);
  await popup.close();
});

test('ACC-OPEN-294-PROXY-ARGS: id names the content widget', async ({
  page
}) => {
  test.setTimeout(120000);
  await openPage(page, { url, title: TITLE, id: 'wm-page-content' });

  await expect(page.locator(`${IFRAMES}#wm-page-content`)).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      Array.from((window as any).jupyterapp.shell.widgets('main')).some(
        (widget: any) => widget.content?.id === 'wm-page-content'
      )
    )
  ).toBe(true);

  await closePages(page);
});

test('ACC-OPEN-295-PORT-RELOAD: a second open on the same proxy port with another title reuses the tab, loads it again and makes it current', async ({
  page
}) => {
  test.setTimeout(120000);
  const { frame, iframe } = await openPage(page, {
    url,
    title: 'First page'
  });
  await expect(frame.locator('#sync')).toHaveAttribute('data-state', 'ok');
  // count the loads that follow the first one
  await iframe.evaluate(node => {
    (window as any).wmPageLoads = 0;
    node.addEventListener('load', () => (window as any).wmPageLoads++);
  });
  await page.activity.activateTab('Launcher');

  const second = `${url}?second=1`;
  await execute(page, { url: second, title: 'Second page' });

  const tab = page.locator(TABS, { hasText: 'Second page' });
  await expect(page.locator(IFRAMES)).toHaveCount(1);
  await expect(tab).toHaveCount(1);
  await expect(page.locator(TABS, { hasText: 'First page' })).toHaveCount(0);
  await expect(page.locator(`${IFRAMES}[src="${second}"]`)).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).wmPageLoads))
    .toBe(1);
  await expect(tab).toHaveClass(/lm-mod-current/);

  await closePages(page);
});

test.describe('a page served with the headers of python3 -m http.server', () => {
  // the body and Last-Modified per path; the test changes them as an agent rewrites its files
  const files = new Map<string, { body: string; modified: Date }>();
  /** A page whose title and #version read `text`. */
  const html = (text: string) =>
    `<!doctype html><title>${text}</title><p id="version">${text}</p>`;
  // the path of every 200 the server sent
  const served: string[] = [];
  let server: Server;
  let base = '';

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const path = (request.url ?? '/').split('?')[0];
      const file = files.get(path);
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      // http.server answers 304 when the file is not newer than If-Modified-Since
      const since = Date.parse(request.headers['if-modified-since'] ?? '');
      if (file.modified.getTime() <= since) {
        response.writeHead(304).end();
        return;
      }
      served.push(path);
      const body = Buffer.from(file.body);
      // what http.server sends: no Cache-Control and no ETag
      response.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Length': body.length,
        'Last-Modified': file.modified.toUTCString()
      });
      response.end(body);
    });
    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', () => resolve())
    );
    base = `/proxy/${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  test('ACC-OPEN-295-PORT-RELOAD: opening a rewritten page again shows the document the server serves now, through the command and a notification action, after another page of the port and in a new tab', async ({
    page
  }) => {
    test.setTimeout(120000);
    // Galata mocks lab requests through page routes, and Playwright turns the
    // HTTP cache off while a route is set; without them the page caches as a
    // user's browser does
    await page.unrouteAll({ behavior: 'wait' });
    const hour = 3600 * 1000;
    const now = Math.floor(Date.now() / 1000) * 1000;
    const pageUrl = `${base}/page.html`;
    const version = page.frameLocator(IFRAMES).locator('#version');
    const iframes = page.locator(IFRAMES);
    const tab = (title: string) => page.locator(TABS, { hasText: title });
    /** Rewrite page.html to `text`, `age` hours old. */
    const rewrite = (text: string, age: number) =>
      files.set('/page.html', {
        body: html(text),
        modified: new Date(now - age * hour)
      });

    rewrite('version 1', 6);
    await execute(page, { url: pageUrl, title: 'First' });
    await expect(version).toHaveText('version 1');
    await expect(tab('First')).toHaveClass(/lm-mod-current/);

    // the agent rewrites the file and opens the same url again
    rewrite('version 2', 5);
    await page.activity.activateTab('Launcher');
    await execute(page, { url: pageUrl, title: 'Second' });
    await expect(version).toHaveText('version 2');
    await expect(iframes).toHaveCount(1);
    await expect(tab('First')).toHaveCount(0);
    await expect(tab('Second')).toHaveClass(/lm-mod-current/);

    // and once more through a notification action
    rewrite('version 3', 4);
    await page.activity.activateTab('Launcher');
    await openFromToast(page, 'Open version 3', {
      url: pageUrl,
      title: 'Third'
    });
    await expect(version).toHaveText('version 3');
    await expect(iframes).toHaveCount(1);
    await expect(tab('Second')).toHaveCount(0);
    await expect(tab('Third')).toHaveClass(/lm-mod-current/);

    // a second path on the same port lands in the same tab; the page rewritten
    // and opened again without a title shows the new document and its title
    files.set('/other.html', {
      body: html('other page'),
      modified: new Date(now - 6 * hour)
    });
    await execute(page, { url: `${base}/other.html`, title: 'Other' });
    await expect(version).toHaveText('other page');
    await expect(iframes).toHaveCount(1);
    await expect(tab('Other')).toHaveClass(/lm-mod-current/);
    rewrite('version 4', 3);
    await execute(page, { url: pageUrl });
    await expect(version).toHaveText('version 4');
    await expect(iframes).toHaveCount(1);
    await expect(tab('version 4')).toHaveClass(/lm-mod-current/);

    // the tab closed and the page rewritten: a new tab shows the new document
    await closePages(page);
    rewrite('version 5', 2);
    await execute(page, { url: pageUrl, title: 'Fifth' });
    await expect(version).toHaveText('version 5');
    await expect(tab('Fifth')).toHaveClass(/lm-mod-current/);

    // every open reached the server
    expect(served).toEqual([
      '/page.html',
      '/page.html',
      '/page.html',
      '/other.html',
      '/page.html',
      '/page.html'
    ]);

    await closePages(page);
  });
});
