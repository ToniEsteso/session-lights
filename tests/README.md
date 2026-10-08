# Main feature tests

Run `pnpm run test:e2e` (or `pnpm test`). The command builds the app, then uses
Playwright to start Electron. No separate browser install is needed. On a Linux
host without a display, use `xvfb-run -a pnpm run test:e2e`.

Video scenarios need Playwright's FFmpeg runtime. If it is missing, run
`pnpm exec playwright install ffmpeg` once. The fixture resolves the project's
pinned Electron executable directly, including with pnpm's shared dependency store.

There are no unit tests. Keep this suite small. Add a scenario only to protect a
main use case or a reported defect. Follow the feature rules in `AGENTS.md`.

## Scenarios

The UX scenarios check the 24-hour list limit with pinned and newly active old
threads; waiting and failed sessions above newer activity, with visible state
text and recovery; arrow keys and Enter in the list; and Undo with pin persistence. A real
preference write failure must leave the session visible without Undo feedback.
The turn-duration scenario starts a Codex CLI turn 7.5 minutes ago and a second Claude turn
62.5 minutes ago, after an older finished turn and before a recent tool result. The open panel must
show `7m` and `1h 2m` on the Working rows. It detects a row that shows the last activity, a duration
from the first prompt or the tool result, and a duration that stays after the turn completes.
The scenarios use the running Electron app and isolated local records.
The layout scenario starts with three Codex sessions, then adds a Claude session
through a local transcript. At standard desktop text size, all four session
buttons and all four account limit bars (Codex and Claude) must fit in the native panel. It detects a
window that stays too short and clips the last row behind the usage section.

The tray scenarios hide the panel in Settings, restart, and start the app a second time. The panel
must stay hidden after the restart, then return as the compact bar when the app starts again. A second
scenario turns on Start at login, restarts, and turns the item off outside the app. Settings must show
the saved state each time. The OS registry is a file substitute. These scenarios cannot prove that Windows starts the
installed app at sign-in, or that the tray icon appears. Check both once on a packaged build.

The edge scenario selects Left, Top, and Bottom in Settings > Position, restarts, and then selects Right.
For each edge, the closed bar and the open panel must touch that edge of the screen work area.
On the top and bottom edges, the closed bar must be wider than it is tall. It detects a panel that
stays on the old edge, a bar that keeps the vertical shape, a bar that misses the edge because of the
native minimum window height, and an edge choice that is not saved.

The provider scenarios require exactly two switches: Codex and Claude. Hiding
Codex must hide desktop sessions, CLI sessions, and Codex usage together, while Claude
sessions and Claude usage stay visible. Each Codex row must still show its source.
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
update, and sidechain sessions must stay out of the panel. Three more scenarios cover Claude
account limits, command-only sessions, and live process status. A launcher that prints fixed
`claude -p /usage` text must give 55% and 96% left with reset countdowns that are right for
reset times written in Tokyo and Los Angeles. A session made only by a `/usage` command must not
appear as a chat. A status file for a running process must turn a session yellow for a permission
dialog, then Idle, then Working. The same file for a process that has exited must be ignored.
These checks protect
provider behavior through the running app; internal code can change freely.
The Claude fixtures are synthetic. They cannot verify real CLI startup, the
record format, or the `/usage` text of an installed Claude Code version.

| Starting state | User action or external input | Required result / wrong result detected |
| --- | --- | --- |
| Local desktop and CLI chats exist in SQLite with session records. The usage runtime is absent. | Write a desktop question notification, user reply, failed turn, and completed turn. Write a CLI question and its answer. Remove and restore a session record. | The panel changes between Working, Needs you, Failed, Idle, and Unknown. A missing record does not hide healthy chats. A restored record recovers. Unavailable account limits do not stop sessions. |
| Three chats have different activity times and projects. | Pin a chat, select Project, hide the pinned chat, restart, restore it, unpin it, select Activity, then hide and restore two chats. Restart again. | Pins precede other chats. Project and activity order follow the selected mode. Hidden chats stay hidden after restart. Restore keeps the pin; Restore all stays saved. |
| Both sources are visible. A desktop chat is pinned. | Select Dark, hide each source, restart, use Open Settings from the empty panel, restore the sources, select Light, and restart. | The selected theme applies and survives restart. Source switches remove their chats and usage, stay saved, and permit recovery from the empty panel. Source hiding keeps the pin. |
| A desktop chat and a CLI chat are visible. | Click a desktop title. Make the OS link handoff fail, then recover and retry. Click the CLI chat with an absent workspace. Change the sort mode. | The correct desktop URL reaches the external boundary. Launch failures show a useful message. A later action succeeds and clears the error. |

All assertions use displayed text, accessible controls, native theme media, or
the outgoing URL at the OS boundary. They do not inspect source text or private
application state. The code structure can change while these results stay valid.

The session-model scenario checks visible adapter and model names in Activity and Project rows, the absence of hover cards, concise settings labels, and model updates from the Codex database, older Codex turn records, and Claude assistant records. It checks sessions with no model data, ignored subagent and synthetic records, full names that wrap inside rows and screen-reader descriptions, record removal, recovery, and restart. The model records are synthetic; they do not prove future provider record compatibility.

The T3 scenarios check threads that T3 Code started. Without any T3 data, a Codex thread with
the originator `T3 Code` must appear as `Codex T3 Code`, and a Claude SDK session as `Claude SDK`.
Clicking the Codex thread must not send a `codex://` link. With a small T3 database, titles must
come from T3, worktrees of one project must share one heading with a session from the project
folder, an approval or question must show Needs you, a running turn must show Working, and a thread
deleted or settled in T3 must leave, unless its turn runs or waits for you. When the T3 process has ended, the stale counts must be ignored.
The T3 database in these scenarios is synthetic and holds only the columns the reader uses.

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
