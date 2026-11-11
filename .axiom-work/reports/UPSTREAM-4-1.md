# UPSTREAM-4 · Attempt 1 · 2026-11-11

The four semantic ports are implemented in the assigned worktree and left uncommitted. This is a Worker handoff for independent verification, not acceptance or integration. Full host verification remains necessary: sandbox restrictions block the standard test/typecheck prebuild and seven existing daemon tests. Some explicitly requested negative/control cases already pass on main; they are identified below rather than represented as failing regressions.

## Authority, baseline, and execution boundary

- Read D56, including its 2026-11-11 exception row, and `UPSTREAM_SYNC.md` section `2026-11-11 · 初筛与 UPSTREAM-4 分诊`; inspected all four upstream commits with local `git show`.
- Assigned branch: `axiom/attempt/UPSTREAM-4/1`; initial working tree clean. Actual initial HEAD and local main: `bce62c3f785d91727be316d5484623b11fee93ac`, newer than the brief's verifier snapshot `df22ff55e7`. Baseline test results below use that actual main.
- Execution unit is the supplied UPSTREAM-4 brief, not a new feature or milestone. Plan followed: inspect shared causes/callers and upstream changes → add regressions → run against unchanged main implementation → port behavior → rerun both runners and repository gates → document host handoff.
- No fetch, pull, push, cherry-pick, commit, branch/worktree creation, dependency install/rebuild, new dependency, `.git` mutation, or cross-provider delegation. The launcher owns the commit. No production Axiom, renderer, configuration, package, lockfile, workspace, or mobile edits.
- Worker write scope is enforced by final diff inspection, not a runtime guarantee. No out-of-scope source edit was needed. The optional `daemon-host-relocation.ts` change is comment-only.

## Ports and files changed

| Upstream | Files changed | Behavior and differences from upstream |
|---|---|---|
| `f0e7eaa070` / #38358 | `src/main/runtime/orchestration/db/orchestration-db.ts`, `lifecycle-transition.ts`, `lifecycle-transition.test.ts`; new `src/main/axiom/db/axiom-store-rollback.test.ts` | Added `temp_store = MEMORY` beside existing pragmas with a one-line reason. Rollback returns when `!db.isTransaction`. The runner is unchanged. TEMP `RAISE(ROLLBACK, 'database or disk is full')` triggers exercise real SQLite top-level and nested transactions, including AxiomStore's existing write boundary; rows remain unchanged and transactions are ended. The Axiom test is separate to keep the existing store suite focused. |
| `220347cae0` / #39825 | `src/main/daemon/daemon-pid-file-parse.ts`, `daemon-stale-kill.ts`, `daemon-pid-file-parse.test.ts`, `daemon-health.test.ts`, `daemon-host-relocation.ts` (comment only) | Legacy numeric records require a safe positive integer; JSON handling remains unchanged. Track malformed separately from missing records, probe first, reclaim only on `endpointIsProvenDead`, and retain/withhold replacement on connected or unknown. Parsed-owner removal and content/ownership fencing remain unchanged. Kept the existing flat directory, not upstream's `endpoint/identity/` or `launch/` layout. Updated the now-stale relocation comment. |
| `71404c99be` / #40992 | `src/main/codex/codex-usage-limits.ts`, `codex-usage-limits.test.ts`; `src/main/axiom/execution/codex-rollout-limit.test.ts` | `failure()` passes whether the error is `usageLimitExceeded`; the fallback selects the fullest live window(s) at ≥90 only when none was reported at ≥100. Preserves at-100 behavior and `rateLimitExceeded` semantics. Uses this tree's existing `error` variable and file path. Additional 89/90 boundary and at-100 controls accompany upstream's cases. Only tests changed in the rollout path; no app-server read, polling, provider activation, or egress. |
| `0ded87821d` / #36205, shared half | `src/shared/git-remote-error.ts`, `git-remote-error.test.ts` | Strip ANSI before redaction in both existing entry points. Port upstream's fixed-`://` scan, scheme check, sticky user/password matcher, and HTTP(S) token matcher with query/fragment boundaries. Passwords containing `@`/`:` redact fully; ports, paths, query strings, fragments, Unicode, and SSH `git@` survive. Kept Axiom's existing function names/signatures; no upstream classification API or layout changes. |
| Intake evidence | `docs/decisions/UPSTREAM_SYNC.md`; `.axiom-work/reports/UPSTREAM-4-1.md` | Added `已应用（UPSTREAM-4）` below the triage, listing provenance, destinations, omissions, and uncommitted handoff state. |

Not taken: the renderer half of #36205; `6c38b40984`, `bbb563e83a`, `e182f1daa2`, `a4e600a663` (push diagnostics, stale-lease display, i18n); upstream directory moves; dependencies, Electron updates, and native patches reserved for UPSTREAM-4b. No new kernel import from Axiom. The referenced `docs/reference/git-compatibility.md` is absent in this checkout; this port adds no Git commands or capability requirements.

## Existing tests touched

