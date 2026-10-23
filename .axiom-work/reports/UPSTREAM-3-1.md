# UPSTREAM-3 — Attempt 1 report

Date: 2026-10-22. Worker branch: `axiom/attempt/UPSTREAM-3/1`.
Launcher preparation HEAD: `d12e3a37bc0f7a0df047405e5a412e30349302f3`. Axiom merge-start: `393c083ebd`; upstream target: `41661e3312`; fork point: `3eb1adec20`.

**Delivery state: partial / not ready for integration.** Every marker-bearing file and every UD path is resolved. The fixed D72 migration/session/guard/wiring changes are present, but upstream removed the dispatch-capability API required by D11/D14. This unresolved compatibility/authority decision prevents Node typecheck and capability-dependent tests from passing. See B1. Changes remain uncommitted for the launcher; no Git index/ref mutation, dependency installation, or persisted application-database edit was performed.

## 1. Counts

- Marker-bearing files resolved: **301 / 301** (294 UU and 7 AA). The task brief says 544 hunks; the launcher's committed preparation HEAD contains **548** lines starting with `<<<<<<< ` in those same 301 files. All of them are now gone.
- UU classes: 152 brand-only, 133 substantive, 5 generated, 4 paired/renamed paths with no Axiom changes at their current path. AA: 7 substantive.
- UD decisions: **91 / 91**, comprising 56 brand-only and 35 substantive. All 91 old paths are removed; moved behavior is recorded below.
- Files with conflict markers remaining: **0**. Undecided UD paths: **0**. Node typecheck still identifies **25 files / 53 errors**, all tied to B1.
- Working-tree changed tracked paths before this report: 467; new untracked source/helper paths: 9. These counts include deletions and generator output, not only conflict files.
- Protected inputs unchanged: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `AGENTS.md`, `README.md`, `docs/decisions/**`, the six locale catalogs, and `.axiom-work/**` except this report. The verifier's mechanical resolutions were retained.

## 2. Kernel seams

### 2.1 Schema collision / D72 backfill

- `src/main/runtime/orchestration/db/schema/migrate-v43.ts:26` is byte-for-byte upstream `41661e3312`. A read-only `git show`/working-tree byte comparison passes.
- `schema/migrate-v44.ts:4`, `schema/migrate-v45.ts:3`, `schema/migrate-v46.ts:3` contain Axiom main's old v43/v44/v45 bodies. Exact comparison allowing only function name and `current >=` number substitution passes for all three.
- `src/main/runtime/orchestration/db/contract-constants.ts:22` retains upstream's v43 explanation followed by the requested Axiom v44–v46 comments; `SCHEMA_VERSION = 46` at line 26.
- `src/main/runtime/orchestration/db/schema/migrate.ts:47` calls v43 through v46 in order. The required `current >= 43 && current <= 45` idempotent address backfill is at line 53, inside the same transaction and before `user_version` is advanced.
- `src/main/runtime/orchestration/orchestration-schema-version-skew.ts` has the corresponding completeness probes renumbered to 45/46, preventing an already-shaped Axiom database from being misidentified as an old upstream schema.
- `src/main/runtime/orchestration/db/schema/axiom-tables-migration.test.ts:347` tests old Axiom stamps 43 and 45 using temporary directories. It checks all upstream address columns, unchanged free-text message body, all verification claim columns, and a clean reopen at 46. Existing side-table/spec/claim migration probes use the new numbers.
- Focused migration + legacy-address + home-write-guard run: **34 tests / 3 files PASS**. No test points at a real application database.

### 2.2 Session address

- `src/main/axiom/execution/mission-caller.ts:10` uses `formatOrcaSessionAddress`, after branded-ID validation.
- Axiom caller/run-mailbox/kernel-contract fixtures use the helper, or the literal `orca_session_id:` when asserting stored text. New structured-worker preamble tests follow upstream's canonical session address.
- The exact requested grep has one unrelated match: `tests/e2e/default-tabs-mark-crash-relaunch.spec.ts:28`, `['session:set', 'session:patch']`. These are IPC channel names, **not session addresses**; changing them would break the e2e interception. There are no old session-address constructions in the requested Axiom/CLI roots. This is a lexical-check false positive, not a retained old address.

### 2.3 §4b admission guards

All **17 calls** survive, before the corresponding mutation, with the same verb strings:

| Guard | Main | Working tree |
|---|---:|---:|
| `assertNotMissionManaged` | 14 | 14 |
| `assertTaskCreateAllowed` | 1 | 1 |
| `assertWorkerMessageAllowed` | 1 | 1 |
| `assertResetAllowed` | 1 | 1 |

Call locations under `src/main/runtime/rpc/methods/orchestration/`:

- `gates/gates.ts:126` and `:161` — create/resolve gates.
- `messaging/ask-methods.ts:75` — legacy ask.
- `messaging/message-methods.ts:55`, `:204`, `:303` — reply, Task create, Task update.
- `messaging/send-methods.ts:186`, `:249` — Worker message types and group sends.
- `runs/dispatch-methods.ts:61`, `runs/reset-methods.ts:12`, `runs/runs.ts:93` — dispatch/reset/Run mutation.
- `worker/worker-control.ts:209`, `worker/worker-release.ts:23`, `:52`, `:114`, `worker/worker-stop.ts:22`, `worker/workers.ts:56` — abandon/release/retain/user-input/stop/start.

### 2.4 M2-01 service-only worker seam

- `src/main/runtime/rpc/methods/orchestration/worker/control-plane-worker-start.ts:6` retains the service-only trusted input bag from main. On main this file defines the bag; `startLocalWorker` is the service function in `local-worker-start.ts` (rather than a public RPC schema).
- `local-worker-start.ts:30` retains that service boundary. System creator, precreated worktree, branch override, caller identity, depth-one policy and preamble callback are passed through upstream's newer agent/configured-model/chat/readiness/turn-observation flow. The input type is extracted to `local-worker-start-input.ts:13` to meet max-lines without suppressions.
- `local-worker-stop.ts:10` and `local-worker-release.ts:8` hold the callable service implementations; RPC handlers in `worker-stop.ts:15` and `worker-release.ts:16` retain admission guards and delegate local operations. Stop uses the host observation's current terminal handle and current structured-worker lifecycle behavior. Release adopts upstream retained-terminal/dead-process reconciliation.
- Axiom tests were ported for the new `beforeWrite` guard, structured send verdict `accepted`, session-based Worker identity, observation `terminalHandle`, and explicit runtime epoch on abandon. Stale-dispatch prechecks preserve the Control Plane's no-mutation behavior. Upstream's now-enforced circuit-breaker refusal is tested, not bypassed.
- The **capability-bearing part of the preamble is not functioning** because upstream removed it. B1 is an unresolved seam beyond the five enumerated in the brief.

### 2.5 Control Plane registration / lifecycle

- `src/main/orcad/orcad-entry.ts:251` and `:252`: Control Plane start/stop retained in the headless host. `src/main/startup/main-process-runtime-service.ts:193` and `:194`: desktop start/stop retained.
- `src/main/runtime/rpc/methods/index.ts:110`: `AXIOM_METHODS` stays registered. All Axiom definitions adopt upstream's newly-required `permission: 'workspace'` metadata; product policy/authority validation is retained.
- `src/cli/handler-group-manifest.ts:19`: `AXIOM_HANDLER_GROUPS`; `src/cli/specs/index.ts:37`: all six Axiom command-spec groups retained.
- `src/shared/orchestration-rpc-contract.ts:65`: `isAxiomMutation` still enters the orchestration fence/receipt path.
- `src/main/runtime/runtime-rpc/runtime-rpc-long-poll.ts:31`: `axiom.mission.plan` remains long-poll.
- `src/shared/global-settings-types.ts:428`: `providerActivations` retained, including normalization/persistence and startup/launch gating on upstream's relocated services.
- Regenerated RPC catalog has **41 Axiom method names**, exactly the 41 on main; none missing or added.

### 2.6 Seam-counter output and structural drops

Exact command: `python3 .axiom-work/scripts/upstream3-seam-check.py`.

```text
seam check: 139 touchpoints from main, 4 dropped
  import AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL (from create-axiom-tables-sql): main 2 -> candidate 0
  import isProviderActivated (from provider-activation): main 9 -> candidate 8
  token  'axiom.cmd': main 17 -> candidate 15
  token  AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL: main 2 -> candidate 0
```

