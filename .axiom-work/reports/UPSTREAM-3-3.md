# UPSTREAM-3 attempt 3 — D73 identity port and verification

2026-10-22. Continuation from `37bbf68bc0`, with verifier preparation HEAD `9009d55347`, on `axiom/attempt/UPSTREAM-3/3`. D73 B and D74 B are accepted; D75 keeps the phone companion dormant.

**Delivery state:** implementation is left uncommitted for the launcher. B1 is resolved. The required focused suite, all three clean-cache typechecks, all lint stages, generated-file checks, and seam/egress checks pass. The non-mobile triage failures remaining are reproduced environmental failures, detailed below; their host verification remains necessary. Mobile rendering/bundle results are deferred under D75. This report is a Worker submission, not an independent verification or integration decision.

No Git index/ref writes, dependency installation, patch/manifest/lockfile edits, protected documentation edits, vendor-baseline edits, or persisted application-database edits were made. Tests use temporary/in-memory fixtures. The partial run's useful identity tests were retained. Attempts 1 and 2 remain intact.

## 1. Authority implementation

- `src/main/axiom/execution/attempt-authority.ts:58`: resolve the sender through the kernel's `orchestrationCallerIdentity`. Without a host-resolved session caller, run `assertLifecycleCallerIsNotAnotherParty` with the request's compatibility evidence **before looking up the dispatch** (`:64`). A coordinator/other Worker cannot report as this Attempt.
- `attempt-authority.ts:71`: preserve dispatch/binding existence, `inactive_dispatch`, latest-sequence `stale_dispatch`, the Planner role binding, and Task-stage ownership. Settlement only allows the existing Submission replay path.
- `attempt-authority.ts:91`: derive pane and current process from the host. Reuse `workerReportRefusal` (`:99`) with the dispatch's worker state and `!dispatch.process_incarnation || db.isDispatchProcessCurrent(...)`. Its `dispatch_inactive` / `worker_identity_changed` errors pass through unchanged. When no process incarnation was recorded, require `isDispatchMessageSender` (`:108`). Preserve `hasLifecycleAuthority` (`:119`) and Mission/Task/Run consistency (`:127`). No upstream worker-report policy was changed.
- `attempt-authority.ts:145`: settled Submission replay requires `isDispatchProcessCurrent`, including the recorded pane and non-null matching incarnation. Different/missing process or different pane gives `worker_identity_changed`; no saved Axiom Submission still gives `inactive_dispatch`. A replay never reactivates a Dispatch.
- `src/main/runtime/rpc/orchestration-session-caller.ts:70`: extend the existing host session resolver to Axiom's eight Attempt verbs and Planner proposal, using the same record/lease/host validation, declared-caller comparison and structured Worker assignee handle/pane resolution as upstream. The original upstream method map remains unchanged. The shared Axiom method list is `src/shared/axiom-contract/attempt-caller-methods.ts:2`.
- `src/main/axiom/execution/attempt-request-authority.ts:10`, called at `src/main/runtime/rpc/dispatcher.ts:205`: revalidate Attempt identity **before mutation receipt lookup**. Otherwise a completed receipt bypasses the handler and could return an old result to a replaced process. The typed adapter uses the same resolver; it skips human Plan proposals without an Attempt. Existing service checks, including checks after Git I/O, remain in place.
- `src/cli/runtime/orchestration-compatibility-envelope.ts:7`: forward the caller evidence/session envelope for these Axiom verbs, retaining the stable mutation request id. Other Axiom commands retain their prior caller semantics. The ordinary `orchestration.*` compatibility behavior is unchanged.

The host resolves the structured Worker's injected Orca session to its dispatch assignee identity; no new token, capability storage, lifecycle, or socket-peer authentication was introduced. D73 §4 / DEF-25 remains out of scope.

## 2. Removed plumbing and documentation

