<!-- @import /home/lab/.claude/CLAUDE.md -->
<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file is an overlay. It imports two layers and copies neither:

- **User layer** - `/home/lab/.claude/CLAUDE.md`, applies to every project on this machine
- **Workspace layer** - `/home/lab/workspace/.claude/CLAUDE.md`, applies to everything under `~/workspace`

Both layers apply in full. Rules below extend or strengthen them; where they overlap, the stricter
wording wins. The workspace `/home/lab/workspace/.claude/` directory and the skills the two layers
name carry every standard not restated here. On 2026-10-23 the workspace layer file is absent on
disk (an unstaged deletion in the workspace repository); the import stands and nothing restores it.

`.claude/CLAUDE.md` is a symlink to this file; `.claude/skills` and `.claude/commands` link to
`.agents/skills` and `.agents/workflows`.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Project Context

JupyterLab 4 extension, `kind: frontend-and-server`, scaffolded from the official copier template
`jupyterlab/extension-template` v4.6.5. It turns the "Running Terminals and Kernels" panel into a
panel driven by workspaces: each workspace is one section of an accordion with a colour strip, an
optional purpose, its age and counts in the header, then its tabs, terminals and kernels.

- **The brief is the specification** - `docs/brief.md`: the required behaviour in the Star
  Colonel's order and the open questions the design answers
- **Design before code** - the proposal lives in `docs/design/`; acceptance criteria and
  implementation wait for the Star Colonel's approval of it
- **State** - routes `terminals` (process names), `meta`/`meta/<id>` (records) and `presence`
  (open windows); frontend `index.ts`, `api.ts`, `request.ts`, `icons.ts`, `model/`, `panel/`
- **Sibling that must keep working** - `../jupyterlab_kernel_terminal_workspace_culler_extension`
  culls idle kernels, terminals and workspaces in the same lab; read its server code before any
  change that reads or writes workspaces, terminals or kernels
- **Colour palettes** - `../jupyterlab_colourful_tab_extension`, the tab colours the workspace
  colours resemble
- npm package `jupyterlab_workspace_manager_extension`, PyPI package
  `jupyterlab-workspace-manager-extension`; server routes under
  `jupyterlab-workspace-manager-extension/`; version read from `package.json` by
  `hatch-nodejs-version`

## Build Lifecycle - Makefile Only

The Makefile owns the whole build lifecycle. Never run `pip`, `jlpm`, `yarn`, `npm`,
`python -m build`, `twine`, or any build, publish or clean command directly - those bypass the
project-local `.nodeenv/` toolchain the Makefile pins.

| Target          | Effect                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| `make install`  | build and install the extension; raises the patch version on every run          |
| `make publish`  | release to npm and PyPI, committing and pushing first; needs approval each time |
| `make clean`    | remove build artefacts                                                          |
| `make mrproper` | remove all build and virtual-environment artefacts                              |
| `make build`    | resolve `yarn.lock`, format, build the sdist and the wheel; the version stays   |
| `make test`     | Jest, pytest and the endpoint authentication gate                               |

- **Makefile version check** - line 1 of the local Makefile declares its version. Compare it with
  `/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile` at the start of any
  build work and copy the canonical file over the local one as soon as it is newer. At project
  creation both are 1.46 and identical
- **Every `make install` is a version change** and needs the Star Colonel's approval
- **Dependency ranges** follow the jupyterlab-extension skill: floor at the installed and tested
  `major.minor`, ceiling at the next major, floors read from the installed packages and never from
  the registries; `typescript` keeps its tilde, `resolutions` stay exact
- **The Galata suite has no Makefile target** - it is the one lifecycle step outside the Makefile:
  `jlpm install` and `jlpm playwright install chromium` in `ui-tests/`, then
  `JUPYTER_TEST_PORT=<free port> jlpm playwright test > <log> 2>&1`. Port 8888 belongs to the
  workstation's own lab; never pipe the run through `| tee`, which reports tee's exit status

## Git Rules (Project-Specific)

