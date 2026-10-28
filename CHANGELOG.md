# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [0.8.23] - 2026-10-28

### Added

- Four independent sections, WORKSPACES, KERNELS, TERMINALS and LANGUAGE SERVERS, each opening and closing on its own and keeping its state in the browser
- A fixed card order that a workspace switch does not change, with drag, Move up and Move down to change it
- A KERNELS row and a TERMINALS row open their item in this window, and a terminal row activates the tab of its running terminal and keeps that tab while the terminal runs
- The shutdown dialogs name every workspace that also holds the item

### Changed

- The panel follows the JupyterLab extension design system: header bands, neutral card surfaces, one scroll area per section with a fixed header, a 1 px focus ring and 14 px header glyphs
- Every colour is a JupyterLab CSS variable, so the panel follows the active theme; the workspace strips are more saturated and the first workspace is blue
- Every row shows only the status dot, the name and the time; the process, the kernel type, the document, the memory, the CPU, the purpose and the counts show when the row or its card is selected
- Destructive menu entries are red, a dialog carries one filled button and an error banner, and an icon that does not apply is disabled instead of hidden
- The KERNELS and TERMINALS sections list every item in the lab, in a workspace or not

### Fixed

- A TERMINALS or KERNELS row of another workspace's item switched the whole window instead of opening the item here, and a console kernel row did nothing
- An open hidden workspace card showed neither its purpose nor its counts
- Shut down all in a section header was too small to hit, and the shutdown dialog put the focus on Shut down so that Enter confirmed it
- A section header's accessible name was the fused text of its nested buttons, and the arrow keys did not reach a row from its button
- A shut-down terminal stayed in the list until the next poll; the terminals route now leaves out a terminal whose process has ended
- A KERNELS row cut the document name at the left instead of showing the whole name

## [0.8.17] - 2026-10-25

### Added

- A WORKSPACES header carrying the number of workspaces, with the workspace cards below it
- KERNELS, TERMINALS and LANGUAGE SERVERS sections below the workspaces, for what belongs to no workspace, each with its count and a shut down all and each empty one hidden
- The `jupyterlab-workspace` command line tool: `workspaces list`, `add`, `open`, `describe`, `remove` and `clean`, and `terminals` and `kernels` `list` and `kill`, against a running lab
- An agent skill for the CLI at `.agents/skills/jupyterlab-workspace-manager-extension`, shipped in the wheel
- A multiline tooltip on every row: a terminal's name, process and last activity, a kernel's kernelspec, session and state, a language server's id and language, a tab's full path

### Changed

- The panel header reads WORKBENCH on one line at the narrow sidebar width
- The Other sessions and In no workspace cards are gone, so recently closed documents and other windows' sessions are no longer listed
- A workspace purpose wraps and shows in full instead of ending in an ellipsis
- One section is open at a time, and a section header opens or closes its section

### Fixed

- `workspaces clean --empty` deleted a workspace whose main area is split, because the layout walk read only flat docks
- `workspaces clean` deleted a workspace another browser window was showing
- `workspaces add` wrote a slash-prefixed record id, leaving two records for one workspace
- The list output printed control characters raw, so a purpose could break the table or reach the terminal
- `workspaces describe` wrote a record for a name that is not a workspace
- The TABS column counted each terminal as a tab too

## [0.8.16] - 2026-10-25

### Added

- The workspace panel replaces the built-in Running Terminals and Kernels sidebar: one accordion section per workspace, with its colour strip, purpose, age and counts
- A card menu with open, open in a new browser tab, close all tabs, set description, colour, hide and delete
- Hiding a workspace, with the number of hidden workspaces under the last card
- In no workspace lists the lab's language servers beside its terminals and kernels, with shut down for one item and for all of them
- Other sessions lists the lab's open tabs, kernels, language servers and recently closed documents, with their actions
- A filter over workspace names, purposes and rows, which opens every card with a match
- A + button that creates a workspace and asks for its name and an optional description
- An action on a workspace another window shows is refused, so two windows never write one at once

### Changed

- The triangle opens or closes a card; a click on the header of another workspace's card switches this window to it, and a click on this window's card closes it
- The header shows how much a card holds, an open card ends with its last row, and Open and Close all tabs moved into its menu
- At the 250 px sidebar width the title and the labels shorten in a fixed order, and the hover icons take the age's place so a long name keeps its width
- A kernel row is named by its kernelspec display name, and two views of one document make one row

### Fixed

- Shut down all in In no workspace counted and shut only the terminals and kernels, so a language-servers-only section asked to shut down nothing
- The triangle's target was 16 px wide beside a header click that navigates; it now uses the panel's 22 x 22 icon button
- The Galata suite's waits now tolerate a host under heavy load, with one 60 s constant for the load-tolerant waits

<!-- <END NEW CHANGELOG ENTRY> -->
