# Review and verification

Project: `./`.
Review date: 2026-10-05.

The user requested a full review, useful improvements, and a commit in a local Git repo.
The project started in an empty task folder. There was no existing repo, starting commit, or worktree.
The review used one agent. Source, tests, scripts, package files, and docs were read.
The saved starting inventory and source copy are under `evidence/review-baseline/`.
The final source changes were compared with that copy. Generated files stay outside Git.

## Review results

Standards: passed. The changes use the existing code structure and approved Electron dependency.
No dependencies were added. Codex settings, credentials, and session records were not changed.
The renderer keeps its sandbox, isolated preload, restricted content policy, and main-frame IPC checks.
External chat links use the fixed Codex URL scheme. The session reader opens databases in read-only mode.
The usage reader owns its child process, clears failed readings, and delegates sign-in to Codex.

Spec: the requested Windows behavior passed. The panel is narrow, fixed to the right edge, and above other windows.
It shows plain state lights, a divider, and two compact usage gauges. Dragging moves it before release.
The expanded panel shows names, pins, usage percentages, and a hide control.
The Codex adapter remains separate so other providers can be added later.
Mac support is implemented, but its runtime behavior still needs evidence from a Mac.
The review was not independent of implementation.

## Confirmed defects fixed

| Defect | Evidence before the fix | Result after the fix |
| --- | --- | --- |
| A service line containing `null` stopped the usage reader with an uncaught error. | The new live-process test failed with a null-property exception. | Non-object and unrelated lines are ignored. The usage test passes. |
| Two reads during startup could send a request before initialization finished. | A delayed local service caused connection errors for simultaneous reads. | Reads share the initialization promise. Both return account windows. |
| An unsupported turn-history schema hid all desktop chats. | A changed table name in the isolated database produced zero sessions. | The adapter uses readable session records and reports the history limit. |
| The documented desktop test command failed on the minimum supported Node version. | Node 22.12 reported that `node:sqlite` was unavailable. | The npm command now includes `--experimental-sqlite`. It passes. |
| A long compact list moved the lights off center. | With 24 chats, the light center differed from the panel center by about 5 pixels. | The compact scrollbar does not reserve space. Lights and gauges stay centered. |
| A background update could reset a long list's scroll position. | The native check failed when an off-screen chat retained keyboard focus. | Focus is restored without scrolling. The native check passes. |

The review also added guards for non-object session records and missing title or working-folder fields.
Stopped and silent usage services clear readings. A later read reconnects.
The README now uses `npm ci` to install the exact locked dependencies.
Git text files use LF line endings on both systems.

Changed source: `src/adapters/codex-usage.cjs`, `src/adapters/codex-desktop.cjs`, `src/ui/renderer.js`, and `src/ui/style.css`.
Changed checks: `test/monitor.test.cjs`, `test/usage-server.cjs`, new `test/usage.test.cjs`, and `scripts/desktop-smoke.cjs`.
Changed setup and docs: `package.json`, `.gitattributes`, `README.md`, and this report.
The initial local commit includes the full project source and lockfile.

## Final checks on Windows

| Check | Exact command | Result |
| --- | --- | --- |
| JavaScript syntax | `npm run check` | Passed: 18 files, exit 0. |
| Session state, persistence, and live service failure paths | `npm test` | Passed: 10 tests, 0 failures, exit 0. |
| Native panel | `npm run test:desktop` | Passed: 42 checks, exit 0. |
| Known dependency vulnerabilities | `npm audit --json` | Passed: 0 reported vulnerabilities, exit 0. This is the audit result at review time. |
| Portable build | `npm run pack` | Passed, exit 0. |
| Packaged app and live Codex readers | `node scripts/package-test.cjs dist/session-lights-win32-x64-1791151313281` | Passed: packaged source matches; app and tray start; 2 local sessions detected; both account limit windows read; panel above other windows; exit 0. |

