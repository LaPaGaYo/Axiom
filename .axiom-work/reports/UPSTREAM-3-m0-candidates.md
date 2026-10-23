# UPSTREAM-3 — candidates for the M0 pass (verifier, after attempt 1)

Generated from the attempt-1 candidate `da5d2c72a9` plus the verifier catalog fix (`upstream3-catalogs.py`). These are starting points, not an exhaustive or authoritative list: confirm each against D32 / D21 / D25 / D37 / D41 before changing it.

## 1. Vendor-egress ratchet: pairs in shipped code (23)

Each must go per the M0 rules (identity → D21 values; endpoints → `PRODUCT_EGRESS_POLICY` / `resolveProductDocsUrl` / removal; telemetry → removed). The baseline may only shrink and no allow markers.

- `config/patches/ws@8.22.0.patch` — `stablyai` (baseline 0 → 1)
  - `config/patches/ws@8.22.0.patch:13: +    // 39-bit virtual addresses, which kills the connection (stablyai/orca#23398).`
- `config/scripts/check-workspace-layout-rules.mjs` — `stablyai` (baseline 0 → 1)
  - `config/scripts/check-workspace-layout-rules.mjs:37:     external: ['electron', '@stablyai/playwright-test'],`
- `config/scripts/ci-e2e-failure-tracking.mjs` — `stablyai` (baseline 0 → 1)
  - `config/scripts/ci-e2e-failure-tracking.mjs:17:       /^https:\/\/github\.com\/stablyai\/orca\/issues\/\d+$/.test(record.issue ?? '') &&`
- `config/scripts/locale-ko-key-overrides.json` — `posthog` (baseline 0 → 1)
  - `config/scripts/locale-ko-key-overrides.json:6333:     "ko": "PostHog"`
- `config/scripts/macos-terminal-host-bundle.cjs` — `com.stablyai` (baseline 0 → 1)
  - `config/scripts/macos-terminal-host-bundle.cjs:1: // The signed `com.stablyai.orca` helper that runs the terminal daemon on the pinned Node.`
- `config/scripts/macos-terminal-host-bundle.cjs` — `stablyai` (baseline 0 → 1)
  - `config/scripts/macos-terminal-host-bundle.cjs:1: // The signed `com.stablyai.orca` helper that runs the terminal daemon on the pinned Node.`
- `config/scripts/release-javascript-artifact.mjs` — `posthog` (baseline 0 → 3)
  - `config/scripts/release-javascript-artifact.mjs:73:     assert(!env.ORCA_POSTHOG_WRITE_KEY, 'Development bundle must not set a release telemetry key')`
  - `config/scripts/release-javascript-artifact.mjs:76:     assert(env.ORCA_POSTHOG_WRITE_KEY, 'Missing release telemetry key')`
  - `config/scripts/release-javascript-artifact.mjs:85:     telemetryKeySha256: identity === 'dev' ? null : sha256(env.ORCA_POSTHOG_WRITE_KEY)`
- `config/scripts/run-node-server-tests.mjs` — `stablyai` (baseline 0 → 1)
  - `config/scripts/run-node-server-tests.mjs:85:   const source = `https://github.com/stablyai/orca/tree/${resolveBuildSourceCommit()}``
- `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec` — `onorca.dev` (baseline 0 → 1)
  - `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec:8:   s.homepage = 'https://onorca.dev'`
- `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec` — `orca.dev` (baseline 0 → 1)
  - `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec:8:   s.homepage = 'https://onorca.dev'`
- `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec` — `stablyai` (baseline 0 → 1)
  - `mobile/modules/orca-window-controls-inset/ios/OrcaWindowControlsInset.podspec:9:   s.source = { :git => 'https://github.com/stablyai/orca.git' }`
- `mobile/src/app-update/app-store-update-source.ts` — `com.stably.orca` (baseline 0 → 1)
  - `mobile/src/app-update/app-store-update-source.ts:5: const LOOKUP_URL = 'https://itunes.apple.com/lookup?bundleId=com.stably.orca.mobile'`
- `mobile/src/app-update/github-release-update-source.ts` — `stablyai` (baseline 0 → 1)
  - `mobile/src/app-update/github-release-update-source.ts:6: const REPO_API = 'https://api.github.com/repos/stablyai/orca'`
- `src/cli/project-selector.ts` — `stablyai` (baseline 0 → 1)
  - `src/cli/project-selector.ts:16: // string ("github:stablyai/orca") nobody keeps in their head — so the name is what gets typed.`
- `src/main/daemon/macos-daemon-job-label.ts` — `com.stablyai` (baseline 0 → 1)
  - `src/main/daemon/macos-daemon-job-label.ts:11:   return `com.stablyai.orca.terminal.${profileKey}.v${protocolVersion}``
- `src/main/daemon/macos-daemon-job-label.ts` — `stablyai` (baseline 0 → 1)
  - `src/main/daemon/macos-daemon-job-label.ts:11:   return `com.stablyai.orca.terminal.${profileKey}.v${protocolVersion}``
- `src/main/runtime/structured-session-child-env.ts` — `stablyai` (baseline 0 → 1)
  - `src/main/runtime/structured-session-child-env.ts:21:  * so it never claims GNOME Orca's /usr/bin/orca (stablyai/orca#7904), and on packaged macOS/Windows`
- `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx` — `onorca.dev` (baseline 0 → 1)
  - `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx:241:                     'https://www.onorca.dev/docs/terminal#windows-administrator-mode'`
- `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx` — `orca.dev` (baseline 0 → 1)
  - `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx:241:                     'https://www.onorca.dev/docs/terminal#windows-administrator-mode'`
- `src/shared/portuguese-ui-language-migration.ts` — `stablyai` (baseline 0 → 1)
  - `src/shared/portuguese-ui-language-migration.ts:15:       settings?.uiLanguage === 'plugin:stablyai.orca-portuguese/pt-BR'`
- `src/shared/serve-bundle-coordination.ts` — `com.stablyai` (baseline 0 → 1)
  - `src/shared/serve-bundle-coordination.ts:9: export const SERVE_LAUNCHD_LABEL_PREFIX = 'com.stablyai.orca.serve'`
- `src/shared/serve-bundle-coordination.ts` — `stablyai` (baseline 0 → 1)
  - `src/shared/serve-bundle-coordination.ts:9: export const SERVE_LAUNCHD_LABEL_PREFIX = 'com.stablyai.orca.serve'`
- `src/shared/skill-freshness.ts` — `stablyai` (baseline 0 → 1)
  - `src/shared/skill-freshness.ts:64: const ORCA_SKILL_LOCK_SOURCE = 'stablyai/orca'`

## 2. Ratchet pairs in tests, fixtures and provenance (109) — NOT in this attempt

Upstream example data (`stablyai/orca` as a sample repository, App Store / GitHub API response fixtures) and upstream evidence links in `config/reliability-gates.jsonc` / `ci-shard-timings.md`. How these are treated waits for a verifier/Henry decision; leave them untouched.

- `config/reliability-gates.jsonc` — `stablyai` (268 → 283)
- `config/scripts/adhoc-windows-parallelism.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/agent-state-rules-bundle.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/bump-android-apk-download-version.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/ci-draft-pr-admission.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/ci-e2e-failure-summary.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/ci-shard-timings.md` — `stablyai` (2 → 4)
- `config/scripts/macos-terminal-host-bundle.test.mjs` — `com.stablyai` (0 → 5)
- `config/scripts/macos-terminal-host-bundle.test.mjs` — `stablyai` (0 → 5)
- `config/scripts/pullfrog-review-scope.test.mjs` — `stablyai` (0 → 3)
- `config/scripts/release-javascript-artifact.test.mjs` — `posthog` (0 → 5)
- `config/scripts/release-mac-build-workflow-dispatch.test.mjs` — `stablyai` (11 → 16)
- `config/scripts/release-policy.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/release-tag-pattern-census.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/release-windows-signing-gate.test.mjs` — `stablyai` (0 → 1)
- `config/scripts/verify-skill-update-roundtrip.test.mjs` — `stablyai` (0 → 1)
- `mobile/src/app-update/app-update-sources.test.ts` — `com.stably.orca` (0 → 2)
- `mobile/src/app-update/app-update-sources.test.ts` — `stablyai` (0 → 6)
- `mobile/src/app-update/fixtures/github-mobile-android-tag-refs.json` — `stablyai` (0 → 48)
- `mobile/src/app-update/fixtures/github-release-mobile-android-v0.0.50.json` — `stablyai` (0 → 10)
- `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` — `com.stably.orca` (0 → 1)
- `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` — `onorca.dev` (0 → 2)
- `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` — `orca.dev` (0 → 2)
- `mobile/src/app-update/fixtures/itunes-lookup-com.stably.orca.mobile.json` — `stablyai` (0 → 1)
- `mobile/src/components/MobileMarkdown.file-links.test.ts` — `stablyai` (0 → 3)
- `mobile/src/components/ProtocolBlockScreen.test.ts` — `stablyai` (1 → 2)
- `mobile/src/terminal/terminal-webview-url-tap.test.ts` — `stablyai` (0 → 2)
- `mobile/src/transport/e2ee-v2-host-latch.test.ts` — `onorca.dev` (0 → 1)
- `mobile/src/transport/e2ee-v2-host-latch.test.ts` — `orca.dev` (0 → 1)
- `mobile/src/transport/mobile-relay-e2ee-link.test.ts` — `onorca.dev` (7 → 8)
- `mobile/src/transport/mobile-relay-e2ee-link.test.ts` — `orca.dev` (7 → 8)
- `mobile/src/transport/mobile-relay-error-timer-cleanup.test.ts` — `onorca.dev` (0 → 1)
- `mobile/src/transport/mobile-relay-error-timer-cleanup.test.ts` — `orca.dev` (0 → 1)
- `mobile/src/transport/mobile-relay-pairing-error-timer-cleanup.test.ts` — `onorca.dev` (0 → 3)
- `mobile/src/transport/mobile-relay-pairing-error-timer-cleanup.test.ts` — `orca.dev` (0 → 3)
- `src/cli/handlers/serve-service.test.ts` — `stablyai` (0 → 1)
- `src/cli/index-project-name-selectors.test.ts` — `stablyai` (0 → 3)
- `src/cli/index-project-setup.test.ts` — `stablyai` (29 → 30)
- `src/cli/index-worktree-create-repo-host.test.ts` — `stablyai` (0 → 3)
- `src/cli/index-worktree-create-target.test.ts` — `stablyai` (5 → 11)
- `src/cli/runtime/serve-bundle-park.test.ts` — `com.stablyai` (0 → 1)
- `src/cli/runtime/serve-bundle-park.test.ts` — `stablyai` (0 → 1)
- `src/cli/runtime/serve-install-hold.test.ts` — `com.stablyai` (0 → 1)
- `src/cli/runtime/serve-install-hold.test.ts` — `stablyai` (0 → 1)
- `src/cli/runtime/serve-service-unit.test.ts` — `com.stablyai` (0 → 2)
- `src/cli/runtime/serve-service-unit.test.ts` — `stablyai` (0 → 3)
- `src/main/daemon/macos-daemon-bundle.test.ts` — `com.stablyai` (0 → 2)
- `src/main/daemon/macos-daemon-bundle.test.ts` — `stablyai` (0 → 2)
- `src/main/daemon/macos-daemon-launchd.test.ts` — `com.stablyai` (0 → 1)
- `src/main/daemon/macos-daemon-launchd.test.ts` — `stablyai` (0 → 2)
- `src/main/git/repo-username.test.ts` — `stablyai` (19 → 22)
- `src/main/git/saved-clone-target.test.ts` — `stablyai` (0 → 5)
- `src/main/github/client-tracked-upstream-default-branch.test.ts` — `stablyai` (0 → 12)
- `src/main/gitlab/gl-utils.test.ts` — `stablyai` (11 → 15)
- `src/main/gitlab/issues.test.ts` — `stablyai` (38 → 53)
- `src/main/ipc/repos-local-clone-lifecycle.test.ts` — `stablyai` (0 → 2)
- `src/main/macos-update-running-instances.integration.test.ts` — `com.stablyai` (0 → 1)
- `src/main/macos-update-running-instances.integration.test.ts` — `stablyai` (0 → 1)
- `src/main/orca-profiles/profile-project-domain-transfer.test.ts` — `stablyai` (0 → 1)
- `src/main/persistence-portuguese-ui-language-migration.test.ts` — `stablyai` (0 → 1)
- `src/main/persistence/profile-state/profile-state-offline-settings.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/agent-state-rules/agent-state-rules-live-update.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/mobile-cloud-relay/relay-host-proof.test.ts` — `onorca.dev` (0 → 1)
- `src/main/runtime/mobile-cloud-relay/relay-host-proof.test.ts` — `orca.dev` (0 → 1)
- `src/main/runtime/orca-runtime-startup-draft-launch-parity.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/sidebar-inputs/repo-icon-data-urls.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/sidebar-inputs/repo-icon-remote-fetch.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/sidebar-inputs/sidebar-project-catalog.test.ts` — `stablyai` (0 → 1)
- `src/main/runtime/structured-session-child-env.test.ts` — `stablyai` (0 → 1)
- `src/main/skills/skill-freshness-eligibility.test.ts` — `stablyai` (0 → 1)
- `src/main/skills/skill-freshness-inventory.test.ts` — `stablyai` (2 → 3)
- `src/main/skills/skill-lock-sources.test.ts` — `stablyai` (0 → 6)
- `src/main/skills/skill-update-run.test.ts` — `stablyai` (0 → 1)
- `src/main/telemetry/client-onboarding-language-cohort.test.ts` — `posthog` (0 → 3)
- `src/main/updater-agent-state-rules-release.test.ts` — `stablyai` (0 → 3)
- `src/main/updater/serve-supervisor-install-park.test.ts` — `com.stablyai` (0 → 1)
- `src/main/updater/serve-supervisor-install-park.test.ts` — `stablyai` (0 → 1)
- `src/main/updater/shipit-leftover-recovery.test.ts` — `com.stablyai` (0 → 3)
- `src/main/updater/shipit-leftover-recovery.test.ts` — `stablyai` (0 → 3)
- `src/renderer/src/components/browser-pane/assemble-chrome/BrowserAddressBar.test.tsx` — `stablyai` (0 → 2)
- `src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.test.ts` — `stablyai` (0 → 11)
- `src/renderer/src/components/floating-terminal/FloatingTerminalOrchestrationDialog.freshness.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/github-project/ProjectRoadmap.test.tsx` — `stablyai` (2 → 4)
- `src/renderer/src/components/new-workspace/SetProjectLocationDialog.host-identity.test.tsx` — `stablyai` (0 → 2)
- `src/renderer/src/components/settings/AgentSkillSetupPanel.freshness.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/settings/RepositoryHostSetupsSection.settings-entry.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/settings/repository/identity/RepositoryIconPicker.github-avatar-refresh.test.tsx` — `stablyai` (0 → 6)
- `src/renderer/src/components/settings/repository/identity/repository-icon-github.test.ts` — `stablyai` (0 → 15)
- `src/renderer/src/components/sidebar/CommentMarkdown.test.tsx` — `stablyai` (9 → 13)
- `src/renderer/src/components/sidebar/LinearAgentSkillSetupPrompt.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/sidebar/sidebar-list-golden-factories.test-fixture.ts` — `stablyai` (0 → 1)
- `src/renderer/src/components/sidebar/sidebar-list-parity-project-catalog.test-fixture.ts` — `stablyai` (0 → 1)
- `src/renderer/src/components/skills/SkillFreshnessNudge.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/skills/SkillFreshnessStatusPill.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/skills/SkillUpdateRow.test.tsx` — `stablyai` (0 → 1)
- `src/renderer/src/components/skills/skill-freshness-grouping.test.ts` — `stablyai` (0 → 5)
- `src/renderer/src/components/terminal-pane/pty-connection-startup-draft-delivery.spec.ts` — `stablyai` (0 → 4)
- `src/renderer/src/components/terminal-pane/terminal-http-url-extraction.test.ts` — `stablyai` (2 → 4)
- `src/renderer/src/lib/agent-skill-nav-install-status.test.ts` — `stablyai` (0 → 1)
- `src/renderer/src/lib/skill-freshness-display-status.test.ts` — `stablyai` (0 → 1)
- `src/renderer/src/store/slices/repos-cross-host-refresh-identity.spec.ts` — `stablyai` (0 → 3)
- `src/renderer/src/store/slices/repos-project-host-capability.spec.ts` — `stablyai` (0 → 2)
- `src/renderer/src/store/slices/repos-project-runtime.spec.ts` — `stablyai` (0 → 3)
- `src/renderer/src/store/slices/repos-runtime-project-groups.spec.ts` — `stablyai` (0 → 2)
- `src/renderer/src/store/slices/repos-shared-project-badge-color.spec.ts` — `stablyai` (0 → 3)
- `src/renderer/src/web/web-preload-api-portuguese-language.test.ts` — `stablyai` (0 → 7)
- `src/shared/git-remote-identity.test.ts` — `stablyai` (0 → 3)
- `src/shared/portuguese-ui-language-migration.test.ts` — `stablyai` (0 → 6)
- `src/shared/project-section-parity.test-fixture.ts` — `stablyai` (0 → 17)

