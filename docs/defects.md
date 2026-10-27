# Defects - jupyterlab_workspace_manager_extension

Defects found in the workspace panel that replaces the built-in Running panel. Criteria in `docs/acc-crit.md`.

## Authors

- `@kj` Konrad Jelen

## Panel `PANEL`

the sidebar panel, its header and its loads

- log: 2026-10-24T05:43:20Z @kj category created

- [x] `DEF-PANEL-1-REFRESH-STALE` **Refresh during a poll shows old data** - MEDIUM; a refresh press while a poll load is in flight returns that load, so data from before the press is shown
  - evidence: Jest panel.spec.ts:436 passed in final-verify make test (Jest 42/42, pytest 34/34)
  - related: ACC-PANEL-6-REFRESH
  - test-tags: UNIT
  - repro: start a terminal by REST during a poll load, press refresh at once, the row appears only at the next poll
  - root-cause: 2026-10-24T05:43:20Z @kj panel.tsx _reload returns this._loading when a load is in flight; actions were fixed, refresh was not
  - log: 2026-10-24T05:43:20Z @kj added
  - log: 2026-10-24T05:43:24Z @kj edited test-tags added "UNIT"
  - log: 2026-10-24T11:09:00Z @kj closed; reason: final verification of the follow-up run, 2026-10-24
- [x] `DEF-PANEL-2-PARTIAL-RELOAD` **One failed list fails the whole reload** - MEDIUM; GET /api/kernels answers 500 while a kernel starts; the panel then drops the whole reload, shows Reload failed and keeps every list old until the next poll, 10 s later
  - evidence: Jest panel.spec.ts:406 passed in final-verify make test (Jest 42/42, pytest 34/34)
  - related: ACC-PANEL-96-LOAD-ERROR
  - repro: start a kernel by REST and reload the panel in the same instant; the line Reload failed shows and new terminals stay hidden
  - test-tags: UNIT
  - root-cause: 2026-10-24T08:43:42Z @kj panel.tsx load reads workspaces, records, terminals, kernels and sessions in one Promise.all, so one rejected request rejects the reload
  - log: 2026-10-24T08:43:42Z @kj added
  - log: 2026-10-24T11:09:00Z @kj closed; reason: final verification of the follow-up run, 2026-10-24
- [x] `DEF-PANEL-4-DELETED-REVIVED` **Close tabs brings back a deleted workspace** - MAJOR; Close all tabs or Close tab on a card whose workspace was deleted since the last reload saves a new workspace named /W, which shows as a new empty card
  - evidence: _closeAll and _closeTab stop when the fetch has no last_modified; Jest DEF-PANEL-4-DELETED-REVIVED fails without the guard, 43/43 pass with it; Galata 92/92 (tmp/workflows/ponytail/verify-r2.json)
  - repro: delete workspace W by REST, then before the next poll choose Close all tabs on W's card; GET /lab/api/workspaces lists /W
  - test-tags: UNIT
  - root-cause: 2026-10-24T12:01:13Z @kj _closeAll and _closeTab in panel.tsx save whatever store.fetch returns; jupyterlab_server answers a fetch of a missing file with empty data and metadata id /W
  - log: 2026-10-24T12:01:13Z @kj added
  - log: 2026-10-24T13:25:03Z @kj closed
- [x] `DEF-PANEL-5-KERNEL-START` **A starting kernel shows Reload failed** - MEDIUM; a kernel that starts while the panel loads makes GET /api/kernels answer 500 once, so the line Reload failed: kernels shows for one poll
  - evidence: load() requests the kernel list again after a 500 (patch-r1-4.diff); Jest one-500 test, 44/44; Galata 92/92 at 6 and default workers (tmp/workflows/review-impl/applied-r1-verify-2.json)
  - related: DEF-PANEL-2-PARTIAL-RELOAD
  - repro: start a kernel by REST and reload the panel in the same instant; culler.spec.ts ACC-CULLER-65-CULLED saw the line at 12 workers
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-10-24T14:31:03Z @kj jupyter_server 2.21.1 adds a starting kernel to _kernels one event-loop iteration before it sets last_activity; GET /api/kernels then raises TraitError
  - log: 2026-10-24T14:31:03Z @kj added
  - log: 2026-10-24T14:31:03Z @kj closed
  - log: 2026-10-24T14:31:07Z @kj edited repro "start a kernel by REST and reload the panel in the same instant; culler.spec.ts ACC-CULLER-65 saw the line at 12 workers" -> "start a kernel by REST and reload the panel in the same instant; culler.spec.ts ACC-CULLER-65-CULLED saw the line at 12 workers"