Native evidence: `evidence/desktop-oyWaPv/report.json` and its screenshots.
Visual inspection covered the compact panel, the 24-chat compact list, and the expanded panel.
The final native run reported no renderer errors. SQLite emits its expected experimental-feature warning on Node 22.12.
The native checks use isolated SQLite files, logs, and a local JSON-RPC usage service.
The package check reads actual local Codex records and account limits without sending a model request.
The reviewed portable app is running. Its startup output is in `evidence/app-review-update.log`.

## Remaining limits

- macOS window behavior, dragging, default data paths, runtime discovery, packaging, and local signing remain unverified. A Mac is required.
- A real Codex chat link was not opened during the tests. The documented URL format was checked.
- Private Codex files can change after an update. This panel shows the last recorded state.
- Yellow depends on desktop notification logs. Focused chats or disabled notifications can cause missed prompts.
- A turn with no activity for 15 minutes becomes unknown, even if it is still working.
- Local record tails are limited to 512 KiB. Older pending notifications can be missed.
- Remote chats and providers other than Codex desktop are not implemented.
- Live usage needs an installed native Codex runtime and a working ChatGPT sign-in.

## Check on macOS

Copy or clone the source without generated files. Run `npm ci`, `npm run check`, `npm test`, and `npm run test:desktop`.
Run `npm start` with local Codex chats. Check working, idle, approval, and question states.
Run `node scripts/usage-check.cjs`. Check both account windows and reset times.
Check the right screen edge, dragging, Spaces, full-screen apps, tray menu, and chat links.
Run `npm run pack`. Open the app after moving its output to another folder.
Update the adapter if the Codex log path or record format differs.

## Expand and collapse animation — 2026-10-05

The panel now opens with a 280 ms slide and soft easing. Names fade in after the initial movement.
On collapse, names fade out for 70 ms before the panel slides back. The right screen edge stays fixed.
The lights move with the list. The list height follows the window so lights do not get clipped.
A second click can reverse the motion. A session refresh keeps the moving layout stable and shows fresh data at completion.
The system's reduced-motion setting skips native and content animation. Dragging still works after either transition.

Work started from local commit `2ebc444` in the isolated worktree `../session-lights-animation`.
The original checkout was clean. The tested changes were then copied into `./`.
Changed files: `src/main.cjs`, `src/ui/renderer.js`, `src/ui/style.css`, `scripts/desktop-smoke.cjs`, `README.md`, and this report.
No dependency or provider adapter contract changed. This update is kept in the local Git repo.

Final checks in the worktree: `npm run check` passed for 18 files; `npm test` passed all 10 tests;
`npm run test:desktop` passed 48 checks. All returned exit 0. `git diff --check` passed.
Native evidence: `../session-lights-animation/evidence/desktop-rw7E8e/`.
It includes `expanding.png`, `collapsing.png`, `animation-frames.json`, and the full panel report.
The check samples intermediate native widths, screen-edge alignment, topmost state, a source update during motion,
quick reversal, and reduced motion. The media preference is emulated only in the isolated test window.
Frame inspection found and corrected temporary scrollbar and light-clipping issues. The final native run had no renderer errors.
The macOS animation and native resizing still need a Mac. Earlier platform and data-source limits still apply.

Delivery: `npm run pack` passed. `node scripts/package-test.cjs dist/session-lights-win32-x64-1791152579687`
passed with matching source, 2 real local chats, both live account windows, and the panel above other windows.
The animated app was started from that build. Its output is in `evidence/app-animation-update.log`.
The source in the project folder matched the tested worktree. Git checks passed in the normal workspace shell;
the elevated build shell could not run Git checks because its user differs from the repo owner.

## Tooltips, search, and adapter usage — 2026-10-05

Work started from `94b3aae` in the isolated worktree `../session-lights-details`.
The task has normal risk. It changes native tooltip windows, expanded-list filtering, and the adapter contract.
The finish condition is a readable tooltip beside the bar, live reset countdowns, one search row in the expanded panel,
and provider-owned usage and chat opening. The compact bar must keep all chats visible while filters are active.

Changed areas: core monitor; adapter registration and Codex adapter; main process and preloads; panel markup, renderer,
styles, and tooltip files; native desktop and package checks; a file-driven test adapter; README and next-step notes.
No dependencies were added. The source changes remain uncommitted.

