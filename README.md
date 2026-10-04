# Session Lights

A small panel attached to the right edge of your screen. It stays above normal app windows.
The first version reads local **Codex desktop** sessions on Windows and macOS.

| Color | State | Meaning |
| --- | --- | --- |
| Green | Idle | The last turn finished or stopped. |
| Yellow | Needs you | Codex recorded an approval or question notification. |
| White | Working | The last recorded turn is in progress. |
| Red | Failed | The last turn failed. |
| Gray | Unknown | Data is missing, unsupported, or too old to confirm an active turn. |

## Run

Install Node.js 22.12 or later. In this folder, run:

```sh
npm ci
npm start
```

Use `npm run demo` to see all five colors with sample sessions.
Use `npm run pack` to make a portable app for the current system.
On Windows, open `Session Lights.exe` in the new `dist` folder. Keep the folder intact.
On macOS, open `Session Lights.app`. Build on each system and CPU type that you use.
The macOS app gets a local ad hoc signature. It has no Apple Developer signature or notarization.
macOS may require you to allow it in Privacy & Security. The build uses the system's `codesign` tool.
The Windows build grants sandboxed apps read and execute access to the portable app folder.
This keeps Electron's renderer sandbox enabled in restricted workspace folders.

## Use the panel

- Hover over a dot to see the session name, working folder, and state.
- Click a dot to show session names. Press Escape or use the arrow in the expanded panel to collapse it.
- Click a name in the expanded panel to open the chat in Codex.
- Pin a session with the diamond. Pins stay visible after the app restarts.
- All saved, unarchived desktop sessions appear.
- Below a thin divider, the compact panel shows two small gauges: 5-hour above weekly. Their arc and pointer show the amount left. Click a gauge to expand the panel.
- Gauges are green above 20% remaining, yellow above 5% up to 20%, and red at 5% or less. Unavailable limits show a gray gauge with no pointer.
- The expanded panel shows usage bars and percentages. Hover over a gauge or row for the limit name, amount left, and reset time.
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

Add an adapter under `src/adapters/` and register it in `src/main.cjs`.
An adapter has `id`, `name`, and an async `read()` method. The method returns:

```js
{
  health: 'Source status shown in the panel',
  sessions: [{
    id: 'provider-local-id', title: 'Session name', project: 'Project',
    state: 'idle', detail: 'Why this state applies', updatedAt: Date.now()
  }]
}
```

The monitor gives each session a provider-specific key and isolates source failures.
The panel uses the same five states for all sources. Add a provider's open action in the main process.
Claude, OpenCode, and other tools are not yet implemented.

## Checks

```sh
npm run check
npm test
npm run test:desktop
```

The desktop check runs the real Electron app against isolated test files.
It checks the panel, state updates, long lists, pins, usage, dragging, and saved settings. It saves screenshots and a report under `evidence/`.
It does not change your Codex data or click into a real Codex chat.
Usage UI checks use an isolated local JSON-RPC service. Run `node scripts/usage-check.cjs` to check the real account connection.

The source is kept in a local Git repo. Builds, dependencies, and test evidence are excluded.
See [VERIFICATION.md](VERIFICATION.md) for the review results and remaining limits.