- Removed Axiom capability input/verification/hash comparison from Attempt authority, `attempt-ask.ts`, `attempt-submission.ts`, `planner-proposal.ts`, and `src/main/runtime/rpc/methods/axiom/attempt.ts`. These now propagate compatibility evidence where necessary.
- Removed the required token flag/options from CLI handlers `src/cli/handlers/axiom/{attempt,attempt-ask,plan}.ts` and specs `src/cli/specs/{axiom-attempt,axiom-plan}.ts`. CLI tests now submit through the bound caller without a token.
- Worker instructions at `src/main/axiom/context-builder/render.ts:32` and Planner instructions at `planner-render.ts:77` no longer include the token placeholder. `src/main/axiom/execution/attempt-launcher.ts:209` only fills the Attempt id. Updated the deterministic ContextPackage hash from the rendered output and the launcher/template assertions. The new expected context id is `ctx_3599d3b3f9a5714e93da101687b40d125c6eabb438d692c02cb594d2ca312aff`.
- Fixtures call `prepareStartingWorkerAuthority` for its identity side effects, never expecting a token. The kernel-contract test asserts its return is `undefined`. E2E fixture ledgers/commands now use the recorded terminal/pane; forged and mismatched submissions assert `worker_identity_changed`.
- `docs/reference/orca-mapping.md:86`, `:154`, `:179`, `:224`, `:249` and the Submission/replay section describe D11/D14/D15/§4b under D73. Session mailbox spelling is `orca_session_id:`. Decision records were not edited.
- No RPC parameter schema changed: the removed credential was an envelope/CLI concern. The generated RPC catalog remains current and contains **41 `axiom.*` entries**. Generated bundled guides/manifests also verify unchanged.

### Remaining capability search matches

Command: `git grep -n -E 'dispatchCapability|orchestrationCapability|dispatch-capability' -- src tests`.

Result: **42 lines in 20 files; zero Axiom Attempt/Planner implementation, contract, CLI-spec or e2e-fixture matches.** These are inherited upstream compatibility forwarding, its documentation/tests, and historical transcript redaction fixtures. They do not authorize an Axiom Attempt:

| Paths | Reason retained |
|---|---|
| `src/cli/handlers/orchestration/{message-send-handler,mutation-request,question-handler}.ts`; `src/cli/specs/orchestration.ts` | Upstream old-host CLI flag forwarding, explicitly retained by D73. |
| `src/cli/runtime/{client,transport}.ts`; `src/shared/{runtime-rpc-envelope,remote-runtime-memory-limits}.ts` | Shared transport envelope forwards the upstream compatibility field; Axiom handlers no longer populate it. |
| `src/cli/runtime/orchestration-recovery-command.ts` | Redacts legacy credential flags from recovery command text. |
| `src/cli/bundled-skill-guides.ts` | Generated upstream orchestration guides describe preserving a flag from an older host's preamble; no Axiom Attempt instruction carries it. |
| `src/cli/handlers/orchestration.test.ts`; `src/cli/orchestration-mutation-recovery.test.ts`; `src/cli/runtime/orchestration-recovery-command.test.ts` | Tests of old-host forwarding/redaction. |
| `src/main/ipc/runtime-environments/runtime-environment-federated-read-routing.test.ts`; `src/shared/remote-runtime-{client,shared-control-connection}.test.ts` | Shared envelope routing/stripping regression fixtures. |
| `src/main/runtime/codex-quiet-ready-screen.test.ts`; `src/main/runtime/orchestration/worker-transcript-payload.test.ts`; `src/main/runtime/rpc/methods/orchestration/worker/{worker-output.test.ts,worker-release-archive.spec.ts}` | Historical terminal output and secret-redaction coverage; these strings must remain recognizable. |

## 3. Test mapping

