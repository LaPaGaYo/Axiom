# UPSTREAM-3 — attempt 2 Worker report

Date: 2026-10-22. Scope: D72 addendum, reapply M0 dispositions to cleanly merged upstream shipped code. This is an uncommitted Worker submission, not independent verification or a Mission completion decision.

The M0 changes are in the working tree. All 23 shipped-code candidate pairs are decided: 22 removed, one retained as the explicitly excluded `@stablyai/` package dependency. All five workflow trigger changes are applied. All 772 branding candidates are accounted for: 755 source lines updated, six generated lines handled by regeneration, and eleven compatibility/attribution/fixture lines retained. Additional CLI strings, one new mobile JSX message, and new Windows PE/assembly identities were corrected.

**Delivery limitation:** root dependencies became unavailable during the required `pnpm run` generator invocation. The root typechecks, full lint, RPC-catalog verification, reliability check, and full focused root test set cannot be certified. B1/D73 remains pending; the previously verified 53 B1 errors are a baseline, not a result reproduced in this attempt. D74 remains pending.

## Counts and boundaries

- 770 changed/deleted/new files, excluding this report; 301 are test files (including the removed migration test and the new native-update policy test).
- Deleted only `src/shared/portuguese-ui-language-migration.ts` and its unit test, as the addendum permits. Its imports/call sites were removed. No remaining call to `migratePortugueseUiLanguageOnLoad` exists.
- Conflict scan: no markers. Kernel seam check: **137 touchpoints, 0 dropped**. Schema/migration changes from attempt 1 remain untouched.
- RPC catalog is unchanged and retains the same **41 `axiom.*` methods**. This static comparison does not substitute for the blocked generator check.
- Root `package.json`, both pnpm files, `AGENTS.md`, `README.md`, `docs/decisions/**`, the vendor baseline, and the previous report are unchanged. No Git write command was used against this checkout; everything remains uncommitted. Existing tests create their own temporary Git fixtures.
- The only change under `src/main/axiom/**` is the expected validation-message text in `kernel-contract/session-party-run.test.ts` (`Axiom session ID`), following the branded runtime API. Attempt-authority implementation and its B1 tests were not repaired or redesigned. `src/shared/axiom-contract/**` is unchanged.

## Shipped-code vendor pairs (§1)

| Path | Candidate needles / pairs | Disposition |
|---|---:|---|
| `config/patches/ws@8.22.0.patch` | `stablyai` (1) | Issue citation now `upstream orca#23398`; patch behavior is unchanged. |
| `config/scripts/check-workspace-layout-rules.mjs` | `stablyai` (1) | Retained `@stablyai/playwright-test`, the explicit D74 package-name exception. No package substitution. |
| `config/scripts/ci-e2e-failure-tracking.mjs` | `stablyai` (1) | Issue ownership is checked against `PRODUCT_EGRESS_POLICY.issuesUrl`, with a digits-only issue suffix. Tests use Axiom and reject a foreign repository or extra path suffix. |
| `config/scripts/locale-ko-key-overrides.json` | `posthog` (1) | Removed the obsolete PostHog override key already absent from the catalogs. |
| `config/scripts/macos-terminal-host-bundle.cjs` | `com.stablyai`, `stablyai` (2) | Product identity comment and helper name/executable now describe Axiom. Runtime, packaging verification, and matching identity tests agree. |
| `config/scripts/release-javascript-artifact.mjs` | `posthog` (1) | No PostHog key requirement, read, or hash field. Official-build/source checks remain. Diagnostics URL is the shared policy value (`null`), not an environment-supplied endpoint. Configuration tests cover releases without the key and disabled diagnostics. |
| `config/scripts/run-node-server-tests.mjs` | `stablyai` (1) | Build-source link derives from `PRODUCT_EGRESS_POLICY.repositoryUrl`. |
| `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec` | `onorca.dev`, `orca.dev`, `stablyai` (3) | Homepage and source point to `LaPaGaYo/Axiom`. Module identifiers and upstream author attribution remain. |
| `mobile/src/app-update/app-store-update-source.ts` | `com.stably.orca` (1) | Lookup identity is `com.lapagayo.axiom.mobile`. Production source selection is disabled by the V1 egress policy. |
| `mobile/src/app-update/github-release-update-source.ts` | `stablyai` (1) | API repository derives from `productReleaseRepositorySlug()`. Production source selection is disabled by the same policy. Recorded upstream response fixtures remain unchanged for D74. |
| `src/cli/project-selector.ts` | `stablyai` (1) | Repository example uses `github:LaPaGaYo/Axiom`. |
| `src/main/daemon/macos-daemon-job-label.ts` | `com.stablyai`, `stablyai` (2) | Launchd prefix is `com.lapagayo.axiom.terminal`; profile key and protocol-version suffixes are unchanged. |
| `src/main/runtime/structured-session-child-env.ts` | `stablyai` (1) | Issue citation now `upstream orca#7904`; behavior unchanged. |
| `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx` | `onorca.dev`, `orca.dev` (2) | Documentation link is resolved by `resolveProductDocsUrl`. The guide button is absent when the policy has no docs origin. Text/defaults use Axiom. |
| `src/shared/portuguese-ui-language-migration.ts` | `stablyai` (1) | Removed the never-shipped upstream-plugin migration and its test. Desktop profile loading and web preferences use `normalizeUiLanguage`; saved plugin selections stay selections. Existing language-preservation tests were adapted. Optional persisted receipt fields are retained for compatibility, with no migration reader/writer. |
| `src/shared/serve-bundle-coordination.ts` | `com.stablyai`, `stablyai` (2) | Prefix is `com.lapagayo.axiom.serve`; suffix structure, coordination protocol, and internal `orcad-browser` suffix stay unchanged. |
| `src/shared/skill-freshness.ts` | `stablyai` (1) | Product-owned skill lock source derives from `productReleaseRepositorySlug()` and is compared case-insensitively. Ownership/grouping tests use Axiom. Generic repository/lock parsing fixtures remain in D74. |

