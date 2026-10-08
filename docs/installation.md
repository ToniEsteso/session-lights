# Install Session Lights

## Install on Windows

1. Open the [release downloads](https://github.com/ToniEsteso/session-lights/releases).
2. Download `Session-Lights-<version>-<architecture>-Setup.exe` for your computer. Most Windows computers use `x64`.
3. Close any portable copy of Session Lights.
4. Open the installer. It installs for your Windows account.
5. Find **Session Lights** in the Start menu if the panel does not appear.

The installer includes Electron and its runtime. You do not need Node.js or npm.
Live sessions require local Codex desktop records. The app reads usage limits automatically. The Codex runtime can write or migrate shared data and uses your existing sign-in.
The panel starts after installation. Its tray icon can show or hide the panel. To start the panel when you sign in, turn on **Start at login** in Settings.
The app does not start automatically when you sign in to Windows.

Releases without a signing certificate are unsigned. Windows SmartScreen can show an unknown-publisher warning. Choose **More info**, then **Run anyway**, if you trust the source.
An unsigned build does not update itself. Settings shows **Updates unavailable**. Download each new version from the release downloads and run its installer over the old one.
Signed releases update from inside the app.

## Install on macOS

1. Download the `.dmg` for your Mac. A `universal` build supports both Apple silicon and Intel.
2. Open the disk image.
3. Drag **Session Lights** into **Applications**.
4. Open **Session Lights** from **Applications**.

Public Mac releases must have an Apple Developer signature and notarization.
For a build with one CPU type, use `arm64` for Apple silicon or `x64` for Intel.
Mac installation and updates need verification on a Mac before the first Mac release.

## Update the app

The installed app checks at startup and every six hours.
Checks do not download or install an update.

1. Click the gear at the bottom of the compact panel or beside the hide button in the expanded panel.
2. Click **Check for updates** to check immediately.
3. If an update is available, click **Download update**.
4. When the download finishes, click **Restart to update**.

A small yellow badge on the gear marks an available update.
The menu shows download progress and a retry button if a check or download fails.
You can close the menu while the download continues.
Quitting the app does not install a downloaded Windows update.
On macOS, the native updater can apply a staged update on a later launch.

Your pins, sort order, and panel position stay in the app's settings folder.
The updater does not access Codex records or credentials. The Codex child manages its own data and authentication after restart.
Update checks send requests to the release service. They do not include chat data.

Development runs show **Updates unavailable**. Use an installed release to check for updates.
Existing portable copies do not acquire an installer automatically. Install the new app once.

## Resolve an installation problem

- If the panel is hidden, click its tray icon or select **Show panel** from the tray menu.
- If no sessions appear, start the Codex desktop app and open a local chat.
- If an update check fails, check your internet connection and click **Retry**.
- If a download fails verification, retry the download. You can also download the installer from the release page.
- If installation fails because the app is in use, quit Session Lights from its gear or tray menu and run the installer again.

## Remove the app

On Windows, open **Settings > Apps > Installed apps** and uninstall **Session Lights**.
On macOS, quit the app and move **Session Lights** from **Applications** to the Trash.
Uninstalling preserves the panel settings. It does not remove Codex data.