Raw exit status is **FAIL (1)**, not zero. Each count change is accounted for; the checker and baseline were not edited:

1. Both `AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL` entries: the required D72 move takes the import/use from v43 to `schema/migrate-v44.ts:2`/`:9`. The check excludes paths listed as Axiom-added; v44 is on that list. The executable import and call are present, but now excluded by its filter. The byte-equivalence and migration tests above verify the moved body.
2. `isProviderActivated`: upstream deleted `setSystemCodexHomeHookSweepSuppressed` and its old real-home hook sweep. Its extra suppression predicate in old `startup/main-process-account-services.ts` is consequently gone. Rate-limit activation is preserved in `src/main/provider-account-services.ts:42`; launch gating moved to `src/main/codex/codex-runtime-home-launch-preparation.ts:30`; retained-PTY gating remains in `startup/main-process-pty-startup.ts:154`; managed startup hook gating remains in `agent-hooks/managed-agent-hook-controls.ts:70`. The retired sweep is not resurrected to satisfy a text count.
3. `'axiom.cmd'`: upstream deleted unused `src/main/ssh/ssh-remote-cli-launcher.ts` and its test (`5651141700`), removing two literals. Current managed-server/native launcher identities are ported, including the new Rust launcher. The old relay launcher is not resurrected.

## 3. Resolution decision log

The **152 UU brand-only files** take upstream structure with corresponding Axiom product/CLI/scheme text. Stable identifiers, `ORCA_*`, `orcad`, skill IDs, `orca.yaml`, `~/.orca`, attribution and non-user-visible fixtures remain. Brand-only UD paths are individually listed below because the Task requires a line for every deletion. Exceptions/additional ports include renamed test files, Rust replacing the C# launcher, relocated CLI/session environment code, and the obsolete relay path deletions.

### Substantive and generated conflict paths (plus paired rename paths)

