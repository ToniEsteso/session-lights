# Build and release Session Lights

## First Windows release

The first Windows release uses an unsigned per-user installer and manual GitHub downloads. No signing certificate, Apple account, or update service credentials are required.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run test:e2e
pnpm run pack
```

The installer is `dist/Session-Lights-<version>-x64-Setup.exe` on an x64 Windows host. The unpacked app is in `dist/win-unpacked`. The installer includes Electron and its runtime. Users do not need Node.js or pnpm.

`pnpm run pack --dir` produces only the unpacked app. Local packaging never publishes a release.

Before publishing:

1. Check fresh installation, Start menu launch, panel controls, and uninstall on an isolated Windows system.
2. Check that installing a newer version keeps saved settings.
3. Inspect the packaged app, help, project license, third-party notices, LICENSE.electron.txt, and LICENSES.chromium.html.
4. Confirm code and icon rights and consent to personal metadata in public Git history. See the historical [audit](../AUDIT.md).
5. Make the GitHub repository public if users must download without repository access.

The old lazy-val notice gate no longer applies to this package: electron-updater and its runtime dependencies have been removed. Keep the earlier audit as history. Its test results do not verify a new installer.

## Create a GitHub release

The version in package.json supplies the app and installer version. Keep appId and productName stable to preserve installation identity and settings paths.

1. Commit the checked source and set a stable version tag, such as v0.1.0, that matches package.json.
2. Push the commit and tag.
3. Run the Release workflow for the tag. Leave sign_windows and include_mac off for the unsigned Windows release.
4. Review the draft release. It contains the installer, SHA256SUMS.txt, and the prepared release notes.
5. Publish the draft and verify that the download works without a GitHub account.

The workflow checks the version, builds the app, runs feature tests, builds the installer, and writes its SHA-256 checksum. It uses the workflow's normal GitHub token for draft uploads. No personal token is put in the app.

Alternatively, upload a locally checked installer to a draft GitHub Release. Add SHA256SUMS.txt and use [release notes](release-notes.md). For a local checksum:

```powershell
$installer = Get-Item -LiteralPath dist/Session-Lights-0.1.0-x64-Setup.exe
$digest = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$digest  $($installer.Name)" | Set-Content -LiteralPath dist/SHA256SUMS.txt -Encoding ascii
```

Use the current version's filename. A checksum checks file integrity; it does not establish the publisher's identity.

## Manual updates

Settings and the tray menu provide Downloads on GitHub. This opens the fixed release page in the user's browser. The app does not check for updates, download packages, or start an update installer.

To update, quit the app, then download and run the new installer. Saved settings remain. Keep earlier releases available for recovery.

## Optional Windows signing

Enable sign_windows to use the existing certificate-file path:

- WIN_CSC_LINK: the Windows signing certificate as a supported link or Base64 value.
- WIN_CSC_KEY_PASSWORD: the certificate password.

This option fails when signing credentials are missing. Cloud or hardware signing services need their own workflow integration. Windows can show warnings for unsigned installers; some security policies block them.

## macOS

Mac packaging remains configured for DMG and ZIP output. Hold Mac distribution until native installation, launch, update, uninstall, and provider discovery have been checked on a Mac.

The optional Mac workflow requires MAC_CSC_LINK, MAC_CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID for Developer ID signing and notarization. Mac updates also use manual downloads. These credentials are not needed for the Windows release.