| Capability-era intent | Identity equivalent / evidence |
|---|---|
| Valid token admits the bound Worker | Existing submit/ask/blocked/handoff/inform/request/request-subtask/check matrices now use the persisted pane/process, with no token. The five message verbs, ask and submit retain receipt idempotency; check retains mailbox delivery/generation semantics. |
| Missing/incorrect token refuses without effects | Missing or changed process incarnation and foreign pane refuse with `worker_identity_changed`; full DB snapshots, receipts, messages and Git effects remain unchanged. |
| Token belongs to a different Attempt | `rpc-attempt-identity.test.ts` passes another Attempt's actual handle to every Worker verb and checks refusal without effects. |
| Same pane but different process | Authority/channel/question/check tests and pre-receipt replay tests replace the host's current incarnation and check refusal. |
| Another orchestration party impersonates the Worker | Authority tests and RPC replay tests use actual coordinator/other-Dispatch terminal evidence; `consumer_fenced` wins before dispatch lookup/receipt replay. |
| Revoked/stopping/stale authority | All eight Worker verbs reject `stopping` through `workerReportRefusal`; existing stale/inactive matrices remain. Long-poll check still tests `consumer_generation` changing during the wait. |
| Settled duplicate submit | The same pane/process can read its own immutable Submission through both receipt replay and ordinary duplicate submission. Changed pane, changed incarnation or missing recorded incarnation is rejected. Other settled Attempt verbs remain inactive. |
| Planner capability | Planner proposal is accepted/idempotent for its binding, rejects a changed process before saved receipt lookup, preserves role/branch checks, and rechecks after Git I/O. Human proposals are unchanged. |
| Structured Worker report | New real-DB RPC cases use upstream `sessionRecord`, the structured-worker identity registry and a live host record. The wrong host-resolved session is refused; the assignee session succeeds for all eight Worker verbs without an explicit `from`. |
| Token returned by start preparation | Fixtures persist readiness identity using the void-returning upstream API. Kernel service-only start/stop/release behavior is retained. |

The added regression suite first exposed **15 failing identity/replay cases** before the resolver/receipt wiring was implemented. The initial authority reproduction also showed **47 failures** from the removed token API. Final results are below; no capability-era Axiom test file was removed or skipped to suppress failures.

All **16 files** that failed in attempt 1 now pass in the final focused command:

- `src/main/axiom/db/messages-store.test.ts`
- `src/main/axiom/execution/attempt-ask.test.ts`
- `src/main/axiom/execution/attempt-authority.test.ts`
- `src/main/axiom/execution/attempt-submission-evidence.test.ts`
- `src/main/axiom/execution/attempt-submission-scope.test.ts`
- `src/main/axiom/execution/attempt-submission.test.ts`
- `src/main/axiom/execution/planner-proposal.test.ts`
- `src/main/axiom/messaging/message-router.test.ts`
- `src/main/axiom/messaging/subtask-checks.test.ts`
- `src/main/axiom/mission-controller/typed-mailbox-consumer.test.ts`
- `src/main/axiom/recovery/attempt-reconciliation.test.ts`
- `src/main/axiom/rpc-attempt-channel.test.ts`
- `src/main/axiom/rpc-attempt-check.test.ts`
- `src/main/axiom/rpc-message.test.ts`
- `src/main/axiom/rpc-question.test.ts`
- `src/main/axiom/rpc-subtask.test.ts`

The recovery test waits for the actual host probe to begin before checking serialization: upstream's structured-session liveness probe adds an async hop. It still proves that concurrent reconciliation shares the same in-flight operation.

## 4. Triage results

Paths in the first table are relative to `config/scripts/` unless explicitly prefixed.

