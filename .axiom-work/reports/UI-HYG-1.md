# UI-HYG — Attempt 1 implementation report

Date: 2026-10-24. Worker: Codex. Task: UI-HYG. Attempt sequence: 1.
Branch: `axiom/attempt/UI-HYG/1`. Starting HEAD and `main`:
`61226457773c520c54f97f2928c23008e6c4ea1c`. The starting worktree was clean.

Delivery state: implementation and worker checks are recorded below; changes are
**uncommitted**, as requested. No Candidate was created, no authoritative Task
state was changed, and no integration or independent acceptance is claimed.

## Scope and implementation

The UI-HYG brief and ACCEPTED D32 / D33 (including the 2026-10-24 revision)
provide the problem, approved solution, scope, and acceptance criteria. The work
used the existing D75 availability-gate pattern. No new product or architecture
decision was needed. Mission / PlanRevision identifiers, dispatch capability,
retry limit, and numeric budget were not supplied in this brief; none were
invented or changed.

- Added the exact requested `CLOUD_ACCOUNT_AVAILABLE: boolean` module, derived
  from `PRODUCT_EGRESS_POLICY.cloudAuth !== null`.
- Gated the account navigation section together with its search entries, and
  independently gated its renderer against stale active / pending navigation.
  The renderer context now uses the same three `Pick`s as the Mobile renderer.
- Gated only the unconfigured Artifacts page's account-settings button; retained
  its heading, copy, callback plumbing, and configured sign-in path.
- Changed only the two HTML title strings to `Axiom` / `Axiom Web`.
- Appended the prescribed text to the single mobile / cloud mapping row.

## Gate-to-test evidence

| Gate | Test / evidence |
| --- | --- |
| Switch derives from packaged defaults and ships false | `src/shared/cloud-account-availability.test.ts`: `is derived from the packaged cloud sign-in defaults`; `is unavailable in this build` |
| Shipped navigation removes account and Mobile, preserving Set Up | `src/renderer/src/hooks/settings-navigation-capability-sections.test.ts`: `omits the Mobile and Axiom Account sections`; exact IDs `['setup-guide', 'general', 'integrations']`; real switches |
| Account navigation and search disappear together | `src/renderer/src/hooks/useSettingsNavigationMetadata.test.ts`: `omits the cloud account navigation and search while preserving Set Up order`; no account section or Cmd+J settings result when the getter is false |
| Dormant switch-on navigation remains upstream-compatible | Same metadata test file: existing `puts AI capability panes at the top on desktop` and `places the Orca account in Set Up on desktop only`; getter defaults / resets to true; both test bodies independently compared byte-for-byte with `main` and unchanged |
| Stale active and pending account targets cannot render the pane | `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.test.tsx`: parameterized `does not render Axiom Account with the shipped switch even with a stale %s target`; `active` and `pending` cases separately prove `deriveNeededSectionIds` includes the account before the renderer returns null; real switch |
| Unconfigured Artifacts page preserves copy without the dead button | `src/renderer/src/components/artifacts/ArtifactsPage.test.tsx`: `keeps the unconfigured copy without an account settings button in this build`; typed unconfigured auth fixture, real switch, heading and unconfigured copy present, button absent |
| Desktop / web titles | `src/renderer/document-title.test.ts`: `titles the desktop window Axiom`; `titles the web client Axiom Web`; default Node test environment, reads via `node:fs` and URLs relative to the test file |

The existing Artifacts, settings, WorktreeJumpPalette, and Cmd+J tests all passed
in the sidecar target run. No additional switch-on Artifacts mock was added.

## Commands and results

All commands ran within `/Users/henry/Documents/Axiom`. After diagnosing the
initial shell selection, verification used these environment settings:

```sh
export PATH="/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH"
export COREPACK_ENABLE_NETWORK=0
export npm_config_manage_package_manager_versions=false
```

