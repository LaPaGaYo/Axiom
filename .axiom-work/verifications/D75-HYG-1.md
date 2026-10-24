# D75-HYG · V1 desktop-only: mobile-pairing entry points closed behind one switch — attempt 1

- Scope (D75 revision 2026-10-23, Henry: "只关入口"): close every mobile-pairing entry point; packaging and the vendor-egress ratchet stay as they are because the mobile web bundle also ships in the orcad server template, whose artifact contract requires it.
- Candidate: attempt 1 `8b53208277` (27 files, +490 / −84, report included), base main `06236b80e2`. Merged `--no-ff` as `ba53ed8e3b`; merged tree = candidate tree.
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 16.6 min; report `.axiom-work/reports/D75-HYG-1.md`.
- Verifier: Claude. Launcher verification `verify-D75-HYG-1-20261023-170448.log` (chain `chain-20261023-164807.log`); host check `host-check-D75-HYG-20261023-203721.log` (chain `chain-20261023-203721.log`).

## Launcher gates (attempt 1)
| Check | Result |
|---|---|
| vendor-egress ratchet | PASS (455 pairs, baseline file unchanged) |
| unit targets (SidebarNav, `components/settings`, settings-navigation hooks, WorktreeJumpPalette, `store/slices/ui*`, `components/mobile`, `src/main/menu`, serve validation, `src/cli`, orcad launch contract / arguments, `src/main/startup/serve*`, desktop-control grant) | PASS — 487 files, 4,485 tests (10 skipped), 38 s |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | PASS |
| changed-code quality (24 changed source files, all seven categories) | PASS |
| sidecar extras (allowlist, untouched paths incl. `mobile/`, `config/`, `src/main/runtime`, `src/main/ipc`, pairing panes, `docs/decisions`, `tests`; switch value; seven gates import the switch; refusal text; help text; MobilePage queries; fence balance; orca-mapping; allow-comment guard; typecheck:e2e ≤ 226; report) | 18 / 18 PASS |
| full lint | PASS (91 s) |

## Host check (candidate `8b53208277`)
- Complete unit suite (`ORCA_BALANCE_UNIT_SHARDS=1`, `fullsuite-D75-HYG-1-20261023-203722.log`, 907 s): **Test Files 34 failed | 13,372 passed | 120 skipped (13,526)**; Tests 34 failed | 133,908 passed | 17 expected fail | 1,568 skipped.
- The 34 failing files: 25 `config/scripts/mobile-web-app/**` render suites (the host has no browser build for the merged Playwright; D75 point 3: non-blocking) + 9 files with 31 failing tests. Those 9 re-run alone and on the pristine upstream clone `41661e3312` (`upstream-baseline-20261023-205416.log`), classified by test name (`host-check-D75-HYG-classification-20261023-203721.md`): **environmental 31, merge-caused 0, baseline-only 0** — `pr-auxiliary-preflight-admission` 8, `process-host-dev-rebuild` 6, `ci-managed-ssh-execution` 5, `orcad-forked-child-paths` 4, `bash-prompt-command-composition` 3, `orca-runtime.test` 2, `dependency-security-release` 1, `packaged-cli-assets` 1, `pty-pane-materialization-race` 1.
- **`MobilePage.test.tsx` no longer fails** (it was the only D75 item in the UPSTREAM-3 main classification).
- `pnpm run typecheck:e2e` run explicitly (the launcher extra finished in 3 s because the e2e check runs on the pinned Bun compiler): **226 errors** = the pin; none in files this task changed.

