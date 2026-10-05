# TypeScript migration verification

Verified on Windows on 5 October 2026.
All 35 app, script, test, and declaration files use TypeScript.
The compiler uses strict checks without skipped dependency checks or suppressed implementation errors.

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Compile the app, tools, tests, and browser code | Passed | `npm run check` and the clean build in `npm test` |
| Enforce the provider and IPC contracts | Passed | Negative compiler fixtures in `test/contracts.type-test.ts` |
| Separate activity and reset time units | Passed | Compiler fixture rejects milliseconds assigned to seconds |
| Preserve session reads, settings, and usage recovery | Passed | `npm test`: 18 tests passed |
| Support another provider through the shared contract | Passed | Public monitor extension test and native second-provider checks |
| Keep Node code out of the browser and local requires out of preloads | Passed | `node build/scripts/audit-migration.js` |
| Preserve native panel behavior | Passed | `node --experimental-sqlite build/scripts/desktop-test.js`: 84 checks passed |
| Package compiled code and start without build dependencies | Passed | `npm run pack` and the package launch check |
| Read the live Codex account through the portable app | Passed | One local session and both usage windows read. The panel stayed above other windows. |

The final native report and screenshots are in `evidence/desktop-ftwvkA/`.
The final portable folder is `dist/session-lights-win32-x64-1791189930986/`.
The package check was `node build/scripts/package-test.js dist/session-lights-win32-x64-1791189930986`.
Its output is in `evidence/package-launch.log`.

## Behavior correction

The original and migrated app both failed the initial compact-width check on this Windows runtime.
The native window measured 32 pixels after a request for 30 pixels.
The panel now uses the measured native minimum. Its visible bar remains 26 pixels wide.
The native checks confirmed alignment at the screen edge in compact mode, expanded mode, and during animation.
The original failure is recorded under `.evidence/migration-baseline/evidence/`.

Nullable SQLite labels and paths retain the previous fallback behavior.
An invalid usage reset time fails the provider's usage read instead of converting the limit to one without a reset.
Usage failures remain separate from session reads and other providers.

## Demonstration

The real compiled Electron app is recorded in `.evidence/demos/typescript-phone-20261005/typescript-phone.mp4`.
The 59-second portrait video shows compact mode, expansion, project grouping, pinning, reload persistence, collapse, and verified test results.
Mouse and keyboard actions use Windows Computer Use. The test-results card uses the saved test logs.
It uses the preview adapter and sample limits in a separate profile.
The desktop suite uses isolated SQLite files and a local JSON-RPC fixture.
The separate portable launch check uses the live Codex account.

## Limits

Native macOS behavior has not been checked here.
The new CI matrix covers Windows, macOS, and Linux on Node 22.12 and Node 24, but has not run here.
Local Codex formats remain unofficial and can change after a Codex update.
Electron printed GPU shutdown diagnostics after the package check passed. The app exited with code 0.

## Final review

The review found no blocking defect in the migration or provider extension contract.
Strict checks, a clean build, all 18 tests, the migration audit, all 84 native checks, and a new portable launch passed again before commit.
The package dependency pins match the lockfile.
This workspace has Node.js but no npm command, so the final checks used the compiler, build, and test commands from the package scripts directly.
The Computer Use demonstration also confirmed project grouping, pin persistence after reload, and Escape collapse.
