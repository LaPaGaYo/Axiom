# D75-HYG — Attempt 1 Worker report

Date: 2026-10-23. Worker: Codex. Branch: `axiom/attempt/D75-HYG/1`.
Starting HEAD and local `main`: `06236b80e2b6739c900110a7945ee235c745945c`.
The checkout was clean at entry. Changes remain uncommitted for the launcher's candidate snapshot. No integration, promotion, delivery, or independent verification is claimed.

## Result and scope

Implemented the D75 revision dated 2026-10-23: one shared `MOBILE_PAIRING_AVAILABLE: boolean = false` closes the specified mobile pairing entry points. The switch module matches the requested three lines exactly. Existing pairing, relay/push, IPC/RPC, persisted identifiers, i18n catalogs, bundle/artifact contracts, dependencies, and packaging are unchanged.

D32 and D33a were read with D75: the three `Orca Relay` repairs are test fixture queries only; the mobile bundle still ships in desktop and orcad templates and stays in the vendor-egress ratchet. The older architecture wording about removing mobile from the default build is superseded here by D33a and revised D75; it was not edited outside this Task's scope.

## Entry points and evidence

| Entry point                                                             | Gate                                                                                               | Evidence                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar Axiom Mobile row, context menu, badge and paired-device control | `SidebarNav.tsx`: `shouldShowMobileButton` checks the switch before the existing setting           | `SidebarNav.test.tsx`: switch off, setting explicitly true, paired device present; helper returns false, row and paired-device hide control absent. Existing on cases retained. The badge receives `showMobileButton`; the context menu and device control are inside the same conditional row. |
| Settings › Mobile navigation and search/palette                         | `settings-navigation-capability-sections.ts`: desktop AND switch                                   | `settings-navigation-capability-sections.test.ts`: real shipped switch, no mobile section, all four other setup sections remain. `useSettingsNavigationMetadata.test.ts`: getter off, no mobile section or Cmd-J mobile results; original mobile enumeration cases retained with getter on.     |
| Settings Mobile pane, including stale direct navigation                 | `settings-setup-workflow-section-renderers.tsx`: desktop AND switch                                | `settings-setup-workflow-section-renderers.test.tsx`: real shipped switch; stale active/pending/mounted mobile remains in `neededSectionIds`, but the renderer returns null.                                                                                                                    |
| Appearance › Sidebar mobile toggle                                      | `AppearanceWindowSidebarSection.tsx`: conditional `SearchableSetting`                              | `AppearancePane.test.tsx`: real shipped switch and persisted setting true; no mobile toggle, Tasks and Automations switches remain.                                                                                                                                                             |
| Appearance search catalog                                               | `appearance-sidebar-search.ts`: conditional mobile entry                                           | `appearance-search.test.ts`: real shipped switch excludes the mobile title; Tasks and Automations retain indexes 0 and 1.                                                                                                                                                                       |
| Restored Mobile view                                                    | `ui-slice-hydration-sanitizers.ts`: mobile falls back to terminal when unavailable                 | `ui-hydration-view-layout.test.ts`: switch-off startup restoration yields terminal. The original hidden-nav-button mobile restoration case is unchanged under getter-on. Original fallback comment retained, with one D75 line.                                                                 |
| View › Appearance checkbox                                              | `register-app-menu.ts`: conditional array inclusion                                                | `register-app-menu.test.ts`: no mobile item with switch off; remaining checkbox order is Status Bar, Tasks, Automations, Titlebar App Name. Original checkbox state/callback tests retained with getter-on.                                                                                     |
| `axiom serve --mobile-pairing`                                          | Shared `getServeOptionValidationError`, after all existing checks                                  | `index-serve-command.test.ts`: switch off, exact requested argv, no `serveOrcaApp` call, refusal printed, exit code 1. Existing accepted mobile launch retained with getter-on.                                                                                                                 |
| Desktop `--mobile-pairing` and `--serve-mobile-pairing`                 | Unmodified `getServeOptions` routes both aliases through the shared validator                      | Direct `node --import tsx` assertions with the real switch confirmed both aliases throw exactly `Mobile pairing is not available in this version of Axiom.`; default options still parse. Existing startup sidecar tests retained.                                                              |
| `orcad --mobile-pairing`                                                | Unmodified `parseArgs` routes through shared validator                                             | `orcad-launch-contract.test.ts`: getter-off refusal; original accepted case retained with getter-on. A direct real-switch assertion also passed.                                                                                                                                                |
| Shared serve validation / help                                          | New refusal immediately before final `return null`; help removes advertising, parser flag retained | `serve-option-validation.test.ts`: real switch rejects lone mobile pairing, compatible `mobilePairing: false` still returns null; old combination cases unchanged. Direct assertions check typo hint, retained `allowedFlags`, removed usage/note/example and orcad help flag.                  |