Additional identity and policy work:

- `src/main/daemon/macos-daemon-bundle.ts` and `config/scripts/verify-packaged-daemon-entry.cjs`: `Axiom Terminal Host.app` / `axiom-terminal-host`; corresponding launchd/bundle/update tests follow. No runtime/build/test comparison against the old `com.stablyai` prefix remains outside the scanner and baseline.
- `src/cli/runtime/serve-app-launcher.ts`: resolves `axiom-ide` on Linux and `axiom` elsewhere. `serve-service-unit.ts` emits `axiom-serve*.service`, Axiom log-directory/display text, and the new launchd prefix. Internal coordination filenames/protocol identifiers are preserved.
- `mobile/src/app-update/app-update-runtime.ts`: no native update source while `PRODUCT_EGRESS_POLICY.automaticUpdateChecks` is false. The new `app-update-runtime.test.ts` checks cold-start scheduling and an explicit check on both iOS and Android, asserting **zero fetch calls**. Existing recorded App Store/GitHub responses were not rewritten.
- `native/windows-cli-launcher/{build.rs,app.manifest}` and `native/windows-agent-hook/{build.rs,app.manifest}` are new upstream OS metadata files not present at Axiom merge-start. They now identify product `Axiom`, company `LaPaGaYo` (the existing package author), and assemblies `LaPaGaYo.Axiom.CliLauncher` / `.AgentHook`. Upstream copyright text remains byte-for-byte. CLI PE filename metadata is `axiom.exe`; the internal Cargo target/output `orca` remains and packaging already maps it to `bin/axiom.exe`. The builder passes the correct PE filename, its Cargo comment documents the distinction, and Windows fixture app binaries are `Axiom.exe`. `orca-agent-hook.exe` and the administrator helper filename remain internal compatibility names. No signing policy or release-workflow signing debt was changed.
- `src/main/skills/skill-update-run.test.ts` now asserts the already-policy-controlled Axiom install source; this is an assertion about this product's release source, not a rewrite of a generic D74 repository fixture.

## Workflows (§2 / D41)

| Workflow | Retained triggers |
|---|---|
| `.github/workflows/ci-cache-warmup-platforms.yml` | `pull_request` |
| `.github/workflows/ci-runner-demand.yml` | `workflow_dispatch` |
| `.github/workflows/ci-xterm-cache.yml` | `workflow_dispatch` |
| `.github/workflows/node-server-tests.yml` | `pull_request`, `workflow_dispatch`, `workflow_call` |
| `.github/workflows/wsl-orcad-e2e.yml` | `pull_request`, `workflow_dispatch` |

For each file, YAML comparison with the prepared HEAD proves the entire parsed document equals HEAD after removing only `on.push` and `on.schedule`; jobs and all other settings are unchanged.

Workflow tests were updated for those triggers and for the already-removed mobile/cache-warmer push triggers. The Axiom workflow census no longer expects upstream's deleted `daemon-relocation-spike.yml`. The PR-only platform warmer is correctly accepted as PR-only; no manual trigger was invented. Tests continue to reject `push` and `schedule` on these upstream workflows.

## Branding (§3)

Counts below are the explicitly enumerated source candidates, not every changed assertion or regenerated line. Six additional candidates live in generated bundled guides and are covered by regeneration.

