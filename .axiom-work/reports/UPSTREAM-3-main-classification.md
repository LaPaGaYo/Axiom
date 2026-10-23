# UPSTREAM-3 complete full suite on main 4b80a093e8 — classification (verifier, 2026-10-23)

Run: `ORCA_BALANCE_UNIT_SHARDS=1 pnpm test` (`.axiom-work/logs/fullsuite-main-20261023-105544.log`): 13,524 files — 49 failed, 13,355 passed, 120 skipped; 86 failing tests; one unhandled rejection. The 25 `config/scripts/mobile-web-app/**` render suites fail at launch (no Playwright browser build for the merged Playwright on this host; D75) and were not re-run. The other 24 failing files were re-run alone (`main-check-rerun-20261023-105544.log`) and run on pristine `41661e3312` (`upstream-baseline-20261023-111254.log`); `python3 .axiom-work/scripts/upstream3-fullsuite-diff.py` gives the lists below. The unhandled rejection: `runtime.getOrchestrationDb is not a function` from `startAxiomControlPlane` while `src/main/startup/main-process-ready-duplicate-pty-repair.test.ts` ran (its runtime double lacks the method).

## Merge-caused (fail only on the candidate)

### `bun src/renderer/src/components/skills/SkillFreshnessNudge.test.tsx` — 9

- SkillFreshnessNudge > counts only Orca-owned outdated skills
  - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- SkillFreshnessNudge > does not repeat the same nudge within a session
  - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- SkillFreshnessNudge > keeps a project copy out of the dismissal key it persists
  - `AssertionError: expected "vi.fn()" to be called with arguments: [ { …(1) } ]`
- SkillFreshnessNudge > lingers without an auto-close timer or auto-close dismissal write
  - `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`
- SkillFreshnessNudge > opens the update dialog on action click without persisting a dismissal
  - `TypeError: undefined is not an object (evaluating 'options.action')`
- SkillFreshnessNudge > persists the exact placement/revision key once on explicit dismissal
  - `TypeError: undefined is not an object (evaluating 'options.onDismiss')`
- SkillFreshnessNudge > retracts a resolved nudge without recording a dismissal
  - `TypeError: undefined is not an object (evaluating 'options.onDismiss')`
- SkillFreshnessNudge > retracts a stale nudge when re-inventory fails
  - `TypeError: undefined is not an object (evaluating 'options.onDismiss')`
- SkillFreshnessNudge > retracts an active local nudge when runtime freshness becomes unavailable
  - `TypeError: undefined is not an object (evaluating 'options.onDismiss')`

### `bun src/main/ipc/feedback-request-ownership.test.ts` — 7

- feedback request ownership > keeps the request live until the image response reader finishes
  - `Error: Test timed out in 30000ms.`
- feedback request ownership > preserves the response reader error when retiring its request
  - `AssertionError: expected Error: Feedback submission is disabled. to be Error: response reader failure // Object.is equality`
- feedback request ownership > retires a rejected image response without replaying the attachments
  - `AssertionError: expected { ok: false, status: null, …(2) } to deeply equal { ok: false, status: 503, …(1) }`
- feedback request ownership > retires an unread response after successful text submission
  - `AssertionError: expected { ok: false, status: null, …(2) } to deeply equal { ok: true }`
- feedback request ownership > retires both failed text attempts while preserving the retry result
  - `AssertionError: expected { ok: false, status: null, …(2) } to deeply equal { ok: false, status: 503, …(1) }`
- feedback request ownership > retires diagnostic and report-only requests after an attachment fallback
  - `AssertionError: expected { ok: false, status: null, …(2) } to deeply equal { ok: true, …(1) }`
- feedback request ownership > retires failed network attempts without turning them into deadline errors
  - `AssertionError: expected { ok: false, status: null, …(2) } to deeply equal { ok: false, status: null, …(1) }`

### `bun src/main/runtime/structured-session-child-env.test.ts` — 7

- sealStructuredSessionChild identity > gives an ordinary chat session its own id and this app's CLI, and no terminal identity
  - `AssertionError: expected { …(10) } to deeply equal { …(10) }`
- sealStructuredSessionChild identity > reaches this app's CLI as a chat > on packaged Linux, through the bare-orca shim, named by absolute path
- sealStructuredSessionChild identity > reaches this app's CLI as a chat > on packaged Windows, through the bundled CLI dir under the env block spelling
- sealStructuredSessionChild identity > reaches this app's CLI as a chat > on packaged macOS, through the bundled CLI dir
- sealStructuredSessionChild identity > reaches this app's CLI as a worker > on packaged Linux, through the bare-orca shim, named by absolute path
  - `AssertionError: expected '/data/orca/linux-orca-cli-shim/orca' to be '/data/orca/linux-orca-cli-shim/axiom' // Object.is equality`
