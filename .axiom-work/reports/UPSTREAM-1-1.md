# UPSTREAM-1 / Attempt 1 — upstream intake report

Date: 2026-10-19 (America/Denver). Worker: Axiom Worker (Codex).

## Delivery state

**File changes prepared; commit delivery BLOCKED by the sandbox. Not accepted or integrated.**

- Assigned checkout: `/Users/henry/Documents/Axiom`, branch `axiom/attempt/UPSTREAM-1/1`.
- Starting `HEAD` and `main`: `2c98afc76c58cf5c8b36e61637cc240538e8641c`; the checkout was clean and `main..HEAD` was empty.
- Read D56, `docs/decisions/UPSTREAM_SYNC.md`, the Task brief and verification sidecar, repository instructions, and test subsystem instructions.
- The exact first command was `git -c user.name="Axiom Worker" -c user.email=axiom-worker@localhost -c core.hooksPath=/dev/null cherry-pick -x 2576783d4d`. It failed before applying anything: `Unable to create '/Users/henry/Documents/Axiom/.git/index.lock': Operation not permitted` (exit 128). The session gives `.git` read-only access and offers no approval escalation.
- No commits, index changes, fetches, pulls, pushes, dependency installs/rebuilds, history rewrites, or broad cleanup were performed. All requested source/config changes and this report remain uncommitted. `git log main..HEAD` still has **zero**, not four, commits.
- To continue useful work without writing Git metadata, the first two source patches were applied with `git apply`; the third was applied with the additive resolution below; the fourth was semantically ported. This is **not** a claim that the requested `cherry-pick -x` commits exist.

The launcher must produce the requested four commits in order and then commit this report. The intake register is unchanged because it is outside this Task's allowed file list and integration is not complete.

## Ordered change 1 — Copilot config permissions

Upstream: `2576783d4dc4c25f5c3ed004767967985b867571`.

Files:

- `src/main/agent-trust-presets.ts`
- `src/main/agent-trust-presets.test.ts`

Applied the upstream patch without content conflicts. Atomic Copilot config writes now use mode `0600`; the upstream tests cover existing token-bearing and newly created config files under a permissive umask. The two new tests initially carry upstream's two-argument API calls; change 4 adapts those calls to this tree's existing one-argument API while keeping temporary-home isolation. Production launch-home plumbing was not imported.

## Ordered change 2 — Linux keyring selection

Upstream: `23a874a2a19b5e95f59647761836a7a11547eec7`.

Files:

- `src/main/startup/browser-process-user-agent-ordering.test.ts`
- `src/main/startup/linux-keyring-backend-selection.ts`
- `src/main/startup/linux-keyring-backend-selection.test.ts`
- `src/main/startup/linux-secret-service-probe.ts`
- `src/main/startup/linux-secret-service-probe.test.ts`
- `src/main/startup/select-linux-keyring-backend.ts`
- `src/main/startup/select-linux-keyring-backend.test.ts`
- `src/main/startup/main-process-preflight.ts`

Applied the upstream patch without content conflicts. Six files are new, and the two existing files have additive changes. Selection runs before installing the secret store, preserves explicit/recognized desktop choices, and selects libsecret only after the bounded out-of-process probe finds an unlocked collection. No credential values are queried by that probe. The Linux behavior was tested through upstream's mocks; no live Linux desktop was available.

## Ordered change 3 — awaited, bounded trust preflight

Upstream: `983250a12e9693876bd6721e9999f0d78543f75a`.

Files:

- `config/reliability-gates.jsonc`
- `src/main/agent-trust-write-deadline.ts`
- `src/main/ipc/agent-trust.ts`
- `src/main/ipc/worktree-remote.ts`
- `tests/e2e/agent-trust-completion.unit.test.ts`

The deadline helper, IPC patch, and new 15-test suite applied without conflicts. The two pre-identified conflict surfaces were resolved as follows (no Git cherry-pick conflict state was entered because `.git` is read-only):

1. **`config/reliability-gates.jsonc`:** inserted only the new `agent-session.trust-preflight-completion` gate before `agent-session.journal-streaming-replay`. Preserved every existing Axiom entry. A three-way file comparison included the adjacent, previously removed `ephemeral-vm-recipe.output-tail-parity` gate in its conflict region; that unrelated gate stays removed. The new gate's `motivatingLinks` value is `src/main/ipc/agent-trust.ts`, preserving the source reference without adding a vendor URL. Initial full lint proved that copying the upstream URL increased `config/reliability-gates.jsonc:stablyai` from 268 to 269; the local-path resolution keeps the existing ratchet intact. No baseline or exemption was changed.
2. **`src/main/ipc/worktree-remote.ts`:** retained all Axiom lines, added the deadline-helper import, and replaced only the discarded Codex trust promise with the upstream bounded `await` and its explanatory comment. The file-level three-way comparison merged this surface cleanly; its final diff is exactly those upstream hunks.