## 3. Workflows (D41)

New upstream workflows with `push:` / `schedule:` triggers and no `github.repository == 'stablyai/orca'` guard: `ci-cache-warmup-platforms.yml` (push), `ci-runner-demand.yml` (schedule), `ci-xterm-cache.yml` (push, schedule), `node-server-tests.yml` (schedule), `wsl-orcad-e2e.yml` (schedule). Remove those triggers, keep `workflow_dispatch` / `workflow_call` / `pull_request`; workflows that carry the repository guard (as M0-14 left them) need nothing.

## 4. New upstream lines with a standalone `Orca` in user-visible text (772 lines in 414 files)

Lines that are new since the fork (absent from main's copy of the file), contain the word `Orca`, and look like a string, JSX text or docs prose; comments are excluded. Some are false positives (identifiers inside strings, attribution); D32 decides.

### `docs/site/content/docs/cli/automations.mdx` (3)
- 74: `--project` takes the project id or the display name from `orca project list`. `--host` takes `local`, `ssh:<target-id>`, `runtime:<environment-id>`, or the bare name from `orca host list`, and it can
- 120: On each fresh run, Orca starts from the host's default Arguments for that agent and appends the extras. A model or effort option in the extras replaces the one in the defaults. Pass the value with `=`
- 122: Saved extras use the same quoting on every host, including Windows: wrap values containing spaces in single or double quotes, and use single quotes to preserve backslashes in paths, such as `--add-dir

### `docs/site/content/docs/model/orca-yaml.mdx` (9)
- 8: This reference covers **local Git worktrees**. [Folder workspaces](/docs/model/worktrees#multi-repo-project-groups--folder-workspaces) do not create a Git checkout or run these copy/share steps. For o
- 34: All keys are optional. Script, title, command, and path values must be strings; Orca trims them and drops empty or oversized values. Invalid fields are skipped while valid siblings still apply. Unknow
- 50: **Invalid YAML or a duplicate mapping key anywhere rejects the whole file.** Orca does not keep the last duplicate value. A non-mapping root, excessive alias expansion, or an oversized file also produ
- 63: The **primary checkout** is the repository folder registered in Orca. It may be on a different branch from the new worktree.
- 77: In **Settings → Repository**, setup can run automatically, ask each time, or be skipped by default. A new repository defaults to running setup. The [CLI](/docs/cli/reference#worktrees) accepts `--setu
- 87: When no source choice is saved, a nonempty local hook selects **Local only** for that hook; otherwise Orca uses **orca.yaml only**. Shared directories are independent of this command-source choice.
- 89: Setup runs in a **Setup** terminal. On macOS/Linux, Orca writes a Bash runner with `set -e`; supported shell options on a leading `#!` line are replayed. On native Windows, the runner uses `.cmd` synt
- 110: `issueCommand` has its own override: nonempty `.orca/issue-command` content wins over YAML. Clearing that local file restores the shared template. This is separate from the setup/archive command-sourc
- 138: Use **one literal path per line**, anchored to the repository root. Blank lines and lines starting with `#` are ignored; inline comments are not stripped. Backslashes, a leading `./`, and trailing `/`

### `docs/site/content/docs/review/jira.mdx` (1)
- 24: Orca looks up the site's cloud ID without sending the token, then routes scoped-token API requests through `https://api.atlassian.com/ex/jira/<cloudId>`. With an email, it tries the site first and ret

### `docs/site/content/docs/terminal.mdx` (10)
- 72: When Orca uses its bash integration wrapper, it starts bash with `--rcfile` instead of `-l`. The wrapper sources the same login files without separately sourcing `~/.bashrc`; bash itself is not in log
- 74: To open a different shell, choose **Custom shell** under [Settings → Terminal → Terminal shell](/docs/settings). Under **Advanced → Custom args**, enter one argument per line to replace the default `-
- 84: Open **Settings → Terminal → Administrator mode** to see whether the Orca app
- 86: means Orca could not read its Windows elevation status. Existing terminals can
- 91: approval, Orca replaces its current local terminal host. This ends that host’s
- 96: If you cancel Windows’ prompt or elevation fails, Orca reopens with its previous
- 99: For a manual launch, finish your local terminal work and exit Orca. Find Orca in
- 116: Orca.
- 119: exit Orca, and launch it normally. Closing the sessions lets the retained
- 120: terminal host retire after Orca disconnects; leaving sessions running can retain

### `mobile/src/components/JiraConnectPrompt.tsx` (2)
- 23: {unavailableReason ? 'Update Orca desktop' : 'Connect Jira on your desktop'}
- 29: : 'Add your Jira site in Orca desktop under Settings → Integrations, then check again.')}

### `mobile/src/components/MobileDiffReviewDrawers.tsx` (1)
- 117: ? { hint: 'Update Orca on your computer' }

### `mobile/src/components/ProtocolBlockScreen.tsx` (1)
- 81: ? { label: `Get Orca ${mobileUpdate.version}`, url: mobileUpdate.url }

### `mobile/src/diagnostics/connection-diagnostics-analysis.ts` (1)
- 84: nextStep: 'Orca is re-dialing to check the connection. Keep the app open while it retries.',

### `mobile/src/diagnostics/connection-diagnostics-report.ts` (1)
- 52: `Host Orca version: ${desktopAppVersion ?? (args.state === 'connected' ? 'unknown' : 'unknown (not currently connected)')}`

### `mobile/src/dictation/mobile-dictation-setup.ts` (1)
- 42: export const SPEECHLESS_SERVER_MESSAGE = 'Update Orca on this server to use voice dictation.'

### `mobile/src/files/MobileMediaPlayback.tsx` (1)
- 13: setFailure('Update Orca Mobile to play media in this workspace')

### `mobile/src/files/mobile-file-media-download.ts` (1)
- 71: throw new Error('Update Orca on your desktop to preview media files on mobile')

### `mobile/src/home/AppUpdateCard.tsx` (2)
- 11: const title = `Orca ${props.version} is available`
- 34: accessibilityLabel={`Dismiss Orca ${props.version} update`}

### `mobile/src/host-route-notice.ts` (1)
- 42: return `Update Orca on ${hostLabel} to open its workspaces from your phone.`

### `mobile/src/host-screen/workspace-details-sheet.tsx` (1)
- 108: return 'Created from Orca CLI'

### `mobile/src/mobile-web-shell/bridge/bridge-client-errors.ts` (1)
- 96: super('this app version cannot send extra request fields; update the Orca app')

### `mobile/src/session/QuickCommandEditorForm.tsx` (1)
- 152: ? 'Too long for this host. Update Orca on the host to save longer prompts.'

### `mobile/src/session/mobile-existing-agent-launch.ts` (1)
- 36: 'Update Orca on your computer to start an agent from your phone.'

### `mobile/src/session/mobile-markdown-disk-fallback.ts` (1)
- 17: : 'Editing needs Orca desktop running.'

### `mobile/src/session/mobile-new-tab-agent-loader.ts` (1)
- 35: 'This workspace runs on another Orca server. Pair that server directly to see its agents.'

### `mobile/src/session/use-mobile-structured-prompt-responses.ts` (1)
- 102: onSendError('Update Orca on your computer to send answers this long')

### `mobile/src/settings/app-update-settings-rows.tsx` (2)
- 40: accessibilityLabel={`Update to Orca ${available.version}`}
- 44: <Text style={styles.rowLabel}>Update to Orca {available.version}</Text>

### `mobile/src/tasks/jira-mobile-connection.ts` (1)
- 26: return { ...DISCONNECTED, unavailableReason: 'Update Orca desktop to browse Jira on mobile.' }

### `mobile/src/terminal/document/message-bridge.ts` (2)
- 66: if (document.fonts && !document.fonts.check('13px "Orca Nerd Font Symbols"', '\ue0b0')) {
- 122: document.fonts.load('13px "Orca Nerd Font Symbols"', '\ue0b0'),

### `mobile/src/terminal/document/text-scaling.ts` (1)
- 53: '"Menlo", "Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Orca Nerd Font Symbols", "Symbols Nerd Font Mono", monospace'

### `mobile/src/terminal/terminal-nerd-font-css.mjs` (1)
- 5: "font-family:'Orca Nerd Font Symbols';",

### `resources/native-chat-visuals/.claude-plugin/plugin.json` (1)
- 4: "description": "Teaches an Orca chat agent to show charts, diagrams and mockups inline in the chat."

### `resources/native-chat-visuals/skills/orca-chat-visuals/SKILL.md` (5)
- 3: description: Show a chart, diagram, table, report or mockup inline in this Orca chat as an HTML
- 9: # Inline visuals in an Orca chat
- 11: Orca can show an HTML page inside your reply. Use one whenever a visual would make the answer
- 25: - Don't size anything to the viewport height (`100vh`); Orca fits the frame to your content.
- 26: - Optional: Orca's theme colors are available as CSS variables (`--background`, `--foreground`,

### `skill-guides/jira-tickets.md` (2)
- 4: Read and update Jira tickets through Orca's saved Jira connections. Use when
- 11: Resolve the Orca executable using this skill's discovery stub, then load `ORCA skills get orca-jira` for current command and site-selection details. `ORCA` below is a placeholder for that executable.

### `skill-guides/orca-jira.md` (7)
- 4: Jira issue work through Orca's CLI. Use when working from a linked Jira
- 11: # Orca Jira
- 91: `--to` matches either the transition name or the destination status name, case-insensitively. When it matches none, the error lists every available transition — read that list rather than guessing. Us
- 116: Orca's Jira CLI has no attach subcommand. Put the PR/MR link in the completion comment instead.
- 145: Configure credentials in Orca Settings. `ORCA jira connection --json` lists saved site IDs; it does not test access or agent MCP authentication. These commands use credentials on the selected executio
- 151: Run `ORCA jira project list`, `ORCA jira project types --project <key>`, and `ORCA jira project fields --project <key> --type <id> --json` before creating an issue. `--project` accepts a project ID or
- 157: Do not retry create or comment writes blindly after a timeout or lost connection. The API might have applied the write before the response was lost; read the issue or verify in Jira first. Orca does n

### `skill-guides/orchestration/references/recovery-and-cleanup.md` (1)
- 138: worker, it retains an owned terminal by the same rule as `worker-retain`, so Orca

### `skill-guides/orchestration/references/worker-contract.md` (1)
- 6: Orca host adds `--dispatch-capability`).

### `src/cli/agent-launch-recovery.ts` (2)
- 68: 'Orca could not confirm the launch outcome; the agent may already be running and the prompt may already be submitted.',
- 78: ? error.message.replace(/\bRestart Orca and try again\./g, '')

### `src/cli/agent-launch-request.ts` (3)
- 111: 'This Orca host cannot start an agent as a chat or a terminal on request. Update Orca on the execution host, or omit --surface.'
- 138: 'This Orca host cannot safely carry launch prompts. Update Orca on the execution host.'
- 147: 'This Orca host cannot honor CLI launch focus or background behavior. Update Orca on the execution host.'

### `src/cli/agent-session-search-format.ts` (1)
- 86: return 'This host does not support history search for the selected agent. Update Orca on that host or select another agent.'

### `src/cli/bundled-skill-guides.ts` (6)
- 21: const JIRA_TICKETS_MARKDOWN = "---\nname: jira-tickets\ndescription: >-\n  Read and update Jira tickets through Orca's saved Jira connections. Use when\n  a task comes from Jira or the user asks for J
- 48: const ORCA_JIRA_MARKDOWN = "---\nname: orca-jira\ndescription: >-\n  Jira issue work through Orca's CLI. Use when working from a linked Jira\n  issue, finishing work with a PR/MR link and a completion
- 78: const ORCHESTRATION_FULL_MARKDOWN = "---\nname: orchestration\ndescription: >-\n  Coordinate supervised Axiom workers: threaded messages, blocking ask/reply,\n  task dispatch, worker_done/escalation w
- 96: const ORCHESTRATION_RECOVERY_AND_CLEANUP_REFERENCE_MARKDOWN = "# Recovery and cleanup\n\nLoad this reference only after a failed/stopped/unknown attempt, explicit retry\ndecision, stop/abandon request
- 113: description: "Read and update Jira tickets through Orca's saved Jira connections. Use when a task comes from Jira or the user asks for Jira ticket work. Treat ticket text, comments and labels as untru
- 153: description: "Jira issue work through Orca's CLI. Use when working from a linked Jira issue, finishing work with a PR/MR link and a completion comment, moving an issue through Jira workflow transition

### `src/cli/command-scoped-flag-help.ts` (1)
- 3: "--focus                Bring the user to the file (switches Orca's window to its worktree)"

### `src/cli/handlers/account-list-format.ts` (1)
- 40: account.needsSignIn ? ' (sign in again in Orca Settings > AI Provider Accounts)' : ''

### `src/cli/handlers/agent-launch.ts` (1)
- 41: 'This Orca host cannot start agents from the CLI. Update Orca on the execution host.'

### `src/cli/handlers/connector.ts` (1)
- 34: 'This Orca host has no connectors. Update Orca on the host and try again.'

### `src/cli/handlers/data-account-commands.ts` (1)
- 25: 'Update or restart this Orca host to manage OpenCode and Devin accounts.'

### `src/cli/handlers/file-open-call.ts` (2)
- 6: 'This Orca server has no app window, so it cannot open files as tabs. Nothing was opened.'
- 34: 'Open the file from the file explorer of an Orca app or mobile app connected to this server.',

### `src/cli/handlers/file.ts` (2)
- 201: `Did not open ${target}: the Orca app declined this ${result.kind} file.`,
- 202: { nextSteps: ['Update the Orca app, which opens every file type the File Explorer does.'] }

### `src/cli/handlers/jira.ts` (1)
- 67: 'Saved Orca Jira connections; this does not verify access or agent MCP authentication.'

### `src/cli/handlers/managed-server.ts` (2)
- 26: 'This Orca runtime cannot manage servers over SSH. Run this on the computer whose Orca desktop app deployed the server, after updating Orca there.'
- 104: const reason = result.reason ?? `The managed Orca server action was ${result.outcome}.`

### `src/cli/handlers/orchestration/terminal-identity.ts` (2)
- 245: 'an Orca terminal, its shell_environment_policy removed it, and relaunching the same way ' +
- 246: 'will not restore it. Start Codex by typing `codex` in an Orca terminal, or set ' +

### `src/cli/handlers/project.ts` (1)
- 110: 'This Orca server cannot pick a project setup by host yet. Update Orca on the server and try again.'

### `src/cli/handlers/reference.ts` (1)
- 40: 'This Orca host does not support reference commands yet. Update Orca on the execution host.'

### `src/cli/handlers/serve-restore.ts` (1)
- 41: `This host refused ${count} from an older Orca client and kept them here:`,

### `src/cli/handlers/skills.ts` (1)
- 175: 'Could not read the commit this Orca CLI was built from, so there is no source to install skills from.'

### `src/cli/handlers/speech.ts` (1)
- 61: 'This Orca server cannot store a voice dictation key yet. Update Orca on the server and try again.'

### `src/cli/handlers/terminal-daemon.ts` (1)
- 45: 'Terminal daemon: unverifiable — this Orca server does not report whether it is running.'

### `src/cli/handlers/worktree-create-agent-launch.ts` (1)
- 60: 'This Orca host cannot start an agent on a chosen model or effort. Update Orca on the execution host, or omit --model and --effort.'

### `src/cli/handlers/worktree-setup-decision-recovery.ts` (1)
- 32: 'This launch was refused before creation. Remove --retry-launch for the changed request so Orca uses a new launch ID.'

### `src/cli/jira-target.ts` (2)
- 42: 'Update Orca on the execution host to use verified Jira commands.'
- 58: ? 'No matching connected Jira site. Check orca jira connection and Orca Jira settings.'

### `src/cli/reference-input.ts` (1)
- 100: 'This Orca host cannot merge reference changes safely. Update Orca on the execution host.'

### `src/cli/runtime/runtime-source-fence.ts` (3)
- 64: `Could not confirm that the running Orca is the one that launched this terminal: ${response.error.message}`
- 71: 'The running Orca does not report which profile it serves, so this terminal cannot confirm it is the Orca that launched it. Nothing was sent. Open a new terminal from the Orca you want to control.'
- 77: 'The running Orca is not the one that launched this terminal (another profile or instance took over its runtime record). Nothing was sent. Open a new terminal from the Orca you want to control.'

### `src/cli/runtime/serve-app-launcher.ts` (5)
- 24: "This `orca` command isn't running from an installed Orca app. On a host Orca reaches over SSH, it belongs to that connection's server and can't start one of its own."
- 27: return `${NOT_AN_APP_CLI} Install the Orca app on this machine and run \`${appCliName(platform)} serve\` from a plain login shell, or set ORCA_APP_EXECUTABLE to the Orca app executable.`
- 32: return `Could not find the installed Orca app's \`${name}\` command on PATH. ${NOT_AN_APP_CLI} Install the Orca app on this machine, then run \`${name} serve service install\` from a plain login shell
- 69: `--command points at a launcher tied to one Orca version, which the next update replaces: ${explicit}. Pass the installed Orca app's \`${appCliName(deps.platform)}\` instead.`
- 84: ? `Could not find the \`${name}\` command on PATH. Install it from Orca Settings, or pass --command <absolute path>.`

### `src/cli/runtime/serve-appimage-update.ts` (1)
- 94: deps.log(`[serve] ${watch.appImagePath} holds a new Orca build; restarting from it.`)

### `src/cli/runtime/serve-electron-preflight.ts` (1)
- 76: const lead = `[serve] Orca is already running for this userData profile as ${who}`

### `src/cli/runtime/serve-install-hold.ts` (4)
- 16: 'bundle-missing': 'the Orca executable is missing, likely mid-install',
- 17: 'installer-running': "macOS's updater (ShipIt) is replacing this Orca app",
- 19: "could not check whether macOS's updater (ShipIt) is replacing this Orca app",
- 20: 'install-park': 'the Orca desktop app paused this server to install an update'

### `src/cli/runtime/serve-pid1-init-reaper.ts` (1)
- 36: '[serve] Orca is PID 1 and cannot reap orphaned processes, so they stay zombies. Run it under an init (docker run --init, tini, or bash).'

### `src/cli/runtime/serve-recipe-json.ts` (2)
- 90: ? `Orca serve exited before printing valid recipe JSON with code ${code}.`
- 91: : `Orca serve exited before printing valid recipe JSON via ${signal}.`

### `src/cli/runtime/serve-service-unit.ts` (1)
- 64: const logPath = join(input.homeDir, 'Library', 'Logs', 'Orca', `${name}.log`)

### `src/cli/runtime/serve-supervised-service.ts` (5)
- 222: `[serve] Waiting before starting Orca serve: ${SERVE_INSTALL_HOLD_REASON_TEXT[evidence.reason]}.`
- 230: '[serve] The Orca executable this service started from is gone; exiting so the service manager starts the installed Orca.'
- 278: `[serve] Another Orca serves this profile; checking again in ${Math.round(delayMs / 1000)}s.`
- 288: .replace(/^Orca serve /, '')
- 300: `[serve] Orca serve ${failure}; restarting in ${Math.max(1, Math.round(next.action.delayMs / 1000))}s.`

### `src/cli/runtime/serve-supervisor-brake.ts` (1)
- 60: const reason = `Orca serve failed ${failures.length} times in ${SERVE_SUPERVISOR_FAILURE_WINDOW_MS / 60_000} minutes; the supervisor stopped restarting it. Last failure: ${input.reason}`

### `src/cli/specs/agent-launch.ts` (1)
- 23: '--surface chat|terminal picks for this launch instead of your setting. --surface terminal always runs the agent CLI; --surface chat is refused when Orca can establish before starting anything that th

### `src/cli/specs/managed-server.ts` (10)
- 5: '--environment names a managed Orca server this machine deployed over SSH (see `orca environment list`); it is a selector here, not a routing flag.'
- 7: 'Runs on this machine’s Orca desktop app, the same action as Settings > Orca on your SSH hosts. A runtime without the SSH registry (headless `orca serve`) refuses it.'
- 12: summary: 'Show a managed Orca server’s active version, terminals and pending work',
- 20: summary: 'Update a managed Orca server to this build’s version',
- 33: summary: 'Roll a managed Orca server back to its previous version',
- 40: summary: 'Finish or undo a managed Orca server’s interrupted update, rollback or stop',
- 45: 'When a rejected build changed profile state, recover refuses rather than restart the previous build over it. --accept-changed-state --yes restores the prelaunch snapshot instead, the same as Restore
- 57: summary: 'Stop a managed Orca server and unlink it from this machine (decommission)',
- 72: summary: 'Unlink a managed Orca server whose SSH host is gone, without stopping it',
- 85: summary: 'Withdraw a managed Orca server stop that orcad has not acted on yet',

### `src/cli/specs/terminal-daemon.ts` (2)
- 12: 'The daemon is reported live, exited, or unverifiable. Orca starts a new daemon with the next terminal after one exits, so exited between a crash and that terminal is expected.',
- 14: 'On Linux AppImage, a daemon started by an earlier Orca can outlive the files it runs from. Orca keeps it so its terminals keep running, but new terminals are not kept across restarts until it is rest

### `src/cli/specs/terminal-set-pane-title.ts` (1)
- 11: 'Requires the running Orca desktop; headless pane title changes are not supported.',

### `src/cli/specs/worktree-set.ts` (1)
- 6: summary: 'Update Orca metadata for a worktree',

### `src/cli/worktree-project-target.ts` (1)
- 204: 'Missing repo selector. Pass --repo or run from inside an Orca-managed worktree.'

### `src/main/acp/acp-agent-connection.ts` (1)
- 142: super.close(new AcpConnectionClosedError('The agent printed a sign-in link Orca cannot read'))

### `src/main/acp/acp-dialects/grok-requests.ts` (1)
- 103: 'Orca showed your plan to the user. Stop here and wait for their feedback or a request to implement it in a later turn.'

### `src/main/acp/acp-structured-session.ts` (1)
- 133: ? `${session.spec.agent} ACP agent closed by Orca`

### `src/main/agent-hooks/README.md` (9)
- 3: Orca learns what each agent is doing through two channels. Both write into the hook server's
- 9: | **OSC 7501** (Program Status Protocol, [spec](https://www.superlogical.com/rex/docs/build/program-status)) | The agent writes its own status into the terminal stream. Orca reads it from PTY output a
- 32: terminal answered queries the way Orca does.
- 37: anything (Orca answers).
- 43: | Agent                  | Verified                                  | Probe                                      | States   | Kinds                | `msg` content
- 53: | Agent                                                                                  | Checked                             | Orca integration           |
- 65: ¹ Claude Code stops putting its `⠂`/`✳` status glyph in the window title once Orca answers the
- 71: paints, a client answers for a remote Orca host only when that host advertises
- 85: 2. If its `app` id differs from Orca's agent id, add the mapping to `APP_TO_AGENT_TYPE` in

### `src/main/agent-hooks/hook-post-command.ts` (1)
- 21: `  ${indent}-H "X-Orca-Agent-Process: \${orca_agent_process:-}" \\`,

### `src/main/ai-vault/structured-chat-conversation-copy.ts` (1)
- 28: throw new Error('This chat is no longer in Orca, so it cannot be copied to a new CLI.')

### `src/main/antigravity/antigravity-chat-account.ts` (1)
- 72: "Antigravity's sign-in link can't be captured on this host. Restart Orca and try again."

### `src/main/antigravity/native-credential-backend.ts` (1)
- 85: 'Antigravity has a keyring fallback marker; Orca cannot verify which credential store agy will use.'

### `src/main/antigravity/windows-hook-json-post.ts` (1)
- 51: 'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN

### `src/main/automations/dispatch-refusal.ts` (2)
- 30: "This automation's project is moving to its WSL host, so Orca skipped this run. Runs resume when the move finishes."
- 34: "This automation's project now runs on its WSL host, which runs this automation there. Orca no longer runs this local copy."

### `src/main/automations/run-target-resolution.ts` (1)
- 61: 'This automation was saved before Orca tracked which host it runs on, and its project is on more than one host. Open the automation and pick the host it should run on.'

### `src/main/browser/agent-input-focus-guard.ts` (2)
- 23: "Orca could not protect the user's keyboard focus for this page, so the input was not sent. Retry, or show the page first."
- 32: 'The user is typing with an input method in Orca, so the input was not sent to keep their unfinished text. Retry in a moment.'

### `src/main/browser/desktop-browser-bridge/desktop-browser-bridge-executor.ts` (2)
- 103: 'The Orca desktop stopped sharing its browser before this command ran.'
- 184: 'Run this command inside a workspace on this host, or pass --worktree, so Orca knows which workspace’s browser tabs it may use.'

### `src/main/claude-accounts/claude-account-selection.ts` (1)
- 26: "Orca couldn't delete this Claude account's folder. Quit any Claude running in this account, then remove it again."

### `src/main/claude-accounts/claude-profile-wsl-router.ts` (1)
- 292: throw new Error('The bundled WSL Claude account helper is missing. Reinstall Orca.')

### `src/main/cli/cli-command-filesystem-transaction.ts` (1)
- 176: `The command at ${args.commandPath} changed while Orca inspected it.`

### `src/main/codex/codex-background-terminals.ts` (1)
- 102: throw new Error('codex app-server listed more background terminals than Orca reads')

### `src/main/codex/codex-hook-hash-lookup.ts` (2)
- 74: failure: 'Orca has not asked Codex yet'
- 154: failure: `Orca could not find Codex at ${codexPath}`,

### `src/main/codex/codex-hook-status.ts` (5)
- 130: const reason = answer?.failure ?? 'Orca has not asked Codex yet'
- 135: return status('partial', true, `Orca's hook entry is installed, but ${reason}`)
- 148: ? status('installed', true, `Approved by Orca; not yet confirmed by Codex (${reason})`)
- 149: : status('partial', true, `Orca's hook entry is not approved yet (${reason})`)
- 240: ? `${home.tomlPath} keeps hook approvals inline, so Orca cannot add its own there; Orca shows no status for ~/.codex until they are tables`

### `src/main/codex/codex-hook-trust-derivation.ts` (4)
- 75: `${describeCodexVersion(codexVersion)} hashes Orca's status hook differently by its file or position, so Orca does not approve it`
- 82: failure: `${describeCodexVersion(codexVersion)} listed no hooks from Orca's test home`
- 86: return refused(`${describeCodexVersion(codexVersion)} did not recognize Orca's status hook`)
- 92: `${describeCodexVersion(codexVersion)} is too old for Orca status; update Codex`

### `src/main/codex/config-toml-trust.ts` (1)
- 165: `${configPath} defines hook approvals in a form Orca cannot add to without breaking it`

### `src/main/computer/computer-provider-unavailable-message.ts` (1)
- 11: return `Computer use isn't available on this host: its Orca install has no ${runtime}. On an Orca server installed before computer use shipped with it, update or reprovision the server.`

### `src/main/computer/sidecar-client.ts` (1)
- 106: return `Computer use isn't available on this host: its Orca install has no computer-use sidecar (${entryPath}). On an Orca server installed before computer use shipped with it, update or reprovision t

### `src/main/credentials/saved-credential-readability.ts` (1)
- 82: `The ${credentialName} on this computer was saved by another Orca app here, which this one cannot read. Change it in that app, or forget it here first.`

### `src/main/daemon/daemon-liveness-report.ts` (1)
- 76: detail: `pid ${record.pid} is gone; Orca starts a new daemon with the next terminal`,

### `src/main/daemon/macos-daemon-bundle.ts` (1)
- 11: export const MAC_TERMINAL_HOST_BUNDLE = 'Orca Terminal Host.app'

### `src/main/dsh/dsh-home-patch.ts` (1)
- 17: const START_MARKER = '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>'

### `src/main/dsh/hook-service.ts` (3)
- 118: 'The DSH home patch is a flow-style sequence ([…]); rewrite it as a block sequence (one `- ` entry per line) so Orca can add its hooks without breaking it'
- 136: return status(configPath, 'error', 'Could not read Orca managed hooks file')
- 150: : `The Orca patch block points at ${pointer}, not the Orca managed hooks file`

### `src/main/fish-xdg-data-dirs-handoff.ts` (1)
- 56: return `# Orca-generated. Loaded only because Orca put this directory on

### `src/main/folder-repo-git-conversion.ts` (1)
- 102: 'The project changed while Orca was checking it, so its type was not changed. Try again.'

### `src/main/git/saved-clone-target.ts` (4)
- 146: `"${saved.displayName}" is already an Orca project at ${saved.path}, and Orca couldn't confirm that folder is a clone of this URL: ${
- 148: ? 'Orca has that project recorded as a different repository'
- 149: : 'Orca has no record of which repository that project holds, so it cannot tell whether the folder is missing or holds something else'
- 150: }. Remove the project from Orca or choose another folder.`

### `src/main/host/serve-keychain-guard.ts` (1)
- 34: `[secrets] Secrets are unavailable for this run: ${reason}. Orca will not use the keychain until it restarts, so sealed settings such as a saved proxy URL are not applied. Start orca serve from a logg

### `src/main/ipc/runtime-environments/orcad-delta-move-handlers.ts` (2)
- 37: throw new Error('This host’s Orca server is no longer registered.')
- 76: throw new Error('This SSH host has no changes from an older Orca to resolve.')

### `src/main/ipc/runtime-environments/runtime-environment-managed-pairing-refusal.ts` (1)
- 60: '[runtime-environments] Could not re-pair the managed Orca server:',

### `src/main/ipc/runtime-environments/runtime-environment-unreachable-hint.ts` (1)
- 21: ? `${message} The Orca server in the WSL distro ${host.deployment.distro} isn’t answering; connect it again in Settings → Remote Orca Servers → WSL hosts.`

### `src/main/ipc/ssh/ssh-host-sleep-reconnect.ts` (1)
- 32: `[ssh] Failed to recover a managed Orca tunnel after system resume: ${errorMessage(err)}`

### `src/main/ipc/ssh/ssh-target-crud-handlers.ts` (1)
- 103: 'Orca runs on this host. Use Stop… under Settings › Orca on your SSH hosts to stop it and remove it from the host first, or Forget… there if the host is gone.'

### `src/main/jira/cloud-gateway.ts` (1)
- 7: headers: { Accept: 'application/json', 'User-Agent': 'Orca' }

### `src/main/kiro/hook-service.ts` (2)
- 81: return `No custom Kiro agents in ${agentsDir}. Kiro's built-in default agent cannot carry hooks; create one with \`kiro-cli agent create\` and make it the default so Orca can track Kiro's status`
- 150: problems.push(`${file.fileName} has no Orca hooks`)

### `src/main/macos-update-running-instances.ts` (1)
- 39: throw new Error('Could not check running Orca instances')

### `src/main/managed-data-accounts/service.ts` (1)
- 299: throw new Error('Managed account path is outside Orca account storage.')

### `src/main/managed-server/activation/orcad-activation-fence-hold.ts` (1)
- 55: reason: `Another run is changing this host’s Orca server, so the ${attempt} did not start. It is retried on a later connect.`

### `src/main/managed-server/host-state/orcad-machine-home.ts` (2)
- 320: : 'the older Orca server there recorded only a hostname, which does not identify its machine'
- 322: `Orca can't tell which machine set up the Orca server in ~/${RELAY_REMOTE_DIR}: ` +

### `src/main/managed-server/host-state/orcad-state-snapshot-space.ts` (2)
- 110: : 'Orca cannot start its server on this host until then.'
- 114: ? ` (plus ${formatKb(space.reclaimKb)} Orca would reclaim from earlier snapshots)`

### `src/main/managed-server/host-state/orcad-state-snapshot.ts` (1)
- 188: 'snapshot_fail "$m holds a symbolic link or an entry Orca cannot read: $links";',

### `src/main/managed-server/install/orcad-remote-context.ts` (1)
- 63: throw new OrcadHostUnsupportedError('Orca’s server doesn’t support this SSH host’s platform.')

### `src/main/managed-server/install/orcad-remote-windows-node.ts` (1)
- 51: `Orca cannot pass ${JSON.stringify(value)} to node.exe on this Windows host: it contains ` +

### `src/main/managed-server/install/remote-install-out-of-space.ts` (1)
- 28: `${formatKb(availableKb)} free, and Orca needs about ${formatKb(neededKb)} to install ` +

### `src/main/managed-server/lifecycle/orcad-managed-bound-port.ts` (1)
- 93: '[ssh] Could not read the managed Orca server port; trying the preferred one:',

### `src/main/managed-server/lifecycle/orcad-managed-launch-session.ts` (5)
- 84: return { outcome: 'not-restarted', reason: 'This host has no activated Orca server.' }
- 123: : `This host’s Orca server stopped but did not start again (${wake.outcome}); reconnect to start it.`
- 143: 'This host’s Orca server restarted, but its terminals still belong to an SSH session ' +
- 203: return { state: 'kept', reason: 'This host has no activated Orca server.' }
- 222: 'This host’s Orca server restarted, but its terminal daemon kept running because a terminal ' +

### `src/main/managed-server/lifecycle/orcad-managed-pairing-repair-failure.ts` (3)
- 8: `${ORCAD_PAIRING_REPAIR_FAILED_CODE}: the Orca server on this host no longer accepts this ` +
- 9: `computer, and Orca couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
- 10: `was stopped; its terminals can't be verified until Orca pairs again. Connect again to retry.`

### `src/main/managed-server/lifecycle/orcad-managed-pairing-repair.ts` (1)
- 275: "the server hasn't published a pairing Orca can read"

### `src/main/managed-server/lifecycle/orcad-managed-runtime-context.ts` (3)
- 37: throw new Error('SSH is unavailable on this client; this host’s Orca server is unverifiable.')
- 45: throw new Error('SSH target state is unavailable; this host’s Orca server is unverifiable.')
- 74: throw new Error('The SSH registration for this host’s Orca server is no longer valid.')

### `src/main/managed-server/lifecycle/orcad-managed-serving.ts` (6)
- 39: export const MANAGED_ORCAD_NOT_ACTIVATED_DETAIL = 'This host has no activated Orca server to start.'
- 148: console.info(`[ssh] Started the managed Orca server on ${label}; ${cause}.`)
- 157: const detail = 'This host’s Orca server process is live but is not answering.'
- 158: console.warn(`[ssh] The managed Orca server on ${label} is not answering: ${detail}`)
- 162: console.warn(`[ssh] The managed Orca server on ${label} is not answering: ${detail}`)
- 165: console.warn(`[ssh] Could not start the managed Orca server on ${label}:`, error)

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-active.ts` (4)
- 88: throw new Error('SSH is unavailable on this client; this host’s Orca server is unverifiable.')
- 92: throw new Error('The SSH registration for this host’s Orca server was removed or re-created.')
- 95: throw new Error('The SSH target is no longer owned by this host’s Orca server.')
- 152: super('Orca SSH tunnel setup was superseded.')

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-identity.ts` (3)
- 41: `host’s Orca server (another Orca may be using that port): ${detail}`
- 54: `${ORCAD_PAIRING_REJECTED_CODE}: this host’s Orca server no longer accepts ` +
- 143: : { verdict: 'foreign', detail: 'This host’s Orca server published an invalid pairing.' }

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-manager.ts` (3)
- 138: throw new Error('Managed Orca SSH target has no registration generation.')
- 157: label: 'Orca on this host',
- 297: label: `Orca on ${environment.name}`,

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-pairing-recovery.ts` (1)
- 40: console.warn('[managed-orcad] The Orca server refused this desktop; pairing again:', error)

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-resume.ts` (1)
- 214: label: `Orca on ${current.environment.name}`,

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-serving.ts` (1)
- 30: return { state: 'unverifiable', detail: 'The tunnel to this host’s Orca server is not up.' }

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-target.ts` (3)
- 54: console.warn('[ssh] Could not start the managed Orca server behind a foreign answer:', error)
- 128: `[ssh] Managed Orca server did not answer through its tunnel: ${identity.detail}`
- 161: throw new Error('Managed Orca tunnel bound an unexpected local port.')

### `src/main/managed-server/lifecycle/orcad-managed-tunnel-transport.ts` (2)
- 78: console.warn(`[ssh] Managed Orca server tunnel takes the stdio bridge: ${outcome.failure}`)
- 137: `The tunnel to this host’s Orca server has no route: ${forwardFailure}, and there is no stdio bridge.`

### `src/main/managed-server/lifecycle/orcad-managed-update-decision.ts` (2)
- 107: : `Orca ${record.activeAppVersion} last ran this host's server, newer than this ` +
- 108: `Orca (${appVersion}). Update Orca to start it.`

### `src/main/managed-server/lifecycle/orcad-managed-update-on-restore.ts` (1)
- 93: console.warn('[ssh] Could not redeploy a stopped managed Orca server:', error)

### `src/main/managed-server/lifecycle/orcad-runtime-conversion.ts` (1)
- 191: return refuse('live', 'orcad_migration_already_managed', 'Orca already runs on this SSH host.')

### `src/main/managed-server/lifecycle/orcad-runtime-deployment.ts` (3)
- 98: throw new Error('The SSH registration for this host’s Orca server has no durable generation.')
- 101: throw new Error('The saved Orca server for this host has a stale SSH target generation.')
- 124: throw new Error('This host’s Orca server has no active runtime version.')

### `src/main/managed-server/lifecycle/orcad-runtime-target.ts` (1)
- 23: `No Orca runtime supports ${facts.target} with glibc ${glibc}.`

### `src/main/managed-server/lifecycle/orcad-stdio-bridge-provider.ts` (1)
- 77: console.warn('[ssh] Orca stdio bridge check was unverifiable:', error)

### `src/main/minimax/minimax-credential-commands.ts` (1)
- 89: 'MiniMax session cookies need the Orca desktop app on this computer. Save an API key instead.'

### `src/main/native-chat/agent-session-journal/journal-database.ts` (1)
- 76: `chat journal ${dbPath} uses unreleased schema ${stored}, written by an unreleased development build of Orca. Orca can't load its chats. Moving the file aside lets Orca start a new one, but that loses

### `src/main/native-chat/agent-session-journal/journal-open-failure.ts` (1)
- 36: `journal of ${sessionId} holds a newer Orca's row at sequence ${load.newer.sequence}`

### `src/main/native-chat/agent-session-journal/journal-store-restore.ts` (1)
- 27: `agent-session journal for ${host.identity.sessionId} is in a newer Orca's database`

### `src/main/native-chat/agent-session-wire/structured-agent-session-child-close.ts` (3)
- 46: reason: 'closed by Orca',
- 58: "Orca could not prove this chat's previous agent process exited."
- 89: context.deps.logger.warn("the agent's process did not exit after Orca stopped and killed it", {

### `src/main/native-chat/structured-chat-naming.ts` (1)
- 143: failure = { error: 'Orca could not run the chat-name agent.' }

### `src/main/network/http-client.ts` (1)
- 50: `${providerLabel} usage from a session cookie needs the Orca desktop app and is not available on this server`

### `src/main/node-runtime/linux-libc-probe.ts` (1)
- 7: super('Could not identify the host C library for the bundled Orca runtime')

### `src/main/node-runtime/pinned-runtime-materializer.ts` (1)
- 114: `Orca uploads ${archive.label} to the host from this computer, so the host doesn't need ` +

### `src/main/node-runtime/runtime-archive-download.ts` (1)
- 70: ? `The ${label} download didn't match the release Orca expects, so nothing was installed. Updating Orca may fix this.`

### `src/main/orcad/launcher.ts` (1)
- 20: throw new Error('The Orca server does not match its launcher')

### `src/main/orcad/orcad-command-arguments.ts` (1)
- 9: export const ORCAD_USAGE = `orcad — the Orca runtime served without Electron.

### `src/main/orcad/orcad-instance-lock.ts` (4)
- 257: 'Orca cannot check from here whether it is still running, because this data root may be ' +
- 329: const holder = existing.role === 'desktop' ? 'the Orca desktop app' : 'orcad'
- 334: `${existing.acquiredAt}, does not record which boot it came from, so Orca cannot tell ` +
- 350: return record.role === 'desktop' ? 'The Orca desktop app' : 'Another orcad'

### `src/main/orcad/orcad-local-serve-selection.ts` (1)
- 87: return electron('this Orca install carries no orcad template')

### `src/main/orcad/orcad-secret-protection-gap.ts` (4)
- 7: `${ORCAD_PLAINTEXT_SECRETS_ENV}=plaintext is set, so Orca's headless server stores ` +
- 14: "Orca's headless server is running from a temporary profile, so it stores credentials " +
- 26: "Orca's headless server seals credentials with a key kept beside them in its private " +
- 34: `Orca's headless server cannot unseal its credentials: ${reason}. Saved credentials are kept ` +

### `src/main/orcad/orcad-secret-store.ts` (1)
- 51: return "Orca's headless server has not loaded its credential key yet."

### `src/main/persistence/migrating-orcad-catalog/orcad-source-scrollback-state.ts` (1)
- 76: `saved terminal history Orca could not read for tab ${tabId}`

### `src/main/persistence/migrating-orcad-catalog/orcad-source-workspace-session.ts` (1)
- 58: const UNREADABLE_SESSION = 'saved tabs Orca could not read'

### `src/main/persistence/profile-state/legacy-json/README.md` (1)
- 21: Before using a JSON-only build, stop Orca and run the current bundled CLI's

### `src/main/persistence/profile-state/profile-state-section-repair.ts` (2)
- 76: `Orca can't repair this profile one section at a time (${reason}). Nothing was changed. Run \`orca profile state exports\` and restore a whole backup with \`orca profile state rollback --backup <id>\`
- 122: `Orca replaced the damaged sections, but the profile still can't be opened (${error instanceof Error ? error.message : String(error)}). The profile as it was before the repair is kept in ${quarantineD

### `src/main/persistence/profile-state/profile-state-startup-failure.ts` (1)
- 73: `Stop Orca, then run \`orca profile state rollback --repair --profile-id ${error.profileId}\` to replace only the damaged parts from backups and keep everything else. Orca keeps a copy of the damaged

### `src/main/persistence/profile-state/profile-state-startup-recovery-dialog.ts` (3)
- 130: 'Orca will forget your projects and their workspace details. Files on disk are not touched.',
- 134: 'Projects added after that backup will be removed from Orca, along with their workspace details. Files on disk are not touched.',
- 151: 'Orca keeps a copy of the damaged file in its data folder, then restarts.'

### `src/main/provisioned-root-checkout.ts` (2)
- 83: throw new Error("The recipe projectRoot is not checked out on Orca's requested branch.")
- 89: throw new Error("The recipe projectRoot was not created from Orca's requested ref.")

### `src/main/rate-limits/antigravity-usage-fetcher.ts` (1)
- 30: 'Antigravity usage is not available. This version of the Antigravity CLI answers `/usage` as a prompt instead of a command, so Orca stopped asking rather than spend quota on it. Update `agy` and resta

### `src/main/runtime/agent-session-store-transactions.ts` (1)
- 78: 'the chat records were saved by a newer Orca; this host reads them and never writes'

### `src/main/runtime/agent-state-rules/omp.json` (1)
- 9: "why": "Its `π - <session>` rest title is Pi's title anchor (pi.json), which every pane reads. Orca writes an explicit `OMP ready` title at rest, while a shell auto-title names OMP from launch, mid-tu

### `src/main/runtime/agent-state-rules/opencode.json` (1)
- 16: "why": "OpenCode owns its session title, so Orca writes no `ready` title over it; its name is its only other rest sign, so it settles once held, with no quiet asked.",

### `src/main/runtime/agent-state-rules/pi.json` (1)
- 16: "why": "Orca writes an explicit `Pi ready` title at rest, while a shell auto-title names Pi from launch, mid-turn too, so a bare name counts only once quiet (#6011).",

### `src/main/runtime/agent-state-rules/unknown-pane.json` (1)
- 9: "why": "An adopted pane can run Codex without Orca knowing it. Codex's loaded 0.150-0.157 header on the live screen, with no blocker below it, settles such a pane at once (unlike a Codex pane, which h

### `src/main/runtime/browser/browser-client-page-opening.ts` (1)
- 45: "No paired Orca desktop is hosting browser pages for this server. On a desktop paired with it, open a browser tab in one of this server's workspaces, then retry. The desktop needs an Orca version that

### `src/main/runtime/desktop-browser-bridge/desktop-browser-bridge-registry.ts` (1)
- 176: 'The Orca desktop stopped sharing its browser before it answered.'

### `src/main/runtime/desktop-browser-bridge/remote-cli-browser-scope.ts` (2)
- 53: 'The Orca desktop stopped sharing its browser before this command ran.'
- 142: 'The Orca desktop stopped sharing its browser while this command ran.'

### `src/main/runtime/mobile-desktop-relay/delegated-phone-grants.ts` (1)
- 54: 'Remote Orca runtime returned an invalid delegated device sync.'

### `src/main/runtime/mobile-desktop-relay/mobile-desktop-relay.ts` (1)
- 229: throw unavailable('The server needs an Orca update to open its workspaces from a phone.')

### `src/main/runtime/orchestration/db/worker-dispatch/worker-dispatch-start.ts` (1)
- 102: `Task ${task.id} failed ${prior.failure_count} times, so Orca will not retry it again (last error: ${prior.last_failure ?? 'unknown'}). Report the failure to the user instead of retrying.`,

### `src/main/runtime/orchestration/orchestration-party.ts` (1)
- 101: `Agent session ${party.orcaSessionId} is a chat, and a chat is identified only by the Orca session ID its own environment sends, never by naming it. No effects were applied.`,

### `src/main/runtime/project-removal-impact.ts` (1)
- 72: return `This project has ${parts.join(' and ')}. Removing it detaches those terminals from Orca and deletes the saved workspace details. Re-run with --force to remove it anyway.`

### `src/main/runtime/rpc/methods/managed-runtime-install.ts` (1)
- 27: throw new Error(`Orca installs no runtime for ${agent}.`)

### `src/main/runtime/rpc/methods/orchestration/caller-show.ts` (1)
- 43: `${params.sessionId} is not an Orca session ID.`,

### `src/main/runtime/rpc/methods/orchestration/chat-assignee-admission.ts` (1)
- 67: `${formatOrcaSessionAddress(args.sessionId)} is this coordinator's own Orca session ID. ${args.remedy}`

### `src/main/runtime/rpc/methods/orchestration/messaging/session-recipient.ts` (4)
- 57: message: `${recipient} does not name an Orca session ID. No message was sent.`
- 84: message: `Agent session ${sessionId} cannot be verified: this Orca is not running its agent-session host. ${noEffect}`
- 94: message: `No Orca agent session ${sessionId} exists on this host. ${noEffect}`
- 135: message: `${id} is the provider's own session id, which changes on /clear. This session's Orca session ID is ${address}; address it by that instead. ${noEffect}`

### `src/main/runtime/rpc/runtime-source-admission.ts` (2)
- 33: 'This Orca does not know which profile it serves, so it cannot confirm it is the Orca that launched this terminal. Nothing was run.'
- 41: 'This request was meant for another Orca (another profile or instance). Nothing was run. Open a new terminal from the Orca you want to control.'

### `src/main/runtime/runtime-artifact-controller.ts` (1)
- 54: throw new Error("Artifact sharing isn't available on this Orca server.")

### `src/main/runtime/runtime-linear-comment-commands.ts` (1)
- 279: `Linear may have applied the comment ${verb}, but Orca could not confirm it.`,

### `src/main/runtime/runtime-project-host-setup-controller.ts` (1)
- 73: "This Orca server can't add projects on its SSH hosts. Add the SSH host on your computer to open its projects."

### `src/main/runtime/runtime-skill-command-surface.ts` (1)
- 45: throw new Error("Skill sharing isn't available on this Orca server.")

### `src/main/runtime/workspaces/workspace-removal-target.ts` (1)
- 297: throw new Error('Pane titles require a running Orca desktop with set-pane-title support')

### `src/main/ssh/legacy-relay/README.md` (1)
- 5: Orca 1.4.224 kept SSH terminals alive inside a `relay.js --detached` process on the host.

### `src/main/ssh/legacy-relay/legacy-relay-cli-caller.ts` (2)
- 20: "Orca could not confirm this terminal is one of this host's supervised Orca terminals, so its " +
- 165: `A terminal started by an older version of Orca can reach only its own orchestration, and ${subject} is outside it.`

### `src/main/ssh/legacy-relay/legacy-relay-cli-server.ts` (4)
- 52: 'This terminal was started by an older version of Orca. Its orca orchestration commands reach ' +
- 53: 'this desktop only when "Allow this host\'s orca CLI to control Orca" is on for this host in ' +
- 57: 'This terminal was started by an older version of Orca, so only orca orchestration check, ' +
- 61: 'This terminal was started by an older version of Orca. It runs orca orchestration check, ' +

### `src/main/ssh/legacy-relay/legacy-relay-client.ts` (2)
- 28: 'This terminal was started by an older version of Orca, so orca commands are unavailable ' +
- 56: super('Another Orca client is attached to this relay')

### `src/main/ssh/managed-server-fence-recheck.ts` (1)
- 67: console.warn('[ssh] Could not recheck the managed Orca server:', error)

### `src/main/ssh/managed-server-update-check.ts` (1)
- 49: console.warn('[ssh] Could not check the managed Orca server for an update:', error)

### `src/main/ssh/orcad-initial-activation-admission.ts` (1)
- 86: 'Stop that Orca runtime before converting this data root to Orca’s server on the host.'

### `src/main/ssh/orcad-installed-activation.ts` (3)
- 218: 'was stopped. Orca will try the update again.'
- 232: `${fenced.stopped.reason} No snapshot was taken and the candidate was not started. Orca ` +
- 268: `${reason ? `: ${reason}` : ''}. Orca's persisted state carries no schema version, so ` +

### `src/main/ssh/orcad-interrupted-candidate-resume.ts` (1)
- 63: `An older Orca left version ${transaction.candidateVersion} running without finishing ` +

### `src/main/ssh/orcad-migration-catalog-client.ts` (2)
- 46: 'orcad_migration_destination_extra_agent_args_unsupported:Update Orca on this host to use extra arguments.'
- 49: 'orcad_migration_destination_source_kind_unsupported:Update Orca on this host to move this project to it.'

### `src/main/ssh/orcad-migration-catalog-reference-client.ts` (1)
- 17: 'orcad_migration_destination_abort_by_reference_unsupported:Update Orca on this host to cancel this move.'

### `src/main/ssh/orcad-migration-conflict-guidance.ts` (7)
- 23: `Terminals an older version of Orca started in ${terminals[1]} are still running, and this ` +
- 24: 'host’s Orca server already has that project from another Orca desktop. Close them or ' +
- 32: 'A terminal an older version of Orca started on this host is still running, and Orca can’t ' +
- 34: `then reconnect. Or, to use this host’s Orca server’s copy of ${unowned[1]}, remove that ` +
- 46: `This host’s Orca server already has a project at ${subject}, which another Orca desktop ` +
- 52: 'This host’s Orca server already has one of this desktop’s projects with different ' +
- 58: 'This host’s Orca server already holds different saved state for something this desktop ' +

### `src/main/ssh/orcad-migration-cutover-coordinator.ts` (1)
- 276: reason: 'This host’s Orca server already holds this migration; it can only move forward.'

### `src/main/ssh/orcad-migration-manifest-export.ts` (1)
- 169: `This SSH host's saved state is too large to move to its Orca server (limit ` +

### `src/main/ssh/orcad-migration-refusal-reason.ts` (1)
- 42: `saved state Orca could not read (${blocker.sources.map((kind) => DEPENDENCY_WORDS[kind]).join(', ')})`

### `src/main/ssh/orcad-migration-source-fence.ts` (3)
- 40: 'Move anyway needs every terminal on this host closed first, and Orca could not confirm they all exited. Close them, or end them on the host, then connect again.'
- 238: return 'Orca already runs on this SSH host.'
- 240: return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s Orca server first.'

### `src/main/ssh/orcad-remote-node-runtime-report.ts` (2)
- 25: ? `The host is missing ${missing}, which Orca's Node runtime needs. ` +
- 37: storeDir = 'Orca’s runtime folder'

### `src/main/ssh/orcad-retained-source.ts` (1)
- 314: console.warn('[ssh] Could not reconcile managed Orca server hosts:', error)

### `src/main/ssh/orcad-running-version-adoption.ts` (1)
- 53: `Orca ${record.active} runs this host's server, but its process state is unverifiable, ` +

### `src/main/ssh/orcad-runtime-maintenance.ts` (1)
- 94: console.warn('[ssh] Could not forward to the relaunched managed Orca server:', error)

### `src/main/ssh/orcad-ssh-provisioning.ts` (2)
- 90: 'This host already has Orca projects, so it was restored as a direct SSH host. ' +
- 91: 'Orca can only be set up on an empty host.'

### `src/main/ssh/orcad-stdio-bridge.ts` (2)
- 42: throw new OrcadHostUnsupportedError('Orca’s server doesn’t support this SSH host’s platform.')
- 109: `The SSH host could not run the stdio bridge for this host’s Orca server: ${detail}`

### `src/main/ssh/orcad-terminal-census-client.ts` (1)
- 93: throw new Error('This host’s Orca server does not report a terminal census.')

### `src/main/ssh/orcad-tunneled-pairing.ts` (3)
- 12: `This host’s Orca server did not publish a pairing offer: ${readiness.pairing.guidance}`
- 19: throw new Error('This host’s Orca server published an invalid pairing offer.')
- 26: throw new Error('The pairing endpoint of this host’s Orca server is not loopback-only.')

### `src/main/ssh/plain-ssh-terminal/plain-ssh-terminal-sessions.ts` (2)
- 62: ? 'Orca couldn’t find OpenSSH (ssh.exe) on this computer. Install “OpenSSH Client” in Windows Settings > System > Optional features, then try again.'
- 63: : 'Orca couldn’t find ssh on this computer. Install the OpenSSH client, then try again.'

### `src/main/ssh/runtime-ssh-access.ts` (1)
- 50: return `This SSH target is still used by saved Orca state: ${dependentStateSummary(blocker.dependencies)}. Remove it, or link SSH access through an SSH target with nothing saved.`

### `src/main/ssh/ssh-host-server-on-connect.ts` (3)
- 252: console.warn('[ssh] Managed Orca server setup failed:', error)
- 317: console.warn(`[ssh] Managed Orca server setup deferred (${result.code}):`, result.reason)
- 338: console.warn('[ssh] The managed Orca server setup keeps its fence:', error)

### `src/main/ssh/ssh-host-unserved-status.ts` (10)
- 27: 'Orca paused moving this host’s projects to its Orca server because it couldn’t confirm the server’s copy. Nothing is lost: the host keeps its projects and stays locked until the move finishes. Connec
- 30: 'This host doesn’t allow running programs from ~/.orca-remote, so Orca can’t start its server there. This usually means the home folder is mounted with noexec. Ask the host’s administrator to allow ru
- 33: 'Orca lost contact with this host while setting up its server. Nothing on the host was stopped. Connect again to continue.'
- 37: 'Neither this computer nor this host could download Node.js, which Orca’s server needs. Set a Node.js download mirror in Settings > Advanced > Network, or check the network on both machines, then conn
- 41: 'Neither this computer nor this host could download Node.js, which Orca’s server needs. Check the network or proxy on both machines, then connect again.'
- 53: : 'This SSH host isn’t supported by this version of Orca. To keep using it, install an older version of Orca.'
- 56: return 'Terminals started by an older version of Orca are still running on this host, and they don’t stop on their own. Close them in that version of Orca or end them on the host, then reconnect.'
- 58: return decision.detail ?? 'Orca couldn’t set up its server on this host.'
- 60: return 'This computer has projects or folders for this host that its Orca server doesn’t have yet, often added by an older version of Orca. Move them to this host’s Orca server in SSH Hosts settings t
- 68: : 'Orca couldn’t start its server on this host. Try connecting again.'

### `src/main/ssh/system-transport/system-ssh-muxed-forward-cancel.ts` (1)
- 90: `[ssh] Cancelled a forward a previous Orca left on 127.0.0.1:${localPort}, held by its ControlMaster`

### `src/main/ssh/system-transport/system-ssh-orphaned-forward.ts` (1)
- 191: `[ssh] Stopping a forward a previous Orca left on 127.0.0.1:${localPort} (pid ${orphan.pid})`

### `src/main/ssh/targets/ssh-target-orcad-claims.ts` (2)
- 265: return 'This SSH target owns repositories or folder workspaces. Orca can only be set up on a host with no direct SSH projects yet; keep this host in direct SSH mode.'
- 273: return `Orca could not read its saved ${blocker.sources.join(', ')} state, so it cannot show this SSH target is unused; the target was left in direct SSH mode.`

### `src/main/ssh/targets/ssh-target-orcad-dependents.ts` (1)
- 186: 'This SSH target is still referenced by saved Orca state that this host’s Orca server cannot take ' +

### `src/main/ssh/targets/ssh-target-registry.ts` (1)
- 28: "This Orca server runs without the desktop app, so it can't manage SSH hosts yet."

### `src/main/startup/cli-launch-redirect.ts` (1)
- 162: `[serve] Serving in-process; could not start the Orca CLI: ${error instanceof Error ? error.message : String(error)}\n`

### `src/main/startup/ensure-virtual-display.ts` (2)
- 121: 'Orca serve needs an X display for its browser panes, and could not start its own.',
- 122: `Wayland alone is not enough. To let Orca start one, ${XVFB_INSTALL_GUIDANCE}`,

### `src/main/startup/serve-user-data-path-guard.ts` (1)
- 26: return `[serve] orca serve chose the profile at ${expected}, but this launch resolved ${options.userDataPath}; refusing to start so it cannot touch another profile's running Orca.`

### `src/main/startup/single-instance-lock.ts` (1)
- 89: return `[single-instance] Another Orca dev instance is already running on the profile at ${options.userDataPath}; exiting this launch after passing it this launch's request. To run another dev copy at

### `src/main/startup/windows-app-data-path.ts` (1)
- 22: 'Orca could not find the Windows roaming AppData folder: Windows did not report it, and neither APPDATA nor USERPROFILE is set.'

### `src/main/updater/serve-supervisor-install-park.ts` (5)
- 189: throw new Error('An Orca server started again before the install began.')
- 194: throw new Error('Paused Orca serve services resumed before the install began.')
- 224: return `Background orca serve services (process IDs: ${pids}) did not pause for the update in time. Orca remains open; retry the update, or stop those services first.`
- 227: return 'Another Orca window is already installing this update. Orca remains open; retry in a minute.'
- 229: return `Close the other Orca instances (process IDs: ${pids}) before installing this update. Background orca serve instances also need to stop. Orca remains open; retry the update after closing them.`

### `src/main/updater/updater-install-execution.ts` (1)
- 159: 'macOS has not finished preparing the update. Orca keeps serving and installs it once ready; restart the Orca service if it never does.',

### `src/main/updater/updater-mac-install-preflight.ts` (1)
- 34: 'Could not check for other running Orca instances. Orca remains open. Try again. If the check keeps failing, close the other Orca instances and background orca serve servers, then quit Orca to let the

### `src/main/window/dragged-temp-file-copy.ts` (1)
- 237: console.debug('[drop] copied a drag-temp file into Orca storage', { bytes: size })

### `src/main/window/workspace-space-window.ts` (1)
- 48: title: 'Orca Space Beta',

### `src/main/worktree-removal-leftover.ts` (1)
- 39: `A different checkout is now at ${worktreePath}; Orca left it in place. Delete it again to remove it.`

### `src/main/worktree-removal-table.ts` (1)
- 74: `Orca is still deleting the workspace at ${removal.worktreePath}. Cleanup is pending; try again shortly.`

### `src/main/wsl/wsl-host-add-admission.ts` (2)
- 8: 'This build of Orca can’t run WSL hosts (server files missing).'
- 15: return `The WSL host ${distro} isn’t connected. Open one of its projects or connect it in Settings → Remote Orca Servers.`

### `src/main/wsl/wsl-host-connector.ts` (1)
- 51: new Error(`${distro} is no longer a WSL host; Orca will not start anything for it.`)

### `src/main/wsl/wsl-host-e2e-fake-connector.ts` (1)
- 67: throw new Error(`${distro} is no longer a WSL host; Orca will not start anything for it.`)

### `src/main/wsl/wsl-host-server-stop.ts` (4)
- 56: problems.push(`Orca couldn’t list the host’s terminals: ${errorMessage(error)}`)
- 79: problems.push(`Orca’s server kept running: ${result.reason}`)
- 81: problems.push('Orca’s server stopped, but its terminal daemon is still running.')
- 155: 'the orcad this computer was connected to is not the one the distro records as active, so Orca could not prove it stopped.'

### `src/main/wsl/wsl-host-ssh-orcad-conflict.ts` (1)
- 66: message: `${distro} already runs the Orca server for “${sharing.name}”, which this computer reaches over SSH. Remove that server first; moving it to a WSL host isn’t supported yet.`

### `src/main/wsl/wsl-orcad-connection.ts` (1)
- 267: label: `Orca server in WSL: ${label}`

### `src/main/wsl/wsl-orcad-deploy.ts` (1)
- 136: `The WSL 1 distro ${name} isn’t supported by Orca’s server. ` +

### `src/main/wsl/wsl-orcad-incumbent.ts` (1)
- 80: label: `Orca server in WSL: ${target.label} (update check)`

### `src/main/wsl/wsl-orcad-instance-adoption.ts` (1)
- 223: 'Another Orca is changing this distro’s server, so an unrecorded orcad cannot be adopted now.'

### `src/main/wsl/wsl-orcad-liveness-recovery.ts` (1)
- 43: reason: `Could not restart the Orca server in ${context.distro} after ${decision.attempts} attempts`,

### `src/main/wsl/wsl-orcad-pairing-identity.ts` (2)
- 68: `[wsl] Orca server in ${launch.distro} did not answer its bridge: ${identity.detail}`
- 84: : { verdict: 'foreign', detail: 'The Orca server in WSL published an invalid pairing offer.' }

### `src/main/wsl/wsl-pinned-runtime.ts` (1)
- 43: `${PINNED_NODE_GLIBC_FLOOR.major}.${PINNED_NODE_GLIBC_FLOOR.minor}, which Orca's Node runtime needs.`

### `src/packages/process-host/README.md` (1)
- 1: # Orca process host

### `src/packages/process-host/package.json` (1)
- 5: "description": "Orca host subprocess execution, cancellation, and termination",

### `src/renderer/src/components/NativeChatResumeRunPanel.tsx` (4)
- 35: 'These chats were working when Orca installed an update. Orca restored each one where it stopped, with its full context, and asked the agent to check what it was doing before carrying on. Your own pro
- 39: 'These chats were working when Orca closed. Orca restored each one where it stopped, with its full context, and asked the agent to check what it was doing before carrying on. Your own prompts weren’t
- 45: 'These chats were working when Orca installed an update. The ones Orca resumed were restored where they stopped, with their full context, and asked to check what they were doing before carrying on. Yo
- 49: 'These chats were working when Orca closed. The ones Orca resumed were restored where they stopped, with their full context, and asked to check what they were doing before carrying on. Your own prompt

### `src/renderer/src/components/OrcaSignInProgress.tsx` (1)
- 13: console.warn('Could not copy the Orca sign-in link:', error)

### `src/renderer/src/components/UpdateErrorCardContent.tsx` (3)
- 136: aria-label={translate('updates.installBlock.instancesLabel', 'Instances using Orca')}
- 147: ? translate('updates.installBlock.windowLabel', 'Other Orca window')
- 148: : translate('updates.installBlock.instanceLabel', 'Other Orca instance')}

### `src/renderer/src/components/activity/activity-scope-filter-controls.tsx` (1)
- 72: 'Hide agents in workspaces created from other Orca clients on shared remote servers'

### `src/renderer/src/components/browser-pane/assemble-chrome/browser-page-context-menu-items.tsx` (1)
- 160: 'Open Link In Orca Browser'

### `src/renderer/src/components/browser-pane/assemble-chrome/browser-toolbar-page-display-items.tsx` (1)
- 146: 'Match Orca'

### `src/renderer/src/components/github-project/ProjectBoard.tsx` (1)
- 117: 'This board view has no single-select or iteration field to group by, so Orca is listing items instead.'

### `src/renderer/src/components/jira-issue-transition-control.tsx` (1)
- 145: 'Jira requires fields Orca cannot collect yet: {{fields}}.',

### `src/renderer/src/components/maintenance/update-card/UpdateCardStateContent.tsx` (1)
- 101: 'Checking running Orca instances before restarting.'

### `src/renderer/src/components/maintenance/update-card/update-card-error-model.ts` (1)
- 61: 'Orca stays open. No need to download again.'

### `src/renderer/src/components/maintenance/update-card/update-install-block-guidance.ts` (9)
- 11: title: translate('updates.installBlock.busyTitle', 'Another Orca is updating'),
- 14: 'An update is already being installed by another Orca instance.'
- 27: 'Orca could not finish pausing its background servers for the update.'
- 41: "A background Orca server's browser is still using this app."
- 45: 'End the process below, then retry: its server keeps running without a browser. If another computer uses this Mac as an SSH host, updating Orca there lets the browser pause for updates on its own.'
- 58: 'A background Orca server is still using this app.'
- 62: 'Another Orca instance is still using this app.'
- 72: 'Close any other Orca windows and stop the server from the terminal or service that started it. Connected devices will disconnect. Then retry.'
- 76: 'Quit other Orca instances, then retry. Your downloaded update will be kept ready.'

### `src/renderer/src/components/managed-runtime/managed-runtime-install-view.ts` (1)
- 114: ? translate('components.managed-runtime.installManaged', "Install Orca's copy")

### `src/renderer/src/components/mobile/mobile-relay-mint-failure-notice.tsx` (2)
- 60: 'Orca Relay isn’t included with this Orca account.'
- 89: 'Orca Relay is busy. Wait a minute and retry, or use LAN to pair over Tailscale or the same Wi‑Fi.'

### `src/renderer/src/components/native-chat/NativeChatApprovalCard.tsx` (1)
- 167: 'This request needs a newer version of Orca.'

### `src/renderer/src/components/native-chat/NativeChatComposerActions.tsx` (1)
- 220: "This draft couldn't be saved yet. Orca keeps trying."

### `src/renderer/src/components/native-chat/NativeChatCopyOrcaSessionIdMenuItem.tsx` (5)
- 17: throw new Error('no Orca session ID')
- 23: 'Orca session ID copied'
- 30: 'Unable to copy Orca session ID'
- 42: 'Copy Orca Session ID'
- 49: "Orca's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through Orca."

### `src/renderer/src/components/native-chat/native-chat-orca-stop-words.ts` (4)
- 12: 'Orca on {{machine}} restarted for an update while this response was in progress.',
- 18: 'Orca on {{machine}} was closed while this response was in progress.',
- 24: 'Orca on {{machine}} stopped unexpectedly while this response was in progress.',
- 33: 'Orca on {{machine}} stopped while this response was in progress.',

### `src/renderer/src/components/native-chat/native-chat-rewind-copy.ts` (3)
- 51: "Orca couldn't confirm whether the conversation went back to an earlier message. It checks before your next message is sent."
- 61: "Orca couldn't go back to this message. Check the conversation before continuing."
- 76: "Orca couldn't confirm whether the conversation went back to this message. Your message is back in the composer, and Orca checks the conversation before your next message is sent."

### `src/renderer/src/components/onboarding/OnboardingLanguageSwitcher.tsx` (1)
- 187: 'Which language would you like Orca to support?'

### `src/renderer/src/components/plain-ssh-terminal/OpenPlainSshTerminalButton.tsx` (1)
- 39: 'Keeps you working on the host while Orca can’t set up there.'

### `src/renderer/src/components/plain-ssh-terminal/PlainSshTerminalPanels.tsx` (1)
- 19: 'Plain SSH — unmanaged. Not an Orca workspace: agents and tabs here aren’t tracked, and this terminal isn’t restored. Closing it ends the SSH session.'

### `src/renderer/src/components/plain-ssh-terminal/PlainSshTerminalView.tsx` (4)
- 42: 'This SSH host is no longer saved in Orca.'
- 47: 'Orca can reach this host again, so use its terminals instead. Plain SSH is only for while Orca can’t set up on the host.'
- 52: 'Another Orca window already has a plain SSH terminal open to this host.'
- 152: 'Orca couldn’t open a terminal here.'

### `src/renderer/src/components/right-sidebar/AiVaultPanelSearch.tsx` (1)
- 124: 'This computer does not support history search for the selected agent. Update Orca on that computer or select another agent.'

### `src/renderer/src/components/settings/AgentPermissionsSetting.tsx` (1)
- 99: {translate('settings.agents.autoUnsupported', 'Auto needs a newer Orca on this host.')}

### `src/renderer/src/components/settings/AntigravityAccountsSection.tsx` (1)
- 312: 'Antigravity chats run a server Orca downloads to this host, separate from the agy CLI.'

### `src/renderer/src/components/settings/CustomAgentCommandField.tsx` (1)
- 35: 'to pass the command input as an argument; otherwise Orca pipes it on stdin.'

### `src/renderer/src/components/settings/JiraIssueKeyCasingSetting.tsx` (1)
- 22: 'Casing of the Jira issue key in the workspace and branch names Orca suggests for new Jira-linked workspaces, such as PROJ-123-fix-login instead of proj-123-fix-login. Existing workspaces and names yo

### `src/renderer/src/components/settings/ManagedDataAccountsSection.tsx` (2)
- 98: 'Add accounts by running this command in a terminal on the Orca host. Selection applies to new explicit agent launches on that host; direct SSH relay and Windows-hosted WSL launches use their own cred
- 132: 'If accounts do not appear, update or restart the Orca host.'

### `src/renderer/src/components/settings/MobileRelaySignInPanel.tsx` (1)
- 30: 'Signs this desktop in to Orca and routes the phone through Orca’s servers. LAN does not need an account.'

### `src/renderer/src/components/settings/NodeDistMirrorDialog.tsx` (2)
- 104: 'Orca’s server needs Node.js, and neither this computer nor this host could download it from nodejs.org. A mirror is a copy of nodejs.org/dist that Orca tries first on both machines.'
- 136: 'Each download is still checked against the checksum Orca pins for this Node.js release. Saved to Settings > Advanced > Network.'

### `src/renderer/src/components/settings/NodeDistMirrorSettingField.tsx` (1)
- 77: 'Optional. A copy of nodejs.org/dist that Orca uses first when it installs Node on SSH and WSL servers. Each file is still checked against the release Orca expects.'

### `src/renderer/src/components/settings/RemoteServerUpdateStatus.tsx` (1)
- 110: 'Remote updates are unavailable for this server. Update Orca on the server host.'

### `src/renderer/src/components/settings/RepositoryRemoveProjectButton.tsx` (3)
- 14: 'Remove this checkout from Orca. Other checkouts of this project stay.'
- 20: 'Remove this project from Orca. Checkouts that have their own settings stay.'
- 25: 'Remove this project from Orca on all configured hosts.'

### `src/renderer/src/components/settings/RuntimeEnvironmentsPane.tsx` (1)
- 250: 'Orca couldn’t load SSH hosts and unfinished moves. Reopen Settings to try again.'

### `src/renderer/src/components/settings/RuntimeHostAccessFailureAlert.tsx` (2)
- 15: 'The reached Orca host does not match this access link'
- 25: 'Orca versions are not compatible'

### `src/renderer/src/components/settings/RuntimeRepairDialog.tsx` (1)
- 137: '{{name}} no longer accepts this computer. On {{name}}, open Settings → Remote Orca Servers → Share this computer, create a link for another Orca, then paste it here.',

### `src/renderer/src/components/settings/SshHostAdvancedFields.tsx` (3)
- 116: "Allow this host's orca CLI to control Orca"
- 122: "On by default for new hosts. Lets orca commands run on this host open and drive Orca browser tabs on this desktop, only in this host's workspaces and only while it is connected, and lets terminals st
- 137: "Allow this host's orca CLI to control Orca"

### `src/renderer/src/components/settings/SshHostDeltaMoveDialog.tsx` (1)
- 98: 'An older version of Orca changed this host after its projects moved to Orca on the host. This adds what it created to the server; it never merges over what the server already has.'

### `src/renderer/src/components/settings/SshHostKeepServerVersionDialog.tsx` (1)
- 72: 'This host keeps using its Orca server as it is. What the older version of Orca added or changed here is not moved; it stays only in this computer’s saved settings until they are cleaned up.'

### `src/renderer/src/components/settings/SshHostMoveAnywayAction.tsx` (1)
- 89: 'Orca sets itself up on {{host}} without the saved items below. They stay on this computer and don’t appear on {{host}}. Unsaved edits are kept, never deleted.',

### `src/renderer/src/components/settings/SshHostRestartServerAction.tsx` (4)
- 77: {translate('auto.components.settings.restartServer.title', 'Restart Orca’s server')}
- 82: 'Orca restarts its server on this host from your current connection. It restarts only when no terminals are running on the host, because terminals that are still open stay cut off. Close them first.'
- 107: 'Orca couldn’t confirm whether terminals are running on this host, so it didn’t restart Orca’s server.'
- 112: '{{count}} terminals are still running on this host. Close them, then restart Orca’s server.',

### `src/renderer/src/components/settings/SshManagedHostRemoveDialog.tsx` (2)
- 48: 'Orca runs on {{label}}. In Remote Orca Servers, open the ⋯ menu on {{label}} and choose Stop… to remove Orca from the host, or Forget… if the host is gone. Then you can remove this SSH host.',
- 60: 'Open Remote Orca Servers'

### `src/renderer/src/components/settings/SshRestoreRemovedHostsDialog.tsx` (1)
- 80: 'Hosts from ~/.ssh/config that you removed in Orca come back in Settings and in every host picker.'

### `src/renderer/src/components/settings/SshTargetCard.tsx` (1)
- 223: {translate('auto.components.settings.SshTargetCard.orcaServer', 'Orca server')}

### `src/renderer/src/components/settings/SshTargetList.tsx` (2)
- 34: return <>{translate('auto.components.settings.SshTargetList.addedInOrca', 'Added in Orca')}</>
- 114: 'Select all hosts added in Orca'

### `src/renderer/src/components/settings/SshTargetServerStatus.tsx` (1)
- 94: {translate('auto.components.settings.restartServer.action', 'Restart Orca’s server…')}

### `src/renderer/src/components/settings/TerminalPane.tsx` (2)
- 133: 'Choose what Orca opens for new local terminal panes.'
- 193: 'Enter a shell name on PATH or an executable path. Orca starts it as a login shell.'

### `src/renderer/src/components/settings/TerminalWindowsAdministratorSection.tsx` (6)
- 117: 'Permissions for the Orca app. Existing terminals may differ.'
- 178: 'Canceling Windows’ prompt reopens Orca with its retained terminals. SSH and WSL permissions stay controlled on their hosts.'
- 188: 'Save your work, close all local terminal sessions, then exit Orca.'
- 195: 'Open Orca normally from the Windows Start menu.'
- 199: 'In the Windows Start menu, right-click Orca and choose Run as administrator. Approve the Windows prompt using your usual account.'
- 215: 'Orca could not restart. Try again or use the manual instructions.'

### `src/renderer/src/components/settings/UnsealedCredentialNotice.tsx` (1)
- 37: '{{credential}} is stored unencrypted — this system has no OS keyring Orca can use. Anyone who can read your disk or a backup of it can read the credential. Install and unlock gnome-keyring or kwallet

### `src/renderer/src/components/settings/WslHostsSection.tsx` (1)
- 127: 'Orca runs a server inside each distro. A stopped distro starts only when you open one of its projects or connect it here.'

### `src/renderer/src/components/settings/ZcodePlanAccountsSection.tsx` (4)
- 158: 'Plan credential details are only readable on the computer running Orca.'
- 195: 'Orca reads the selected Coding Plan from the ZCode CLI credential store on this computer. Save an API key below to link the plan here instead.'
- 199: 'Orca reads the selected Coding Plan from the ZCode CLI credential store on {{host}}. Save an API key below to link the plan there instead.',
- 253: 'Change the plan site and API key in the desktop app on the computer running Orca.'

### `src/renderer/src/components/settings/accounts-pane-claude-section.tsx` (1)
- 229: 'System default is signed in as {{value0}}, which is also a saved account. An earlier Orca version may have copied that login there. If it is not your own login, select System default and run claude /

### `src/renderer/src/components/settings/accounts-pane-minimax-credentials.tsx` (1)
- 233: '{{host}} has no Orca desktop app to send a session cookie from. Save an API key instead.',

### `src/renderer/src/components/settings/accounts-pane-opencode-credentials.tsx` (1)
- 53: 'Optional override. Orca otherwise uses the key OpenCode saved when you ran /connect, then OPENCODE_API_KEY.'

### `src/renderer/src/components/settings/agent-awake-copy.ts` (1)
- 67: 'Orca also asks this device to stay awake when the lid is closed, subject to its power policy.'

### `src/renderer/src/components/settings/agent-workspace-trust-copy.ts` (2)
- 7: 'Trust the folder when Orca starts an agent'
- 14: 'Agents Orca starts skip their "Do you trust this folder?" prompt, so the project\'s agent hooks and settings run right away. Without this, each agent asks the first time it runs in a folder. Agents r

### `src/renderer/src/components/settings/chat-behavior-search.ts` (1)
- 18: 'When Orca quits or installs an update, chats that were working are automatically resumed when Orca is reopened.'

### `src/renderer/src/components/settings/codex-terminal-server-isolation-copy.ts` (1)
- 14: "Keeps Orca's status and closing tabs working correctly. Turn off to use Codex's shared server and its agents overview. Applies to new terminals."

### `src/renderer/src/components/settings/git-search.ts` (1)
- 26: 'Casing of the Jira issue key in the workspace and branch names Orca suggests for new Jira-linked workspaces, such as PROJ-123-fix-login instead of proj-123-fix-login. Existing workspaces and names yo

### `src/renderer/src/components/settings/managed-server-copy.ts` (4)
- 71: 'Orca already runs on this SSH host.'
- 103: 'Orca could not read its saved {{sources}}, so it cannot tell what would move.',
- 159: 'Not done: Orca couldn’t confirm what is running on this server. Try again when the host is reachable.'
- 176: 'Orca couldn’t finish this on the server. Try again.'

### `src/renderer/src/components/settings/managed-server-row-parts.tsx` (3)
- 67: 'Orca on this host: {{version}}',
- 194: 'Stops Orca on the SSH host and removes it from this list.'
- 273: 'Update Orca on this host'

### `src/renderer/src/components/settings/runtime-install-server-dialog.tsx` (10)
- 72: 'Orca is set up on {{name}}.',
- 103: 'Setting up Orca on {{name}} in the background. It appears in the list when it’s ready.',
- 128: 'Set up Orca on an SSH host'
- 136: 'Orca installs itself on an empty SSH host and keeps itself up to date.'
- 143: 'Runs on each host, reached over your own SSH connection. Your code and files stay where they are. Only Orca’s list of projects, tabs and terminals moves to the host.'
- 160: 'Choose an SSH host without Orca'
- 167: 'No SSH hosts without an Orca server.'
- 171: 'Only hosts without an Orca server.'
- 188: 'Orca couldn’t load SSH hosts and unfinished moves. Reopen Settings to try again.'
- 224: 'Setting up Orca on {{host}}…',

### `src/renderer/src/components/settings/runtime-server-row-details.tsx` (2)
- 59: 'Orca couldn’t reach this server.'
- 74: 'Check that Orca is running on the server and that this computer can reach its address.'

### `src/renderer/src/components/settings/runtime-server-row-meta.ts` (1)
- 110: 'Update Orca on the server host'

### `src/renderer/src/components/settings/runtime-server-row-state.ts` (1)
- 114: "{{value0}} no longer accepts this computer, and Orca couldn't pair with it again over SSH. Connect to try again.",

### `src/renderer/src/components/settings/runtime-servers-header-actions.tsx` (3)
- 116: 'Pair with Orca already running on another machine.'
- 125: 'Set up Orca on an SSH host'
- 129: 'Orca installs itself on an empty SSH host and keeps itself up to date.'

### `src/renderer/src/components/settings/runtime-ssh-access-dialog.tsx` (1)
- 38: 'Use this when the server isn’t reachable directly. Orca opens a tunnel through an SSH host.'

### `src/renderer/src/components/settings/ssh-bulk-remove-summary.ts` (1)
- 43: '{{label}} has an Orca server.',

### `src/renderer/src/components/settings/terminal-windows-search.ts` (1)
- 10: 'See Orca’s Windows permissions or restart with administrator approval.'

### `src/renderer/src/components/settings/usage-credential-host.ts` (3)
- 44: 'Update Orca on {{host}} to save this key there.',
- 69: 'Saved by another Orca app on {{host}}, which this one cannot read. Change it in that app, or forget it here.',
- 74: 'Orca on {{host}} cannot read the saved key. Replace it or forget it.',

### `src/renderer/src/components/settings/use-zcode-plan-credentials.ts` (1)
- 81: 'GLM Coding Plan keys can only be changed in the desktop app on the computer running Orca.'

### `src/renderer/src/components/settings/wsl-hosts-experimental-search.ts` (1)
- 11: 'Add a WSL 2 distro as a host. Orca runs its server inside the distro, so git, files and terminals in new projects there run natively in Linux.'

### `src/renderer/src/components/sidebar/AddWslHostFormPanel.tsx` (2)
- 71: 'Orca runs its server inside the distro, so git, files and terminals run natively in Linux. Use it for new projects; projects you opened through \\\\wsl.localhost keep working as they are.'
- 150: 'Installing and starting the Orca server in the distro. The first time can take a minute.'

### `src/renderer/src/components/sidebar/SeveredTerminalDaemonBanner.tsx` (2)
- 54: 'Orca could not verify the terminal service process, so nothing was stopped.'
- 145: 'The terminal service on this computer started from an AppImage that is no longer mounted. It still runs {{sessions}}, but it can crash at any moment. Until you restart it, new terminals are not kept

### `src/renderer/src/components/sidebar/sleep-worktree-flow.ts` (1)
- 32: "Orca couldn't tell which host runs this workspace's terminals, so the workspace was kept open. Reconnect its hosts and try again."

### `src/renderer/src/components/sidebar/workspace-filter-option-row.tsx` (1)
- 103: 'Hide workspaces created from other Orca clients on shared remote servers'

### `src/renderer/src/components/sidebar/worktree-open-failure-toast.ts` (1)
- 117: 'It may have been moved or deleted. Refresh workspaces or remove it from Orca.'

### `src/renderer/src/components/sidebar/wsl-host-row-status.ts` (1)
- 79: 'This build of Orca can’t run WSL hosts (server files missing).'

### `src/renderer/src/components/skills/SkillUpdateRow.tsx` (3)
- 37: 'Installed from {{value0}}. Selecting it replaces it with Orca’s version.',
- 42: 'No Orca install record for this copy. Selecting it replaces it with Orca’s version.'
- 73: {translate('auto.components.skills.SkillUpdateRow.notFromOrca', 'Not from Orca')}

### `src/renderer/src/components/skills/skill-freshness-summary-headline.tsx` (2)
- 89: '1 skill not installed by Orca is unselected.'
- 93: '{{value0}} skills not installed by Orca are unselected.',

### `src/renderer/src/components/status-bar/NativeChatResumeStatusSegment.tsx` (1)
- 134: 'Chats Orca resumed after the restart. Click to see them.'

### `src/renderer/src/components/status-bar/ResourcePtyDetails.tsx` (4)
- 28: toast.success(translate('resourceManager.pty.idCopied', 'Orca session ID copied'))
- 30: toast.error(translate('resourceManager.pty.copyFailed', 'Could not copy Orca session ID'))
- 41: [translate('resourceManager.pty.sessionId', 'Orca session ID'), row.session.id],
- 71: {translate('resourceManager.pty.copyId', 'Copy Orca session ID')}

### `src/renderer/src/components/status-bar/ResourcePtyPanel.tsx` (3)
- 56: ? '{{count}} Orca PTY on this computer'
- 57: : '{{count}} Orca PTYs on this computer',
- 101: {translate('resourceManager.pty.noLocalOrcaPtys', 'No local Orca PTYs')}

### `src/renderer/src/components/status-bar/UpdateStatusSegment.tsx` (2)
- 54: 'Update waiting for other Orca instances. Click to expand.'
- 64: 'Checking running Orca instances before restarting.'

### `src/renderer/src/components/status-bar/owner-usage-rate-limits.ts` (1)
- 71: 'Usage unavailable — {{server}} does not report usage. Update Orca on that host.',

### `src/renderer/src/components/status-bar/remote-host-connection-status.ts` (3)
- 67: "Orca couldn't pair with it again over SSH. Connect to try again."
- 82: 'Orca versions are not compatible'
- 86: 'Update Orca on this computer or on the server, then connect again.'

### `src/renderer/src/components/status-bar/workspace-space-changes.tsx` (1)
- 59: 'Uncommitted files · Click a file to view its changes in Orca.'

### `src/renderer/src/components/status-bar/workspace-space-worktree-actions.tsx` (1)
- 59: 'This workspace is no longer managed by Orca.'

### `src/renderer/src/components/tab-bar/NativeChatNamingFailure.tsx` (1)
- 74: "Orca couldn't generate a name for"

### `src/renderer/src/components/tab-bar/QuickLaunchButton.tsx` (1)
- 223: 'Update Orca on this server to list this workspace’s agents'

### `src/renderer/src/components/tab-group/AiVaultSessionDropLayer.tsx` (1)
- 229: 'This session was dragged from an older Orca window. Resume it from Session History instead.'

### `src/renderer/src/components/task-page-jira-board-move-dialog.tsx` (1)
- 97: 'Jira requires fields Orca cannot collect yet: {{fields}}.',

### `src/renderer/src/components/terminal-pane/ClaudeDiffPanelNoticeBanner.tsx` (1)
- 91: "Claude Code can open its own diff panel beside the chat in wide terminals. That panel is Claude's, not Orca's."

### `src/renderer/src/components/terminal-pane/ClaudeOldTerminalBanner.tsx` (2)
- 94: "This terminal was opened before Orca's Claude account update, so claude here uses System default's login."
- 128: 'Orca now keeps each Claude account in its own folder, and claude in a new terminal follows the account you select.'

### `src/renderer/src/components/terminal-pane/CodexSharedServerBanner.tsx` (1)
- 116: 'This terminal was opened before Orca started giving each Codex its own server.'

### `src/renderer/src/components/terminal-pane/CodexSharedServerFixDialog.tsx` (5)
- 167: 'This closes any open Codex sessions that share it, including ones outside Orca.'
- 212: 'Codex sessions started directly in a terminal share one background server. Orca keeps the Codex sessions it starts separate. When sessions share a server, closing one can end the others, and agent st
- 230: "Orca couldn't turn this off."
- 235: 'This changes your Codex settings, so it also applies outside Orca.'
- 251: "Orca couldn't stop the server."

### `src/renderer/src/components/terminal-pane/NewerDaemonHoldBanner.tsx` (1)
- 34: 'This terminal was opened in a newer version of Orca'

### `src/renderer/src/components/terminal-pane/TerminalErrorToast.tsx` (2)
- 177: "Orca couldn't verify this terminal's owner."
- 189: "This terminal's saved session belongs to another host connection, so Orca can't reattach it here. Open a new terminal to continue."

### `src/renderer/src/components/terminal-pane/codex-shared-settings-notice.ts` (2)
- 12: translate('terminal.codexSharedSettingsNotice.title', 'Codex in Orca now uses ~/.codex'),
- 18: 'Codex may ask again to trust folders or approve commands. Re-add any MCP servers you added only in Orca.'

### `src/renderer/src/components/terminal-pane/codex-terminal-server-isolation-notice.ts` (1)
- 35: 'Orca now runs Codex without its shared server'

### `src/renderer/src/components/terminal-pane/legacy-relay-bridge-transport.ts` (1)
- 22: 'This terminal is still running on the host under an older version of Orca. Reconnecting to it…'

### `src/renderer/src/components/terminal-pane/terminal-ime-linux-pane-replay-fixture.ts` (1)
- 8: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Orca Chrome/146.0.0.0 Electron/43.7.5 Safari/537.36'

### `src/renderer/src/components/terminal-quick-commands/TerminalQuickCommandContentSection.tsx` (1)
- 61: 'Too long for this host. Update Orca on the host to save longer prompts.'

### `src/renderer/src/hooks/ipc-events/ssh-managed-server-state-effects.ts` (1)
- 62: 'Orca couldn’t set itself up on this SSH host. SSH Hosts in Settings shows why.'

### `src/renderer/src/hooks/ipc-events/wsl-account-notice-ipc-bridge.ts` (1)
- 17: "Agents there use the distro's default Claude and Codex accounts until Orca in WSL is updated."

### `src/renderer/src/lib/agent-session-launch-plan.ts` (1)
- 147: 'Orca cannot tell which host owns this workspace. Refresh projects and review it again.'

### `src/renderer/src/lib/ai-vault-resume-refusal.ts` (1)
- 23: 'Orca could not confirm who owns this {{value0}} conversation. Refresh Session History and try again.',

### `src/renderer/src/lib/ai-vault-session-resume-preparation.ts` (1)
- 151: 'Update Orca on the host that runs this chat to resume it in a new CLI.'

### `src/renderer/src/lib/cli-conversation-exit-guidance.ts` (2)
- 14: "Orca can't confirm {{agent}} has exited in its terminal. Stop what's running there or close the terminal, then open this conversation from Session History.",
- 19: "Orca can't confirm {{agent}} has exited in its terminal. Stop what's running there or close the terminal, then try again.",

### `src/renderer/src/lib/drop-temp-copy-failure-copy.ts` (5)
- 16: 'The file changed while Orca was copying it. Try the drop again.'
- 26: "Orca couldn't create storage for dropped files."
- 31: "Orca's storage for dropped files can be read by other users, so nothing was copied."
- 46: "Too large to copy, so Orca couldn't hand it to the agent."
- 51: "Orca's storage for dropped files is full, so Orca couldn't hand it to the agent."

### `src/renderer/src/lib/duplicate-paired-servers.ts` (1)
- 144: '{{value0}} and {{value1}} are the same server paired twice. Remove one in Settings > Remote Orca Servers.',

### `src/renderer/src/lib/ephemeral-vm-workspace-target.ts` (1)
- 94: 'The Orca server on this VM cannot adopt a provisioned root. Update Orca on the VM.'

### `src/renderer/src/lib/execution-host-facts.ts` (3)
- 50: 'The Orca server has not reported its operating system yet. Reconnect to it and try again.'
- 52: 'This Orca server does not report its operating system. Update the server to launch agents on it.'
- 53: const HOST_UNRESOLVED_WITHHELD = 'Orca cannot tell which host owns this workspace yet.'

### `src/renderer/src/lib/monaco-languages/textmate-grammars/typst.tmLanguage.json` (1)
- 2: "comment": "Adapted by Orca: isolate comment nesting and protect strings, escapes, and comments inside math. See typst-LICENSE.txt for pinned upstream provenance.",

### `src/renderer/src/lib/structured-agent-session-action-launch.ts` (1)
- 118: "Orca opened {{value0}} in a terminal, but couldn't show it here when the launch finished. Your chat draft was kept.",

### `src/renderer/src/lib/structured-agent-session-launch-admission.ts` (1)
- 111: 'Orca did not open a {{value0}} chat. Check the connection to the server and try again.',

### `src/renderer/src/lib/structured-agent-session-launch-permission-notice.ts` (3)
- 21: "Orca couldn't confirm the host's permissions for {{value0}}.",
- 26: 'This host runs an older Orca that ignores chat permissions, so {{value0}} would run here without asking. Update Orca on this host to use {{value1}}.',
- 41: 'Orca did not start a {{value0}} chat',

### `src/renderer/src/lib/workspace-file-browser-open-target.ts` (2)
- 10: 'Open in Orca Browser is only available for local files.'
- 12: 'This project is on more than one host, so Orca cannot tell which copy to open.'

### `src/renderer/src/runtime/runtime-antigravity-accounts-client.ts` (2)
- 23: 'This execution host does not support native Antigravity Accounts yet. Update Orca on that host.'
- 39: 'This execution host does not support Antigravity chat sign-in yet. Update Orca on that host.'

### `src/renderer/src/runtime/runtime-file-mutation-client.ts` (1)
- 34: `File is too large to save to a remote Orca server (${Math.ceil(bytes / 1024)} KB; the limit is ${REMOTE_RUNTIME_MAX_FILE_WRITE_CONTENT_BYTES / 1024} KB).`

### `src/renderer/src/runtime/runtime-file-range-client.ts` (1)
- 110: 'Large CSV previews require a newer Orca server. Update the server and retry.'

### `src/renderer/src/runtime/runtime-file-read-client.ts` (1)
- 117: ? 'Remote file is larger than the 512 KB this Orca server can send. Update the server to open it.'

### `src/renderer/src/runtime/runtime-host-account-sign-in-client.ts` (1)
- 123: 'This server runs an older Orca that cannot add accounts from here. Update Orca on that server, or run `orca account add` in a terminal there.'

### `src/renderer/src/runtime/runtime-jira-client.ts` (1)
- 174: 'Update the remote Orca server to filter preset issues by current sprint.'

### `src/renderer/src/runtime/runtime-jira-detail-client.ts` (1)
- 85: 'Update the remote Orca server to submit required transition fields, or complete the transition in Jira.'

### `src/renderer/src/runtime/runtime-jira-summary-generation-client.ts` (1)
- 33: 'Generating Jira titles requires a newer Orca server. Update the Jira connection’s host and try again.'

### `src/renderer/src/runtime/runtime-ssh-target-management.ts` (1)
- 14: super('Update this Orca server to manage its SSH hosts from here.')

### `src/renderer/src/runtime/runtime-usage-credentials-client.ts` (1)
- 13: super('This host needs a newer Orca to save usage keys.')

### `src/renderer/src/runtime/web-runtime-terminal-create-failure-notice.ts` (1)
- 16: 'Orca couldn’t confirm that the new terminal opened on the host.'

### `src/renderer/src/ssh/node-dist-mirror-recovery.ts` (1)
- 114: 'Orca couldn’t save the mirror.'

### `src/renderer/src/ssh/ssh-host-bridged-terminals-copy.ts` (1)
- 14: 'Orca isn’t set up on this host yet: terminals started by an older version of Orca are still running in this host’s projects. They keep working here. Close them or end them on the host, then reconnect

### `src/renderer/src/ssh/ssh-host-launch-session-copy.ts` (1)
- 10: 'Terminals on this Mac may have lost local network access because the SSH session that started this host’s Orca server ended. Restart Orca’s server to restore it.'

### `src/renderer/src/ssh/ssh-host-node-download-copy.ts` (2)
- 48: 'Neither this computer nor this host could download Node.js, which Orca’s server needs. Use a Node.js mirror, or check the network on both machines.'
- 53: 'Neither this computer nor this host could download Node.js, which Orca’s server needs. Check the network or proxy on both machines, then connect again.'

### `src/renderer/src/ssh/ssh-host-server-setup-copy.ts` (6)
- 9: 'Runs on {{host}}, reached over your own SSH connection. Your code and files stay where they are. Only Orca’s list of projects, tabs and terminals moves to {{host}}.',
- 22: 'Setting up Orca on {{host}}…',
- 28: 'Moving to Orca on {{host}}…',
- 34: 'Connecting to Orca on {{host}}…',
- 40: 'Updating Orca on {{host}}…',
- 46: 'Starting Orca on {{host}}…',

### `src/renderer/src/ssh/ssh-host-server-status-copy.ts` (19)
- 37: 'Orca couldn’t confirm that its server on {{host}} is answering.',
- 107: 'This computer has projects or folders for this host that its Orca server doesn’t have yet, often added by an older version of Orca. Move them to this host’s Orca server, or keep the server’s version,
- 122: 'This host doesn’t allow running programs from ~/.orca-remote, so Orca can’t start its server there. This usually means the home folder is mounted with noexec. Ask the host’s administrator to allow ru
- 132: 'This host isn’t supported by this version of Orca ({{reason}}). To keep using it, install an older version of Orca.',
- 141: 'This host isn’t supported by this version of Orca. To keep using it, install an older version of Orca.'
- 152: 'Orca has no server build for this system'
- 157: 'this Orca build doesn’t include the server'
- 162: 'Orca couldn’t identify the host’s system libraries'
- 189: 'This host isn’t supported by this version of Orca: its SSH server doesn’t allow port forwarding, and Orca couldn’t reach its server through the SSH session either. To keep using it, install an older
- 199: 'Orca couldn’t start its server on this host. Try connecting again.'
- 209: 'Orca lost contact with this host while setting up its server. Nothing on the host was stopped. Connect again to continue.'
- 219: 'Orca paused moving this host’s projects to its Orca server because it couldn’t confirm the server’s copy. Nothing is lost: the host keeps its projects and stays locked until the move finishes. Connec
- 236: 'This host’s Orca server already had {{paths}}, so this desktop now uses the server’s copy. This desktop’s tabs and {{count}} automations there were not moved, and worktrees it created there show as e
- 241: 'This host’s Orca server already had {{paths}}, so this desktop now uses the server’s copy. This desktop’s tabs there were not moved, and worktrees it created there show as external worktrees.',
- 258: 'Orca isn’t set up on this host yet: something on the host stops the move.'
- 267: 'Orca isn’t set up on this host yet. {{reason}}',
- 286: '{{count}} terminals started by an older version of Orca are still running on this host, and they don’t stop on their own. Close them in that version of Orca or end them on the host, then reconnect.',
- 291: 'Terminals started by an older version of Orca are still running on this host, and they don’t stop on their own. Close them in that version of Orca or end them on the host, then reconnect.'
- 299: 'Orca couldn’t confirm that terminals started by an older version of Orca have exited. Reconnect to try again.'

### `src/renderer/src/ssh/ssh-host-server-update-copy.ts` (7)
- 13: 'Runs a newer version of Orca’s server than this app; it keeps that version.'
- 21: 'Runs Orca’s server; it updates on a later connect.'
- 30: 'Runs Orca’s server on its previous version; updating it failed.'
- 39: 'Runs an older version of Orca’s server than this app; the last update was rolled back. Use Update server to try again.'
- 47: 'Runs a version of Orca’s server this app can’t update; this build has no server for this host.'
- 55: 'Runs Orca’s server, which updates after its project move finishes.'
- 63: 'Runs Orca’s server; Orca couldn’t check whether it is behind this app.'

### `src/renderer/src/startup/startup-web-host-unreachable.ts` (2)
- 55: toast.error(translate('auto.startup.webHostUnreachable.title', "Couldn't reach your Orca host"), {
- 58: "Nothing was lost. Orca will reload when the host answers, and won't save changes until then."

### `src/renderer/src/startup/startup-web-pairing-refused.ts` (1)
- 15: toast.error(translate('auto.startup.webPairingRefused.title', 'Orca refused this browser'), {

### `src/renderer/src/store/slices/runtime-detected-agents.ts` (1)
- 57: super("Update Orca on this server to list this workspace's agents.")

### `src/renderer/src/store/slices/workspace-cleanup-agent-evidence.ts` (1)
- 38: 'Orca cannot tell which host owns this workspace. Refresh projects and review it again.'

### `src/renderer/src/web/preload-api/web-agent-accounts-api.ts` (2)
- 42: 'GLM Coding Plan keys can only be changed in the desktop app on the computer running Orca.'
- 105: 'Adding or re-signing an account is only available in the desktop app on the computer running Orca.'

### `src/renderer/src/web/preload-api/web-agent-session-attachment-upload.ts` (1)
- 13: const SERVER_CHANGED = 'The paired Orca server changed while the request was in progress.'

### `src/renderer/src/web/preload-api/web-runtime-calls.ts` (1)
- 58: throw new Error('The paired Orca server changed while the request was in progress.')

### `src/renderer/src/web/web-runtime-client-error.ts` (2)
- 32: 'Orca refused to pair from this page: it is plain http on another machine, so anyone on the network path could replace it and take the pairing code. Open the web client over https, at localhost on thi
- 37: 'This Orca server no longer supports this browser’s sign-in key (it may have been downgraded). Update the server, or pair this browser again.'

### `src/shared/agent-session-failure-copy.ts` (7)
- 81: "{{agent}}'s Command in Settings → Agents must be a program path or name Orca can find, with no arguments or variables. Change it or reset it.",
- 83: "{{agent}} isn't installed on the computer running this chat. Install it from the chat in a current version of Orca.",
- 117: writeFailed: "Orca couldn't hand this message to the agent, so it was not sent.",
- 120: hostRestarted: 'Orca restarted before this message was sent.',
- 145: hostFault: "Orca ran into a problem, so this didn't go through.",
- 146: hostFaultTryAgain: "Orca ran into a problem, so this didn't go through. Try again.",
- 147: hostStopped: '{{agent}} never finished starting, so Orca stopped it.',

### `src/shared/agent-session-write-notice-copy.ts` (16)
- 36: 'Orca on the computer running this chat has hit a request limit. Update Orca there, then try again.',
- 37: outcomeUnknown: "Orca couldn't confirm what happened. Check the chat.",
- 39: "Orca couldn't confirm your message reached the agent. Check the chat, then send it again if needed.",
- 43: historyUnreadable: "Orca couldn't read this chat's saved history.",
- 45: historyUnavailable: "Orca couldn't open this chat's history right now.",
- 46: savedByNewerOrca: 'Chats were saved by a newer Orca.',
- 47: updateOrcaToKeepUsing: 'Update Orca to keep using them.',
- 48: chatSavedByNewerOrca: 'This chat was saved by a newer Orca.',
- 49: updateOrcaToOpenChat: 'Update Orca to open it.',
- 51: 'This needs a newer Orca on the computer running this chat. Update Orca there, then try again.',
- 53: cannotRunHere: "Orca can't run this agent in a chat here.",
- 54: unreachable: "Orca couldn't reach the agent.",
- 55: recordFailed: "Orca couldn't save this to the chat's history.",
- 93: hostReconciling: 'Orca is still checking on this chat after restarting.',
- 95: recordUnreadable: "Orca couldn't read this chat's saved state.",
- 96: chatNotFound: "Orca can't find this chat.",

### `src/shared/automation-extra-agent-args.ts` (1)
- 14: 'Update Orca on this host to use extra arguments.'

### `src/shared/claude-shell-function.ts` (2)
- 23: # Why: Orca's value replaced the user's own at spawn, so System default restores theirs.
- 31: # Why -m 700: matches the folder Orca's setup creates; a credentials folder stays private.

### `src/shared/computer-use-error-recovery.ts` (1)
- 98: 'If this targets an Orca server (`orca serve`, SSH or WSL), its install may not include computer use: update or reprovision the server, then retry.',

### `src/shared/desktop-browser-bridge-protocol.ts` (2)
- 23: export const DESKTOP_BROWSER_BRIDGE_SETTING_LABEL = "Allow this host's orca CLI to control Orca"
- 30: export const DESKTOP_BROWSER_BRIDGE_UNAVAILABLE_MESSAGE = `No Orca desktop is sharing its browser with this host. On your desktop, open this host's SSH settings and turn on "${DESKTOP_BROWSER_BRIDGE_S

### `src/shared/git-stage-worktree-scope.ts` (1)
- 18: 'The Orca version running this workspace cannot stage changes beyond the ones listed, so nothing was staged. Update Orca on that host, or stage from a terminal.'

### `src/shared/host-account-launch-env.ts` (1)
- 35: return `Accounts for this WSL host are managed in the Orca desktop app: Settings → AI Provider Accounts, with the ${wslDistro} (WSL) host selected.`

### `src/shared/jira-detail-capabilities.ts` (1)
- 8: 'Creating Jira issues with user fields requires a newer Orca server. Update the server and try again.'

### `src/shared/orcad-migration/orcad-migration-blob-transfer.ts` (1)
- 201: return `${ORCAD_MIGRATION_DESTINATION_BLOB_KIND_UNSUPPORTED}:${kind}:Update Orca on this host to move this project's ${kind} to it.`

### `src/shared/profile-state-build-compatibility.ts` (1)
- 16: return 'This build predates SQLite profile storage. Quit Orca and run the current CLI’s “orca profile state rollback --latest-json --profile-id <id>” for each profile before installing it manually.'

### `src/shared/remote-runtime-passthrough-socket.ts` (7)
- 49: end(protocolError('Remote Orca runtime returned an unreadable binary frame.'))
- 76: 'Timed out connecting to the remote Orca runtime.'
- 93: 'Remote Orca runtime stopped responding; the connection was reset.'
- 126: end(protocolError('Remote Orca runtime returned an invalid E2EE handshake frame.'))
- 147: end(protocolError('Remote Orca runtime returned an undecryptable frame.'))
- 160: 'Remote Orca runtime rejected the pairing token.'
- 162: : protocolError('Remote Orca runtime returned an invalid E2EE auth frame.')

### `src/shared/remote-runtime-shared-control-refusal.ts` (1)
- 30: ? remoteRuntimeUnavailableError('Remote Orca runtime refused this pairing; pairing again.')

### `src/shared/runtime-environment-managed-orcad-store.ts` (1)
- 84: 'This host’s Orca server was saved without its deployment link.'

### `src/shared/runtime-environment-pairing-replace-guards.ts` (5)
- 13: 'Orca runs this server on an SSH host for you; its pairing cannot be replaced or removed here. To decommission it, run `orca environment stop --environment <name> --yes` or use Settings > Orca on your
- 19: "This server's SSH access change didn't finish. Retry or cancel it under Settings > Remote Orca Servers > SSH access for paired servers before replacing its pairing or removing it."
- 25: "Unlink this server's SSH access under Settings > Remote Orca Servers > SSH access for paired servers before replacing its pairing or removing it."
- 53: `${alreadyPaired} Orca manages it as a WSL host, so its pairing cannot be replaced here.`
- 67: `${alreadyPaired} To update its connection, add it again under Settings > Remote Orca Servers.`

### `src/shared/runtime-environment-sidecar.ts` (2)
- 73: ? `Could not read Orca environment links at ${path}; the file is invalid.`
- 74: : `Could not read the Orca environment link for ${environmentId} at ${path}; it may need a newer version of Orca.`

### `src/shared/runtime-environment-store-file.ts` (4)
- 45: `Skipping ${unreadable.length} unreadable server record(s) in ${getEnvironmentStorePath(userDataPath)} (ids: ${unreadable.map((record) => record.id ?? '<none>').join(', ')}); they may need a newer ver
- 104: `Hiding ${hidden.length} server(s) whose links cannot be read (ids: ${hidden.map((environment) => environment.id).join(', ')}); they may need a newer version of Orca.`
- 134: 'A server with this id already exists in a format that needs a newer version of Orca.'
- 150: `Could not write Orca environments at ${path}; the store exceeds its durable capacity.`

### `src/shared/runtime-environment-store-records.ts` (1)
- 83: `Could not read Orca environments at ${path}; the file is invalid.`

### `src/shared/startup-cwd-fallback.ts` (1)
- 6: 'Orca opened this terminal at the workspace root because its saved start folder no longer exists.'

### `src/shared/structured-agent-session-permission-option.ts` (1)
- 121: "This host runs an older Orca that applies its Agent Permissions to every chat and can't ask per chat. Update Orca on the host to choose a mode here."

### `src/shared/terminal-spawn-error-copy.ts` (3)
- 3: 'Your system cannot allocate any more pty devices. Close some terminals you are not using, in Orca or another program, then try again.'
- 12: 'Orca requires a pty device to launch a new terminal. This error is usually due to having too many terminal windows or terminal sessions open, either in Orca or another program.',
- 29: 'The host is already running as many terminals as Orca allows. Close a terminal you no longer need, then try again.'

### `src/shared/workspace-view/workspace-view-options.ts` (1)
- 80: { id: 'cli', label: 'Orca CLI' },

### `src/shared/wsl-host-deployment-store.ts` (3)
- 50: ? `Could not read Orca WSL host deployments at ${path}; the file is invalid.`
- 51: : `Could not read the Orca WSL host deployment for ${environmentId} at ${path}; it may need a newer version of Orca.`
- 183: `Hiding ${hidden.length} server(s) whose WSL deployment cannot be read (ids: ${hidden.map((environment) => environment.id).join(', ')}); they may need a newer version of Orca.`

### `src/wsl-guest/dispatcher-rpc-routing.ts` (1)
- 48: return Promise.reject(new Error('No owning Orca client is connected to the relay'))