- `lifecycle-transition.test.ts`: retained all existing transition tests and added pragma/rollback regressions, using a two-row table to preserve the two required transaction titles.
- `daemon-pid-file-parse.test.ts`: retained the three salvage tests; added legacy-number boundaries and JSON compatibility checks.
- `daemon-health.test.ts`: replaced the single truncated-record case with the required two-record table and added a probe-order assertion. Added the connected/unknown table. Its local `daemon-pid-identity` spy returns `mismatch` so the old pid-0 path cannot hide the unknown-probe regression behind a sandbox-denied process inspection; it is restored in `finally`. No Node built-in namespace export is spied on.
- `codex-usage-limits.test.ts`: retained existing journal translation and exhausted-window coverage; added upstream's lagging-report cases and threshold controls.
- `codex-rollout-limit.test.ts`: added 97% and 50% real rollout fixtures. Its existing `vi.mock`/`importOriginal` filesystem replacement was already present on actual main and remains unchanged.
- `git-remote-error.test.ts`: retained existing tests; added URL structure cases and both CSI/OSC redaction through raw and normalized submodule details. The timing test uses upstream's 65,536 ANSI-wrapped letters plus an ANSI-split credential in the final URL, so main fails its output assertion as well as the test protecting against quadratic behavior after ANSI stripping. Without that final split, upstream's timing test alone already passes on Axiom main because main does not strip ANSI yet.

## Main baseline failures and controls

Before implementation, both runners reproduced the defects. After strengthening the daemon tests, reran the final tests with the six production port files temporarily loaded from `git show main:<path>`; a `finally` block restored all six working files byte-for-byte. No index/ref changes. Both final baseline runs: **117 tests, 27 failed, 90 passed**; 20 failures exercise the ports, seven are pre-existing sandbox-dependent daemon failures.

| Required title | Exact baseline failure / control |
|---|---|
| `reports the failure when SQLite already ended the transaction` | `.toThrow('database or disk is full')` receives `cannot rollback - no transaction is active`. |
| `reports the failure when SQLite ended the transaction inside a savepoint` | Same assertion receives `no such savepoint: aborted_test`. |
| `keeps temp storage in memory` | Pragma `.toBe(2)` receives `0`. |
| `an Axiom write transaction reports the SQLite error that ended it` | Original-error assertion receives `cannot rollback - no transaction is active` on the first, top-level iteration; after the fix both top-level and savepoint iterations assert the original error, ended transaction, and unchanged Mission row. |
| `parses a legacy record only as a positive integer` | First `.toBeNull()` receives the parsed pid-0 object for `''`; the test also rejects whitespace, zero, negative, fractional, unsafe, and infinite values. |
| `removes a malformed pid record %j` | `'{truncated'`: `existsSync(...).toBe(true)` inside the probe receives false (removed too early). `''`: final `existsSync(...).toBe(false)` receives true (never reclaimed). |
| `keeps an empty pid record while its endpoint probe is %s` | `unknown`: outcome equality receives `liveOwnerSurvived: false` instead of true. `connected` is a compatibility control and already passes main. |
| `takes the reset from a nearly spent window when the rejection outruns the last report` | First 99% assertion receives undefined instead of `{ window: 'session', resetsAt }`. Post-port assertions also check 90%, 89%, 50%, rate-limit vs usage-limit rejection, at-100, and an expired primary beside a live 95% weekly window. |
| `takes the reset of a nearly spent window from the last rollout report` | 97% rollout result is undefined instead of the session/reset object. |
| `gives no reset when the last rollout report is below the nearly spent mark` | Already passes on main: 50% has no reset by design. This requested negative control cannot honestly be described as a failing regression. |
| `redacts credentials that an ANSI escape sequence splits` | First normalized output equality still contains `user:sec\x1b[1 qret@` instead of the redacted URL. |
| `preserves URL structure when redacting %s` | Eight rows fail equality: complex user/password plus port; SSH complex password; query, fragment, and path after a complex password; query/fragment `@` without authority credentials; multiple URLs with complex credentials. Main either leaves `ss:word@` behind or erases query/fragment structure. Ten other rows already pass (simple HTTP(S) tokens, custom scheme, SSH username, SCP form, numeric/partial-numeric scheme, slash/whitespace boundaries, repeated `@` token case); retained as compatibility controls. |
| `bounds redaction time when ANSI stripping joins a long scheme-like word` | Main's normalized-output equality leaks the split credential; the fixed result must also finish within 2,000 ms. |

The literal requirement that *every* new test/table row fail on main conflicts with the explicitly required unchanged-behavior cases. Those controls are retained and reported honestly; no artificial failing assertion was added to them.

## Verification commands and results

All commands use this checkout's existing dependencies. The login shell initially selected Node 20.20.0 and a Homebrew pnpm launcher that could not execute its configured pnpm; no installation was attempted. Subsequent commands used `PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH`, selecting the already-installed Node **24.21.0** and pnpm **12.14.0**. Local Bun is **1.4.3**, Vitest **5.0.5**, oxlint **1.88.0**, oxfmt **0.73.0**. Native-runtime `--check-only` passed.

