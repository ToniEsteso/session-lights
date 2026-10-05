# First public release audit

Audit date: 5 October 2026.

The code fixes below close F1 and F3–F5, within the stated test limits. The owner decision below supersedes the F2 opt-in fix. Source publication still needs consent for historical personal metadata and confirmation of code and asset rights. Installer distribution still needs the upstream lazy-val notice and signed installation checks. See [Remediation](#remediation-after-the-audit) for the current state. The original findings below describe commit 2998f3654c245e1dc8687d1dea7f23e544d3f944.

## Owner decision after the audit

On 5 October 2026, the owner requested automatic usage reads and removal of the optional control. The runtime now starts when the app reads account limits. The opt-in remediation for F2 is superseded. Runtime startup can write or migrate the Codex home. The README and installation guide retain this behavior in their data-source description.

## Original audit state

- Commit: 2998f3654c245e1dc8687d1dea7f23e544d3f944.
- Branch: local main. Local origin/main points to the same commit.
- Starting checkout: clean. No staged, unstaged, or untracked changes.
- History: 7 commits, 155 distinct file blobs, 71 current tracked files. The repository is not shallow. Git object checks found no errors or dangling objects.
- No repository AGENTS.md was present. The audit followed the instructions supplied by the user. One agent did the review and verification.
- The local checkout was the source of truth. Remote workflow evidence did not replace local code.
- Scope: app and provider code, preload bridges, UI, preferences, updater, scripts, tests, docs, icons, Git history, dependencies, workflows, and accessible logs.
- No app code, dependency file, real credential, or real environment file was changed. No commit, push, history change, release, visibility change, or uninstall was done.
- AUDIT.md is the only new non-ignored file. Audit data is in ignored .tmp/.

The user approved npm ci in an isolated folder. All 71 tracked files were copied to .tmp/release-audit/. Dependencies were installed only there. A SHA-256 comparison confirmed that all copied source files still matched the checkout after the checks.

## Findings, ordered by severity

### F1. High: update signature verification can fail open

**Confirmed defect. Installer distribution blocker.**

Locations:

- src/updates.ts:47 accepts the default updater's download result.
- src/updates.ts:26 makes a completed download ready for installation.
- package-lock.json:2397 locks electron-updater to 6.8.9.
- In that dependency, node_modules/electron-updater/out/windowsExecutableCodeSignatureVerifier.js:120 handles verification errors. If its second PowerShell check also fails, it returns without rejecting. The caller resolves verification as successful.
- node_modules/electron-updater/out/NsisUpdater.js:84 calls this verifier when update configuration contains a publisher name.

Reproduction used the real NsisUpdater, the app's Updates class, a local HTTP feed, an isolated cache, and a known unsigned local executable. The feed contained the correct SHA-512 digest. Update configuration required a publisher name. Only check and download commands were sent.

| Test condition | Observed app state |
| --- | --- |
| Normal PATH; unsigned file; publisher required | download-error |
| Same file and publisher; PATH without PowerShell | ready |

No installer was run. Evidence and a reusable runner are in .tmp/release-audit/evidence/audit-signature-runner/main.cjs and report.json. Run that runner with the isolated copy's Electron. Its report records both outcomes.

Impact: the app can offer to install a file whose publisher it did not verify. A correct digest protects against a changed download. It does not replace publisher verification if release metadata is compromised. This test does not show a compromise of the current release service.

Smallest recommended fix: make signature verification fail closed. Require successful verification before allowing ready. Preserve the publisher requirement in the signed package's app-update.yml. Test rejection through the public download path when PowerShell is absent, blocked, or returns an error.

### F2. Medium: the automatic usage process writes to the Codex home

**Confirmed side effect and privacy contract gap. Installer distribution blocker while usage starts automatically under the current claims.**

Locations:

- src/adapters/codex-usage.ts:93 inherits the user's environment.
- src/adapters/codex-usage.ts:107 starts codex app-server.
- src/adapters/codex-usage.ts:124 initializes it.
- src/main.ts:346 starts usage polling automatically.
- README.md:71 and README.md:97 make claims about leaving Codex settings or setup unchanged.

Reproduction called the compiled public CodexUsage.read() with installed codex-cli 0.160.0. It used a new Codex home, no credentials, and a model endpoint at 127.0.0.1:1. The account read failed because there was no sign-in. Startup still created state_5.sqlite, logs_2.sqlite, goals, memories, and queue databases, WAL files, an installation ID, temporary files, and built-in skills.

Evidence: .tmp/release-audit/evidence/audit-codex-usage-Tg4sRC/report.json. A separate direct app-server probe produced equivalent writes under .tmp/codex-side-effects-qwMcZf/.

Impact: the app is not wholly a read-only observer of the Codex home. Discovery can select a separately installed CLI version. Its startup can initialize or migrate shared data. Creation of records is verified. Damage to existing records, migration conflicts, token refresh, and credential changes are **not** verified. The synthetic configuration stayed unchanged. No auth.json was created.

Smallest recommended fix: stop automatic shared-home usage startup until its side effects have an accepted design. Gate it behind explicit user opt-in and correct the privacy text. If leaving all Codex records unchanged is a firm requirement, use a read-only service connection rather than starting a runtime in the shared home. Test compatible runtime versions with disposable database copies.

### F3. Medium: stale history overrides newer turn events

**Confirmed reliability defect. Fix before the first user release.**

Locations: src/adapters/codex-desktop.ts:242, src/adapters/codex-desktop.ts:260, and src/core.ts:93.

The reader selects a history status without checking its age or turn identity. Any non-empty history status overrides rollout status. The resolver returns terminal history status before it considers a newer start or notification signal.

Synthetic public monitor checks showed both failures:

1. Append task_complete to a rollout while readable history still says inProgress. The monitor reports working.
2. Leave history at completed, then append task_started and a successful turn/start log entry. The monitor reports idle.

Evidence: .tmp/release-audit/evidence/audit-failures-yTAHml/report.json.

Impact: a finished chat can look active, and an active chat can look finished. The handling of stale records is confirmed. The frequency of this condition in real Codex writes requires verification.

Smallest recommended fix: reconcile history and rollout evidence by current turn and freshness. If the records conflict and freshness cannot be established, show unknown. Test both stale-history cases through the public monitor.

### F4. Medium: one malformed timestamp hides every Codex session

**Confirmed reliability defect. Fix before the first user release.**

Locations: src/adapters/codex-desktop.ts:18, src/adapters/codex-desktop.ts:257, src/shared/time.ts:7, and src/core.ts:27.

parseThread() accepts numeric timestamps without a finite-value check. A non-finite timestamp makes epochMilliseconds() throw inside the session loop. The monitor catches the error at provider level and discards every Codex session.

Reproduction wrote Infinity to one synthetic thread's updated_at through SQLite. Before the change, the monitor returned two Codex sessions and one second-provider session. After the change, only the second provider remained. Codex health was Cannot read session data.

Evidence: .tmp/release-audit/evidence/audit-failures-yTAHml/report.json.

Impact: one bad row removes healthy chats from the panel. This is a local data robustness defect, not a demonstrated remote attack.

Smallest recommended fix: validate finite timestamps at the SQLite row boundary. Keep the affected chat with unavailable time and conservative state, or skip only that row. Preserve valid rows and report the partial read.

### F5. Medium: source license terms are absent

**Confirmed release decision gap. Resolve before presenting the release as open source.**

Locations: repository root, package.json:1, README.md:1, and electron-builder.json:6.

There is no tracked license file, package license field, or README license statement. GitHub also reports no detected license. The app-file allow-list contains no explicit project license file.

Impact: readers have no clear grant for using, changing, or distributing this project. An owner can publish source without an open-source license. This is not a claim that public visibility is prohibited. [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) explains the distinction.

Smallest recommended action: choose and state the intended terms. Include the chosen license in source and distribution contents when it grants public use. Confirm ownership of code and icons. No third-party asset infringement was confirmed.

### F6. Medium: one runtime dependency lacks a license notice

**Confirmed notice gap in the locked dependency. Final distribution compliance requires verification. Installer distribution gate.**

Locations: package-lock.json:3346, electron-builder.json:6, and installed node_modules/lazy-val/ in the isolated copy.

The production dependency closure contains lazy-val 1.0.5. Its metadata says MIT. Its downloaded contents contain no license text or copyright notice. Its README contains only an API example. The other 15 runtime packages have license files. Electron has LICENSE and LICENSES.chromium.html.

Impact: copying dependency folders cannot preserve a notice that the package does not supply. The absence is confirmed. No new signed installer was inspected, so this is not a claim of a confirmed violation in a published artifact.

Smallest recommended action: obtain the correct upstream notice and include it in distribution notices. Confirm its contents and inspect the final installer. Preserve other dependency and Chromium notices. A project license does not replace these notices.

### F7. Low: publication exposes personal metadata and local paths

**Confirmed exposure. Owner consent or sanitization requires verification. Source publication gate.**

Locations:

- Author and committer metadata in all 7 local commits.
- package.json:38 contains an author name.
- VERIFICATION.md:3, :94, :95, :101, :116, :138, :163, :172, :201, :207, :225, :226, :248, and :269 contain local workspace or evidence paths.
- The report paths also occur in historical blobs 053fc9e0d4156773486249a661ed1f046717ebd7, e06ad373ad43d950c52e62a6ac4113b66a8438de, and c923c7a46ef518acf57d35eda3d1fb1b5dad572d.

The commit metadata contains a personal email address. Values are withheld here. Public source and history expose these locations. Removing a value from the current file does not remove it from history.

Smallest recommended action: decide whether this exposure is intended. Sanitize local paths and personal metadata if it is not. Any history change needs a separate authorized task. No history was changed.

The email-shaped entry at package-lock.json:2921 is public upstream deprecation text. That upstream contact also appears in CI logs. It is not a discovered private account address or credential.

## Publication scan methods and results

The scan covered all local reachable commit trees, each distinct file blob, commit messages, author and committer metadata, current tracked files, and historical filenames. Reflog commit IDs were also reachable in scanned history. Git object checks found no additional dangling objects.

Patterns covered private keys, common provider tokens, AWS access key IDs, JWTs, literal credential assignments, bearer literals, credential-bearing URLs, private IP addresses, personal paths, emails, sensitive filenames, chat-record markers, and non-fixture UUIDs. Matches were reported by location and category, without secret values.

- No credential, private key, known token format, credential-bearing URL, or literal bearer value was found.
- No tracked auth file, environment file, private certificate, SQLite record, JSONL transcript, or screenshot was found in history.
- No real chat content was identified. Fixtures and demos use synthetic titles, repeated fixture UUIDs, and sample paths.
- The only binary history files are the PNG and ICO icons. Their printable strings showed no credential or path markers. The SVG and PNG show a simple three-light icon. Ownership still needs publisher confirmation.
- Existing ignored evidence contains 2,903 files, including 182 images and 189 logs. Its text scan found no secret or real-chat markers or non-fixture UUIDs. Synthetic databases and browser profiles are present.
- One older screenshot and five new audit screenshots were visually checked. This was not exhaustive image OCR or browser-profile forensic analysis.
- Pattern scanning and code review cannot prove that arbitrary encoded secrets are absent. History outside the local Git object set was not audited.

Redacted evidence: .tmp/publication-scan.json, .tmp/supplementary-scan.json, and .tmp/evidence-scan.json.

All 4 accessible GitHub workflow runs and their 24 job logs were inspected through read-only APIs. Each run reported zero stored workflow artifacts. The release list was empty. No remote installer, release notes, or release artifact was available. Current-checkout CI is [run 37300688985](https://github.com/ToniEsteso/session-lights/actions/runs/37300688985). No project credential or real chat marker was identified in those logs. Runner paths and a public upstream contact are present.

## App security and data flow

These verified controls do not cancel the findings above.

| Area | Evidence and result |
| --- | --- |
| Windows and bridges | src/main.ts:257, :282, :310 disable Node integration and enable context isolation and sandboxing for all three windows. Preloads expose fixed methods rather than raw Electron objects. |
| App messages | src/main.ts:126, :191, :272, :291 check the expected renderer and its main frame. src/shared/validation.ts:12 and :35 parse fixed commands and finite coordinates. Invalid-input tests passed. |
| Navigation | src/main.ts:268, :286, :315 deny new windows and user navigation. Only packaged local HTML is loaded. No webview was found. |
| Content policy | src/ui/index.html:6, settings.html:6, tooltip.html:5 deny renderer network connections and restrict scripts to local files. No inline or remote script path was found. |
| External text | Titles, projects, paths, errors, and usage labels reach DOM text and attributes. src/ui/renderer.ts:158, :171, :173 and src/ui/tooltip.ts:11 use textContent. No external text-to-code path was found. |
| Chat opening | The renderer supplies a current session key. Main resolves it from its snapshot. src/adapters/codex-desktop.ts:153 accepts only a UUID and creates a fixed codex://threads/ link. The renderer cannot supply an arbitrary URL. A real OS deep-link launch was not tested. |
| Direct provider reads | src/adapters/codex-desktop.ts:57 opens SQLite read-only with a 200 ms busy timeout. File handles use read mode and close in finally. No direct provider-record or auth-file write path was found. F2 covers delegated writes. |
| Data read | State and history databases, project names and roots, rollout headers and the last 512 KiB of rollouts, plus two days of desktop log tails. Tails can contain real message text in memory even though the UI uses metadata. Rollout paths come from local SQLite and are not restricted to one folder. |
| Data stored | Preferences contain expanded state, pins with provider session IDs, screen ID, position, and sort order. Electron creates profile files. The updater stores downloads and cache data. F2 covers Codex child writes. No transcript export or app telemetry path was found. |
| Network | The updater uses the configured public GitHub feed and downloads. The Codex child uses authentication for account limits. Renderer connections are denied. No app code sends titles, paths, or transcript bodies to the update service. Signed-in child traffic and token refresh were not tested. |
| Processes | Codex uses argument arrays and no shell. Windows text scaling uses an absolute system reg.exe path, fixed arguments, and a timeout. Codex stderr is discarded. Requests time out and reconnect. close() kills the immediate child. Stopped and silent fixture-service tests passed. Descendant cleanup after crashes was not verified. |
| Runtime discovery | src/adapters/codex-usage.ts:27 tries desktop, PATH, and npm runtime locations. An explicit override must be absolute. Header checks reject scripts but do not authenticate a publisher. Mac discovery was not run. |
| Updates | Main owns the updater. Download and install require commands. Prereleases, downgrades, and web installers are disabled. Digest and cached-file checks exist in the locked dependency. Windows publisher verification depends on generated metadata and has F1. Signed installation is unverified. |

The interface displays titles and full paths in detail cards. Compact mode is not a screen-sharing privacy mode. This behavior is documented and is not classified as a defect.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) confirms the initialize/initialized handshake and account/rateLimits/read method. It does not establish that process startup leaves the Codex home unchanged.

## Reliability checks

- Missing roots return empty data with a source message. Missing rollouts produce unknown for the affected chat.
- Unavailable or unsupported history databases fall back to rollout records.
- Partial JSONL records and malformed JSON-RPC noise do not stop the existing tested paths.
- Stopped or silent usage processes clear old figures and recover on a later read.
- Usage failures do not stop sessions. Provider exceptions preserve the synthetic second provider.
- An exclusive synthetic state-database lock removed Codex sessions for that read. Releasing the lock restored them on the next read. F4 covers malformed rows.
- A stale running turn becomes unknown after 15 minutes. Passed usage reset times clear old percentages. State is inferred from records, not verified live process state.
- Approval and question detection depends on unofficial logs. Missing, unreadable, or truncated logs reduce detection. One log-file error discards accumulated signals for that read. Live rotation timing was not reproduced.
- Complete tails remain cached and are reparsed each poll. With 100 synthetic 512 KiB records plus two small fixture chats, reads took 155 ms initially, then 69, 64, and 63 ms. RSS was 121 MiB initially and 116 MiB on later reads. These are host measurements, not a general performance limit.

Cost evidence is .tmp/release-audit/evidence/audit-cost-uUy6GM/verified-report.json. The first cost probe had invalid fixture options and is excluded. The corrected probe read 102 sessions. No audit probe opened a live Codex database or credential.

## Dependencies, workflows, and packages

- Lockfile format is 3. Root name, version, and direct dependency pins match package.json. All 351 package entries have license metadata. Registry URLs use HTTPS and have integrity fields.
- npm audit reported zero known vulnerabilities. Deprecation warnings remain. A warning alone does not confirm an exploitable defect. F1 was reproduced despite the zero advisory count.
- The installed production closure has 16 packages. Its license families are MIT, ISC, Python-2.0, and BlueOak-1.0.0. Notice inspection found F6.
- electron-builder.json:6 allow-lists app files and excludes maps. Builder code adds production dependencies and metadata. Tests, evidence, credentials, Git data, and migration reports are outside the app allow-list. This is configuration review, not a new final installer inventory.
- Existing dist folders are older CommonJS portable builds. The latest still uses src/main.cjs and is unsigned. It cannot validate this commit's installer. Electron and Chromium notices are present. No app dependency notice tree is present in that old build.
- Current remote CI passed on Windows, Mac, and Linux with Node 22.12 and 24. Each job ran 22 tests and the migration check. Both Windows jobs passed the package launch test. Mac jobs built only an ad-hoc ARM64 directory with notarization disabled. They did not verify native launch, universal signing, notarization, or update installation.
- .github/workflows/release.yml:13 limits builds to repository read access. Only the draft job has contents write. Current check logs show read permissions, but the check workflow does not set its own cap.
- Release input uses an environment variable rather than shell interpolation. Validation matches a stable v<package version> string. Matrix commands are fixed. Upload follows builds, creates a draft, and refuses to replace a published release.
- Signing values are secret references, not literal credentials. Both platforms' signing secrets go to each active platform job. That increases access unnecessarily, but no leak was verified.
- Actions use major tags rather than immutable commits. This is optional supply-chain hardening, not a confirmed compromise.
- No release run was available. Certificate validity, signer identity, generated Windows publisherName, Mac notarization, and wrong-publisher rejection by a final signed app remain unverified.

## Exact check results

Host: Windows, Node 22.12.0, npm 10.9.0. Commands were read before use. Normal build/test scripts call clean, which deletes build/. That cleanup was not run. The compiler, bundler, and test commands ran directly in the new isolated copy.

| Check | Exact result |
| --- | --- |
| Git status and rev-parse with command-scoped safe.directory | Clean initial checkout; commit recorded above. No global Git setting changed. |
| Git shallow check; rev-list --count --all; fsck --full --no-reflogs | false; 7 commits; fsck exit 0. |
| First npm run check in original checkout | Exit 1. tsc was missing. Direct compiler/build follow-ups could not run. The attempted Node test command collected zero tests; it was not a pass. |
| Approved npm ci in isolated .tmp/release-audit, cache .tmp/audit-install-cache | Exit 0. Added 307 packages; audited 308 installed packages; zero reported vulnerabilities. |
| Isolated npm run check | Exit 0. Both TypeScript configurations passed. |
| Isolated tsc -p tsconfig.json; tsc -p src/ui/tsconfig.json; node build/scripts/build.js | Each exited 0. Current source compiled and bundled without clean. |
| Isolated node --experimental-sqlite --test build/test/*.test.js | Exit 0. 22 passed; 0 failed, cancelled, skipped, or todo. |
| Isolated node build/scripts/audit-migration.js | Exit 0. 44 TypeScript files checked. Browser bundles had no Node imports. Preloads required only Electron. |
| Isolated node --experimental-sqlite build/scripts/desktop-test.js | Exit 1. Panel started; image capture failed with UnknownVizError. Evidence in the copy's evidence/desktop-Iy0ULv/. |
| Desktop smoke code in fresh fixtures, Electron --disable-gpu | Exit 1. Reached text-scale checks. scripts/desktop-smoke.ts:515 expected width 410 and got 411 at 125% text scale. Earlier assertions passed. No final pass report. Evidence in evidence/audit-desktop-software-Ei1uOw/. |
| npm audit --json --ignore-scripts --cache .tmp/npm-audit-cache | Exit 0. Zero advisories across 351 lockfile dependencies. Saved in .tmp/npm-audit.json. |
| Public monitor probes with synthetic malformed, locked, and stale records | Probe execution exit 0. Reproduced F3 and F4. Verified lock recovery and second-provider isolation. |
| Compiled CodexUsage.read(), isolated home, native Codex 0.160.0 | Probe exit 0. Usage unavailable; startup wrote databases and other files. Config unchanged; no auth file created. F2 reproduced. |
| Real updater check/download, unsigned bytes, required publisher | Probe exit 0. Normal PATH rejected; PATH without PowerShell reached ready. F1 reproduced. No install command sent. |
| Corrected polling-cost probe | Exit 0. Read 102 sessions; results recorded above. |
| SHA-256 copy comparison | 71 source files compared; 0 mismatches. |

No repository tests were added. Probes used public reads and actual download outcomes, without mocked verifier results. Probe files, caches, and synthetic data were retained.

## Checks that remain open

These gaps do not prove that an installer fails:

- No current signed installer or published artifact was available for a complete inventory and secret scan. No fresh installer was built.
- test:package was not run locally because local packages are stale. Its remote Windows success applies to the current CI build, which was not retained as a downloadable artifact.
- test:updates -- <installer> was not run because there was no current NSIS installer. The real F1 download probe does not replace the full update suite or signed update verification.
- Fresh install, permissions, upgrade between installed versions, restart, recovery, and uninstall need a disposable Windows user or VM and two signed versions. No system installation or removal was done.
- Mac native behavior, paths, discovery, universal installer, Developer ID signature, notarization, quarantine launch, update restart, and uninstall need a Mac.
- Signed-in account traffic and authentication refresh were not tested. check:usage was not run against the real account. Existing live-account reports were treated as prior claims.
- App code has no direct provider write path. F2 prevents a general conclusion that app use leaves all Codex records and credentials unchanged. Existing-record migrations and credential refresh need isolated compatible data and an accepted design.
- Full image OCR, arbitrary encoded-secret detection, repository data outside local history, and rights provenance were not established.
- The native suite must pass on a supported desktop. Diagnose the one-pixel mismatch before changing code or test tolerance. The evidence does not show harmful layout clipping.

## Optional improvements

These do not replace the release fixes:

- Cap check-workflow permissions explicitly. Pin actions by reviewed commit. Limit signing secrets by platform. Consider a protected signing environment.
- Cache parsed state and bound total tail-cache use. Parse new data where practical. Move expensive work away from Electron main if realistic histories show stalls.
- Prefer absolute trusted executable locations and verify publisher identity where practical. No malicious runtime was found.
- Consider a dedicated local protocol, restrictive permission handlers, and appropriate Electron fuses. No renderer exploit path was confirmed. [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) explains these controls.
- Add a privacy mode if users need to hide titles and paths during screen sharing. Compact detail cards expose them by design.

## Separate release gates

### Publishing the source

1. Resolve F7. Approve intentional personal metadata exposure or sanitize it in a separately authorized task.
2. Resolve F5. State license terms and confirm code and asset rights. A source-visible release can retain rights but must not claim ungranted open-source permissions.
3. Keep evidence, profiles, records, caches, and old packages out of public source. Current ignore rules do this for scanned history. Scan future additions before publication.

No secret requiring rotation was found within the audited scope. This conclusion has the scan limits stated above. Source availability and installer safety are separate decisions. If source is published before the installer defects are fixed, state those defects clearly.

### Distributing installers

1. Fix F1 and prove signature errors reject downloads.
2. Resolve F2's automatic shared-home writes and privacy claims. Verify existing-record and credential behavior.
3. Fix F3 and F4. Run relevant checks and useful regression tests.
4. Resolve F5 and F6 for distribution terms and notices. Inspect final package contents.
5. Verify a signed candidate's identity, publisherName, checksums, unsigned/wrong-publisher rejection, and public feed access without a token.
6. Test fresh install, real upgrade/restart, recovery, and uninstall on disposable Windows. Complete the native suite. Hold Mac installers until equivalent Mac checks pass.

## Actions before publication

- Decide on public metadata, license terms, and asset rights.
- Fix the updater's signature failure path.
- Resolve Codex startup writes and correct privacy claims.
- Fix stale-state selection and malformed-row handling.
- Add the missing dependency notice and inspect signed packages.
- Complete signed install, update, restart, uninstall, and platform checks.


## Remediation after the audit

The user authorized fixes in a worktree, verification, and merge. The user selected MIT. These changes start from the reviewed commit above on branch codex/release-audit-fixes. The original checkout had untracked AUDIT.md and three unrelated worktrees. Those worktrees were left intact. No dependency version, credential, environment file, release, or visibility setting changed. Git history was not rewritten.

### Finding status

| Finding | Status and evidence |
| --- | --- |
| F1 | **Fixed, confirmed.** src/windows-signature.ts:6 uses an absolute system PowerShell path, fixed encoded code, literal paths through environment variables, a timeout, and checked JSON output. Both installed app and download must have valid signatures and the same full publisher subject. src/updates.ts:51 waits for this independent check before ready and repeats it before install. Tool errors fail closed. The locked dependency is unchanged. |
| F2 | **Fixed for default use, confirmed.** src/preferences.ts:6 defaults codexUsageEnabled to false. src/adapters/codex-desktop.ts:157 creates the child only after opt-in and closes it on disable. src/ui/settings.html:14 shows the data and sign-in warning beside the control. Existing preferences with no flag keep usage off. README.md and docs/installation.md state the child side effects. Opt-in does not promise read-only Codex behavior. |
| F3 | **Fixed, confirmed for synthetic records.** src/adapters/codex-desktop.ts:252 reads history turn IDs and rollout turn IDs. A terminal rollout for the same turn clears stale inProgress history. Different or missing IDs with conflicting states show Unknown. Conflicting terminal states also show Unknown, including completion versus failure. A newer successful start signal also prevents stale terminal history from reporting Idle. Matching current records restore Working. Real Codex format and timing changes remain a compatibility limit. |
| F4 | **Fixed, confirmed.** src/adapters/codex-desktop.ts:20 checks finite, non-negative timestamps in the Date range at the SQLite row boundary. It skips an invalid row and reports the partial read. Healthy Codex rows and other providers remain visible. |
| F5 | **License terms fixed, confirmed.** LICENSE contains the user-selected MIT terms. package.json and package-lock.json agree. electron-builder.json includes the license as a resource. Packaged resources were compared with source. Code and icon rights remain an owner verification item. |
| F6 | **Open, requires upstream verification.** THIRD_PARTY_NOTICES.md records the author, declared license, source, and missing notice. It is included in resources. The upstream tree at b69ad4119f1b19bdab13c61ee2fcc88d46b89071 has no license notice. No copyright text was invented. Obtain and include the correct notice before distribution. |
| F7 | **Current paths sanitized; history decision open.** VERIFICATION.md now uses relative project and evidence paths. Existing personal commit metadata and historical blobs remain intact. Local task commits use the authenticated GitHub account's no-reply address. The GitHub-generated merge metadata follows the account settings and contains a personal address; its value is withheld. Public history consent was requested and has not been established. |

Other changes are optional risk reductions: the check workflow has explicit contents: read permission; action revisions are pinned to the verified current v4 commits; signing secrets are split by platform; executable discovery ignores relative PATH entries; and .worktrees/ is ignored. The native size checks allow one pixel of proven Windows DPI rounding while still checking viewport fit and the screen edge.

### Exact local check results

All checks used isolated test homes and profiles. Dependencies came from a full copy of the previously approved locked npm ci install. No further npm install was run. The first package used a dependency junction; electron-builder omitted runtime dependencies, so that artifact was rejected. Rebuilding from the full copy removed those warnings and passed the package launch. Build tools downloaded their own cached packaging components. No installer was executed.

| Command or check | Result |
| --- | --- |
| npm run check | Exit 0. Both TypeScript configurations pass. |
| npm test | Exit 0. 28 passed, 0 failed, 0 skipped on Windows, Node 22.12.0. Includes real Authenticode checks on a signed OS file, a copied path with quote and shell characters, changed bytes, an untrusted publisher, and a missing verifier. |
| node --experimental-sqlite build/scripts/audit-migration.js | Exit 0. 46 TypeScript files; browser bundles have no Node imports; sandbox preloads require only Electron. |
| node --experimental-sqlite build/scripts/desktop-test.js --disable-gpu | Exit 0. 97 listed checks plus usage opt-in, disable, saved consent, warning text, and warning layout assertions. Evidence: evidence/desktop-IFDcc5/. Software rendering was needed for this host's capture limit. |
| npm run pack; then node build/scripts/pack.js after replacing the dependency junction | Exit 0. Final NSIS installer and complete win-unpacked app built. Both executable signatures are NotSigned. Nothing was published. |
| npm run test:package -- dist/win-unpacked | Exit 0. Compiled app files, version, feed, help, license resources, native panel, and tray pass. The disposable Codex home stayed empty after default launch. |
| node build/scripts/update-test.js dist/Session-Lights-0.1.0-x64-Setup.exe | Exit 0. Real NsisUpdater and local HTTP feed: malformed metadata, retry, no automatic download, checksum rejection, concurrent command control, progress, downloaded byte match, unsigned publisher rejection, and unavailable verifier rejection. Evidence: evidence/updates-pSwWDY/. No installation occurred. |
| Exact F1 replay with required publisher | Exit 0. Normal PATH and PATH without PowerShell both ended at download-error. Before the fix, the second case ended at ready. Evidence: evidence/signature-regression-runner/report.json. |
| New regressions against the original compiled source | Exit 1 as expected. All four selected tests failed: stale completion/current turn, legacy conflict, bad timestamp isolation, and default usage consent. The same tests pass with the fixes. Evidence: .tmp/regression-baseline/result.log. |
| npm audit --package-lock-only --json | Exit 0. 0 vulnerabilities; 351 dependencies reported. This does not prove security. |
| git diff --check | Exit 0. |

Final review reproduced and fixed a completion-versus-failure conflict introduced by the first reconciliation change. Its public monitor regression now passes.

Initial verification failures were corrected: a test variable name collision, harmless PowerShell progress on stderr, and an incorrect expectation that extraResources would also appear inside app.asar. PowerShell progress is suppressed; actual stderr and process failures still reject verification. The final checks above supersede those failed attempts.

The final review covered every changed file, affected IPC callers, provider isolation, updater transitions, package contents, and workflow secret scope. One agent did the review. It was not independent review. No additional confirmed merge blocker remained in the code diff. The open release gates below are not claimed as fixed by passing tests.

### Remaining release gates

**Source:** approve existing public-history metadata or authorize a separate history task; confirm code and icon rights. MIT terms are now present. No secret requiring rotation was found in the original scope. Retain its scan limits.

**Installers:** obtain and include the lazy-val notice; verify the signed app and installer, publisherName, public token-free feed, valid signed update acceptance, clean install, real upgrade, restart, recovery, and uninstall on a disposable Windows system. These need signing credentials and two signed versions. Mac native use, universal packaging, notarization, updates, and uninstall need a Mac. No real account check or existing-record migration test was run during remediation.

The independent publisher check deliberately rejects updates when the installed app is unsigned or its publisher subject differs. Certificate renewal with the same subject is intended to work but needs a signed candidate test. A publisher subject change needs a manual install. macOS keeps the dependency's native verification behavior; it remains untested locally.

### Local integration and merge verification

The audit-only commit b53c6fb61d047ed99d6c9b0a3cd22453b0764eb2 was merged through [PR #1](https://github.com/ToniEsteso/session-lights/pull/1). GitHub merge commit: aed80e3f10af5422c731158e4d2113d405674581. All six OS/Node matrix jobs passed for both the push and PR runs. See [PR CI](https://github.com/ToniEsteso/session-lights/actions/runs/37356955712) and [branch CI](https://github.com/ToniEsteso/session-lights/actions/runs/37356889261). Windows built and launched the package. Mac did an ad-hoc unpacked build. This is not signed Mac installation proof.

Local main changed during the task. Six unpublished commits added adapter visibility, session hiding, bookmarks, and Appearance controls. Their final head was 34a1204515bad307c45ae6b4589869eff719e62a. A separate local integration branch preserved those commits. It resolved preference, IPC, Settings, and test overlaps. It retains the shared action queue and makes the warning follow the selected theme. These other commits were not added to the audit PR or pushed.

The combined local source passed npm test: 29 passed, 0 failed, 0 skipped. npm run check passed. The migration audit passed for 48 TypeScript files. The software-rendered desktop check passed 125 listed checks and 6 cold restart checks. Evidence: evidence/desktop-aIzIon/. Coverage includes themes and contrast, visibility and hiding, saved bookmarks, usage consent, and the audit regressions. The optional --verify-system-theme check was not run; it changes Windows settings. No real OS theme setting was changed here.

The first integrated restart assertion counted the new consent checkbox as an adapter switch. Limiting those selectors to input[data-adapter] corrected the check. The EISDIR errors in native logs are deliberate fixture failures that verify recovery from a blocked preference write. The full final native run returned exit 0.

The original untracked audit is preserved under the primary checkout's ignored .tmp folder before local main is updated. The merged report includes the original findings and all remediation limits. Worktrees and test evidence are retained. Release gates above still apply.

The final combined NSIS build and npm run test:package -- dist/win-unpacked both passed, exit 0. The package matches the combined source and leaves its disposable Codex home empty. Merging the remote audit commit into the local integration made no content change. The local integration keeps the other commits unpublished.
