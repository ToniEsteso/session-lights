# Windows release candidate verification

Date: 6 October 2026. Version: 0.1.0. Branch: codex/windows-first-release. Base commit: 876526f31542d051b24aee81a4946ef49931c806.

This report covers the unsigned Windows candidate with manual GitHub downloads. Earlier reports remain history.

## Results

| Requirement or check | Result |
| --- | --- |
| Type checks: pnpm run check | Passed. Both TypeScript configurations. |
| Compilation and bundling: pnpm run build | Passed. |
| Running Electron features: pnpm run test:e2e | Passed. Seven tests; none skipped. Uses synthetic SQLite, JSONL, and separate app profiles. |
| Manual update link | Passed. Settings opens the fixed GitHub release URL at the OS boundary. An OS launch failure shows an error; retry clears it. Normal thread controls still work. |
| Windows NSIS build | Passed. electron-builder 26.15.3, Electron 44.5.1, Windows x64. Signing was disabled and publication was disabled. |
| Installer signature | NotSigned, as intended. |
| Package contents | Passed. Project license, third-party notice, installation help, LICENSE.electron.txt, and LICENSES.chromium.html are present. No runtime node_modules, app-update.yml, or elevate.exe is distributed. Packaged main matches the compiled app. |
| Fresh installation | Passed in a new test folder on the current Windows account. The app registers as Session Lights 0.1.0. |
| Installed app behavior | Passed. Reads the synthetic session, displays v0.1.0, offers manual GitHub downloads, and changes the theme. |
| Installer replacement and restart | Passed. Reinstalling the same candidate and restarting preserves the selected Dark theme. |
| Uninstall | Passed. Removes the test executable and app registration. The isolated preferences remain. |
| Release workflow | YAML parses. Unsigned Windows is the default. It runs feature checks, writes SHA256SUMS.txt, and prepares a draft release with release notes. Remote execution is not yet verified. |
| Public download | Blocked. The repository is private. No release is published. GitHub CLI and the available browser are not signed in. |

Installer: Session-Lights-0.1.0-x64-Setup.exe, 100145594 bytes.

SHA-256: `6f36d474ad74b5c7b8e80a3f4577a57c3d06b063bc9d23c617fea6a368761eaf`.

## Evidence and limits

Local evidence is in `.evidence/demos/windows-release-20261006/`. It includes the installed-app video, a Settings screenshot, package and installer reports, and the manual-update test trace. The video uses the real installed app with a synthetic session. Only the outgoing OS browser handoff is substituted; this cannot prove browser sign-in or public GitHub access.

Native checks ran one at a time. The installer check refuses to replace an existing installation. All provider inputs and the app profile are isolated. No personal Codex records or credentials were used. The test installation was removed.

Windows Sandbox is unavailable. This was not a clean VM check. Installer replacement used the same version; a version-to-version upgrade was not checked. Interactive SmartScreen prompts, other Windows security policies, successful CLI resume, live account authentication, and macOS were not checked.

An initial registration assertion expected Session Lights without the version. The installer correctly registered Session Lights 0.1.0. That check was corrected, the test copy was removed, and the complete installation check then passed. An early packaged-launch fixture lacked Codex origin metadata; the corrected synthetic fixture was used for the final installed-app check.