| File | Final result / resolution |
|---|---|
| `macos-terminal-host-bundle.test.mjs` | PASS. Canonicalize `require.resolve` with `realpathSync` before comparison against the canonical bundle root (`macos-terminal-host-bundle.cjs`). Bun could otherwise return the symlink spelling. |
| `ci-pr-concurrency-keys.test.mjs` | PASS. Removed the cleanup target/special concurrency spelling for deleted `cloud-verify.yml` from `.github/workflows/ci-closed-pr-caches.yml` (D33a). |
| `agent-state-rules-bundle.test.mjs` | PASS. Expected install source follows Axiom's `LaPaGaYo/Axiom` default. |
| `verify-skill-update-roundtrip.test.mjs` | PASS. Roundtrip fixture uses Axiom's release source. |
| `verify-cli-bin.test.mjs` | PASS. Restored the expected internal `orca-compiled-output` boundary package name; this is not a user-visible product name. |
| `pr-preflight-gates.test.mjs` | PASS. An introduced `cloud/` path gets full desktop checks, matching the existing D33 policy. |
| `pr-code-change-scope-format-route.test.mjs` | PASS. Same D33 expectation. |
| `mobile-web-terminal-engine-closure.test.mjs` | PASS unchanged. |
| `main-entry-facade.test.ts` | PASS. Canonicalized the temporary fixture root to match Node's `/private/var` `__dirname` on macOS. |
| `src/main/daemon/shell-ready-bash-wrapper.test.ts` | PASS. Fixture CLI and assertion use `axiom-dev`. |
| `src/main/daemon/bash-prompt-command-composition.test.ts` | PASS unchanged. |
| `src/main/daemon/daemon-appimage-generation-launch.test.ts` | PASS (5 passed, 1 Linux-only skip). Fixture creates the bundled launcher using `LINUX_CLI_COMMAND_NAME` (`axiom`). |
| `src/main/daemon/macos-daemon-launchd.test.ts` | PASS. Escaped-label regex follows `com.lapagayo.axiom`. |
| `src/main/runtime/rpc/methods/orchestration/worker/failed-start-retry-release.test.ts` | PASS. Expected startup text follows Axiom branding. |
| `src/main/runtime/rpc/methods/orchestration/worker/worker-start-readiness-settlement.test.ts` | PASS. Expected shutdown/release command uses the Axiom CLI. |

### Environmental failures, reproduced alone

These failures are **not counted as passes**. No test skip or production workaround was added. `V` below is the direct Vitest loader command in §5. Each isolated invocation's output is retained under `/tmp/axiom-upstream3-alone-*.log`.

| File | Combined result / isolated reproduction / classification |
|---|---|
| `config/scripts/ci-managed-ssh-execution.test.mjs` | 5 failed, 7 passed. `V <file>` reproduces `bash: line 12: mapfile: command not found`. Host `/bin/bash` is 3.2.57; the workflow targets Linux Bash. Environmental shell-version mismatch. |
| `config/scripts/dependency-security-release.test.mjs` | 1 failed, 2 passed. `V <file>` reproduces `bash: line 2: mapfile: command not found`. Same environmental shell mismatch. |
| `config/scripts/pr-auxiliary-preflight-admission.test.mjs` | After fixing deleted cloud-relay expectations, 191 passed, 8 failed. `V <file> -t 'retains full root units for an actual addition'` reproduces `MOBILE_CI_ARGS[@]: unbound variable` under Bash 3.2 `set -u` with an empty array. The eight addition/deletion/rename/type-change cases for mobile and daemon mock share this environment failure. D33a tests now assert the removed relay job is absent while retaining all remaining admission checks. |
| `config/scripts/process-host-dev-rebuild.test.ts` | 7 failed, 1 passed. `V <file> -t 'ignores excluded files'` reproduces missing `builds.txt`. Temporary diagnostic logging exposed the underlying build failure: `Error: listen EPERM ... /T/tsx-501/52920.pipe`, Node 24.21.0. Other cases miss dist output or time out waiting for watcher events. Diagnostic edits were removed; production watcher and this test are unchanged. Environmental tsx IPC/FSEvents limitation. |
| `src/main/daemon/repro-13767-shell-ready-marker-lost-to-exec.test.ts` | 13 failed, 1 passed, 2 pre-existing skips. `V <file> -t 'releases at the real zsh profile'` reproduces `Timed out waiting for PTY output` with empty output. Environmental PTY restriction; requires host run. |
| `src/main/daemon/shell-ready.test.ts` | 3 failed, 16 passed, 1 pre-existing skip. `V <file> -t 'emits the shell-ready marker even'` reproduces empty PTY output instead of the ready marker. Environmental PTY restriction; requires host run. |
| `tests/e2e/helpers/recording-proxy.unit.test.ts` | 10 listener-dependent failures, 18 passes. `V <file> -t 'binds loopback'` reproduces `Failed to start server. Is port 0 in use?`. Sandbox listener restriction. The stale deleted-module import was ported as noted below. |

