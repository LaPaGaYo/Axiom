# Task UI-HYG — hide the dead Settings › Axiom Account section and title the window Axiom (D33 / D32, Henry 2026-10-24)

You are a Worker on the Axiom project (a product fork of Orca). Read `AGENTS.md`, `docs/decisions/DECISION_LOG.md` D32 (copy and persisted-bytes rules) and D33 with its 2026-10-24 revision, then the files named below. This is a small, deterministic renderer change: one new switch module, two renderer gates, one button guard, two HTML `<title>` strings, tests and one docs row. No RPC, schema, main-process, CLI, i18n catalog, packaging, build or dependency change.

## Why

Axiom V1 has no cloud account: D33 deleted the upstream `cloud/` tree, and the product egress policy ships no cloud sign-in defaults (`PRODUCT_EGRESS_POLICY.cloudAuth` is `null`, `src/shared/product-egress-policy.ts`). The 2026-10-24 UI walk on the new base (packaged build of main, isolated profile) found two leftovers (Henry: "同意整节隐藏,并且窗口标题改成Axiom"):

- **Settings › Axiom Account is a dead entry.** It is the first section of the Set Up group on desktop; its pane says "Axiom sign-in is unavailable in this build." while the section description still advertises "Share work instantly and reach your desktop from Axiom Mobile wherever you are.", and the settings search for "mobile", "account", "login" or "cloud" lands on it. The whole section goes, nav entry, search entries and pane together.
- **The native window title is "Orca".** The main window sets no title of its own, so the renderer document title is the window title (Window menu, Mission Control, the accessibility tree). `src/renderer/index.html` still has `<title>Orca</title>` and `src/renderer/web-index.html` `<title>Orca Web</title>`, a D32 copy leftover from M0.

## Objective

1. **The switch.** New module `src/shared/cloud-account-availability.ts`, exactly:

   ```ts
   import { PRODUCT_EGRESS_POLICY } from './product-egress-policy'

   // D33 (revised 2026-10-24): Axiom V1 has no cloud account and this build ships no cloud sign-in defaults.
   // Settings › Axiom Account and the links into it check this switch, so the app never offers a sign-in it cannot honour.
   export const CLOUD_ACCOUNT_AVAILABLE: boolean = PRODUCT_EGRESS_POLICY.cloudAuth !== null
   ```

   It is derived, not a literal: a future build with packaged cloud defaults shows the section again without another edit. The `: boolean` annotation keeps call sites typed `boolean`. Import it with relative paths like the neighbouring imports; no alias, no re-export, no environment variable, no setting. Do not edit `product-egress-policy.ts`.

2. **Renderer gates — gate, do not delete.**
   a. `buildSetupSettingsSections` (`src/renderer/src/hooks/settings-navigation-capability-sections.ts`) lists the `orca-account` section only when `showDesktopOnlySettings && CLOUD_ACCOUNT_AVAILABLE`. The section carries its own search entries (`getOrcaAccountSettingsSearchEntries()`), so the nav entry and the search hits go together.
   b. `renderOrcaAccountSettingsSection` (`src/renderer/src/components/settings/settings-setup-workflow-section-renderers.tsx`) returns `null` unless `model.showDesktopOnlySettings && CLOUD_ACCOUNT_AVAILABLE`. This gate is required, not optional: `isSectionMounted` reads `navigation.neededSectionIds`, which also contains the active and the pending target section (`deriveNeededSectionIds` in `settings-load-performance.ts`), so a pending `orca-account` target, which `ArtifactsPage` sets, would otherwise mount the pane with no nav entry. D75-HYG gated `renderMobileSettingsSection` in the same file for the same reason; narrow this renderer's parameter type to the same three `Pick`s it uses so the test can pass a minimal context, as `renderMobileSettingsSection` does.
   c. `ArtifactsPageAuthState` (`src/renderer/src/components/artifacts/ArtifactsPageStates.tsx`): in the unconfigured branch, keep the heading and the copy, and render the "Open account settings" button only while the switch is on. Leave `ArtifactsPage.tsx` (its `openAccountSettings` and the prop) unchanged.
   d. Leave untouched: `OrcaAccountSettingsPane.tsx`, `orca-account-settings-search.ts`, the `'orca-account'` member of `settings-navigation-types.ts`, `OrcaSignInProgress.tsx` and every `OrcaSignInButton` call site, the sidebar account switcher, the Settings › Artifacts and Settings › Share Skills sections, `src/main/**`, `src/cli/**` and the i18n catalogs.

