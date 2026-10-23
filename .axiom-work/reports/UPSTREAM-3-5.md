# UPSTREAM-3 — attempt 5 submission

Date: 2026-10-23. Worker: Codex. Starting commit: `abdd71d60c`, branch `axiom/attempt/UPSTREAM-3/5`. Changes are uncommitted working-tree changes for the launcher's candidate snapshot.

## Delivery state

The merge-regression fixes, `opencode.json` packaging exclusion, and the two cold-start egress fixes are implemented. All three typechecks and all 32 stages of the repository's `lint` script pass. The seam check reports **137 touchpoints, 0 dropped**; the vendor-egress ratchet passes.

Of the verifier's 162 originally merge-caused failures, **154 now pass here**: the final 59-file regression run covers 139 of them (1,048 total tests passed), and the two mixed environment/merge files cover another 15. The four `orcad-duplicate-pty-repair-startup` cases and one `remote-runtime-shared-control-connection` case have their fixture/copy fixes, but socket restrictions prevent verifying them here. The three `MobilePage` Relay cases remain deferred under the explicit D75 exception. This is a submission for host verification, not a claim that the full sidecar or packaged cold-start capture passed.

No Git mutations, dependency operations, manifest/lockfile/patch edits, baseline edits, or changes to the verifier's protected operating artifacts were made. `src/main/axiom/**` and `src/shared/axiom-contract/**` are unchanged. The upstream v43 migration and both truncation-marker modules are byte-for-byte upstream; the projection reader is unchanged.

## Changes by cause

### Branding copy and command fixtures

- Updated the classified tests to assert Axiom's user-facing copy while retaining their behavioral assertions. This includes CLI help, terminal errors, Codex hook diagnostics, native-chat refusal text, clone conflicts, SSH/WSL deployment copy, runtime status, settings, and sidebar goldens. Repository/provider fixture names, internal identifiers, translation keys, environment variables, skill IDs, and attribution remain unchanged.
- Completed the remote-runtime message twins in `src/shared/remote-runtime-{client-handshake,shared-control-protocol,request-socket,connect-bound,subscription-transport}.ts`, `src/shared/runtime-host-status-owner.ts`, `src/renderer/src/runtime/remote-runtime-terminal-multiplexer-base.ts`, and `src/renderer/src/web/web-runtime-{client,connection-transport,connection-waiters,request-registry}.ts`. Their transport error tests and renderer recovery fixtures now use the actual Axiom producer messages.
- `src/cli/runtime/transport.ts:85,98` now emits the Axiom retry advice already consumed by the two recovery helpers. `src/cli/automation-format.ts` generates `axiom automations runs`; the automation output tests retain quoting, platform, and argument assertions. Agent-launch and Linear edit/delete help examples in `src/cli/specs/{agent-launch,linear}.ts`, and the fallback command in `src/shared/computer-use-error-recovery.ts`, use the product CLI.
- `src/main/runtime/structured-chat-coordinator-mail-rig.test-fixture.ts` recognizes `axiom`/`axiom-dev` in the user-facing mail pointer. The coordinator suite passes all 23 cases; no coordinator behavior was changed. Structured login-shell harnesses and the zsh deferred-startup tests create the actual `axiom`/`axiom-dev` executables, preserving the `ORCA_*` protocol and environment names.
- Updated the two sidebar goldens through the test runner. The only snapshot changes are the 32 occurrences of the user-visible server label across the two files; structure and identities are unchanged.
- Completed the same visible copy in `src/renderer/{popout,space}.html` and the profile startup recovery log in `src/main/persistence/profile-state/profile-state-startup-authority.ts`.

### Persisted and parsed literals

I inspected the verifier's rebrand-leftovers inventory and the associated regex, replacement, inclusion, equality, and command-prefix readers. These were the material reader/writer mismatches:

