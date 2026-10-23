# VerificationRun — UPSTREAM-3 full host verification (attempt 4 candidate)

- Task: UPSTREAM-3 (D72, decision 5: full host verification before main moves).
- Candidate: `166514d016` (branch `axiom/attempt/UPSTREAM-3/4`; launcher commit `2c35af8504` + verifier record).
- Verifier: Claude. Chain `launchers/chain.command` 23:09–23:46 MDT 2026-10-22 (`.axiom-work/logs/chain-20261022-230901.log`), Henry's approval for the packaged foreground run ("今晚就可以"); upstream baseline 00:03–00:05 MDT 2026-10-23.

## Results

| Check | Result |
|---|---|
| Full vitest (`fullsuite-UPSTREAM-3-4-20261022-230902.log`, live-shell portability suite excluded as in `verify.sh`) | FAIL — 82 files / 225 tests; ended with an unhandled `DevalueError` from the cross-version harness. Classified below |
| Four PTY / watcher files alone | FAIL — 25 tests; all four fail identically on pristine upstream (see baseline) |
| e2e `mission-exit-m1` + `mission-exit-m2` (fixture `flowtask-fixture`, background) | PASS — 2 passed (1.4 min) |
| e2e five fixture specs (`mission-task-detail`, `mission-home-task-list`, `mission-attempt-submit`, `mission-attempt-launch`, `mission-plan`) | PASS — 5 passed (48.7 s) |
| Cold-start egress, dev build, stacks both / chromium / node, fresh onboarding + default main window | PASS — host and attributed tallies `{}` in all six runs |
| Real Codex Planner smoke (`smoke-plan-codex-20261022-233004.log`) | PASS — 1 passed (11.6 min): mission `ANALYZING` → `PLAN_REVIEW` at +677 s; PlanRevision `planrev_20eddc9ea57c` PROPOSED (3 milestones, 12 tasks), Planner audits started → proposed → stopped; Codex 0.163.0 in an isolated home seeded with `auth.json` + `config.toml` only; evidence `.axiom-work/smoke/plan-codex-20261022-233004/` |
| Isolated homes `/tmp/axsm/cp-*`, `/tmp/axsm/orca-e2e-restart-*` | removed |
| Pack (`pack-unpack-20261022-234141.log`): three macOS helpers + `build:unpack` | FAIL — `afterPack` asar contract: `app.asar unexpected root entries: opencode.json` (root file added upstream in `822fc5bed4`); the assembled `dist/mac-arm64/Axiom.app` remained |
| Packaged app, foreground 75 s, fresh profile, recording proxy (`packaged-egress-20261022-234250.log`, on the assembled bundle) | FAIL — `github.com` ×1 (t+3 s) and `www.google.com` ×1 (t+42 s); vendor hosts none. M0 run: `{}` |
| Re-run of the 75 non-cross-version failing files (`fullsuite-rerun-20261022-234409.log`) | 75 / 75 fail again — 214 tests (deterministic) |
| Cross-version re-run (`fullsuite-rerun-crossversion-20261022-234615.log`) | FAIL — `git rev-parse v1.4.218^{commit}` (and v1.4.219, v1.4.220): tags absent, Axiom fetches upstream with `--no-tags`; same on main |
| Upstream baseline: the same 75 files on a pristine `41661e3312` checkout on this host (`upstream-baseline-20261023-000314.log`) | 74 present upstream; 13 files / 50 tests fail there |

## Full-suite classification

Detail, test by test: `.axiom-work/reports/UPSTREAM-3-fullsuite-classification.md` (`python3 .axiom-work/scripts/upstream3-fullsuite-diff.py <rerun.log> <baseline.log>`).

