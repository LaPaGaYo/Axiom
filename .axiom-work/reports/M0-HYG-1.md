# M0-HYG — Attempt 1 submission report

## Summary

Added vendor-egress CI lint coverage, excluded cached cross-version checkouts from env-isolation scanning, and added bounded retries to mobile-release test cleanup.

Task: `M0-HYG`, Attempt 1. Branch: `axiom/attempt/M0-HYG/1`. Starting HEAD: `f4c7cab4430f3146196f0fdf45e2de0952d0eef5`; working tree clean at entry. Changes remain uncommitted for the launcher. This is a Worker submission, not independent acceptance or integration.

Read `AGENTS.md` including Lazy Senior Dev Mode, Constitution §3–§5, and the test subsystem instructions before editing. Reused the existing workflow step shape, ignore set, and standard-library retry pattern. No production code, regex, ratchet pin, dependencies, or baseline changed.

## Files changed

- `.github/workflows/pr.yml`: added the vendor-egress ratchet step after the runtime-electron ratchet and its associated smoke test.
- `tests/e2e/e2e-worker-env-isolation.unit.test.ts`: added only `.cross-version-checkouts` to the ignored-directory set, with formatter-required wrapping.
- `config/scripts/mobile-release-check-scope.test.mjs`: added `maxRetries: 5, retryDelay: 100` only to `afterEach` cleanup.
- `.axiom-work/reports/M0-HYG-1.md`: this requested submission report.

## Checks run

Toolchain: Node `v24.21.0`, pnpm `12.0.0`, Vitest `4.1.11`, macOS. Timings below are elapsed wall time from `/usr/bin/time -p`. Commands used this environment:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:/usr/bin:/bin
export npm_config_manage_package_manager_versions=false
export ORCA_BACKGROUND_LAUNCH=1
```

The initial shell selected Node 20; its pnpm version probe failed with `EPERM` attempting package-manager provisioning. Selecting the already-installed toolchain resolved this without installation. The read-only native-runtime preflight passed, and both patched `pty.node` and `spawn-helper` were present; the test command required no rebuild. No install/add/remove/rebuild command was run. Test flags `--no-cache --configLoader runner` prevent result-cache and bundled-config writes under `node_modules`; they retain the repository configuration and requested test targets.

| Exact command (each timed with `/usr/bin/time -p`) | Result | Duration |
|---|---|---:|
| `node config/scripts/ensure-native-runtime.mjs --runtime=node --check-only` | PASS | 0.03 s |
| `pnpm test config/scripts/pr-workflow-lint-parity.test.mjs tests/e2e/e2e-worker-env-isolation.unit.test.ts config/scripts/mobile-release-check-scope.test.mjs --no-cache --configLoader runner` (before edits) | FAIL as expected: missing vendor-egress CI command; env collector overflowed its call stack while traversing existing checkout trees. Mobile-release tests passed. | 2.01 s |
| `pnpm test config/scripts/pr-workflow-lint-parity.test.mjs tests/e2e/e2e-worker-env-isolation.unit.test.ts config/scripts/mobile-release-check-scope.test.mjs --no-cache --configLoader runner` (after edits) | PASS — 3 files, 43 tests | 1.95 s |
| `pnpm run check:vendor-egress-ratchet` | PASS — 559 grandfathered pairs, no difference | 3.75 s |
| `pnpm tc:node` | PASS | 1.55 s |
| `pnpm run check:code-quality:changed` | PASS — zero new findings across 2 changed code files | 1.40 s |
| `pnpm exec oxfmt --check .github/workflows/pr.yml tests/e2e/e2e-worker-env-isolation.unit.test.ts config/scripts/mobile-release-check-scope.test.mjs` | PASS — all 3 files formatted | 0.16 s |
| `git diff --check` | PASS | 0.05 s |
| `test -d tests/e2e/.cross-version-checkouts` | PASS — existing checkout trees retained throughout both test runs | 0.00 s |
| `pnpm lint` | PASS — entire chain, including generated-artifact and localization checks | 81.88 s |
| `git diff --check` (final review) | PASS | 1.82 s |

The existing checkout trees contain module-scope environment writes, so no dummy file was needed or created. Full lint requested no artifact regeneration. The vendor-egress baseline was not regenerated because both its standalone check and full-lint check passed unchanged. Final status confirmed only the three scoped edits and this report; the baseline diff was empty.

## Known limitations

- The intermittent macOS `ENOTEMPTY` race did not reproduce in the focused run; cleanup now uses the repository's existing five-retry, 100 ms pattern, but full-suite load was not exercised.
- The launcher must snapshot the changes and obtain independent candidate-bound verification; no commit, push, merge, or authoritative Task-stage change was performed.
- Write scope remains verified by diff inspection; no unrelated failing test was changed.

## Suggested follow-ups

- Rerun the focused suite and observe mobile-release cleanup during the verifier's next full-suite run after the launcher commits.