| Literal or identity | Reader and writer | Resolution |
| --- | --- | --- |
| `[Orca: output truncated …]` | `journal-payload-bounds.ts:28` and `structured-agent-session-projection.ts:72` | Restored the producer's exact upstream bytes. Retention/legacy projection assertions now work again. Restored the corresponding journal and Claude prompt assertions. |
| `[Orca: streamed output truncated]` | `agent-session-delta-coalescer.ts:23` and stream consumers/tests | Restored the exact upstream marker and its test assertions. The UTF-8 bound test again expects three `é` characters at the 40-byte limit because the marker has upstream's byte length. |
| `Restart Axiom and try again.` | `src/cli/runtime/transport.ts` writes; `agent-launch-recovery.ts` and `orchestration-mutation-recovery.ts` strip | Branded the writer and the negative assertion. The advice is user copy, not a stored format. |
| `Remote Axiom runtime …` | Shared connection classifier, web startup classifier, and both Tailscale/unreachable-hint regexes | Current producers emit Axiom. `remote-runtime-client-error-classification.ts:49` and `startup-web-host-unreachable.ts:19` normalize legacy Orca text for classification; the two hint regexes accept both names. Explicit error codes still take precedence, including nonrecoverable/auth codes. Added explicit old-host compatibility cases. The producer/classifier corpus still checks every message fragment against a real producer. |
| Portable `axiom …` recovery command | `src/cli/orchestration-mutation-recovery.ts:178` | Recognizes the prefix actually emitted by Axiom, retaining `orca` for older-host commands, then substitutes the configured executable with the existing platform quoting. The Windows configured-executable test makes the same exact assertion for both prefixes. The added legacy case failed before preserving the old prefix and passes afterward. |
| AppImage desktop executable `axiom-ide` | `src/shared/appimage-cache-identity.ts:13`; synthetic executable paths in `appimage-copy-pre-extraction.ts` and `appimage-generation-stable-launcher.ts` | Aligned the reader with D21's packaged executable. CLI payload fixtures use `resources/bin/axiom`; desktop-generation fixtures use `axiom-ide`. Cache directories, generation keys, lease protocol, and bundled Node identity are unchanged. |

The AppImage reader mismatch was confirmed by failing generation-lease tests using the product executable before the fix. The complete focused AppImage group then passed (13 files, 90 tests, two existing skips). Remote parsing checks passed in seven files / 100 tests, including old-host strings and nonrecoverable cases.

Notable bytes deliberately retained: `ORCA_*`, `orcad`, `orca.yaml`, `.orca` paths, `orca_desktop`, `orca_server_ready`, `orca-model`, `orca-plugin.json`, `engines.orca` and its internal compatibility parser, skill IDs, IPC/protocol keys, reason codes, translation keys, and upstream attribution. Existing runtime-compatibility logic already accepts Axiom and legacy Orca command spellings. No global text substitution was applied to these identifiers. A search for rebranded truncation markers returns no matches.

### Axiom seams in upstream fixtures

| Files | Change and reason |
| --- | --- |
| `src/main/ipc/pty-launch-parity.test-fixture.ts` | Added `updateSettings` to the shared store builder so real `recordProviderActivation` can persist the launch. All 31 parity cases pass. |
| `src/main/startup/codex-account-restart-resume.test.ts` | Added the store write double required by activation. All five account/restart scenarios pass. |
| `tests/e2e/terminal-account-restart.unit.test.ts` | Added `getSettings`/`updateSettings` at the launch seam. Passes. |
| `src/main/orcad/orcad-duplicate-pty-repair-startup.test.ts` | Mocked `axiom/control-plane-boot` start/stop: this suite tests PTY repair ordering, not Mission recovery. It no longer calls a nonexistent fake `getOrchestrationDb`; all four cases now reach the real hook server, whose socket bind is denied here. Reproduced alone. |
| `src/main/startup/main-process-ready-runtime-activation.test.ts` | Added `getProfileStorageDirectory`, followed upstream's `startCodexHooks` service, and used its current read-only launch-home API. The test still checks activated versus inactive providers. |
| `src/main/startup/main-process-ready-runtime.ts:117` | The migrated test exposed a real bypass: upstream's new Codex reconciler read only the hook opt-out, not Axiom's provider-activation gate. It now uses existing `shouldInstallStartupManagedAgentHook`. Verified a failing inactive-provider assertion before the fix and both active/inactive cases afterward. |
| `src/main/startup/codex-hook-startup-wiring.test.ts` | Uses the real combined startup predicate. The existing live opt-out check remains; clearing provider activation also disables the callback. |
| `src/main/startup/{codex-launch-per-agent-hook-opt-out,codex-session-resume-daemon-guard}.test.ts` | Completed upstream store doubles with `updateSettings`. The passive preflight scenario explicitly activates Codex so it can test hook-reconcile waiting behavior without bypassing D37. Existing opt-out and daemon-resume assertions remain. |

Production store/runtime interfaces were not weakened to accommodate fakes.

### Host and database registries

