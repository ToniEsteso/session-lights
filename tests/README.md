# Main feature tests

Run `pnpm run test:e2e` (or `pnpm test`). The command builds the app, then uses
Playwright to start Electron. No separate browser install is needed. On a Linux
host without a display, use `xvfb-run -a pnpm run test:e2e`.

There are no unit tests. Keep this suite small. Add a scenario only to protect a
main use case or a reported defect. Follow the feature rules in `AGENTS.md`.

## Scenarios

The provider scenarios require exactly two switches: Codex and Claude. Hiding
Codex must hide desktop sessions, CLI sessions, and usage together, while Claude
stays visible. Each Codex row must still show its source.
Old preference files check CLI pins and hidden-session migration, partial and
fully hidden adapter choices, restore, and persistence after restart. A real
filesystem failure during a preference save must retain the previous saved
choice. Removing the failure must allow a new choice to persist.

Claude Code checks start with no installation and no transcript folder. New local
records must appear without a restart. The adapter switch must survive a restart.
Clicking a saved session must show a clear missing-installation error.
A second scenario feeds a question, unrelated output, an answer, a request error,
retry, completion, interruption, damaged JSON, file removal, and recovery. The
visible state must follow each event. Old activity must stay Unknown after a title
update, and sidechain sessions must stay out of the panel. These checks protect
provider behavior through the running app; internal code can change freely.
The Claude fixtures are synthetic. They cannot verify real CLI startup or the
record format of an installed Claude Code version.

| Starting state | User action or external input | Required result / wrong result detected |
| --- | --- | --- |
| Local desktop and CLI chats exist in SQLite with session records. The usage runtime is absent. | Write a desktop question notification, user reply, failed turn, and completed turn. Write a CLI question and its answer. Remove and restore a session record. | The panel changes between Working, Needs you, Failed, Idle, and Unknown. A missing record does not hide healthy chats. A restored record recovers. Unavailable account limits do not stop sessions. |
| Three chats have different activity times and projects. | Pin a chat, select Project, hide the pinned chat, restart, restore it, unpin it, select Activity, then hide and restore two chats. Restart again. | Pins precede other chats. Project and activity order follow the selected mode. Hidden chats stay hidden after restart. Restore keeps the pin; Restore all stays saved. |
| Both sources are visible. A desktop chat is pinned. | Select Dark, hide each source, restart, use Open Settings from the empty panel, restore the sources, select Light, and restart. | The selected theme applies and survives restart. Source switches remove their chats and usage, stay saved, and permit recovery from the empty panel. Source hiding keeps the pin. |
| A desktop chat and a CLI chat are visible. | Click a desktop title. Make the OS link handoff fail, then recover and retry. Click the CLI chat with an absent workspace. Change the sort mode. | The correct desktop URL reaches the external boundary. Launch failures show a useful message. A later action succeeds and clears the error. |

All assertions use displayed text, accessible controls, native theme media, or
the outgoing URL at the OS boundary. They do not inspect source text or private
application state. The code structure can change while these results stay valid.

## Isolation and limits

The fixture creates real SQLite and JSONL files under a unique `.tmp/e2e-*`
folder. It copies the current build into that folder so Electron uses a separate
app profile. Restarts reuse the same profile. Tests use the real renderer,
preload, IPC, monitor, adapters, and preference files. They use bounded waits for
visible results. The fixture deletes only its own temporary folder.
Every launch resets hover outside the panel. Reduced motion removes native
resize timing from these feature checks. These checks do not prove animation
quality. Theme checks keep Electron's native theme instead of forcing Light.

`CODEX_HOME`, home paths, app data, and logs point to the fixture. The runtime
override points to an absent executable. No personal records or sign-in are
used. The only substituted function is Electron's external URL handoff. It
records accepted URLs or reports an OS failure. This proves routing and error
handling; it cannot prove that an installed Codex app opens a chat.

Live account authentication, successful CLI terminal resume, installed updates,
tray controls, and display scaling are outside this suite. No claim is made
that these paths pass. Electron requires a desktop display (or Xvfb). Tests run
with one worker because native windows share focus.

Each invocation prints its unique `.evidence/e2e/<run>/` directory. A later run
does not overwrite that run's report. Results include a trace for each launch,
renderer screenshots, and Electron runtime logs. Claude, provider, and chat-opening
scenarios also record video. Open the printed report directory with
`pnpm exec playwright show-report .evidence/e2e/<run>/report`.

Failure screenshots and traces are retained before fixture removal. Cleanup
errors are attached to the result and do not replace the original feature
failure. A cleanup error after a successful check still fails the check.
Restarts reuse only that scenario's profile; the next scenario gets a new one.