- `src/renderer/src/components/editor/editor-dropped-file-open.test.ts` — taken from upstream new file-drop owner; old rejection copy ported to native-file-drop-rejection-message.
- `src/renderer/src/components/github-project/ProjectViewStates.tsx` — kept product issue URL policy; upstream board support with D32 copy.
- `src/renderer/src/components/mobile/mobile-platform-copy.ts` — kept Axiom disabled Android download per M0-05a.
- `src/renderer/src/components/onboarding/onboarding-feature-setup.test.ts` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/components/settings/ArtifactsSettingsPane.tsx` — kept unconfigured cloud handling, ported upstream sign-in progress UI.
- `src/renderer/src/components/settings/BrowserUseSkillStep.test.tsx` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/components/settings/CliSection.tsx` — ported to upstream structure — upstream skills-first CLI UI, Axiom executable and product copy.
- `src/renderer/src/components/settings/MobileSettingsPane.tsx` — kept Axiom disabled Android download per M0-05a.
- `src/renderer/src/components/settings/OrchestrationPane.test.tsx` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/components/settings/cli-source-control-integration-cards.test.tsx` — ported to upstream structure — retained Axiom provider activation coverage with upstream host-navigation copy.
- `src/renderer/src/components/settings/linear-agent-skill-install-cta.test.tsx` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/components/skills/SkillFreshnessUpdateDialog.test.tsx` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/components/skills/skill-freshness-skipped-reason.test.ts` — taken from upstream skill ownership/version-pinned installer tests; kept Axiom source repository and branding.
- `src/renderer/src/i18n/en-runtime-required.json` — regenerated from resolved sources via required package script.
- `src/renderer/src/lib/launch-agent-in-new-tab-host-resolution.test.ts` — ported to upstream structure — retained independent host-selection assertion; upstream atomic startup publication.
- `src/renderer/src/store/index.ts` — ported Mission slice into upstream buffer-record store composition.
- `src/renderer/src/store/slices/store-test-helpers.ts` — ported Mission slice into upstream buffer-record store composition.
- `src/main/runtime/claude-agent-teams-shim-env.test.ts` — kept Axiom CLI identity and upstream temporary HOME guard.
- `src/main/runtime/orca-runtime-agent-session-operation.test.ts` — ported Axiom CLI and local-host assertion to upstream planned terminal options.
- `src/main/runtime/orchestration/cli-command.ts` — kept from Axiom / taken from upstream — Axiom CLI identity with upstream environment-aware helpers.
- `src/main/runtime/orchestration/db/contract-constants.ts` — ported to upstream structure — D72 schema 46.
- `src/main/runtime/orchestration/db/schema/migrate-v43.ts` — taken from upstream — upstream idempotent session-address migration byte for byte.
- `src/main/runtime/orchestration/db/schema/migrate.ts` — ported to upstream structure — ordered migrations and old-Axiom address backfill.
- `src/main/runtime/orchestration/preamble.ts` — taken from upstream session-aware preamble with Axiom CLI/product wording; removed upstream capability prompt is blocked for Axiom callers (B1).
- `src/main/runtime/rpc/errors.test.ts` — kept both intents — Axiom Planner/Verification error coverage and upstream deferred-launch errors.
- `src/main/runtime/rpc/methods/orchestration-structured-worker-session.test.ts` — ported Axiom CLI identity to upstream absolute launcher-path assertions.
- `src/main/runtime/rpc/methods/orchestration/messaging/ask-methods.ts` — ported to upstream structure — Mission admission guard precedes upstream report/dispatch behavior.
- `src/main/runtime/rpc/methods/orchestration/runs/dispatch-methods.ts` — ported to upstream structure — Mission admission guard precedes upstream report/dispatch behavior.
- `src/main/runtime/rpc/methods/orchestration/worker/deliver-worker-dispatch-preamble.ts` — ported to upstream structure — custom preamble/depth cap retained with upstream agent-turn delivery.
- `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts` — ported upstream start behavior while retaining service-only controlPlane bag, precreated worktree, system creator and preamble injection; extracted input type for max-lines.
- `src/main/runtime/rpc/methods/orchestration/worker/worker-control.ts` — ported to upstream structure — guarded abandon retains verified session identity.
- `src/main/runtime/rpc/methods/orchestration/worker/worker-release.ts` — kept Axiom service-only release wrapper; ported upstream schema/presentation imports and permissions.
- `src/main/runtime/rpc/methods/orchestration/worker/worker-start-agent-placement.ts` — ported to upstream launch executor — retain branch and caller lineage in workspace factory.
- `src/main/runtime/rpc/methods/orchestration/worker/worker-start-readiness-settlement.ts` — kept both intents — custom builder/depth and upstream run-aware chat receipts.
- `src/main/runtime/rpc/methods/orchestration/worker/worker-stop.ts` — kept Axiom service-only stop wrapper with upstream workspace permission.
- `src/main/runtime/rpc/methods/orchestration/worker/workers.ts` — kept Axiom Mission-managed admission guard with the same verb before dispatch; took upstream chat placement and session identity behavior plus D32 wording.
- `src/main/runtime/runtime-rpc/runtime-rpc-long-poll.ts` — kept both intents — preserve Axiom planning/provider activation and upstream additions.
- `src/main/runtime/runtime-store-contract.ts` — kept both intents — preserve Axiom planning/provider activation and upstream additions.
- `src/main/runtime/runtime-worktree-agent-startup.test.ts` — kept both intents — Axiom CLI/host assertions and upstream lifecycle fixtures.
- `src/main/runtime/terminal/layout/terminal-resize-listeners.ts` — ported M2-12 foreground-shell verification to upstream terminal layout owner.
- `src/main/runtime/terminal/output/terminal-orchestration-authority.ts` — ported Axiom CLI identity through runtimeOrchestrationCliCommand helper.
- `config/scripts/ci-shard-timings.json` — ported to upstream structure — upstream timing data minus test paths absent from merged tree.
- `config/scripts/electron-builder-config.test.mjs` — kept both upstream packaging assertions and Axiom identity/unsigned assertions; moved architecture suite intact for max-lines.
- `config/scripts/electron-builder-mac-channel-config.test.mjs` — kept Axiom same-repository and unsigned-Windows regressions.
- `config/scripts/electron-builder-runtime-resources.test.mjs` — ported to upstream structure — union Axiom asar verification fixture and upstream packaged serve/runtime fixtures.
- `config/scripts/electron-runtime-floor.test.ts` — taken from upstream; Electron floor port now upstream.
- `config/scripts/generate-bundled-skill-guides.test.mjs` — kept product CLI projection tests with upstream generator coverage.
- `config/scripts/package-electron-runtime-contract.test.mjs` — ported to upstream structure — upstream release checks plus Axiom disabled-Homebrew regression.
- `config/scripts/pr-code-change-scope.test.mjs` — ported to upstream structure — retained removed-cloud scope classification and upstream asset case.
- `config/scripts/pr-workflow-parallelism.test.mjs` — taken from upstream reduced workflow tests; retained manual-only next-Node regression.
- `config/scripts/release-cut-token-permissions.test.mjs` — ported to resolved release workflows and Axiom repository guard; retained upstream token-permission assertions.
- `config/scripts/verify-dev-channel-packaging.test.mjs` — kept Axiom same-repository and unsigned-Windows regressions.
- `config/scripts/vitest-real-agent-home-write-guard.test.ts` — ported to upstream structure — upstream tests plus Axiom real-home removal protection.
- `config/scripts/vitest-real-agent-home-write-guard.ts` — ported to upstream structure — upstream hardened guard plus protected real ~/.axiom.
- `src/main/ssh/legacy-relay/ssh-relay-endpoint-incumbent.ts` — taken from upstream module split with D32 branding.
- `src/cli/specs/core.ts` — kept Axiom product policy examples with upstream command shapes.
- `src/cli/specs/project.ts` — kept Axiom product policy examples with upstream command shapes.
- `src/main/codex/codex-hook-legacy-cleanup.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/codex-hook-retired-commands.test.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/codex-hook-service-implementation.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/codex-real-home-hook-install.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/codex-real-home-hooks-json.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/codex-structured-child-environment.test.ts` — ported Axiom CLI assertion to upstream absolute-path identity tests.
- `src/main/codex/hook-service-legacy-cleanup.test.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/codex/hook-service-trust-grant.test.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/startup/codex-launch-preparation.ts` — ported provider activation to shared Codex launch factory callback.
- `src/main/startup/codex-session-resume-launch.ts` — ported verified resume activation to shared resume factory callback.
- `src/main/startup/linux-secret-service-probe.test.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/startup/linux-secret-service-probe.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/startup/main-process-account-services.ts` — ported startup provider activation wiring to shared provider-account-services.ts; retain upstream account/catalog services.
- `src/main/startup/main-process-runtime-launch.ts` — taken from upstream — relay creation moved to main-process-relay-startup.ts; guard ported there.
- `src/main/startup/main-process-runtime-service.ts` — kept Control Plane lifecycle wiring and ported explicit Codex launch into upstream environment resolver.
- `src/main/startup/main-window-core-services.ts` — kept Control Plane lifecycle wiring and ported explicit Codex launch into upstream environment resolver.
- `src/main/ipc/feedback.test.ts` — kept Axiom feedback policy test fixture; take upstream removal of redundant cases.
- `src/main/ipc/preflight-host-cli-status.test.ts` — kept upstream host status and Axiom activation tests; extracted unchanged hoisted mocks into __mocks__ to meet size gate.
- `src/main/ipc/preflight-test-harness.ts` — ported activation fixture to upstream direct imports.
- `src/main/ipc/pty-pane-restart-replace.test.ts` — kept Axiom activation assertions; ported fixture additions to pty-pane-owner-swap.test-fixture.ts.
- `src/main/ipc/pty/host-env/assembly.ts` — kept Axiom BROWSER CLI identity with upstream host-env refactor.
- `src/main/ipc/pty/ipc/spawn-commit.ts` — ported provider activation after upstream shared spawn commit, preserving reattach exclusion.
- `src/main/ipc/worktree-remote.ts` — taken from upstream — trust completion port superseded; SSH provider path retired.
- `.github/workflows/ci-cache-warmup.yml` — taken from upstream jobs with Axiom D41 no schedule/push; removed retired mobile release path.
- `.github/workflows/e2e.yml` — taken from upstream jobs with Axiom D41 no schedule/push; removed retired mobile release path.
- `.github/workflows/homebrew-bump.yml` — kept Axiom disabled Homebrew publishing.
- `.github/workflows/mobile.yml` — taken from upstream jobs with Axiom D41 no schedule/push; removed retired mobile release path.
- `.github/workflows/node-next-compat.yml` — taken from upstream jobs with Axiom D41 no schedule/push; removed retired mobile release path.
- `.github/workflows/release-cut.yml` — kept Axiom repository/artifact identities, no telemetry/diagnostic key injection, and inherited signing-retirement TODO; took upstream jobs and Axiom executable names; release pipeline still has inherited signing debt (M0 follow-up).
- `.github/workflows/release-mac-build.yml` — taken from upstream jobs with Axiom repository guard and existing Axiom telemetry/diagnostic injection removal.
- `.github/workflows/terminal-ime-e2e.yml` — taken from upstream jobs with Axiom D41 no schedule/push; removed retired mobile release path.
- `.github/workflows/unit-tests.yml` — ported to upstream structure — upstream module-cache and sharding; cloud relay integration job remains deleted.
- `docs/site/README.md` — kept no-published-host guidance with upstream Node 24 tooling updates.
- `docs/site/content/docs/cli/overview.mdx` — ported to upstream structure — upstream current command behavior with Axiom product guidance; retained removed artifact/mobile promotion.
- `docs/site/content/docs/cli/reference.mdx` — ported to upstream structure — upstream current command behavior with Axiom product guidance; retained removed artifact/mobile promotion.
- `docs/site/content/docs/cli/skills.mdx` — ported to upstream structure — upstream current command behavior with Axiom product guidance; retained removed artifact/mobile promotion.
- `docs/site/content/docs/remote-servers.mdx` — ported to upstream structure — upstream current command behavior with Axiom product guidance; retained removed artifact/mobile promotion.
- `src/main/cli/cli-dev-launcher.ts` — kept Axiom launcher aliases/env and upstream safe quoting.
- `src/main/cli/packaged-cli-assets.test.ts` — taken from upstream test consolidation with D21 Axiom executable/launcher fixtures.
- `src/main/rate-limits/service-live-claude-usage.test.ts` — kept upstream provider tests with explicit active-provider fixture.
- `src/main/rate-limits/service-refresh-orchestration.test.ts` — kept Axiom activation regressions alongside upstream zcode cases.
- `src/main/rate-limits/service/service-full-cycle-application.ts` — kept activation gates around upstream async homes and moved sibling-provider application.
- `src/main/rate-limits/service/service-full-cycle-preparation.ts` — ported to upstream structure — upstream full-cycle flow plus Axiom per-provider activation gates; unchanged result type extracted for max-lines.
- `src/main/orcad/orcad-entry.ts` — ported to upstream structure — retained Axiom boot/stop and egress policy on upstream headless lifecycle; extracted unchanged secret-store startup helper.
- `src/main/orcad/orcad-push-startup.test.ts` — kept upstream lifecycle tests and Axiom no-gateway regression.
- `src/main/telemetry/client-lifecycle.test.ts` — kept from Axiom — D25 local no-op tests, upstream transport changes do not apply.
- `src/main/telemetry/client-test-harness.ts` — kept from Axiom — D25 local no-op tests, upstream transport changes do not apply.
- `src/main/telemetry/client.test.ts` — kept from Axiom — D25 local no-op tests, upstream transport changes do not apply.
- `src/main/telemetry/client.ts` — kept Axiom local validating no-op; add upstream boolean track and isTelemetryEnabled API without transport.
- `src/main/agent-hooks/managed-agent-hook-controls.test.ts` — kept Axiom startup activation regression with upstream remaining tests.
- `src/main/agent-hooks/managed-agent-hook-controls.ts` — kept startup provider activation with upstream per-agent hook settings.
- `src/main/agent-hooks/server-endpoint-file-lifecycle.test.ts` — kept Axiom appId endpoint regression; accept removal of unused fixture imports.
- `src/main/persistence/applying-settings/settings-update.ts` — ported to upstream structure — retained Axiom provider activation normalization on upstream settings; extracted unchanged operation type for size gate.
- `src/main/persistence/loading-store/normalize-loaded-global-settings.ts` — kept provider activation normalization with upstream loaded-setting migrations.
- `resources/skills/current-manifest.json` — regenerated from resolved sources via required package script.
- `src/main/pty/codex-shell-launch-preflight.test.ts` — taken from upstream preflight behavior tests with Axiom launcher identities.
- `.github/scripts/check-root-directory-entries.mjs` — kept D33 root guard and upstream reviewed OpenCode configuration.
- `.gitignore` — ported to upstream structure — union Axiom operating artifacts and upstream cache exclusions.
- `config/electron-builder.config.cjs` — ported D21 identities/unsigned Windows and Axiom packaging exclusions into upstream resource/signing structure.
- `config/reliability-gates.jsonc` — taken from upstream rewrite; reapplied D33a removal of cloud-only gates, retained Axiom link adjustments; dropped obsolete UPSTREAM-2 trust gate whose tests upstream removed; 146-gate manifest passes.
- `config/tsconfig.cli.json` — taken from upstream import-driven typecheck/test configuration; upstream includes home guard.
- `config/tsconfig.node.json` — taken from upstream import-driven typecheck/test configuration; upstream includes home guard.
- `config/vitest.config.ts` — taken from upstream import-driven typecheck/test configuration; upstream includes home guard.
- `electron.vite.config.ts` — ported to upstream structure — upstream Rolldown build, Axiom transport-free constants, build commit and dark markers.
- `mobile/app.json` — ported to upstream structure — upstream mobile versions with D21 Axiom identity.
- `src/cli/bundled-skill-guides.ts` — regenerated from resolved sources via required package script.
- `src/cli/cli-error.ts` — taken from upstream error/recovery structure with Axiom CLI examples and server wording.
- `src/cli/handler-group-manifest.ts` — kept AXIOM_HANDLER_GROUPS with upstream split Jira/Linear/reference groups.
- `src/cli/index.test.ts` — kept Axiom artifacts endpoint fixture with upstream consolidated help cases.
- `src/cli/skills.test.ts` — ported Axiom skill repository and help identity to upstream pinned installer tests.
- `src/main/agent-trust-presets.test.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/agent-trust-presets.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/agent-trust-write-deadline.ts` — taken from upstream — supersedes UPSTREAM-1/UPSTREAM-2 port; retain product text.
- `src/main/macos-press-and-hold-default.defaults-domain.test.ts` — kept Axiom app identity with upstream process-host imports.
- `src/main/macos-press-and-hold-default.test.ts` — kept Axiom app identity with upstream process-host imports.
- `src/main/macos-press-and-hold-default.ts` — kept Axiom app identity with upstream process-host imports.
- `src/main/macos-tcc-prompt-watch.ts` — kept Axiom app identity with upstream process-host imports.
- `src/main/macos-tcc-reset.test.ts` — kept Axiom app identity with upstream process-host imports.
- `src/main/preflight/agent-detection.ts` — ported D37 auth gates to upstream pinned CLI probe binaries; removed retired relay detection.
- `src/main/updater/updater-nudge.ts` — kept Axiom nudge egress guard with upstream packaged-build check.
- `src/main/updater.mac-install.test.ts` — ported upstream API test expectations and retained D21/D32 Axiom identity on new text in resolved files.
- `src/main/updater.prerelease-fallback.test.ts` — kept Axiom release URLs and policy fixture; upstream removed obsolete duplicate RC test.
- `src/preload/api/telemetry-api.ts` — kept D25 removal of consent transport API; upstream resource-view stats types retained.
- `src/shared/agent-feature-install-commands.test.ts` — taken from upstream — pin skill installer/version while retaining Axiom source repository.
- `src/shared/daemon-adoption-telemetry.test.ts` — ported Axiom appId fixture to upstream classifier signature.
- `src/shared/feature-wall-tiles.ts` — kept Axiom docsPath isolation with upstream webp media.
- `src/shared/global-settings-types.ts` — kept both intents — provider activation state and upstream split settings types.
- `src/shared/protocol-version.ts` — ported Axiom capability to orchestration-runtime-capabilities.ts; branding follows split subsystem modules.
- `src/shared/release-channel.ts` — kept Axiom release repository policy; upstream prerelease identifier extraction.
- `src/shared/rpc-contract/rpc-params-catalog.generated.ts` — regenerated from resolved sources via required package script.
- `src/shared/tui-agent-startup.test.ts` — taken from upstream test aggregator — Axiom command assertions ported to tui-agent-startup.spec.ts.
- `src/types/build-constants.d.ts` — kept D25 no write-key and policy-owned diagnostic endpoints; retain build commit for pinned skills.

### Every UD disposition (91)

- `src/renderer/src/components/native-chat/use-structured-agent-session-outbox.test.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/orca-profiles/OrcaProfileSignOutConfirmDialog.test.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/settings/BrowserUseCliStep.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/settings/runtime-server-workflow-sections.test.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/settings/runtime-server-workflow-sections.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/settings/runtime-servers-connect-section.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/settings/setting-ownership.test.ts` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/sidebar/SidebarWorkspaceFilterSection.tsx` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-guards.test.ts` — ported to src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-guards.spec.ts; old path removed.
- `src/renderer/src/components/terminal-pane/pty-connection-stalled-hidden-restore.test.ts` — ported to src/renderer/src/components/terminal-pane/pty-connection-stalled-hidden-restore.spec.ts; old path removed.
- `src/renderer/src/hooks/useGlobalFileDrop.ts` — ported to src/renderer/src/lib/native-file-drop-rejection-message.ts; old path removed.
- `src/renderer/src/i18n/ko-ui-semantic-mistranslations.test.ts` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/lib/source-control-agent-action-plan.ts` — ported to src/renderer/src/lib/source-control-agent-action-launch-check.ts; old path removed.
- `src/renderer/src/lib/structured-agent-session-launch-failure-toast.ts` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/lib/workspace-create-error-format.test.ts` — taken from upstream deletion; obsolete feature or redundant coverage, Axiom delta was product copy.
- `src/renderer/src/store/slices/repos-project-groups-delete.test.ts` — ported to src/renderer/src/store/slices/repos-project-groups-delete.spec.ts; old path removed.
- `src/main/runtime/runtime-file-commands-mobile-file-list-limit.ts` — taken from upstream (deleted) — ported to src/main/runtime/files/file-mutation-expectation.ts.
- `src/main/runtime/ssh-file-explorer-chunk-read.ts` — taken from upstream (deleted) — upstream removed SSH filesystem provider.
- `src/main/runtime/structured-worker-child-identity-env.test.ts` — taken from upstream (deleted) — ported to src/main/runtime/structured-session-child-env.ts and its tests; CLI resolution now uses shared launcher helper.
- `src/main/runtime/structured-worker-child-identity-env.ts` — taken from upstream (deleted) — ported to src/main/runtime/structured-session-child-env.ts and its tests; CLI resolution now uses shared launcher helper.
- `config/scripts/bun-profile-change-scope.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/ci-cache-warmup-workflow.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/computer-use-skill-guidance.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/git-binary-compatibility-workflow.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/linux-package-maintainer-scripts.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/mobile-recording-pin-checkout.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/mobile-release-shell-switch-workflow.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/orca-cli-skill-guidance.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/orca-linear-skill-guidance.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/orchestration-skill-guidance.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/packaged-browser-lane-contract.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/release-blocker-fixes.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/skill-update-roundtrip-workflow.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/terminal-ime-e2e-workflow.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `config/scripts/windows-signing-workflow-contract.test.mjs` — taken from upstream deletion; redundant source/workflow inventory or superseded upstream port (node-server scope owns former Bun gate).
- `src/main/ssh/build-toolchain-diagnosis.ts` — ported to src/main/orcad/build-toolchain-diagnosis.ts.
- `src/main/ssh/orcad-remote-rollback.ts` — ported to src/main/managed-server/install/orcad-remote-rollback.ts.
- `src/main/ssh/ssh-relay-build-toolchain.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-deploy.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-native-deps-install-staged-upload.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-session.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-session.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-upload-stage-commands.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-upload-stage-windows-commands.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-relay-versioned-install.ts` — ported to src/main/managed-server/install/remote-versioned-install.ts.
- `src/main/ssh/ssh-remote-cli-host-passthrough.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-cli-host-passthrough.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-cli-launcher.test.ts` — taken from upstream (deleted) — deleted by `5651141700` chore: delete verified-unused modules and exports (#27438).
- `src/main/ssh/ssh-remote-cli-launcher.ts` — taken from upstream (deleted) — deleted by `5651141700` chore: delete verified-unused modules and exports (#27438).
- `src/main/ssh/ssh-remote-linear-cli.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-linear-read-help.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-linear-write-help.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-orca-cli.test.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-orca-cli.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/main/ssh/ssh-remote-orchestration-send.ts` — taken from upstream (deleted) — deleted by `ff27338299` refactor(ssh): connect fails for hosts orcad can't serve; remove the relay client path (#27214).
- `src/cli/specs/orchestration.test.ts` — taken from upstream (deleted) — retired duplicate spec/timeout test; Axiom changes were command identity or accommodating repeatable flags.
- `src/cli/specs/search.test.ts` — taken from upstream (deleted) — retired duplicate spec/timeout test; Axiom changes were command identity or accommodating repeatable flags.
- `src/cli/specs/skills.test.ts` — taken from upstream (deleted) — retired duplicate spec/timeout test; Axiom changes were command identity or accommodating repeatable flags.
- `src/main/codex/codex-real-home-hook-install.test.ts` — taken from upstream (deleted) — deleted by `ac8ea9f958` fix(codex): write Orca's hook into ~/.codex only when something changed (#25743).
- `src/main/codex/codex-trust-config-rollback.test.ts` — taken from upstream (deleted) — deleted by `cfa43e7eab` fix(codex): opening a terminal no longer strips Codex hooks from the real ~/.codex (#23552).
- `src/main/codex/codex-trust-config-rollback.ts` — taken from upstream (deleted) — deleted by `cfa43e7eab` fix(codex): opening a terminal no longer strips Codex hooks from the real ~/.codex (#23552).
- `src/main/codex/codex-user-hook-trust-rebase.test.ts` — taken from upstream (deleted) — deleted by `cfa43e7eab` fix(codex): opening a terminal no longer strips Codex hooks from the real ~/.codex (#23552).
- `src/main/codex/codex-user-hook-trust-rebase.ts` — taken from upstream (deleted) — deleted by `cfa43e7eab` fix(codex): opening a terminal no longer strips Codex hooks from the real ~/.codex (#23552).
- `src/main/ipc/agent-trust.ts` — taken from upstream (deleted) — deleted by `21d4ae9448` feat(agents): pre-trust the folder wherever Orca starts an agent (#23744).
- `src/main/ipc/computer-use-permissions.test.ts` — taken from upstream (deleted) — deleted by `1a19671ec5` test: remove low-value coverage and shorten expensive fixtures (#29135).
- `src/main/ipc/runtime-environment-pairing-verification.ts` — ported to src/main/ipc/runtime-environments/runtime-environment-pairing-verification.ts.
- `src/main/providers/ssh-git-provider-exec.test.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-provider-remote-sync.test.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-provider-status.test.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-provider-worktree.test.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-provider.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-read-provider.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-review-head-provider.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/providers/ssh-git-worktree-provider.ts` — taken from upstream (deleted) — deleted by `c5224f70d8` refactor(providers): delete the SSH git and filesystem providers and relay-only wiring (#27644).
- `src/main/cli/windows-launcher-asset.test.ts` — taken from upstream (deleted) — deleted by `ca4e239861` Remove low-value test inventories and duplicate fuzz oracles (#25791).
- `src/main/native-chat/agent-session-journal/journal-dispatch-reason-bound.test.ts` — ported to src/main/native-chat/agent-session-journal/journal-dispatch-reason-bound.spec.ts.
- `src/main/native-chat/agent-session-journal/journal-file-format-remnant.ts` — taken from upstream (deleted) — deleted by `acea59c6d8` refactor(native-chat): remove the records-file and per-chat journal imports (#26038).
- `src/main/rate-limits/antigravity-usage-mirror.ts` — taken from upstream (deleted) — deleted by `a76a0bcddc` fix(rate-limits): read real Antigravity quota from the agy CLI, not the Gemini mirror (#24073).
- `src/cli/handlers/orchestration-timeout-cli.test.ts` — taken from upstream (deleted) — retired duplicate spec/timeout test; Axiom changes were command identity or accommodating repeatable flags.
- `src/cli/handlers/orchestration-timeout.test.ts` — taken from upstream (deleted) — retired duplicate spec/timeout test; Axiom changes were command identity or accommodating repeatable flags.
- `src/main/claude-accounts/claude-managed-auth-storage.ts` — taken from upstream (deleted) — deleted by `8b2a5e45f1` Re-land Claude per-account folders (#24434, #26405) with the upgrade and proxy fixes (#26801).
- `src/main/claude-accounts/managed-auth-path.ts` — taken from upstream (deleted) — deleted by `8b2a5e45f1` Re-land Claude per-account folders (#24434, #26405) with the upgrade and proxy fixes (#26801).
- `src/main/claude-accounts/runtime-auth/runtime-auth-managed-credentials.ts` — taken from upstream (deleted) — deleted by `8b2a5e45f1` Re-land Claude per-account folders (#24434, #26405) with the upgrade and proxy fixes (#26801).
- `resources/skills/snapshot-registry.json` — taken from upstream deletion; ownership inventory replaces snapshot matching.
- `docs/reference/ci-runner-efficiency.md` — taken from upstream deletion; stale internal reference retired; D41/D45 remain authoritative in Decision Log and axiom-ci.yml.
- `native/windows-cli-launcher/OrcaCliLauncher.cs` — ported to native/windows-cli-launcher/src/main.rs; upstream native launcher replaces managed C#.
- `src/cli/cli-command-name-parity.test.ts` — ported to src/cli/specs/cli-command-names-parity.test.ts — retain Axiom reserved-command regression.
- `src/main/updater-test-harness.leaked-timers.test.ts` — taken from upstream (deleted) — deleted by `6e1b7e7fa3` test: remove junk tests that assert source text instead of behavior (#23815).
- `src/shared/structured-agent-session-send-disposition.test.ts` — taken from upstream (deleted) — desktop saved outbox removed; no imports remain.
- `src/shared/structured-agent-session-send-disposition.ts` — taken from upstream (deleted) — desktop saved outbox removed; no imports remain.
- `tests/e2e/e2e-worker-env-isolation.unit.test.ts` — taken from upstream deletion of source-inventory test; only Axiom delta was ignoring cross-version fixture directory.

### API adaptations, moved targets, and bounded quality fixes outside the marker list

- `config/scripts/electron-builder-architecture-guard.test.mjs` — moved existing architecture packaging tests intact into focused file; no assertions removed.
- `native/windows-cli-launcher/app.manifest` — D21 metadata for moved native CLI launcher.
- `native/windows-cli-launcher/build.rs` — D21 metadata for moved native CLI launcher.
- `native/windows-cli-launcher/src/main.rs` — ported D21 CLI executable/environment defaults from removed C# launcher into upstream Rust launcher.
- `skills/jira-tickets/SKILL.md` — regenerated discovery stub from the bundled-guide generator; new upstream Jira frontmatter is listed for the later M0 pass.
- `skills/orca-jira/SKILL.md` — regenerated discovery stub from the bundled-guide generator; new upstream Jira frontmatter is listed for the later M0 pass.
- `src/cli/specs/account.test.ts` — ported Axiom assertions/branding to upstream identity, readiness and spawn APIs; retained behavior and host-boundary coverage.
- `src/cli/specs/cli-command-names-parity.test.ts` — ported Axiom reserved-command regression from retired CLI parity test.
- `src/cli/specs/repo.ts` — ported core command branding to upstream repo command specs.
- `src/main/axiom/execution/attempt-authority.ts` — ported SHA-256 replay hash inline because upstream removed dispatch-capability-hash; verifier API remains blocked under B1; no authority bypass added.
- `src/main/axiom/execution/attempt-launcher.test.ts` — ported to session addresses and requireStore API; preserves latest-dispatch retry attribution and verifies upstream circuit-breaker refusal instead of bypassing it.
- `src/main/axiom/execution/attempt-launcher.ts` — ported settings reader to upstream requireStore API, preserving launch behavior; capability-bearing preamble type remains blocked under B1.
- `src/main/axiom/execution/attempt-projection.test.ts` — updated execution-host observation fixtures for upstream resolved terminalHandle.
- `src/main/axiom/execution/mission-caller.test.ts` — ported D14 session-address assertions to upstream formatter/spelling.
- `src/main/axiom/execution/mission-caller.ts` — D72 session address uses upstream validated formatter.
- `src/main/axiom/execution/planner-proposal.test.ts` — updated execution-host observation fixtures for upstream resolved terminalHandle.
- `src/main/axiom/kernel-contract/control-plane-worker-start.test.ts` — ported readiness evidence to accepted structured turns, session-address identity and beforeWrite hook; capability parameter remains a B1 type error.
- `src/main/axiom/kernel-contract/dispatch-caller-identity.test.ts` — ported session-address helper and typed session wording; retained system creator and Mission caller authority assertions.
- `src/main/axiom/kernel-contract/run-mailbox-consumer.test.ts` — ported D14 session-address assertions to upstream formatter/spelling.
- `src/main/axiom/kernel-contract/session-party-run.test.ts` — ported session address helper and upstream chat-identity rejection wording; Mission/session binding and transaction rollback assertions retained.
- `src/main/axiom/namespace-rpc.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/axiom/recovery/agent-exit-observation.test.ts` — updated host observation fixture terminalHandle.
- `src/main/axiom/recovery/attempt-reconciliation.ts` — ported abandon API to explicit runtime epoch and preserved stale-dispatch non-mutation precheck.
- `src/main/axiom/recovery/planner-reconciliation.test.ts` — updated execution-host observation fixtures for upstream resolved terminalHandle.
- `src/main/axiom/recovery/planner-reconciliation.ts` — ported abandon API to explicit runtime epoch and preserved stale Planner-dispatch non-mutation precheck.
- `src/main/axiom/rpc-attempt.test.ts` — updated execution-host observation fixtures for upstream resolved terminalHandle.
- `src/main/codex/codex-ai-vault-session-resume.test.ts` — upstream supersedes UPSTREAM-2 tests and owns replaced trust-cleanup API; retains temp-home isolation.
- `src/main/codex/codex-hook-legacy-cleanup.test.ts` — taken from upstream deletion of the superseded UPSTREAM-2 hook/trust API coverage; current upstream hook-service legacy cleanup and retired-command tests retained.
- `src/main/codex/codex-real-home-hooks-json.test.ts` — taken from upstream replacement of the superseded UPSTREAM-2 real-home install API coverage; modern hook reconcile tests retained; real-home write guard not weakened.
- `src/main/codex/codex-runtime-home-launch-preparation.ts` — ported D37 hook activation gates from startup/codex-launch-preparation.ts to shared factory.
- `src/main/codex/codex-session-resume-launch-preparation.ts` — ported verified resume activation from desktop wrapper.
- `src/main/ipc/__mocks__/preflight-host-cli-status.ts` — moved unchanged preflight hoisted module mocks into the repository test-only __mocks__ convention.
- `src/main/ipc/pty-pane-owner-swap.test-fixture.ts` — ported provider activation store fake from restart-replace test.
- `src/main/ipc/pty/ipc/spawn-commit-provider-activation.test.ts` — ported upstream API test expectations and retained D21/D32 Axiom identity on new text in resolved files.
- `src/main/ipc/runtime-environments/runtime-environment-pairing-verification.ts` — ported D32 changes from src/main/ipc/runtime-environment-pairing-verification.ts.
- `src/main/ipc/settings.test-support.ts` — moved unchanged settings fake store/listener type; non-conflicting merge exceeded max-lines by four lines.
- `src/main/ipc/settings.test.ts` — retained all assertions and hoisted host mocks; extracted settings fake store for merged max-lines gate.
- `src/main/managed-server/install/orcad-remote-rollback.ts` — ported D32 changes from src/main/ssh/orcad-remote-rollback.ts.
- `src/main/managed-server/install/remote-versioned-install.ts` — ported D32 changes from src/main/ssh/ssh-relay-versioned-install.ts.
- `src/main/native-chat/agent-session-journal/journal-dispatch-reason-bound.spec.ts` — ported D32 changes from src/main/native-chat/agent-session-journal/journal-dispatch-reason-bound.test.ts.
- `src/main/orcad/build-toolchain-diagnosis.ts` — ported D32 changes from src/main/ssh/build-toolchain-diagnosis.ts.
- `src/main/orcad/orcad-secret-store-startup.ts` — extracted upstream secret-store startup helper unchanged to keep Control Plane wiring within max-lines.
- `src/main/persistence/applying-settings/settings-mutation-operations.ts` — extracted unchanged settings operation type to keep merged settings implementation within max-lines.
- `src/main/preflight/provider-authentication.ts` — ported auth helper to upstream quoting API and exact runnable binary selection.
- `src/main/provider-account-services.ts` — ported D37 rate-limit activation resolver and settings listener from desktop startup.
- `src/main/rate-limits/service/service-full-cycle-types.ts` — extracted unchanged full-cycle result type for merged provider-activation gate size.
- `src/main/runtime/files/file-mutation-expectation.ts` — ported branding from removed runtime-file-commands-mobile-file-list-limit.ts.
- `src/main/runtime/orchestration/__snapshots__/preamble.test.ts.snap` — regenerated with the focused preamble Vitest suite after D32/session wording changes; not hand-merged.
- `src/main/runtime/orchestration/db/schema/axiom-tables-migration.test.ts` — renumbered Axiom migration contracts to v44-v46; future-version probe v47.
- `src/main/runtime/orchestration/db/schema/migrate-v44.ts` — ported from Axiom migrate-v43.ts — D72 renumbering only.
- `src/main/runtime/orchestration/db/schema/migrate-v45.ts` — ported from Axiom migrate-v44.ts — D72 renumbering only.
- `src/main/runtime/orchestration/db/schema/migrate-v46.ts` — ported from Axiom migrate-v45.ts — D72 renumbering only.
- `src/main/runtime/orchestration/orchestration-schema-version-skew.ts` — renumbered Axiom column completeness probes to canonical v45/v46.
- `src/main/runtime/rpc/methods/axiom/artifact.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/attempt.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/goal.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/message.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/mission.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/plan.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/policy.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/task.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/axiom/verification.ts` — declared workspace permission required by upstream RPC registry; existing Axiom policy enforcement retained.
- `src/main/runtime/rpc/methods/orchestration/worker/local-worker-release.ts` — ported to upstream presentation module — local service behavior retained.
- `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start-input.ts` — extracted service-only start input type, including D14 trusted controlPlane bag; no RPC schema changes.
- `src/main/runtime/rpc/methods/orchestration/worker/local-worker-stop.ts` — ported from upstream worker-stop — use current handle and allow structured exited sessions to stop.
- `src/main/runtime/structured-session-child-env.test.ts` — ported CLI identity assertions from structured-worker-child-identity-env.test.ts to sealed child environment tests.
- `src/main/skills/skill-cloud-service.ts` — resolved merge-caused max-lines by extracting existing hash helper; cloud egress policy and behavior unchanged.
- `src/main/skills/skill-cloud-upload-idempotency.ts` — moved unchanged upload idempotency key helper; non-conflicting merge exceeded max-lines by three lines.
- `src/main/startup/codex-launch-preparation.test.ts` — ported activation-order tests to upstream launch context and hook reconcile service.
- `src/main/startup/main-process-relay-startup.ts` — ported Axiom configured-relay-origin guard to upstream on-demand installer.
- `src/main/telemetry/client-onboarding-language-cohort.test.ts` — D25 upstream cohort schema remains accepted but never creates transport captures.
- `src/main/updater.product-policy.test.ts` — removed mocks for dependencies upstream updater no longer imports.
- `src/main/usage/agent-token-usage-reporter.test.ts` — D25 adapts new upstream usage reporter tests to disabled transport/identity persistence; keeps strict schema coverage.
- `src/main/usage/usage-provider-store-lifecycle.test.ts` — D25 usage scans persist local cache only; no telemetry identity/snapshot writes.
- `src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-guards.spec.ts` — ported D32 copy from src/renderer/src/components/terminal-pane/pty-connection-fresh-spawn-guards.test.ts.
- `src/renderer/src/components/terminal-pane/pty-connection-stalled-hidden-restore.spec.ts` — ported D32 copy from src/renderer/src/components/terminal-pane/pty-connection-stalled-hidden-restore.test.ts.
- `src/renderer/src/lib/native-file-drop-rejection-message.test.ts` — D32 moved file-drop copy assertions.
- `src/renderer/src/lib/native-file-drop-rejection-message.ts` — ported D32 copy from src/renderer/src/hooks/useGlobalFileDrop.ts.
- `src/renderer/src/lib/source-control-agent-action-launch-check.ts` — ported D32 copy from src/renderer/src/lib/source-control-agent-action-plan.ts.
- `src/renderer/src/store/slices/repos-project-groups-delete.spec.ts` — ported D32 copy from src/renderer/src/store/slices/repos-project-groups-delete.test.ts.
- `src/shared/automation-runtime-capabilities.ts` — ported D32 server-update text from protocol-version.ts.
- `src/shared/files-runtime-capabilities.ts` — ported D32 server-update text from protocol-version.ts.
- `src/shared/orchestration-runtime-capabilities.ts` — ported Axiom capability definition and advertisement from protocol-version.ts.
- `src/shared/provider-activation.ts` — ported D37 provider activation enum to include upstream zcode rate-limit provider.
- `src/shared/source-control-runtime-capabilities.ts` — ported D32 server-update text from protocol-version.ts.
- `src/shared/task-source-runtime-capabilities.ts` — ported D32 server-update text from protocol-version.ts.
- `src/shared/tui-agent-startup.spec.ts` — ported Axiom CLI expectations into upstream split tests.

## 4. Self-check results

All package commands use `export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH`. Versions: Node v24.21.0; pnpm 12.14.0; Git 2.54.0 (Apple Git-157); Vitest 5.0.5. No dependency/package/lockfile changes.

### Required static checks and generators

| Command/check | Result | Failure classification / evidence |
|---|---|---|
| `git grep --untracked -n -I -E '^(<{7}|[|]{7}|>{7})( |$)' -- . ':!.axiom-work/**'` | PASS: no output (grep exit 1 = no match) | All 301 marker files resolved. |
| `python3 .axiom-work/scripts/upstream3-seam-check.py` | Raw FAIL: 4 structural count drops | Caused by upstream restructuring/checker path exclusion; all four explained in §2.6. No admission guard dropped. |
| Requested old-session grep | One unrelated IPC-name match | `tests/e2e/default-tabs-mark-crash-relaunch.spec.ts:28`; no old session-address construction. |
| `pnpm run generate:rpc-params-catalog` | PASS | Regenerated from registered schemas; 41/41 Axiom methods retained. |
| `pnpm run generate:bundled-skill-guides` | PASS | Generated bundled source and discovery stubs; no hand merge. |
| `pnpm run generate:skill-bundle-manifest` | PASS | Generated current manifest. Upstream-deleted snapshot registry stays deleted. |
| `pnpm run sync:localization-runtime-catalog` | PASS | `Wrote 2487 of 17013 English entries to en-runtime-required.json.` Six locale catalogs unchanged. |
| `pnpm run verify:rpc-params-catalog` | PASS | Final catalog check exit 0. |
| `pnpm run verify:bundled-skill-guides` | PASS | Final check exit 0. |
| `pnpm run verify:skill-bundle-manifest` | PASS | Final check exit 0. |
| `pnpm run check:reliability-gates` | PASS | `Reliability gate manifest check passed for 146 gate(s).` |
| Upstream `ci-shard-timings.json`, filtered for existing test paths | PASS | unit entries 12,302 → 11,734; e2e 290 → 290; no invented timings. |
| `pnpm run check:ts-nocheck-ratchet` | PASS | `ts-nocheck ratchet OK — 0 grandfathered entr(y/ies).` No no-check annotation added. |
| `git diff --check` | PASS | No whitespace errors. |

### Clean typechecks

The exact three cache paths were removed before the initial check. On final recheck, plain `rm` reported all three already absent; no build cache was present. No broad removal or Git restoration was used.

```sh
pnpm tc:node
pnpm tc:cli
pnpm tc:web
```

All three exact package commands **FAIL environmentally before compilation** in their shared `build:packages` step:

```text
$ tsx --conditions=orca-source scripts/build-dist.mjs
Error: listen EPERM: operation not permitted .../T/tsx-501/<pid>.pipe
Node.js v24.21.0
```

To obtain compiler evidence without changing scripts/dependencies, the same in-checkout package build was run with Node's import loader (avoiding tsx's CLI IPC listener), followed by the actual repository typecheck runner:

```sh
# Working directory: src/packages/process-host
node --import tsx --conditions=orca-source scripts/build-dist.mjs
# Working directory: repository root
node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json
```

The package build passes. Direct compiler results:

```text
CLI:  ✓ No type errors in 3,172 files
Web:  ✓ No type errors in 15,673 files
Node: Found 53 errors in 25 files, checked 17,843 files
```

Node was rerun after the final bounded helper extractions. **All 53 errors are caused by the merge's capability-API removal (B1)**: missing `orchestrationCapability` in `RpcRequest`/`RpcContext`, missing mint/verify/revoke DB methods, void `prepareStartingWorkerAuthority` returns, and removed `PreambleParams.dispatchCapability`. They have not been hidden with casts, skips, or type suppressions.

### Required focused tests

Exact requested command (attempted):

```sh
pnpm test src/main/runtime/orchestration/db src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/cli/handlers/axiom src/cli/specs config/scripts/vitest-real-agent-home-write-guard.test.ts
```

**FAIL environmentally** at the same shared tsx IPC listener, before tests start. After the loader-based package build, the actual repository test runner was invoked with only these targets:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache --maxWorkers=4 src/main/runtime/orchestration/db src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/cli/handlers/axiom src/cli/specs config/scripts/vitest-real-agent-home-write-guard.test.ts
```

Final result:

```text
Test Files  16 failed | 122 passed | 1 skipped (139)
     Tests  131 failed | 1007 passed | 1 skipped (1139)
  Duration  35.10s
```

**FAIL caused by merge (B1).** Failed file names:

- `src/main/axiom/db/messages-store.test.ts`
- `src/main/axiom/execution/attempt-ask.test.ts`
- `src/main/axiom/execution/attempt-authority.test.ts`
- `src/main/axiom/execution/attempt-submission-evidence.test.ts`
- `src/main/axiom/execution/attempt-submission-scope.test.ts`
- `src/main/axiom/execution/attempt-submission.test.ts`
- `src/main/axiom/execution/planner-proposal.test.ts`
- `src/main/axiom/messaging/message-router.test.ts`
- `src/main/axiom/messaging/subtask-checks.test.ts`
- `src/main/axiom/mission-controller/typed-mailbox-consumer.test.ts`
- `src/main/axiom/recovery/attempt-reconciliation.test.ts`
- `src/main/axiom/rpc-attempt-channel.test.ts`
- `src/main/axiom/rpc-attempt-check.test.ts`
- `src/main/axiom/rpc-message.test.ts`
- `src/main/axiom/rpc-question.test.ts`
- `src/main/axiom/rpc-subtask.test.ts`

The failures are missing capability methods, undefined capability receipts/transport, or consequences of authenticated messages/submissions not being admitted. No test was deleted or skipped to suppress these failures. The one skip is inherited test selection, not introduced here. Failed deterministic checks remain failed.

### Additional bounded checks

- Command prefix for every direct Vitest run: `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache`.
- Migration/real-home check targets: `src/main/runtime/orchestration/db/schema/axiom-tables-migration.test.ts src/main/runtime/rpc/orchestration-legacy-session-address-migration.test.ts config/scripts/vitest-real-agent-home-write-guard.test.ts` — **PASS, 34 tests / 3 files**. Guard includes both real `~/.orca` and real `~/.axiom`, including removal attempts.
- Preamble/kernel-contract/launch/CLI/activation/local-telemetry tests: `src/main/runtime/orchestration/preamble.test.ts src/main/axiom/kernel-contract/control-plane-worker-start.test.ts src/main/axiom/kernel-contract/dispatch-caller-identity.test.ts src/main/axiom/kernel-contract/session-party-run.test.ts src/main/axiom/execution/attempt-launcher.test.ts src/cli/specs/account.test.ts src/main/ipc/pty/ipc/spawn-commit-provider-activation.test.ts src/main/telemetry/client-onboarding-language-cohort.test.ts src/main/usage/agent-token-usage-reporter.test.ts src/main/usage/usage-provider-store-lifecycle.test.ts src/main/startup/codex-launch-preparation.test.ts` — all passed in the later 15-file bounded run. The preamble snapshots were generated with this suite's `-u` invocation, then passed without update mode.
- `src/main/persistence/applying-settings/settings-update-normalization.test.ts` — passed in the same bounded run.
- `src/main/ipc/preflight-host-cli-status.test.ts` — final **PASS, 31 tests**, after moving unchanged shared module mocks under `__mocks__`.
- `src/main/ipc/settings.test.ts src/main/skills/skill-cloud-service.test.ts` — **PASS, 43 tests / 2 files**, after unchanged helper/fake-store extraction for size limits.
- `config/scripts/electron-builder-config.test.mjs config/scripts/electron-builder-architecture-guard.test.mjs` plus preflight: **69 passed, 2 failed, 1 skipped**. The only remaining failures are **environmental**: `loads Codex TOML parsing after mac runtime pruning` and `... after linux runtime pruning` cannot hardlink the read-only pnpm store's `smol-toml` files into a temporary packaging directory (`EPERM`). Axiom app identity/unsigned Windows assertions and the moved architecture guard pass. The inherited Windows-only case is skipped on macOS.
- No full test suite, Electron launch, packaging release, network validation, or external-home write was run. Runtime/desktop behavior beyond the focused targets still needs the launcher's host verification.

### Full lint

`pnpm lint` — **FAIL for the M0 pass at `check:vendor-egress-ratchet`**. Earlier merge-caused max-lines and syntax-style issues were fixed through unchanged type/helper/test-fixture extraction, not rule changes. Final run passes, in order:

```text
oxlint (0 errors; 5 inherited docs-site accessibility/image warnings)
audit:anti-slop
audit:code-quality:native
audit:code-quality:type-aware
check:reliability-gates — 146 gates
check:dead-classes
check:max-lines-ratchet — 4 grandfathered entries
check:ts-nocheck-ratchet — 0 grandfathered entries
check:runtime-electron-ratchet — nothing reachable imports electron
```

The next command is `check:vendor-egress-ratchet`, which reports **121 new pairs, 15 grown counts, and 45 stale baseline entries**, then exits 1. The baseline is unchanged; no allow marker was added. Later lint-chain commands did not run after this failure. RPC/guide/manifest verification was separately run as recorded above. The five docs-site warnings are in unchanged `SearchDialog.tsx`, `docs-og-image.tsx`, `prose.tsx`, and `AutoplayClip.tsx` (two).

## 5. For the M0 pass

This is an inventory, not permission to expand egress. The later whole-tree M0 pass remains required by the Task.

- New unconflicted Jira sources `skill-guides/jira-tickets.md:4` and `skill-guides/orca-jira.md:4`/`:11` still describe Orca. Their generated descriptions/stubs consequently retain those new upstream phrases; change the sources and regenerate in the M0 pass. Stable skill IDs and the `ORCA` executable placeholder are intentional.
- New upstream workflow files need the requested D41 audit. Confirmed `schedule:`/`push:` carriers among the new files: `.github/workflows/ci-cache-warmup-platforms.yml`, `ci-runner-demand.yml`, `ci-xterm-cache.yml`, `node-server-tests.yml`, `wsl-orcad-e2e.yml`. The brief identifies 29 new workflows overall; only the conflicted existing workflow set was resolved in this attempt.
- New `config/scripts/release-javascript-artifact.mjs:73`/`:76` still refers to and requires `ORCA_POSTHOG_WRITE_KEY` for release artifacts. Its tests also carry release telemetry keys. Axiom's resolved build constants and release workflow injections stay removed; this new release script must be adapted before a release works.
- New `config/scripts/macos-terminal-host-bundle.cjs` and its test contain upstream identity references; audit whether each is inherited attribution, fixture identity, or active bundle identity. `mobile/src/app-update/app-store-update-source.ts:5` uses `com.stably.orca.mobile` in its lookup URL.
- New mobile podspec `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec:8`/`:9` points to onorca.dev / stablyai sources. Do not treat vendor references in license/attribution as interchangeable with active egress.
- The vendor ratchet's new pairs include the examples above, new tests/CI helpers, source-reference metadata, and new upstream telemetry-event/schema files. `config/reliability-gates.jsonc` preserves upstream evidence links (283 `stablyai` hits versus baseline 268); those are provenance links, not a runtime network permission. Review this deliberately rather than falsifying historical evidence to make a count pass.
- The verifier-owned locale review lists in `UPSTREAM-3-inventory.md` still apply. Runtime catalog was regenerated, but the six source catalogs were not edited.
- Existing release debt is retained visibly: `.github/workflows/release-cut.yml:1622` has `TODO(M0-03): Retire upstream signing/notarization steps before any Axiom release.` Product packaging is unsigned on Windows and uses Axiom identities, while the inherited release pipeline still contains signing gates. No release was attempted; this is not evidence that the release workflow is ready.

## 6. Blocked and Remaining

### B1 — upstream removed a security primitive Axiom still requires

Upstream `9afd1101ff` (`fix(orchestration): stop minting and printing the dispatch capability (#23994)`) removed `db/dispatch-capability-hash.ts`, `db/dispatch-context/dispatch-capability.ts`, DB mixin methods, the capability field in RPC context/dispatcher, and preamble token generation. `prepareStartingWorkerAuthority` now returns void. Upstream's process/session authority model remains, but it is not the D11/D14 capability contract Axiom's Worker CLI still requires.

Concrete blocked locations:

- `src/main/axiom/execution/attempt-authority.ts:92` and `:124` — removed verifier method/type, with original pane/process/lifecycle/replay checks still required.
- `src/main/axiom/execution/attempt-launcher.ts:211` — capability-bearing ContextPackage placeholder has no value from the new kernel preamble type.
- `src/main/runtime/rpc/methods/axiom/attempt.ts:32` and `:110` — request context no longer carries the capability.
- `src/main/runtime/orchestration/db/worker-dispatch/worker-dispatch-authority.ts:5` — upstream readiness preparation no longer mints a capability.
- The other affected files are the Axiom Attempt/Planner/submission/messaging call sites and their fixtures shown in the compiler/test results. The Node compiler reports 25 files total.

Decision needed: **preserve D11/D14 through a typed Axiom-owned capability adapter and optional Axiom RPC envelope/preamble plumbing, or explicitly revise the Axiom authority contract to upstream's replacement.** Recommended continuation is the adapter: retain the existing stored hash/revocation/pane/process constraints and replay semantics, scope it to Axiom's service/RPC boundaries, and add no parallel dispatch lifecycle. A change in authority semantics must not be inferred from an upstream deletion. The question was sent during execution; no answer was received before this handoff.

Per Task R3(c), the removed upstream capability subsystem was not resurrected. No auth bypass, fake capability, always-valid verifier, no-check annotation, or test exclusion was substituted. **The additional instruction to keep the entire tree compiling is not achieved**: the explicit unresolved contract is left as compiler/test failures, rather than hidden behind a fail-open shim. Do not launch Missions or integrate this candidate until B1 is resolved.

### Remaining

1. Resolve B1, port all 25 affected compile sites/fixtures, and verify capability mint/verify/revoke, exact sender binding, stale/foreign/replayed attempts, generation fencing, and receipt idempotency. The current 131 failing focused tests must pass; failures cannot be waived by this report.
2. On the host, rerun clean-cache `pnpm tc:node`, `pnpm tc:cli`, `pnpm tc:web` and the exact requested focused test command, because the package entry points cannot get past tsx IPC in this sandbox. Rerun the two hardlink-dependent packaging tests on the host as well.
3. Review the four raw seam-counter drops against the explanations in §2.6. Checker configuration belongs to the verifier; it was not edited by this Worker.
4. Perform the later whole-tree M0 pass, then rerun full lint through the commands after vendor-egress. Do not expand the vendor baseline.
5. Independent immutable-Candidate verification, any further resolved-surface tests, and the milestone/integration decision belong to the launcher/verifier. No integration, promotion, release, or Mission completion is claimed.

Temporary logs used during the attempt: `/tmp/upstream3-typechecks-final.log`, `/tmp/upstream3-tc-node-final.log`, `/tmp/upstream3-tc-*-command-final.log`, `/tmp/upstream3-focused-tests-final.log`, `/tmp/upstream3-lint-final.log`, `/tmp/upstream3-extra-tests-5.log`, `/tmp/upstream3-preflight-final.log`, `/tmp/upstream3-lint-split-tests.log`, `/tmp/upstream3-schema-tests-2.log`. Essential commands, outputs and failure names are copied above so the report does not depend on those temporary logs surviving.