- `src/shared/host-operation-ownership.ts:23`: classified `axiom` as `host`. The consumer in `src/renderer/src/runtime/host-route-call.ts:31` routes these operations to the runtime owning the selected host's state; an unclassified operation is fail-closed. Missions and Axiom RPCs need that runtime's orchestration database, not client-local ownership. The existing complete RPC census and an explicit all-Axiom ownership assertion pass.
- `src/shared/wsl-move/wsl-move-storage-dispositions.ts:115,169`: mapped `create-axiom-tables-sql.ts` to the orchestration database, and assigned all 17 Axiom side tables the same `rewrite-desktop` / plan item 53 disposition as the adjacent orchestration tables. The schema/table census passes. No migration bodies or persisted data were edited.

### Investigated cases and deliberate M0 behavior

| Test group | Cause and resolution | Result |
| --- | --- | --- |
| `profile-state-offline-settings` (6) / `profile-project-domain-transfer` (3) | Attempt 2 deliberately removed the migration for upstream's never-shipped Portuguese plugin ID. The normal-load expectations still demanded upstream migration even though offline operations correctly preserved raw settings. Kept the raw preservation checks and asserted Axiom's unchanged plugin value; absent marker gets the existing default, explicit false remains false. Production persistence code unchanged. | Pass |
| `skill-freshness-inventory`, `agent-skill-nav-install-status`, `AgentSkillSetupPanel.freshness`, `FloatingTerminalOrchestrationDialog.freshness` (5) | Fixture lock entries used upstream's official source, so Axiom correctly treated them as a different installation and reported `installed`. Fixtures now use `LaPaGaYo/Axiom`, preserving hashes, skill IDs, and the update-available assertions. | Pass |
| `rate-limits/service-refresh-orchestration` (2) | The stale Codex snapshot fixture lacked provider activation, so D37 suppressed the intended request. This also left a queued mock response to contaminate the next test. Activated the relevant fixture; no rate-limit production changes. | Pass |
| `appimage-copy-pre-extraction` (4) / `appimage-serve-preparation` (2) | Synthetic payloads still supplied `orca`, while Axiom's packager/launcher requires `axiom`. Fixed fixtures, then corrected the additional desktop-generation reader described above. | Pass |
| `orchestration-mutation-recovery` (3) | Recovery command fixtures/prefix reader disagreed with the branded producer; configured Windows executable was not substituted. Corrected prefix and fixtures, retaining exact quoting and replacement checks. | Pass |
| `SshHostRestartServerAction` (3) | Mock child rendered “Restart Orca’s server…” while the parent test queried Axiom. Made the mock use the real button copy; confirmation, refusal, restart, and refresh assertions remain. | Pass |
| `MobileHero` (1) | Old Relay sign-in copy assertion. Updated to Axiom. | Pass |
| `MobilePage` (3) | M0 intentionally removed the Relay choice; tests query the absent “Axiom Relay” button. This is not a copy mismatch. No pairing UI or test weakening; left to D75 as instructed. Alone: 21 passed, 3 failed. | Deferred D75 |
| `profile-cloud-auth-characterization` (2) | Skill sharing is unconfigured by product policy. The test now supplies `ORCA_ARTIFACTS_API_URL=http://localhost:4100` and retains mocked 401-refresh-retry behavior. | Pass |
| `LinearAgentSkillSetupPrompt` (1) | Expected upstream install source, while the command comes from product policy. Asserted Axiom's release repository; skill ID remains `orca-linear`. | Pass |
| `agent-state-rules-live-update` | Product repository expectation and default-on upstream fixture contradicted D37. Explicitly opted in for update tests and tested missing/false opt-in separately. | Pass |

## Packaging

`config/electron-builder.config.cjs:320` excludes `!opencode.json{,/**/*}` beside other root tool files. `config/scripts/electron-builder-config.test.mjs:171` adds it to the existing root-exclusion enumeration. `check-root-directory-entries.test.mjs:128` verifies that this permitted development root file is excluded from the packaged app. `verify-packaged-app-asar-contents.cjs` is unchanged.

The exclusion assertions and asar-contract tests pass. Two other existing tests in `electron-builder-config.test.mjs` cannot hard-link `smol-toml` from the real pnpm store into their temporary fixture (`EPERM`); they are recorded below. A real `build:unpack` must be repeated by the host verifier.

## Cold start and icons

`src/main/runtime/agent-state-rules/agent-state-rules-live-update.ts:124` now fetches only for a packaged build with `agentStateRulesLiveUpdates === true`. Both existing callers (`main-process-runtime-service.ts:154` and `orcad-entry.ts:264`) use this one implementation. Without opt-in, cached downloaded bundles are not activated; the bundled rules remain active. Tests cover both missing and false settings with a newer cache present and assert no fetch. Opt-in update, rollback, validation, and release-channel tests remain intact; the URL assertion names `LaPaGaYo/Axiom`.

