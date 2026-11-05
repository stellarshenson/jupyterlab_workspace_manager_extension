---
name: jupyterlab-workspace-manager-extension
description: Manages the workspaces, tabs, terminals and kernels of a running JupyterLab through the `jupyterlab-workspace` CLI of jupyterlab_workspace_manager_extension, and opens a locally served web app in the lab. Use when listing, creating, opening, describing, cleaning or removing workspaces, switching a window to a workspace, activating a tab, listing or killing terminals and kernels, when the ask names `jupyterlab-workspace` or "jupyterlab workspace cli", or when a locally served web app must run inside the lab with its session, storage, cookies and POSTs.
---

# jupyterlab-workspace

Run it on the lab's host; with no variable set it uses the one running server that carries a token. Commands, flags, output, environment variables and exit codes: `jupyterlab-workspace --help` and `jupyterlab-workspace <group> <command> --help`. Read them first.

## Rules

- Never print the token; the CLI reads it from the environment or the matching `jupyter server list` record
- Ask the user before `workspaces remove`, `workspaces clean`, `terminals kill` and `kernels kill`
- Read `TABS` of `workspaces list` as the panel's card counts it: documents and terminal tabs; a saved terminal key whose terminal no longer runs counts in neither `TABS` nor `TERMINALS`
- The CLI reads only the saved layout, so a tab JupyterLab does not restore, such as the Launcher or a second New View of a document, counts only in the card of the window that holds it
- `tabs list` prints a terminal tab as `terminal:N` with an empty `PATH`; `tabs activate` takes a document path only

## Run a local web app in the lab with all permissions

Use this when the app needs the lab's session, its storage or its cookies, or its POSTs must reach its own server.

1. Serve the app on 127.0.0.1 in its own directory, with its own store or API:

   ```bash
   cd <app directory>
   python3 -m http.server <port> --bind 127.0.0.1
   ```

2. Build the URL from the lab base that `jupyter server list` prints: `<lab base>/proxy/<port>/<path>`, for example `http://127.0.0.1:8888/proxy/5123/index.html`. The proxy path serves the app from the lab origin.
3. Open it with a null sandbox:

   ```bash
   jupyterlab-commands execute workspace-page:open --args '{"url": "<lab base>/proxy/<port>/<path>", "title": "My app", "icon": "<lab base>/proxy/<port>/favicon.svg", "policy": {"sandbox": null}}'
   ```

   The null removes the sandbox attribute, so the page keeps the lab origin: its scripts, storage, cookies and POSTs work. The `icon` URL overrides the tab's standard page icon (a comment bubble); leave it out to keep that icon. The mockup handover passes `{"policy": {"sandbox": null}}` for the same reason: the mockup saves its comments through `/proxy/<port>/comments`.

4. Without a policy the iframe is sandboxed to `allow-scripts`. The page renders and its scripts run, but its origin is opaque: no lab session, no storage, no cookies, and its requests do not reach the store. Keep the default for a page that only shows content; pass the null sandbox when it must save or read the lab.

`allow`, `referrerPolicy` and `csp` set their iframe attributes; `icon` is an image URL (svg or png) that overrides the tab's standard page icon (a comment bubble), which shows when it is left out; a malformed policy throws, naming the field, and opens no tab.

<!-- improved 2026-10-25 | body 102→91w / 11→11L | benchmark n/a (not-requested) | via improve-skill -->
<!-- improved 2026-10-25 | body 91→75w / 11→10L | benchmark n/a (not-requested) | via improve-skill -->
