# M3-08d-HYG attempt 1 — verification record

Candidate `0669842c05` on `axiom/attempt/M3-08d-HYG/1`: attempt 1 `9921bfe18e` from main `172507d285` (Codex, 17:51–18:02 MST 2026-11-11, 11 min, the four test files +63 / −16 and the report) plus one verifier correction `0669842c05` (below). Report `.axiom-work/reports/M3-08d-HYG-1.md`.

## Review

- **Scope**: only the four test files named by the brief, plus the report. No production file; the three production files the brief names (`runtime-selection.ts`, `commit-message-agent-environment.ts`, `codex-home-paths.ts`) and `structured-chat-cli-fork.ts` are unchanged (sidecar guards).
- **`orcad-account-services.test.ts`**: `accounts.selectCodex({ accountId: null })` must reject with message and code `system_default_retired` outside Windows and still resolve to `{ activeAccountId: null }` on Windows. The structured-launch test keeps the client-sent home cases and the `null` preparation without a launch context; the read-only `resolveCodexStructuredLaunchHome({ launchEnv: {} })` must throw "No Codex account selected…" outside Windows and return `null` on Windows. The old comment that `null` meant the real `~/.codex` is gone.
- **`orca-runtime-git.test.ts`, `orca-runtime-linked-issue-live-meta.integration.test.ts`**: the commit-message / pull-request and linked-issue tests get a managed Codex home through the existing `getCommitMessageAgentEnvironment` dependency (and the runtime's `setCommitMessageAgentEnvironmentResolvers` in the integration test), the pattern the already passing test in the same file uses, so they test parameter precedence and the linked issue again instead of the no-account refusal. The Worker found five more linked-issue tests in the same file with the same missing-account fixture (13 failing tests across the four files before the change in its sandbox run, against the eight the brief listed from the host log); all inside the authorized file.
- **`structured-chat-cli-fork.test.ts`**: the Worker read `prepareStructuredChatCliFork` and `prepareLegacySharedCodexSessionResume` before changing anything: outside Windows the legacy preparation returns `{ useRealCodexHome: false }` at once (D83 ①) and materializes nothing in the system home, but the test's callback still substituted the system home on every platform, so the fork's `stat` of the substituted path failed. The test now keeps the no-migration result outside Windows, checks the recorded home and path are kept and the temporary system home was never created, and keeps the old expectations on Windows. Title renamed without an apostrophe. No production defect.
- **Verifier correction `0669842c05`**: the launcher's changed-code quality gate failed on two old `}) as unknown as GlobalSettings` assertions in `orca-runtime-git.test.ts`, because the attempt appended a trailing comma to those lines when it added the new dependency after them. The dependency now comes first, so those two lines equal main's; behaviour unchanged (property order).

## Checks

| Check | Result |
|---|---|
| Launcher verification on `9921bfe18e` (`verify-M3-08d-HYG-1-20261111-180203.log`) | ratchet, sidecar targets under Bun 4 files / 28 tests, CI's Axiom step under Node 226 files / 2,144 tests, `pnpm tc` ×3, the three sidecar extras, full lint — all pass; changed-code quality failed (the two assertions above), OVERALL=FAIL |
| Changed-code quality on `0669842c05` | pass: Changed-code quality gate passed since f462856f7fbc. (`host-check-M3-08d-HYG-cq-20261111-180842.log`) |
| The four files under Bun (`pnpm test`) | pass:  Test Files 4 passed (4)  Tests 28 passed (28) |
| The four files under Node (`pnpm exec vitest run --config config/vitest.config.ts`) | pass:  Test Files 4 passed (4)  Tests 28 passed (28) |
| Red check: main's four test files on the same tree | red as expected:  Test Files 4 failed (4)  Tests 13 failed | 15 passed (28) (main's files checked out by explicit path, the candidate's restored the same way, tree clean afterwards) |
| `oxfmt --check` on the four files | clean |
| Union sidecar pre-check | `ran 1115 skipped 204 failed 0 unique 1319` |

## Verdict

VERIFIED for integration. Production behaviour is the one D83 ① decided; these tests now describe it, and they join the union targets that verify-main runs.
