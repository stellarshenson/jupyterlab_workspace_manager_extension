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
- [x] `DEF-GALATA-6-LAUNCHER-RACE` **Close all test reads the main area too early** - MINOR; sections.spec.ts ACC-ACCORD-25-CLOSE-CURRENT read the main area once after Close all and found 0 widgets where the new Launcher was expected
  - evidence: the test polls until one launcher- widget is in the main area, same assertion (patch-r1-5.diff); Galata 92/92 at 6 and default workers (tmp/workflows/review-impl/applied-r1-verify-2.json)
  - repro: full Galata suite at 6 workers, --retries=0; sections.spec.ts:558 failed once
  - test-tags: FUNCTIONAL
  - root-cause: 2026-10-24T14:31:03Z @kj JupyterLab's shell emits layoutModified through a 0 ms Debouncer and the Launcher is added on that signal, so the main area is empty for a moment
  - log: 2026-10-24T14:31:03Z @kj added
  - log: 2026-10-24T14:31:03Z @kj closed
  - log: 2026-10-24T14:31:07Z @kj amended text "sections.spec.ts ACC-ACCORD-25 read the main area once after Close all and found 0 widgets where the new Launcher was expected" -> "sections.spec.ts ACC-ACCORD-25-CLOSE-CURRENT read the main area once after Close all and found 0 widgets where the new Launcher was expected"; reason: full id of the criterion

