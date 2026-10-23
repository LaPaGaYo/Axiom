# Task D75-HYG — V1 is desktop-only: close every mobile-pairing entry point behind one switch (D75, revised 2026-10-23)

You are a Worker on the Axiom project (a product fork of Orca). Read `AGENTS.md`, `docs/decisions/DECISION_LOG.md` D75 with its 2026-10-23 revision, D33a and D32 (copy and persisted-bytes rules), then the files named below. This is a small, deterministic product change at the user-facing edges: renderer entry points, one main-process menu item, the serve option validation and help text, three test strings and two docs pages. No RPC, schema, packaging, build, orcad-artifact, pairing-runtime or dependency change.

## Why

D75: Axiom V1 ships the desktop app only; the mobile companion (mobile web bundle, pairing, relay / push) stays in the tree, dormant, not deleted. The 2026-10-23 revision (Henry: "只关入口") narrows this hygiene task to the entry points: the bundle also ships inside the orcad server template, whose artifact contract requires it, so packaging and the vendor-egress ratchet stay as they are (deferred to the next baseline reset or DEF-26). With no entry point no phone can pair, and nothing reaches the bundle.

Today the entry points are live on main (`1f5dc70c1b`):

- the sidebar shows **Axiom Mobile** by default (`shouldShowMobileButton` in `src/renderer/src/components/sidebar/SidebarNav.tsx` returns `settings?.showMobileButton !== false`) and opens `MobilePage`, which mints pairing QR codes;
- **Settings › Mobile** (`buildSetupSettingsSections` in `src/renderer/src/hooks/settings-navigation-capability-sections.ts`, section id `mobile`) renders `MobileSettingsPane` → `MobilePane`: pairing QR, paired devices, and an App Store link to the Orca iOS app;
- **View › Appearance › Show Axiom Mobile Button** (`src/main/menu/register-app-menu.ts`) and **Settings › Appearance › Sidebar › Show Axiom Mobile Button** (`AppearanceWindowSidebarSection.tsx`, search entry in `appearance-sidebar-search.ts` `getSidebarEntries()`);
- a persisted `activeView: 'mobile'` is restored at startup (`sanitizeHydratedActiveView`, `src/renderer/src/store/slices/ui/ui-slice-hydration-sanitizers.ts`), so a user who once opened the page lands on it again;
- `axiom serve --mobile-pairing` (CLI, `src/cli/handlers/core.ts`), the desktop app's serve mode (`src/main/startup/serve-options.ts`, argv `--mobile-pairing` / `--serve-mobile-pairing`) and `orcad --mobile-pairing` (`src/main/orcad/orcad-command-arguments.ts`) mint a mobile-scoped pairing offer; all three validate through `getServeOptionValidationError` (`src/shared/serve-option-validation.ts`).

## Objective

1. **The switch.** New module `src/shared/mobile-pairing-availability.ts`, exactly:

   ```ts
   // D75 (revised 2026-10-23): Axiom V1 is desktop-only. The mobile companion stays in the tree, dormant,
   // and every mobile-pairing entry point checks this switch. Turning it on is a DEF-26 decision.
   export const MOBILE_PAIRING_AVAILABLE: boolean = false
   ```

   The `: boolean` annotation keeps call sites typed `boolean` rather than the literal `false`. Import it with relative paths like the neighbouring imports; no alias, no re-export, no environment variable, no setting.

2. **Renderer entry points — gate, do not delete.**
   a. `shouldShowMobileButton` (SidebarNav.tsx) returns `MOBILE_PAIRING_AVAILABLE && settings?.showMobileButton !== false`. The sidebar row, its context menu, the onboarding badge (`useMobileSidebarOnboardingBadge(showMobileButton)`) and the paired-device control all hang off it.
   b. `buildSetupSettingsSections` lists the `mobile` section only when `showDesktopOnlySettings && MOBILE_PAIRING_AVAILABLE`, so the nav entry, its search entries and the pane go together. Read `settings-view-model.ts` (`isSectionMounted` → `navigation.neededSectionIds`) and confirm that `settings-setup-workflow-section-renderers.tsx` cannot mount `MobileSettingsPane` for a section that is not listed; gate that renderer too only if it can, and say which in the report.
   c. `AppearanceWindowSidebarSection.tsx` renders the "Show Axiom Mobile Button" `SearchableSetting` only while the switch is on, and `getSidebarEntries()` (`appearance-sidebar-search.ts`) includes that entry only while it is on. The component reads `sidebarEntries[0]`, `[1]` and `[2]`; `[2]` is used only by the mobile row — confirm nothing else indexes past it.
   d. `sanitizeHydratedActiveView` returns `'terminal'` for `'mobile'` while the switch is off (the same fallback it uses for a view the build does not have; keep the existing comment, add one line naming D75).
   e. Leave untouched: `openMobilePage` / `closeMobilePage`, `MobilePage*`, `MobileSettingsPane`, `MobilePane`, `MobilePairing*`, the mobile IPC handlers, every `mobile-pairing-*` / relay / push module and the i18n catalogs. With the gates above nothing reaches them.

