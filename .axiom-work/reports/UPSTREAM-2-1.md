# UPSTREAM-2 / Attempt 1 — Worker submission

Branch: `axiom/attempt/UPSTREAM-2/1`. Base: `25f651953b68` (`main` / `HEAD`, unchanged).
Upstream inspection point: `ce2d60834c`; fork point: `3eb1adec2`.

Delivery state: **uncommitted semantic ports; independent verification and integration pending**.
No fetch, pull, push, cherry-pick, repository commit, dependency installation, or repository `.git` mutation was performed.
The initial working tree was clean.

## Objective, execution unit, and boundaries

The supplied UPSTREAM-2 brief is the execution plan under D56, after M2-08 and before M2-09. The product problem is automatic launch preparation removing another instance's shared hooks/trust, rollback erasing later saves, and linked-worktree launches broadening trust to the main checkout.

Execution followed the brief's four behavior changes: regression tests first; scoped semantic ports into existing services; focused verification and the required matcher negative control; repository gates; this handoff back to the launcher. No Control Plane authority, schema, RPC, runtime placement, or mapped seam changed. `docs/reference/orca-mapping.md` therefore stays unchanged.

## Ports and upstream differences

| Upstream reference | Axiom files | Taken / differences |
|---|---|---|
| `cfa43e7eab`, part ③ — retired commands | `src/main/codex/codex-hook-retired-commands.ts`, `.test.ts`; `codex-hook-legacy-cleanup.ts`, `.test.ts`; `hook-service-legacy-cleanup.test.ts` | The 72-line matcher is byte-for-byte upstream, including issue comments. The sweep uses it for trust collection, removal, and ownership detection. It removes only hash-proven trust belonging to retired entries it removed. All automatic grant-ledger cleanup is gone, including the no-hooks branch. |
| `cfa43e7eab`, part ③ — disabled launch / explicit opt-out | `src/main/codex/codex-real-home-hook-install.ts`, `.test.ts`; `codex-hook-service-implementation.ts`; `codex-hook-legacy-cleanup.test.ts`; `hook-service-trust-grant.test.ts` | Disabled ensure returns the lane without resolving HOME, opening either file, or mutating lane state (`pending` reports `removed`). `CodexHookService.remove()` invokes the explicit real-home removal path, serialized with installs, before acquiring the managed/system queues. Ledger-proven orphan trust is cleaned only by this explicit path. Existing opt-out tests now use that entry point. |
| `cfa43e7eab`, part ① — conditional rollback | `src/main/codex/codex-real-home-hooks-json.ts`, `.test.ts`; `codex-trust-config-rollback.ts`, `.test.ts`; `codex-user-hook-trust-rebase.ts`, `.test.ts`; the installer and legacy sweep above | Each hooks writer supplies its exact serialized generation to both the write and restore. Changed/deleted files are left alone with a path-only warning. The existing trust snapshot gains optional `generation`; successful rebase pins it before the following grant. For unknown Codex writes inside a failed session, restore captures the settled bytes and compares again before restoring. Existing atomic writes, modes, symlink targets, and in-process queues remain. |
| `9f4311598f` — workspace trust | `src/main/agent-trust-presets.ts`, `.test.ts` | `markCodexProjectTrusted` uses `canonicalize(workspacePath)`; the Git metadata resolver is deleted. Both system and managed runtime TOML files are still updated through the existing queue. Tests cover linked, bare-backed, separate-git-dir, and main-checkout layouts plus preserving an older main-checkout `untrusted` entry. Callers and `upsertProjectTrustLevel` are unchanged. |

The upstream commit's final tree includes later restructuring/deletions of the rollback implementation. This port follows the requested part ① behavior in Axiom's existing rebase/grant architecture; it does not replace that architecture.

### Upstream test fixture discrepancy

Contrary to the brief's self-contained-test assumption, upstream `codex-hook-retired-commands.test.ts:7` imports `buildCodexHookCommand` from `codex-hook-command-form.ts`, absent here. The two calls are replaced with the exact frozen output of that upstream builder for C: and D: Windows directories. All original matcher cases remain. The new test proves current Axiom POSIX commands (including the `command -p cat` drain), readable/WSL forms, and Windows bare shared paths in both slash directions never match. The matcher regexes are unchanged.

The optional `setSystemCodexHomeHookSweepSuppressed` gate remains. Its facade export and startup caller are unchanged. No startup, IPC, agent-hooks, or runtime source edits were needed.

