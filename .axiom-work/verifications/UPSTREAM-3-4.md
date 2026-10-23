# VerificationRun — UPSTREAM-3 attempt 4

- Task: UPSTREAM-3 (D72). Attempt 4 scope: the two real host failures left by attempt 3.
- Candidate: `2c35af8504` (branch `axiom/attempt/UPSTREAM-3/4`, base `1af39c78f4`).
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 22:44–22:54 MDT (10 min, 276,450 tokens); report `.axiom-work/reports/UPSTREAM-3-4.md`.
- Verifier: Claude. Launcher verification `verify-UPSTREAM-3-4-20261022-225422.log`.

## Change (3 test files, no production code)
- `tests/e2e/helpers/fixture-plan-proposal.unit.test.ts`: both `submitFixture` calls take `(attemptId, missionId, taskId)` again, so the crash-marker / no-submission / retry assertions test what they meant to.
- `config/scripts/ci-closed-pr-cancellation.test.mjs`: the deleted `cloud-verify` key leaves the expected concurrency groups; the other 27 keys and their order stay.
- `tests/e2e/mission-attempt-launch.spec.ts`: found by the requested audit of provider-function callers — its ledger schema still required `capability` and asserted a `dcap_` prefix; it now requires the terminal handle and pane key the host records (`term_` handles). Remaining `dcap_` mentions are the two redactors in the real-Codex smoke spec.

## Launcher gates
| Check | Result |
|---|---|
| vendor-egress ratchet | PASS |
| unit targets (`tests/e2e/helpers`, the two CI tests, Axiom, axiom-contract, Axiom RPC methods, CLI axiom handlers and specs, orchestration db) | PASS — 163 files / 1,334 tests, 1 skipped |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | PASS / PASS / PASS |
| sidecar extras | 19 / 19 PASS |
| full lint | PASS |
| changed-code quality | not applicable to the full merge (E2BIG); run at integration against the upstream base |

## Verdict
PASS for the attempt scope. Next: the full host verification on this candidate (full suite; the four PTY / watcher tests alone; M1 / M2 exit and the five fixture e2e specs; cold-start egress capture on three stacks; one real Codex Planner smoke; packaging). The packaged-app egress canary opens the app in the foreground for 75 s, so it waits for a time Henry chooses.
