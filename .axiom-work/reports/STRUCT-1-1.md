# STRUCT-1 · Attempt 1 · implementation report

2026-11-16. Branch: `axiom/attempt/STRUCT-1/1`. Starting HEAD and main: `3a9194429707a549fe03a953bae98f00025a3683` (the planner brief follows the audited `ce34fabf98` code). Implementation and local checks are complete; this is a submission for the launcher and independent verifier, not a verification verdict or milestone completion. No commit, merge, push or provider review was performed. D93 parts c and d remain outside this Task.

## Files changed

- New scope: `src/main/axiom/execution/hookless-git.ts` (only `confinedGitEnv` and `withHooklessGit` exported).
- Six product files changed beyond an import: `execution/candidate-snapshot.ts`, `execution/commit-pin.ts`, `execution/worktree-snapshot.ts`, `execution/integration-base.ts`, `integration/integration-merge.ts`, `verification/verification-worktree.ts`, all under `src/main/axiom`.
- New tests: `src/main/axiom/execution/hookless-git.test.ts` and `hookless-git-removal.test.ts`, with exactly the five requested titles.
- Pure moves: `src/main/axiom/context-builder/redaction.ts` and `redaction.test.ts` to `src/main/axiom/redaction/`. Both destination files were compared byte for byte with their original HEAD content and are identical.
- The 34 import paths listed below; 33 files have exactly one changed import line, while `integration-merge.ts` also contains its required scope refactor. No other existing test content changed.
- `docs/reference/control-plane.md`: one new `Hooks-off git writes（STRUCT-1）` section after the last existing integration section, `Integration requests（M4-2b）`. No heading removed or renamed. This base had no literal `context-builder/redaction.ts` home path to replace.
- This report: `.axiom-work/reports/STRUCT-1-1.md`.

## The seven scopes as built

In the arrays below, `hooks` is exactly `['-c', 'core.hooksPath=<directory>']` from the scope. The directory is freshly created, initially empty, and unique per scope. Every command still uses the kernel `gitExecFileAsync`; the scope itself imports only Node built-ins and `gitOptionsForWorktree`, and executes no git command.

