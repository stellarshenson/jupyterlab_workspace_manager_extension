# Acceptance Criteria - jupyterlab_workspace_manager_extension

The workspace panel that replaces the built-in Running panel: one accordion section per JupyterLab workspace with its tabs, terminals and kernels. Design in `docs/design/workspace-manager-design.html`, brief in `docs/brief.md`.

## Authors

- `@kj` Konrad Jelen

## Panel `PANEL`

The workspace panel in place of the built-in Running panel, its header and its reloads

- [ ] `ACC-PANEL-1-REPLACE` **Replaces the built-in panel** - CRITICAL; plugin `@jupyterlab/running-extension:sidebar` is disabled; the workspace panel holds the sidebar place of Running Terminals and Kernels
  - test: Galata panel.spec.ts: load lab, assert one sidebar tab `jp-running-sessions` showing the workspace panel and no `.jp-RunningSessions` section list
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-2-RESTORE` **Saved layouts restore the panel** - HIGH; a saved layout whose left sidebar showed the Running panel opens the workspace panel in the same place; restorer name stays `running-sessions`
  - test: Galata panel.spec.ts: save layout with left current `running-sessions`, reload, assert workspace panel visible
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-3-SHOWCMD` **Show panel command** - MEDIUM; command `running:show-panel` exists and shows the workspace panel
  - test: Galata panel.spec.ts: hide the sidebar, execute `running:show-panel`, assert panel visible
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-4-OTHERS` **Sections of other extensions** - HIGH; a section another extension registers through `IRunningSessionManagers` is listed under Other sessions with its items
  - test: Jest panel.spec.ts: register a fake manager with 2 items, assert both under Other sessions; Galata: Recently Closed listed there
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-5-ICON` **Own sidebar icon** - MEDIUM; the sidebar tab shows the extension's own one-colour LabIcon, never `ui-components:running`
  - test: Galata panel.spec.ts: assert the tab svg `data-icon` names the extension's icon
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-6-REFRESH` **Refresh button** - HIGH; the refresh button reloads workspaces, terminals, sessions and process names
  - test: Galata panel.spec.ts: create a terminal by REST, click refresh within 2 s, assert its row appears
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-7-REFRESH-BUSY` **Refresh in progress** - LOW; the refresh icon turns for at least 500 ms and the button is disabled until the requests return
  - test: Jest panel.spec.ts: fake timers, hold the requests, assert disabled and turning class, release, assert enabled after 500 ms
  - test-tags: UNIT
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-8-POLL` **Reload while visible** - MEDIUM; while the panel is visible it reloads every 10 s, without the turning icon
  - test: Jest panel.spec.ts: fake timers, advance 10 s, assert one reload and no turning class
  - test-tags: UNIT
  - log: 2026-10-23T13:58:15Z @kj added
- [ ] `ACC-PANEL-9-POLL-HIDDEN` **No reload while hidden** - LOW; while the panel is hidden it does not reload; it reloads once when shown
  - test: Jest panel.spec.ts: hide, advance 60 s, assert no request; show, assert one
  - test-tags: UNIT
  - log: 2026-10-23T13:58:15Z @kj added

## Workspace sections `ACCORD`

One accordion section per workspace: colour, purpose, age, counts, actions, menu

- [ ] `ACC-ACCORD-10-PER-WORKSPACE` **One section per workspace** - CRITICAL; every workspace jupyterlab_server lists has one section, except hidden ones
  - test: Galata sections.spec.ts: PUT 3 workspaces, refresh, assert 4 sections with their names
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:25Z @kj added
- [ ] `ACC-ACCORD-11-ONE-OPEN` **Exactly one section open** - CRITICAL; opening a section closes the section that was open
  - test: Galata sections.spec.ts: click header of a closed section, assert it is open and the previous one closed
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:25Z @kj added
- [ ] `ACC-ACCORD-12-START-OPEN` **Current workspace open at load** - HIGH; at load the section of this window's workspace is open
  - test: Galata sections.spec.ts: load `/lab/workspaces/<id>`, assert that section open
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-13-ORDER` **Section order** - MEDIUM; this window's workspace first, then the others by `last_modified` newest first, then In no workspace, then Other sessions
  - test: Jest model.spec.ts: three workspaces with known times, assert order
  - test-tags: UNIT
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-14-CURRENT` **Current workspace marked** - MEDIUM; the section of this window's workspace carries the mark current; no other section does
  - test: Galata sections.spec.ts: assert one `jp-mod-current` section and that it is this window's
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-15-STRIP` **Colour strip** - HIGH; each section shows a strip in its workspace colour on its left edge
  - test: Galata sections.spec.ts: two workspaces, assert their strips' computed colours are two different palette colours
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-16-ROTATION` **Colours in rotation** - HIGH; a workspace without a colour gets the palette colour after the last one given: rose, peach, lemon, mint, sky, lavender, then rose again
  - test: Jest palette.spec.ts: assign 7 workspaces, assert the sequence ends with rose
  - test-tags: UNIT
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-17-STABLE-COLOUR` **Colour stays** - HIGH; a workspace keeps its colour across reloads and when another workspace is deleted
  - test: Jest palette.spec.ts: assign 3, delete the first, reassign, assert colours of the other two unchanged; Galata reload
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-18-PURPOSE` **Purpose shown when given** - HIGH; the header shows the purpose text when one is set and no purpose line when none is set
  - test: Galata sections.spec.ts: set purpose on one of two workspaces, assert text on one header only
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-19-SET-PURPOSE` **Set purpose** - HIGH; menu item Set purpose sets, changes or clears the purpose; the value survives a reload
  - test: Galata menu.spec.ts: set, reload, assert; clear, reload, assert gone
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-20-AGE` **Workspace age** - HIGH; the header shows the time since the workspace's `metadata.last_modified` as now, Nm, Nh or Nd
  - test: Jest age.spec.ts: 30 s, 5 min, 3 h, 2 d against a fixed clock; Galata: age label present
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-21-AGE-NOW` **Age now in brand colour** - LOW; an age under 60 s reads now and takes `--jp-brand-color1`
  - test: Jest age.spec.ts: 59 s gives now and the recent class, 60 s gives 1m without it
  - test-tags: UNIT
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-22-COUNTS` **Terminal and kernel counts** - HIGH; the header shows the number of terminals and the number of kernels of the workspace
  - test: Galata sections.spec.ts: workspace with 2 terminal tabs and 1 notebook with a kernel, assert counts 2 and 1
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-23-OPEN` **Open the workspace** - CRITICAL; the header action open loads that workspace in this window with its tabs
  - test: Galata sections.spec.ts: workspace with a terminal tab, click open, assert URL `/lab/workspaces/<id>` and the terminal tab shown
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:26Z @kj added
- [ ] `ACC-ACCORD-24-OPEN-TAB` **Open in a new browser tab** - MEDIUM; menu item Open in new browser tab opens `/lab/workspaces/<id>` in a new browser tab; this window stays
  - test: Galata menu.spec.ts: wait for the new page, assert its URL and the first page's URL unchanged
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-25-CLOSE-CURRENT` **Close all tabs of this window's workspace** - CRITICAL; close all tabs on this window's workspace closes every main-area tab; an unsaved document asks as JupyterLab's own close does
  - test: Galata sections.spec.ts: open 2 documents and a terminal, close all, assert no main-area tab
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-26-CLOSE-OTHER` **Close all tabs of another workspace** - CRITICAL; close all tabs on another workspace removes its tab keys from the saved layout and from `data`; its terminals and kernels keep running
  - test: Galata sections.spec.ts: PUT workspace holding `terminal:<n>`, close all, GET it, assert no tab key and the terminal still in `/api/terminals`
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-27-CLOSE-WARN` **Close all asks when terminals are open** - HIGH; when the workspace holds terminals, close all asks once and says the culler may then shut those terminals down after its idle time
  - test: Galata sections.spec.ts: workspace with a terminal, close all, assert dialog text, cancel leaves the layout unchanged
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-28-CLOSE-ELSEWHERE` **Edge: workspace open in another window** - HIGH; close all tabs is refused for a workspace that another browser window shows, and the message says so
  - test: Galata sections.spec.ts: second page on workspace X, close all on X from the first page, assert refusal and layout unchanged
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-29-MENU` **Workspace menu** - HIGH; the ... button opens the menu: Open workspace, Open in new browser tab, Close all tabs, Set purpose, Colour, Hide workspace, Delete workspace
  - test: Galata menu.spec.ts: click ..., assert the seven labels in this order
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-30-SET-COLOUR` **Change colour** - MEDIUM; submenu Colour sets one of the six colours; the strip changes at once and the colour survives a reload
  - test: Galata menu.spec.ts: choose mint, assert strip colour, reload, assert again
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:37Z @kj added
- [ ] `ACC-ACCORD-31-DELETE` **Delete in two steps** - HIGH; Delete workspace arms Confirm delete on the first click and deletes on a second, separate click; the second click of a double-click does not delete
  - test: Jest menu.spec.ts: arm, click with detail 2 within 600 ms, assert not deleted; Galata: two clicks delete, GET answers 404
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-ACCORD-32-DELETE-CURRENT` **Edge: delete this window's workspace** - HIGH; Delete workspace is disabled on this window's workspace
  - test: Galata menu.spec.ts: open the menu of the current section, assert the item disabled
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added

## Section content `LISTS`

Which tabs, terminals and kernels a section lists, and what a row click does

- [ ] `ACC-LISTS-33-ORDER` **Tabs, then terminals, then kernels** - HIGH; an open section lists the workspace's tabs, then its terminals, then its kernels
  - test: Galata content.spec.ts: workspace with a document, a terminal and a notebook kernel, assert group order
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-34-ASSIGN-TERMINAL` **Terminal assigned by layout** - CRITICAL; a terminal belongs to a workspace when the workspace's saved layout holds `terminal:<name>`
  - test: Jest model.spec.ts: two saved layouts, assert each terminal under the right workspace
  - test-tags: UNIT
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-35-ASSIGN-KERNEL` **Kernel assigned by session** - CRITICAL; a kernel belongs to a workspace when a notebook or console tab of that workspace has a session on it
  - test: Jest model.spec.ts: sessions list and layouts, assert each kernel under the right workspace
  - test-tags: UNIT
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-36-LIVE` **Live tabs of this window** - HIGH; for this window's workspace the lists follow the open tabs: opening or closing a tab updates the section without refresh
  - test: Galata content.spec.ts: open a terminal, assert its row within 2 s; close it, assert row gone
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-37-TWO-WORKSPACES` **Edge: in two workspaces** - HIGH; a terminal or kernel in two workspaces appears in both sections with the mark also in <name>, and both counts include it
  - test: Jest model.spec.ts: one terminal in two layouts, assert both rows and marks; Galata: both rows visible
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-38-NO-WORKSPACE` **Edge: in no workspace** - HIGH; terminals and kernels in no workspace are listed in the section In no workspace, after the last workspace
  - test: Galata content.spec.ts: create a terminal by REST in no layout, assert it under In no workspace
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-39-ROW-CURRENT` **Row click in this window's workspace** - HIGH; a row click on a tab or terminal of this window's workspace activates its tab
  - test: Galata content.spec.ts: two terminals open, click the inactive one's row, assert its tab active
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-40-ROW-OTHER` **Row click in another workspace** - MEDIUM; a row click on an item of another workspace opens that workspace in this window
  - test: Galata content.spec.ts: click a row of another workspace, assert URL `/lab/workspaces/<id>`
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-LISTS-41-EMPTY` **Edge: empty workspace** - LOW; an open section of a workspace without tabs shows one empty-state line
  - test: Galata content.spec.ts: PUT an empty workspace, open its section, assert the line
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added

## Terminal rows `TERM`

What a terminal row shows and where each value comes from

- [ ] `ACC-TERM-42-PROCESS` **Process name** - CRITICAL; each terminal row shows the name of the foreground process of the terminal's pty
  - test: pytest test_terminals.py: start a terminal, run `sleep 30`, GET terminals, assert process `sleep`; Galata: row text
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-TERM-43-PROCESS-SHELL` **Edge: at the prompt** - MEDIUM; at the shell prompt the process name is the shell's name
  - test: pytest test_terminals.py: new terminal with `/bin/bash`, assert process `bash`
  - test-tags: UNIT
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-TERM-44-PROCESS-UNREAD` **Edge: process unreadable** - MEDIUM; when the foreground process cannot be read, the row shows the terminal name alone and the endpoint still answers 200
  - test: pytest test_terminals.py: make the `/proc` read raise, assert 200 and process null
  - test-tags: UNIT
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-TERM-45-ACTIVITY` **Last activity** - HIGH; each terminal row shows the time since the terminal's `last_activity` from `GET /api/terminals`
  - test: Galata terminals.spec.ts: type into a terminal, assert its row reads now
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:38Z @kj added
- [ ] `ACC-TERM-46-NAME` **Terminal name** - MEDIUM; each terminal row shows the terminal name after the process name
  - test: Galata terminals.spec.ts: assert row text contains `terminal <n>`
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-TERM-47-TITLE` **Tab title as tooltip** - LOW; when this window shows the terminal, the row's tooltip is the terminal tab's title
  - test: Galata terminals.spec.ts: send an OSC 2 title, assert the row's title attribute
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added

## Kernel rows `KERNEL`

What a kernel row shows

- [ ] `ACC-KERNEL-48-ROW` **Kernel row** - HIGH; each kernel row shows the kernel name, its notebook or console, and the time since the kernel's last activity
  - test: Galata kernels.spec.ts: open a notebook with a kernel, assert name, notebook and age
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-KERNEL-49-STATE` **Kernel state** - MEDIUM; the kernel row's dot shows the execution state, idle or busy
  - test: Jest model.spec.ts: idle and busy kernels, assert dot classes
  - test-tags: UNIT
  - log: 2026-10-23T13:58:39Z @kj added

