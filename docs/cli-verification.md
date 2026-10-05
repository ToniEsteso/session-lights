# Codex CLI adapter verification

The desktop and CLI adapters now show separate sessions and Settings switches. The desktop adapter keeps its `codex` ID. CLI sessions use `codex-cli`. Both adapters share record parsing. Account limits have one reader. CLI sessions open with `codex resume` in their saved workspace.

The change was developed and verified in `C:/workspaces/session-lights/.worktrees/codex-cli-20261005`.
The implementation is merged into `main` from base `66540a4b06fb9c9cd1357798120daff8e2d2af08`. No push was made. No dependencies were added. The isolated checkout uses the existing lockfile.

## Changed files

| Files | Change |
| --- | --- |
| `src/adapters/codex-cli.ts` | CLI session reads, workspace checks, and terminal resume |
| `src/adapters/codex-records.ts` | Shared SQLite and JSONL reads, input requests matched by call ID, and failed completion records |
| `src/adapters/codex-runtime.ts` | Shared binary discovery, with separate desktop and CLI choices |
| `src/adapters/codex-desktop.ts`, `src/adapters/codex-usage.ts` | Use the shared readers and keep existing desktop keys and usage behavior |
| `src/adapters/index.ts` | Register both adapters |
| `test/cli.test.ts` | Four tests for classification, saved switches, request resolution, failure states, missing data, usage ownership, and unsafe opening input |
| `scripts/cli-check.ts` | Repeatable installed-runtime, live-record, native-panel, and resume checks |
| `scripts/desktop-smoke.ts`, `scripts/desktop-test.ts` | CLI panel checks, three adapter switches in test mode, restart checks, and stable-panel hover setup |
| `README.md`, `docs/architecture.md` | Source behavior, CLI resume, commands, and limits |
| `docs/cli-verification.md` | This record |

## Check results

| Command or check | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm test` | Passed. 33 tests, 0 failures, 0 skipped |
| `npm run test:desktop` | Passed. 128 native checks and 6 restart checks |
| `node build/scripts/audit-migration.js` | Passed. 53 TypeScript files. Browser bundles have no Node imports. Preloads require only Electron |
| `node build/scripts/pack.js` | Passed. Windows installer and unpacked app built |
| `npm run test:package -- dist/win-unpacked` | Passed. Packaged source bytes, version, update feed, help, native launch, and tray |
| `node build/scripts/usage-check.js` | Passed. Two live account windows returned |
| Installed CLI record checks | Passed with Codex CLI 0.149.1 |
| Live CLI panel checks | Passed for waiting, idle, and failed states. Each run passed four checks |
| Public monitor opening action | Passed. Started one native CLI process with the selected resume ID |
| Installed CLI resume | Passed. The same session returned `SESSION_LIGHTS_RESUME_CHECK` |
| `git diff --check` | Passed |

The live success checks used `gpt-5.6-sol`, from the installed runtime's local catalog. The CLI rejected the configured model on the first attempt. Those failed turns also confirmed the red state. No Codex configuration or credential files were edited.

The native panel check reads the actual Codex database and session files through a task-owned junction. Its profile is separate. Its account gauges use fixture data. The separate usage check reads live account limits.

The full native run initially hovered a project during the sort animation. The renderer ignores hover during that animation. The test now waits for the public panel payload to have no motion. The full rerun passed.

A directory-only package lacked `app-update.yml`. The complete Windows package generated that file and passed the package check.

## Evidence

- [Native checks and restart report](../evidence/desktop-IwNlCd/report.json)
- [Live waiting light](../evidence/cli-live-EUmRa3/live-cli.png)
- [Live waiting report](../evidence/cli-live-EUmRa3/live-cli-report.json)
- [Live idle light](../evidence/cli-live-NqKuoe/live-cli.png)
- [Live failure report](../evidence/cli-live-edHh05/live-cli-report.json)
- [Resume process](../evidence/cli-live/resume-process.json)
- [Live account windows](../evidence/cli-live/account-usage.json)
- [Final tests](../evidence/cli-tests-final.log)
- [Package launch](../evidence/cli-package-launch.log)

## Limits

The CLI does not record every shell or file approval prompt. The adapter can detect recorded input and permission requests. It cannot confirm an unrecorded approval prompt.

The reader reports the last recorded state. It reads the last 512 KiB of each file. Older pending requests can fall outside that range. A running turn with no activity for 15 minutes becomes unknown.

Account gauges belong to the Codex desktop adapter. Hiding that adapter also hides the gauges. CLI session monitoring continues.

Windows behavior is verified. The macOS Terminal launcher and Linux terminal launcher need tests on those systems. Remote and cloud sessions are outside this change.

The code review covered all changed source, test, script, and documentation files. Standards and scope checks passed. This was a single-agent review.
