# Build and release Session Lights

## Build a local installer

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run pack
```

On Windows, the output is `dist/Session-Lights-<version>-<architecture>-Setup.exe`.
The unpacked app is in `dist/win-unpacked`.
On macOS, the output includes a `.dmg`, a `.zip`, and update metadata.
Build on each operating system and CPU type that you distribute.
`pnpm run pack --dir` builds an unpacked app without an installer.
Local packaging never publishes a release.

The version in `package.json` is the version source for the installer and the app.
Keep `appId`, `productName`, and the release repository stable after the first release.
These values determine installation identity, settings paths, and update discovery.

## Configure release access

The publish configuration uses `ToniEsteso/session-lights` for installers and updates.
Make the repository public before distributing the first release to users.
The app cannot read private GitHub releases without account access.
Public download links must work without a GitHub account or token.
If distribution must stay private, change the release service before publishing.
Do not put a GitHub token in the app.

## Configure signing

Add these repository secrets for Windows releases:

- `WIN_CSC_LINK`: the Windows signing certificate, as a supported certificate link or Base64 value.
- `WIN_CSC_KEY_PASSWORD`: the certificate password.

For Mac releases, also add:

- `MAC_CSC_LINK`: the Apple Developer ID certificate.
- `MAC_CSC_KEY_PASSWORD`: the certificate password.
- `APPLE_ID`: the Apple developer account.
- `APPLE_APP_SPECIFIC_PASSWORD`: the notarization password.
- `APPLE_TEAM_ID`: the Apple developer team.

The release workflow requires a signing certificate. It fails if signing credentials are missing.
To release without a certificate, select **allow_unsigned** when you run the workflow. The Windows installer is then unsigned. The installed app turns updates off and tells the user to download new versions from GitHub Releases. Signing secrets are limited to their platform build step.
Windows update checks require valid signatures on both the installed app and the download, with the same publisher subject. A failed verification blocks installation. A publisher subject change needs a manual install.
Local Windows installers can be unsigned for testing.

## Prepare a release

Before distributing installers, review the release gates in [AUDIT.md](../AUDIT.md). The lazy-val notice in THIRD_PARTY_NOTICES.md uses the MIT terms and the author in the package metadata. Upstream has not confirmed it.

1. Update the version in `package.json` with an appropriate version increment.
2. Run `pnpm run check` and `pnpm run build`.
3. Build the installer with `pnpm run pack`. Verify installation and panel behavior on a disposable system.
4. Verify an update between two signed installed versions on each supported operating system.
5. Commit the reviewed changes and create a version tag such as `v0.2.0`.
6. Push the commit and tag to the source repository.
7. Run the **Release** workflow for that tag. Select Mac builds only when Mac signing is configured.
8. Review the installers in the draft release.
9. Publish the draft when its installers and metadata are ready.

The workflow checks that the selected tag matches `package.json`.
Build jobs finish before the upload job starts.
The upload job adds installers, block maps, and update metadata to one draft release.
Installed apps see the release after you publish the draft.
Keep previous releases available for downloads and recovery.

## Verify an update

Use two signed installed versions on a disposable system before a public release.
Check update discovery, manual download, progress, restart, and the installed version.
Confirm that saved preferences remain after the update.
Check download failure and retry. Confirm that an invalid Windows publisher prevents installation.
Verify Mac updates with signed builds on a Mac.
Record the observed results and any paths that could not be checked.
The previous automated updater scripts have been removed.