- **Environmental — 50 tests / 13 files**, identical on pristine upstream: real zsh/bash PTY startup (`repro-13767` 13, `shell-startup-feature-channel` 5, `shell-ready` 3, `bash-prompt-command-composition` 3, `zsh-deferred-startup-line-init.live-shell` 1, `startup-shell-portability.live-shell` 1, `pty-pane-materialization-race` 1), macOS bash 3.2 (`pr-auxiliary-preflight-admission` 8, `ci-managed-ssh-execution` 5, `dependency-security-release` 1), the process-host dev rebuild (6), `/var` vs `/private/var` (`orca-runtime` 2, `packaged-cli-assets` 1). `shell-ready` and `repro-13767` pass on main only because main has the older tests.
- **Environmental by policy**: the 6 cross-version-wire files and the run-ending `DevalueError` (release tags); `mobile-web-app-drawer-render` (Playwright browser build missing; D75).
- **Merge-caused — 162 tests / 64 files**, causes:
  - branding copy (D32): upstream's new tests assert "Orca" copy that attempt 2 rebranded, and several phrases were rebranded in one place but not in their twins (`.axiom-work/reports/UPSTREAM-3-rebrand-leftovers.txt`);
  - persisted or parsed strings rebranded on one side only: the journal truncation marker (`journal-payload-bounds.ts` writes `[Axiom: output truncated …]`; `src/shared/structured-agent-session-projection.ts:72` matches `[Orca: …]`) and the CLI retry advice (`src/cli/runtime/transport.ts` writes "Restart Orca and try again."; `agent-launch-recovery.ts:78` and `orchestration-mutation-recovery.ts:217` strip "Restart Axiom and try again.");
  - Axiom seams under new upstream fixtures: `recordProviderActivation` (M0-09) needs `store.getSettings/updateSettings` (`pty-launch-parity` 31, `codex-account-restart-resume` 5, `terminal-account-restart.unit`), `startAxiomControlPlane` needs `runtime.getOrchestrationDb` (`orcad-duplicate-pty-repair-startup` 4), Axiom's `main-process-ready-runtime-activation.test.ts` lacks `store.getProfileStorageDirectory`;
  - new upstream registries that must list Axiom: `host-operation-ownership` (41 `axiom.*` RPC methods unclassified), `wsl-move-dispositions` (`create-axiom-tables-sql.ts` and its tables);
  - deliberate Axiom behavior under new upstream tests (M0 / D37): skill sharing unconfigured, product-policy install URLs, the agent-state-rules release repository;
  - to investigate: Portuguese marker migration (`profile-state-offline-settings` 6, `profile-project-domain-transfer` 3), skill freshness (5 tests / 4 files), `rate-limits/service-refresh-orchestration` 2, AppImage copy 6, `orchestration-mutation-recovery` Windows executable, `SshHostRestartServerAction` 3, `MobilePage` / `MobileHero` 4.

## Packaging and cold start

- `opencode.json` must be excluded from the app; the asar contract did its job.
- `github.com`: the agent-state-rules live update, new upstream, on by default in packaged builds (`isPackaged && settings.agentStateRulesLiveUpdates !== false`), started from `main-process-runtime-service.ts:154` and `orcad-entry.ts:262`. The dev-build captures never see it (`isPackaged`).
- `www.google.com`: Google's s2 favicon service (`agent-catalog.tsx:111`, `open-in-app-catalog.tsx:66`, `repo-icon.ts:28`), present on main but first triggered here by a fresh-profile foreground view.
- Both violate D37 (no request before the user configures a provider or integration, or acts).
- Observed, not a gate: `[daemon] macOS terminal host fallback reason=prepare-failed … Could not read CDHash= from codesign` followed by `DEGRADED MODE: adopting the daemon …` — `materializeMacDaemonBundle` (`src/main/daemon/macos-daemon-bundle.ts`) needs a code-signed terminal host helper, which an unsigned local `--dir` build does not have; new upstream code, not in the M0 runs. Revisit when Axiom builds are signed.

## Verdict

NOT READY for integration. The kernel-level checks (exit e2e, fixture specs, dev cold-start egress, real Planner) pass on the merged tree. Attempt 5 (stacked on attempt 4) fixes the 162 merge-caused tests, the `opencode.json` exclusion and the two D37 egress paths; then this host verification repeats: full suite diffed against the upstream baseline (allowed failures: the 50 environmental tests, the cross-version files, the drawer render test), pack, packaged foreground egress `{}`.