The helper preserves the 20-second deadline, best-effort failure handling, remote ownership, and late-rejection handling. It does not cancel a slow trust write or alter the other launch call sites.

## Ordered change 4 — semantic test-isolation port

Upstream: `5b3366f78eb941546e06e142e4d0cec90d644392`; **parts (b) and (c) only**.

Prepared commit subject: `port(upstream): unit tests can no longer write the real agent or Orca home`. Its prepared body names the full upstream SHA and explicitly defers part (a).

### Taken

| File | Adaptation |
|---|---|
| `config/scripts/vitest-real-agent-home-write-guard.ts` | Copied verbatim from upstream, then added only `'.axiom'` and `join(home, '.config', 'axiom')`. All other guard semantics are byte-for-byte unchanged. |
| `config/scripts/vitest-real-agent-home-write-guard.test.ts` | Copied verbatim, byte-for-byte. |
| `config/vitest.config.ts` | Guard is the first `setupFiles` entry; all existing entries retained. |
| `config/tsconfig.node.json` | Includes the guard, retaining the existing include list. |
| `config/scripts/bun-profile-change-scope.mjs` | Retained upstream's build-input entry for the new setup file; no workflow file changed. |
| `src/main/codex/codex-ai-vault-session-resume.test.ts` | Per-test temporary `ORCA_USER_DATA_PATH`, restored and removed afterwards. |
| `src/main/codex/codex-legacy-session-resume.test.ts` | Same temporary userData isolation. |
| `src/main/codex/codex-trust-config-concurrent-launch.test.ts` | Retained the existing temporary `os.homedir()` mock and userData setup; also stubbed `HOME`/`USERPROFILE` to that temp home with cleanup. Skipped calls to the absent `getLocalCodexTrustConfigFiles` API. |
| `src/main/codex/hook-service-wsl-runtime.test.ts` | Temporary userData for the trust ledger, using existing temp-root cleanup. |
| `src/main/runtime/claude-agent-teams-shim-env.test.ts` | Temporary `HOME`/`USERPROFILE` for the native shim test; retained Axiom's CLI names. |
| `src/main/runtime/orca-runtime-tests/terminal-creation-and-readiness-part-04.spec.ts` | Temporary home for native Claude Agent Teams restoration, with `onTestFinished` cleanup. |
| `src/main/runtime/rpc/methods/structured-agent-session-adoption-replay.test.ts` | Temporary home and userData for adoption/pre-trust, with environment cleanup. |
| `src/main/agent-trust-presets.test.ts` | Retained the existing temp-home mock/userData; stubbed `HOME`/`USERPROFILE` to that same temp home. The two Copilot tests added by change 1 now call the current one-argument API. |

The upstream guard continues to obtain the account home from `os.userInfo()`, retain inherited live app/agent paths as protected roots before clearing their environment variables, block mutating fs calls, and fail even when writers swallow the initial error. The inherited-userData protection is retained for the live `axiom-dev` path. Child-process writes remain outside this upstream guard's coverage.

### Skipped / deferred

- Part (a): no launch-home parameter threading or trust-subsystem refactor. `src/main/agent-trust-presets.ts` contains only change 1's mode fix; `src/main/codex/codex-home-paths.ts` is unchanged.
- Missing upstream modules were not created: `src/main/agent-workspace-trust.ts` and `.test.ts`; `src/main/execution-host-workspace-trust.ts` and `.test.ts`; `src/main/qoder/hook-service.test.ts`; `src/main/qoder/workspace-trust.ts`; `src/relay/agent-workspace-trust-spawn.ts` and `.test.ts`.
- Test hunks that remove this tree's temporary `os.homedir()` mocks or depend on the absent launched-home/trust-config APIs were not imported. Their isolation intent was implemented with this tree's existing APIs instead.
- Threading launch homes through `ipc/agent-trust.ts`, `ipc/worktree-remote.ts`, and `runtime-worktree-agent-startup.ts` remains the next trust-subsystem intake.

### Additional tests caught by the guard

**None beyond the explicitly ported isolation changes.** The full requested targeted run completed with **zero** `[vitest real-agent-home guard]` violations after the port. No additional existing test file was modified under the guard-proven exception. The guard's own eight self-tests passed, including refusal recording and protection despite a swapped HOME.

