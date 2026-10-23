# Brief - jupyterlab_workspace_manager_extension

Save a copy of this brief in the project as `docs/brief.md`.

## Purpose

The extension changes the JupyterLab panel "Running Terminals and Kernels" into a panel driven by workspaces. Workspaces are the first-level items. Each workspace shows its tabs, then its terminals and kernels.

## Required behaviour

The Star Colonel's requirements, in his order.

### Workspaces

- A workspace is a section of an accordion. Exactly one section is open: opening one section closes the open one
- Each workspace has a colour from a palette, assigned in rotation, shown as a coloured strip on the edge of the section (a tab colour placed on the side), in a modern style
- A workspace has an optional purpose text, shown when it is given
- The section shows the time since the workspace was last accessed (its age)
- The section header shows counts. The Star Colonel's words: "number of terminals workspaces and kernels in the section header"
- The section header carries the actions:
  - open the workspace, which shows its tabs
  - close all tabs in the workspace
- Inside a section: an optional list of the tabs open in the workspace, then the list of terminals and kernels

### Terminals

- Each terminal shows when it was last active
- Each terminal shows the name of the process running in it. The Star Colonel's words: "essentially the same thing as tab name"

### Look

- Modern look, built on the design system of the `jupyterlab-extension` skill

## Design before implementation

The Star Colonel wants a design proposal before any implementation.

1. Take screenshots of the current "Running Terminals and Kernels" panel in the running lab with the `my-browser` skill
2. Model the new panel in SVG
3. Write the design proposal as HTML in `docs/design/`, built from the screenshots and the SVG models
4. Stop and report. Acceptance criteria and implementation wait for the Star Colonel's approval of the design

## Questions the design must answer

These are open. Investigate them and present the answer in the design proposal.

- JupyterLab kernels and terminals belong to the server, and a workspace is a saved layout. How is a terminal or a kernel assigned to a workspace? Where does one show that belongs to no workspace, or to two?
- Where does the "last accessed" time of a workspace come from?
- Where do the last activity time and the process name of a terminal come from?
- How are the tabs of a workspace that is not the current one read and closed?
- Does the extension replace the built-in Running panel or add its own sidebar panel? Present the choice to the Star Colonel; do not decide it alone

## Read first

- `/home/lab/.claude/skills/jupyterlab-extension/design-language.md` and `/home/lab/.claude/skills/jupyterlab-extension/design-system/extension-design-system.dc.html` - the design system
- `../jupyterlab_colourful_tab_extension` - the tab colour palettes the workspace colours resemble
- `../jupyterlab_kernel_terminal_workspace_culler_extension` - a sibling installed in the same lab that culls idle kernels, terminals and workspaces; the two extensions must work together

## Session setup

- Write `.claude/settings.json` with `{"worktree": {"bgIsolation": "none"}}` as the first file, then work in place on `main`
- `/home/lab/workspace/.claude/CLAUDE.md` is absent on disk on 2026-10-23 (an unstaged deletion in the workspace repository). Reference it as the init prompt says; do not create or restore it
- Init ends with `make build` and `make test` green; then the design proposal; then stop

## Feasibility notes from the main jupyterlab session

Added to the brief by order of the Star Colonel on 2026-10-23. Statements from knowledge of JupyterLab, not checked in this container; the design verifies each one it depends on.

1. Kernels and terminals have no workspace (high confidence). A JupyterLab workspace is a saved layout; kernels and terminals belong to the server. "The terminals and kernels of a workspace" must be derived from the tabs in each workspace's saved layout. The design needs a rule for a kernel or terminal open in two workspaces, and for one open in no workspace
2. Terminal process name (medium-high confidence). The jupyter_server terminals REST API returns only the terminal name and last_activity. The name of the process running in a terminal needs server code that reads the terminal's foreground process. The project was generated as frontend-and-server, so the server extension has a place for it
3. Workspace "last accessed" (medium confidence). A saved workspace carries a last-modified time in its metadata. That is the time the layout was last saved, not the time the workspace was last viewed. The design must say which time the age shows, or how a true last-access time is recorded
4. Open choice for the Star Colonel: whether the extension replaces the built-in Running panel or adds its own sidebar panel. Present both in the design proposal; do not decide it alone
