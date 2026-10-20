# UPSTREAM-2 / Attempt 2 — Worker submission

Date: 2026-10-20. Branch: `axiom/attempt/UPSTREAM-2/2`.
Starting HEAD: `22bba5d9555f9c251a37cf773633891998529c8a` (verifier addendum).
Attempt-1 implementation: launcher commit `e8962fbcd7`.

Delivery state: **uncommitted registration fix; ready for independent verification**.
No fetch, pull, push, cherry-pick, commit, dependency installation/rebuild, or repository `.git` mutation was performed. The initial working tree was clean.

## Objective and change

The attempt-2 addendum authorizes closing the CLI TS6307 failure by registering the three modules already reached by the attempt-1 semantic ports. D56 and the UPSTREAM-2 triage remain the governing intake decision and execution unit. No product behavior, architecture, or scope decision changes.

`config/tsconfig.cli.json` gains exactly these three entries in alphabetical position beside the existing Codex entries:

| Added path | Existing import that requires registration |
|---|---|
| `../src/main/codex/codex-hook-retired-commands.ts` | `codex-hook-legacy-cleanup.ts` |
| `../src/main/codex/codex-real-home-hook-install.ts` | `codex-hook-service-implementation.ts` |
| `../src/main/codex/codex-real-home-hooks-json.ts` | `codex-hook-legacy-cleanup.ts` and `codex-real-home-hook-install.ts` |

Upstream reference: `git show --format= cfa43e7eab -- config/tsconfig.cli.json` includes the same registrations. Only these three applicable additions were taken; upstream's other registrations, removals, and architecture changes were not ported. No further TS6307 entries appeared after the fix. The three modules have no direct Electron import; their dependencies already belong to the existing CLI program, and the fresh CLI typecheck passes.

Every pre-existing byte of `config/tsconfig.cli.json` is preserved. All attempt-1 source, tests, the intake register, and `.axiom-work/reports/UPSTREAM-2-1.md` remain unchanged. `orca-mapping.md` remains unchanged because no mapped seam changed.

## Verification

Toolchain: `/Users/henry/.nvm/versions/node/v24.21.0/bin` prepended to PATH; Node `v24.21.0`, pnpm `12.0.0`, TypeScript `7.0.2`, Vitest `4.1.11`. Required checks ran with `ORCA_BACKGROUND_LAUNCH=1`. The existing native-runtime check passed without rebuilding dependencies. The temporary-HOME/userData fixtures and real-home write guard were unchanged.

Before the baseline CLI reproduction, removed the three existing caches with the authorized command:

```sh
rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo
```

The baseline CLI run recreated its cache. After editing, removed it again with `rm config/tsconfig.tc.cli.tsbuildinfo`. The node cache was still absent, so both final typechecks started without their build-info files.

All log filenames below are under `/private/tmp/axiom-upstream-2-2.8UYA1X/`.

| Check | Result | Evidence |
|---|---|---|
| Clean-cache `pnpm tc:cli`, before edit | **Expected FAIL**, exit 1; exactly the three reported TS6307 missing-module errors | `tc-cli-before.log` |
| Clean-cache `pnpm tc:cli`, after edit | **PASS**, exit 0; no further registrations required | `tc-cli.log` |
| Clean-cache `pnpm tc:node` | **PASS**, exit 0 | `tc-node.log` |
| Focused nine-file suite, command below | **PASS**, exit 0; 9 files, 112 tests | `focused.log` |
| `pnpm run check:code-quality:changed` | **PASS**, exit 0; zero new findings across 17 source files from the full port; automatic comparison base `da8477ec5493` | `quality.log` |
| Full `pnpm lint` | **PASS**, exit 0; all chained audits, ratchets, catalog and localization checks completed | `lint.log` |
| `pnpm run verify:rpc-params-catalog`, invoked by full lint | **PASS**; generator `--check` completed and the lint chain continued successfully | `lint.log` |
| Config registration review | **PASS**; exactly the three requested paths, each unique and in alphabetical position; removing those three lines reproduces the original file byte-for-byte | Read-only comparison against `HEAD:config/tsconfig.cli.json` |
| Final scope and whitespace | **PASS**; only `config/tsconfig.cli.json` modified and this report untracked; `git diff --check` passes; attempt-1 files and protected paths unchanged | `git diff --name-only main`, `git ls-files --others --exclude-standard`, and comparison against starting HEAD |

Focused command:

```sh
pnpm test src/main/codex/hook-service-trust-grant.test.ts src/main/codex/codex-hook-retired-commands.test.ts src/main/codex/codex-hook-legacy-cleanup.test.ts src/main/codex/hook-service-legacy-cleanup.test.ts src/main/codex/codex-real-home-hook-install.test.ts src/main/codex/codex-real-home-hooks-json.test.ts src/main/codex/codex-trust-config-rollback.test.ts src/main/codex/codex-user-hook-trust-rebase.test.ts src/main/agent-trust-presets.test.ts
```

## Retained evidence, limitations, and handoff

The verifier addendum reports host results for attempt 1 in `verify-UPSTREAM-2-1-20261020-022102.log`: 907/914 target files passed, with the known environmental `pty-runtime-hidden-at-spawn-mark` failure; full lint, changed-code quality, `tc:node` / `tc:web`, and sidecar assertions passed. These are supplied verifier results, not fresh attempt-2 runs. This attempt reran the checks required by the addendum; it did not repeat the broad suite, `tc:web`, Electron smoke, packaging, or the matcher negative control. The original negative-control evidence remains in the unchanged attempt-1 report.

The config registration fixes the previously out-of-scope CLI blocker without changing the semantic ports. Their existing limits remain: the cross-instance lock is out of scope for single-instance V1; the real Codex binary contract test is not ported; `5b3366f78e` part (a), launch-environment HOME selection, remains deferred. The other deferred upstream work remains unchanged.

No unresolved implementation questions or additional file registrations remain for this addendum. The launcher owns candidate creation, independent verification, host-only checks, integration, and the milestone completion decision. This submission does not mark the Task integrated or the Mission complete.
