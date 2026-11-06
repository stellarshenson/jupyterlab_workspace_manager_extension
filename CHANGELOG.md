# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.3] - 2026-11-06

### Added

- A tab opened with `workspace-page:open` saves in its workspace and reopens after a browser reload with its URL, title, icon and sandbox; a reused page tab keeps its one saved entry

### Changed

- Every workspace card other than this window's is dimmed: its header tint falls to 12 % and its body to 4.8 % of the workspace colour, its name and caret take a fainter ink and its count, purpose, hidden word and time a fainter one again; this window's card keeps its full tint, ink and outline
- This window's card count and (N of M) take the design system's dimmed count ink
- A Launcher tab is no card row and adds nothing to a card count or to the TABS column of `jupyterlab-workspace workspaces list`; `tabs list` still prints it
- The card eye shows the workspace's state: the open eye while it is shown, the crossed eye while it is hidden; the button's name still names its action
- A numbered terminal's card row starts its text 6 px after its icon, as every other row does, instead of 12 px

### Fixed

- Move to workspace moves a web page tab of `server-proxy:open`, the Help menu or `workspace-page:open`, and a Settings Editor or Log Console tab, instead of refusing it as not saved yet; a saved web tab moved into this window opens through its own command, and a tab JupyterLab never saves is refused with a message that says so
- Another workspace's card names a saved web tab by its saved title instead of its key, so a Help tab no longer shows an empty row and a titled page no longer shows its generated id

## [1.0.2] - 2026-11-06

### Changed

- The version moves to 1.0.2 at the owner's direction; the code and behaviour are those of 0.8.39

## [0.8.39] - 2026-11-06

### Changed

- The + New workspace button sits in the WORKSPACES section header, left of the clean-up eraser, instead of the WORKBENCH toolbar; a click, Enter or Space opens the New workspace dialog without opening or closing the section, and the button shows while the section is closed

## [0.8.38] - 2026-11-06

### Added

- `workspace-page:open` takes server-proxy:open's `id`, `title`, `url` and `newBrowserTab` arguments: `newBrowserTab` opens the page in a browser tab instead of a lab tab, and `id` names the tab's content widget

### Changed

- A page under the lab's `/proxy/<port>/` opens with server-proxy:open's sandbox, so it keeps the lab session, storage, cookies and POSTs with no policy argument; any other URL keeps `allow-scripts`, and `policy.sandbox` still replaces the sandbox or removes it with null
- Opening a page on the same port or with the same id as an open page tab reuses that tab and reloads it with the new title and icon; the page document is fetched past the browser cache, so new content shows
- A held terminal's number badge draws its box outline and its number in its holder's colour, a deeper shade in light themes and a paler one in dark themes, the number at 4.5:1 or more on the tint

## [0.8.37] - 2026-11-06

### Added

- The KERNELS and TERMINALS bands' power button opens a menu with Shut down all and Shut down detached, detached meaning no workspace holds the item; an entry with nothing to shut down is disabled, each asks once with its count, and the LANGUAGE SERVERS band keeps its single Shut down all

### Changed

- The last section band draws one 1 px `--jp-layout-color3` line where it meets the status bar while WORKSPACES is open, and none otherwise
- The numbered terminal badge is 18 x 13.5 px and takes the colour of the first workspace holding the terminal at the card header's 24 % wash, its number in the inverse ink at 4.5:1; a terminal in no workspace or a colourless workspace keeps the empty box
- A TERMINALS row's tooltip always carries a Workspaces line, naming every holder or reading none

### Fixed

- The terminals route skips a terminal whose pty child was reaped mid-read instead of answering 500
- A disabled danger entry in the band menu keeps the disabled ink instead of the danger red
- A stale terminal row keeps its numbered badge at full wash and ink
- The badge colour and the tooltip name the same first workspace

## [0.8.36] - 2026-11-05

### Added

- `workspace-page:open` shows a locally served page in a main-area tab under a sandbox policy, with a title, an optional icon URL and the standard page icon by default
- A Galata test proving a notification action opens the page with its title and icon

### Changed

- The workspace card header reads `name (N)` with no count glyphs, and a tab row shows the kernel glyph beside its file icon
- The workspace washes are 24 % and 9.6 % of the workspace hue
- Terminal and kernel tooltips carry a Memory line, and every KERNELS row shows its memory
- The card menu opens on right-click; Clear workspace replaces Close all tabs and closes the document manager's tabs before stopping its terminals and kernels
- The agent skill documents the workspace CLI and the local web app recipe

### Fixed

- Clear workspace stops a discarded document's kernel and keeps a cancelled one

## [0.8.35] - 2026-11-04

### Added

- A terminal row's tooltip opens with `terminal <name>`, so its number reads without the row text
- The row of this window's current tab carries `aria-current="true"` beside its tint, set by the render and by the tab switch, so assistive technology announces the row the tint shows

### Changed

- The card header and its body are one surface: the 1 px hue rule between them is gone
- A terminal row's name, its tab's name or else its process, is at the normal UI size after the `tN` label
- The current tab's row carries the bookmarks panel's current-row tint: brand colour 1 at 14 % over layout colour 1 on a plain surface, the workspace hue at 30 % on a coloured one
- The WORKBENCH header is the standard 37 px band: 2 px padding above and below a 32 px toolbar and its 1 px rule
- The time-ago marker is dimmed: inverse layout colour 2 on the coloured card header and on a current, hovered or selected row, inverse layout colour 3 on a resting body row, font colour 2 on a plain surface
- The section band separator is one 1 px `--jp-layout-color3` line, one step from the band fill, drawn only under a folded section that has a section below it and under the title band above WORKSPACES