### Passed checks

- `node scripts/check.cjs`: 24 files passed, exit 0.
- `node --experimental-sqlite --test test/monitor.test.cjs test/usage.test.cjs`: 10 passed, 0 failed, exit 0.
- `node --experimental-sqlite scripts/desktop-test.cjs`: 67 native desktop checks passed, exit 0.
- `git diff --check`: passed.

The native check uses isolated SQLite records, logs, a JSON-RPC service, and a second file-driven provider.
It verifies tooltip content, placement beside the compact window, no focus change, dismissal during dragging and after a DOM update,
search, combined state filters, no matches, input after refresh, compact visibility during filtering, and Escape behavior.
It also checks different usage names, provider scope, missing reset time, adapter chat opening, failed and malformed usage,
recovery, and the earlier animation, usage, pin, scroll, and position checks.

Evidence: `../session-lights-details/evidence/desktop-BD0ZHg/report.json`.
Screenshots include `session-tooltip.png`, `usage-tooltip.png`, `search.png`, `no-matches.png`, and `multiple-providers.png`.
Visual review checked those cards and the search row. The final native run had no renderer errors.
The first visual run found a CSS rule that stacked the state filter below search. A more specific layout rule fixed it.
Native tests need the normal Windows app access context. The restricted test shell could not read the Electron runtime with its sandbox token.
Node checks used the installed Node executable because the npm wrapper resolved through a restricted user path.

### Review

The self-review covered all tracked and new task files against `94b3aae`.
Standards: existing CommonJS and DOM patterns remain in use; no dependencies, credentials, or environment files changed.
Spec: usage labels, scope, runtime discovery, requests, and links belong to adapters. Main and UI code use generic usage data.
The review found a failure path where malformed usage from one provider could stop usage polling for all providers.
Per-provider validation now clears that reading. The native test confirms that Codex stays available and the other provider recovers.
No remaining blocking findings were found. The review was done by one agent.

### Limits

macOS tooltip placement, focus behavior, Spaces, and window sizing still need a real Mac.
The second provider is a local test source. Claude and OpenCode adapters are not implemented.
A real Codex chat was not opened in tests. Search and state filters are temporary and clear after an app restart.
Earlier local-record and authentication limits still apply.

### Delivery

The tested task files were copied into `./` after its clean state at `94b3aae` was checked.
`node scripts/pack.cjs` passed. The portable app is `dist/session-lights-win32-x64-1791154499772`.
`node scripts/package-test.cjs dist/session-lights-win32-x64-1791154499772` passed, exit 0.
Its packaged source matches the project. It read 2 real local chats and both live usage windows. The native panel and tray started.
The panel stayed above other windows. The old app process from this task was stopped, and the updated build was started.
Startup output is in `evidence/app-details-update.log`.

## Project labels and sorting — 2026-10-05

This update reused `../session-lights-details`. Its files matched the project before editing.
The starting state includes the earlier uncommitted tooltip and adapter changes on top of `94b3aae`.
A file-hash baseline is saved under `evidence/project-sort-baseline.json` to protect that work during delivery.

This is a normal-risk UI and adapter-data update. The finish condition is a project label in each row,
a saved sort choice, correct project grouping across providers, and a clear compact bar.
The existing footer holds the sort menu. The search row and compact width stay the same.

Changed files for this update: `src/core.cjs`, `src/preferences.cjs`, `src/main.cjs`,
`src/ui/index.html`, `src/ui/renderer.js`, `src/ui/style.css`, `src/ui/tooltip.js`,
`scripts/desktop-smoke.cjs`, `scripts/desktop-test.cjs`, `README.md`, and this report.

### Passed checks

- `node scripts/check.cjs`: 24 files passed, exit 0.
- `node --experimental-sqlite --test test/monitor.test.cjs test/usage.test.cjs`: 10 passed, 0 failed, exit 0.
- `node --experimental-sqlite scripts/desktop-test.cjs`: 85 native desktop checks passed, exit 0.
- `git diff --check`: passed.