| # / place | Settings | Hooks-off argument arrays, in order | Options and comparison with the original |
|---|---|---|---|
| 1 · `candidate-snapshot.ts` / `snapshotCandidate`, non-headless dirty branch | `{ timeout: undefined, confine: false }` | `[...hooks, 'add', '-A']`; `['-c', 'user.name=Axiom Control Plane', '-c', 'user.email=axiom@localhost', ...hooks, 'commit', '--no-verify', '-q', '-m', 'axiom: candidate snapshot ' + input.attemptId]` | Exactly `gitOptionsForWorktree(worktree.worktreePath)`, with no `timeout` or `env`. This is the original order, including identity before hooks on commit and the same directory for both calls. Status, HEAD/tree reads and branch assertions remain in their original positions. |
| 2 · `commit-pin.ts` / `pinCommit` | `{ timeout: 30_000, confine: false }` | `[...hooks, 'update-ref', ref, commitSha, '0'.repeat(commitSha.length)]` | Both write and failure readback use the scope options, exactly `{ ...gitOptionsForWorktree(cwd), timeout: 30_000 }`. The readback remains `['for-each-ref', '--format=%(refname) %(objectname)', ref]`, without hooks. Commands and results are what they were; `return await withHooklessGit<CommitPin>(...)` stays inside the outer catch that returns `unavailable`. |
| 3 · `worktree-snapshot.ts` / `withWorktreeSnapshot` | `{ timeout: input.timeout, confine: false }` | `commit(message)`: `[...hooks, '-c', 'user.name=Axiom Control Plane', '-c', 'user.email=axiom@localhost', 'commit-tree', treeSha, '-p', parent, '-m', message]`; `publish(ref, commitSha, expected)`: `[...hooks, 'update-ref', ref, commitSha, expected]` | Scope options are the original worktree options plus the supplied timeout; undefined timeout is omitted. The private-index options are exactly `const isolated = { ...options, env: { ...process.env, GIT_INDEX_FILE: path.join(directory, 'index') } }`. Commit uses `isolated`, publication uses `options`. Hooks still precede identity; the same directory still holds the private index. All reads and private-index operations retain their order and arguments. |
| 4 · `integration-base.ts` / `advanceIntegrationHead` | `{ timeout: 30_000, confine: false }` | `[...hooks, 'update-ref', ref, to, from]` | Exactly `{ ...gitOptionsForWorktree(input.repoPath), timeout: 30_000 }`. The first read and early returns still precede directory creation; write rejection is swallowed and the original readback decides. `return await withHooklessGit(...)` is inside the outer catch. Command order, readback and result values are unchanged. |
| 5 · `integration-merge.ts` / `writeIntegrationGit` | `{ timeout: 120_000, confine: true, env }` | `[...hooks, ...args]`: the merge array reproduced below; `[...hooks, 'merge', '--abort']` at both original abort sites; `[...hooks, 'checkout', '--detach', mergeCommit ?? baseCommit]`; `[...hooks, 'checkout', scratch.branch]` | Exactly `{ ...gitOptionsForWorktree(cwd), timeout: 120_000, env: { ...(env ?? process.env), GIT_CEILING_DIRECTORIES: path.dirname(cwd) } }` in value. The optional caller environment is passed through. These are the original arrays and call order; neither scratch caller nor merge logic changed. |
| 6 · `verification-worktree.ts` / `pinVerificationCandidate` | `{ timeout: undefined, confine: false }` | `[...hooks, 'checkout', '--detach', candidate.commitSha]` | Exactly `gitOptionsForWorktree(split.worktreePath)`. The following `['branch', '-f', branch, candidate.commitSha]` stays inside the scope but has no hooks fragment. The cat-file check, later identity reads, errors and order are unchanged. |
| 7 · `verification-worktree.ts` / `removeVerificationWorktree` | `{ timeout: undefined, confine: true }` | `[...hooks, 'symbolic-ref', 'HEAD', ref]` | Exactly `{ ...gitOptionsForWorktree(cwd), env: confinedGitEnv(cwd) }` in value, no timeout. The two reads retain the same environment values. The scope is opened only after `name === ref && tip === head && !occupied`; the enclosing catch still swallows the entire optional restoration step. This is the same write, at the same point, as before. |

The merge `args` from the unchanged `mergeIntegrationCandidate` logic are:

```ts
[
  '-c', 'user.name=Axiom Control Plane',
  '-c', 'user.email=axiom@localhost',
  '-c', 'commit.gpgsign=false',
  '-c', 'rerere.enabled=false',
  '-c', 'gc.auto=0',
  '-c', 'merge.log=false',
  '-c', 'merge.verifySignatures=false',
  'merge', '--no-ff', '--no-edit', '--cleanup=verbatim',
  '-m', `axiom: integrate ${candidate.id}`, candidate.commitSha
]
```

Its environment still starts from `process.env` with `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` set from the batch timestamp. `readIntegrationGit` keeps its 30,000 ms timeout and existing `allowParentRepository` behavior; only the construction of its confined environment now calls `confinedGitEnv(cwd)`.

## The two accepted differences

1. All temporary directories now share the `axiom-hookless-git-` prefix instead of the former six prefixes. Their random identities and per-scope lifetimes remain.
2. All seven scopes now remove their directory recursively with force, best effort. A cleanup failure cannot replace the callback result or the exact error it throws. Previously failures propagated in places 1, 3, 5 and 6, converted a successful pin to `unavailable` in place 2, and were already swallowed in places 4 and 7. A nonempty directory previously failed `rmdir`; it is now removed recursively. Place 3 already removed its private index recursively, but now also suppresses cleanup failure.

No ceiling, deadline, new error translation or additional hooks suppression was introduced.

## Findings left unchanged: confinement