A zero-context diff check across the seven original affected test suites confirmed no pre-existing test body line was removed or replaced; only the necessary Vitest imports were extended. All six requested upstream suites use the specified file-level mutable getter, default on, with the one-line D75 comment and per-test restoration. Getter behavior worked in every file; no sibling mock workaround was required. The additional real-switch settings test is a new focused file because the existing navigation suite needs its on mock.

### Why the extra renderer gate was required

`settings-view-model.ts` defines `isSectionMounted` as `navigation.neededSectionIds.has(sectionId)`. `use-settings-navigation-model.ts` derives this set with `deriveNeededSectionIds`. In `settings-load-performance.ts`, the set starts from mounted sections and adds the active section (without a search query) and pending section without checking `navSectionIds`. Therefore removing a navigation section alone does not prevent its pane mounting. The mobile renderer now independently checks the switch. Its context type was narrowed to the three fields it actually reads, permitting the focused regression test without a partial-context cast.

`rg` confirmed that `sidebarEntries[2]` is read only by the now-gated mobile row; indexes 0 and 1 are Tasks and Automations, and nothing indexes past 2. Catalog consumers otherwise iterate entries. `openMobilePage` has no production caller besides the gated sidebar.

The menu's conditional item initially exceeded the 300-code-line limit. Equivalent expressions replaced three temporary constructions in the same file: the shortcut formatter's temporary binding, the Window menu temporary, and the pair of mutually exclusive app/File menu spreads. All menu items retain their order and behavior; no lint suppression or additional module was introduced. `AppearanceMenuState.showMobileButton` and menu i18n remain unchanged.

## Documentation and fixture repairs

- `MobilePage.test.tsx` differs only in the three requested `Axiom Relay` → `Orca Relay` queries. A byte comparison against HEAD with exactly that replacement passed.
- `remote-servers.mdx` now contains only the V1 exclusion sentence under the mobile heading. There are 16 fence lines, paired; the stray fence and tailnet pairing instruction are gone.
- The mobile/cloud mapping cell uses the requested replacement, including the orcad template and single-switch dormancy explanation.

## Verification environment and commands

All commands ran inside this checkout. Final tools: Node `v24.21.0`, pnpm `12.14.0`, repository-pinned Bun `1.4.3`, Vitest `5.0.5`. Commands below used the launcher's environment (`login: false`) and `npm_config_manage_package_manager_versions=false` for pnpm. The initial login-shell version probe selected Node 20 and attempted pnpm's automatic version setup; it failed immediately at `mkdir /Users/henry/Library/pnpm/.tools/pnpm/12.14.0_tmp_53438` with `EPERM`. No installation completed; subsequent commands disabled package-manager auto-setup. No install/add/remove/rebuild command, dependency move/copy/symlink, Electron launch, or out-of-checkout Node/pnpm script was used.

The requested pnpm test/typecheck wrappers run `build:packages`, whose `tsx` CLI tries to create a local IPC listener. The sandbox returns `EPERM` before the actual test/typecheck starts. The same package build succeeded without the CLI IPC wrapper:

```sh
node --conditions=orca-source --import tsx src/packages/process-host/scripts/build-dist.mjs
node config/scripts/ensure-native-runtime.mjs --runtime=node --check-only
```

The package build exited 0 with no output; its CLI emits a summary only when output files change. The native check also exited 0; no native rebuild was needed.

The three precise cache paths were checked and `rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` was run; each was already absent. The direct typecheck runs started without those caches.

