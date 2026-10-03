# VerificationRun — M0-HYG attempt 1

- Task: M0-HYG — PR workflow lint parity (missing `check-vendor-egress-ratchet` step), exclude `.cross-version-checkouts` from the e2e env-isolation walk, retry options on the mobile-release-scope temp cleanup
- Candidate: `62b4649ef` (branch `axiom/attempt/M0-HYG/1`, base `f4c7cab44` = main HEAD, unchanged since — candidate tree = merged tree)
- Worker: Codex CLI 0.157.1; report `.axiom-work/reports/M0-HYG-1.md`. Verifier: Claude; Mac toolchain Node v24.21.0 / pnpm 12.0.0.
- Verification log (gitignored): `verify-M0-HYG-1-20261003-114233.log`; advisory Jev triage: report completeness 2.47/3 (the report is short by design for a three-line task), scope creep p=0.15, follow-up NO_REPLAN.

## Diff inspection
Three minimal diffs, exactly as briefed: `.github/workflows/pr.yml` +3 (an "Enforce vendor-egress ratchet" step in the shape of its neighbours); `tests/e2e/e2e-worker-env-isolation.unit.test.ts` adds `.cross-version-checkouts` to `IGNORED_DIRECTORIES` (pin and regex untouched); `config/scripts/mobile-release-check-scope.test.mjs` `rmSync(..., { maxRetries: 5, retryDelay: 100 })`. No other file.

## Checks (Mac, `verify.sh M0-HYG 1`, 2026-10-03)
| Check | Result |
|---|---|
| ratchet | PASS (559 pairs, unchanged) |
| `pnpm test config/scripts/pr-workflow-lint-parity tests/e2e/e2e-worker-env-isolation config/scripts/mobile-release-check-scope` with `tests/e2e/.cross-version-checkouts/` present | PASS |
| `tc:node` / `tc:cli` / `tc:web`, changed-code quality | PASS |
| full `pnpm lint` | PASS |

## Verdict
**PASS — VERIFIED.** Three of the files in the known-environmental list are now fixed at the root; the list in `.axiom-work/jev/known-environmental.txt` is updated at integration.
