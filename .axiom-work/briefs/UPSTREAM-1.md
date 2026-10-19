# Task UPSTREAM-1 — first upstream intake under D56: three cherry-picks + one semantic port (unit-test real-home write guard)

You are a Worker on the Axiom project (a product fork of stablyai/orca). Read `docs/decisions/DECISION_LOG.md` **D56** (what may be taken from upstream and how) and `docs/decisions/UPSTREAM_SYNC.md` (the register; this Task is its first batch). The upstream remote is already fetched into this repository (`upstream/main` = `ce2d60834c`, fork point `3eb1adec2`); every SHA below exists locally. **Do not fetch, pull or push anything.**

## Objective

Apply these four upstream fixes, in this order, each as its own commit on this branch:

| # | upstream | title | method |
|---|---|---|---|
| 1 | `2576783d4d` | fix(agents): keep ~/.copilot/config.json owner-only when Orca trusts a folder (#25087) | `cherry-pick -x` (applies cleanly: 2 files) |
| 2 | `23a874a2a1` | fix(secrets): seal credentials on Linux desktops Chromium cannot detect (#24035) | `cherry-pick -x` (applies cleanly: 8 files, all additions) |
| 3 | `983250a12e` | fix: await queued Codex trust preflight completion (#23148) | `cherry-pick -x` with two expected conflicts (`config/reliability-gates.jsonc`, `src/main/ipc/worktree-remote.ts`): keep **both** sides' intent — Axiom's existing entries / lines stay, upstream's additions join them |
| 4 | `5b3366f78e` | test: unit tests can no longer write a developer's real agent or Orca settings (#23979) | **semantic port**, not a cherry-pick (10 of its 23 files do not exist in this tree) |

## Facts you can rely on (verified against the checkout)

- Commit identity and hooks: use `git -c user.name="Axiom Worker" -c user.email=axiom-worker@localhost -c core.hooksPath=/dev/null cherry-pick -x <sha>`; after resolving a conflict, `git add <files>` then `GIT_EDITOR=true git -c user.name="Axiom Worker" -c user.email=axiom-worker@localhost -c core.hooksPath=/dev/null cherry-pick --continue`. Never `--skip`, never `git reset --hard`, never `git checkout -- .`; to abandon one pick use `git cherry-pick --abort` and report.
- None of the four commits touch `package.json` / `pnpm-lock.yaml` / `.github/` / `src/renderer/` / `src/main/axiom/`. If a pick tries to (it will not), stop that pick and report.
- `983250a12e` adds `src/main/agent-trust-write-deadline.ts` and `tests/e2e/agent-trust-completion.unit.test.ts` (new files, no conflict) and changes `src/main/ipc/agent-trust.ts` (no conflict). The two conflicts are additive on both sides.
- `5b3366f78e` has three parts (its commit message explains each). **Port (b) and (c) only.** (a) — trust writers taking the launched agent's home instead of `os.homedir()` — is **skipped** here: upstream moved those writers into `execution-host-workspace-trust.ts`, which this tree does not have, and threading a launch home through our `agent-trust-presets.ts` callers (`ipc/agent-trust.ts`, `ipc/worktree-remote.ts`, `runtime-worktree-agent-startup.ts`) belongs to the trust-subsystem sync planned for the next batch. (b) tests that wrote the real home get a temp HOME / userData — port for the files that exist: `src/main/codex/codex-ai-vault-session-resume.test.ts`, `codex-legacy-session-resume.test.ts`, `codex-trust-config-concurrent-launch.test.ts`, `hook-service-wsl-runtime.test.ts`, `src/main/runtime/claude-agent-teams-shim-env.test.ts`, `src/main/runtime/orca-runtime-tests/terminal-creation-and-readiness-part-04.spec.ts`, `src/main/runtime/rpc/methods/structured-agent-session-adoption-replay.test.ts`, `src/main/agent-trust-presets.test.ts` (only the hunks that give a test a temp home; skip hunks that reference the missing modules). (c) the vitest setup guard `config/scripts/vitest-real-agent-home-write-guard.ts` (+ its `.test.ts`), registered in `config/vitest.config.ts` (`setupFiles`, first entry) and `config/tsconfig.node.json` — take both files verbatim from `git show 5b3366f78e:<path>`, then add `'.axiom'` to its protected directory list and `join(home, '.config', 'axiom')` next to the existing `.config/orca` entry (this tree still uses `~/.orca`, the dev userData is `axiom-dev`; both must be protected). Use `git show 5b3366f78e` as the reference diff; port only to files that exist.
- The guard refuses mutating `node:fs` calls under the account's real agent homes, found through `os.userInfo()`, so a test cannot hide by swapping HOME. After porting it, the targeted suites below will tell you which remaining tests in this tree still write the real home; fix each one the way upstream did (temp HOME / userData), and list them in the report. Do not weaken the guard to make a test pass.
- The sandbox cannot run Electron (`SIGABRT`); `src/main/startup/single-instance-lock-exit.electron.test.ts` fails here for that reason — report it as environmental, do not touch it.
- `pnpm tc:*` run clean on the launcher (D47): `rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` (plain `rm`, exact files) before typechecking yourself.

## Deliverables

1. Four commits on this branch, in the order above: three with the `(cherry picked from commit …)` trailer, and one port commit whose message starts with `port(upstream): unit tests can no longer write the real agent or Orca home` and names `5b3366f78e` in the body (parts b and c; part a deferred).
2. `.axiom-work/reports/UPSTREAM-1-1.md` (leave it uncommitted; the launcher commits it): per commit — upstream SHA, files, conflicts and how each hunk was resolved; for the port — what was taken, what was skipped and why, which existing tests the guard caught and how they were fixed; then the verification table.

## Acceptance criteria

- `git log main..HEAD` shows exactly the four commits (plus the launcher's report commit); `git diff --quiet main -- package.json pnpm-lock.yaml .github src/renderer src/main/axiom src/shared/axiom-contract`.
- `pnpm test src/main/codex src/main/host src/main/startup src/main/ipc src/main/agent-trust-presets.test.ts src/main/runtime/claude-agent-teams-shim-env.test.ts src/main/runtime/rpc/methods/structured-agent-session-adoption-replay.test.ts config/scripts/vitest-real-agent-home-write-guard.test.ts tests/e2e/agent-trust-completion.unit.test.ts src/main/axiom` green except the Electron-only file above.
- Clean-cache `pnpm tc:node`, `pnpm tc:cli`; `pnpm run check:code-quality:changed`; full `pnpm lint`.

## Rules

- Allowed files: exactly the files the four commits touch **that exist in this tree**, plus the new files they add (`src/main/agent-trust-write-deadline.ts`, `tests/e2e/agent-trust-completion.unit.test.ts`, `src/main/startup/linux-*`, `src/main/startup/select-linux-keyring-backend*`, `config/scripts/vitest-real-agent-home-write-guard*`), plus any existing test file the guard proves writes the real home (list each in the report), plus `.axiom-work/reports/UPSTREAM-1-1.md`. If a change outside this is required, stop **that one edit**, keep everything else, and report the exact file and reason.
- No `pnpm install/add/remove/rebuild`; no formatter over files you did not change; no edits to `TUI_AGENT_CONFIG`; no changes to the guard's semantics beyond the two Axiom path additions.

## Submission

Commits as above; report uncommitted.