The new native checks show projects in rows and verify state, activity, and title order through the sort control.
Activity and title fixtures use orders that differ from state order. The saved sort choice survives a renderer reload
and a separate preferences load. Invalid older settings fall back to state order. Pins and the saved position remain intact.

Project checks use the Codex fixture and a second file-driven provider. They verify shared paths across providers,
Windows path spelling differences, equal folder names at different paths, aliases, missing project data, shared IDs,
and equal labels with different IDs. Project IDs can supply a missing label. Group headings show the path or ID.
Search removes empty group headings. Compact mode keeps all chats and hides headings and controls.
The earlier usage, tooltip, animation, dragging, long-list, pin, and failure checks also pass.

Evidence: `../session-lights-details/evidence/desktop-3pvlBD/report.json`.
Visual review checked `expanded.png`, `project-groups.png`, `project-tooltip.png`, and `compact-project-order.png`.
The final run had no renderer errors. The fixtures do not change real Codex records or open a real Codex chat.

### Review and limits

The self-review compared each changed file with its starting copy in `./`.
Standards: existing CommonJS, DOM, preferences, and native-test patterns remain in use. No dependencies or secrets changed.
Spec: adapters supply names, optional paths, optional shared IDs, and activity times. The shared monitor groups and sorts them.
Group ordering uses one label per identity so different adapter labels cannot split a project into several sections.
No remaining blocking findings were found. Source changes remain uncommitted.

Path matching does not resolve symlinks. Different worktree paths stay separate unless adapters supply the same project ID.
Only display-name data stays within its provider. macOS native behavior still needs a real Mac.

### Delivery

The 11 files for this update were copied into the project after checking the starting hashes.
`node scripts/pack.cjs` passed. `node scripts/package-test.cjs dist/session-lights-win32-x64-1791155416992`
passed with matching source, 2 real local chats, both live account windows, and a panel above other windows.
The updated app was started from that build. Its startup output is in `evidence/app-project-sort.log`.

## Top sorting buttons — 2026-10-05

This small UI update reused `../session-lights-details`.
Its starting files matched `./`, including the earlier uncommitted changes.
The file-hash baseline is `evidence/top-sort-baseline.json`.
The finish condition is no search or state filter, four clear sorting choices above the list,
saved sorting, and no extra controls in compact mode.

Changed files: `src/ui/index.html`, `src/ui/style.css`, `src/ui/renderer.js`, `src/main.cjs`,
`scripts/desktop-smoke.cjs`, `README.md`, and this report.
The top row uses styled buttons for State, Activity, Project, and Title. No dropdown remains.
The renderer and native window use the same new height allowance for that row.
Escape now collapses the panel on the first press. Search code and filter documentation were removed.

### Checks and review

- `node scripts/check.cjs`: 24 files passed, exit 0.
- `node --experimental-sqlite --test test/monitor.test.cjs test/usage.test.cjs`: 10 passed, 0 failed, exit 0.
- `node --experimental-sqlite scripts/desktop-test.cjs`: 83 native desktop checks passed, exit 0.
- `git diff --check`: passed.

The native checks cover sorting, saved choices, keyboard use, compact visibility, project groups,
pins, long lists, usage, tooltips, dragging, and animation. No renderer errors occurred.
The first test run omitted Electron's character event for Enter. The focused button did not activate.
Adding that event to the native input sequence fixed the test. Application code needed no keyboard change.
Evidence: `../session-lights-details/evidence/desktop-Sa6YVK/report.json`.
Visual review checked `expanded.png`, `project-groups.png`, and `compact-project-order.png`.

The review compared all seven changed files with their starting copies in the project.
The buttons use native button semantics, accessible labels, a visible keyboard focus outline,
and one selected state. Existing sort settings and adapter contracts stay in use.
No dependencies, secrets, or public APIs changed. No blocking findings remain.
macOS window behavior still needs a real Mac. Source changes remain uncommitted.

### Delivery of top sorting buttons