Opt-out trace: a changed hooks setting in `src/main/ipc/settings.ts:246` (or runtime settings reconciliation / the explicit CLI enable-disable command) calls `applyAgentStatusHooksEnabled`, then `removeManagedAgentHooks`, then the Codex entry in `managed-agent-hook-registry.ts:86`, then `CodexHookService.remove()`. Launch preparation, session resume, and startup still call `ensureRealHomeCodexHookState`; its disabled branch no longer reaches a sweep.

## Verification

Toolchain: `/Users/henry/.nvm/versions/node/v24.21.0/bin` prepended to PATH; Node `v24.21.0`, `pnpm --version` reports `12.0.0`, Vitest `4.1.11`. Every changed test that writes files uses temporary directories/HOME/userData. The UPSTREAM-1 real-home guard remains enabled and unchanged.

Before typechecking, ran exactly:

```sh
rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo
```

| Check | Result / evidence |
|---|---|
| Regression red phase | Initial behavior regressions failed before production edits. `/tmp/UPSTREAM-2-red.log`; six sweep assertions in `/tmp/UPSTREAM-2-sweep-red.log`; six rollback regressions in `/tmp/UPSTREAM-2-rollback-red.log` (after correcting test spy setup). |
| Focused nine-file suite | **PASS** — 9 files, 112 tests. Covers retired/current forms, sweeps, service opt-out, grant/rebase, rollback, and workspace trust. `/tmp/UPSTREAM-2-focused.log`. |
| `pnpm test config/scripts/vitest-real-agent-home-write-guard.test.ts src/shared/axiom-contract src/main/runtime/rpc/methods/axiom` | **PASS** — 17 files, 106 tests. Additional brief verification targets, including the unchanged real-home write guard. `/tmp/UPSTREAM-2-contract-tests.log`. |
| Required negative control | **Expected FAIL** — temporarily replaced the sweep's retired matcher with `createManagedCommandMatcher(getCodexManagedScriptFileName())`; both `current shared entry survives` cases fail because the current entry is removed. 2 failed / 7 unselected. Fixed file restored byte-for-byte in `finally`. `/tmp/UPSTREAM-2-negative-control.log`; focused suite passed after restoration. |
| `pnpm test src/main/codex src/main/agent-hooks src/main/startup src/main/ipc src/main/agent-trust-presets.test.ts src/cli/handlers/agent-hooks.test.ts src/main/axiom` | **FAIL** — final run: 835 passed / 56 failed / 6 skipped files; 8,678 passed / 282 failed / 40 skipped tests; 16 unhandled errors, 120.81 s. No changed test file fails. Initial run had 58 failing files; two stale sweep expectations in `hook-service-trust-grant.test.ts` were corrected and pass. Final rerun used `ORCA_BACKGROUND_LAUNCH=1`. Logs: `/tmp/UPSTREAM-2-tests-initial.log`, `/tmp/UPSTREAM-2-tests.log`. |
| Clean-cache `pnpm tc:node` | **PASS**. `/tmp/UPSTREAM-2-tc-node.log`. |
| Clean-cache `pnpm tc:cli` | **FAIL**, TS6307 for three modules missing from the CLI project's explicit include list. No type suppression or out-of-scope config edit. `/tmp/UPSTREAM-2-tc-cli.log`. |
| `pnpm run check:code-quality:changed` | **PASS** — final run: zero new findings across 17 source files, including SAFETY/casting checks. Its automatic comparison base is `da8477ec5493`; the Task scope check separately uses `main`. `/tmp/UPSTREAM-2-quality.log`. |
| Full `pnpm lint` | **PASS**, including all chained audits, ratchets, RPC catalog and localization checks. `/tmp/UPSTREAM-2-lint.log`. |
| `pnpm run verify:rpc-params-catalog` | **PASS**. `/tmp/UPSTREAM-2-rpc.log`. |
| Scope, exact upstream matcher, diff whitespace | **PASS** — `git diff --name-only main` plus `git ls-files --others --exclude-standard`: 14 tracked modifications + 5 new files, all within scope. `git diff --check` passes. Protected paths and both CLI tsconfigs are unchanged. Matcher byte equality against `git show cfa43e7eab:src/main/codex/codex-hook-retired-commands.ts` passes; SHA-256 `2e725a492936bf89699241cfd14cb2c65d5e980ef248abd51491715d216ca49c`. |

The final clean typecheck rerun removed the regenerated node/CLI build-info files with plain `rm`; the web build-info file remained absent from the initial three-file cleanup.

### Broad-suite failure evidence

The complete failure list and stacks remain in `/tmp/UPSTREAM-2-tests.log`. None of the 56 failed files was edited by this Task. The failures are not waived or reclassified as passing:

