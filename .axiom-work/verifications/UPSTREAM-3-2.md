# VerificationRun — UPSTREAM-3 attempt 2

- Task: UPSTREAM-3 (D72). Attempt 2 scope: the M0 pass over upstream code that merged without conflict — shipped code only (23 vendor-egress pairs, five workflows' triggers, new user-visible text per D32, the lowercase `orca` review in seven catalogs). B1 and upstream test samples were out of scope (D73 / D74 then pending).
- Candidate: `f75fb01fa8` (branch `axiom/attempt/UPSTREAM-3/2`, base `51273c1e20` = attempt 1 + verifier review commit).
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 20:06–21:08 MDT (62 min); report `.axiom-work/reports/UPSTREAM-3-2.md` (389 lines).
- Verifier: Claude. Launcher verification `verify-UPSTREAM-3-2-20261022-210838.log` (`OVERALL=FAIL`); review below.

## What the attempt did (checked)
- Shipped vendor pairs: 22 of 23 removed by the M0 rules — launchd / daemon labels to `com.lapagayo.axiom.*`, the terminal host helper renamed to `Axiom Terminal Host`, the App Store and GitHub update sources derived from Axiom's identity and switched off by `PRODUCT_EGRESS_POLICY.automaticUpdateChecks` (a new mobile test asserts zero fetches on cold start and on an explicit check), the Windows administrator-mode docs link through `resolveProductDocsUrl`, the PostHog key requirement removed from the release artifact script, the never-shipped Portuguese plugin migration removed with its test, issue citations rewritten as `upstream orca#N`. The 23rd (`@stablyai/playwright-test`, a package name) stays under D74.
- Workflows: `ci-cache-warmup-platforms`, `ci-runner-demand`, `ci-xterm-cache`, `node-server-tests`, `wsl-orcad-e2e` lose only `on.push` / `on.schedule` (the Worker compared the parsed YAML documents); workflow self-tests follow.
- Branding: 755 of the 772 candidate lines changed in 403 files, 6 through regenerated guides, 11 kept on purpose (font family identifier, wire header names, persisted shell-wrapper sentinels, a historical version note, a captured User-Agent, a grammar author credit); 105 further lowercase CLI / scheme literals; new upstream Windows PE metadata now names Axiom / LaPaGaYo. Catalogs: 45 value-only edits from the review lists.
- Seam check 137 / 0 dropped; no markers; RPC catalog still 41 `axiom.*` methods.

## Incident: a patch edit broke the dependency install
The Worker rewrote the upstream issue citation inside `config/patches/ws@8.22.0.patch`. That changed the patch's pnpm hash, so the lockfile no longer matched: in the sandbox `pnpm run generate:*` started an automatic install that could not reach the network and left the root `node_modules` empty (the Worker stopped it and finished with loader-based commands). The launcher's `pnpm install --frozen-lockfile` repair then refused (patch hash mismatch), and the verification's own first `pnpm run` auto-installed on the host and rewrote `pnpm-lock.yaml` in the working tree. Verifier fix: upstream's patch restored byte for byte and the committed lockfile restored; the citation is re-entered as provenance (D74 execution note); root and `mobile/` dependencies are reinstalled with `--frozen-lockfile` on the host before attempt 3; the attempt-3 brief forbids edits under `config/patches/` and package manifests and says to interrupt any pnpm auto-install.

## Launcher gates
| Check | Result |
|---|---|
| vendor-egress ratchet | FAIL then (upstream test samples, D74 pending); after the D74 re-baseline it passes with 468 pairs and 0 in shipped code |
| unit targets (`config/scripts`, renderer i18n, `src/main/daemon`, serve coordination, CLI specs, orchestration db) | 58 files failed / 716 passed / 9 skipped. About 40 are `config/scripts/mobile-web-app/**` and `build-mobile-web-app-bundle`: `mobile/` is a separate pnpm workspace whose lockfile upstream changed (4,760 lines) and it had not been reinstalled since the merge. Six are daemon PTY tests timing out. The rest (`macos-terminal-host-bundle`, `ci-pr-concurrency-keys`, `ci-managed-ssh-execution`, `main-entry-facade`, `process-host-dev-rebuild`, `dependency-security-release`, `agent-state-rules-bundle`, `verify-skill-update-roundtrip`, `verify-cli-bin`, `pr-preflight-gates`, `pr-code-change-scope-format-route`, `pr-auxiliary-preflight-admission`, `mobile-web-terminal-engine-closure`) go to attempt 3's triage after the reinstall |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | FAIL (B1 only) / PASS / PASS |
| changed-code quality | not applicable to the full merge (E2BIG, 440 s) |
| sidecar extras | 18 / 19 PASS — every M0-pass assertion (no shipped pair, five workflows, `pt.json`, PostHog), markers, seam check, schema, cloud / release-workflow absence, vitest guard, catalogs, gates. FAIL: protected files, only because the verification's auto-install had rewritten `pnpm-lock.yaml` (restored) |
| full lint | everything before the ratchet PASS (oxlint 0 errors, anti-slop, both code-quality audits, reliability gates, dead classes, max-lines, ts-nocheck, runtime-electron); FAIL at the ratchet as above |

## Verdict
PARTIAL — continue. Verifier commit on top of the candidate: D73 / D74 ACCEPTED (Henry 2026-10-22, "D73 B、D74 B") with the D11 revision and DEF-25, the D74 re-baseline (`upstream3-egress-rebaseline.py`), the restored `ws` patch, the attempt-3 brief (B1 per D73 plus the test triage above).