3. **Window title.** `src/renderer/index.html`: `<title>Orca</title>` → `<title>Axiom</title>`. `src/renderer/web-index.html`: `<title>Orca Web</title>` → `<title>Axiom Web</title>`. Change nothing else in either file (the CSP meta and its comment stay byte-identical). The mobile web bundle's title in `config/scripts/build-mobile-web-app-bundle.mjs` stays (dormant companion, D75; `config/` is out of scope).

4. **Tests.** Keep upstream test bodies that exercise the account section byte-identical where you can, and prove the shipped state separately.
   - `src/renderer/src/hooks/useSettingsNavigationMetadata.test.ts` already mocks the D75 switch with a getter. Add a second getter mock beside it for `../../../shared/cloud-account-availability` (`CLOUD_ACCOUNT_AVAILABLE`, default on), under a one-line `// UI-HYG: these cases exercise the dormant cloud account section.` comment, and reset it to on in the existing `beforeEach`. The two upstream cases that name `orca-account` (`puts AI capability panes at the top on desktop`, `places the Orca account in Set Up on desktop only`) stay unchanged. Add one case that sets the switch off and asserts the desktop ids contain no `orca-account` while `setup-guide`, `general` and `integrations` remain in that order.
   - `src/renderer/src/hooks/settings-navigation-capability-sections.test.ts` (added by D75-HYG; real switches, no mock): the shipped desktop Set Up sections become `['setup-guide', 'general', 'integrations']`; assert there is no `orca-account` section and update the `describe` title to name both switches.
   - `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.test.tsx` (real switches): add a case beside the Mobile one: with stale navigation that needs `orca-account` (active and pending), `renderOrcaAccountSettingsSection` returns `null`.
   - `src/renderer/src/components/artifacts/ArtifactsPage.test.tsx`: with `authStatus` unconfigured (`configured: false`, not signed in) and the real switch, the page shows the unconfigured copy and no "Open account settings" button. If you add a switch-on case, mock the switch with a getter as above and assert the button calls `openSettingsTarget({ pane: 'orca-account', repoId: null })`.
   - New `src/shared/cloud-account-availability.test.ts`: `CLOUD_ACCOUNT_AVAILABLE` equals `PRODUCT_EGRESS_POLICY.cloudAuth !== null` and is `false` in this build.
   - New `src/renderer/document-title.test.ts` (default node environment): read `src/renderer/index.html` and `src/renderer/web-index.html` with `node:fs` relative to the test file (`new URL('./index.html', import.meta.url)`), and assert the titles are exactly `Axiom` and `Axiom Web`. It guards against an upstream sync putting "Orca" back.

5. **Docs.** `docs/reference/orca-mapping.md`, the table row that begins `| mobile / cloud |`: in its last cell, right after `配对代码不删`, append `；设置 › Axiom Account 在 V1 隐藏（D33 修订，2026-10-24）：导航、搜索与面板统一看 `src/shared/cloud-account-availability.ts` 的 `CLOUD_ACCOUNT_AVAILABLE`（由 `PRODUCT_EGRESS_POLICY.cloudAuth` 为 null 推出），账号代码不删`. Do not edit `docs/decisions/*`: the planner records the revision.

## Facts you can rely on (verified against main `40b2bf0894`, which M3-02 left unchanged in these files; re-check line numbers on your base)