The following assessment distinguishes the intended managed-worktree root from what a function actually validates. `splitWorktreeIdForFilesystem` extracts a path; it does not prove that the path is a repository root. A native ceiling would work for an intact root, but it is not a behavior-preserving addition to an API that currently permits parent discovery. Explicit git-directory environments, WSL handling and platform path separators also require separate review.

| Unconfined scope | Is cwd always a worktree root? | Would adding a ceiling be safe? |
|---|---|---|
| 1 · `snapshotCandidate` | Current submission callers pass the recorded Attempt worktree id, normally a kernel-created root. This function checks parsed identity and branch, not root identity. | Suitable for the intended intact native root, but not proven for every accepted input or a directory whose own git metadata disappears. Adding it would change failure/discovery behavior. |
| 2 · `pinCommit` | No root requirement: only absolute path and `stat(...).isDirectory()`. Current product callers are `pinCandidateRef` with an Attempt root and integration apply with a scratch root. | Not safe as a blanket contract change: callers may pass a repository subdirectory. A root-only contract would need a separate decision. |
| 3 · `withWorktreeSnapshot` | Current callers use Attempt roots: headless candidate capture, preserved capture, and continuation inspection. It accepts a string and verifies the branch, not the root. | Suitable for those intended native roots, but would newly reject parent discovery and cannot be declared behavior preserving. |
| 4 · `advanceIntegrationHead` | No. `integrationRepository` returns `runtime.showRepo(...).path` after a host check; catalog paths may be subdirectories. | No: a ceiling at that subdirectory parent can hide the valid repository. The new real-git confinement test demonstrates this. |
| 6 · `pinVerificationCandidate` | Normal preparation supplies the kernel-created verification root. Parsing the id here does not independently validate root identity. | Suitable for the intact managed native root; would change handling of non-root/stale paths, so it remains a separate decision. |

For completeness, these other direct git locations under `src/main/axiom` also remain unconfined; they were not candidates for this refactor:

| Location | Directory provenance and consequence |
|---|---|
| `execution/integration-base.ts` / `ensureIntegrationBase` | Repository/catalog path may be below the root. Its reads and branch creation need current parent discovery. |
| `integration/integration-merge.ts` / `readIntegrationGit(..., true)`, used by `integration-scratch.ts` / `readIntegrationHead` | Same catalog-path exception; adding a ceiling is unsafe for valid subdirectory paths. All other current integration reads are confined. |
| `execution/in-place-worktree.ts` / `inspectContinuationWorktree`, `takeOverContinuationWorktree` | Recorded continuation root, not root-validated at each git call. A ceiling would fit the intended root but change accepted/disappeared-metadata behavior. |
| `execution/preserved-snapshot.ts` / `captureAttemptWorktree` (behind `preserveAttemptWorktree`) | Recorded launch path, checked as a directory and for branch identity; root not independently proven. Same conditional suitability. |
| `execution/planner-proposal.ts` / `proposePlannerPlan` | Recorded Planner worktree id, normally a managed root; parser does not prove root identity. |
| `execution/attempt-fix-launch.ts` / `prepareWorkerFixLaunch` | Kernel/continuation worktree path; no root proof at the fallback HEAD read. |
| `execution/headless-attempt-files.ts` / `prepareHeadlessAttemptFiles` | Attempt worktree path; its `.axiom` realpath check protects that subdirectory, not repository-root identity. |
| `execution/attempt-exit-declared.ts` / `settleDeclaredExit`; `execution/attempt-exit-submission.ts` / `submitExit` final report callback | Recorded Attempt worktree path; neither git read independently establishes the root. |
| `execution/planner-launcher.ts` / returned `start`; `context-builder/repository-rules.ts` / `readRepositoryRules` | Mission repository path, not necessarily root. A ceiling can reject existing valid repository subdirectories. |
| `verification/candidate-diff.ts` / `readCandidateDiff` | Accepts a cwd string, normally verification/Attempt root; no root-only contract. Both ordinary and streaming git reads are unconfined. |

