# TypeScript architecture

The provider contract is the extension point. `SessionMonitor` supplies provider identities, project groups, and independent failure handling.
The renderer uses the resulting payload. It has no provider-specific code.

## Shared contracts

`src/shared/contracts.ts` defines the adapter, session, usage, settings, and IPC types.
It has no Node or Electron imports. Both compiler configurations check these contracts.

`SessionAdapter` requires `id`, `name`, and `read()`.
Its optional capabilities are `readUsage()`, `open()`, and `close()`.
`UsageDefinition` declares scope and known window labels. `UsageReading` contains the current values and reading time.
A provider can return any usage window ID. The monitor joins definitions and readings by that ID.

`SessionState` derives from `STATES`. State labels have one owner. `src/ui/theme.css` supplies shared color variables for each theme.
`PanelAction` and `TooltipTarget` are discriminated unions.
The main process checks each action variant. An added action produces a compiler error until the handler covers it.
All three preload bridges use the same types as the renderers.

`EpochMilliseconds` identifies activity and reading times. `UnixSeconds` identifies usage reset times.
The constructors in `src/shared/time.ts` check numeric values before assigning their units.
These types remain numbers in JSON. The compiler prevents assignment between the two units.

## Ownership and data flow

| Module | Owns |
| --- | --- |
| `src/adapters/` | Provider discovery, external records, authentication requests, usage labels, and chat links |
| `src/core.ts` | Provider aggregation, project identity, session state rules, sorting, and failure isolation |
| `src/preferences.ts` | Settings parsing and persistence |
| `src/main.ts` | Native windows, scheduling, sender checks, and action handling |
| `src/preload.ts`, `src/tooltip-preload.ts`, and `src/settings-preload.ts` | The permitted renderer bridge methods and subscription cleanup |
| `src/updates.ts` | Update checks, downloads, installation, and update state |
| `src/ui/` | DOM updates, shared display text, and user input |
| `src/shared/` | Serializable contracts, input parsers, state metadata, and time units |

Session data moves through the following steps.

1. The adapter reads and checks external data.
2. The monitor adds provider keys and project groups.
3. The main process sorts sessions and supplies settings and usage.
4. The preload bridge sends the typed payload to the renderer.
5. The renderer sends a typed command when the user acts.
6. The main process checks the sender and parses the command before changing state.

SQLite rows and JSON-RPC replies enter as untrusted values.
The Codex adapter checks those values before using them.
The settings and IPC parsers accept `unknown` and produce domain values.
New providers must check their own external input before returning `SessionReading` or `UsageReading`.

## Codex sources

The desktop and CLI adapters share `CodexRecords` for read-only SQLite and session JSONL parsing.
Desktop keeps the `codex` ID. CLI uses `codex-cli`. This preserves existing desktop pins and hidden-session keys.
Desktop waiting signals come from notification logs. CLI waiting signals come from recorded input and permission tool calls, matched to their outputs by call ID. Unrecorded shell approvals remain a detection limit.
Both adapters use the same Codex project namespace. Their session filters do not overlap.
The desktop adapter owns account usage. `codex-runtime.ts` supplies runtime discovery for both usage reads and CLI resume. CLI resume prefers the packaged CLI over the standalone desktop binary.
CLI opening checks the saved session and workspace, then starts an interactive terminal with the selected session ID.

## Compilation and packaging

`tsconfig.base.json` enables strict checks, checked array access, exact optional properties, and unused code checks.
`tsconfig.json` checks and compiles the Node, Electron, script, and test modules.
Electron's declarations require the DOM library, but renderer code has a separate configuration.
`src/ui/tsconfig.json` exposes browser types without Node globals and prevents UI emission by the TypeScript compiler.

The build first checks both configurations.
`scripts/build.ts` then copies HTML and CSS and bundles the three renderer entries with esbuild.
It also bundles the preload entries. Each sandboxed preload can require only Electron.
Local shared modules are included in the preload bundle.

The generated Node modules use CommonJS with NodeNext resolution.
This preserves the current Electron runtime model and supports Node 22.12.
The browser bundles use IIFE format and work with the existing content security policy.
An all-ESM runtime would require separate handling for sandboxed preloads and file-loaded UI modules.
It would not improve the provider contract, so the migration keeps these runtime formats.

All generated output goes into `build/`. `npm run build` clears that directory first.
Packages include `build/src/`, with `build/src/main.js` as their entry point.
They do not require TypeScript, esbuild, tests, or installed npm packages at runtime.
Test adapters and native smoke checks load only when the isolated desktop test flag is present.

Relative imports use the emitted `.js` extension. TypeScript resolves these imports to `.ts` source during checks.
Source maps support debugging the emitted code.
The local UI configuration also gives editors the browser project when they open a renderer file.

## Verification

`npm run check` checks all source, scripts, tests, renderer globals, and negative type fixtures.
`npm test` builds and runs the real SQLite and child-process tests.
`npm run audit:migration` verifies source coverage and the generated browser and preload boundaries.
`npm run test:desktop` runs the native Electron app with isolated files and records its checks and screenshots.
Use `node --experimental-sqlite build/scripts/desktop-test.js --theme-only` after a build for the focused theme checks and cold restarts.
Add `--verify-system-theme` on Windows to check real operating system theme changes. This optional check restores the original theme setting.
`npm run test:package -- <folder>` compares packaged files with build output and checks a native launch.
The package launch check uses isolated files and verifies the installed version, update setup, and native window.

CI checks Node 22.12 and Node 24 on Windows, macOS, and Linux.
It also builds a Windows installer and an unpacked macOS app.
Native desktop checks still require a desktop session. Successful compilation does not verify native window behavior.

See [Add a provider](add-a-provider.md) for a complete extension example.