| Command / check                                                                                                                                        | Result and evidence                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused red run using `env -u CODEX_THREAD_ID node config/scripts/run-vitest.mjs run --config config/vitest.config.ts` with the 12 affected test files | Expected FAIL: 14 failed, 235 passed, 1 platform skip. All 11 new closure checks failed on the original entry points, plus the three reported Relay fixture cases. `/tmp/d75-hyg-red-direct.log`.                                                                            |
| Same focused green run                                                                                                                                 | PASS: 12 files, 249 tests passed, 1 platform skip. `/tmp/d75-hyg-focused.log`. The skip is the non-macOS app-menu case on macOS.                                                                                                                                             |
| Menu and settings renderer rerun after quality corrections                                                                                             | PASS: 2 files, 46 tests passed, 1 platform skip. `/tmp/d75-hyg-corrections.log`.                                                                                                                                                                                             |
| `pnpm test` with the sidecar targets below                                                                                                             | BLOCKED before tests: `tsx` build-prerequisite IPC listener returns `EPERM`. `/tmp/d75-hyg-sidecar-wrapper.log`.                                                                                                                                                             |
| Direct repository Vitest runner with every sidecar target                                                                                              | FAIL: 477 passed / 10 failed files; 4,439 passed / 46 failed / 10 skipped tests; 45 uncaught `EPERM` listener errors. Every failing file is unchanged. See locations below. `/tmp/d75-hyg-sidecar.log`.                                                                      |
| Separate Bun lane of the same sidecar targets (`--project=bun`)                                                                                        | PASS: all 294 files, 2,257 tests passed, 1 platform skip. `/tmp/d75-hyg-sidecar-bun.log`.                                                                                                                                                                                    |
| `pnpm tc:node`, `pnpm tc:cli`, `pnpm tc:web`                                                                                                           | BLOCKED at the same `tsx` prerequisite. `/tmp/d75-hyg-tc-{node,cli,web}-wrapper.log`.                                                                                                                                                                                        |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json`                                                       | PASS, 17,845 files. `/tmp/d75-hyg-tc-node-final.log`.                                                                                                                                                                                                                        |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.tc.cli.json`                                                     | PASS, 3,173 files. `/tmp/d75-hyg-tc-cli.log`.                                                                                                                                                                                                                                |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.tc.web.json`                                                     | PASS, 15,677 files. `/tmp/d75-hyg-tc-web-final.log`. Initial run caught the test's partial-context cast; the final run passes after the typed context correction.                                                                                                            |
| `pnpm run check:code-quality:changed`                                                                                                                  | PASS: zero new findings in all seven categories across 24 changed source files. `/tmp/d75-hyg-quality-final.log`. Initial cast finding was fixed, not suppressed.                                                                                                            |
| `pnpm run check:vendor-egress-ratchet`                                                                                                                 | PASS: 455 grandfathered pairs; baseline unchanged. `/tmp/d75-hyg-egress.log`.                                                                                                                                                                                                |
| `pnpm lint`                                                                                                                                            | PASS through all stages, including RPC catalog, localization, max-lines, and ratchets. Five existing docs-site warnings. `/tmp/d75-hyg-lint-final.log`. Initial menu max-lines finding was fixed without changing config.                                                    |
| `pnpm run lint:design-system`                                                                                                                          | FAIL: 4,372 renderer-wide findings. No new changed-line design-system findings in the required changed-code gate. Existing examples include `RepositoryHooksYamlStatus.tsx:118`, `:160`, `:161`; that file is outside scope and unchanged. `/tmp/d75-hyg-design-system.log`. |
| `node_modules/.bin/oxfmt --write <changed TS/TSX files>` and subsequent `--check`                                                                      | PASS on 23 files. Only changed source/test files formatted; MobilePage's fixture file was excluded to preserve its exact three-line diff.                                                                                                                                    |
| Direct real-switch serve and help assertions (`node --import tsx`)                                                                                     | PASS for both desktop aliases, orcad, default valid options, typo hint, allowed flag, and removed help advertising.                                                                                                                                                          |
| `git diff --check`                                                                                                                                     | PASS.                                                                                                                                                                                                                                                                        |
| Protected-path diff against `main` and sidecar allowlist (including new files)                                                                         | PASS: all 26 code/test/docs paths are allowed; report is the only additional deliverable.                                                                                                                                                                                    |

Sidecar targets used verbatim from `.axiom-work/briefs/D75-HYG.verify`:

```sh
pnpm test src/renderer/src/components/sidebar/SidebarNav src/renderer/src/components/settings src/renderer/src/hooks/useSettingsNavigationMetadata src/renderer/src/hooks/settings-navigation src/renderer/src/components/WorktreeJumpPalette src/renderer/src/store/slices/ui src/renderer/src/components/mobile src/main/menu src/shared/serve-option-validation src/cli src/main/orcad/orcad-launch-contract src/main/orcad/orcad-command-arguments src/main/startup/serve src/main/runtime/runtime-pairing-desktop-control-grant
```

Direct fallback replaces `pnpm test` with `env -u CODEX_THREAD_ID node config/scripts/run-vitest.mjs run --config config/vitest.config.ts`, retaining the complete target list. Removing only `CODEX_THREAD_ID` lets upstream CLI tests exercise their ordinary CLI error-advice context, as in the prior UPSTREAM-3 verification. No repository configuration changes accompany it.

Protected-path check:

```sh
git diff --quiet main -- mobile config package.json pnpm-lock.yaml pnpm-workspace.yaml src/main/runtime src/main/ipc src/main/daemon src/shared/orcad-artifacts.ts src/main/startup/serve-mode-argv.ts src/main/startup/serve-options.ts src/cli/handlers/core.ts src/renderer/src/components/mobile/MobilePage.tsx src/renderer/src/components/settings/MobileSettingsPane.tsx src/renderer/src/components/settings/MobilePane.tsx docs/decisions tests
```

## Remaining verification and risks

The broad sidecar run completed with 46 failures in the 10 unchanged files below. All 45 serialized uncaught errors are `EPERM` on `listen`; there are no other serialized error codes. A direct `node:net` socket probe also reports `EPERM (listen)`. Test/hook timeouts are the consequence of listener setup never completing; the child-process listener fixture accounts for a failure without an additional parent-side uncaught error. These results are failures, not passes; host reruns are required. No test was skipped or changed to hide this environment limitation.

| Unchanged file and listener location                                         | Failed cases | Reason                                                 |
| ---------------------------------------------------------------------------- | -----------: | ------------------------------------------------------ |
| `src/cli/runtime-client.test.ts:109` (and subsequent listener fixtures)      |           14 | Local runtime socket listener denied.                  |
| `src/cli/agent-launch-process.test.ts:60`                                    |            1 | Real CLI fixture listener denied.                      |
| `src/cli/runtime/runtime-source-fence.test.ts:86`                            |            6 | Runtime-source fixture listener denied.                |
| `src/cli/runtime/status.test.ts:65`                                          |            1 | Legacy transport fixture listener denied.              |
| `src/cli/runtime/status-caller.test.ts:50`                                   |            6 | `beforeEach` listener denied; hook timeouts.           |
| `src/cli/runtime/client-recovery.test.ts:109` (also 172, 212, 265, 305, 346) |            6 | Recovery fixture listeners denied.                     |
| `src/cli/runtime/transport.test.ts:89`, `:121`                               |            2 | Keepalive and early-close fixture listeners denied.    |
| `src/cli/runtime/runtime-listener-probe.test.ts:62`, `:81`                   |            2 | In-process and child-process listener fixtures denied. |
| `src/cli/runtime/websocket-transport.test.ts:388`                            |            7 | Loopback HTTP/WebSocket listener denied.               |
| `src/cli/handlers/orchestration/mutation-request.test.ts:223`                |            1 | Restart/retry fixture listener denied.                 |

`git diff --quiet` on these ten files passed. There is no justified product edit for the sandbox failure, so their tests remain failing and their code remains unchanged. The independent host verifier must rerun the complete sidecar command and the three pnpm typecheck wrappers. All 294 Bun-lane sidecar files passed separately (2,257 tests plus one platform skip).

Electron UI/host verification is reserved for the independent verifier, per the Task. This is an entry-point dormancy change, not removal of the underlying mobile APIs or existing pairing runtime. No migration or device revocation was introduced. The guarded appearance copy still says “It remains available from Toolbox”; its search keywords still include `toolbox`. Both are deliberately retained as dormant copy. The existing Account description still mentions Axiom Mobile and remains outside the requested copy changes.

No new architectural decision, scope expansion, or unresolved product question is required. Implementation and the requested local evidence/report are ready for candidate capture. The complete acceptance gate remains pending the host reruns above; the branch must not be marked independently VERIFIED or INTEGRATED from this Worker report alone.

## Files changed

- `docs/reference/orca-mapping.md`
- `docs/site/content/docs/remote-servers.mdx`
- `src/cli/index-serve-command.test.ts`
- `src/cli/root-help-text-secondary.ts`
- `src/cli/specs/serve.ts`
- `src/main/menu/register-app-menu.test.ts`
- `src/main/menu/register-app-menu.ts`
- `src/main/orcad/orcad-command-arguments.ts`
- `src/main/orcad/orcad-launch-contract.test.ts`
- `src/renderer/src/components/mobile/MobilePage.test.tsx`
- `src/renderer/src/components/settings/AppearancePane.test.tsx`
- `src/renderer/src/components/settings/AppearanceWindowSidebarSection.tsx`
- `src/renderer/src/components/settings/appearance-search.test.ts`
- `src/renderer/src/components/settings/appearance-sidebar-search.ts`
- `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.test.tsx`
- `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.tsx`
- `src/renderer/src/components/sidebar/SidebarNav.test.tsx`
- `src/renderer/src/components/sidebar/SidebarNav.tsx`
- `src/renderer/src/hooks/settings-navigation-capability-sections.test.ts`
- `src/renderer/src/hooks/settings-navigation-capability-sections.ts`
- `src/renderer/src/hooks/useSettingsNavigationMetadata.test.ts`
- `src/renderer/src/store/slices/ui-hydration-view-layout.test.ts`
- `src/renderer/src/store/slices/ui/ui-slice-hydration-sanitizers.ts`
- `src/shared/mobile-pairing-availability.ts`
- `src/shared/serve-option-validation.test.ts`
- `src/shared/serve-option-validation.ts`
- `.axiom-work/reports/D75-HYG-1.md` (this report)