Google favicon request generation has been removed from all three paths:

- `agent-catalog.tsx:92`: uses bundled images or existing SVG/letter fallback. `agent-favicon-assets.ts:43` now maps CodeBuddy to the already-shipped `src/shared/agent-icons/codebuddy.png`.
- `open-in-app-catalog.tsx:25,58`: Cursor uses its shipped PNG; VS Code, Zed, and unknown commands use the existing `AppWindow` glyph. No replacement image service.
- `repo-icon.ts:95` rejects persisted favicon images, and `RepoIconGlyph` at `components/repo/repo-icon.tsx:146` also falls back locally if passed an unsanitized legacy favicon directly. `repo-icon-autodetect.ts` no longer derives an image from package.json's homepage. Existing local file discovery, uploaded images, explicitly selected GitHub avatars, emoji, and glyphs are retained. `RepositoryIconTabs.tsx` removes the website-favicon control that would otherwise recreate the forbidden URL.

The fresh-profile agent-picker source identified in code is **CodeBuddy's `AgentIcon`**: `agent-catalog-entries-secondary.ts:175–179` supplies `codebuddy.ai`, and its existing PNG was missing from the desktop asset map. When its row is mounted, `onboarding/AgentStep.tsx:214` previously rendered the Google-backed fallback. The old editor presets also rendered Google icons when mounted. The host's 75-second capture contains only `CONNECT www.google.com:443` at +42 seconds, not a URL or DOM initiator, so identifying that particular recorded connection as CodeBuddy is a source-based attribution, not a measured initiator trace. The new catalog-render test mounts every agent icon and every editor preset and asserts local images/glyphs; the host can confirm the full foreground capture after packaging.

`src/renderer/src/lib/catalog-icons.test.tsx` covers the entire agent picker and editor presets. Repo-icon tests cover rejecting and rendering old persisted favicon choices. The required production-source Google URL grep prints nothing. The only related English catalog change is generated `en-runtime-required.json`, regenerated with `node config/scripts/generate-runtime-required-english-catalog.mjs --fix`; the localization checks pass.

## Verification commands and results

Runner: Node **v24.21.0**, repository-pinned Bun **1.4.3**, Vitest **5.0.5**. Used the sanctioned loader entrypoint, which selects Bun for the Bun lane and Node for the node-runtime lane:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH
env -u CODEX_THREAD_ID node config/scripts/run-vitest.mjs run \
  --config config/vitest.config.ts --configLoader runner --no-cache --maxWorkers 4 <targets>
```

The inherited `CODEX_THREAD_ID` changes CLI error advice to Codex-specific advice. Removing only this runner variable makes tests exercise the normal CLI environment their existing assertions describe. Earlier runs without removal exposed this environmental difference; no production workaround was added. No `pnpm` command was needed and no automatic installation occurred.

Built packages using `node --import tsx --conditions=orca-source scripts/build-dist.mjs` in `src/packages/process-host`, then ran from the root:

```sh
node config/scripts/run-typecheck-projects-in-parallel.mjs \
  --project=config/tsconfig.node.json \
  --project=config/tsconfig.tc.cli.json \
  --project=config/tsconfig.tc.web.json