The seven changed files were copied into the project after checking all baseline hashes.
`node scripts/pack.cjs` passed, exit 0.
`node scripts/package-test.cjs dist/session-lights-win32-x64-1791156012039` passed, exit 0.
Packaged source matches the project. The app read 2 real local chats and both live usage windows.
Its native panel and tray started. The panel stayed above other windows.
The tracked previous app was stopped after checking its exact executable path.
The new build was started. Startup output is in `evidence/app-top-sort.log`.

## Minimal header, sorting, and workspace labels — 2026-10-05

This update continues in `../session-lights-details`.
It removes the visible panel title and keeps Activity and Project as the only sort choices.
Old saved sort choices use Activity. No workspace labels use the same wording across providers.
Codex uses its saved Git metadata to tell a named repository from a session with no project data.
The label has no account or computer name. Grouping still uses the full local path; an adapter can use a shared project ID to group copies across different paths.

The earlier Git-metadata rule marked both local folders as `No workspace`.
The screenshot showed that `i-x20-2` is a generated folder below a dated Codex folder,
while `C:\workspaces` is a real folder whose name should appear as `Workspaces`.
The adapter now detects the date-folder pattern. Other paths use their final folder name.
This rule does not depend on an account name or computer name.

Changed files: `src/ui/index.html`, `src/ui/style.css`, `src/ui/renderer.js`, `src/preferences.cjs`,
`src/core.cjs`, `src/adapters/codex-desktop.cjs`, `scripts/desktop-smoke.cjs`,
`README.md`, `NEXT-STEPS.md`, and this report.
Existing test expectations and fixtures now describe the two sort choices and missing-workspace label.
`node scripts/check.cjs` passed: 24 files, exit 0. `git diff --check` passed.
Unit and desktop tests were not run for this update.
The project was built and the updated app was started. It is running from
`dist/session-lights-win32-x64-1791157012704`. Process 27584 responded and reported 2 local chats.
`node scripts/pack.cjs` passed, exit 0.
Startup output is in `evidence/app-minimal-header.log`. macOS still needs a native check.
Source changes remain uncommitted.

## Group labels and top controls — 2026-10-05

This update corrects that workspace label rule. The old Git-metadata check marked both folders `No workspace`.
The current Codex records use two different paths: a dated Codex scratch folder ending in `i-x20-2`,
and the folder `C:\workspaces`. The adapter now labels the first `No workspace` and uses the final folder
name for the second. The rule checks the dated Codex folder pattern, so it does not depend on usernames,
computer names, or Git fields. The full local paths still separate workspaces internally.

The project headings now show only the project name. Activity and Project now sit beside the close button.
The window height allowance matches the shorter header.

The source check passed: 24 files, exit 0. `git diff --check` passed.
A read of the two local Codex sessions returned `No workspace` and `workspaces`.
Unit and desktop tests were not run for this update.
`node scripts/pack.cjs` passed, exit 0. The app is running from
`dist/session-lights-win32-x64-1791157701855`, process 27836.
It reports 2 local sessions and stays above other windows.

## Project names and status cues — 2026-10-05

Codex session rows now use the saved project name when the session has a project ID or its working folder matches a saved Codex project root. The closest matching root wins. If no project matches, the row uses the folder name or `No workspace`. Empty Codex projects do not appear because the panel lists sessions.

The pin control uses an outline bookmark and fills it yellow when pinned. The bookmark stays hidden in compact mode, so it does not shift the lights away from the usage gauges. Low usage percentages now use the same red or yellow as their gauges.

Checks passed on Windows:

- `node scripts/check.cjs`: 24 source files passed syntax checks.
- `node --experimental-sqlite --test test/*.test.cjs`: 12 tests passed.
- `node --experimental-sqlite scripts/desktop-test.cjs`: 84 desktop checks passed.
- `git diff --check`: passed.

The desktop test uses task-owned SQLite and usage fixtures. It does not change Codex records. The `npm` wrapper could not start Node in the sandbox because of a Windows path permission error, so the equivalent Node commands ran directly. macOS still needs a native check.