- The repository was initialised with `git init -b main` and an initial import of every artefact
- **Always commit `package.json`, `package-lock.json` and `yarn.lock` together** - and
  `ui-tests/package.json` with `ui-tests/yarn.lock`. Makefile 1.46 writes only `yarn.lock`; the
  project has no `package-lock.json` until something creates one
- This project is its own repository; never commit its files into the workspace repository

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the canonical tool for this file: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Direct edits to `JOURNAL.md` are a last resort - prefer the plugin so modus secundis format, continuous numbering and append-only order are enforced automatically

## Acceptance Criteria and Defects

- Criteria live in `docs/acc-crit*.md` and defects in `docs/defects*.md`, written **only** through
  the project-management plugin (the `pm-tools` CLI), never by a hand edit of either file:
  `/project-management:acc-crit` adds, closes, rejects or relates a criterion,
  `/project-management:defect` files, triages, logs or closes a defect, `/project-management:report`
  gives status and coverage
- **Every feature gets its acceptance criteria before the code**, and every criterion names the
  test that proves it
- **Functional tests under `ui-tests/` are part of every feature**, not an afterthought, and run
  green before a release
- Close a criterion only on evidence - the test that ran and what it showed
- Author handle on every pm-tools write: `@kj` (Konrad Jelen)

## Tests

Three tiers, to the testing strategy of the jupyterlab-extension skill:

- **pytest** under `jupyterlab_workspace_manager_extension/tests/` for server code
- **Jest** under `src/__tests__/` for frontend logic
- **Playwright/Galata** under `ui-tests/` for everything visible in the browser, written to that
  skill's `references/galata-testing.md`: the port through one variable (`JUPYTER_TEST_PORT`), a
  private settings folder for the test server, no snapshot-only assertions, a suite that can fail

## Command-Line Tools and Their Agent Skill

A command-line tool the extension ships (an entry point under `[project.scripts]` in
`pyproject.toml`) gets the `--help` and the agent skill that the jupyterlab-extension skill's
section "Agent Skill for a Shipped CLI" prescribes.

- **Name** - the skill is named after the extension: `jupyterlab-workspace-manager-extension`
- **Location** - `.agents/skills/jupyterlab-workspace-manager-extension/SKILL.md` at the repository
  root, and in the wheel through the `shared-data` table of `pyproject.toml`
- **Same commit** - the skill and the `--help` text change in the commit that changes the CLI
- **Never inside the Python package** - the CI link check imports the package for every link in a
  Markdown file inside it, and fails without `jupyter_server`
- **Reference implementation** -
  `/home/lab/workspace/private/jupyterlab/jupyterlab_notifications_extension`

## Scope Control - graphify

- Run `/graphify` once the first source is in place to build `tmp/graphify-out/`
- Run `graphify affected` before editing existing code to learn its callers and dependents; that
  affected set is the change budget, and an edit outside it needs the Star Colonel's word
- Run `graphify update` after every edit
- The graph lives in `tmp/graphify-out/`, not in graphify's default `graphify-out/`: prefix every
  graphify command with `GRAPHIFY_OUT=tmp/graphify-out`, for example
  `GRAPHIFY_OUT=tmp/graphify-out graphify update .`
- `tmp/` is gitignored, so the graph never ships

## Required Skills

| Skill                                   | Use                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `jupyterlab-extension`                  | extension development guidelines, testing strategy, CI/CD, caveats                    |
| `my-browser`                            | browser automation for screenshots and UI verification against the running JupyterLab |
| `project-management:project-management` | acceptance criteria and defects through the `pm-tools` CLI                            |
| `graphify`                              | the codebase graph and the impact analysis that bounds every change                   |
| `journal:journal`                       | the project journal through the `journal-tools` CLI                                   |

## Strengthened Rules

- **Every server endpoint sits behind Jupyter's authentication** - `@tornado.web.authenticated` on
  every HTTP verb; `.github/scripts/check_auth.py` is the gate and `make test` runs it
- **Styling through JupyterLab CSS variables only** - no literal colours; follow the Extension
  Design System of the jupyterlab-extension skill