3. **Main-process menu.** `register-app-menu.ts` omits the "Show Axiom Mobile Button" checkbox while the switch is off; the other appearance checkboxes and their order stay as they are. `AppearanceMenuState.showMobileButton` and `src/main/startup/main-process-i18n-menu.ts` stay unchanged.

4. **Serve entry points — one guard where every path routes through.**
   - `getServeOptionValidationError`: after all existing checks (their messages are pinned by upstream tests and stay byte-identical) and before the final `return null`, return `'Mobile pairing is not available in this version of Axiom.'` when `options.mobilePairing && !MOBILE_PAIRING_AVAILABLE`.
   - Help text stops advertising the flag: drop `[--mobile-pairing]` from the `axiom serve` usage strings in `src/cli/specs/serve.ts` and `src/cli/root-help-text-secondary.ts`; drop the `Use --mobile-pairing …` note and the `axiom serve --pairing-address 100.64.1.20 --mobile-pairing` example in `serve.ts`; in the orcad help text (`orcad-command-arguments.ts`) drop the `--mobile-pairing` line and the ` or --mobile-pairing` clause of `--grant-desktop-control` (keep the column alignment of its neighbours). Keep `'mobile-pairing'` in the serve spec's `allowedFlags`: the typo hint (`--mobile-pairng` → "Did you mean --mobile-pairing?") and the clear refusal depend on it.
   - Do not touch the argv handling in `src/cli/handlers/core.ts`, `src/main/startup/serve-mode-argv.ts`, `src/main/startup/serve-options.ts` or the orcad `parseArgs` loop.

5. **Tests.** Keep upstream test bodies that exercise the dormant paths byte-identical where you can, and prove the shipped state separately.
   - In each upstream test file whose cases need the mobile path open (at least `src/renderer/src/components/sidebar/SidebarNav.test.tsx`, `src/main/menu/register-app-menu.test.ts`, `src/renderer/src/store/slices/ui-hydration-view-layout.test.ts`, `src/cli/index-serve-command.test.ts`, `src/main/orcad/orcad-launch-contract.test.ts`, and any settings / navigation / palette test that enumerates the `mobile` section), mock the switch at file level with a mutable getter, default on, under a one-line `// D75: these cases exercise the dormant mobile companion.` comment:

     ```ts
     const mobilePairing = vi.hoisted(() => ({ available: true }))
     vi.mock('<relative path>/shared/mobile-pairing-availability', () => ({
       get MOBILE_PAIRING_AVAILABLE() {
         return mobilePairing.available
       }
     }))
     ```

     Then add in the same file one case that sets `mobilePairing.available = false` (restore it in a `beforeEach` or `afterEach`) and asserts the entry point is closed: SidebarNav — no "Axiom Mobile" row and `shouldShowMobileButton({ showMobileButton: true })` is `false`; menu — no "Show Axiom Mobile Button" item while the other appearance items remain; hydration — a persisted `'mobile'` view restores as `'terminal'`; CLI — `axiom serve --pairing-address 100.64.1.20 --mobile-pairing --json` does not call `serveOrcaApp`, prints the refusal and sets exit code 1 (copy the shape of the neighbouring "rejects …" cases); orcad — `parseArgs(['--mobile-pairing'])` throws the refusal. If the getter mock does not take effect in a file, put that file's off case in a sibling `*.mobile-dormant.test.ts(x)` instead and say so in the report.
   - `src/shared/serve-option-validation.test.ts` (real switch, no mock): a lone `mobilePairing: true` returns the refusal; `mobilePairing: false` with otherwise valid options returns `null`; the existing combination cases stay unchanged.
   - Real switch for the settings sections and the appearance catalog: `buildSetupSettingsSections` for a desktop (non-web) client has no section with id `mobile`, and `getSidebarEntries()` has no "Show Axiom Mobile Button" entry — in an existing test file for each module that does not mock the switch, otherwise in a new focused test file beside the module.
   - **The three failing `src/renderer/src/components/mobile/MobilePage.test.tsx` cases** (`does not mint on address change while signed out with Anywhere selected`, `does not remint when switching from Local to Anywhere while signed out`, `mints a Relay QR when signing in with Anywhere selected`): they click `screen.getByRole('button', { name: 'Axiom Relay' })`, but the test's own `MobilePageContent` mock renders a button labelled `Orca Relay` (line 102); upstream `41661e3312` queries `'Orca Relay'`. It is a rebrand slip from the UPSTREAM-3 merge in test-only fixture text, not product copy (D32). Restore the three queries (lines 277, 289, 308) to `'Orca Relay'` and change nothing else in that file. `MobilePage` stays tested as it is: unreachable, not changed.

