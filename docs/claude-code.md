# Claude Code

Claude appears in Settings → Adapters, even if Claude Code is not installed.
One Claude adapter reads supported local transcripts. Desktop transcript discovery
and compatibility remain unverified; there is no separate Desktop switch.
With no local transcripts, it adds no session lights. Other providers keep working.
The adapter does not install Claude Code, change its settings, add hooks, read
credentials, or make network requests.

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
The light reports recorded events. It does not confirm that a process is running.
Permission dialogs are not reliably recorded, so approval prompts cannot produce
a reliable yellow light. Account usage limits are not available from transcripts.

Reads are limited to the first 64 KiB and last 512 KiB of each transcript. The
head supplies early metadata; the tail supplies state. Older pending questions
outside the tail can be missed. Invalid JSON lines are ignored. Missing or
unreadable files do not stop other sessions. Deleted transcripts leave the list.
File modification time supplies activity age only when recorded times are absent.
Polls do not change activity time.

## Resume

Click a Claude Code session to open a terminal in its saved workspace and run
`claude --resume <session-id>`. The terminal receives the same `CLAUDE_CONFIG_DIR`.
The workspace and installed launcher must exist. A missing installation produces
an error in the panel; saved records remain visible.

The launcher searches PATH and `~/.local/bin`. On Windows, it accepts `claude.exe`
and `claude.cmd`. On macOS, it also checks the usual Homebrew folders. Set
`SESSION_LIGHTS_CLAUDE_BINARY` to an absolute launcher path to override discovery.
macOS resume and real Claude Code startup are not verified on this Windows host.

## Sources and verification limits

Anthropic documents [transcript storage and its internal format](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)
and [CLI resume](https://code.claude.com/docs/en/cli-reference).
The [official SDK session reader](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py)
supplies the metadata and sidechain conventions used here.
Transcript fields can change with Claude Code releases.

The Electron scenarios use small synthetic transcript files. They check the real
adapter, polling, panel, IPC, and saved settings without Claude Code installed.
They cannot prove that a future installed version writes these fields or that a
real CLI session resumes. Check those two paths with a local installation.