- [x] `DEF-PANEL-7-MENU-FOCUS` **Closing a menu drops keyboard focus** - MINOR; closing a card or row menu, by Escape or by an action, leaves keyboard focus on the page body; expected: focus returns to the button that opened the menu when that button still exists
  - evidence: keyboard.spec.ts:71 passed in both full runs: Escape and an action return the focus to the header menu button, and Escape to the row.
  - repro: Galata: Tab to a card's ... button, press Enter, press Escape, read document.activeElement: it is body
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T16:05:31Z @kj menus.ts opens a Lumino menu at the button and nothing returns focus to the button when the menu closes
  - log: 2026-10-24T16:05:31Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-PANEL-10-SHARED-VIEW` **Two views of one document collide** - MINOR; two views of one document in this window share one row key and one live entry, so React sees duplicate keys and a click or Close tab acts on the view registered last; expected: one row per document, a click activates a view of it, Close tab closes every view of it
  - evidence: content.spec.ts:612 passed in both full runs and the Jest panel and model suites passed in make test: two views of one document are one row, Close tab closes both.
  - repro: open a.ipynb and run New View for Notebook: the card shows two rows with one key, and Close tab on either closes only the newest view
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-10-24T16:05:31Z @kj panel.tsx builds the row key and the _live map from the path only
  - log: 2026-10-24T16:05:31Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-PANEL-11-SHUTDOWN-STALE` **Shut down all uses stale rows** - MINOR; Shut down all shuts down the terminals and kernels the card held when the menu opened; expected: those the workspace has when the user confirms
  - evidence: The Jest panel suite passed in make test: Shut down all uses the state at confirm and leaves the kernel another window opened while the dialog stood.
  - repro: open Shut down all on W; while the dialog is open another window moves a kernel out of W; confirm: that kernel is shut down
  - test-tags: UNIT
  - root-cause: 2026-10-24T16:05:31Z @kj panel.tsx collects the rows before the confirm dialog and acts on that list after it
  - log: 2026-10-24T16:05:31Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-PANEL-12-HOVER-CLICK` **Hover icons stay after a click** - MINOR; after a mouse click in a card header, the open and close-all-tabs icons of that closed card stay shown when the pointer leaves; expected: they hide, and keyboard focus still shows them (ACC-ACCORD-98-HOVER-ACTIONS)
  - evidence: sections.spec.ts:1114 passed in both full runs: after a header click the icons hide when the pointer leaves, and Tab still shows and reaches them.
  - repro: Galata: click an open card's header to close it, move the pointer off the card: the icons stay visible
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T16:05:32Z @kj the rule that shows the icons on keyboard focus uses :focus-within, which a mouse click also sets; round 2 of the review reverted :focus-visible and :has() because Tab then dropped focus to the page
  - log: 2026-10-24T16:05:32Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T16:05:49Z @kj amended text "after a mouse click in a card header, the open and close-all-tabs icons of that closed card stay shown when the pointer leaves; expected: they hide, and keyboard focus still shows them (ACC-ACCORD-98)" -> "after a mouse click in a card header, the open and close-all-tabs icons of that closed card stay shown when the pointer leaves; expected: they hide, and keyboard focus still shows them (ACC-ACCORD-98-HOVER-ACTIONS)"; reason: full criterion id in the text
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-PANEL-13-SEARCH-ICON` **Header button with an unclear icon** - MINOR; the panel header shows the Search Tabs and Running Sessions button with the glyph of the Launcher tab and no label, so a user cannot tell what it does
  - evidence: panel.spec.ts:313 passed in both full runs: the Launcher-glyph header button is gone; panel.spec.ts:347 passed with the header order and 24 px buttons.
  - related: ACC-PANEL-169-NO-SEARCH
  - repro: open the panel: the last header button shows a box with an arrow, the icon of the Launcher tab; its tooltip is the only clue
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T20:07:40Z @kj @jupyterlab/running-extension:search-tabs adds a CommandToolbarButton with launcherIcon and an empty label to the toolbar of the plugin that provides IRunningSessionSidebar, and ACC-PANEL-89-SEARCH-TABS kept it
  - log: 2026-10-24T20:07:40Z @kj added; reason: the Star Colonel, 2026-10-24 22:15: the Search tabs button is not needed, the panel's filter covers search
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-PANEL-14-SHUTDOWN-EMPTY` **In no workspace Shut down all offers 0 and does nothing** - MINOR; In the language-servers-only state, In no workspace offers Shut down all, whose confirmation names 0 terminals and 0 kernels and which shuts nothing down; In no workspace also holds the lab's language servers, which can be shut down, so the item must count and shut them too
  - evidence: content.spec.ts:172 and the Jest DEF-PANEL-11-SHUTDOWN-STALE test passed in make test and both final runs: the confirmation names 1 terminal, 1 kernel and 1 language server, and the language server's connection ends
  - root-cause: 2026-10-25T00:41:11Z @kj _shutDownAll counts and shuts only section.terminals and section.kernels; the In no workspace section also carries the lab's Language servers manager, whose items have a shutdown, so a language-servers-only section produces a 0 of 0 confirmation and no action
  - repro: With a notebook's LSP connection and no terminal or kernel outside a workspace, open In no workspace and click Shut down all; the dialog names 0 terminals and 0 kernels and the action does nothing (src/panel/panel.tsx:915-925, :1093-1101; adversarial review round 1 of wf_b7db7430-677)
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-24T23:42:18Z @kj added
  - log: 2026-10-25T00:41:10Z @kj edited text "In the language-servers-only state, In no workspace shows Shut down all, whose confirmation names 0 terminals and 0 kernels and which then shuts nothing down; ACC-LISTS-110 requires the item and ACC-LISTS-160 makes the state reachable, so a fix needs a criterion amendment" -> "In the language-servers-only state, In no workspace offers Shut down all, whose confirmation names 0 terminals and 0 kernels and which shuts nothing down; In no workspace also holds the lab's language servers, which can be shut down, so the item must count and shut them too"; reason: the Star Colonel, 2026-10-25: language servers can be shut down
  - log: 2026-10-25T01:29:05Z @kj closed; reason: fix run wf_4cf05fcc-fc4 of 2026-10-25
  - log: 2026-10-25T01:29:15Z @kj edited test-tags "MANUAL" -> "FUNCTIONAL, UNIT"; evidence "content.spec.ts:172 and Jest DEF-PANEL-11 passed in make test and both final runs: the confirmation names 1 terminal, 1 kernel and 1 language server, and the language server's connection ends" -> "content.spec.ts:172 and the Jest DEF-PANEL-11-SHUTDOWN-STALE test passed in make test and both final runs: the confirmation names 1 terminal, 1 kernel and 1 language server, and the language server's connection ends"; reason: final fix evidence, 2026-10-25
- [x] `DEF-PANEL-15-ORDER-JUMPS` **Workspace cards reorder on a switch** - MAJOR; switching this window to another workspace moves that workspace's card to the top and orders the rest by last save; expected: one fixed order; `src/model/model.ts`
  - evidence: Jest model.spec.ts and Galata sections.spec.ts:150 ACC-ACCORD-190-FIXED-ORDER passed; make test exit 0: Jest 69 of 69, pytest 99 passed (tmp/workflows/sections/logs/make-test-suite.log); Galata 118 of 118 passed (tmp/workflows/sections/logs/galata-suite-1.log)
  - related: ACC-ACCORD-190-FIXED-ORDER
  - repro: panel with three workspaces; click the header of the last card; after the switch its card is first
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-10-26T15:57:10Z @kj `sections.sort` in `buildModel` of `src/model/model.ts` puts this window's workspace first and the others by `last_modified` newest first, as ACC-ACCORD-13-ORDER required
  - log: 2026-10-26T15:57:10Z @kj added
  - log: 2026-10-26T17:59:12Z @kj fixed: `sections.sort` in `buildModel` of `src/model/model.ts` sorts by stored position, then `metadata.created`, then id; this window's workspace and `last_modified` take no part
  - log: 2026-10-26T17:59:12Z @kj closed
- [x] `DEF-PANEL-16-HEADER-BOXES` **Section headers drawn as boxes** - MEDIUM; the KERNELS, TERMINALS and LANGUAGE SERVERS headers are rounded grey boxes inset from the panel edges, like the workspace cards; expected: flat full-width section titles; `style/base.css`
  - evidence: Galata panel.spec.ts:435 ACC-PANEL-192-SECTION-TITLES passed; make test exit 0: Jest 69 of 69, pytest 99 passed (tmp/workflows/sections/logs/make-test-suite.log); Galata 118 of 118 passed (tmp/workflows/sections/logs/galata-suite-1.log)
  - related: ACC-PANEL-192-SECTION-TITLES
  - repro: a terminal outside any workspace; open the panel; the TERMINALS header is a rounded box with an 8px margin each side
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-26T15:57:11Z @kj `.jp-WorkspaceManager-sectionHeader` in `style/base.css` sets `margin: 0 8px`, `border-radius: 3px` and `background: var(--jp-layout-color2)`; the WORKSPACES header uses the same rule
  - log: 2026-10-26T15:57:11Z @kj added
  - log: 2026-10-26T17:59:12Z @kj fixed: `.jp-WorkspaceManager-sectionHeader` in `style/base.css` drops `margin: 0 8px`, `border-radius: 3px` and the `--jp-layout-color2` fill and takes the values of the JupyterLab accordion title
  - log: 2026-10-26T17:59:12Z @kj closed
- [x] `DEF-PANEL-17-SECTIONS-MISSING` **Empty sections are missing** - MAJOR; the KERNELS and LANGUAGE SERVERS sections are not shown whenever they have no rows; expected: all four sections always shown; `src/panel/panel.tsx`
  - evidence: Jest panel.spec.ts and Galata panel.spec.ts:481 ACC-PANEL-193-SECTIONS-SHOWN passed; make test exit 0: Jest 69 of 69, pytest 99 passed (tmp/workflows/sections/logs/make-test-suite.log); Galata 118 of 118 passed (tmp/workflows/sections/logs/galata-suite-1.log)
  - related: ACC-PANEL-193-SECTIONS-SHOWN
  - repro: lab with no kernel and no language server running; open the panel; no KERNELS and no LANGUAGE SERVERS header
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-26T15:57:11Z @kj `_render` in `src/panel/panel.tsx` draws KERNELS, TERMINALS and LANGUAGE SERVERS only under `unowned.kernels.length > 0`, `unowned.terminals.length > 0` and `servers.length > 0`, as ACC-PANEL-182-SECTION-HEADS required
  - log: 2026-10-26T15:57:11Z @kj added
  - log: 2026-10-26T17:59:12Z @kj fixed: `_render` in `src/panel/panel.tsx` always draws KERNELS, TERMINALS and LANGUAGE SERVERS; an empty one reads No kernels, No terminals or No language servers and its Shut down all is disabled
  - log: 2026-10-26T17:59:12Z @kj closed
- [x] `DEF-PANEL-18-UNOWNED-ONLY` **TERMINALS and KERNELS skip workspace items** - MAJOR; a terminal or kernel that a workspace holds is not listed in TERMINALS or KERNELS; only those in no workspace are; expected: every running terminal and kernel; `src/model/model.ts`
  - evidence: Jest model.spec.ts and panel.spec.ts ACC-LISTS-194-ALL-TERMINALS, ACC-LISTS-195-ALL-KERNELS, Galata content.spec.ts:256 and kernels.spec.ts:272 passed; make test exit 0: Jest 69 of 69, pytest 99 passed (tmp/workflows/sections/logs/make-test-suite.log); Galata 118 of 118 passed (tmp/workflows/sections/logs/galata-suite-1.log)
  - related: ACC-LISTS-194-ALL-TERMINALS, ACC-LISTS-195-ALL-KERNELS
  - repro: open a terminal and a notebook in this window's workspace; TERMINALS and KERNELS do not list them
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-10-26T15:57:11Z @kj `unowned` in `buildModel` of `src/model/model.ts` keeps only terminals absent from `termHolders` and kernels absent from `kernelHolders`; `_render` in `src/panel/panel.tsx` fills TERMINALS and KERNELS from `unowned`
  - log: 2026-10-26T15:57:11Z @kj added
  - log: 2026-10-26T17:59:13Z @kj fixed: `buildModel` in `src/model/model.ts` returns every terminal and kernel, each with `alsoIn` naming the workspaces that hold it; `_render` fills TERMINALS and KERNELS from them
  - log: 2026-10-26T17:59:13Z @kj closed
- [x] `DEF-PANEL-19-RECORDS-FAIL` **Failed records read overwrites the card order** - MAJOR; when the records request (GET meta) fails on a page's first load, the panel writes new positions over the stored ones, so the dragged card order is lost in every window; expected: stored positions stay; `src/panel/panel.tsx`
  - evidence: Jest panel.spec.ts DEF-PANEL-19-RECORDS-FAIL passed and failed on the code without the guard (tmp/workflows/sections/logs/make-test-r1b-guard-red.log); make test exit 0: Jest 71 of 71, pytest 100 passed (tmp/workflows/sections/logs/make-test-r1b-guard.log)
  - repro: stored positions default 0, auto-6 1; the meta route answers 500 on the first load of a page; PATCH meta/auto-6 and meta/default write positions 0 and 1
  - test-tags: UNIT
  - root-cause: 2026-10-26T19:18:47Z @kj `_reload` in `src/panel/panel.tsx` calls `_givePositions()` after every load; with the records request failed, `_data.records` is the empty records of `EMPTY`, so `_givePositions` counts every workspace as without a position and PATCHes a new one for each
  - log: 2026-10-26T19:18:47Z @kj added
  - log: 2026-10-26T19:20:23Z @kj fixed: `_reload` in `src/panel/panel.tsx` calls `_givePositions()` only when the load returned the records (`if (data.records)`); a failed records request gives no position
  - log: 2026-10-26T19:20:23Z @kj closed

## Functional tests `GALATA`

the Galata suite under ui-tests/ and its rig

- log: 2026-10-24T11:09:11Z @kj category created

- [x] `DEF-GALATA-3-DEFAULT-WORKERS` **Galata suite fails at the default 32 workers** - MEDIUM; the documented command sets no --workers, so Playwright runs 32 on this 64-core machine; terminals.spec.ts:56 failed twice (expected sleep, received bash), kernels.spec.ts:45 once (no session in 5 s)
  - evidence: 36 untimed expect.poll waits take UNDER_LOAD 20 s; full Galata suite 92/92 with --retries=0 at default workers twice and at 6 workers once (tmp/workflows/ponytail/defect-verify-r1)
  - repro: in ui-tests/, run the full suite with --retries=0 and no --workers, as tmp/workflows/implement-2/final-verify/runs.sh galata-full-32w-1 did
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T11:09:11Z @kj expect.poll waits use the 5000 ms default where neither criterion names a time; with 32 browser workers on one test server, typing sleep 300 and starting a kernel take longer than 5 s
  - log: 2026-10-24T11:09:11Z @kj added
  - log: 2026-10-24T11:46:26Z @kj closed
  - log: 2026-10-24T12:40:07Z @kj regressed as DEF-GALATA-3-DEFAULT-WORKERS-1
- [x] `DEF-GALATA-3-DEFAULT-WORKERS-1` **Galata suite fails at the default 32 workers** - MEDIUM; the documented command sets no --workers, so Playwright runs 32 on this 64-core machine; terminals.spec.ts:56 failed twice (expected sleep, received bash), kernels.spec.ts:45 once (no session in 5 s)
  - evidence: test lab loads only Galata, this extension and the Steel theme, tests-* hidden from listings; Galata 92/92 --retries=0 at default workers twice and 6 workers once (tmp/workflows/ponytail/verify-r2.json)
  - test-tags: FUNCTIONAL
  - repro: in ui-tests/, run the full suite with --retries=0 and no --workers; first-batch tests such as keyboard.spec.ts:40 fail in page.goto after 15 s (tmp/galata-rig/implement-2/verify-r1-default-1.log)
  - root-cause: 2026-10-24T13:25:03Z @kj the test lab loaded all 71 lab extensions of the workstation; jupyterlab_server work per page load scales with them, so 12 windows at once started in 12 s against page.goto's fixed 15 s; also a root listing 404 when another worker deletes its tests-<name> folder mid-listing
  - root-cause: 2026-10-24T12:40:10Z @kj Galata's page.goto waits 15 s for window.jupyterapp.started; with 12 workers the first 12 cold page loads hit one test server at once and one or two take longer
  - log: 2026-10-24T12:40:07Z @kj regression of DEF-GALATA-3-DEFAULT-WORKERS; reason: ponytail verify r1: at default workers 2 of 92 failed in page.goto, waitForAppStarted 15 s during the first 12 parallel page loads; also seen in galata-c all-1.log at 09:49
  - log: 2026-10-24T12:40:16Z @kj edited repro added "in ui-tests/, run the full suite with --retries=0 and no --workers; first-batch tests such as keyboard.spec.ts:40 fail in page.goto after 15 s (tmp/galata-rig/implement-2/verify-r1-default-1.log)"; test-tags added "FUNCTIONAL"
  - log: 2026-10-24T13:25:03Z @kj root-cause overridden; reason: measured by the ponytail fix round
  - log: 2026-10-24T13:25:03Z @kj closed
  - log: 2026-10-25T00:41:11Z @kj regressed as DEF-GALATA-3-DEFAULT-WORKERS-2
- [x] `DEF-GALATA-3-DEFAULT-WORKERS-2` **Galata suite fails at the default 32 workers** - MEDIUM; the documented command sets no --workers, so Playwright runs 32 on this 64-core machine; terminals.spec.ts:56 failed twice (expected sleep, received bash), kernels.spec.ts:45 once (no session in 5 s)
  - test-tags: FUNCTIONAL
  - repro: in ui-tests/, run the full suite with --retries=0 and no --workers at host load near 88; before the fix content.spec.ts:721, sections.spec.ts:781 and hidden.spec.ts:115 each failed once at an app-start, a Refresh or a count wait and passed alone (tmp/galata-rig/final-verify-deferred/)
  - evidence: full 12-spec suite passed at --retries=0 in both final runs at host load 87: 106 at 6 workers, 106 at the default 12 workers
  - log: 2026-10-25T00:41:11Z @kj regression of DEF-GALATA-3-DEFAULT-WORKERS-1: regressed at 2026-10-25 final verification: content.spec.ts:721 and sections.spec.ts:781 failed once each in the 6-worker run and hidden.spec.ts:115 in the default-worker run, all at host load average 88, each passing alone and in the other run
  - log: 2026-10-25T01:29:05Z @kj closed; reason: fix run wf_4cf05fcc-fc4 of 2026-10-25
  - log: 2026-10-25T01:29:15Z @kj edited repro added "in ui-tests/, run the full suite with --retries=0 and no --workers at host load near 88; before the fix content.spec.ts:721, sections.spec.ts:781 and hidden.spec.ts:115 each failed once at an app-start, a Refresh or a count wait and passed alone (tmp/galata-rig/final-verify-deferred/)"; test-tags added "FUNCTIONAL"; reason: regression detail, 2026-10-25
- [x] `DEF-GALATA-6-LAUNCHER-RACE` **Close all test reads the main area too early** - MINOR; sections.spec.ts ACC-ACCORD-25-CLOSE-CURRENT read the main area once after Close all and found 0 widgets where the new Launcher was expected
  - evidence: the test polls until one launcher- widget is in the main area, same assertion (patch-r1-5.diff); Galata 92/92 at 6 and default workers (tmp/workflows/review-impl/applied-r1-verify-2.json)
  - repro: full Galata suite at 6 workers, --retries=0; sections.spec.ts:558 failed once
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T14:31:03Z @kj JupyterLab's shell emits layoutModified through a 0 ms Debouncer and the Launcher is added on that signal, so the main area is empty for a moment
  - log: 2026-10-24T14:31:03Z @kj added
  - log: 2026-10-24T14:31:03Z @kj closed
  - log: 2026-10-24T14:31:07Z @kj amended text "sections.spec.ts ACC-ACCORD-25 read the main area once after Close all and found 0 widgets where the new Launcher was expected" -> "sections.spec.ts ACC-ACCORD-25-CLOSE-CURRENT read the main area once after Close all and found 0 widgets where the new Launcher was expected"; reason: full id of the criterion

## Server extension `SERVER`

routes of the server extension

- log: 2026-10-24T16:05:31Z @kj category created

- [x] `DEF-SERVER-8-PRESENCE-RESTART` **No refusal after a server restart** - MINOR; for up to 30 s after a server restart, Close all tabs, Delete workspace and Open are not refused for a workspace another window shows (ACC-ACCORD-28-CLOSE-ELSEWHERE); expected: refused as before the restart
  - evidence: Both pytest tests PASSED in make test (39 passed, 0 failed): reports outlive a server restart and are stored in the presence file for the next server.
  - repro: window B shows W; restart the server; within 30 s window A runs Close all tabs on W: it is not refused
  - test-tags: UNIT
  - root-cause: 2026-10-24T16:05:31Z @kj presence is held only in server memory (routes.py) and each window reports every 30 s (index.ts), so a restarted server knows no window until the next report
  - log: 2026-10-24T16:05:31Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T16:05:49Z @kj amended text "for up to 30 s after a server restart, Close all tabs, Delete workspace and Open are not refused for a workspace another window shows (ACC-ACCORD-28); expected: refused as before the restart" -> "for up to 30 s after a server restart, Close all tabs, Delete workspace and Open are not refused for a workspace another window shows (ACC-ACCORD-28-CLOSE-ELSEWHERE); expected: refused as before the restart"; reason: full criterion id in the text
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25
- [x] `DEF-SERVER-9-EARLY-RECORD` **Record given before the workspace file is lost** - MINOR; a colour, purpose or hidden flag given to a workspace before JupyterLab first saves its file is lost; expected: the record is kept
  - evidence: The three test_meta.py pytest tests PASSED in make test (39 passed): a record before the first save is kept, a never-saved one pruned after 90 s, and the record follows the file.
  - repro: PATCH meta/<id> for an id with no workspace file, then GET meta: the record is gone; with no workspaces folder the PATCH answers 500
  - test-tags: UNIT
  - root-cause: 2026-10-24T16:05:31Z @kj the records file is written into a folder that may not exist yet, and GET prunes every record whose workspace file is missing
  - log: 2026-10-24T16:05:31Z @kj added; reason: deferred by round 3 of the implementation review; filed on the Star Colonel's word, 2026-10-24
  - log: 2026-10-24T23:10:13Z @kj closed; reason: deferred-items campaign final verification, 2026-10-25