```

The three specified tsbuildinfo files were confirmed absent before the clean-cache checks. Final results: CLI **3,172 files / 0 errors**, main **17,844 / 0**, renderer **15,674 / 0**.

| Check | Final result / evidence |
| --- | --- |
| Classified merge failures | **59 files / 1,048 tests passed** (`/tmp/upstream3-5-classified-final.log`). Selected the 64 files in the classification, excluding the two mixed files run separately plus `orcad-duplicate-pty-repair-startup`, `remote-runtime-shared-control-connection`, and `MobilePage`. |
| `orca-runtime.test.ts` + `zsh-deferred-startup-line-init.live-shell.test.ts` | **1,506 passed, 3 skipped, 2 failed**. Only the two preclassified `/var` versus `/private/var` cases fail. All 17 zsh cases pass here, including the 14 formerly merge-caused cases. `/tmp/upstream3-5-mixed-env.log`. |
| Axiom, contracts, Axiom RPCs, orchestration DB, CI sidecar tests, e2e helper group | **149 files passed, 1 skipped; 1,262 tests passed, 1 skipped**; three helper files have socket/process-inspection failures listed below. `/tmp/upstream3-5-sidecar-1.log`. |
| Broad CLI group without live socket files | **183 files / 2,148 tests passed, 9 skipped**. `/tmp/upstream3-5-cli-final.log`. Separately six mocked mutation-request cases pass, with its one real socket case excluded after attempting it. |
| Native-chat / projection sidecar group | 366 files / 3,709 tests initially passed; one UTF-8 truncation expectation was then corrected and passed in the final 18-test marker/startup rerun. The other failure is the evidenced process-start-time restriction below. `/tmp/upstream3-5-sidecar-3-final.log`, `/tmp/upstream3-5-marker-startup-after.log`. |
| Codex / startup sidecar group | 369 files / 3,603 tests initially passed. The additional store/hook doubles and Claude marker assertions discovered there were corrected and rerun: final launch/marker group **3 files / 33 tests passed**; startup/marker group **3 / 18 passed**. Remaining failures are socket/process/Electron restrictions listed below. `/tmp/upstream3-5-sidecar-4-final.log`, `/tmp/upstream3-5-launch-markers-final.log`. |
| Settings group | **247 files / 1,660 tests passed**. `/tmp/upstream3-5-sidecar-5-final.log`. |
| Remaining sidecar targets, after evidenced exclusions | **50 files / 965 tests passed, 2 skipped**. Excluded MobilePage, orcad startup and shared-control socket tests, plus the two hard-link-only packaging cases via test-name filter. `/tmp/upstream3-5-sidecar-6-bounded.log`. |
| Additional changed-area tests | **48 files / 524 tests passed, 2 skipped**; one live TCP test times out with `listen EPERM`. Includes local icon rendering, parser compatibility, i18n, runtime copy and registry coverage. `/tmp/upstream3-5-additional-final.log`. |
| Focused AppImage | **13 files / 90 passed, 2 skipped**. `/tmp/upstream3-5-appimage-after.log`. |
| Remote parser compatibility | **7 files / 100 passed**. `/tmp/upstream3-5-parsers-after.log`. |
| Full repository lint, direct constituent commands | **All 32 stages passed**, including oxlint, anti-slop/native/type-aware audits, all ratchets, reliability, RPC/ACP/skill generators, localization, and import checks. `/tmp/upstream3-5-lint-complete.log`. Each `pnpm run <name>` from `package.json`'s lint chain was expanded to that script's command and executed sequentially with `node_modules/.bin` on PATH, avoiding package-manager auto-install. |
| Separate renderer design-system report | `oxlint --config config/oxlint-design-system.json src/renderer`: **FAIL**, 4,372 existing diagnostics in 674 files. Only one changed file appears: `RepositoryIconTabs.tsx`, with eight diagnostics on lines verified identical to starting `HEAD`. The other 673 files and the design-system configuration are unchanged. No new offending markup was introduced. This report is separate from the repository's passing `lint` chain; broad design-system cleanup is outside this Task. `/tmp/upstream3-5-design-system.log`. |
| `python3 .axiom-work/scripts/upstream3-seam-check.py` | **137 touchpoints from main, 0 dropped**. |
| `node config/scripts/check-vendor-egress-ratchet.mjs` | **PASS**, 459 grandfathered pairs. Reports nine stale entries, including preexisting stale pairs; baseline intentionally untouched for verifier shrink. |
| RPC params catalog, bundled skill guides, skill manifest, reliability gates | **PASS**, also included in the final lint run. |
| Conflict-marker grep, production Google-favicon grep, rebranded-marker grep | **No matches**. |
| Protected-files diff against `axiom/upstream-3/protected-base` | **Empty** before this report; only this report is added under `.axiom-work`. |
| Upstream byte comparisons | **Equal** for `schema/migrate-v43.ts`, both truncation-marker producers, `structured-agent-session-projection.ts`, and `config/patches/**`. |
| Prior-attempt sidecar invariants | **PASS**: schema 46, no hardcoded legacy Axiom session addresses, no Axiom capability fields/flags, cloud and mobile-release workflows remain absent, real `.axiom` home remains guarded. |
| `git diff --check` | **PASS**. Formatting was limited to changed files. |

These groups overlap; their counts must not be summed into a unique full-suite total. The sidecar was run in bounded groups rather than the whole repository suite. Two broad groups were stopped after 240 seconds because real socket tests could not bind; the non-socket selections and focused reruns above completed. No tests were deleted, marked skipped in source, or weakened to make the sandbox pass.

### Sandbox failures and deferred work

| File / group | Observed error and disposition |
| --- | --- |
| `src/main/orcad/orcad-duplicate-pty-repair-startup.test.ts` (4) | Reproduced alone: hook-server startup `Failed to start server. Is port 0 in use?`. Direct Node loopback bind probe reports `listen EPERM`. Fixture fix is complete; host rerun required. |
| `src/shared/remote-runtime-shared-control-connection.test.ts` | The formerly failing subscription-cancellation assertion now expects Axiom. Targeted alone: real test server cannot bind `127.0.0.1` (`listen EPERM`), then 30-second timeout. Full-file runs also blocked at server creation. Host rerun required. |
| `src/shared/remote-runtime-connect-bound.test.ts` (1) | Real server bind reports `listen EPERM: operation not permitted 127.0.0.1`, then timeout. Other mock-based connection and classifier cases pass. |
| `tests/e2e/helpers/recording-proxy.unit.test.ts` (10), `remote-skill-cloud-fixture.unit.test.ts` (1) | Loopback server cannot start. The proxy cannot record requests without a listening socket. No helper changes. |
| `tests/e2e/helpers/electron-process-shutdown.unit.test.ts` (2) | Process-tree inspection through `ps` is denied in this sandbox, so descendant shutdown/timing assertions cannot establish their preconditions. No helper changes. |
| CLI real-socket files | Attempted full group: `runtime/{client-recovery,runtime-source-fence,websocket-transport,status,status-caller,transport,runtime-listener-probe}.test.ts`, `runtime-client.test.ts`, `agent-launch-process.test.ts`, and the live case in `handlers/orchestration/mutation-request.test.ts`. TCP/Unix `listen EPERM` causes timeouts. The 183-file final CLI run excludes these ten files; six mocked mutation cases were run separately. |
| `src/main/native-chat/agent-session-wire/structured-agent-session-recovery-exits.test.ts` (1) | Alone: `owner process start time was unavailable`; four other tests pass. Host process inspection is denied. |
| `src/main/codex/codex-state-db-backfill-recovery.test.ts` (2) | Alone: `Could not identify the managed-hook installer process`, followed by missing fixture output; 12 tests pass. Same process-identity restriction. |
| `src/main/codex/codex-shared-server-probe.test.ts` (2) | TCP socket bind denied. No production/test changes. |
| `src/main/codex-accounts/legacy-wsl-runtime-auth-drain-apply-script.test.ts` (7) | Alone: expected SIGKILL, got null; 26 tests pass. The interruption helper requires `/bin/ps` ancestry proof before signaling; the sandbox denies that inspection, so it refuses the injection. No safety check weakened. |
| `src/main/startup/single-instance-lock-exit.electron.test.ts` (3) | Alone: real Electron never reaches the `GATE_ENTERED` marker. Electron launch is unavailable in this sandbox. |
| `config/scripts/electron-builder-config.test.mjs` (2) | `loads Codex TOML parsing after mac/linux runtime pruning`: hard-link from real pnpm-store `smol-toml` to temporary fixture returns `EPERM`. The root exclusion, format, prune lists, and other packaging assertions pass. |
| `src/main/runtime/orca-runtime.test.ts` (2) | Only the verifier's preclassified `/var` versus `/private/var` assertions fail. The merge-caused clone-copy assertion passes. |
| `src/renderer/src/components/mobile/MobilePage.test.tsx` (3) | Reproduces alone: missing Relay button, 21 other cases pass. Deferred to D75 pairing hygiene; unchanged. |

The verifier's other 50 upstream-identical failures, cross-version tag harness, mobile drawer browser dependency, and terminal-host CDHash fallback were not repaired or redefined. The new sandbox restrictions above are separate from that established host baseline.

## Remaining for the host

1. Snapshot this working tree and rerun the sidecar without sandbox socket/process restrictions, especially the four orcad cases and the shared-control cancellation case.
2. Repeat the classified full-host run against the established upstream baseline. Retain the explicit D75 exception for the three Relay UI cases.
3. Repeat `build:unpack` and the packaged 75-second foreground egress capture. Static/configuration and rendered-icon tests pass here; a packaged `{}` tally was not measured in the sandbox. Capture the image initiator if exact attribution of the previous +42-second request is needed.
4. Shrink stale vendor-baseline entries at integration if desired; this Worker left the baseline untouched as instructed.

No additional product decision is requested. Attempts 1–4, D73 identity authority, D74 baseline policy, and D75 dormant mobile scope remain intact.