6. **Docs.**
   - `docs/site/content/docs/remote-servers.mdx`, section "Mobile from a headless server": the merge left a stray code fence and the upstream sentence "Keep the phone on the same tailnet, open Axiom Mobile, …" after "The mobile companion is not part of Axiom V1."; the stray fence opens a code block that swallows the rest of the page (the file has 17 fence lines today). Keep only that one sentence under the heading.
   - `docs/reference/orca-mapping.md`, the table row that begins `| mobile / cloud |`: in its last cell replace `保留 mobile 验证 CI、依赖安装、缓存、web bundle 构建与桌面配对 UI` with `保留 mobile 验证 CI、依赖安装、缓存与 web bundle 构建（bundle 也随 orcad 模板交付）；桌面配对入口在 V1 休眠（D75 修订）：侧边栏、View 菜单、外观设置、设置 › Mobile、恢复的 Mobile 视图与 `--mobile-pairing` 统一看 `src/shared/mobile-pairing-availability.ts` 的 `MOBILE_PAIRING_AVAILABLE`（false），配对代码不删`.
   - Do not edit `docs/decisions/*`: the planner has recorded the D75 revision.

## Facts you can rely on (verified against main `1f5dc70c1b`)

- `SidebarNav.tsx`: `shouldShowMobileButton` at lines 19–23; the selector `const showMobileButton = useAppStore((s) => shouldShowMobileButton(s.settings))` at line 66; `useMobileSidebarOnboardingBadge(showMobileButton)` at line 73; the row at `{showMobileButton ? (` around line 229. `openMobilePage` has no other caller in `src/`.
- `settings-navigation-capability-sections.ts`: `buildSetupSettingsSections` at line 125, `const showDesktopOnlySettings = !isWebClient` at line 129, the `mobile` entry inside `...(showDesktopOnlySettings ? [ … ] : [])` at lines 201–215. The `mobile-emulator` section in `settings-navigation-workflow-sections.ts` is the browser device emulator, not pairing: leave it.
- `AppearanceWindowSidebarSection.tsx`: `const sidebarEntries = getSidebarEntries()` at line 80; the mobile row at lines 289–313. `appearance-sidebar-search.ts`: `getSidebarEntries` at line 126; the mobile entry is its third element.
- `ui-slice-hydration-sanitizers.ts`: `sanitizeHydratedActiveView` at lines 172–178. Upstream pins the opposite in `ui-hydration-view-layout.test.ts` (`restores a default-on view (mobile) even when its nav button is hidden`, lines 189–198) — keep that case under the getter mock.
- `register-app-menu.ts`: the mobile checkbox at lines 269–274; `register-app-menu.test.ts` reads it at lines 556–615.
- `serve-option-validation.ts`: `getServeOptionValidationError` at lines 11–28 (pairing-flag combinations first, then recipe JSON). The combination messages are pinned by `serve-options.test.ts`, `runtime-pairing-desktop-control-grant.test.ts`, `index-serve-command.test.ts` and `orcad-launch-contract.test.ts` and stay as they are. Upstream cases that expect a lone `--mobile-pairing` to be accepted: `index-serve-command.test.ts` "starts a foreground headless server with mobile pairing enabled" (lines 109–127) and `orcad-launch-contract.test.ts` line 76.
- `src/cli/specs/serve.ts`: usage line 9, `allowedFlags` entry line 14, note line 27, example line 41; `src/cli/root-help-text-secondary.ts` line 39; orcad help `orcad-command-arguments.ts` lines 22–24. The CLI parser refuses flags missing from `allowedFlags` (`src/cli/args.ts`, "Unknown flag …"), which is why the flag stays listed.
- vitest's SSR transform reads named imports through the module namespace at use time, so a getter in a `vi.mock` factory is evaluated per access.
- `pnpm tc:*` run clean on the launcher (D47): `rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` (plain `rm`, exact files) before typechecking. You cannot start Electron; the verifier runs the host checks against your candidate.