The test file list used for both complete touched-file runs is:

```text
src/main/runtime/orchestration/db/lifecycle-transition.test.ts
src/main/axiom/db/axiom-store-rollback.test.ts
src/main/daemon/daemon-pid-file-parse.test.ts
src/main/daemon/daemon-health.test.ts
src/main/codex/codex-usage-limits.test.ts
src/main/axiom/execution/codex-rollout-limit.test.ts
src/shared/git-remote-error.test.ts
```

| Command (with the PATH prefix above) | Result |
|---|---|
| `node config/scripts/ensure-native-runtime.mjs --runtime=node --check-only` | PASS; no native rebuild. |
| `pnpm test <the seven files above>` | BLOCKED before Vitest: `tsx --conditions=orca-source scripts/build-dist.mjs` cannot create its IPC pipe, `listen EPERM` under the sandbox. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts <the seven files above>` | **110 passed, 7 failed**; six complete files pass, `daemon-health.test.ts` has only the seven baseline sandbox failures. Uses the existing Bun runner/package artifacts; the SQLite files use its configured Node-runtime pool. All 20 port-related baseline failures now pass. |
| `pnpm exec vitest run --config config/vitest.config.ts <the seven files above>` | **110 passed, 7 failed**, identical failure set to the Bun command; all files run under Node. All 20 port-related baseline failures now pass. |
| Both runner forms above, with `src/main/daemon/daemon-health.test.ts -t 'removes a malformed pid record\|keeps an empty pid record'` | PASS on each runner: **4 passed, 30 unselected**. The 30 are excluded by this diagnostic name filter, not disabled or reported as covered; complete-file runs above include them. |
| `pnpm tc` (three attempts) | All three BLOCKED in the same process-host prebuild IPC pipe operation, before typechecking. Not claimed as passing. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs` (three runs) | PASS ×3: each checks the four configured groups (18,077 / 3,197 / 34 / 15,691 files) with no type errors, using existing package artifacts. |
| `pnpm run check:code-quality:changed` | PASS on the final tree: no new findings in any of its seven checks, 14 changed source/test files. |
| `pnpm lint` | PASS on the final tree, exit 0. Existing docs-site warnings and localization coverage information remain; no new lint error. Includes max-lines, RPC catalog, and egress gates. |
| `pnpm run check:vendor-egress-ratchet` | PASS: 455 grandfathered pairs; no allow marker or baseline change. |
| `pnpm exec oxfmt --write <explicit changed .ts paths>` | PASS; only the 14 changed TypeScript files formatted, no Markdown. |
| `git diff --check` | PASS. |
| Scope inspection of `git diff --name-only main`, untracked files, and the report | PASS: all 16 files match the brief's allowed paths; production Axiom remains unchanged. Non-comment-line comparison confirms the relocation edit is comment-only. No new kernel-to-Axiom import, `@ts-nocheck`, or egress allow marker. |

Raw local logs: `/tmp/axiom-upstream-4-1.LF1EOy/` (`baseline-final-{node,bun}.log`, `final-{node,bun}.log`, `daemon-focused-{node,bun}.log`, `red-bun.log`, `tc-{1,2,3}.log`, `typecheck-direct.log`, `typecheck-direct-{2,3}.log`, `quality-final.log`, `lint-final.log`, `vendor-egress.log`). These are local evidence, not committed Artifacts.

## Limitations, risks, and verifier handoff

- `temp_store = MEMORY` moves temp tables and large sorts into memory. It avoids dependence on the temp directory, not memory exhaustion or all disk/I/O failures. Real disk exhaustion is modeled with SQLite `RAISE(ROLLBACK)`, not induced on the host.
- An empty pid record with an inconclusive probe now holds back a replacement daemon until the probe can decide. JSON pid validation and parsed-owner fencing are intentionally unchanged.
- The nearly spent heuristic can blame a 90–99% window for a rejection that Axiom classified as a usage limit from its text. No last report means no inferred reset: the first-request case keeps the current waiting ladder. No additional provider request was introduced.
- The renderer half of #36205 is not ported and remains a follow-up at the next D56 intake.
- Seven existing daemon tests fail in this sandbox on both baseline and candidate: six real listeners cannot bind (`EPERM` / failed to listen); the real-process replacement test cannot confirm its recorded-owner kill (`killed: false` instead of true). Existing tests and assertions remain intact. Do not treat the complete touched-file suites as passing until the verifier reruns them on the host.
- Host-owned validation not run: `mission-attempt-launch`, `mission-headless-worker`, `mission-account-cooldown`, `mission-interrupted-continuation`, full `verify-main` suite, and packaged egress canary. No live provider or account was contacted.
- No independent external audit, immutable Candidate, promotion, or milestone completion is claimed. The launcher must commit, then the independent verifier must run the prescribed host gates and make the acceptance decision.
