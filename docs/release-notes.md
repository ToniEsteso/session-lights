# Session Lights for Windows

Download `Session-Lights-<version>-x64-Setup.exe` for 64-bit Windows. The installer includes its runtime. Node.js and pnpm are not required.

This release is unsigned by default. Windows can show an unknown-publisher or SmartScreen warning. Some security policies can block unsigned apps. Signing is optional in the release workflow; check the downloaded installer's publisher before running it.

The installer runs for your Windows account and creates a Start menu shortcut. The panel starts after installation. It does not start automatically when you sign in to Windows.

To update, open Settings > Downloads on GitHub. Quit Session Lights, then download and run the latest installer. Settings are kept. There are no automatic update checks, downloads, or installations.

`SHA256SUMS.txt` contains the Windows installer's SHA-256 checksum. On Windows, use `Get-FileHash -Algorithm SHA256 -LiteralPath <installer-path>` to compare it. A checksum checks file integrity; it is not a publisher signature.

Session reads use local Codex and Claude Code records. Live Codex usage limits require an installed Codex runtime and an existing ChatGPT sign-in. That runtime can create or migrate shared Codex data. The app does not bundle Codex or Claude Code.

Remove Session Lights through Windows Settings > Apps > Installed apps. Uninstall keeps panel settings and does not remove provider records.

macOS installers require separate native verification before distribution.
