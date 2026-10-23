# UPSTREAM-3 — attempt 4

## Scope and delivery

- Branch: `axiom/attempt/UPSTREAM-3/4`; starting HEAD: `1af39c78f416707a6257f07fe254ecd4e5dce49d`.
- Fixed the two reported test failures and one stale Electron-spec consumer found in the required provider-call audit. Production code and workflows are unchanged.
- Three test files changed, plus this report. All changes are uncommitted for the launcher. No checkout Git metadata writes, dependency installation, manifest/lockfile/patch edits, baseline edits, or formatting commands were performed.
- Attempts 1–3 remain intact. Independent host verification and integration remain the verifier's responsibility.

## Changes

1. `tests/e2e/helpers/fixture-plan-proposal.unit.test.ts:64` and `:87`: removed the obsolete `dcap_fixture` argument from both `submitFixture` calls. They now pass `(attemptId, missionId, taskId)`. The existing assertions again verify that the Task crash marker is consumed before the crashing stub, no Submission occurs on the crash, and the subsequent Attempt submits normally.
2. `config/scripts/ci-closed-pr-cancellation.test.mjs:76`: removed only `cloud-verify-refs/pull/123/merge` from the expected concurrency groups. All other 27 keys, their order, and the cancellation assertions remain. This matches the existing workflow's D33a removal; the workflow itself was not edited.
3. `tests/e2e/mission-attempt-launch.spec.ts:115` and `:254`: its provider-ledger schema still required `capability`, and its assertion expected `dcap_`. Replaced these with required nonempty `terminalHandle` / `paneKey` fields and the terminal-handle prefix assertion. The host emits `term_` handles (`src/main/runtime/terminal/identity/terminal-handle-bindings.ts:133`). Existing Attempt identity, worktree, preamble, and restart-persistence assertions remain.

## Provider-call audit

Read attempt 3's provider diff, then searched all of `tests/e2e/**` and `src/**` for `submitFixture`, `submitPlannerFixture`, `AXIOM_TEST_PROVIDER_SOURCE`, and ledger consumers. The provider changed exactly two function signatures; neither has callers in `src/**`.

| Call site or consumer | Result |
| --- | --- |
| `helpers/fixture-plan-proposal.unit.test.ts:64,87` | Both obsolete four-argument Worker calls updated to three arguments. |
| `helpers/axiom-test-provider.ts:153` | Worker callback already passes Attempt, Mission, Task in the correct order. Unchanged. |
| `helpers/axiom-test-provider.ts:147` and `:105` | Planner reporter launch already sends Attempt, Mission, GoalRevision; the `--planner-submit` entry point spreads exactly those three arguments. Unchanged. |
| `helpers/fixture-plan-proposal.unit.test.ts:125` | `fixtureProposal(tasks, goalRevisionId)` signature did not change. Unchanged. |
| `mission-attempt-launch.spec.ts:141,144` | Writes the shared provider source; stale ledger consumer updated as described above. |
| `mission-plan.spec.ts:138,141` and `:110` | Writes the shared provider source; its ledger reader accepts the current proposal/error records without requiring a token. Unchanged. |
| `helpers/axiom-fixture-mission.ts:92,95` | Writes the shared source and preserves the binding-poll proxy's argv forwarding. Unchanged. |
| `helpers/axiom-fixture-inspection.ts:113` | Shared ledger schema already accepts terminal/pane identity instead of capability. Unchanged. |
| `mission-attempt-submit.spec.ts:94` and `mission-exit-m2.spec.ts:129` | Submission and exit consumers already match the current ledger format. Unchanged. |

The only remaining `dcap_` references in the Mission Electron specs are the two defensive redactors in `mission-plan-real-codex.smoke.spec.ts:53,161`; they are not provider calls or token requirements and were retained. Electron specs were inspected, not launched in this sandbox.

## Runner and checks

Validation used Node `v24.21.0` after:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH
```

Tests used the requested upstream launcher, which resolved the installed pinned **Bun 1.4.3**, running **Vitest 5.0.5**. Its `ORCA_BACKGROUND_LAUNCH=1` and real-home write guard remained active. No alternate Node-only Vitest runner was used. The launcher correctly routes the process-shutdown helper to its `node-runtime` project.

### Two regression targets

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache tests/e2e/helpers/fixture-plan-proposal.unit.test.ts config/scripts/ci-closed-pr-cancellation.test.mjs
```

- Before edits: **2 files failed; 2 tests failed / 25 passed**. Reproduced the shifted crash-marker arguments and the extra expected cloud key.
- After edits: **2 files passed; all 27 tests passed**, exit 0.

