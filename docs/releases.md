# Build and release Session Lights

## Build a local installer

```sh
npm ci
npm test
npm run pack
```

On Windows, the output is `dist/Session-Lights-<version>-<architecture>-Setup.exe`.
The unpacked app is in `dist/win-unpacked`.
On macOS, the output includes a `.dmg`, a `.zip`, and update metadata.
Build on each operating system and CPU type that you distribute.
`npm run pack -- --dir` builds an unpacked app without an installer.
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
Local Windows installers can be unsigned for testing.

## Prepare a release

1. Update the version with `npm version patch --no-git-tag-version` or another appropriate version increment.
2. Run `npm test`, `npm run test:desktop`, and `npm run audit:migration`.
3. Build the installer and verify it with `npm run test:package -- dist/win-unpacked` on Windows.
4. Run `npm run test:updates -- dist/Session-Lights-<version>-x64-Setup.exe` on Windows.
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

`npm run test:updates -- <installer>` runs the real Windows updater against an isolated local HTTP server.
It checks version discovery, manual download, checksum verification, failure, and retry.
The server and updater cache use test folders. The check does not publish a release or install an update.
Use two installed versions on a test computer to verify the restart and installation step before the first public release.
Mac updates need a separate signed test on a Mac.
