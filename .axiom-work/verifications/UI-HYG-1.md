# UI-HYG · Settings › Axiom Account hidden, window title Axiom — attempt 1

- Scope: D33 revision 2026-10-24 (Henry: "同意整节隐藏,并且窗口标题改成Axiom") and the D32 window-title leftover; brief `.axiom-work/briefs/UI-HYG.md`.
- Candidate: attempt 1 `f298e112ca` (14 files, +276 / −19, report included), base main `6122645777`. Merged `--no-ff` as `6e05d523b0`; merged tree = candidate tree.
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 9 min (12:34–12:43 MDT); report `.axiom-work/reports/UI-HYG-1.md`. Started automatically by the guarded M3-02 integration after the push.
- Launcher verification `verify-UI-HYG-1-20261024-124322.log`: ratchet; unit targets 288 files, 2,107 tests; clean-cache `tc` × 3; changed-code quality; 13 / 13 extras (allowlist, untouched policy / pane / search / types / ArtifactsPage / sign-in / i18n / main / cli / config / decisions / tests, the switch line, three gates import it, both titles and no `Orca` title, title test present, orca-mapping, no ts-nocheck, allow-comment guard, typecheck:e2e ≤ 226, report); full lint PASS.

## Review
- `src/shared/cloud-account-availability.ts`: `CLOUD_ACCOUNT_AVAILABLE: boolean = PRODUCT_EGRESS_POLICY.cloudAuth !== null`, with the D33 comment; test pins the derivation and `false` in this build.
- Gates: `buildSetupSettingsSections` lists `orca-account` only with the switch on (search entries go with it); `renderOrcaAccountSettingsSection` returns `null` with the switch off, its parameter narrowed to the three `Pick`s like the Mobile renderer, tested with a stale active and a stale pending target; `ArtifactsPageAuthState` keeps the unconfigured copy and drops the "Open account settings" button, tested on the page.
- `useSettingsNavigationMetadata.test.ts` adds a getter mock for the switch beside the D75 one (upstream cases unchanged) and an off case covering navigation, Set Up order and Cmd-J results; `settings-navigation-capability-sections.test.ts` (real switches) now expects `setup-guide`, `general`, `integrations`.
- `src/renderer/index.html` / `web-index.html`: `<title>Axiom</title>` / `<title>Axiom Web</title>`, nothing else changed; `src/renderer/document-title.test.ts` guards both against an upstream sync.
- `docs/reference/orca-mapping.md`: the `mobile / cloud` row records the switch.
- Not changed, as briefed: Settings › Artifacts and Settings › Share Skills (cloud features outside the approval), the pane, sign-in buttons, i18n catalogs.
- Host: no packaged walk for this change; the title is a static document title covered by the test, and the settings gates are unit-tested against the real switch. The next packaged UI walk (M3-09 brief) re-checks both on screen.