## Independent review
- **Switch** `src/shared/mobile-pairing-availability.ts`: the three lines from the brief, `MOBILE_PAIRING_AVAILABLE: boolean = false`.
- **Renderer**: `shouldShowMobileButton` = switch AND setting (row, context menu, onboarding badge and paired-device control hang off it); `buildSetupSettingsSections` lists `mobile` only with the switch on; `renderMobileSettingsSection` also checks the switch — the Worker showed that `neededSectionIds` (`settings-load-performance.ts`) adds the active and pending sections without checking the nav list, so removing the nav entry alone would still mount the pane for a stale `activeSectionId: 'mobile'` (its context type was narrowed to the three fields it reads, so the test needs no cast); the Appearance toggle and its `getSidebarEntries()` entry are conditional (indexes 0 and 1 unchanged, nothing reads past 2); `sanitizeHydratedActiveView` maps `'mobile'` to `'terminal'` while the switch is off.
- **Main menu** `register-app-menu.ts`: the checkbox is a conditional spread. The file sat at exactly 300 code lines (the `max-lines` limit), so the Worker compensated with three behaviour-preserving rewrites in the same file — `shortcutLabel` as one expression, the Window menu built inline in the template, `isMac ? macAppMenu : fileMenu` instead of two exclusive spreads. Reviewed line by line: menu order and items unchanged; the menu tests (order Status Bar, Tasks, Automations, Titlebar App Name with the switch off) pass.
- **Serve**: one refusal, `Mobile pairing is not available in this version of Axiom.`, after all existing combination checks in `getServeOptionValidationError`, which `axiom serve`, the desktop serve mode (`--mobile-pairing` / `--serve-mobile-pairing`) and orcad all call; the combination messages stay byte-identical. `[--mobile-pairing]`, its note and example are gone from `serve.ts` and the root help; the orcad help drops the flag line and the `or --mobile-pairing` clause; `'mobile-pairing'` stays in `allowedFlags` (typo hint and refusal). Argv handling untouched.
- **Tests**: the upstream files that exercise the dormant paths (SidebarNav, register-app-menu, ui-hydration-view-layout, index-serve-command, orcad-launch-contract, useSettingsNavigationMetadata) keep their test bodies under a file-level getter mock (switch on, reset per test); each adds one switch-off case. Real-switch tests: `serve-option-validation.test.ts`, `settings-navigation-capability-sections.test.ts` (new), `settings-setup-workflow-section-renderers.test.tsx`, `AppearancePane.test.tsx`, `appearance-search.test.ts`. The Worker's red run failed all 11 new closure checks on the original entry points plus the three Relay cases.
- **MobilePage.test.tsx**: only the three queries `'Axiom Relay'` → `'Orca Relay'` (the test's own mock button label; upstream bytes).
- **Docs**: `remote-servers.mdx` keeps one sentence under "Mobile from a headless server" (16 fence lines, balanced); `orca-mapping.md` row `mobile / cloud` records the dormant entry points, the switch and the bundle in the orcad template.
- Scope: allowlist respected; `mobile/`, `config/`, `package.json`, lockfiles, `src/main/runtime`, `src/main/ipc`, `src/main/daemon`, `orcad-artifacts.ts`, the serve argv modules, `MobilePage.tsx`, `MobileSettingsPane.tsx`, `MobilePane.tsx`, `docs/decisions` and `tests/` unchanged; i18n catalogs unchanged.
- Worker environment: the sandbox's `pnpm test` / `pnpm tc:*` wrappers stop at the `tsx` CLI's IPC listener (`listen EPERM`, known since UPSTREAM-3); the Worker used the repository runners directly and reported 10 CLI listener test files failing in the sandbox. All of them passed in the launcher's unit step and in the host full suite. No install was attempted after an early pnpm self-setup probe failed on EPERM.

## Left as is (dormant, recorded)
- `openMobilePage` has no caller once the sidebar row is gated; the pages, IPC handlers, pairing / relay / push modules and the mobile web bundle stay in the tree and in both packages.
- Dormant copy still says the shortcut "remains available from Toolbox"; the Account pane still mentions Axiom Mobile. Both unreachable or out of scope.
- Packaging (`out/mobile-web` in app.asar and in the orcad template) and the ratchet exclusion of `mobile/**`: deferred to the next baseline reset or DEF-26 (D75 revision).

## Verdict
PASS — merged as `ba53ed8e3b`. verify-main on the merged tree follows (D75-HYG added to `verify-main.target`).

## Merged tree (main `0288b4df23`) and push
- verify-main (`verify-merged-0288b4df23-20261023-214451.log`, union of 32 sidecars M1-01 … UPSTREAM-3 + D75-HYG): 550 checks — ratchet, clean-cache `tc:node` / `tc:cli` / `tc:web`, changed-code quality, **543 / 543 extras**, full lint PASS; unit step 30 failing files = the 25 mobile-web-app render suites + the 5 environmental files from the host classification (`ci-managed-ssh-execution`, `dependency-security-release`, `pr-auxiliary-preflight-admission`, `process-host-dev-rebuild`, `pty-pane-materialization-race`); vendor-egress baseline unchanged (455).
- Pushed by the guarded launcher (`launchers/d75-hyg-verify-main-push.command`: non-unit checks all rc=0 and no unexpected unit failure): `1f5dc70c1b..0288b4df23`. Axiom CI on `0288b4df23`: success.
- The same push surfaced a 0 s failed `.github/workflows/release-cut.yml` run: UPSTREAM-3's M0 pass had removed the only secret passed to `release-javascript.yml` (declared `required: false`) and left `secrets:` empty, which GitHub rejects for the whole file (the previous push landed while the fork's workflows were disabled). Fixed in `51255450e4` (one line); the next push produced no failed run.