## Hidden workspaces `HIDDEN`

The hide toggle of a workspace and the header button that shows hidden workspaces

- [ ] `ACC-HIDDEN-50-HIDE` **Hide a workspace** - CRITICAL; menu item Hide workspace removes the section from the panel
  - test: Galata hidden.spec.ts: hide a workspace, assert its section gone
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-HIDDEN-51-COUNT-LINE` **Hidden count** - MEDIUM; the line under the last section reads N hidden workspaces while N is more than 0, and is absent at 0
  - test: Galata hidden.spec.ts: hide 2, assert 2 hidden workspaces; show both, assert no line
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-HIDDEN-52-SHOW-HIDDEN` **Show hidden workspaces** - HIGH; the eye button in the header shows the hidden workspaces among the others, name in italics, with an eye button
  - test: Galata hidden.spec.ts: hide 1, press the header eye, assert its section with the hidden class
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-HIDDEN-53-UNHIDE` **Show a workspace again** - HIGH; the eye button of a hidden workspace makes it a shown workspace again
  - test: Galata hidden.spec.ts: unhide, release the header eye, assert the section stays
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-HIDDEN-54-PERSIST` **Hidden state persists** - HIGH; the hidden state survives a reload and is the same in every browser window
  - test: Galata hidden.spec.ts: hide in page 1, open page 2, assert hidden there; reload page 1, assert hidden
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-HIDDEN-55-CONTENT` **Content stays with the workspace** - MEDIUM; terminals and kernels of a hidden workspace stay hidden with it and are not listed under In no workspace
  - test: Jest model.spec.ts: hidden workspace with a terminal, assert the terminal in no visible group
  - test-tags: UNIT
  - log: 2026-10-23T13:58:39Z @kj added

## Filter `FILTER`

The filter field that finds anything in the panel, as in the AI assistants panel

- [ ] `ACC-FILTER-56-TOGGLE` **Filter field toggle** - HIGH; the filter button shows the filter field; pressing it again hides the field and clears the filter
  - test: Galata filter.spec.ts: press, type, press, assert field hidden and every row back
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-FILTER-57-MATCH` **Match rule** - HIGH; a match ignores case, accents, spaces and the separators - _ . /; queries of 10 or more characters allow 5% edits
  - test: Jest filter.spec.ts: `Foo-Bar` matches `foobar`; a 20-character query with one typo matches
  - test-tags: UNIT
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-FILTER-58-FIELDS` **Everything is searched** - HIGH; the filter searches workspace names, purposes, tab names and paths, process names, terminal names, tab titles, kernel names and their notebooks
  - test: Jest filter.spec.ts: one query per field, assert a match for each
  - test-tags: UNIT
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-FILTER-59-ROWS` **Only matches shown** - HIGH; with a filter, only matching rows are shown and a workspace without a match is not shown
  - test: Galata filter.spec.ts: query `claude` with one claude terminal, assert one row and one section
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:39Z @kj added
- [ ] `ACC-FILTER-60-MATCH-COUNT` **Match counts** - MEDIUM; with a filter, a section header reads N of M
  - test: Galata filter.spec.ts: 1 of 2 terminals match, assert `1 of 2`
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:45Z @kj added
- [ ] `ACC-FILTER-61-CLEAR` **Clear button** - MEDIUM; the clear button empties the field, keeps the caret in it and shows every row again
  - test: Galata filter.spec.ts: clear, assert focus in the field and all rows
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:45Z @kj added