The reads and branch assertions around scopes 1, 3 and 6 are also still unconfined. No changes were made to kernel worktree lifecycle or user-selected verification commands.

## Findings left unchanged: deadlines and errors

No explicit deadline is supplied by scope 1 (`add`, `commit`), scope 6 (checkout and following branch update), or scope 7 (symbolic HEAD restoration). Scope 3 has no deadline when called by headless `snapshotCandidate`; preserved capture and continuation inspection supply `PRESERVATION_GIT_TIMEOUT_MS = 30_000`. Its `assertAttemptBranch` calls still use plain worktree options even when the snapshot has a timeout. Scopes 2 and 4 keep 30,000 ms, and scope 5 keeps 120,000 ms. `ensureIntegrationBase` still creates the branch without an explicit deadline. Continuation takeover still uses 30,000 ms.

Other direct git calls without an explicit timeout are all of the surrounding reads in `snapshotCandidate` and `pinVerificationCandidate`, both restoration reads in `removeVerificationWorktree`, `assertAttemptBranch`, `ensureIntegrationBase`, `proposePlannerPlan`, `prepareWorkerFixLaunch`, `prepareHeadlessAttemptFiles`, `settleDeclaredExit`, the final-report diff in `submitExit`, the integration-ref probe in Planner `start`, `readRepositoryRules`, and all ordinary/streaming reads in `readCandidateDiff`. This is an inventory of caller options, not a claim that reads have no kernel default: the kernel retains its own read-deadline classification. No write acquires a new deadline through this change.

| Scope or function | Raw git error behavior retained |
|---|---|
| `snapshotCandidate` | Status, add, commit and HEAD/tree read errors propagate unchanged. Branch assertions still map git failures to `candidate_branch_mismatch`. |
| `pinCommit` / `pinCandidateRef` | No raw git error escapes: the failure readback and outer catch still produce `pinned`, `ref_conflict` or `unavailable`. |
| `withWorktreeSnapshot` | HEAD/tree, private-index, commit-tree and publication failures propagate unchanged, as do callback errors. `assertAttemptBranch` retains its fixed error. Preserved capture later maps failures to its existing reasons; headless submission can receive the raw error. |
| `advanceIntegrationHead` | No raw git error escapes. Write failures defer to readback; outer failures return `unavailable`. |
| `writeIntegrationGit`, `readIntegrationGit` | Raw runner errors reach their immediate callers unchanged. `mergeIntegrationCandidate` still translates to `merge_failed`; scratch preparation translates to its existing fixed codes, and scratch return records its existing cleanup outcomes. |
| `pinVerificationCandidate` | Checkout, branch update and three identity read failures propagate unchanged. The earlier cat-file failure remains `candidate_missing`; the symbolic-ref probe still folds into the detached-identity check. The preparation caller retains its existing redacted failure evidence. |
| `removeVerificationWorktree` | All git restoration errors are swallowed. Unexpected `removeManagedWorktree` errors still escape unchanged; the existing recognized absence errors are ignored. |
| Other direct git callers | `proposePlannerPlan`, `prepareWorkerFixLaunch`, `prepareHeadlessAttemptFiles`, `settleDeclaredExit`, and `submitExit` final-report diff propagate raw runner errors. Planner `start` rethrows its integration-ref probe error except code 1 (missing ref). Both `inspectContinuationWorktree` and `takeOverContinuationWorktree` propagate their direct git errors; delegated snapshot branch assertions retain their existing mapping. |
| Existing fixed-result readers | `ensureIntegrationBase` maps failures to its existing `OrchestrationError` codes; `captureAttemptWorktree` maps to preservation reasons; `readCandidateDiff` maps to fixed failure reasons; `readRepositoryRules` treats absent rule files as optional and otherwise throws `context_repository_unavailable`. These were not generalized. |