| Area | Candidate lines updated | Candidate files |
|---|---:|---:|
| `src/main/runtime` | 28 | 23 |
| `src/shared` | 64 | 23 |
| `src/main` | 254 | 144 |
| `src/cli` | 71 | 39 |
| `src/renderer` | 273 | 142 |
| `docs/site` | 23 | 4 |
| `mobile` | 22 | 19 |
| `resources` | 6 | 2 |
| `skill-guides` | 11 | 4 |
| `src/packages` | 2 | 2 |
| `src/wsl-guest` | 1 | 1 |

The 755 source candidates cover 403 files. An additional scan updated 105 lower-case CLI/scheme literals across 34 source files, related guide references, and the new mobile permission JSX message. Call-site i18n keys were preserved; changed defaults agree with the already-branded English catalog. Tests that assert changed runtime text follow it.

Retained candidates (11 lines):

- Four mobile font references to `Orca Nerd Font Symbols`: the font-family identifier must match the embedded font/CSS.
- Two hook headers, `X-Orca-Agent-Process` and `X-Orca-Agent-Hook-Token`: wire compatibility identifiers.
- Dsh managed-region marker and fish generated-wrapper marker: persisted recognition sentinels.
- Historical `Orca 1.4.224` in `src/main/ssh/legacy-relay/README.md`.
- The captured browser User-Agent in `terminal-ime-linux-pane-replay-fixture.ts`.
- The Typst grammar's upstream author attribution.

Other deliberate non-renames: `ORCA_*`, `orcad`, `orca.yaml`, `~/.orca`, `.orca` paths, skill IDs (`orca-cli`, `orca-jira`, `orca-linear`, etc.), plugin manifests/IDs, protocol/header fields, fixture repository names, and license/copyright text. Negative tests rejecting `orca://` retain that input. Generic translation-policy and skill-parser fixtures remain upstream samples. Remaining pre-merge literals outside the new-upstream scope were not globally renamed; the follow-up AST comparison found new residual mentions only in compatibility tokens, comments/SQL comments, and captured fixtures after correcting the new mobile JSX text.

`skill-guides/**` is the source of truth. Bundled CLI guide text, `skills/jira-tickets/SKILL.md`, `skills/orca-jira/SKILL.md`, and `resources/skills/current-manifest.json` were regenerated with repository generators, not edited by hand. `docs/site/**` new sections use Axiom and the `axiom` CLI.

## Catalogs (§4)

| Catalog | Values edited |
|---|---:|
| `en.json` | 3 |
| `es.json` | 4 |
| `fr.json` | 4 |
| `ja.json` | 4 |
| `ko.json` | 4 |
| `zh.json` | 4 |
| `pt.json` | 22 |

Total: **45 value-only edits**, limited to the supplied lowercase review lists. CLI names, product search text, and `orca://` were corrected; config filenames, paths, skill IDs, and plugin example identifiers remain. Key sets, key order, and interpolation placeholders are unchanged in all seven catalogs. The runtime-required English catalog was regenerated: **2,245 of 17,013** English entries are needed in the boot bundle. Its removed entries are now satisfied by corrected source defaults.

## Verification and environment

Tool versions: Node **24.21.0**; TypeScript API **6.0.3**; fallback root Vitest **5.0.5** from the existing process-host package; mobile Vitest **4.1.11**; YAML **2.9.1** from the installed mobile tree.

Environment incident: I invoked the required `pnpm run generate:bundled-skill-guides` / `pnpm run generate:skill-bundle-manifest`. pnpm 12.14.0 entered automatic dependency resolution before executing the scripts, warned that its global store could not be hard-linked in the sandbox, selected `node_modules/.pnpm-store/v11`, and attempted package downloads that failed DNS lookup. I stopped the running process. The root dependency links and `.bin` were then absent. I did not invoke `pnpm install/add/remove/rebuild/update/dedupe`, manually repair or create anything under `node_modules`, or change dependency manifests/locks. No further pnpm invocation was used. The host must restore its installed root dependencies before authoritative verification.

The attempted `rm -f` cache command was rejected by tool policy. Read-only inspection showed all three named `.tsbuildinfo` files were already absent; they remained absent at final inspection. Thus the direct typecheck attempt had clean caches, but did not reach a compiler.

