# T3 Code

T3 Code runs Codex and Claude Code underneath. Session Lights lists those threads
in the Codex and Claude sources. There is no third switch. It works with or without T3.

## Without T3 data

Each provider keeps its own records, so T3 threads appear even when T3 is closed,
uninstalled, or its data is unreadable.

- **Codex:** T3 threads are rows in the Codex database with the originator `T3 Code`.
  The row shows `Codex T3 Code`. They have no Codex Desktop log, so state comes from the
  thread's rollout file, the same way as a Codex CLI thread.
- **Claude:** T3 starts Claude through the Agent SDK. The row shows `Claude SDK`. The
  running Claude process reports `busy`, `idle`, or `waiting`. See [Claude Code](claude-code.md).

## With T3 data

If T3's database exists, it adds the details the providers do not record. The reader opens
`<T3CODE_HOME or ~/.t3>/userdata/state.sqlite` (and `dev/state.sqlite`) read-only.
It matches threads by the provider's own ID: the Codex thread ID, or the Claude session ID
that T3 resumes. It never writes to T3.

| T3 data | Result in the panel |
| --- | --- |
| Thread title | Replaces the first prompt as the row title. `New thread` is ignored. |
| Project title and folder | Groups every worktree of a project under one heading, with sessions started outside T3 in the same folder. |
| Pending approval or question | Needs you. Provider records cannot show it. |
| Running turn | Working. |
| Thread deleted or archived in T3 | The row leaves the panel. |
| Thread settled in T3 (`settled_override` is `settled`) | The row leaves the panel, as if deleted. A settled thread that still runs or waits for you stays visible. T3 unsettles a thread when new activity arrives, and the row returns. |

The row source becomes `T3 Code` for both providers.

Pending counts and the running status stay in the database after T3 closes or crashes.
The reader uses them only while the process in `server-runtime.json` still runs.
After that, provider records decide the state.
A missing, locked, or unfamiliar database gives an empty result. It never hides a session
or stops a provider read.

## Opening a thread

T3 has no link that opens a thread. Clicking a T3 thread opens a terminal in its worktree and
resumes it with `codex resume <id>` or `claude --resume <id>`. If T3 still runs that thread,
the terminal starts a second copy. The panel cannot focus the T3 window.

## Limits

The T3 database layout is not documented. It was read from T3 Code (Alpha) on Windows.
The scenarios use a small database with only the tables and columns that the reader needs.
They cannot prove that a later T3 release keeps this layout. Threads from other T3 providers,
such as OpenCode, are not read.