This explicitly preserves raw-error paths despite D93 item 1(a)'s fixed-code wording: the approved brief prioritizes no behavior change. The scope neither catches callback errors nor logs them; only removal failures are suppressed.

## Findings left unchanged: writes with hooks enabled

Inventory from all non-test TypeScript under `src/main/axiom`, tracing the runner imports and the argument-building functions. “Enabled” means no hooks override is supplied by Axiom, not that every command necessarily invokes a hook on every Git version/configuration.

| File / function | Original command, unchanged | Effect |
|---|---|---|
| `execution/integration-base.ts` / `ensureIntegrationBase` | `['branch', branch, sha]` | Creates the integration branch/ref with repository hooks enabled. |
| `verification/verification-worktree.ts` / `pinVerificationCandidate` | `['branch', '-f', branch, candidate.commitSha]` | Moves the verification branch/ref. It is inside the new scope but intentionally does not spread `hooks`. |
| `execution/in-place-worktree.ts` / `takeOverContinuationWorktree` | `['update-ref', 'refs/heads/' + branch, input.targetCommit, '0'.repeat(input.targetCommit.length)]` | Create-only publication of the continuation Attempt branch. |
| Same | `['symbolic-ref', 'HEAD', 'refs/heads/' + branch]` | Repoints HEAD to that branch. |
| Same | `['read-tree', input.targetCommit]` | Replaces the live index contents. |
| Same | `['write-tree']` | Builds the tree for validation; may update index cache-tree data. Included even though it is not a ref or worktree-file update. |
| `execution/worktree-snapshot.ts` / `withWorktreeSnapshot` | `['read-tree', 'HEAD']` | Initializes the private index, with no hooks fragment. |
| Same | `['add', '-A', '--', '.', ':(exclude).axiom']` | Stages the worktree into the private index, with no hooks fragment. |
| Same | `['rm', '-r', '--cached', '--ignore-unmatch', '--', '.axiom']` | Removes `.axiom` entries from that private index, with no hooks fragment. |
| Same | `['write-tree']` | Builds the snapshot tree and may update private-index cache data, with no hooks fragment. |

The ordinary `['status', '--porcelain']` calls in `snapshotCandidate`, `proposePlannerPlan` and `settleDeclaredExit` are intended reads but can refresh index metadata; they also retain repository hooks/configuration. Immutable-commit diff, show, cat-file, rev-parse, for-each-ref and symbolic-ref query calls were inspected and not converted into writes or hookless scopes. No additional explicit direct ref/index/worktree mutation was found.

Kernel-mediated writes are a separate unchanged boundary: `execution/attempt-launcher.ts` / `createAttemptLauncher` creates Worker and Planner worktrees; `integration/integration-scratch.ts` / `createIntegrationScratch` creates them and `removeScratch` removes them; `verification/verification-prepare.ts` / `prepareVerification` creates them; `verification/verification-worktree.ts` / `removeVerificationWorktree` and `verification/verification-recovery.ts` / `recoverVerifications` remove them. The existing reference documents that kernel branch/worktree creation/removal can run post-checkout/reference-transaction hooks even with `runHooks: false` (the latter governs setup orchestration). This scope does not control those internal git invocations. No kernel files or call signatures changed.

## Redaction imports: 34 changed lines

All paths in the first seven rows are relative to `src/main/axiom/`. Each listed file retains one single-line import. The moved `redaction/redaction.test.ts` retains its original `./redaction` import unchanged and is not included in this count.

