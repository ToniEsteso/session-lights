# Claude Code

Claude appears in Settings → Show, even if Claude Code is not installed.
One Claude adapter covers every program that runs Claude Code on this computer.
The CLI, the Claude desktop app, editor extensions, and hosts such as T3 Code all
write the same transcripts (see [T3 Code](t3-code.md)), so there is no separate switch for each program.
With no local transcripts, it adds no session lights. Other providers keep working.
The adapter does not install Claude Code, change its settings, add hooks, or read
credential files.

## Local sessions

The adapter reads `<CLAUDE_CONFIG_DIR>/projects/<project>/<session-id>.jsonl`.
Without `CLAUDE_CONFIG_DIR`, it uses `~/.claude/projects`.
Set the variable before starting Session Lights to use a different data folder.
Folders can appear after startup; the next poll discovers them.

Session IDs must be UUIDs. The adapter excludes sidechain records and nested
subagent files. It uses the saved `cwd` for project grouping. It does not try to
decode project folder names because their encoding loses path characters.
Custom titles take priority over generated titles, summaries, and the first
user prompt. Duplicate IDs appear once, using the most recent record.

A session needs a title, a real user prompt, or a model reply. A command such as
`/usage` leaves a transcript with none of these. It is not a chat, so it stays out of the list.

Each transcript records the program that started the session. The row shows it
after the provider name: `CLI`, `Desktop`, `VS Code`, or `SDK`. T3 Code starts Claude
through the Agent SDK, so its sessions show `SDK`. When T3's database is present, they show `T3 Code`.

## Live state

A running Claude Code process keeps `<CLAUDE_CONFIG_DIR>/sessions/<pid>.json` and
removes it on exit. Its `status` is `busy`, `idle`, or `waiting`. While the process
runs, this status decides the light. Permission dialogs are not in transcripts, so
this is the only source for a yellow light on an approval prompt.
A status file whose process no longer runs is ignored. The transcript then decides.

| Live status | Light |
| --- | --- |
| `busy` | Working, even for a long tool run |
| `waiting` | Needs you (`input needed`, `dialog open`, or `sandbox request`) |
| `idle` | Idle. A recorded API failure stays Failed. |

## Transcript state

Without a running process, the last recorded event decides the light.

| Last recorded event | Light |
| --- | --- |
| User input, tool use, or thinking | Working |
| An unanswered `AskUserQuestion` tool call | Needs you |
| Matching question output or new user text | Working |
| Assistant `end_turn`, `stop_sequence`, or `max_tokens`; system `turn_duration` | Idle |
| A recorded user interruption | Idle |
| An assistant record with `isApiErrorMessage` | Failed |
| Assistant output without a completion marker | Unknown |
| Working or waiting activity older than 15 minutes, or without a valid time | Unknown |

An unrelated tool result does not clear a pending question. A failed tool result
does not by itself mean the whole turn failed. Claude can recover from tool errors.

Reads are limited to the first 64 KiB and last 512 KiB of each transcript. The
head supplies early metadata; the tail supplies state. Older pending questions
outside the tail can be missed. Invalid JSON lines are ignored. Missing or
unreadable files do not stop other sessions. Deleted transcripts leave the list.
File modification time supplies activity age only when recorded times are absent.
Polls do not change activity time.

## Usage limits

The adapter runs `claude -p /usage --no-session-persistence` and reads the lines
`Current session` (5-hour limit) and `Current week (all models)` (weekly limit).
Claude Code answers this command locally. It sends no model request and saves no
session. Claude prints reset times in the account time zone without a year, for
example `Oct 8, 1:39pm (Europe/Madrid)`. The adapter converts them to exact times.
A reset time that it cannot read leaves the percentage visible without a countdown.

The result is kept for two minutes. A run takes about 2.5 seconds. Failures show
`Unavailable` for both Claude limits and do not affect Codex or the session list.
The limits belong to the account, not to one chat. They include use in claude.ai
and every other Claude program on the account. API-key accounts have no limits to show.

## Resume

Click a Claude Code session to open a terminal in its saved workspace and run
`claude --resume <session-id>`. The terminal receives the same `CLAUDE_CONFIG_DIR`.
The workspace and installed launcher must exist. A missing installation produces
an error in the panel; saved records remain visible. Opening a session that another
Claude process already runs starts a second copy of it. The adapter cannot focus the
original window. The Claude desktop app has no link that opens a session by ID, so its
sessions also resume in a terminal. T3 Code threads open in T3 Code. See [T3 Code](t3-code.md).

The launcher searches PATH and `~/.local/bin`. On Windows, it accepts `claude.exe`
and `claude.cmd`. On macOS, it also checks the usual Homebrew folders. Set
`SESSION_LIGHTS_CLAUDE_BINARY` to an absolute launcher path to override discovery.
macOS resume is not verified on this Windows host.

## Sources and verification limits

Anthropic documents [transcript storage and its internal format](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)
and [CLI resume](https://code.claude.com/docs/en/cli-reference).
The [official SDK session reader](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py)
supplies the metadata and sidechain conventions used here.
The process status files and the `/usage` text are not documented. They were read
from Claude Code 2.1.294 on Windows. A later release can change them.

The Electron scenarios use small synthetic transcripts, status files, and a launcher
that prints fixed `/usage` text. They check the real adapter, polling, panel, IPC, and
saved settings. They cannot prove how a future Claude Code writes these files or prints
usage. The Claude desktop app was not installed on the check machine, so its transcript
location and `claude-desktop` entry point are unverified.
