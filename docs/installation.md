# Install Session Lights

## Install on Windows

1. Open the [release downloads](https://github.com/ToniEsteso/session-lights/releases).
2. Download `Session-Lights-<version>-<architecture>-Setup.exe` for your computer. Most Windows computers use `x64`.
3. Close any portable copy of Session Lights.
4. Open the installer. It installs for your Windows account.
5. Find **Session Lights** in the Start menu if the panel does not appear.

The installer includes Electron and its runtime. You do not need Node.js or npm.
Live sessions require local Codex desktop records. The app reads usage limits automatically. The Codex runtime can write or migrate shared data and uses your existing sign-in.
The panel starts after installation. Its tray icon can show or hide the panel.
The app does not start automatically when you sign in to Windows.

The first Windows release is unsigned. Windows can show an unknown-publisher or SmartScreen warning. Some security policies can block unsigned apps.
Signing is optional. A signed release needs the publisher's signing credentials.

## Install on macOS

1. Download the `.dmg` for your Mac. A `universal` build supports both Apple silicon and Intel.
2. Open the disk image.
3. Drag **Session Lights** into **Applications**.
4. Open **Session Lights** from **Applications**.

Public Mac releases must have an Apple Developer signature and notarization.
For a build with one CPU type, use `arm64` for Apple silicon or `x64` for Intel.
Mac installation and updates need verification on a Mac before the first Mac release.

## Update the app

Updates use manual GitHub downloads. The app does not check, download, or install updates automatically.

1. Open Settings and click **Downloads on GitHub**.
2. Download the latest Windows installer.
3. Quit Session Lights from Settings.
4. Run the installer. It replaces the installed version and starts the panel.

Your pins, hidden sessions, adapter switches, theme, sort order, and panel position stay saved.
The installer and app include their runtime. Node.js and pnpm are not required.

For a Mac build, quit the app and replace it in Applications. Mac releases still require native verification before distribution.

## Resolve an installation problem

- If the panel is hidden, click its tray icon or select **Show panel** from the tray menu.
- If no sessions appear, start the Codex desktop app and open a local chat.
- If Downloads on GitHub cannot open your browser, use the release link above and try again.
- To check download integrity, compare the installer's SHA-256 hash with SHA256SUMS.txt from the same release.
- If installation fails because the app is in use, quit Session Lights from its gear or tray menu and run the installer again.

## Remove the app

On Windows, open **Settings > Apps > Installed apps** and uninstall **Session Lights**.
On macOS, quit the app and move **Session Lights** from **Applications** to the Trash.
Uninstalling preserves the panel settings. It does not remove Codex data.