### Check-driven merge fixes

- `tests/e2e/helpers/{recording-proxy.ts,recording-proxy.unit.test.ts}` still imported the deleted `src/shared/child-process/run-process`. The path-literal lint gate exposed this remaining merge error; both now use upstream's `@orca/process-host` boundary. No proxy behavior changed.
- With B1 compile errors cleared, both Bun and the native compiler exposed 16 declaration-portability errors (`TS2883`, private Vitest `Procedure`) in three existing test helpers. `src/main/ipc/__mocks__/preflight-host-cli-status.ts` and `settings.test-support.ts` now name the public `Mock` type; `pty-pane-owner-swap.test-fixture.ts` reuses its existing typed stub for `updateSettings`. No production behavior changed. All four consuming suites (`preflight-host-cli-status`, `settings`, `pty-pane-restart-replace`, `pty-absent-pane-respawn`) pass.

## 5. Verification commands and results

Toolchain: Node **24.21.0**, Vitest **5.0.5**, pinned Bun via repository runners. Every command starts with:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH
```

Used the loader commands from the brief rather than pnpm's tsx CLI build hook. No install was attempted.

```sh
# In src/packages/process-host:
node --import tsx --conditions=orca-source scripts/build-dist.mjs
# At repository root:
rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json
```

**PASS, all three projects, zero errors.** The CLI/web cache files were already absent; plain `rm` reported that fact. Final output:

```text
✓ No type errors in 3,172 files
✓ No type errors in 17,844 files
✓ No type errors in 15,673 files
```

Log: `/tmp/axiom-upstream3-typecheck-final-clean.log`. The earlier native-compiler diagnostic run reproduced the same test-helper type errors before their annotations were fixed.

Direct test prefix (`V`):

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache
```