## Verification

Environment: macOS arm64; Node `v24.21.0`; pnpm `12.0.0`; Vitest `4.1.11`; Git `2.54.0 (Apple Git-157)`.

The initial default shell selected Node 20 and a non-executable pnpm placeholder. That attempt stopped before tests. All substantive checks used the existing launcher toolchain, without installation:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH
export COREPACK_ENABLE_NETWORK=0
```

All test commands also set `ORCA_BACKGROUND_LAUNCH=1`. Logs and prepared patch artifacts are in `/private/tmp/axiom-upstream-1.6Ga3hD/`.

| Check | Result / evidence |
|---|---|
| Requested broad `pnpm test` command (exact targets below) | **FAIL:** 772 files passed, 14 failed, 6 skipped; 7,752 tests passed, 35 failed, 32 skipped; 9 unhandled environment errors. 144.69 s. `targeted-guard-first.log`. No guard violations. |
| Focused 13 changed suites | **PASS:** 146 tests passed, 1 skipped, 13 files passed. `focused.log`. |
| Changed runtime fragment through its real `orca-runtime.test.ts` entry point | **PASS:** 1 selected test passed, 1,309 unselected tests skipped. `runtime-fragment.log`. Passing a `.spec.ts` fragment directly is not sufficient because the Vitest include list discovers its `.test.ts` entry point. |
| Sidecar contract/RPC targets | **PASS:** 87 tests, 15 files. `sidecar-contract-tests.log`. |
| Bun profile scope test | **PASS:** 36 tests, 1 file. `bun-scope-tests.log`. |
| Clean-cache `pnpm tc:node` | **PASS**, exit 0. `tc-node.log`. |
| Clean-cache `pnpm tc:cli` | **PASS**, exit 0. `tc-cli.log`. |
| `pnpm run check:code-quality:changed` | **PASS**, exit 0: zero new findings across 25 source files in all seven scans. `quality-final.log`. |
| Full `pnpm lint` | **PASS**, exit 0 on the final tree including the Bun scope entry. `lint-final.log`. Includes vendor-egress (430 grandfathered pairs), reliability gates, RPC catalog, and localization checks. Initial vendor-link failure was resolved as documented above. |
| Guard source comparison | **PASS:** guard equals upstream plus exactly the two authorized path additions; guard self-test equals upstream byte-for-byte. |
| Protected-path diff and scope inspection | **PASS:** 27 source/config files plus this report are allowed; protected paths unchanged; all original reliability entries preserved; `git diff --check` passes. `scope-and-provenance.log`. |
| Ordered patch reconstruction | **PASS:** all 27 source/config files reproduced byte-for-byte from starting HEAD by the four ordered patches. `patch-composition.log`. No Git repository or commits were created in the temporary verification fixture. |
| Four commits / three cherry-pick trailers | **BLOCKED:** no commits created because `.git/index.lock` cannot be written. Prepared messages are not committed provenance. |

Cache removal was run exactly before either typecheck:

```sh
rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo
```

The broad test command was:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/codex src/main/host src/main/startup src/main/ipc src/main/agent-trust-presets.test.ts src/main/runtime/claude-agent-teams-shim-env.test.ts src/main/runtime/rpc/methods/structured-agent-session-adoption-replay.test.ts config/scripts/vitest-real-agent-home-write-guard.test.ts tests/e2e/agent-trust-completion.unit.test.ts src/main/axiom
```