## Server extension `SERVER`

Endpoints of the server extension

- [ ] `ACC-SERVER-62-TERMINALS` **Terminals endpoint** - HIGH; `GET jupyterlab-workspace-manager-extension/terminals` returns each terminal's name, `last_activity` and process name
  - test: pytest test_terminals.py: two terminals, assert both records and their fields
  - test-tags: UNIT
  - log: 2026-10-23T13:58:45Z @kj added
- [ ] `ACC-SERVER-63-AUTH` **Authentication** - CRITICAL; every endpoint of the extension answers 403 without Jupyter authentication
  - test: `make test` runs `check_auth.py`; pytest: each route without token answers 403
  - test-tags: UNIT
  - log: 2026-10-23T13:58:45Z @kj added
- [ ] `ACC-SERVER-64-PRESENCE` **Open workspaces per window** - HIGH; each browser window reports its workspace every 30 s; the server answers which workspaces another window reported in the last 90 s
  - test: pytest test_presence.py: two clients, fake clock, assert the 90 s window
  - test-tags: UNIT
  - log: 2026-10-23T13:58:45Z @kj added

## Culler sibling `CULLER`

Working beside jupyterlab_kernel_terminal_workspace_culler_extension in the same lab

- [ ] `ACC-CULLER-65-CULLED` **Removed by the culler** - HIGH; a workspace, terminal or kernel removed outside the panel leaves the panel at the next reload without an error
  - test: Galata culler.spec.ts: DELETE a workspace and a terminal by REST, refresh, assert both gone and no error
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:45Z @kj added
- [ ] `ACC-CULLER-66-NO-RECORD` **No record of a deleted workspace** - LOW; the extension keeps no purpose, colour or hidden record of a workspace that no longer exists
  - test: pytest test_meta.py: record for X, delete X, list, assert no record for X
  - test-tags: UNIT
  - log: 2026-10-23T13:58:45Z @kj added
- [ ] `ACC-CULLER-67-NO-SHUTDOWN` **Nothing ends without a click** - CRITICAL; the extension shuts down no terminal or kernel and deletes no workspace without a user click
  - test: Galata culler.spec.ts: panel open 30 s with polling, assert terminals, kernels and workspaces unchanged
  - test-tags: FUNCTIONAL
  - log: 2026-10-23T13:58:45Z @kj added