Final focused invocation:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache src/main/runtime/orchestration/db src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/cli/handlers/axiom src/cli/specs config/scripts/vitest-real-agent-home-write-guard.test.ts src/main/axiom/context-builder src/main/runtime/rpc/methods/orchestration src/cli/runtime/axiom-envelope.test.ts src/main/runtime/rpc/orchestration-session-caller.test.ts
```

**PASS:** 230 passed files, 1 pre-existing skipped file; **2,190 passed tests, 1 skipped**. The skip is `context-builder/planner-render.test.ts`, which requires `AXIOM_FIXTURE_REPO` and `AXIOM_PLANNER_EXAMPLE`; no frozen fixture inputs were invented. Log: `/tmp/axiom-upstream3-focused-final.log`.

Final deterministic triage/API-port invocation (`V` plus the following targets):

```text
config/scripts/macos-terminal-host-bundle.test.mjs
config/scripts/ci-pr-concurrency-keys.test.mjs
config/scripts/agent-state-rules-bundle.test.mjs
config/scripts/verify-skill-update-roundtrip.test.mjs
config/scripts/verify-cli-bin.test.mjs
config/scripts/pr-preflight-gates.test.mjs
config/scripts/pr-code-change-scope-format-route.test.mjs
config/scripts/mobile-web-terminal-engine-closure.test.mjs
config/scripts/main-entry-facade.test.ts
src/main/daemon/shell-ready-bash-wrapper.test.ts
src/main/daemon/bash-prompt-command-composition.test.ts
src/main/daemon/daemon-appimage-generation-launch.test.ts
src/main/daemon/macos-daemon-launchd.test.ts
src/main/runtime/rpc/methods/orchestration/worker/failed-start-retry-release.test.ts
src/main/runtime/rpc/methods/orchestration/worker/worker-start-readiness-settlement.test.ts
src/main/ipc/preflight-host-cli-status.test.ts
src/main/ipc/settings.test.ts
src/main/ipc/pty-pane-restart-replace.test.ts
src/main/ipc/pty-absent-pane-respawn.test.ts
src/cli/runtime/axiom-envelope.test.ts
```

**PASS:** 20 files, **291 passed tests, 1 platform skip**. Log: `/tmp/axiom-upstream3-triage-final.log`. This includes the final CLI helper refactor and the type-only fixture edits after the larger focused run.

| Check | Result |
|---|---|
| Conflict-marker scan below | PASS: no conflict markers. |
| `python3 .axiom-work/scripts/upstream3-seam-check.py` | PASS: **137 touchpoints, 0 dropped**. Baseline/checker unchanged. |
| `node config/scripts/check-vendor-egress-ratchet.mjs` | PASS: **465 current grandfathered pairs**, no new/grown pair. Three baseline entries are now stale after test branding fixes; the verifier's baseline was not edited or grown. |
| `node config/scripts/generate-rpc-params-catalog.mjs --check` | PASS, 41 Axiom methods remain. |
| `node config/scripts/check-reliability-gates.mjs` | PASS. |
| `node config/scripts/generate-bundled-skill-guides.mjs --check` | PASS. |
| `node config/scripts/generate-skill-bundle-manifest.mjs` | PASS (the package's verify command). |
| `git diff --check` | PASS. |
| Protected paths / temporary watcher instrumentation | Read-only diff inspection: no changes to protected files, baseline, watcher source or watcher test. |

Conflict-marker command (no output, grep exit 1 means no matches):

```sh
git grep --untracked -n -I -E '^(<{7}|[|]{7}|>{7})( |$)' -- . ':!.axiom-work/**'
```

### Full lint through its constituent commands

Executed all **32 stages** from `package.json`'s `lint` script directly in order, with `node_modules/.bin` on PATH, avoiding nested pnpm invocation. **Every stage exits 0**. Plain oxlint reports only the five inherited docs-site image/accessibility warnings; the warning-denying targeted audits pass.

```text
PASS  oxlint
PASS  audit:anti-slop
PASS  audit:code-quality:native
PASS  audit:code-quality:type-aware
PASS  check:reliability-gates
PASS  check:dead-classes
PASS  check:max-lines-ratchet
PASS  check:ts-nocheck-ratchet
PASS  check:runtime-electron-ratchet
PASS  check:vendor-egress-ratchet
PASS  check:focus-read-ratchet
PASS  check:layout-writer-ratchets
PASS  check:path-literal-ratchet
PASS  check:legacy-relay-fence-ratchet
PASS  check:unproven-pty-retirement-ratchet
PASS  check:id-only-store-write-ratchet
PASS  check:repo-host-read-ratchet
PASS  check:workspace-record-read-ratchet
PASS  check:host-list-render-ratchet
PASS  check:readme-local-links
PASS  check:node-runtime-pin
PASS  check:mobile-shared-dependency-versions
PASS  verify:rpc-params-catalog
PASS  verify:acp-protocol
PASS  verify:bundled-skill-guides
PASS  verify:skill-bundle-manifest
PASS  verify:localization-catalogs
PASS  verify:localization-extraction
PASS  verify:localization-coverage
PASS  check:process-host-imports
PASS  check:main-sync-spawn-ratchet
PASS  check:compat-boundary-imports
```

Exact expanded commands, exit codes and individual log names: `/tmp/axiom-upstream3-lint-verified-results.json`; logs: `/tmp/axiom-upstream3-lint-verified-*.log`.

## 6. D75 mobile evidence — deferred, no fixes

The requested combined `V config/scripts/build-mobile-web-app-bundle.test.mjs config/scripts/mobile-web-app` run was stopped with Ctrl-C (exit 130) after repeated 120–600 second render setup ceilings. It did not produce a complete final suite summary. The runner marked the following 23 suites failed with their tests skipped by setup. Apart from the isolated results stated below, the final error stacks were not printed before interruption; the hook-timeout diagnosis for those rows is based on their elapsed times and declared `beforeAll` limits, not a claim to have isolated their underlying cause. No mobile code was edited.

| Failing file | Observed error / isolated reproduction |
|---|---|
| `config/scripts/mobile-web-app/mobile-web-app-frame-budget-sweep.test.ts` | Playwright Chromium headless-shell executable missing (`chromium_headless_shell-1248`); **reproduces alone**, 3 tests skipped by failed setup. |
| `config/scripts/mobile-web-app/mobile-web-app-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-drawer-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-agent-history-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-session-render.test.mjs` | Setup failed at ~240 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-browser-pane-render.test.mjs` | Setup failed at ~300 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/preview/mobile-web-app-html-preview-render.test.mjs` | Setup failed at ~300 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-handoff-grants-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-source-control-render.test.mjs` | Setup failed at ~240 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-native-parity-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-tasks-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-mermaid-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-terminal-live-input-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-terminal-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-rich-markdown-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-stack-transition-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-clipboard-image-resize-render.test.mjs` | Setup failed at ~300 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-safe-area-render.test.mjs` | Setup failed at ~180 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/preview/mobile-web-app-media-preview-render.test.mjs` | Hook timed out in 120000 ms; **reproduces alone**, with an unhandled `Failed to start server. Is port 0 in use?` (`EADDRINUSE`, `listen`) from `createBundleServer`. Environmental listener failure; 3 tests skipped by failed setup. |
| `config/scripts/mobile-web-app/mobile-web-app-native-chat-visual-links.test.mjs` | Setup failed at ~300 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-held-press-render.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-files-render.test.mjs` | Setup failed at ~240 s (hook-timeout evidence); not rerun alone under D75. |
| `config/scripts/mobile-web-app/mobile-web-app-session-terminal-init.test.mjs` | Setup failed at ~600 s (hook-timeout evidence); not rerun alone under D75. |