| Observed failure | Examples / evidence |
|---|---|
| Sandbox denies listening sockets | Many AgentHookServer suites, `ipc/local-network-connection-test.test.ts`, `ipc/mobile.test.ts`, `ipc/pty/daemon-late-exit.test.ts`: `listen EPERM` on `127.0.0.1` or a temporary Unix socket. The run reports 16 unhandled errors. |
| Process identity / process inspection unavailable | `agent-hooks/managed-hook-install-lock.test.ts`, `managed-hook-runtime.test.ts`, `codex/codex-state-db-backfill-recovery.test.ts`: `Could not identify the managed-hook installer process`; the latter also sees no owner lock file. |
| Host-dependent process / timing assertions | `codex/codex-structured-turn-processes.integration.test.ts` process termination returns false; `codex-accounts/legacy-wsl-runtime-auth-drain-apply-script.test.ts` interrupted-process exit assertion; managed-hook timeout / live WSL relay / IPC reconnect tests time out. These require host reruns; not all have independently proven root causes here. |
| Filesystem and shell host behavior | `ipc/filesystem-watcher-real.test.ts` and `worktree-base-directory-poller.test.ts` miss filesystem events; the run reports FSEvents startup failure. `pty-login-shell-startup-commands.test.ts` falls back to `/bin/zsh` instead of `/usr/bin/login`. |
| Electron cannot run here | `startup/single-instance-lock-exit.electron.test.ts`: all three probes produce no expected startup marker, consistent with the brief's sandbox limitation. |

The remaining Codex failures are only `codex-state-db-backfill-recovery.test.ts` and `codex-structured-turn-processes.integration.test.ts`; the changed hook/trust suites all pass. No unrelated implementation or environmental test was modified to mask these failures.

The focused suite command was:

```sh
pnpm test src/main/codex/hook-service-trust-grant.test.ts src/main/codex/codex-hook-retired-commands.test.ts src/main/codex/codex-hook-legacy-cleanup.test.ts src/main/codex/hook-service-legacy-cleanup.test.ts src/main/codex/codex-real-home-hook-install.test.ts src/main/codex/codex-real-home-hooks-json.test.ts src/main/codex/codex-trust-config-rollback.test.ts src/main/codex/codex-user-hook-trust-rebase.test.ts src/main/agent-trust-presets.test.ts
```

## Out-of-scope edit deliberately stopped

**`config/tsconfig.cli.json:127`**, in `include` (inherited by `config/tsconfig.tc.cli.json:2`), needs these three entries:

```json
"../src/main/codex/codex-hook-retired-commands.ts",
"../src/main/codex/codex-real-home-hooks-json.ts",
"../src/main/codex/codex-real-home-hook-install.ts"
```

Reason: the CLI includes the hook service/legacy cleanup. The retired sweep imports the new matcher and guarded hooks restore; the service's explicit remove path now reaches the real-home installer. TypeScript composite projects require these transitive modules to be included. Diagnostic import sites: `codex-hook-legacy-cleanup.ts:17`, `:23`, and `codex-hook-service-implementation.ts:31`.

The Task forbids edits outside its allowlist and explicitly requires leaving the failing check intact. Both config files remain unchanged. This is a required launcher/follow-up edit before a green CLI gate, not a waived check.

## Limitations, deferred work, and handoff

- Cross-instance `~/.orca/managed-hook-install.lock` (part ②) is **not ported**, per the single-instance V1 scope. Generation comparison is not a cross-process atomic transaction.
- As specified upstream, if Codex itself wrote unknown TOML bytes inside a failed session, the settled file becomes the comparison generation. An edit already included in those settled bytes cannot be distinguished from Codex's write and can still be rolled back. Known rebase generations and exact hooks generations protect later edits.
- No real Codex binary contract test, Windows execution, Electron host smoke, packaging, or Mission-level integration was performed. The required broad suite is not claimed green; host verification must rerun it.
- `5b3366f78e` (a), launch-environment HOME selection, remains deferred because these callers do not carry launch env.
- OpenCode `88e9517eb1` / `990b0ed5cd`, the `761d63a4e5` launch series, Claude `21d4ae9448`, and Electron 43.7.8 remain outside this Task. No dependencies or provider configuration changed.
- `docs/decisions/UPSTREAM_SYNC.md` records the four ports and corrects the superseded triage statements about adding main-checkout trust, launch-env HOME, and OpenCode readiness prerequisites.
- Independent verifier/launcher owns candidate creation, the CLI include-list follow-up, host-only checks, and the milestone completion decision. This report does not promote the Task or assert Mission completion.
