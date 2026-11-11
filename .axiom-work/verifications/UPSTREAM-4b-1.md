# UPSTREAM-4b attempt 1 — verification record (verifier host step)

Candidate `86c0174eb9` on `axiom/attempt/UPSTREAM-4b/1`, from main `2ba95a07ed` (brief and sidecar). No Worker attempt: D56 step 2 gives dependency changes to the verifier on the host. Made and checked by `launchers/upstream-4b-host.command`, 09:53–10:58 MST 2026-11-11 (`host-check-UPSTREAM-4b-20261111-095316.log` and its part logs); 15 files +525 / −109. Because the verifier both made and checked this candidate, every check below is a deterministic one (no judgement call stands in for a test), and the before / after evidence comes from the same host in the same run.

## What changed

- `package.json`: `electron` 43.7.8 → 43.8.6, `dompurify` 3.4.16 → 3.4.17 (both in `devDependencies`; the brief's ground truth 3 says "dependencies" — a slip, the renderer bundles it either way). `pnpm-workspace.yaml`: the override `dompurify@<3.4.17: 3.4.17` replaces `monaco-editor>dompurify: 3.4.16`; `patchedDependencies` gains glob 13.0.6 and minimatch 9.0.9 / 10.2.5 / 10.2.6. `pnpm-lock.yaml` as `pnpm install --no-frozen-lockfile` wrote it (14 s): one DOMPurify left (3.4.17, for the app, Mermaid and Monaco), the four patch hashes equal the sha256 of the four patch files, Electron 43.8.6.
- `src/shared/node-runtime-pin.ts`: `electron: '43.8.6'` (`check-node-runtime-pin`: "Node 24.22.1 for Electron 43.8.6"). `config/scripts/electron-runtime-floor.test.ts`: minimum 43.8.6, the reasons for 43.8.1 / 43.8.4 / 43.8.6 in the comment, upstream's test title.
- The four popup files: upstream `914b260fa6`'s changes as is, the version expectation 43.8.6.
- The four patch files byte for byte from `9c7fe9793e` (sha256 checked by `apply.py`), its test additions, the desktop half of its `dependency-security.md` change (rows, scope note, test note; DOMPurify among the published fixes).
- `oxfmt --check` on the seven changed TypeScript / JavaScript files: clean, nothing reformatted.

## Checks

| Check | Result |
|---|---|
| Installed Electron after `pnpm install` | package 43.8.6, `dist/version` 43.8.6, bundle `CFBundleVersion` 43.8.6; postinstall repaired the binary path, native modules already loaded in Electron (no rebuild) |
| Twelve Electron probe files (upstream's PR job list), Node runner, serial, background launch | main on 43.7.8: 12 files / 67 tests passed, 2 todo (105 s); branch on 43.8.6 with upstream's test changes: the same 12 / 67 / 2 (100 s) |
| **Red check**: main's three popup test files on 43.8.6 | 3 files fail, 13 of 36 tests: the version expectation; link options no longer expose `openerSandboxFlags` and adopted link creation now reports `createWindow` (the adapter's `createWindow-missing` wait times out); then "Target page, context or browser has been closed" for the rest of the two other files — main's native fixture touches a destroyed window's contents on 43.8.x, which upstream's fixture guard fixes. With upstream's changes all pass (row above) |
| `verify.sh UPSTREAM-4b 1` (`verify-UPSTREAM-4b-1-20261111-101813.log`) | OVERALL=PASS: vendor-egress ratchet; sidecar targets under Bun 6 files / 46 tests; CI's Axiom step under Node 226 files / 2,144 tests (1 skipped); `pnpm tc` ×3; changed-code quality; both sidecar extras; full lint (includes `check:node-runtime-pin` and `check:runtime-electron-ratchet`) |
| Sidecar targets under Node | 6 files / 46 tests passed |
| Union sidecar pre-check on the candidate tree | `ran 1113 skipped 203 failed 0 unique 1316` |
| Full suite (`ORCA_BALANCE_UNIT_SHARDS=1 pnpm test`) | main: 13,674 files, 38 failed (47 tests), 1,246 s; branch: 13,674 files, the same 38 failed files and the same 47 failing tests (the failing-test lines of the two logs are identical), 135,401 passed — the four more are the new minimatch and glob tests; 1,244 s |
| Every Mission spec and exit m1 / m2 | 21 spec runs / 48 tests green, the same set and count as the UPSTREAM-4 host check (10:43–10:54) |
| Cold-start egress, three stacks | host and attributed tallies `{}` in all six runs (both / chromium / node × fresh onboarding and default main window), 55–56 s per stack |
| Packaging (`electron-builder --dir`) | `build:unpack` rc=1 in `afterPack`, for two reasons that do not depend on this change (next section); the bundle `dist/mac-arm64/Axiom.app` was assembled (identity `com.lapagayo.axiom`, Computer Use helper present, 524 MB) |
| Packaged-app egress canary (foreground 75 s) | pending at the time of this commit: `launchers/upstream-4b-integrate.command` runs it first (`launchers/e2e-packaged-egress.command` on this bundle) and writes its verdict here in a separate commit before it merges |

## Full suite: what fails on main before and after

The 38 failing files are the same on main and on the branch: the 25 `mobile-web-app` render suites (no Playwright browser build on this host, D75) and 13 others. Nine of the 13 were already on the last full-suite list (`fullsuite-D75-HYG-1-failed-files.txt`, 2026-10-23: real shell startup, macOS bash 3.2, the process-host dev rebuild, `/var` vs `/private/var`). **Four are new since 2026-10-23 and fail on main today**:

- `src/main/orcad/orcad-account-services.test.ts` — `accounts.selectCodex({ accountId: null })` now rejects with `system_default_retired` (`refuseRetiredCodexSelection`, added by M3-08d on 2026-10-26).
- `src/main/runtime/orca-runtime-git.test.ts` (4 tests) — commit-message and pull-request generation return "No Codex account selected. Add a Codex account in Settings › Accounts." (the same M3-08d change).
- `src/main/runtime/orca-runtime-linked-issue-live-meta.integration.test.ts` — the generator is never called; consistent with the same early return (inferred, not traced).
- `src/main/ai-vault/structured-chat-cli-fork.test.ts` — the fixture's materialized system home no longer receives the rollout (ENOENT); it exercises the legacy system-home resume path that M3-08d changed (inferred, not traced).

These kernel tests still describe the system-default Codex account that M3-08d retired on purpose, and nobody saw them turn red because the gates run each Task's sidecar targets, not the full suite (D56 asks for the full suite on upstream batches; UPSTREAM-4 did not run it — the verifier's omission). Not this Task's scope: a separate test-only hygiene Task aligns them with M3-08d, and the full suite now also runs with each weekly D56 screening.