| Directory | Count | Files |
|---|---:|---|
| `context-builder` | 7 | `context-builder.test.ts`, `context-builder.ts`, `planner-render.ts`, `previous-attempt-text.ts`, `previous-attempt.ts`, `render.ts`, `repository-rules.ts` |
| `execution` | 10 | `attempt-exit-declared.ts`, `attempt-exit-failure.ts`, `attempt-exit-submission.ts`, `attempt-launcher.ts`, `attempt-transcript.ts`, `claude-worker-combination.ts`, `headless-handoff-records.ts`, `planner-denied-input.ts`, `preserved-baseline.ts`, `preserved-snapshot.ts` |
| `verification` | 7 | `diff-gate.ts`, `verification-acceptance.ts`, `verification-checks.ts`, `verification-output.ts`, `verification-plan-runner.ts`, `verification-rerun.ts`, `verification-resolution.ts` |
| `messaging` | 3 | `followup-resolution.ts`, `message-router.ts`, `question-answer.ts` |
| `mission-controller` | 3 | `mission-controller.ts`, `plan-validation.ts`, `task-adjustment.ts` |
| `integration` | 2 | `integration-merge.ts`, `integration-regression.ts` |
| `outbox` | 1 | `effect-execution.ts` |
| `src/shared/axiom-contract` | 1 | `secret-patterns.test.ts` |
| Total | 34 | 33 under `src/main/axiom`, one shared test import. |

## Verification evidence

Toolchain selected from the machine's existing installation with `source "$HOME/.nvm/nvm.sh"` and `nvm use 24`: Node 24.21.0, pnpm 12.14.0, Bun 1.3.13, Vitest 5.0.5, Git 2.54.0 (Apple Git-157). No install, rebuild, dependency change or node_modules relocation was performed. Logs are under `/private/tmp/axiom-struct-1-checks.NRthaX/`.

| Command | Result |
|---|---|
| `pnpm test src/main/axiom/execution/candidate-snapshot.test.ts src/main/axiom/execution/commit-pin-failure.test.ts` | Wrapper blocked before tests by the documented package-build `tsx` socket `listen EPERM`. See `baseline-wrapper.log`. No wrapper debugging performed. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts` plus those two test paths, before edits | PASS: 2 files, 7 tests. `baseline.log`. |
| Same direct runner plus `hookless-git.test.ts`, `hookless-git-removal.test.ts` and those two unchanged test paths | PASS: 4 files, 12 tests. `focused.log`; final-name follow-up in `focused-final.log`. |
| Bun runner command below, all sidecar targets including the whole Axiom and shared contract trees | PASS: 290 files, 2,448 tests; one existing opt-in test skipped; 99.04 s. `bun-full.log`. |
| `bash .axiom-work/scripts/ci-axiom-unit.sh` | PASS under Node: 325 files, 2,634 tests; the same existing opt-in test skipped; 106.17 s. Native-runtime check passed without rebuilding. `node-full.log`. This runs the CI step read directly from the workflow, including its additional renderer/schema/spec/unit-fixture targets. |
| `pnpm tc` | Wrapper blocked at the same `build:packages` socket step. `typecheck-wrapper.log`. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs`, three sequential passes | PASS ×3: node, web, CLI and process-host test compiler projects, no type errors. `typecheck-1.log`, `typecheck-2.log`, `typecheck-3.log`. |
| `pnpm run check:code-quality:changed` with the temporary Git index below | PASS: zero new findings in all seven categories across 44 changed source files. `quality.log`. |
| `pnpm lint` | PASS, exit 0, including the RPC catalog and all repository ratchets. Existing docs-site warnings and report-only localization diagnostics remain. `lint.log`. |
| Original imports and moves compared against HEAD | PASS: 33 import-only files equal exactly one path replacement; integration-merge reviewed separately. Both moved files byte-identical. `ensureIntegrationBase`, `assertAttemptBranch`, `pinCandidateRef`, `recordCandidatePin`, `mergeIntegrationCandidate` and `VerificationPreparationError` also match HEAD byte for byte. |
| STRUCT-1 sidecar | PASS: all 88 assertions from `.axiom-work/briefs/STRUCT-1.verify`, run individually with their exact command text and checked exit status. `sidecar.log`. |
| `python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"`, run by the STRUCT-1 assertion | PASS: `retired 9`; final line `ran 2252 skipped 604 failed 0 unique 2865`. Skips are the script's read-only/base-diff filters, not test skips. `sidecar.log`. |
| `git diff --check main` using the temporary index | PASS. The six edited callers total 134 added/deleted lines with whitespace ignored, below the sidecar limit of 400. Both required product literals occur only in `execution/hookless-git.ts`. |