- sealStructuredSessionChild identity > reaches this app's CLI as a worker > on packaged Windows, through the bundled CLI dir under the env block spelling
  - `AssertionError: expected '/app/Resources/bin/axiom.exe' to be '/app/Resources/bin/orca.exe' // Object.is equality`
- sealStructuredSessionChild identity > reaches this app's CLI as a worker > on packaged macOS, through the bundled CLI dir
  - `AssertionError: expected '/app/Resources/bin/axiom' to be '/app/Resources/bin/orca' // Object.is equality`

### `bun src/renderer/src/lib/browser-cookie-import-toast.test.ts` — 7

- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":-1,"preservedRelatedCookies":3}
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":0,"preservedRelatedCookies":2}
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":1,"preservedRelatedCookies":2}
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":1,"preservedRelatedCookies":null}
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":1.5,"preservedRelatedCookies":0.5}
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":9007199254740992,"preservedRelatedCookies":0}
  - `AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]`
- emitBrowserCookieImportToast > uses the existing warning for invalid breakdown counts: {"unreadableCookies":null,"preservedRelatedCookies":1}

### `bun src/main/tray/system-tray.test.ts` — 3

- language changes > refreshes the attention tooltip and replacements in the active language catalog
  - `AssertionError: expected last "vi.fn()" call to have been called with [ Array(1) ]`
- language changes > refreshes the existing darwin menu and keeps its actions
- language changes > refreshes the existing win32 menu and keeps its actions
  - `AssertionError: expected 'Axiom を開く' to be 'Orca を開く' // Object.is equality`

### `bun src/renderer/src/components/mobile/MobilePage.test.tsx` — 3

- MobilePage pairing connection mode > does not mint on address change while signed out with Anywhere selected
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`
- MobilePage pairing connection mode > does not remint when switching from Local to Anywhere while signed out
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`
- MobilePage pairing connection mode > mints a Relay QR when signing in with Anywhere selected
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`

### `bun src/renderer/src/components/sidebar/WorktreeOpenInMenu.test.tsx` — 3

- WorktreeOpenInMenu > a workspace on a server Orca reaches through an SSH host > keeps a server workspace with no SSH host local-only, saying why
  - `AssertionError: expected { disabled: true, …(2) } to deeply equal { disabled: true, …(2) }`
- WorktreeOpenInMenu > marks a managed owner local-only in the menu with a locally focused desktop
  - `AssertionError: expected { disabled: true, …(2) } to deeply equal { disabled: true, …(2) }`
- WorktreeOpenInMenu > marks an unresolved owner local-only and never launches the desktop copy
  - `AssertionError: expected { disabled: true, …(2) } to deeply equal { disabled: true, …(2) }`

### `bun src/main/cli/cli-command-privileged-transaction.test.ts` — 2

- macOS privileged CLI command transaction > refuses an unreadable symlink that is not an Orca launcher once root makes it readable
  - `AssertionError: expected [Function] to throw error matching /Refusing to replace non-Orca command/ but got 'Refusing to replace non-Axiom command…'`
- macOS privileged CLI command transaction > repairs an unreadable link to an older Orca launcher through the transaction
  - `Error: Refusing to replace non-Axiom command at /var/folders/71/dmf5g_3n6dz5jyfqcn85_rhm0000gn/T/orca-cli-privileged-transaction-aWB2Vk/protected/orca. Remove it and register again if it is no longer `

### `bun src/main/shell-wrapper-generated-file-snapshot.test.ts` — 2

- generated shell wrapper files > daemon wrappers
  - `Error: Snapshot `generated shell wrapper files > daemon wrappers 1` mismatched`
- generated shell wrapper files > local PTY wrappers
  - `Error: Snapshot `generated shell wrapper files > local PTY wrappers 1` mismatched`

### `bun src/main/updater-agent-state-rules-release.test.ts` — 2

- agent state rules releases and the app updater > leave the RC prerelease feed resolving to the same app tag
  - `AssertionError: expected null to be 'v1.4.3-rc.1' // Object.is equality`
- agent state rules releases and the app updater > leave the stable check resolving to the same app tag
  - `AssertionError: expected null to be 'v1.4.2' // Object.is equality`

### `bun src/renderer/src/components/skills/SkillFreshnessStatusPill.test.tsx` — 2

- SkillFreshnessStatusPill > opens the freshness review dialog from Details
  - `AssertionError: expected false to be true // Object.is equality`
- SkillFreshnessStatusPill > shows Update available for an eligible outdated skill
  - `AssertionError: expected 'Installed' to be 'Update available' // Object.is equality`

