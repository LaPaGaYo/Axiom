# Task M0-HYG — Repository hygiene: PR workflow lint parity, two upstream test defects

You are a Worker on the Axiom project (a product fork of Orca). Read `AGENTS.md` (including the Lazy Senior Dev Mode section) and `docs/PROJECT_CONSTITUTION.md` §3–§5 before touching code. This is a small, bounded hygiene task: three independent fixes, each the shortest correct diff. Stay strictly within the scope below.

## Objective

Three test files have failed on every full-suite run since the fork and have been carried as "environmental" — two of them are real defects and one is a cleanup race:

1. `config/scripts/pr-workflow-lint-parity.test.mjs` — `.github/workflows/pr.yml` lacks a step for `config/scripts/check-vendor-egress-ratchet.mjs`, which M0-01 added to `pnpm lint`. PR CI must run every `pnpm lint` step.
2. `tests/e2e/e2e-worker-env-isolation.unit.test.ts` — `collectE2eFiles` walks `tests/e2e/.cross-version-checkouts/` (release trees checked out by the cross-version-wire tests, gitignored) and reports their files as module-scope env writers. That directory must be excluded like `node_modules`.
3. `config/scripts/mobile-release-check-scope.test.mjs` — `afterEach` removes temp directories with `rmSync(directory, { recursive: true, force: true })` and intermittently fails with `ENOTEMPTY` under full-suite load on macOS. Use the retry options the repository already uses elsewhere (`maxRetries`, `retryDelay`, see `src/main/startup/single-instance-lock-exit.electron.test.ts`).

## Scope (allowed to modify)

1. `.github/workflows/pr.yml` — add the missing lint step in the same shape as its neighbours (look at how the other `check:*` ratchet steps are declared; keep ordering consistent with `pnpm lint`). Nothing else in the workflow.
2. `tests/e2e/e2e-worker-env-isolation.unit.test.ts` — add `.cross-version-checkouts` to `IGNORED_DIRECTORIES` (or the equivalent minimal exclusion). Do not change the ratchet pin or the regex.
3. `config/scripts/mobile-release-check-scope.test.mjs` — `rmSync` retry options in the cleanup only.

Out of scope: any other failing test (the verifier keeps a separate list), product code, `config/vendor-egress-baseline.txt` unless the ratchet reports a change (it should not).

## Acceptance criteria

- `pnpm test config/scripts/pr-workflow-lint-parity.test.mjs tests/e2e/e2e-worker-env-isolation.unit.test.ts config/scripts/mobile-release-check-scope.test.mjs` passes **with** `tests/e2e/.cross-version-checkouts/` present (create a dummy `tests/e2e/.cross-version-checkouts/x/src/a.ts` containing `process.env.ORCA_E2E_X = '1'` for the run if the directory is absent in your sandbox, and delete it afterwards — it is gitignored either way).
- `pnpm run check:vendor-egress-ratchet`, `pnpm tc:node`, `pnpm run check:code-quality:changed` pass.

## Finishing checklist

1. Run the entire `pnpm lint` once; regenerate any generated artifact it flags with the repository's own command.
2. Never run `pnpm install`, `pnpm add/remove/rebuild` or anything that writes `node_modules` from the sandbox.
3. Regenerate `config/vendor-egress-baseline.txt` last only if the ratchet reports a difference.

## Rules

- No `@ts-nocheck`, no `as` casts, no new dependencies, no new files.
- Do not push and do not commit: the launcher commits everything on the current branch (`axiom/attempt/M0-HYG/1`) when you finish. Do not delete files.
- Do not run `git reset --hard`, `git checkout -- .`, or `git clean`.

## Submission

Write `.axiom-work/reports/M0-HYG-1.md` with: Summary; Files changed; Checks run (exact commands, pass/fail, durations); Known limitations; Suggested follow-ups (one line each). End your final message with the same Summary.
