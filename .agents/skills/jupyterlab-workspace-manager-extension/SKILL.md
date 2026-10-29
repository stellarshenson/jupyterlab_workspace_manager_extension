---
name: jupyterlab-workspace-manager-extension
description: Manages the workspaces, tabs, terminals and kernels of a running JupyterLab through the `jupyterlab-workspace` CLI of jupyterlab_workspace_manager_extension. Use when listing, creating, opening, describing, cleaning or removing workspaces, switching a window to a workspace, activating a tab, listing or killing terminals and kernels, or when the ask names `jupyterlab-workspace` or "jupyterlab workspace cli".
---

# jupyterlab-workspace

Run it on the lab's host; with no variable set it uses the one running server that carries a token. Commands, flags, output, environment variables and exit codes: `jupyterlab-workspace --help` and `jupyterlab-workspace <group> <command> --help`. Read them first.

## Rules

- Never print the token; the CLI reads it from the environment or the matching `jupyter server list` record
- Ask the user before `workspaces remove`, `workspaces clean`, `terminals kill` and `kernels kill`

<!-- improved 2026-10-25 | body 102→91w / 11→11L | benchmark n/a (not-requested) | via improve-skill -->
<!-- improved 2026-10-25 | body 91→75w / 11→10L | benchmark n/a (not-requested) | via improve-skill -->