Tools: Node `24.21.0`, pnpm `12.14.0`, repository-pinned Bun `1.4.3`,
Vitest `5.0.5`. Full captured logs are under
`/tmp/axiom-ui-hyg-1.bklpK3/`; essential results are recorded here so this report
does not depend on retention of temporary logs.

Sidecar targets (the exact `.axiom-work/briefs/UI-HYG.verify` target list):

```text
src/shared/cloud-account-availability
src/renderer/document-title
src/renderer/src/hooks/settings-navigation
src/renderer/src/hooks/useSettingsNavigationMetadata
src/renderer/src/components/settings
src/renderer/src/components/artifacts
src/renderer/src/components/WorktreeJumpPalette
src/renderer/src/components/cmd-j
```

| Command | Result |
| --- | --- |
| `node --version`; `pnpm --version` with the environment above | PASS: `v24.21.0`; `12.14.0` |
| `node config/scripts/ensure-native-runtime.mjs --runtime=node --check-only` | PASS, exit 0. Required patched node-pty artifact paths also exist. No rebuild ran. |
| `pnpm test` with the six new/updated test files before implementation | BLOCKED, exit 1, before tests: process-host build's `tsx` cannot create its IPC listener (`listen EPERM`). `red-tests.log`. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts` with those six test files before implementation | Expected RED: titles, account nav, and both stale-target cases failed; new switch module not yet present. The initial Artifacts assertion used the fallback heading rather than the catalog heading; corrected the assertion to the existing rendered `Sign in to Axiom`, with no catalog or copy edit. `red-vitest.log`. |
| Same direct runner, `src/renderer/src/components/artifacts/ArtifactsPage.test.tsx -t 'keeps the unconfigured copy'`, before the button guard | Expected RED at the button-absence assertion: the button existed. One failed / 17 filtered tests. `red-artifacts.log`. |
| `pnpm test` with all eight sidecar targets above | BLOCKED, exit 1, same `tsx` IPC restriction before Vitest. `sidecar-pnpm.log`. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts` with all eight sidecar targets above | PASS, exit 0: **288 files, 2,107 tests**, 21.66 s. `sidecar-vitest.log`. This runs the repository's actual runner and config using the already-present process-host dist; it does not prove the blocked build pre-step. |
| `rm config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` | All three exact paths were already absent (`No such file or directory`); caches were clean before the typechecks. No other path was removed. |
| `pnpm tc:node`; `pnpm tc:cli`; `pnpm tc:web` | Each BLOCKED, exit 1, in the same process-host `tsx` build pre-step. `tc-node-pnpm.log`, `tc-cli-pnpm.log`, `tc-web-pnpm.log`. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json` | PASS, exit 0, clean-cache direct invocation of the same repository typecheck runner. No type errors in the three projects: 3,175 / 17,864 / 15,679 files. `typechecks-direct.log`. |
| `pnpm run check:code-quality:changed` | PASS, exit 0: zero new findings in all seven scans across 10 changed code/test files, base `61226457773c`. Includes design-system and React Doctor scans. `changed-quality.log`. |
| `pnpm run check:vendor-egress-ratchet` | PASS, exit 0: 455 grandfathered pairs. Baseline file unchanged. `vendor-egress.log`. |
| `pnpm lint` | PASS, exit 0, complete pipeline through `check:compat-boundary-imports`, including RPC catalog and vendor-egress gates. Existing warnings / report-only localization notices remain. `lint.log`. |
| `pnpm exec oxfmt --check` with all 10 changed/new TypeScript and TSX files | PASS, exit 0. No formatter wrote any file. `format.log`. |
| `pnpm run lint:design-system` | Non-green repository report, exit 1: 4,372 findings in 674 unchanged files; **zero diagnostics in this task's changed files**, and the changed-code design-system gate passed. `design-system.log`. |
| `pnpm run typecheck:e2e` | BLOCKED, exit 1, same `tsx` pre-step. Did not treat its zero TS diagnostics as a successful check. `e2e-pnpm.log`. |
| `node config/scripts/run-e2e-typecheck.mjs` | Exit 1 with **226 TS diagnostics**, matching the sidecar's allowed ceiling of 226. This is a passing ceiling check, not a clean E2E typecheck. `e2e-direct.log`. |
| `git diff --check` | PASS. |
| Explicit protected-path `git diff --quiet main -- …` from the task | PASS, exit 0. Includes policy, account pane/search/type, ArtifactsPage, sign-in component, i18n, main, CLI, mobile, config, package manifests/lockfiles, Decisions, and tests. |
| Read-only Python scope / byte comparison against `git show main:<path>` | PASS: all 13 source/test/docs changed paths authorized; both HTML files differ only by their title string (CSP and comment byte-identical); both named upstream metadata test bodies byte-identical. This report is the 14th allowed deliverable. |