### Requested helper and CI selection

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache tests/e2e/helpers config/scripts/ci-
```

**45 files passed / 4 failed; 608 tests passed / 18 failed**, exit 1. This selection covers 23 helper files and 26 CI files. Every CI file except the explicitly known Bash-3.2 case passed. All four failing files were rerun in separate launcher invocations with the same flags, one file at a time:

| File | Isolated result and evidence | Classification |
| --- | --- | --- |
| `config/scripts/ci-managed-ssh-execution.test.mjs` | 7 passed / 5 failed. `mapfile: command not found`, exit 127, in selected-file, full-suite, and legacy/missing-checkout cases. Reproduces alone. | Known macOS environment issue; available Bash is `3.2.57(1)-release`. Unchanged per brief. |
| `tests/e2e/helpers/recording-proxy.unit.test.ts` | 18 passed / 10 failed. Every failure is in the listener-dependent `recording proxy` group: `Failed to start server. Is port 0 in use?` at `recording-proxy.ts:190`. Reproduces alone. | Sandbox blocks loopback listeners. |
| `tests/e2e/helpers/remote-skill-cloud-fixture.unit.test.ts` | 1 failed. Concurrent fixture startup does not fulfill both promises (`expected false to be true`, line 19). Reproduces alone; both fixture starts require a loopback listener (`remote-skill-cloud-fixture.ts:57`). | Sandbox listener restriction; requires host rerun. |
| `tests/e2e/helpers/electron-process-shutdown.unit.test.ts` | 6 passed / 2 failed: `starts final daemon cleanup after app exit and awaits public close and all descendants` times out; `keeps the grace and kills a surviving descendant after the root exits` returns in about 54 ms instead of at least 2000 ms. Reproduces alone. | Sandbox blocks `ps`, which `readPosixDescendantPids` uses to discover descendants. Requires host rerun. |

Independent environment probes returned:

```text
loopback probe: EPERM: listen EPERM: operation not permitted 127.0.0.1
process-table probe: EPERM: spawnSync /bin/ps EPERM
GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)
```

No environmental failure was suppressed, skipped, or worked around by changing a test or production behavior.

### Typechecks

```sh
# cwd: src/packages/process-host
node --import tsx --conditions=orca-source scripts/build-dist.mjs
# cwd: repository root
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json
```

Build prerequisite: exit 0. All three typechecks: **PASS, zero errors**, exit 0:

```text
✓ No type errors in 3,172 files
✓ No type errors in 17,844 files
✓ No type errors in 15,673 files
```

The tool rejected the prescribed `rm -f` cache command before running it. Read-only inspection then confirmed that all three specified `.tsbuildinfo` files were already absent, so the typechecks started with clean caches without a deletion.

### Full lint and preservation checks

- **All 32 `package.json` lint stages passed**, exit 0. To avoid package-manager auto-install, executed the exact script bodies directly: split `scripts.lint` at ` && `, recursively expanded each `pnpm run <name>` using `package.json:scripts`, and ran each stage through `runProcessSync` with `/bin/sh -c`, repository cwd, and `node_modules/.bin` prepended to PATH. Stopped on any nonzero stage; none failed. No `pnpm` process or install was started.
- This includes native/type-aware quality checks, all lint ratchets, localization checks, RPC catalog, bundled guides, skill manifest, and **146 reliability gates**.
- Vendor-egress ratchet: **PASS, 465 current grandfathered pairs**. It reports three already-stale baseline entries (`agent-state-rules-bundle.test.mjs`, `verify-skill-update-roundtrip.test.mjs`, `macos-daemon-launchd.test.ts`); baseline unchanged.
- Initial oxlint reports five existing docs-site warnings; the layout ratchet reports an existing smaller count. All stages still exit 0.
- `python3 .axiom-work/scripts/upstream3-seam-check.py`: **137 touchpoints, 0 dropped**.
- `git diff --check`: **PASS**.
- Conflict-marker scan: no matches (Git grep's normal exit 1 for no matches).
- Final scope inspection: only the three test files above and this report changed; protected files are untouched.

Local diagnostic logs: `/private/tmp/axiom-upstream3-4-tests.log`, `/private/tmp/axiom-upstream3-4-typecheck.log`, `/private/tmp/axiom-upstream3-4-lint.log`, and `/private/tmp/axiom-upstream3-4-alone-<test-basename>.log`. Results needed for review are preserved above.

## Remaining

- No remaining implementation work within attempt 4's two-fix scope.
- Host verification still needs the changed Electron launch spec and the four individually reproduced environmental failures above. The broader helper/CI selection is not claimed green in this sandbox.
- D75 mobile failures, other known Bash failures, daemon PTY tests, and `process-host-dev-rebuild` remain assigned to the verifier as specified; no unrelated triage changes were made.