Full Bun command:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts \
  src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom \
  src/main/runtime/rpc/dispatcher-axiom-caller-authority.test.ts \
  src/main/runtime/rpc/dispatcher-axiom-session-coverage.test.ts \
  src/main/runtime/rpc/dispatcher-axiom-terminal-authority.test.ts \
  src/cli/handlers/axiom src/cli/axiom-verification.test.ts
```

The one skip is the existing conditional `planner-render.test.ts` case `renders the frozen fixture goal with its repository rules for the Worker report`, which requires both `AXIOM_FIXTURE_REPO` and `AXIOM_PLANNER_EXAMPLE`. Neither was supplied. No skip was added or changed. Every enabled existing test in both requested trees passed; the exact-call tests and real-hook suites remain unchanged. No red check was invented for this structural Task.

The five new tests cover executable reference-transaction/post-commit hooks and a working unscoped control, exact callback result/error identity, recursive cleanup after a nonempty private-index directory, real parent-repository discovery and refusal with realpath comparison, exact environment/deadline options, and a file-wide built-in `rm` mock proving best-effort cleanup. Cleanup restores mocks/environment stubs and removes all test-created temporary repositories/directories in `afterEach`; removal-failure cleanup uses the real `rm` from `vi.importActual`.

## Necessary differences and sandbox handling

- The third callback parameter is locally named `consume`, instead of the brief's `use`. The repository's React Hooks lint rule interprets a call to a function named `use` as a React Hook even in this main-process module. Renaming only the parameter resolves that false positive without changing the signature's types, callback semantics, exports or lint configuration. The new test's hooks-array expectation uses a template literal for the same string because the lint rule requires it. The first lint run caught these two issues; the final full lint passes.
- The default shell selected Node 20 and could not switch pnpm versions. Selecting the already installed Node 24 toolchain resolved this; nothing was downloaded or installed.
- `git mv` was attempted and refused with `.git/index.lock: Operation not permitted`. Per the brief, both files were moved with plain `mv`. The temporary index recognizes both as 100% identical renames; the launcher can record them normally.
- New files were registered with `git add --intent-to-add` using an index and object directory under OS temp because this checkout's `.git` is read-only. Git inspection and changed-code quality use `GIT_INDEX_FILE=/private/tmp/axiom-struct-1-checks.NRthaX/index`, `GIT_OBJECT_DIRECTORY=/private/tmp/axiom-struct-1-checks.NRthaX/objects`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES=/Users/henry/Documents/Axiom/.git/objects`. The temporary index was initialized with `git read-tree HEAD`. These variables were passed only to inspection/index commands and changed-code quality, never to a test run.
- Package-build wrappers could not run in the sandbox. The exact direct Bun and compiler stages requested in the brief were used, and CI's Node script ran unchanged. The verifier still needs to run the wrappers and every Mission e2e spec on the host. No Mission e2e run or independent audit is claimed here.
- Only changed TypeScript implementation/new-test files were passed to `oxfmt`; no Markdown or import-only file was formatted. The private-index options line is kept exactly as requested in the brief.

## Limitations and risks

This change deliberately leaves the missing ceilings, missing explicit write deadlines, raw-error paths and hook-enabled mutations listed above for Henry to decide separately. Managed-worktree roots are expected from the kernel but not universally revalidated at each call. Existing WSL ceiling transmission and path-separator caveats remain. The snapshot's private index and empty hooks scope continue sharing one directory; no new isolation model was introduced. Best-effort cleanup can leave temporary directories after filesystem failure, but cannot invalidate a successful write or hide its original failure. The verifier must still assess the immutable Candidate and host e2e evidence; this report is implementation evidence only. No policy, store, contract, RPC, CLI, renderer, schema or lifecycle behavior was changed.
