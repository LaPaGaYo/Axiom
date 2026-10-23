# VerificationRun — UPSTREAM-3 attempt 3

- Task: UPSTREAM-3 (D72). Attempt 3 scope: B1 per D73 (Attempt authority on the host-verified caller identity; no dispatch capability) and the test triage left by attempt 2.
- Candidate: `45df53b579` (branch `axiom/attempt/UPSTREAM-3/3`, base `9009d55347`). The first run (21:28–21:33 MDT) stopped with "Selected model is at capacity" and left `37bbf68bc0` (two test files and an in-progress report); the re-run continued from it, 21:47–22:22 MDT (35 min, 425,420 tokens).
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`); report `.axiom-work/reports/UPSTREAM-3-3.md` (300 lines).
- Verifier: Claude. Launcher verification `verify-UPSTREAM-3-3-20261022-222226.log` (`OVERALL=FAIL` on unit targets and the not-applicable changed-code gate only).

## Launcher gates
| Check | Result |
|---|---|
| vendor-egress ratchet | PASS (468 pairs) |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | PASS / PASS / PASS — the 53 B1 errors are gone |
| full lint | PASS, every stage (92 s) |
| sidecar extras | 19 / 19 PASS — markers, seam check, protected files against `axiom/upstream-3/protected-base`, upstream v43 and `config/patches` byte-identical, schema 46, no `session:` literal, no capability plumbing or `--dispatch-capability` in Axiom code and specs, catalogs, gates, a finished report |
| changed-code quality | not applicable to the full merge (E2BIG) |
| unit targets (Axiom, orchestration db and worker methods, CLI, `src/main/daemon`, `config/scripts`) | 34 files failed / 913 passed / 10 skipped. 25 `config/scripts/mobile-web-app/**` and `build-mobile-web-app-bundle` — non-blocking under D75 (the host also lacks the Playwright browsers of the merged Playwright version). 3 macOS environmental — `ci-managed-ssh-execution`, `dependency-security-release`, `pr-auxiliary-preflight-admission` run Linux-bash scripts under macOS `/bin/bash` 3.2 (`mapfile: command not found`, `set -u` on an empty array). 4 to re-run alone on the host — `src/main/daemon/{shell-ready,repro-13767-shell-ready-marker-lost-to-exec,bash-prompt-command-composition}.test.ts` (empty PTY output under the full parallel run) and `config/scripts/process-host-dev-rebuild.test.ts`. **2 real:** `tests/e2e/helpers/fixture-plan-proposal.unit.test.ts` (attempt 3 dropped the capability parameter from the test provider's `submitFixture`, the unit test still passes it, so the arguments shift and the `task-1` crash marker is never consumed) and `config/scripts/ci-closed-pr-cancellation.test.mjs` (attempt 3 removed the deleted `cloud-verify.yml` from `ci-closed-pr-caches.yml`; this test still expects its key) |

## Independent review
- `src/main/axiom/execution/attempt-authority.ts`: the sender comes from the kernel's `orchestrationCallerIdentity`; without a host-resolved session the lifecycle caller fence runs before the dispatch lookup; Axiom's binding, `inactive_dispatch`, `stale_dispatch`, Planner binding and Task-stage checks stay; authority is upstream's `workerReportRefusal` (worker state; `process_incarnation` current) with `isDispatchMessageSender` when no incarnation was recorded; `hasLifecycleAuthority` and Mission / Task / Run consistency stay; a settled Submission replays only for the same pane and process incarnation. No token, no new lifecycle, no socket-peer check (DEF-25).
- New kernel touchpoints, all small: `src/main/runtime/rpc/orchestration-session-caller.ts` lets the eight Attempt verbs and `axiom.plan.propose` use upstream's host session resolution (same host, live lease, session wins over a declared caller); `src/main/runtime/rpc/dispatcher.ts` (+5) calls `assertAttemptRequestAuthority` after compatibility handling and before the receipt executor — it returns at once for any other method, and it closes a real gap: a completed mutation receipt would otherwise replay an old result to a replaced process; `src/cli/runtime/orchestration-compatibility-envelope.ts` (+15) forwards caller evidence for those verbs. The method list (`src/shared/axiom-contract/attempt-caller-methods.ts`) matches the registered method names, `axiom.attempt.request-subtask` included.
- Plumbing: no `orchestrationCapability` or `--dispatch-capability` left in Axiom code, CLI handlers or Axiom specs; Worker and Planner templates no longer print a token; the ContextPackage hash changed accordingly (`ctx_3599d3b3…`).
- Triage fixes checked: canonicalized paths (`realpathSync`) for Bun / macOS `/private/var`, Axiom release source in skill / agent-state fixtures, `com.lapagayo.axiom` launchd labels, `axiom-dev` / `axiom` CLI names in daemon fixtures, the deleted `run-process` module in the recording proxy moved to `@orca/process-host`, and `Mock` typing in three test helpers.
- Note: host test runs use upstream's pinned Bun (`run-vitest.mjs` → `bun --bun vitest`), the sandbox does not always; the next brief says so.

## Verdict
PARTIAL — attempt 4 fixes the two real failures; then the full host verification (full suite, M0 egress capture, M1 / M2 exit and host e2e, real Codex Planner smoke, packaged egress) with the four host re-runs above.