Additional test commands:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/agent-trust-presets.test.ts src/main/startup/browser-process-user-agent-ordering.test.ts src/main/startup/linux-keyring-backend-selection.test.ts src/main/startup/linux-secret-service-probe.test.ts src/main/startup/select-linux-keyring-backend.test.ts src/main/codex/codex-ai-vault-session-resume.test.ts src/main/codex/codex-legacy-session-resume.test.ts src/main/codex/codex-trust-config-concurrent-launch.test.ts src/main/codex/hook-service-wsl-runtime.test.ts src/main/runtime/claude-agent-teams-shim-env.test.ts src/main/runtime/rpc/methods/structured-agent-session-adoption-replay.test.ts config/scripts/vitest-real-agent-home-write-guard.test.ts tests/e2e/agent-trust-completion.unit.test.ts
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/runtime/orca-runtime.test.ts -t 'restores captured native Claude Agent Teams mode with fresh service env'
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/shared/axiom-contract src/main/runtime/rpc/methods/axiom
ORCA_BACKGROUND_LAUNCH=1 pnpm test config/scripts/bun-profile-change-scope.test.mjs
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/ipc/pty/daemon-late-exit.test.ts
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/ipc/pty-runtime-hidden-at-spawn-mark.test.ts src/main/codex-accounts/legacy-wsl-runtime-auth-drain-apply-script.test.ts
```

### Broad-suite failures and remaining risks

These files were not edited. The full acceptance command is not green except Electron in this sandbox, so host verification remains required.

| File(s), relative to `src/main/` | Evidence / disposition |
|---|---|
| `startup/single-instance-lock-exit.electron.test.ts` | 3 failures: real Electron does not reach the probe. Known sandbox Electron/SIGABRT limitation from the Task; unchanged. |
| `ipc/pty/daemon-late-exit.test.ts` | All 9 failures are Unix-socket `listen EPERM`; independently reproduced in `daemon-late-exit-first.log`. |
| `ipc/local-network-connection-test.test.ts`, `ipc/mobile.test.ts` | TCP/Unix-socket `listen EPERM`. |
| `ipc/emulator-frame-stream-socket-lifetime.test.ts`, `ipc/runtime-environment-request-connections.test.ts`, `ipc/runtime-environment-status-connection.test.ts` | Socket tests time out with associated uncaught `listen EPERM` errors. |
| `ipc/filesystem-watcher-real.test.ts` | Native watcher reports `Error starting FSEvents stream`, then times out. |
| `ipc/worktree-base-directory-poller.test.ts` | Three macOS native stream cases do not observe events; requires host rerun. |
| `codex/codex-state-db-backfill-recovery.test.ts` | Process identity lookup fails, and a dependent lock-file wait fails. Sandbox separately refused `ps` with `operation not permitted`. |
| `codex/codex-structured-turn-processes.integration.test.ts` | Two process-tree termination assertions fail; requires host process-table access for verification. |
| `ipc/pty-login-shell-startup-commands.test.ts` | macOS login preflight reports failure and chooses `/bin/zsh` instead of `/usr/bin/login`; requires host rerun. |
| `ipc/pty-runtime-hidden-at-spawn-mark.test.ts` | One 1-second admission wait failed under the broad run. All 9 tests passed on focused rerun; no code changed. |
| `codex-accounts/legacy-wsl-runtime-auth-drain-apply-script.test.ts` | The abrupt-session-link-interruption case returns status 0 instead of nonzero; reproduced on focused rerun (`unresolved-recheck.log`: 42 passed, 1 failed across two files). No guard violation. Root cause is not established; this is an unresolved failure, not claimed as a confirmed environment exception. Fixing this test/harness is outside the allowed edits unless a real-home write is demonstrated. |

The remaining D56 host validation (full suite, provider launch e2e, and packaged network canary) is not claimed here. No direct production-code fallback, guard relaxation, test skip, or new exemption was used to obtain passes.

## Launcher handoff artifacts

Preserve `/private/tmp/axiom-upstream-1.6Ga3hD/` before temporary-directory cleanup. It contains:

| Intended order | Patch | Prepared commit message |
|---|---|---|
| 1 | `01-copilot.patch` — exact upstream diff | `01-message.txt` — upstream body plus full cherry-pick trailer |
| 2 | `02-linux-keyring.patch` — exact upstream diff | `02-message.txt` — upstream body plus full cherry-pick trailer |
| 3 | `03-trust-resolved.patch` — additive Axiom resolution and local source link | `03-message.txt` — upstream body plus full cherry-pick trailer |
| 4 | `04-real-home-port.patch` — parts (b)/(c), including current-API test adaptations | `04-message.txt` — requested prefix, upstream SHA, part (a) deferral |

`03-trust-original.patch` is retained only for comparison, not as the resolved change. The report is not in any source patch. The four source patches are ordered and must not be collapsed into one commit. Host-side Git delivery and independent acceptance remain outstanding.

Patch SHA-256 identities:

```text
35b2e2d681ea46f5077f91fcbcaf63a3b224fd36832336f2c9941abaaa7861d8  01-copilot.patch
73a688f1b80de149e933f74d9ba4212c25f131984eda3a3bc1d6d6217d3ffa7f  02-linux-keyring.patch
284b196428eacc5b715c511dcc3a5cfa34a1dc63f20c34a74e8522818833eb73  03-trust-resolved.patch
9eb9d73ae595719d386b63d2581adb8ad11d4108c7bf0d79a85f25446814e686  04-real-home-port.patch
```