The first bare `pnpm --version` used Homebrew pnpm under Node 20 and attempted
automatic package-manager provisioning. The sandbox rejected creation of
`/Users/henry/Library/pnpm/.tools/pnpm/12.14.0_tmp_38798` with `EPERM`; that path
was not retried. The already-installed Node 24 Corepack entry supplied the
correct pnpm version, with downloads disabled. No install/add/remove/rebuild
command ran, no dependencies were moved or linked, and no tooling file was edited.

## Files changed

1. `src/shared/cloud-account-availability.ts` (new)
2. `src/shared/cloud-account-availability.test.ts` (new)
3. `src/renderer/src/hooks/settings-navigation-capability-sections.ts`
4. `src/renderer/src/hooks/settings-navigation-capability-sections.test.ts`
5. `src/renderer/src/hooks/useSettingsNavigationMetadata.test.ts`
6. `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.tsx`
7. `src/renderer/src/components/settings/settings-setup-workflow-section-renderers.test.tsx`
8. `src/renderer/src/components/artifacts/ArtifactsPageStates.tsx`
9. `src/renderer/src/components/artifacts/ArtifactsPage.test.tsx`
10. `src/renderer/index.html`
11. `src/renderer/web-index.html`
12. `src/renderer/document-title.test.ts` (new)
13. `docs/reference/orca-mapping.md`
14. `.axiom-work/reports/UI-HYG-1.md` (new)

## Remaining verification and limitations

- The standard `pnpm test` and `pnpm tc:*` wrapper gates need a host rerun. The
  precise pre-step is `src/packages/process-host/package.json:100`, invoking
  `tsx --conditions=orca-source scripts/build-dist.mjs`; `package.json:196`
  reaches it through `build:packages` (callers at lines 34 and 82–84).
  `tsx`'s CLI attempts a Unix IPC listener under the temporary directory, which
  this sandbox rejects. No edit to these out-of-scope build/package files was
  attempted; the wrapper gates are reported blocked, despite passing direct
  tests/typechecks. This leaves the requested all-green wrapper acceptance open.
- The broad design-system report is unchanged-file debt, outside this Task.
  Examples: `src/renderer/src/components/right-sidebar/CreateHostedReviewComposerFields.tsx:169`
  (`Label` typography), `:228` (dynamic Checkbox classes), `:230` (`Label`
  styling); `src/renderer/src/components/right-sidebar/FileExplorerFilesTreePane.tsx:147`,
  `:148`, `:153` (ScrollArea restyling). No fix or suppression was added.
- The E2E typecheck has 226 diagnostics within its sidecar ceiling; examples
  include `mobile/src/transport/direct-rpc-client.ts:43` and `:46`, and
  `mobile/src/transport/direct-socket-framing.ts:53`. These paths are protected.
- Electron was not launched, packaged, or installed. The host verifier must
  inspect the packaged app's account navigation/search/pane, unconfigured
  Artifacts button, and native window title. Static title tests do not replace
  that host check.
- CLI write-scope enforcement is verification-time diff inspection. The final
  scope checks pass; no work outside the authorized deliverables was added.
- Next step: independent host verification and the normal integration decision.
  No additional implementation scope or unresolved product question is proposed.