| Check / command | Result and classification |
|---|---|
| `git grep --untracked -n -I -E '^(<{7}\|[\|]{7}\|>{7})( \|$)' -- . ':!.axiom-work/**'` | PASS — no output; grep exit 1 is the expected no-match result. |
| `python3 .axiom-work/scripts/upstream3-seam-check.py` | PASS — 137 touchpoints, 0 dropped. |
| `git diff --check` | PASS. |
| `node config/scripts/check-vendor-egress-ratchet.mjs --json` | FAIL — D74 only: 71 new pairs + 15 grown pairs. No new/grown pair outside D74; baseline unchanged. 45 stale baseline pairs may be shrunk later. Pair list below. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json` | ENVIRONMENTAL FAIL — missing `@orca/process-host` before any of the three compilers starts. Cannot certify the 53-error B1 bound or green CLI/web typechecks. |
| `node config/scripts/generate-rpc-params-catalog.mjs --check` | ENVIRONMENTAL FAIL — missing `esbuild`. Catalog itself unchanged; same 41 Axiom methods. |
| `node config/scripts/check-reliability-gates.mjs` | ENVIRONMENTAL FAIL — missing `jsonc-parser`. Manifest unchanged; removed migration paths have no references in reliability/timing data. |
| `node config/scripts/generate-bundled-skill-guides.mjs --write` then `--check`, through the loader below | PASS — regenerated and checked with installed matching YAML 2.9.1. |
| `node config/scripts/generate-skill-bundle-manifest.mjs --write` then the same script without flags | PASS — generated manifest verifies. |
| `generate-runtime-required-english-catalog.mjs` exported `main(process.cwd(), ['--fix'])`, then `main(process.cwd(), [])`, with the loader below | PASS — 2,245 / 17,013 entries; no drift. |
| Root `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache ...` | ENVIRONMENTAL FAIL — missing `@orca/process-host` before collection. Requested filters included renderer i18n, desktop/web language loading, skill freshness, daemon/serve identity, and config scripts. |
| Mobile configured Vitest run, 36 focused path filters listed below | PASS — **37 files / 400 tests**. Includes the new two-platform no-update-egress test. |
| Fallback root focused Vitest run, 56 filters listed below | PARTIAL — **31 files passed; 466 tests passed; 25 files failed; 12 tests failed; 5 skipped**. Remaining failures are missing dependencies, listed below. No remaining assertion mismatch in collected runnable tests. |
| Focused Windows launcher rerun after metadata corrections | PASS on this host — **4 tests passed, 5 Windows-only tests skipped**. Actual Windows PE assembly/execution still needs a Windows verifier. |
| `node_modules/.bin/oxlint` (first lint step) | ENVIRONMENTAL FAIL, exit 127 — root executable absent. Full `pnpm lint` was not retried because pnpm had attempted dependency installation. |
| `node config/scripts/check-max-lines-ratchet.mjs` | PASS — 4 grandfathered entries. |
| `node config/scripts/check-ts-nocheck-ratchet.mjs` | PASS — 0 grandfathered entries; no added suppression. |
| `node config/scripts/check-runtime-electron-ratchet.mjs` | ENVIRONMENTAL FAIL — missing `esbuild`. |
| Static TypeScript parse and localization audit | PASS — 720 changed TS/JS files parsed, 0 syntax errors, 248 changed keyed defaults checked, 0 English drift, 0 new type assertions/casts. This is not semantic typechecking. |
| Windows resource/manifest static check | PASS — both XML files parse; Axiom product/company/assembly fields and preserved upstream copyright verified. Binary build not run. |

Not claimed: full lint green before the ratchet; semantic typechecks; the full relevant root test set; Electron rendering/e2e; native Windows build. The anti-slop, native/type-aware quality audits and other dependency-bound lint parts need the restored host toolchain.

The early mobile/workflow assertions exposed stale string expectations and an over-broad test-fixture replacement. Those were fixed before the final runs: upstream-scheme rejection tests, generic translation/skill fixtures, CLI error mocks, policy-owned skill source, and workflow census/PR-only triggers. No failing check was relabeled as passing.

### Reproducible generator loader

The generators themselves are unchanged. An inline Node `registerHooks` resolver mapped only `yaml` to `mobile/node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js` and `typescript-api` to `mobile/node_modules/typescript/lib/typescript.js`. These versions match the root declarations/lock. It set `process.argv` to the bundled-guide script plus `--write` or `--check` before importing it, and called the runtime-catalog script's exported `main` with `--fix` or no flag. The manifest script ran directly. No dependency directory or symlink was written.

The supplemental root test harness used `startVitest` from `src/packages/process-host/node_modules/vitest/node`, `config: false`, the repository's `createWorkspaceSourceResolver().aliases`, `@`/`@renderer` aliases, exact installed YAML, and the existing real-home write guard, host-ports setup, and caller-identity setup. It used node/forks, four workers, normal timeouts, `ORCA_FEATURE_WALL_ENABLED=true` and a fixed test build hash. The real-home guard (including `~/.axiom`) was not weakened. Missing third-party dependencies were allowed to fail; a different Zod version from mobile was deliberately not substituted. This supplemental harness is not a claim that the normal root configuration ran.

### Final focused test filters

Mobile command: `ORCA_BACKGROUND_LAUNCH=1 node mobile/node_modules/vitest/vitest.mjs run --config mobile/vitest.config.ts --maxWorkers=4 <filters>`

```text
mobile/src/app-update
mobile/src/app-update/app-update-sources.test.ts
mobile/src/components/HostProtocolGate.test.ts
mobile/src/components/MobileDiffReviewDrawers.test.tsx
mobile/src/components/ProtocolBlockScreen.test.ts
mobile/src/diagnostics/connection-diagnostics-analysis.test.ts
mobile/src/diagnostics/connection-diagnostics-relay-dial.test.ts
mobile/src/diagnostics/connection-diagnostics-report.test.ts
mobile/src/diagnostics/connection-diagnostics-submission.test.ts
mobile/src/diagnostics/connection-diagnostics.test.ts
mobile/src/diagnostics/native-diagnostics-operations.test.ts
mobile/src/dictation/mobile-dictation-setup.test.ts
mobile/src/files/mobile-file-media-download.test.ts
mobile/src/home/AppUpdateCard.test.tsx
mobile/src/host-route-notice.test.ts
mobile/src/host-screen/host-server-workspaces-wiring.test.ts
mobile/src/host-screen/phone-card-property-choices.test.ts
mobile/src/host-screen/workspace-details-sheet.test.tsx
mobile/src/host-screen/workspace-options-sheet.test.tsx
mobile/src/mobile-web-shell/MobileWebShellScreen.test.tsx
mobile/src/mobile-web-shell/bridge/bridge-execution-host.test.ts
mobile/src/session/MobileNativeChatPermission.test.ts
mobile/src/session/MobileNativeChatView.failure-banner.test.ts
mobile/src/session/mobile-existing-agent-launch.test.ts
mobile/src/session/mobile-markdown-disk-fallback.test.ts
mobile/src/session/mobile-new-tab-agent-loader.test.ts
mobile/src/session/mobile-structured-agent-session-thrown-refusal.test.ts
mobile/src/session/mobile-structured-operation-id-retirement.test.ts
mobile/src/session/mobile-structured-queued-message-cards.test.ts
mobile/src/session/use-mobile-structured-agent-session-read-failure.test.tsx
mobile/src/session/use-mobile-structured-prompt-responses.test.tsx
mobile/src/settings/app-update-settings-rows.test.tsx
mobile/src/tasks/jira-mobile-connection.test.ts
mobile/src/transport/mobile-connection-path-label.test.ts
mobile/src/transport/pairing.test.ts
mobile/src/transport/relay-host-signed-out-verdict.test.ts
```

Fallback root filters (the `app-update` mobile filter above also collects the new policy test):

```text
config/scripts/axiom-ci-workflow-contract.test.mjs
config/scripts/build-windows-cli-launcher.test.mjs
config/scripts/ci-dependency-download-cache.test.mjs
config/scripts/ci-e2e-failure-summary.test.mjs
config/scripts/headless-detector-compiler-cache.test.mjs
config/scripts/live-remote-freeze-rpc.test.mjs
config/scripts/macos-terminal-host-bundle.test.mjs
config/scripts/mobile-test-change-scope.test.mjs
config/scripts/mobile-web-app/mobile-web-app-agent-history-render.test.mjs
config/scripts/mobile-web-app/preview/mobile-web-app-media-preview-render.test.mjs
config/scripts/node-server-change-scope.test.mjs
config/scripts/node-server-native-compat-scope.test.mjs
config/scripts/release-javascript-artifact.test.mjs
config/scripts/wsl-orcad-workflow-qualification.test.mjs
src/cli/runtime/launch-serve-runtime.test.ts
src/cli/runtime/launch.test.ts
src/cli/runtime/serve-bundle-park.test.ts
src/cli/runtime/serve-install-hold.test.ts
src/cli/runtime/serve-pairing-redaction.test.ts
src/cli/runtime/serve-service-unit.test.ts
src/cli/runtime/serve-supervised-service.test.ts
src/cli/runtime/status-caller.test.ts
src/shared/agent-process-recognition.test.ts
src/shared/agent-session-journal-submission-schema.spec.ts
src/shared/agent-session-refusal-notice.test.ts
src/shared/agent-session-write-failure.test.ts
src/shared/daemon-adoption-telemetry.test.ts
src/shared/managed-orcad-execution-host.test.ts
src/shared/remote-runtime-tailscale-hint.test.ts
src/shared/remote-runtime-transport-error-agreement.test.ts
src/shared/runtime-environment-managed-orcad-store.test.ts
src/shared/runtime-environment-sidecar.test.ts
src/shared/runtime-environment-store-same-server.test.ts
src/shared/runtime-environment-store-unreadable-records-interleaving.test.ts
src/shared/runtime-environment-store-unreadable-records.test.ts
src/shared/skill-metadata.test.ts
src/shared/structured-agent-session-message-projection.test.ts
src/shared/structured-agent-session-rejection-words.test.ts
config/scripts/zcode-credential-workflow.test.mjs
config/scripts/relay-era-ref-refusal-workflow.test.mjs
config/scripts/release-mac-build-workflow-dispatch.test.mjs
config/scripts/pr-workflow-parallelism.test.mjs
config/scripts/dev-channel-orcad-template-workflow.test.mjs
config/scripts/workflow-ref-mirror-case-safety.test.mjs
config/scripts/playwright-focused-workflow-selection.test.mjs
config/scripts/hourly-preflight-workflow.test.mjs
config/scripts/workflow-ref-reachability.test.mjs
config/scripts/orcad-windows-prebuild-workflow.test.mjs
src/main/daemon/macos-daemon-bundle.test.ts
src/main/ipc/runtime-environments/runtime-environment-unreachable-hint.test.ts
src/main/window/macos-desktop-handoff.test.ts
src/main/startup/skill-share-deep-link-state.test.ts
src/renderer/src/components/skills/skill-freshness-grouping.test.ts
src/main/skills/skill-freshness-eligibility.test.ts
src/main/skills/skill-update-run.test.ts
src/renderer/src/web/web-pairing.test.ts
```

### Remaining fallback failures (all environment/dependencies)

Missing dependencies: `zod`, `@electron/asar`, `esbuild`, `@actions/expressions`, `playwright-core`, and `@stablyai/playwright-test`. The `launch-serve-runtime` mock-wrapper error has a missing-Zod cause. The 12 failed tests are 11 compiler-cache fixture cases plus one Playwright discovery case; the other failed files cannot collect. Five existing Windows-only cases are skipped on macOS by `itWindows` in `build-windows-cli-launcher.test.mjs`. No skip was added.

```text
config/scripts/headless-detector-compiler-cache.test.mjs
config/scripts/macos-terminal-host-bundle.test.mjs
config/scripts/mobile-web-app/mobile-web-app-agent-history-render.test.mjs
config/scripts/mobile-web-app/preview/mobile-web-app-media-preview-render.test.mjs
config/scripts/node-server-change-scope.test.mjs
config/scripts/node-server-native-compat-scope.test.mjs
config/scripts/playwright-focused-workflow-selection.test.mjs
config/scripts/wsl-orcad-workflow-qualification.test.mjs
src/cli/runtime/launch-serve-runtime.test.ts
src/cli/runtime/launch.test.ts
src/cli/runtime/status-caller.test.ts
src/renderer/src/web/web-pairing.test.ts
src/shared/agent-session-journal-submission-schema.spec.ts
src/shared/agent-session-refusal-notice.test.ts
src/shared/agent-session-write-failure.test.ts
src/shared/daemon-adoption-telemetry.test.ts
src/shared/managed-orcad-execution-host.test.ts
src/shared/remote-runtime-transport-error-agreement.test.ts
src/shared/runtime-environment-managed-orcad-store.test.ts
src/shared/runtime-environment-sidecar.test.ts
src/shared/runtime-environment-store-same-server.test.ts
src/shared/runtime-environment-store-unreadable-records-interleaving.test.ts
src/shared/runtime-environment-store-unreadable-records.test.ts
src/shared/structured-agent-session-message-projection.test.ts
src/shared/structured-agent-session-rejection-words.test.ts
```

## Remaining vendor ratchet pairs (D74)

The scanner still fails on these 86 pairs. They are test/sample data, provenance in the two expressly excluded config files, or the explicitly retained npm package scope. No baseline entry or allow marker was added.

| Path | Needle | Baseline → current |
|---|---|---:|
| `config/reliability-gates.jsonc` | `stablyai` | 268 → 283 |
| `config/scripts/adhoc-windows-parallelism.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/agent-state-rules-bundle.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/bump-android-apk-download-version.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/check-workspace-layout-rules.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/ci-draft-pr-admission.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/ci-shard-timings.md` | `stablyai` | 2 → 4 |
| `config/scripts/pullfrog-review-scope.test.mjs` | `stablyai` | 0 → 3 |
| `config/scripts/release-mac-build-workflow-dispatch.test.mjs` | `stablyai` | 11 → 16 |
| `config/scripts/release-policy.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/release-tag-pattern-census.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/release-windows-signing-gate.test.mjs` | `stablyai` | 0 → 1 |
| `config/scripts/verify-skill-update-roundtrip.test.mjs` | `stablyai` | 0 → 1 |
| `mobile/src/app-update/app-update-sources.test.ts` | `com.stably.orca` | 0 → 1 |
| `mobile/src/app-update/app-update-sources.test.ts` | `stablyai` | 0 → 4 |
| `mobile/src/app-update/fixtures/github-mobile-android-tag-refs.json` | `stablyai` | 0 → 48 |
| `mobile/src/app-update/fixtures/github-release-mobile-android-v0.0.50.json` | `stablyai` | 0 → 10 |
| `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` | `com.stably.orca` | 0 → 1 |
| `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` | `onorca.dev` | 0 → 2 |
| `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` | `orca.dev` | 0 → 2 |
| `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` | `stablyai` | 0 → 1 |
| `mobile/src/components/MobileMarkdown.file-links.test.ts` | `stablyai` | 0 → 3 |
| `mobile/src/components/ProtocolBlockScreen.test.ts` | `stablyai` | 1 → 2 |
| `mobile/src/terminal/terminal-webview-url-tap.test.ts` | `stablyai` | 0 → 2 |
| `mobile/src/transport/e2ee-v2-host-latch.test.ts` | `onorca.dev` | 0 → 1 |
| `mobile/src/transport/e2ee-v2-host-latch.test.ts` | `orca.dev` | 0 → 1 |
| `mobile/src/transport/mobile-relay-e2ee-link.test.ts` | `onorca.dev` | 7 → 8 |
| `mobile/src/transport/mobile-relay-e2ee-link.test.ts` | `orca.dev` | 7 → 8 |
| `mobile/src/transport/mobile-relay-error-timer-cleanup.test.ts` | `onorca.dev` | 0 → 1 |
| `mobile/src/transport/mobile-relay-error-timer-cleanup.test.ts` | `orca.dev` | 0 → 1 |
| `mobile/src/transport/mobile-relay-pairing-error-timer-cleanup.test.ts` | `onorca.dev` | 0 → 3 |
| `mobile/src/transport/mobile-relay-pairing-error-timer-cleanup.test.ts` | `orca.dev` | 0 → 3 |
| `src/cli/index-project-name-selectors.test.ts` | `stablyai` | 0 → 3 |
| `src/cli/index-project-setup.test.ts` | `stablyai` | 29 → 30 |
| `src/cli/index-worktree-create-repo-host.test.ts` | `stablyai` | 0 → 3 |
| `src/cli/index-worktree-create-target.test.ts` | `stablyai` | 5 → 11 |
| `src/main/daemon/macos-daemon-launchd.test.ts` | `stablyai` | 0 → 1 |
| `src/main/git/repo-username.test.ts` | `stablyai` | 19 → 22 |
| `src/main/git/saved-clone-target.test.ts` | `stablyai` | 0 → 5 |
| `src/main/github/client-tracked-upstream-default-branch.test.ts` | `stablyai` | 0 → 12 |
| `src/main/gitlab/gl-utils.test.ts` | `stablyai` | 11 → 15 |
| `src/main/gitlab/issues.test.ts` | `stablyai` | 38 → 53 |
| `src/main/ipc/repos-local-clone-lifecycle.test.ts` | `stablyai` | 0 → 2 |
| `src/main/orca-profiles/profile-project-domain-transfer.test.ts` | `stablyai` | 0 → 1 |
| `src/main/persistence-portuguese-ui-language-migration.test.ts` | `stablyai` | 0 → 1 |
| `src/main/persistence/profile-state/profile-state-offline-settings.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/agent-state-rules/agent-state-rules-live-update.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/mobile-cloud-relay/relay-host-proof.test.ts` | `onorca.dev` | 0 → 1 |
| `src/main/runtime/mobile-cloud-relay/relay-host-proof.test.ts` | `orca.dev` | 0 → 1 |
| `src/main/runtime/orca-runtime-startup-draft-launch-parity.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/sidebar-inputs/repo-icon-data-urls.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/sidebar-inputs/repo-icon-remote-fetch.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/sidebar-inputs/sidebar-project-catalog.test.ts` | `stablyai` | 0 → 1 |
| `src/main/runtime/structured-session-child-env.test.ts` | `stablyai` | 0 → 1 |
| `src/main/skills/skill-freshness-eligibility.test.ts` | `stablyai` | 0 → 1 |
| `src/main/skills/skill-freshness-inventory.test.ts` | `stablyai` | 2 → 3 |
| `src/main/skills/skill-lock-sources.test.ts` | `stablyai` | 0 → 6 |
| `src/main/telemetry/client-onboarding-language-cohort.test.ts` | `posthog` | 0 → 3 |
| `src/main/updater-agent-state-rules-release.test.ts` | `stablyai` | 0 → 3 |
| `src/renderer/src/components/browser-pane/assemble-chrome/BrowserAddressBar.test.tsx` | `stablyai` | 0 → 2 |
| `src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.test.ts` | `stablyai` | 0 → 11 |
| `src/renderer/src/components/floating-terminal/FloatingTerminalOrchestrationDialog.freshness.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/github-project/ProjectRoadmap.test.tsx` | `stablyai` | 2 → 4 |
| `src/renderer/src/components/new-workspace/SetProjectLocationDialog.host-identity.test.tsx` | `stablyai` | 0 → 2 |
| `src/renderer/src/components/settings/AgentSkillSetupPanel.freshness.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/settings/RepositoryHostSetupsSection.settings-entry.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/settings/repository/identity/RepositoryIconPicker.github-avatar-refresh.test.tsx` | `stablyai` | 0 → 6 |
| `src/renderer/src/components/settings/repository/identity/repository-icon-github.test.ts` | `stablyai` | 0 → 15 |
| `src/renderer/src/components/sidebar/CommentMarkdown.test.tsx` | `stablyai` | 9 → 13 |
| `src/renderer/src/components/sidebar/LinearAgentSkillSetupPrompt.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/sidebar/sidebar-list-golden-factories.test-fixture.ts` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/sidebar/sidebar-list-parity-project-catalog.test-fixture.ts` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/skills/SkillFreshnessNudge.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/skills/SkillFreshnessStatusPill.test.tsx` | `stablyai` | 0 → 1 |
| `src/renderer/src/components/terminal-pane/pty-connection-startup-draft-delivery.spec.ts` | `stablyai` | 0 → 4 |
| `src/renderer/src/components/terminal-pane/terminal-http-url-extraction.test.ts` | `stablyai` | 2 → 4 |
| `src/renderer/src/lib/agent-skill-nav-install-status.test.ts` | `stablyai` | 0 → 1 |
| `src/renderer/src/lib/skill-freshness-display-status.test.ts` | `stablyai` | 0 → 1 |
| `src/renderer/src/store/slices/repos-cross-host-refresh-identity.spec.ts` | `stablyai` | 0 → 3 |
| `src/renderer/src/store/slices/repos-project-host-capability.spec.ts` | `stablyai` | 0 → 2 |
| `src/renderer/src/store/slices/repos-project-runtime.spec.ts` | `stablyai` | 0 → 3 |
| `src/renderer/src/store/slices/repos-runtime-project-groups.spec.ts` | `stablyai` | 0 → 2 |
| `src/renderer/src/store/slices/repos-shared-project-badge-color.spec.ts` | `stablyai` | 0 → 3 |
| `src/renderer/src/web/web-preload-api-portuguese-language.test.ts` | `stablyai` | 0 → 8 |
| `src/shared/git-remote-identity.test.ts` | `stablyai` | 0 → 3 |
| `src/shared/project-section-parity.test-fixture.ts` | `stablyai` | 0 → 17 |

## Blocked and Remaining

1. **Host dependency restoration and independent verification:** restore the root installation outside this restricted Worker, then rerun all three clean-cache typechecks; verify RPC catalog, reliability and generated outputs; run tests next to changed files plus renderer i18n and config workflow tests; run the full lint chain. The previously verified B1 baseline was 53 `tc:node` errors and green CLI/web. This attempt cannot establish that no new semantic error exists beyond B1.
2. **D73 / B1:** still waiting for Henry's dispatch-capability decision. No attempt-authority fallback, stub, suppression, or permissive authority change was introduced.
3. **D74:** decide the retained upstream fixtures/provenance/package names before shrinking the baseline. The 86 pair list above is the final observed delta.
4. **Windows verification:** build and inspect both native helper resources and execute the five native-launcher cases on Windows. Product/assembly metadata and fixture paths are corrected; no signing policy was enabled.
5. Release-workflow `TODO(M0-03)` signing debt and feature visibility remain explicitly outside this attempt.

No source conflict, kernel seam drop, unresolved shipped-code candidate pair, catalog-key change, or remaining known runnable assertion failure is being handed off. The delivery state remains **uncommitted, awaiting launcher capture and independent verification**.

Temporary evidence for this session (summarized above so the report is self-contained): `/tmp/upstream3-m0-mobile-final.log`, `/tmp/upstream3-m0-focused-fallback-final.log`, `/tmp/upstream3-m0-windows-launcher-tests.log`, `/tmp/upstream3-m0-standard-checks.json`, `/tmp/upstream3-m0-static-final.json`, `/tmp/upstream3-m0-workflow-static.json`, `/tmp/upstream3-m0-ratchet-final.json`, and the two `upstream3-m0-generate-*.log` files recording pnpm's unexpected dependency resolution.