Additional bounded evidence:

- `config/scripts/build-mobile-web-app-bundle.test.mjs` — isolated `V <file> -t 'resolves react-native to react-native-web'` **passes** (1 passed, 40 not selected). The full file did not finish in either combined run; **no full-file pass or isolated full-file failure is claimed**. Deferred under D75.
- `mobile-web-app-frame-budget-sweep.test.ts` — isolated whole-file failure is in `/tmp/axiom-upstream3-mobile-frame-alone.log`; no browser installation was attempted.
- `preview/mobile-web-app-media-preview-render.test.mjs` — isolated whole-file failure is in `/tmp/axiom-upstream3-mobile-preview-alone.log`; the listener exception explains that isolated timeout. Other render failures were not individually diagnosed or fixed.
- A follow-up batch of the bundle file and 23 remaining non-render/static files also did not complete before it was interrupted (exit 130), with no final results printed. Its exact selection is `/tmp/axiom-upstream3-mobile-static-targets.txt`; log `/tmp/axiom-upstream3-mobile-static.log`. These results remain **INCONCLUSIVE / deferred**, not passed.
- `mobile-web-app-terminal-font-render.test.mjs` and `mobile-web-app-working-spinner-render.test.mjs` had no completed result before interruption; deferred. The original combined output is `/tmp/axiom-upstream3-mobile.log`.

D75 makes these mobile results nonblocking for this Attempt. The table records one line for every observed failing file and explicitly distinguishes isolated reproduction from uninvestigated combined-run failure.

## 7. Remaining / handoff

- B1/D73 implementation is complete; none of the 53 old capability-related compile errors remains, and all 16 formerly failing focused files pass.
- Host verification is still required for the environmental failures in §4 and the updated Electron e2e fixtures. The Electron scenarios were not launched in this sandbox.
- D74 baseline stays unchanged; no vendor-egress exception was added. The three now-unused baseline entries can be pruned by the verifier if desired.
- D75 mobile failures remain deferred. Removing the embedded mobile bundle and reviewing new feature visibility/signing debt remain separate tasks, as directed.
- D73 §4 / DEF-25 socket-peer identity verification is not implemented. No new product decision is requested by this Attempt.
- Launcher may snapshot this working tree; no branch integration, target-branch delivery or Mission completion is claimed.