- `settings-navigation-capability-sections.ts`: `buildSetupSettingsSections` at line 126, `const showDesktopOnlySettings = !isWebClient` at line 130, the `orca-account` entry inside `...(showDesktopOnlySettings ? [ … ] : [])` at lines 132–146; the D75 import of `MOBILE_PAIRING_AVAILABLE` at line 27 and its gate at line 202 show the pattern.
- `settings-setup-workflow-section-renderers.tsx`: `renderOrcaAccountSettingsSection` at lines 15–31 (full `SettingsRenderContext` parameter today); `renderMobileSettingsSection` at line 101 already takes the three `Pick`s. `settings-page-renderer.tsx` line 138 passes the full context, which still satisfies the narrowed type.
- `ArtifactsPageStates.tsx`: `ArtifactsPageAuthState` at line 25; `configured ? (` at line 61; the unconfigured copy at line 77 and the button at line 81. `ArtifactsPage.tsx` defines `openAccountSettings` at line 36 and passes it at line 195; it is the only caller in `src/` that targets `orca-account`.
- No test reads either HTML `<title>`; the main window sets no `title` option and the browser-popup `page-title-updated` handlers are not the main window's.
- Every `OrcaSignInButton` call site is already hidden or disabled while cloud sign-in is unconfigured: `ArtifactPublishButton.tsx` disables it (`authStatus?.configured !== true`); `ArtifactsPageStates.tsx`, `ArtifactsSettingsPane.tsx` and `DevToolsPane.tsx` render it only when configured; `UnexpectedSignoutCard.tsx` needs a prior session.
- The in-app titlebar label already reads "Axiom" (`TitlebarLeftControls.tsx`, `translate('auto.App.5096cbbc86', 'Axiom')`).
- vitest's SSR transform reads named imports through the module namespace at use time, so a getter in a `vi.mock` factory is evaluated per access (the D75 mocks rely on it).
- `pnpm tc:*` run clean on the launcher (D47): `rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` (plain `rm`, exact files) before typechecking. You cannot start Electron; the verifier checks the packaged app on the host.

## Deliverables

- `src/shared/cloud-account-availability.ts` (new) + `.test.ts`.
- `src/renderer/src/hooks/settings-navigation-capability-sections.ts`, `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.tsx`, `src/renderer/src/components/artifacts/ArtifactsPageStates.tsx`.
- `src/renderer/index.html`, `src/renderer/web-index.html`, `src/renderer/document-title.test.ts` (new).
- Tests named in item 4.
- `docs/reference/orca-mapping.md`.
- `.axiom-work/reports/UI-HYG-1.md`: per gate, the test that proves it; the files changed; the commands run with results (`pnpm test` on the sidecar targets, clean-cache `tc:node` / `tc:cli` / `tc:web`, `pnpm run check:code-quality:changed`, `pnpm run check:vendor-egress-ratchet`, `pnpm lint`); anything left.

## Acceptance criteria

- Sidecar unit targets green; clean-cache typechecks, changed-code quality, the vendor-egress ratchet (baseline file unchanged) and full lint green.
- Changed paths stay inside the deliverables; `git diff --quiet main -- src/shared/product-egress-policy.ts src/renderer/src/components/settings/OrcaAccountSettingsPane.tsx src/renderer/src/components/settings/orca-account-settings-search.ts src/renderer/src/lib/settings-navigation-types.ts src/renderer/src/components/artifacts/ArtifactsPage.tsx src/renderer/src/components/OrcaSignInProgress.tsx src/renderer/src/i18n src/main src/cli mobile config package.json pnpm-lock.yaml pnpm-workspace.yaml docs/decisions tests` holds.
- With the shipped switch (`false`): no Axiom Account nav entry, no account search hits, no account pane even for a stale active or pending target, no "Open account settings" button; with the switch on (tests only) the upstream behaviour is unchanged. The window title is "Axiom" (desktop) and "Axiom Web" (web client).

## Rules

- Stay inside the files above (plus tests beside them). If an edit outside the list is necessary, stop **that one edit**, keep everything else, leave the test that needs it failing, and write the exact file, line and reason in the report.
- Never run `pnpm install/add/remove/rebuild` (interrupt any automatic install and report it); never symlink, copy or move `node_modules`; never run pnpm or node scripts outside the checkout; never edit `package.json`, lockfiles, `pnpm-workspace.yaml`, `config/patches/**` or anything under `mobile/`; never format files you did not change; never `git reset --hard` / `git checkout -- .` / `git clean`; never edit `.axiom-work/jev/known-environmental.txt`, `.axiom-work/verifications/` or `config/vendor-egress-baseline.txt`.

## Submission

Leave the branch uncommitted; write `.axiom-work/reports/UI-HYG-1.md` as above.
