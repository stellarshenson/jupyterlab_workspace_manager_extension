---
name: jupyterlab-workspace-manager-extension
description: Manages the workspaces, tabs, terminals and kernels of a running JupyterLab through the `jupyterlab-workspace` CLI of jupyterlab_workspace_manager_extension. Use when listing, creating, opening, describing, cleaning or removing workspaces, switching a window to a workspace, activating a tab, listing or killing terminals and kernels, or when the ask names `jupyterlab-workspace` or "jupyterlab workspace cli".
---

# jupyterlab-workspace

Run it on the lab's host; with no variable set it uses the one running server that carries a token. Commands, flags, output, environment variables and exit codes: `jupyterlab-workspace --help` and `jupyterlab-workspace <group> <command> --help`. Read them first.

## Rules

- Never print the token; the CLI reads it from the environment or the matching `jupyter server list` record
- Ask the user before `workspaces remove`, `workspaces clean`, `terminals kill` and `kernels kill`
- Read `TABS` of `workspaces list` as the panel's card counts it: documents and terminal tabs; a saved terminal key whose terminal no longer runs counts in neither `TABS` nor `TERMINALS`
- The CLI reads only the saved layout, so a tab JupyterLab does not restore, such as the Launcher or a second New View of a document, counts only in the card of the window that holds it
- `tabs list` prints a terminal tab as `terminal:N` with an empty `PATH`; `tabs activate` takes a document path only

<!-- improved 2026-10-25 | body 102→91w / 11→11L | benchmark n/a (not-requested) | via improve-skill -->
<!-- improved 2026-10-25 | body 91→75w / 11→10L | benchmark n/a (not-requested) | via improve-skill -->
