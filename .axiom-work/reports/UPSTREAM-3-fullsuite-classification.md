# UPSTREAM-3 full-suite classification (verifier, 2026-10-23)

Candidate: `axiom/attempt/UPSTREAM-3/4` @ `166514d016`. Full suite (`.axiom-work/logs/fullsuite-UPSTREAM-3-4-20261022-230902.log`): 82 failing files / 225 failing tests.

How the failures were split:

1. The 75 failing files other than the cross-version-wire harness were re-run alone on the candidate (`.axiom-work/logs/fullsuite-rerun-20261022-234409.log`): all 75 fail again, 214 failing tests (212 distinct names).
2. The same 75 files were run on a pristine upstream checkout of `41661e3312` on the same host (`launchers/upstream-baseline.command`; clone at `/tmp/axsm/upstream-baseline-41661e3312`; `.axiom-work/logs/upstream-baseline-20261023-000314.log`): 74 files exist upstream (`src/main/startup/main-process-ready-runtime-activation.test.ts` is Axiom's), 13 fail, 50 failing tests.
3. `python3 .axiom-work/scripts/upstream3-fullsuite-diff.py <rerun.log> <baseline.log>`: every baseline failure also fails on the candidate (0 baseline-only). **50 environmental, 162 merge-caused.**

Not in either list:

- `tests/e2e/cross-version-wire/*.unit.test.ts` (6 files) and the run-ending unhandled `DevalueError` from `tests/e2e/.cross-version-checkouts/`: the harness resolves upstream release tags (`v1.4.218`–`v1.4.220`) that this checkout does not have, because Axiom fetches upstream with `--no-tags`; the same files fail on main. Environmental by policy.
- `config/scripts/mobile-web-app/mobile-web-app-drawer-render.test.mjs` (3 tests): needs a Playwright browser build the host does not have for the merged Playwright version. Environmental; D75 (mobile dormant).

Two files mix both kinds: `src/main/runtime/orca-runtime.test.ts` (2 environmental — `/var` vs `/private/var` — and 1 merge-caused) and `src/main/zsh-deferred-startup-line-init.live-shell.test.ts` (1 environmental, 14 merge-caused).

## Merge-caused (fail only on the candidate)

### `bun src/main/ipc/pty-launch-parity.test.ts` — 31

- window lane: pty:spawn request -> provider > row 1: dashboard "+", Linux repo
- window lane: pty:spawn request -> provider > row 1: menu "+", macOS repo
- window lane: pty:spawn request -> provider > row 1: shortcut "+", Windows C: repo, d…
- window lane: pty:spawn request -> provider > row 2: Windows C: folder
- window lane: pty:spawn request -> provider > row 2: Windows C: repo, cmd.exe
- window lane: pty:spawn request -> provider > row 2: Windows C: repo, default PowerSh…
- window lane: pty:spawn request -> provider > row 2: Windows C: repo, global default …
- window lane: pty:spawn request -> provider > row 2: Windows C: repo, project WSL
- window lane: pty:spawn request -> provider > row 2: Windows folder containing a WSL-…
- window lane: pty:spawn request -> provider > row 2: Windows wsl$ folder
- window lane: pty:spawn request -> provider > row 2: Windows wsl$ repo, no saved runt…
- window lane: pty:spawn request -> provider > row 2: macOS folder
- window lane: pty:spawn request -> provider > row 2: macOS repo, codex auto-submit wa…
- window lane: pty:spawn request -> provider > row 2: macOS repo, saved default env
- window lane: pty:spawn request -> provider > row 2: macOS repo, terminal continuatio…
- window lane: pty:spawn request -> provider > row 5: Linux repo, codex
  - `TypeError: store.updateSettings is not a function. (In 'store.updateSettings({ providerActivations: {`
- window lane: pty:spawn request -> provider > row 5: Windows C: repo, default PowerSh…
- window lane: pty:spawn request -> provider > row 5: Windows wsl$ repo, no saved runt…
- window lane: pty:spawn request -> provider > row 5: macOS repo
- window lane: pty:spawn request -> provider > row 6: continue, Windows C: repo, cmd.e…
- window lane: pty:spawn request -> provider > row 6: continue, Windows wsl$ WSL-proje…
- window lane: pty:spawn request -> provider > row 6: continue, macOS repo, no transcr…
- window lane: pty:spawn request -> provider > row 6: continue, macOS repo, transcript…
- window lane: pty:spawn request -> provider > row 8: folder composer, Windows C: fold…
- window lane: pty:spawn request -> provider > row 8: folder composer, long multi-line…
- window lane: pty:spawn request -> provider > row 8: folder composer, macOS folder, n…
- window lane: pty:spawn request -> provider > row 8: work item, Windows C: repo, cmd.…
- window lane: pty:spawn request -> provider > row 8: work item, Windows C: repo, proj…
- window lane: pty:spawn request -> provider > row 8: work item, Windows C: repo, term…
- window lane: pty:spawn request -> provider > row 8: work item, macOS repo, draft rid…
- window lane: pty:spawn request -> provider > row 8: work item, submit after ready

### `node-runtime src/main/zsh-deferred-startup-line-init.live-shell.test.ts` — 14

- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a chained-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a history pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a repeat-history pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a repeat-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a replaced-precmd-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a scheduled-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a status-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a sticky-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a stock-chained-redraw pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a stock-history pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a stock-nonzero-precmd pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a stock-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`
- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a unavailable-startup pane
  - `AssertionError: expected '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' to be '/var/folders/71/dmf5g_3n6dz5jyfqcn85_…' // Object.is equality`

### `bun src/main/runtime/structured-chat-coordinator-mail.test.ts` — 13

- a /clear keeps the chat its orchestration address > delivers the conversation's Run to its fresh context under the same address
  - `AssertionError: expected '[{"type":"text","text":"You have 1 or…' to match /You have 1 orchestration message\. Ru…/`
- a /clear keeps the chat its orchestration address > points mail the earlier context never took at the fresh context, without a user message
  - `AssertionError: expected '[{"type":"text","text":"You have 1 or…' to match /You have 1 orchestration message\. Ru…/`
- a worker result reaches the structured chat that coordinates it > does not restart a provider that crashed while taking the pointer turn (exit-then-throw)
- a worker result reaches the structured chat that coordinates it > does not restart a provider that crashed while taking the pointer turn (throw-then-exit)
  - `AssertionError: expected [] to have a length of 1 but got +0`
- a worker result reaches the structured chat that coordinates it > holds mail after a start refused as an account switch in progress until a turn runs, adding nothing on later edges
  - `AssertionError: expected [] to have a length of 1 but got +0`
- a worker result reaches the structured chat that coordinates it > holds mail after a start refused as one the person must fix until a turn runs, adding nothing on later edges
- a worker result reaches the structured chat that coordinates it > keeps a pointer whose provider died before the echo, and points it after the next turn that runs
  - `AssertionError: expected '[{"type":"text","text":"You have 1 or…' to match /You have 1 orchestration message\. Ru…/`
- a worker result reaches the structured chat that coordinates it > lands as a turn in the coordinator journal, and a flagless check returns the worker_done
  - `AssertionError: expected [ Array(1) ] to deeply equal [ StringMatching{…} ]`
- a worker result reaches the structured chat that coordinates it > leaves a pointer the person stopped while its agent was starting stopped
  - `AssertionError: expected [] to have a length of 1 but got +0`
- a worker result reaches the structured chat that coordinates it > points a coordinator whose agent is not running through the send alone, which starts it
  - `AssertionError: expected '[{"type":"text","text":"You have 1 or…' to match /You have 1 orchestration message\. Ru…/`
- a worker result reaches the structured chat that coordinates it > points a held pointer once more after Orca restarts, under a new id
  - `AssertionError: expected [] to have a length of 2 but got +0`
- a worker result reaches the structured chat that coordinates it > points again under a new id once a send the host never recorded is too old to admit
  - `AssertionError: expected [] to have a length of 1 but got +0`
- a worker result reaches the structured chat that coordinates it > points held mail after the next turn that runs, even once a rewind dropped its send
  - `AssertionError: expected 'You have 1 orchestration message. Run…' to match /You have 1 orchestration message\. Ru…/`

### `node-runtime src/main/persistence/profile-state/profile-state-offline-settings.test.ts` — 6

- offline settings json updates > preserves raw Portuguese marker "true" before normal load
- offline settings json updates > preserves raw Portuguese marker false before normal load
- offline settings json updates > preserves raw Portuguese marker undefined before normal load
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`
- offline settings sqlite updates > preserves raw Portuguese marker "true" before normal load
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`
- offline settings sqlite updates > preserves raw Portuguese marker false before normal load
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`
- offline settings sqlite updates > preserves raw Portuguese marker undefined before normal load
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`

### `bun src/main/startup/codex-account-restart-resume.test.ts` — 5

- keeps ordinary automatic restores pinned to their original account
  - `TypeError: store.updateSettings is not a function. (In 'store.updateSettings({ providerActivations: {`
- materializes a rollout when the account bridge has not caught up
  - `TypeError: store.updateSettings is not a function. (In 'store.updateSettings({ providerActivations: {`
- refuses a conflicting target rollout instead of restarting the old account
  - `AssertionError: expected [Function] to throw error including 'different rollout' but got 'store.updateSettings is not a functio…'`
- resumes an explicit account restart in the selected home using the bridged transcript
  - `TypeError: store.updateSettings is not a function. (In 'store.updateSettings({ providerActivations: {`
- uses the system home when an explicit restart follows deselection
  - `TypeError: store.updateSettings is not a function. (In 'store.updateSettings({ providerActivations: {`

### `bun src/main/cli/appimage-copy-pre-extraction.test.ts` — 4

- preExtractDownloadedAppImageUpdate > unpacks the download into the copy its install will run from
  - `AssertionError: expected false to be true // Object.is equality`
- startAppImageCopyPreExtraction > drops idle copies of earlier releases once this one has its copy
  - `AssertionError: expected false to be true // Object.is equality`
- startAppImageCopyPreExtraction > stops waiting at the bound while the copy is still unpacking
  - `AssertionError: expected false to be true // Object.is equality`
- startAppImageCopyPreExtraction > unpacks a missing copy in the background without taking the CLI launcher
  - `AssertionError: expected false to be true // Object.is equality`

### `bun src/main/codex/codex-hook-reconcile.test.ts` — 4

- a ~/.codex/hooks.json Orca cannot add to > is left byte-for-byte and named as the reason for a hooks value that is not an object, until it is fixed
  - `AssertionError: expected 'Axiom cannot add its hook to /private…' to be 'Orca cannot add its hook to /private/…' // Object.is equality`
- a ~/.codex/hooks.json Orca cannot add to > is left byte-for-byte and named as the reason for an event that is not a list, until it is fixed
  - `AssertionError: expected 'Axiom cannot add its hook to /private…' to be 'Orca cannot add its hook to /private/…' // Object.is equality`
- a ~/.codex/hooks.json Orca cannot add to > is left byte-for-byte and named as the reason for an unparseable file, until it is fixed
  - `AssertionError: expected 'Axiom cannot add its hook to /private…' to be 'Orca cannot add its hook to /private/…' // Object.is equality`
- a ~/.codex/hooks.json Orca cannot add to > is left byte-for-byte and named as the reason for unknown top-level fields, until it is fixed
  - `AssertionError: expected 'Axiom cannot add its hook to /private…' to be 'Orca cannot add its hook to /private/…' // Object.is equality`

### `bun src/main/orcad/orcad-duplicate-pty-repair-startup.test.ts` — 4

- leaves the stored panes alone when the build keeps the window as layout owner
- repairs a stored duplicate-terminal pane at orcad startup, moving owners before the write
- still starts serving when showing live terminals fails at startup
  - `TypeError: runtime.getOrchestrationDb is not a function. (In 'runtime.getOrchestrationDb()', 'runtime.getOrchestrationDb' is undefined)`
- writes the repair before reconcile and RPC even when a profile write is in flight

### `bun src/renderer/src/components/terminal-pane/TerminalErrorToast.test.ts` — 4

- TerminalErrorToast folder workspace path errors > does not ask the user to file an issue for a folder they can fix
  - `AssertionError: expected 'Error invoking remote method \'pty:sp…' to contain 'Orca cannot find /Users/me/ara_company'`
- TerminalErrorToast folder workspace path errors > humanizes the ambiguous-connection code thrown without a path
  - `AssertionError: expected 'Axiom cannot tell which SSH connectio…' to contain 'Orca cannot tell which SSH connection…'`
- TerminalErrorToast folder workspace path errors > keeps the issue link when an unrelated error shares the toast
  - `AssertionError: expected 'Error invoking remote method \'pty:sp…' to contain 'Orca cannot find /Users/me/ara_company'`
- TerminalErrorToast folder workspace path errors > replaces the raw missing-folder code with actionable copy
  - `AssertionError: expected 'Error invoking remote method \'pty:sp…' to be 'Error invoking remote method \'pty:sp…' // Object.is equality`

### `node-runtime src/cli/handlers/terminal.test.ts` — 4

- terminal close CLI > describes the server-selection flags in terminal create help
  - `AssertionError: expected 'axiom terminal create\n\nUsage: axiom…' to match /--pairing-code <code> .*orca:\/\/pair/\`
- terminal close CLI > describes the server-selection flags in terminal read help
  - `AssertionError: expected 'axiom terminal read\n\nUsage: axiom t…' to match /--pairing-code <code> .*orca:\/\/pair/\`
- terminal close CLI > describes the server-selection flags in terminal send help
  - `AssertionError: expected 'axiom terminal send\n\nUsage: axiom t…' to match /--pairing-code <code> .*orca:\/\/pair/\`
- terminal close CLI > describes the server-selection flags in terminal wait help
  - `AssertionError: expected 'axiom terminal wait\n\nUsage: axiom t…' to match /--pairing-code <code> .*orca:\/\/pair/\`

### `bun src/main/codex/codex-hook-real-home-status.test.ts` — 3

- Codex hook status for ~/.codex > reports on ~/.codex, and says why there is no status, for an event that is not a list
  - `AssertionError: expected { Object (agent, state, ...) } to deeply equal { Object (agent, state, ...) }`
- Codex hook status for ~/.codex > reports on ~/.codex, and says why there is no status, for an unparseable file
  - `AssertionError: expected { Object (agent, state, ...) } to deeply equal { Object (agent, state, ...) }`
- Codex hook status for ~/.codex > reports on ~/.codex, and says why there is no status, for unknown top-level fields
  - `AssertionError: expected { Object (agent, state, ...) } to deeply equal { Object (agent, state, ...) }`

### `bun src/renderer/src/components/mobile/MobilePage.test.tsx` — 3

- MobilePage pairing connection mode > does not mint on address change while signed out with Anywhere selected
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`
- MobilePage pairing connection mode > does not remint when switching from Local to Anywhere while signed out
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`
- MobilePage pairing connection mode > mints a Relay QR when signing in with Anywhere selected
  - `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Axiom Relay"`

### `bun src/renderer/src/components/settings/SshHostRestartServerAction.test.tsx` — 3

- Restart Axiom’s server > confirms first, then restarts and refreshes
  - `TypeError: undefined is not an object (evaluating 'button(container, "Restart Axiom’s server…").click')`
- Restart Axiom’s server > says why main kept the server running: { outcome: 'not-restarted', …(1) }
  - `TypeError: undefined is not an object (evaluating 'button(container, "Restart Axiom’s server…").click')`
- Restart Axiom’s server > says why main kept the server running: { outcome: 'terminals-running', …(1) }

### `node-runtime src/cli/orchestration-mutation-recovery.test.ts` — 3

- orchestration mutation recovery > offers a read-only request lookup when the response carried no dispatch
  - `AssertionError: expected 'Run orca orchestration request-show -…' to be 'Run axiom orchestration request-show …' // Object.is equality`
- orchestration mutation recovery > queries a known dispatch before issuing the keyed retry
  - `AssertionError: expected -1 to be less than -1`
- orchestration mutation recovery > shell-quotes a configured Windows executable when resolving portable recovery commands
  - `AssertionError: expected 'axiom orchestration worker-show --dis…' to be '"C:\Program Files\Axiom\orca-ide.cmd"…' // Object.is equality`

### `node-runtime src/main/orca-profiles/profile-project-domain-transfer.test.ts` — 3

- profile domain transfers > preserves raw Portuguese marker "true" in both inactive move participants
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`
- profile domain transfers > preserves raw Portuguese marker false in both inactive move participants
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`
- profile domain transfers > preserves raw Portuguese marker undefined in both inactive move participants
  - `AssertionError: expected { …(218) } to match object { uiLanguage: 'pt', …(1) }`

### `bun src/main/cli/appimage-serve-preparation.test.ts` — 2

- prepareAppImageCopyForServe > reports progress while unpacking and when it is done
  - `AssertionError: expected 'unavailable' to be 'ready' // Object.is equality`
- prepareAppImageCopyForServe > returns at once, silently, when the copy already exists
  - `AssertionError: expected 'unavailable' to be 'ready' // Object.is equality`

### `bun src/main/rate-limits/service-refresh-orchestration.test.ts` — 2

- RateLimitService > does not refetch fresh provider data for replayed mobile subscriptions
  - `AssertionError: expected "vi.fn()" to be called once, but got 2 times`
- RateLimitService > labels a kept stale snapshot with only the latest failure kind
  - `AssertionError: expected undefined to be 'network' // Object.is equality`

### `bun src/main/skills/skill-freshness-inventory.test.ts` — 2

- read-only skill freshness inventory > an Orca-owned copy of another version reads outdated and eligible (#26841) > with bytes from a version no release list knows
  - `AssertionError: expected 'installed' to be 'update-available' // Object.is equality`
- read-only skill freshness inventory > reads an older official copy as outdated and offers it
  - `AssertionError: expected 'installed' to be 'update-available' // Object.is equality`

### `bun src/main/startup/main-process-ready-runtime-activation.test.ts` — 2

- startup hook provider activation > reconciles Codex only with profile activation=false while retaining other installers
- startup hook provider activation > reconciles Codex only with profile activation=true while retaining other installers
  - `TypeError: store.getProfileStorageDirectory is not a function. (In 'store.getProfileStorageDirectory()', 'store.getProfileStorageDirectory' is undefined)`

### `bun src/renderer/src/components/editor/useIpynbCellExecution.test.tsx` — 2

- notebook cell execution > refuses to run with rows that have not loaded instead of reading them as local
- notebook cell execution > refuses to run with two hosts publishing the same workspace instead of reading them as local
  - `AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]`

### `node-runtime src/cli/handlers/account.test.ts` — 2

- account CLI handlers > refuses claude login before spawning when its capability is absent
- account CLI handlers > refuses codex login before spawning when its capability is absent
  - `AssertionError: expected [Function] to throw error including 'The running Orca runtime is too old t…' but got 'The running Axiom runtime is too old …'`

### `node-runtime src/main/native-chat/agent-session-journal/journal-payload-bounds-retention.test.ts` — 2

- journal payload allocation bounds > matches the previous byte bounds for mixed Unicode and surrogate boundaries
  - `AssertionError: expected { …(2) } to deeply equal { bounded: { …(4) }, …(1) }`
- journal payload allocation bounds > preserves UTF-8 clipping, replacement characters, metadata and exotic byte limits
  - `AssertionError: expected { …(2) } to deeply equal { bounded: { head: '', …(3) }, …(1) }`

### `node-runtime src/main/orca-profiles/profile-cloud-auth-characterization.test.ts` — 2

- cloud auth characterization > artifact and skill cloud auth > retries an operation once with a refreshed token after a 401
  - `AssertionError: expected { status: 'unconfigured', …(1) } to deeply equal { status: 'ok', value: 'done' }`
- cloud auth characterization > artifact and skill cloud auth > surfaces a non-auth operation failure without touching the session
  - `AssertionError: promise resolved "{ status: 'unconfigured', …(1) }" instead of rejecting`

### `node-runtime src/main/runtime/orchestration/agent-facing-parity.test.ts` — 2

- a chat agent and a terminal agent see the same text but for how each is named and called > renders the pointer the PTY lane types into a local terminal, in a dev build
  - `AssertionError: expected 'axiom-dev' to be 'orca-dev' // Object.is equality`
- a chat agent and a terminal agent see the same text but for how each is named and called > renders the pointer the PTY lane types into a local terminal, in a packaged app
  - `AssertionError: expected 'axiom' to be 'orca' // Object.is equality`

### `bun src/main/claude/claude-structured-launch-resolution.test.ts` — 1

- claude structured launch resolution > names the child by the Orca session id, over any id the configured overlay carries
  - `AssertionError: expected { …(77) } to match object { …(2) }`

### `bun src/main/codex/codex-structured-session-adapter.test.ts` — 1

- CodexStructuredSessionAdapter.acquire > opens the thread with the chat identity every command must keep
  - `AssertionError: expected { method: 'thread/start', …(1) } to deeply equal { method: 'thread/start', …(1) }`

### `bun src/main/codex/codex-structured-session-prompts.test.ts` — 1

- CodexStructuredSessionAdapter prompts > responds with an error when a prompt cannot be admitted to the journal sink
  - `AssertionError: expected [ { id: 11, code: -32001, …(1) } ] to deeply equal [ { id: 11, code: -32001, …(1) } ]`

### `bun src/main/git/saved-clone-target.test.ts` — 1

- reuseSavedCloneTarget > refuses a finished clone of a different URL with the same folder name
  - `AssertionError: expected [Function] to throw error including '"orca" is already an Orca project' but got '"orca" is already an Axiom project at…'`

### `bun src/main/ipc/repos-local-clone-lifecycle.test.ts` — 1

- repos:add + repos:clone > a saved project already at the clone path > refuses, naming the project, when the saved project was a different repo
  - `AssertionError: expected [Function] to throw error including '"orca" is already an Orca project' but got '"orca" is already an Axiom project at…'`

### `bun src/main/managed-server/lifecycle/orcad-managed-update-decision.test.ts` — 1

- the three update intents > keeps a newer host on Update, and lifts it only on Force
  - `AssertionError: expected 'Axiom 2.0.0 last ran this host\'s ser…' to match /Orca 2\.0\.0 last ran/`

### `bun src/main/managed-server/lifecycle/orcad-runtime-deployment.test.ts` — 1

- createManagedOrcadEnvironment > admitting a host another desktop stopped, under the fence > refuses an older build on a host a newer desktop stopped, naming both versions
  - `AssertionError: expected 'Axiom 1.6.0 last ran this host\'s ser…' to contain 'Orca 1.6.0'`

### `bun src/main/native-chat/agent-session-wire/structured-agent-session-refusal-details.test.ts` — 1

- the store fallback copy > does not promise an update fixes a record this build cannot read
  - `AssertionError: expected { …(3) } to deeply equal { …(3) }`

### `bun src/main/runtime/agent-state-rules/agent-state-rules-live-update.test.ts` — 1

- agent state rules channel and URL > fetches the fixed release-download URL for the engine and channel
  - `AssertionError: expected 'https://github.com/LaPaGaYo/Axiom/rel…' to be 'https://github.com/stablyai/orca/rele…' // Object.is equality`

### `bun src/main/runtime/runtime-workspace-launch-contracts.test.ts` — 1

- RuntimeAccountController host launch env > points `orca account` at the desktop that owns the accounts
  - `AssertionError: expected [Function] to throw error matching /Orca desktop app.*Ubuntu \(WSL\)/ but got 'Accounts for this WSL host are manage…'`

### `bun src/main/runtime/structured-chat-dispatch-worker.test.ts` — 1

- a chat as the assignee of orchestration dispatch > points the chat at its coordinator's mail to the Dispatch, which its own check reads
  - `AssertionError: expected 'You have 1 orchestration message. Run…' to match /^You have 1 orchestration message\. R…/`

### `bun src/main/runtime/structured-session-cli-login-shell.test.ts` — 1

- a structured session in a bash login shell > resolves this app's CLI through ORCA_CLI_COMMAND in `bash -lc`
  - `AssertionError: expected '' to be 'app' // Object.is equality`

### `bun src/main/ssh/orcad-snapshot-room.test.ts` — 1

- an update on a host without room for its snapshot (#30491) > counts free space and reclaimable snapshots apart in the refusal
  - `AssertionError: expected '{"outcome":"installed-not-activated",…' to match /has 1000 KB free \(plus 293\.0 MB Or…/u`

### `bun src/main/startup/browser-process-user-agent-ordering.test.ts` — 1

- browser process user-agent startup ordering > explains an orcad holding the profile instead of exiting silently
  - `AssertionError: expected "vi.fn()" to be called with arguments: [ 'Orca could not start', …(1) ]`

### `bun src/main/wsl/wsl-orcad-deploy.test.ts` — 1

- deployAndLaunchWslOrcad across an app update (E1) > the SSH auto-update rules > refuses the rolled-back build under the fence when nothing could be adopted
  - `AssertionError: expected 'Axiom 2.0.0 last ran this host\'s ser…' to match /Orca 2\.0\.0 last ran/`

### `bun src/renderer/src/components/NativeChatResumeOnRestartModal.test.tsx` — 1

- reports the chats a lost resume request named once, as failed, until it is retried
  - `AssertionError: expected 'Resumed 0 of 2 chatsThese chats were …' to contain 'Orca couldn’t resume this chat. Open …'`

### `bun src/renderer/src/components/floating-terminal/FloatingTerminalOrchestrationDialog.freshness.test.tsx` — 1

- FloatingTerminalOrchestrationDialog freshness > refreshes the local freshness verdict after presence re-check completes
  - `AssertionError: expected 'Enable orchestrationInstalledInstall …' to contain 'Update available'`

### `bun src/renderer/src/components/mobile/MobileHero.test.tsx` — 1

- HeroFlow height > names a signed-out or unentitled desktop instead of offering a futile retry
  - `Error: expect(element).toHaveTextContent()`

### `bun src/renderer/src/components/native-chat/native-chat-composer-drop-scope.test.tsx` — 1

- native chat composer drop scoping > reports an OS drop whose files carry no readable path
  - `AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]`

### `bun src/renderer/src/components/plain-ssh-terminal/PlainSshTerminalPanels.test.tsx` — 1

- plain SSH terminal > opens a labelled unmanaged window, shows early output, and closes when ssh exits cleanly
  - `TestingLibraryElementError: Unable to find an element with the text: /Plain SSH — unmanaged\. Not an Orca workspace/. This could be because the text is broken up by multiple elements. In this case, yo`

### `bun src/renderer/src/components/settings/AgentSkillSetupPanel.freshness.test.tsx` — 1

- AgentSkillSetupPanel freshness re-check > rescans skill freshness and updates the rendered verdict on re-check
  - `AssertionError: expected 'InstalledUpdateRe-check' to contain 'Update available'`

### `bun src/renderer/src/components/settings/SshPane.test.tsx` — 1

- removing a managed server host > points to the host’s Axiom server row instead of a removal main refuses
  - `AssertionError: expected 'Sync ~/.ssh/configAdd hostRestore rem…' to contain 'Orca runs on Build box'`

### `bun src/renderer/src/components/settings/git-description-templates.test.tsx` — 1

- Git settings complete translation templates > keeps code tokens and the prompt popover in ko
  - `AssertionError: expected '워크스페이스를 만들면 Axiom가 원격 기준 브랜치를 새로고침하고 …' to contain '커밋되지 않은 변경 사항이나 로컬에만 있는 커밋이 있으면 Orca는…'`

### `bun src/renderer/src/components/sidebar/LinearAgentSkillSetupPrompt.test.tsx` — 1

- LinearAgentSkillSetupPrompt > uses WSL skill discovery and commands without CLI registration
  - `AssertionError: expected { className: 'px-6 pt-4 pb-6', …(18) } to deeply equal ObjectContaining{…}`

### `bun src/renderer/src/components/sidebar/sidebar-list-goldens-stamp-order.test.tsx` — 1

- sidebar row model goldens > scenario host-sections across groupBy and pinned policy
  - `Error: Snapshot `sidebar row model goldens > scenario host-sections across groupBy and pinned policy 1` mismatched`

### `bun src/renderer/src/components/sidebar/sidebar-list-goldens.test.tsx` — 1

- sidebar row model goldens > scenario host-sections across groupBy and pinned policy
  - `Error: Snapshot `sidebar row model goldens > scenario host-sections across groupBy and pinned policy 1` mismatched`

### `bun src/renderer/src/lib/agent-skill-nav-install-status.test.ts` — 1

- getLinearAgentSkillNavInstallStatus > reports canonical installs under orca-linear
  - `AssertionError: expected 'installed' to be 'update-available' // Object.is equality`

### `bun src/renderer/src/ssh/ssh-host-server-status-copy.test.ts` — 1

- SSH host server status line > asks for a reconnect while an older Orca’s terminals still run, counting them
  - `AssertionError: expected '1 terminal started by an older versio…' to be '1 terminal started by an older versio…' // Object.is equality`

### `bun src/shared/host-operation-ownership.test.ts` — 1

- getHostOperationOwnership > classifies every runtime RPC method
  - `AssertionError: expected [ 'axiom.artifact.list', …(40) ] to deeply equal []`

### `bun src/shared/remote-runtime-request-connection-stale.test.ts` — 1

- RemoteRuntimeRequestConnection stale socket callbacks > runs socket cleanup when the cached connection closes
  - `AssertionError: expected [Function] to throw error including 'Remote Orca runtime closed the connec…' but got 'Remote Axiom runtime closed the conne…'`

### `bun src/shared/runtime-environment-store.test.ts` — 1

- runtime environment store > refuses a pairing code that this same Orca profile issued
  - `AssertionError: expected [Function] to throw error matching /this Orca itself/ but got 'This pairing code is for this Axiom i…'`

### `bun src/shared/wsl-move/wsl-move-dispositions.test.ts` — 1

- WSL mover dispositions > lists every SQLite table the app creates, by database
  - `AssertionError: expected [ …(28) ] to deeply equal [ …(27) ]`

### `bun tests/e2e/terminal-account-restart.unit.test.ts` — 1

- account restart through renderer connection and host spawn > replaces a tombstoned owner while its persisted pane binding has not yet been cleared
  - `AssertionError: TypeError: store.getSettings is not a function. (In 'store.getSettings()', 'store.getSettings' is undefined): expected null to be 'pty-new' // Object.is equality`

### `node-runtime src/cli/index-agent-launch.test.ts` — 1

- orca cli agent launch > returns an exact recovery command and removes blind retry advice after a lost reply
  - `AssertionError: expected '{"code":"agent_session_operation_unkn…' not to contain 'Restart Orca and try again'`

### `node-runtime src/cli/index-automation-run-output.test.ts` — 1

- automation run command output > explains full UUIDs and pending launch behavior in run help
  - `AssertionError: expected 'axiom automations run\n\nUsage: axiom…' to contain 'Use the full automation UUID from orc…'`

### `node-runtime src/main/native-chat/agent-session-journal/journal-dispatch-legacy-reason.test.ts` — 1

- a dispatch row's reason > reads bounded, head first, when an older build stored megabytes of it
  - `AssertionError: expected 'Write failed: xxxxxxxxxxxxxxxxxxxxxxx…' to contain '[Orca: output truncated'`

### `node-runtime src/main/native-chat/agent-session-journal/journal-open-failure.test.ts` — 1

- createJournalOpenReadRefusals > logs a chat again when its load fails for another reason, naming where each failed
  - `AssertionError: expected [ …(2) ] to deeply equal [ StringContaining{…}, …(1) ]`

### `node-runtime src/main/runtime/orca-runtime.test.ts` — 1

- OrcaRuntimeService > refuses a saved project at the clone path whose folder is not a clone of the URL
  - `AssertionError: expected [Function] to throw error including '"orca" is already an Orca project' but got '"orca" is already an Axiom project at…'`

### `node-runtime src/main/runtime/structured-session-cli-login-shell.live-shell.test.ts` — 1

- a structured session in a zsh login shell > resolves this app's CLI through ORCA_CLI_COMMAND in `zsh -lc`
  - `AssertionError: expected '' to be 'app' // Object.is equality`

### `node-runtime src/shared/remote-runtime-shared-control-connection.test.ts` — 1

- cancels a pending subscription setup without canceling a sibling on the shared connection
  - `AssertionError: expected [Function] to throw error including 'Remote Orca runtime' but got 'Remote Axiom runtime closed the conne…'`

## Environmental (fail identically on pristine upstream on this host)

### `bun src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts` — 13

- #13767 shell-ready marker loss across exec > does not treat an exec-replaced readline program as the shell prompt
- #13767 shell-ready marker loss across exec > does not trust a non-shell executable renamed to the shell basename
- #13767 shell-ready marker loss across exec > keeps queued input out of a child read during bash profile startup
- #13767 shell-ready marker loss across exec > keeps queued input out of a child read during zsh environment startup
- #13767 shell-ready marker loss across exec > keeps queued input out of a child read during zsh profile startup
- #13767 shell-ready marker loss across exec > keeps queued input out of a real bash profile silent read
- #13767 shell-ready marker loss across exec > keeps queued input out of a real zsh environment silent read
- #13767 shell-ready marker loss across exec > keeps queued input out of a real zsh profile silent read
- #13767 shell-ready marker loss across exec > keeps queued input out of a zle-line-init read after exec
- #13767 shell-ready marker loss across exec > releases at the real bash profile prompt after exec
- #13767 shell-ready marker loss across exec > releases at the real zsh environment prompt after exec
- #13767 shell-ready marker loss across exec > releases at the real zsh profile prompt after exec
- #13767 shell-ready marker loss across exec > retains the timeout backstop when zsh disables bracketed paste

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

### `bun src/main/shell-startup-feature-channel.test.ts` — 5

- epilogue under hostile user shell options > still runs every feature when the user set ksh_arrays
- epilogue under hostile user shell options > still runs every feature when the user set no_unset
- history-only pane in a real zsh > emits no OSC 133 and leaves a pane observably identical to an unwrapped one
- zsh launch config > restores this app CLI after zsh startup resets PATH and replaces prompt hooks false
- zsh launch config > restores this app CLI after zsh startup resets PATH and replaces prompt hooks true

### `bun src/main/daemon/bash-prompt-command-composition.test.ts` — 3

- daemon bash PROMPT_COMMAND composition > composes an inherited hook with nounset enabled
- daemon bash PROMPT_COMMAND composition > composes an unset PROMPT_COMMAND with nounset enabled
- daemon bash PROMPT_COMMAND composition > keeps lifecycle when RANDOM is unset under nounset

### `bun src/main/daemon/shell-ready.test.ts` — 3

- daemon shell-ready launch config > emits the shell-ready marker even when a user zle-line-init widget fails (oh-my-zsh vi-mode shape)
- daemon shell-ready launch config > keeps chaining the prior zle-line-init widget when the marker block is sourced twice
- daemon shell-ready launch config > still runs user add-zle-hook-widget line-init hooks after the marker

### `node-runtime src/main/runtime/orca-runtime.test.ts` — 2

- OrcaRuntimeService > keeps existing-folder imports split by runtime host on the same normalized path
- OrcaRuntimeService > sets up an existing folder on a fresh runtime after importing the repo project

### `bun config/scripts/dependency-security-release.test.mjs` — 1

- extracts release data while excluding executable package and Cargo configuration

### `bun src/main/cli/packaged-cli-assets.test.ts` — 1

- packaged CLI assets > sanitizes node env and forwards argv verbatim through the macOS launcher

### `bun src/main/ipc/pty-pane-materialization-race.test.ts` — 1

- registerPtyHandlers > reuses renderer spawn when runtime materialization starts for the same pane

### `node-runtime src/main/zsh-deferred-startup-line-init.live-shell.test.ts` — 1

- zsh deferred startup after prompt-hook replacement > restores CLI precedence and preserves the user widget in a ordered-startup pane

### `node-runtime src/shared/startup-shell-portability.live-shell.test.ts` — 1

- one POSIX startup dialect is correct in every Unix shell > zsh > clears even when `test` is aliased away in an interactive shell