## Packaging (not caused by this change)

1. `verify-skills-cli-runtime`: the packaged CLI's `cli/handlers/axiom/attempt-mcp.js` imports `@modelcontextprotocol/sdk/server/mcp.js`, which resolves outside `Contents/Resources` into the shared pnpm store (`~/Library/pnpm/store/v11/links/…`). The import arrived with M3-08h (2026-10-29); the shared virtual store with upstream `4fc1855bda` (2026-10-18), which keeps it off in CI. The previous host pack (2026-10-24) already ended with rc=1, then on a stray `ci-shards` root entry.
2. The test run left a git-ignored `tmp/dependency-security/desktop.json` at the repository root and the pack put it into `app.asar` (all 72 `stablyai` matches in the asar are package names in that file; the 73rd is `NOTICE.md`). Package names, not endpoints.

Both are host packaging hygiene (pack from a clean tree with the store layout CI uses), recorded as a verifier follow-up. Neither touches Electron, DOMPurify or the patched build tools.

## Not taken (as in the brief)

The `node-pty` kqueue fix (`eb3379ff99`), body-parser 2.4.0 and `@hono/node-server` 2.1.5, happy-dom, the mobile / docs site / audit-tool parts, `config/dependency-security-exceptions.json`.

## Verdict

VERIFIED for integration, on one condition: the packaged-app egress canary must report no vendor host and no non-loopback request; the integration launcher checks that before it merges and stops otherwise. Not covered here: the four kernel tests that fail on main since M3-08d (M3-08d-HYG) and the host packaging hygiene (verifier follow-up).
