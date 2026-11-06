---
name: jupyterlab-workspace-manager-extension
description: Manages the workspaces, tabs, terminals and kernels of a running JupyterLab through the `jupyterlab-workspace` CLI of jupyterlab_workspace_manager_extension, and opens a locally served web app in the lab. Use when listing, creating, opening, describing, cleaning or removing workspaces, switching a window to a workspace, activating a tab, listing or killing terminals and kernels, when the ask names `jupyterlab-workspace` or "jupyterlab workspace cli", or when a locally served web app must run inside the lab with its session, storage, cookies and POSTs.
---

# jupyterlab-workspace

Run it on the lab's host; with no variable set it uses the one running server that carries a token. Commands, flags, output, environment variables and exit codes: `jupyterlab-workspace --help` and `jupyterlab-workspace <group> <command> --help`. Read them first.

## Rules

- Never print the token; the CLI reads it from the environment or the matching `jupyter server list` record
- Ask the user before `workspaces remove`, `workspaces clean`, `terminals kill` and `kernels kill`
- Read `TABS` of `workspaces list` as the panel's card counts it: documents and terminal tabs, never a Launcher; a saved terminal key whose terminal no longer runs counts in neither `TABS` nor `TERMINALS`
- The CLI reads only the saved layout, so a tab JupyterLab does not restore, such as a second New View of a document, counts only in the card of the window that holds it
- `tabs list` prints a saved Launcher too, which `TABS` does not count, and a terminal tab as `terminal:N` with an empty `PATH`; `tabs activate` takes a document path only

## Run a local web app in the lab with all permissions

Use this when the app needs the lab's session, its storage or its cookies, or its POSTs must reach its own server.

1. Serve the app on 127.0.0.1 in its own directory, with its own store or API, and send `Cache-Control: no-store` on every file:

   ```bash
   cd <app directory>
   python3 -c 'import http.server as h,sys; H=type("H",(h.SimpleHTTPRequestHandler,),{"end_headers":lambda s:(s.send_header("Cache-Control","no-store"),h.SimpleHTTPRequestHandler.end_headers(s))}); h.ThreadingHTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' <port>
   ```

2. Build the URL from the lab base that `jupyter server list` prints: `<lab base>/proxy/<port>/<path>`, for example `http://127.0.0.1:8888/proxy/5123/index.html`. The proxy path serves the app from the lab origin.
3. Open it:

   ```bash
   jupyterlab-commands execute workspace-page:open --args '{"url": "<lab base>/proxy/<port>/<path>", "title": "My app", "icon": "<lab base>/proxy/<port>/favicon.svg"}'
   ```

   A URL under the lab's `/proxy/<port>/` or `/proxy/absolute/<port>/` gets the sandbox `server-proxy:open` gives, `allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals`, so the page keeps the lab origin: its scripts, storage, cookies and POSTs work and it needs no policy. The `icon` URL overrides the tab's standard page icon (a comment bubble); leave it out to keep that icon.

4. After rewriting the files the server serves, run the same command again. A page tab this command opened on the same port, or with the same `id`, is reused: no second tab opens, the iframe loads the URL again, and the tab takes the new title and icon and becomes the current tab. The page document of a URL on the lab's origin is fetched past the browser cache, so a rewritten page shows its new content. The scripts, styles and data the page loads follow their server's caching headers: without `Cache-Control: no-store`, as `python3 -m http.server` sends none, the browser can show their old content. The tab saves in the window's workspace: a browser reload reopens it with its URL, title, icon and policy, and a reused tab keeps its one saved entry. Move to workspace on the tab's row in the workspace panel sends it to another workspace, as it does a tab of `server-proxy:open` or the Help menu; a tab JupyterLab does not save in a workspace is refused, and is opened again by hand in the other workspace.

Any other URL is sandboxed to `allow-scripts`: the page renders and its scripts run, but its origin is opaque, with no lab session, storage or cookies. A lab whose Content-Security-Policy frames only its own origin shows no page of another origin, such as `http://127.0.0.1:<port>/`; serve it through `/proxy/<port>/`. `policy.sandbox` replaces either sandbox verbatim: a narrower value restricts a proxy page, and `null` removes the attribute, for a page that needs a permission the proxy sandbox leaves out, such as navigating the lab's top window. `allow`, `referrerPolicy` and `csp` set their iframe attributes. `id` becomes the id of the tab's content, and `newBrowserTab: true` opens the URL in a new browser tab and no lab tab, as `server-proxy:open` does. A malformed argument throws, naming it, and opens no tab.

<!-- improved 2026-10-25 | body 102→91w / 11→11L | benchmark n/a (not-requested) | via improve-skill -->
<!-- improved 2026-10-25 | body 91→75w / 11→10L | benchmark n/a (not-requested) | via improve-skill -->