## Deliverables

- `src/shared/mobile-pairing-availability.ts` (new); `src/shared/serve-option-validation.ts` + `.test.ts`.
- `src/renderer/src/components/sidebar/SidebarNav.tsx`, `src/renderer/src/hooks/settings-navigation-capability-sections.ts`, `src/renderer/src/components/settings/AppearanceWindowSidebarSection.tsx`, `src/renderer/src/components/settings/appearance-sidebar-search.ts`, `src/renderer/src/store/slices/ui/ui-slice-hydration-sanitizers.ts` (and `settings-setup-workflow-section-renderers.tsx` only if 2b requires it).
- `src/main/menu/register-app-menu.ts`; `src/cli/specs/serve.ts`, `src/cli/root-help-text-secondary.ts`; `src/main/orcad/orcad-command-arguments.ts` (help text only).
- Tests beside those modules as described in item 5, and `src/renderer/src/components/mobile/MobilePage.test.tsx` (three queries).
- `docs/site/content/docs/remote-servers.mdx`, `docs/reference/orca-mapping.md`.
- `.axiom-work/reports/D75-HYG-1.md`: per entry point, the gate and the test that proves it closed; whether 2b needed a renderer gate; the files changed; the commands run with results (`pnpm test` on the sidecar targets, clean-cache `tc:node` / `tc:cli` / `tc:web`, `pnpm run check:code-quality:changed`, `pnpm run check:vendor-egress-ratchet`, `pnpm lint`); anything left (for example dormant copy that still mentions "Toolbox").

## Acceptance criteria

- Sidecar unit targets green; clean-cache typechecks, changed-code quality, the vendor-egress ratchet (baseline file unchanged) and full lint green.
- Changed paths stay inside the deliverables; `git diff --quiet main -- mobile config package.json pnpm-lock.yaml pnpm-workspace.yaml src/main/runtime src/main/ipc src/main/daemon src/shared/orcad-artifacts.ts src/main/startup/serve-mode-argv.ts src/main/startup/serve-options.ts src/cli/handlers/core.ts src/renderer/src/components/mobile/MobilePage.tsx src/renderer/src/components/settings/MobileSettingsPane.tsx src/renderer/src/components/settings/MobilePane.tsx docs/decisions tests` holds.
- With the shipped switch (`false`): no sidebar row, no Settings › Mobile, no appearance toggle or search entry, no menu checkbox, no restored Mobile view, and every serve path refuses `--mobile-pairing` with the one message; with the switch on (tests only) the upstream behaviour is unchanged.

## Rules

- Stay inside the files above (plus tests beside them). If an edit outside the list is necessary, stop **that one edit**, keep everything else, leave the test that needs it failing, and write the exact file, line and reason in the report.
- Never run `pnpm install/add/remove/rebuild` (interrupt any automatic install and report it); never symlink, copy or move `node_modules`; never run pnpm or node scripts outside the checkout; never edit `package.json`, lockfiles, `pnpm-workspace.yaml`, `config/patches/**` or anything under `mobile/`; never format files you did not change; never `git reset --hard` / `git checkout -- .` / `git clean`; never edit `.axiom-work/jev/known-environmental.txt`, `.axiom-work/verifications/` or `config/vendor-egress-baseline.txt`.

## Submission

Leave the branch uncommitted; write `.axiom-work/reports/D75-HYG-1.md` as above.
