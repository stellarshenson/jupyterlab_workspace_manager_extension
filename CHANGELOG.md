# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [0.8.28] - 2026-10-30

### Changed

- The panel, its dialogs and its menus read every string through the extension's translation bundle; the wording is unchanged

### Fixed

- The lint check reports no warnings, down from 45: the strings are translated, every command carries `describedBy`, and the unused binding is gone
- The kernel-detail test asserts the type and folder give-way order by geometry instead of a font-dependent cut at a fixed width
- The tooltip test opens the notebook before waiting for its kernel, and gives kernel startup its own 60 s wait

## [0.8.27] - 2026-10-30

### Added

- Sections open exclusively: opening one closes the others, clicking the open one closes it, the closed set survives a reload, and WORKSPACES opens by default
- KERNELS, TERMINALS and LANGUAGE SERVERS dock at the panel bottom; the open section fills the height above them and is the only scroll container, with no row cap on the WORKSPACES list
- The current window's card paints its 2 px outline inside its box, so no band is clipped at a flush edge
- Every Galata suite runs through the bubblewrap runner: read-only project, scratch home and /tmp, its own free port

### Changed

- The labextension is scoped `@stellarshenson/jupyterlab-workspace-manager-extension` and every plugin and state id follows it, because JupyterLab 4.6.5's URI parser reports "URI scheme is malformed." for the old underscored id; the Python package keeps its underscored name
- The workspace colour washes the card body and header at 14 % while the 4 px strip keeps the token at full strength
- Every card and row surface spans the panel width, and the section header is the reference panel's 24 px band with its text caret

### Fixed

- The keyboard focus ring on the current card stays visible above the card's inside outline
- Two Galata tests no longer assume a section stays mounted when another one opens

## [0.8.26] - 2026-10-29

### Added

- `workspaces switch NAME` and `tabs activate PATH` reach a running window through an authenticated switch route, `--window` targets one window, and `windows list` prints the windows showing the panel
- `tabs list NAME` prints a workspace's document tabs in saved order
- `kernels list` shows each kernel's memory and CPU
- The WORKSPACES band carries a clean-up broom that deletes every other workspace and empties this one, behind a confirmation that lists each workspace's tabs, terminals and kernels and whether it is deleted, emptied or kept

### Changed

- Row names are neutral per DQ-21: the UI font size at normal weight in the first font colour, the purpose in the second, and recency carried by the time label alone
- The design is one self-contained `docs/design/workspace-manager-design.html`, and the README figure is retaken from the current build

### Fixed

- A claimed window's presence is held for 5 seconds instead of the 90 second presence lifetime
- With the server extension absent, the broom and the destructive card actions refuse and say the extension is unavailable, instead of reading an unknown presence as no other window
- A switch request reaches only the windows live when it was posted, and pending requests are applied in created order
- The kernel type is capped only on a KERNELS-section row, so a card kernel row cuts only when the type overflows
- `DEF-PANEL-60` and `DEF-PANEL-61` closed on tests proved red first

## [0.8.24] - 2026-10-29

### Added

- The Shut down all control of the KERNELS, TERMINALS and LANGUAGE SERVERS bands is the design system's broom icon button, with the accessible name Shut down all and the disabled state at 0.4 opacity

### Changed

- The section band keeps its height with the 22 px icon button, whose 14 px glyph takes its size from the same rule as every other header glyph
- The design page marks its former surface-button sentence as superseded by decision DQ-20

### Fixed

- The broom shows its hover background with its glyph, where only the background changed before
- The stylesheet rule order that made the lint job fail, and the tracker evidence line that made the link check fail
- The wheel declares Metadata-Version 2.4 again, which the release check's package server accepts

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