### Fixed

- The WORKBENCH header stands as tall as a standard side panel header (`DEF-PANEL-84-HEADER-HEIGHT`)

## [0.8.34] - 2026-11-03

### Added

- A right-click on a workspace card's header opens its ... menu at the pointer; the context-menu key opens it below the header
- A tab or terminal row's menu offers Detach from workspace on a terminal and on a document with a running kernel: the tab leaves the workspace and the terminal or kernel keeps running, whatever the lab's shutdown-on-close settings say
- A tab or terminal row's menu offers Move to workspace, with a submenu of the other shown workspaces: the target is saved first, then the source, and a console moved into this window opens as a console; the move is refused when another window shows either workspace, the document has unsaved changes, or the file is open in two tabs of this window
- A terminal's tooltip shows its tab, process, command line, working directory, last activity and the workspaces that hold it, one line each
- The free width of a terminal row shows the working directory of its foreground process, cut from its start so the end stays in view, and hidden under 32 px

### Changed

- A numbered terminal reads t1, t2 in its row; a named terminal keeps its name
- A terminal row shows its tab's own name when it has one, and the process otherwise
- A row is lit only while it has the keyboard focus or its tab is the window's current tab, and it stays lit while a press inside the panel is held
- With WORKSPACES folded, the KERNELS, TERMINALS and LANGUAGE SERVERS bands follow it from the top; they stand at the panel bottom only while WORKSPACES is open, and any other open section is as tall as its rows
- The section triangles render at weight 600, the size of the bookmarks panel's triangles
- The Open workspace and Close all tabs buttons are gone from the card header; both stay in the ... menu, and a header click still switches to the workspace

### Fixed

- Two quick clicks on a terminal row no longer open two tabs for one terminal
- A click on a section band is no longer lost while a row is lit
- A tab moved into a workspace that was never opened no longer makes it open with both sidebars collapsed
- Move to workspace no longer moves another tab of the same file in place of the one chosen

## [0.8.33] - 2026-11-02

### Added

- A row in a workspace card has a context menu: Close tab on every row, Stop terminal on a terminal row, and Shut down kernel on a document with a running kernel, naming each kernel when the document runs more than one

### Changed

- A workspace card is an edge tab 2 px from the panel's edges, square at the left with a 2 px right radius; its header carries the workspace hue at 30 % and its rows at 12 %, with a 4 px full-strength strip and a 1 px hue rule between them, so the colour reads as the same hue in the light and the dark theme
- An open card lists its tabs in one flat list with no TABS, TERMINALS or KERNELS label: a terminal is a row with its icon and process, and a document shows its kernel's state word, dot and time
- The KERNELS, TERMINALS and LANGUAGE SERVERS sections stay, so a background terminal or a headless kernel with no tab stays listed and can be shut down there
- The clean-up button is an eraser and the three sections' Shut down all is a power symbol, each with equal space above and below in its band and in one column under the reload button
- Text, icons, caret and focus ring on a coloured card use the theme's inverse colours, which keep at least 4.5:1 on every tint in JupyterLab Light, JupyterLab Dark and Galaxa Steel
- A section list reserves no scrollbar strip until it overflows, so a card ends 2 px from the right edge
- The header age is the size of a row's time, and the workspace name starts at the left edge of the row labels below it
- A hovered or selected row in a coloured card keeps the workspace hue
- A terminal name in a card uses the UI font, and the TERMINALS section keeps the code font
- The filter matches a kernel through its document's row, and the card's count covers only the rows it shows

## [0.8.31] - 2026-11-02

### Added

- Any number of workspace cards stay open at once; a click on a card's triangle closes only that card and leaves the others open

### Changed

- Each workspace card's header and 4 px strip carry the muted shade of the workspace colour and this window's card the active shade, over a plain body; the twelve values come in a light and a dark set, so the colours read apart in both themes and an edited palette in the coloured tabs extension is not followed
- On a coloured card header the name, age, counts, purpose, count and action glyphs, caret and focus ring take the primary font colour, which keeps them above 3:1 on the workspace shade in every theme
- The broom is replaced by a clear-console circle and one diagonal stroke on the four band buttons, the Clean up workspaces button included

### Fixed

- A row's time and state inside a coloured card keep the secondary font colour instead of taking the header's
- A stale workspace's card name keeps full opacity, and its rows keep the fade

## [0.8.30] - 2026-11-01

### Changed

- The canonical Makefile is 1.47: `increment_version` takes a `BUMP` level, so a minor or major release raises the matching number and no longer needs a hand edit

## [0.8.29] - 2026-11-01

### Changed

- The six workspace colours are the coloured tabs palette's light active shades (`#e39fb1`, `#d2ab82`, `#bab56d`, `#87c086`, `#77bae0`, `#bfa9da`), and the Colour menu labels them Yellow and Purple
- The tab count rule reads "JupyterLab does not restore" instead of "does not save"

### Fixed

- A terminal row shows the process running in the terminal between the name and the time, in a card and in the TERMINALS section, without selection
- The tabs counter counts every open tab, terminal tabs and each view of one document included; `workspaces list` and `tabs list` follow the same rule
- Section bands span the panel edge to edge, with the 1 px divider above WORKSPACES; band and section-row focus rings are drawn inside the band
- A row in this window's card ends 2 px short of the card outline, so its focus ring is whole and crosses no icon

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