### `bun tests/tools/win-update-e2e/app-driver.test.mjs` — 2

- dismissOverlays > dismisses Let agents drive Axiom with the Axiom CLI without clicking the desktop window Close button
  - `AssertionError: expected "vi.fn()" to be called once, but got 0 times`
- dismissOverlays > dismisses Let agents drive Axiom with the Axiom CLI without sending Escape into an already-restored terminal
  - `AssertionError: expected "vi.fn()" to be called once, but got 0 times`

### `bun src/main/menu/register-app-menu.test.ts` — 1

- registerAppMenu > keeps the native quit role unless the host supplies a quit handler (darwin, #15537)
  - `AssertionError: expected 'Quit Orca' to be 'Quit Axiom' // Object.is equality`

### `bun src/renderer/src/components/cmd-j/palette-results.test.ts` — 1

- Cmd+J palette middle-band ranking > ranks orca cli first
  - `AssertionError: expected undefined to be 'settings:general:cli' // Object.is equality`

### `bun src/renderer/src/lib/skill-freshness-display-status.test.ts` — 1

- getSkillFreshnessDisplayStatus > shows update available when the inventory authorizes an update
  - `AssertionError: expected 'installed' to be 'update-available' // Object.is equality`

## Environmental (fail identically on pristine upstream on this host)

### `bun config/scripts/pr-auxiliary-preflight-admission.test.mjs` — 8

- Daemon mock complete Git change evidence > keeps platform packages for an actual addition
- Daemon mock complete Git change evidence > keeps platform packages for an actual deletion
- Daemon mock complete Git change evidence > keeps platform packages for an actual rename
- Daemon mock complete Git change evidence > keeps platform packages for an actual type change
- Mobile CI complete Git change evidence > retains full root units for an actual addition
- Mobile CI complete Git change evidence > retains full root units for an actual deletion
- Mobile CI complete Git change evidence > retains full root units for an actual rename
- Mobile CI complete Git change evidence > retains full root units for an actual type change

### `node-runtime config/scripts/process-host-dev-rebuild.test.ts` — 6

- External process-host development rebuilds > emits private source edits and new imports before the Electron reload hook
- External process-host development rebuilds > rebuilds when an explicitly imported excluded source is created or edited
- External process-host development rebuilds > rebuilds when an inherited compiler configuration changes
- External process-host development rebuilds > recompiles when a nested package manifest is created or removed
- External process-host development rebuilds > recovers when a missing import is created in a new source directory
- External process-host development rebuilds > reports a failed compilation, preserves prior output, and recovers after a fix

### `bun config/scripts/ci-managed-ssh-execution.test.mjs` — 5

- managed SSH workflow command > keeps compatibility with legacy checkout refs
- managed SSH workflow command > keeps compatibility with missing checkout refs
- managed SSH workflow command > keeps full daily and explicit suite execution for
- managed SSH workflow command > keeps full daily and explicit suite execution for ["tests/e2e/ssh-orcad-","tests/e2e/ssh-orcad-open-in-owner.spec.ts"]
- managed SSH workflow command > passes only the selected SSH files to Playwright, with literal file matching

### `bun src/main/orcad/orcad-forked-child-paths.test.ts` — 4

- orcad forked-child paths > forks the session scanner child shipped beside orcad.js
- orcad forked-child paths > forks the watcher child shipped beside orcad.js
- orcad forked-child paths > ignores a decoy child under the working directory
- orcad forked-child paths > reports the install root and the Node binary, not the data directory

### `bun src/main/daemon/bash-prompt-command-composition.test.ts` — 3

- daemon bash PROMPT_COMMAND composition > composes an inherited hook with nounset enabled
- daemon bash PROMPT_COMMAND composition > composes an unset PROMPT_COMMAND with nounset enabled
- daemon bash PROMPT_COMMAND composition > keeps lifecycle when RANDOM is unset under nounset

### `node-runtime src/main/runtime/orca-runtime.test.ts` — 2

- OrcaRuntimeService > keeps existing-folder imports split by runtime host on the same normalized path
- OrcaRuntimeService > sets up an existing folder on a fresh runtime after importing the repo project

### `bun config/scripts/dependency-security-release.test.mjs` — 1

- extracts release data while excluding executable package and Cargo configuration

### `bun src/main/cli/packaged-cli-assets.test.ts` — 1

- packaged CLI assets > sanitizes node env and forwards argv verbatim through the macOS launcher

### `bun src/main/ipc/pty-pane-materialization-race.test.ts` — 1

- registerPtyHandlers > reuses renderer spawn when runtime materialization starts for the same pane

