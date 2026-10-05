# Session Lights

A small panel attached to the right edge of your screen. It stays above normal app windows.
The first version reads local **Codex desktop** sessions on Windows and macOS.

| Color | State | Meaning |
| --- | --- | --- |
| Green | Idle | The last turn finished or stopped. |
| Yellow | Needs you | Codex recorded an approval or question notification. |
| White or blue-gray | Working | The last recorded turn is in progress. |
| Red | Failed | The last turn failed. |
| Gray | Unknown | Data is missing, unsupported, or too old to confirm an active turn. |

## Install

Download an installer from [GitHub Releases](https://github.com/ToniEsteso/session-lights/releases).
See [installation and update help](docs/installation.md) for Windows and macOS instructions.
The installer includes its runtime. Node.js and npm are required only for development.
Release downloads become available after the repository is public and the first release is published.

## Run from source

Install Node.js 22.12 or later and npm. In this folder, run:

```sh
npm ci
npm start
```

`npm start` builds the TypeScript code before starting Electron.
Use `npm run demo` to see all five colors with sample sessions.
Use `npm run pack` to build an installer for the current system.
Windows builds produce a per-user NSIS installer. Mac builds produce a DMG and an update ZIP.
Use `npm run pack -- --dir` for an unpacked development build.
See [build and release instructions](docs/releases.md) for signing, release setup, and verification.

## Use the panel

- Click the gear for Appearance, adapter switches, updates, and Quit. The small menu opens to the left of the panel.
- Choose System, Light, or Dark in Appearance. System is the default and follows device theme changes. The choice applies at once and stays after app restarts. Use Tab to reach the theme choices and arrow keys to change the choice.
- A yellow badge on the gear marks an available update. Downloads and restarts require a click. Installed releases check at startup and every six hours.

- Text follows system display scaling. On Windows, it also follows **Settings → Accessibility → Text size** automatically, including changes while the app is running. The expanded panel and hover cards grow with the text; the compact bar keeps its width. The app checks the Windows text setting every ten seconds. macOS uses system display scaling; a separate accessibility text size reader is not implemented.
- Hover over a dot for a small detail card beside the panel. It shows the chat name, project, state, and age of the last recorded activity. It does not change the dot or take keyboard focus.
- Click a dot to show session names. Press Escape or use the arrow in the expanded panel to collapse it.
- The panel opens and closes with a short slide and fade. Its right edge stays fixed. The system's reduced-motion setting skips the animation.
- Click a name in the expanded panel to open the chat in Codex.
- Pin a session with the bookmark icon. A filled yellow bookmark marks a pinned session. Pins stay visible after the app restarts.
- All adapters appear by default. In Settings, use the Adapters switches to hide or show an adapter and its sessions and usage. Changes apply at once and stay saved after a restart. Hidden adapters continue monitoring; their session data and pins stay intact. If all adapters are hidden, use Open Settings in the panel to show one again.
- All saved, unarchived desktop sessions from visible adapters appear.
- Each row shows its project, provider, and state below the chat title. Codex uses its saved project name when a session maps to one. Otherwise, the row uses its workspace folder or `No workspace`. Projects without saved sessions do not appear. Long project names are shortened to fit. Hover over a project group heading for the full path or project ID.
- The right side of each expanded row shows the age of its last recorded activity, such as `just now`, `5m ago`, or `2h ago`. The age updates while the panel is open. A dash means the activity time is unavailable.
- Use the two buttons at the top to sort by latest activity or project. The selected button has a soft background. The choice is saved and also sets compact light order. Project headings appear only in the expanded list.
- Pins come first in activity order. In project mode, pins come first within each project. Chats within a project then follow latest activity.
- Below a thin divider, the compact panel shows two small gauges: 5-hour above weekly. Their arc and pointer show the amount left. Click a gauge to expand the panel.
- Gauges and usage percentages are green above 20% remaining, yellow above 5% up to 20%, and red at 5% or less. Unavailable limits show a gray gauge with no pointer.
- The expanded panel shows usage bars, percentages, and reset countdowns. Hover over a gauge or row for a detail card with its provider, scope, amount left, countdown, exact reset time, and reading age.
- Use the top-right cross to hide the panel. Use the tray icon to show it again.
- Drag the blank top area to move the panel up or down. The panel follows the pointer and saves its position when you release it.
- Use the tray menu to show the panel, move it to the screen under the pointer, or quit.

Panel settings are stored in the operating system's app data folder for Session Lights.
The session reader reads Codex records without changing them. It does not send session data over the network.
The usage reader starts an installed Codex runtime, which uses its existing ChatGPT sign-in to read account limits.
Session Lights does not open credential files or handle tokens itself. Codex manages its own authentication.

## Usage limits

The usage reader calls `account/rateLimits/read` through Codex's [documented app-server interface](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt).
It refreshes once a minute. These limits cover the signed-in account, including usage from other devices.
Failed reads show **Unavailable**. A passed reset time clears the old figure until a new reading arrives.
The session lights keep working if the usage reader is offline or signed out.
The reader does not start chats, send model requests, consume reset credits, or change Codex settings.

On Windows, it finds the installed desktop runtime or a native/npm Codex CLI on PATH.
On macOS, it tries the Codex app bundle, PATH, and common Homebrew/CLI paths. These Mac paths remain unverified here.
If discovery fails, set `SESSION_LIGHTS_CODEX_BINARY` to the absolute path of an existing native Codex executable before starting the panel.
No Codex package is bundled with this app. A working Codex runtime and ChatGPT sign-in are required for live limits.

## Data source and limits

The adapter reads `state_*.sqlite`, `thread_history_*.sqlite`, and session JSONL records under `CODEX_HOME`, or `~/.codex`.
It reads desktop notification logs from `%LOCALAPPDATA%/Codex/Logs` on Windows and `~/Library/Logs/com.openai.codex` on macOS.
It checks for changes every two seconds. It excludes archived chats, CLI chats, IDE chats, and internal subagents.

These local file formats are not a supported monitoring API. They can change after a Codex update.
This app shows the **last recorded state**, not a direct connection to Codex's running process.
A turn with no activity for 15 minutes becomes gray. It can still be working.
Yellow requires a desktop notification log entry. A prompt may not create that entry while Codex has focus or when notifications are disabled.
New user input clears a question. Tool output clears an approval. A finished turn clears both.
Only local sessions with local records are supported. Remote/cloud sessions are not included.
The adapter reads the last 512 KiB of each record or log file. Older pending notifications outside that range can be missed.
If the turn history database cannot be read, the adapter uses session records and reports the limit in its status tooltip.
macOS window behavior and its default log path need validation on a Mac. Windows native tests are included.

Codex documents runtime states in its [app-server protocol](https://learn.chatgpt.com/docs/app-server).
Chat links use the [documented desktop link format](https://learn.chatgpt.com/docs/reference/commands).
Starting a separate app-server does not give this panel the desktop app's live runtime state.
The local reader lets the panel work without changing the user's Codex setup.

## Extend

Add an adapter under `src/adapters/` and register it in `src/adapters/index.ts`.
Use a unique adapter `id`. No changes to the main process or UI are needed to register another provider.
Implement `SessionAdapter` from `src/shared/contracts.ts`.
Use `epochMilliseconds()` and `unixSeconds()` from `src/shared/time.ts` for timestamps.
See [Add a provider](docs/add-a-provider.md) for a complete typed example.
An adapter has `id`, `name`, and an async `read()` method. The method returns:

```ts
{
  health: 'Source status shown in the panel',
  sessions: [{
    id: 'provider-local-id', title: 'Session name', project: 'Project', workspace: 'Full path',
    state: 'idle', detail: 'Why this state applies', updatedAt: epochMilliseconds(1791187200000)
  }]
}
```

The monitor gives each session a provider-specific key and isolates source failures.
The panel uses the same five states for all sources. Project fields have these meanings:

- `project`: a short display name. This name appears in each row.
- `workspace`: an optional full folder path. The panel uses it for project grouping when no project ID is supplied.
- `projectId`: an optional shared project ID. Use it when a project has no local path, or needs an identity other than its folder. It takes priority over the path. Use the same ID in each adapter that refers to the same project. Prefix provider-local IDs with the provider ID to prevent accidental matches.

Without an ID, the same full path groups chats across providers. Windows paths ignore letter case, slash direction, and trailing slashes.
Other paths keep their case. Path matching does not resolve symlinks or treat different worktrees as the same folder.
Equal display names at different full paths stay separate. A display name without a path or ID stays within its provider.
The panel shows `No workspace` when an adapter has no name, path, or ID. Codex also uses it for its dated scratch folders. It gives the same label on each account and computer. The full local path still keeps separate workspaces in separate groups and appears in the detail card. An adapter can use `projectId` to group one project across different paths.
If only a path is available, its last folder name supplies the label. If only an ID is available, the ID supplies the label.
Each group uses one shared label so adapter aliases do not split the group.
`updatedAt` is required. Supply the last recorded session activity as epoch milliseconds with `epochMilliseconds()`. Keep this time unchanged between reads until the session has new activity. Do not use the adapter read time. Use `epochMilliseconds(0)` when the time is unavailable. The panel uses this field for activity sorting, the age on the right side of each row, and session tooltips.

Add an optional `open(id, openExternal)` method to open a chat. The adapter validates its own identifiers and links.
Use the supplied `openExternal(url)` function for an OS link, or handle opening within the adapter.

For usage, add an optional `readUsage()` method. The panel then shows the provider's gauges without UI changes.
An adapter can define `usage` for scope and known limit labels. These limits remain visible as unavailable during startup or a failed read:

```ts
this.usage = {
  scope: 'Account-wide usage',
  windows: [{ id: 'daily', label: 'Daily', title: 'Daily allowance' }]
};
```

`readUsage()` returns a reading in this form:

```ts
{
  windows: [{ id: 'daily', label: 'Daily', remainingPercent: 72, resetsAt: unixSeconds(1791200000) }],
  updatedAt: epochMilliseconds(Date.now()), message: ''
}
```

Limit IDs are unique within each provider. Labels and limits belong to the adapter. `remainingPercent` is a number from 0 to 100.
`resetsAt` is an optional Unix time in seconds. `updatedAt` uses milliseconds. A limit without a reset time can still show its amount left.
The shared UI handles colors, countdowns, tooltips, and missing data. It has no Codex-specific limit names.
The monitor refreshes usage once a minute. Usage failures do not hide other providers' limits or stop session reads.
Add an optional `close()` method to release child processes or other resources when the app quits.
Codex runtime discovery, authentication requests, limit selection, labels, scope, and chat links all stay in its adapter files.

Claude, OpenCode, and other tools are not yet implemented.

## Checks

```sh
npm run check
npm test
npm run audit:migration
npm run test:desktop
```

The desktop check runs the real Electron app against isolated test files.
It checks the panel, state updates, long lists, pins, usage, dragging, and saved settings. It saves screenshots and a report under `evidence/`.
It does not change your Codex data or click into a real Codex chat.
Usage UI checks use an isolated local JSON-RPC service. Run `npm run check:usage` to check the real account connection.

All app code, scripts, and tests use TypeScript. Generated output goes into `build/`.
See [TypeScript architecture](docs/architecture.md) for compiler settings, module ownership, and build rules.
The source is kept in a local Git repo. Builds, dependencies, and test evidence are excluded.
See [Migration verification](docs/migration-verification.md) for the current checks and platform limits.
See [VERIFICATION.md](VERIFICATION.md) for earlier review results.
