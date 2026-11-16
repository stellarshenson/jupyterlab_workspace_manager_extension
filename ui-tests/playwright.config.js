/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

// Galata pins the test server to 8888 and does not move it when the port is taken.
// JUPYTER_TEST_PORT moves the server (jupyter_server_test_config.py) and this base URL together.
const PORT = process.env.JUPYTER_TEST_PORT || '8888';
const BASE_URL = `http://localhost:${PORT}`;

// The page server of page.spec.ts, webtab.spec.ts and toast.spec.ts. The specs read its port
// from WM_PAGE_PORT; unset, a free port is taken here once and the workers inherit it.
process.env.WM_PAGE_PORT ||= require('child_process')
  .execFileSync('python3', [
    '-c',
    'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
  ])
  .toString()
  .trim();
const PAGE_PORT = process.env.WM_PAGE_PORT;

module.exports = {
  ...baseConfig,
  // the specs share one server: a switch broadcast moves the page another spec is driving
  workers: 1,
  fullyParallel: false,
  use: { ...baseConfig.use, baseURL: BASE_URL },
  webServer: [
    {
      command: 'jlpm start',
      url: `${BASE_URL}/lab`,
      timeout: 120 * 1000,
      // Never adopt a server this suite did not start: on 8888 that is a developer's own lab.
      reuseExistingServer: false
    },
    {
      command: `python3 page-server/serve.py ${PAGE_PORT}`,
      url: `http://127.0.0.1:${PAGE_PORT}/icon.svg`,
      // a page server started by hand on WM_PAGE_PORT is used as it is
      reuseExistingServer: true
    }
  ]
};
