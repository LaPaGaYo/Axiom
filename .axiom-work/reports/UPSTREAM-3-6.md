# UPSTREAM-3 — attempt 6

Worker: Codex. Branch: `axiom/attempt/UPSTREAM-3/6`. Changes are uncommitted working-tree changes; no git metadata was written. This report covers only the attempt-6 fix-up from integrated main. All 49 in-scope merge-caused test failures now pass, the desktop startup rejection is fixed, all three application typechecks have 0 errors, and lint/changed-code quality pass. The full sidecar still needs host execution for the sandbox-limited files listed below.

## Changes and causes

| File | Cause and change |
|---|---|
| `src/main/cli/orca-cli-child-path.ts:82` | Packaged Linux created an `axiom` shim but returned an absolute path ending in `orca`. Return the existing shim's actual name. This shared helper serves structured children and PTY launches; no second path resolver was added. |
| `src/main/cli/orca-cli-child-path.test.ts:73` | Pin both the absolute `axiom` result and the existing PATH behavior; correct the fixture comment that had called the GNOME screen reader Axiom. |
| `src/main/runtime/structured-session-child-env.test.ts:161` | Linux's expected `axiom` path was correct; macOS/Windows still expected upstream names. Expect bundled `bin/axiom` and `bin/axiom.exe`. Session IDs, spawn token, worker identity, remote-selector clearing, and unresolved-launcher refusal assertions remain. |
| `src/renderer/src/components/sidebar/WorktreeOpenInMenu.test.tsx` | Three local-only/SSH explanation expectations still named Orca; match the Axiom producer. Disablement and launch-refusal checks remain. |
| `src/renderer/src/lib/browser-cookie-import-toast.test.ts` | The invalid-count fallback expectation still named Orca; match the Axiom message, retaining all seven malformed-count cases. |
| `src/main/tray/system-tray.test.ts` | Japanese catalog expectations still named Orca. Use Axiom in the initial/reloaded labels, tooltip, and injected replacement resource; the key `tray.openOrca` and language-refresh behavior remain. No catalog edits were necessary. |
| `src/main/menu/register-app-menu.test.ts` | The producer uses `options.appMenuLabel ?? app.name`; the test supplied `app.name = 'Orca'` while expecting Quit Axiom. Supply the packaged Axiom name and use it for submenu lookup. Contrary to the initial pointer, there is no hardcoded Quit Orca producer here: `app-menu-quit-item.ts:18` interpolates the supplied app name, and `main-process-ready-foundation.ts:105` sets the identity whose `BASE_APP_NAME` is Axiom (`dev-instance-identity.ts:5`). Preserve the native quit role, host override callback, platform accelerators, and all menu assertions. |
| `src/renderer/src/components/cmd-j/palette-results.test.ts` | CLI search fixture was Axiom CLI but queried `orca cli`; query `axiom cli` and align both CLI description fixtures. Ranking assertions remain. |
| `src/main/cli/cli-command-privileged-transaction.test.ts` | Managed-launcher fixtures still pointed at `Resources/bin/orca`; Axiom's strict classifier recognizes its own launcher. Use Axiom app/command paths and non-Axiom refusal text, including a foreign `bin/axiom` target. No production refusal rule changed; race rollback, inode checks, modes, no-overwrite, and foreign-target preservation checks remain. |
| `tests/tools/win-update-e2e/app-driver.mjs:300` | The overlay locator still matched Let agents drive Orca with the Orca CLI; match the shipped Axiom title. Existing tests retain the checks against clicking the desktop Close control or sending Escape into the restored terminal. |
| `src/renderer/src/components/skills/SkillFreshnessNudge.test.tsx` | Official skill fixture used upstream's lock source, so Axiom correctly treated it as foreign. Use `LaPaGaYo/Axiom`; also match Axiom nudge copy. Foreign/null sources and project-owned placements remain distinct. |
| `src/renderer/src/components/skills/SkillFreshnessStatusPill.test.tsx` | Same official-source fixture mismatch; use `LaPaGaYo/Axiom`. Keep update eligibility, attention, loading, error, and dialog assertions. |
| `src/renderer/src/lib/skill-freshness-display-status.test.ts` | Same official-source fixture mismatch; use `LaPaGaYo/Axiom`. Do not relax ownership or global-scope eligibility. |
| `src/main/ipc/feedback-request-ownership.test.ts:2` | Axiom's shipped feedback endpoint is null. Mock the product policy with `https://feedback.example.test/v1/feedback`, as the existing feedback suite does, to exercise the real request ownership/abort/retry code against mocked fetch. Production policy is unchanged. |
| `src/main/updater-agent-state-rules-release.test.ts` | Its fake Atom feed recognized only upstream's URL, while production reads Axiom's repository. Use Axiom feed, release URLs, and artifact names. Rules release tags remain unchanged and must never resolve as app releases. These are explicit check/build-picker cases; the existing `updater.product-policy.test.ts` separately proves no automatic/startup/wake checks and a working manual product-feed check. |
| `src/main/startup/main-process-ready-duplicate-pty-repair.test.ts:37` | An upstream runtime double reached real Axiom boot and rejected asynchronously because it had no `getOrchestrationDb`. Mock `../axiom/control-plane-boot`, matching the orcad repair test. Production boot is unchanged; the test still exercises real persisted duplicate-PTY repair and its readiness ordering. |
| `src/cli/orchestration-mutation-recovery.test.ts` | Replace result casts with `assert(result instanceof RuntimeClientError)` and data casts with exact property-path assertions. Message order, exact retry argv, unknown-outcome semantics, and secret-redaction checks remain. |
| `src/renderer/src/components/settings/repository-host-setup-options.test.ts:21` | Remove the cast from `runtimeHost`; its declared `ExecutionHostRegistryEntry` return type already checks the literal and overrides. |
| `tests/e2e/mission-plan-real-codex.smoke.spec.ts:454` | Upstream removed the two native-chat mode switches. Stop reading and seeding `openAgentTabsInChatByDefault` and `experimentalStructuredNativeChat`; retain `experimentalNativeChat`, Codex args/override, and native-chat session options in the evidence snapshot. Native chat now uses structured chat by default. |

Other startup fixtures inspected: `codex-hook-startup-wiring` and `main-process-ready-runtime-activation` stub `main-process-runtime-service`; `main-process-runtime-launch-activation`, `main-process-ready-identity-write`, `main-process-ready-activation-failure`, `main-process-ready-phase-ordering`, and `main-process-ready-persistence-cleanup` stub `main-process-ready-runtime`. They do not enter real Control Plane boot through a fake runtime and need no additional mock.

## Structured-session packaged CLI

| Platform | Child's `ORCA_CLI_COMMAND` | PATH and packaged target |
|---|---|---|
| Linux | `<userData>/linux-orca-cli-shim/axiom` | Shim directory first on PATH and in `ORCA_CLI_BIN_DIR`; forwards to the bundled `<resources>/bin/axiom` (or the existing verified AppImage stable/live launcher). The desktop executable is `axiom-ide`. |
| macOS | `<resources>/bin/axiom` | Bundled bin directory first on PATH and in `ORCA_CLI_BIN_DIR`; uses the Axiom app executable. |
| Windows | `<resources>/bin/axiom.exe` | Bundled bin directory first on the inherited PATH-key spelling (`Path` in the fixture); uses the native launcher, not the cmd wrapper. No POSIX `ORCA_CLI_BIN_DIR`. |

Packaging evidence: `config/electron-builder.config.cjs:571–576`, `:659–660`, `:710`, `:730–731`. The existing headless-host override and development `axiom-dev` resolution remain unchanged. No fallback to a bare command was added.

## Snapshots and parsed strings

Regenerated with the real generator test, not by editing snapshots:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache src/main/shell-wrapper-generated-file-snapshot.test.ts --update=all
```

Changed `src/main/__fixtures__/shell-wrapper-snapshots/{daemon,local}-{bash-rcfile,zsh-zshenv}.txt`: exactly two comments per file, "Orca's value" → "Axiom's value" and "folder Orca's setup creates" → "folder Axiom's setup creates". A read-only comparison against HEAD with comment lines removed confirms all remaining bytes are identical in all four files. No shell marker, OSC sequence, function name, variable name, or executable statement changed. Fish snapshots are unchanged.

Other deliberate identifiers retained: `ORCA_*`, `linux-orca-cli-shim`, `.orca-cli-` temporary prefixes, skill ID `orca-cli`, i18n keys, and the legacy `orca-ide` parsed command fixture in mutation recovery. The Windows overlay locator reads user-visible UI copy, so its match must follow the Axiom producer; it is not a persisted protocol marker.

The seven reported changed-code assertion findings are gone. In total the recovery test drops nine `RuntimeClientError` result casts and ten data-shape casts; the host-options fixture drops one cast. No replacement cast, `@ts-expect-error`, or new SAFETY exemption was introduced.

## Verification

Runner: Node **v24.21.0**, repository-pinned Bun **1.4.3**, Vitest **5.0.5**. No pnpm command was used. Packages were built from `src/packages/process-host` with:

```sh
export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH
node --import tsx --conditions=orca-source scripts/build-dist.mjs
```

Root test runner (Bun lane plus the repository's Node-runtime lane):

```sh
env -u CODEX_THREAD_ID ORCA_BACKGROUND_LAUNCH=1 node config/scripts/run-vitest.mjs run \
  --config config/vitest.config.ts --configLoader runner --no-cache <targets>
```

The initial runs retained `CODEX_THREAD_ID`; the gate-CLI suite then expected general CLI advice but received the inherited Codex-specific advice. Removing only that runner variable gives **7/7 passing** in its isolated rerun (`/tmp/upstream3-a6-gate-alone.log`). No production code was changed for that environment effect.

| Check | Result and evidence |
|---|---|
| Baseline regression reproduction | **49 failed / 215 passed / 1 skipped**, in 15 files, plus the reported desktop boot rejection. `/tmp/upstream3-a6-before.log`. |
| Same 15 files after fixes, ordinary snapshot verification | **15 files passed; 264 passed / 1 skipped; no unhandled errors**. All 49 classified in-scope failures now pass. `/tmp/upstream3-a6-regressions-final.log`. |
| Additional focused group | **18 files passed; 309 passed / 5 skipped** (overlaps the regression group). Covers typed recovery tests, host options, shim resolution/generation. `/tmp/upstream3-a6-focused.log`. |
| Broader sidecar | **PASS for the bounded selection: 1,415 files passed / 10 skipped; 13,762 tests passed / 50 skipped; no unhandled errors**, exit 0. Includes all in-scope regressions and existing Axiom seams. 21 environment-limited files are explicitly excluded and listed below. `/tmp/upstream3-a6-sidecar-final.log`; duration 189.88 s. |
| Three application typechecks | **PASS, 0 errors**, exit 0. `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json`. The three named tsbuildinfo cache files were already absent, confirmed before running. `/tmp/upstream3-a6-typechecks.log`. |
| E2E typecheck | `node config/scripts/run-e2e-typecheck.mjs`: exit 1 from **226 existing diagnostics**, **0 in the smoke spec**; meets the <=226 criterion. `/tmp/upstream3-a6-e2e-typecheck.log`. Neither removed setting name remains in the smoke spec. |
| Changed-code quality | `ORCA_CODE_QUALITY_BASE=41661e3312 node config/scripts/check-changed-code-quality.mjs`: **PASS, 0 new findings across 2,421 files**, including ordinary/casting/native/type-aware/React/design scans and SAFETY checks. `/tmp/upstream3-a6-code-quality.log`. |
| Full lint via constituent commands | **All 32 stages PASS**. Expanded each `pnpm run <name>` in the manifest's lint chain to its existing script, executed sequentially with `node_modules/.bin` on PATH. No installs. Includes RPC/ACP catalogs, bundled guides, manifest, reliability gates, localization, all ratchets, and import checks. Five existing docs-site warnings from base oxlint do not fail that stage. `/tmp/upstream3-a6-lint.log`. |
| Seam check | `python3 .axiom-work/scripts/upstream3-seam-check.py`: **137 touchpoints, 0 dropped**. |
| Vendor-egress ratchet | `node config/scripts/check-vendor-egress-ratchet.mjs`: **PASS, 455 grandfathered pairs**. Four stale entries (the updater and three skill-freshness tests) are reported after removing vendor fixture references; baseline untouched. |
| Compatibility and scope | Protected-files diff against starting HEAD is empty. Upstream byte comparisons pass for `migrate-v43.ts`, both journal truncation-marker producers, `structured-agent-session-projection.ts`, and patches. No conflict markers or shipped Google favicon URL. `git diff --check` passes. |

These test groups overlap; counts are not additive. An initial snapshot command placed the path after bare `--update`; Vitest 5 treated it as that option's argument and started a broad selection. It was interrupted; inspection showed no unintended tracked changes. The explicit `--update=all` command above regenerated only the four intended snapshots.

### Sandbox limits and host reruns

The complete sidecar invocation was attempted and stopped after repeated 30-second socket timeouts, not counted as a pass (`/tmp/upstream3-a6-sidecar.log`). A CLI-`--exclude` attempt still selected those files because the independent project configurations supply their own exclude lists; it too was stopped. The final bounded run instead enumerated exact unit-file arguments from the sidecar target substrings, excluding the 21 files below. Lists: `/tmp/upstream3-a6-sidecar-files.txt` and `/tmp/upstream3-a6-sidecar-excluded.txt`. Tests were neither deleted nor marked skipped in source. The final bounded run clears `CODEX_THREAD_ID` and uses `--maxWorkers 4`.

A direct Node loopback bind probe reproduces `listen EPERM: operation not permitted 127.0.0.1`. The affected tests need the host environment, not a weaker product implementation.

| File or group excluded from the bounded run | Evidence / disposition |
|---|---|
| `config/scripts/electron-builder-config.test.mjs` | Alone: 33 pass, 2 fail. Hard-linking `smol-toml` from the real pnpm store into a temporary packaging fixture returns `EPERM`. |
| `src/main/codex/codex-state-db-backfill-recovery.test.ts` | Alone: 12 pass, 2 fail, one unhandled rejection: `Could not identify the managed-hook installer process`; the companion assertion sees missing fixture output. Process identity cannot be obtained in the sandbox. |
| `src/main/native-chat/agent-session-wire/structured-agent-session-recovery-exits.test.ts` | Alone: 4 pass, 1 fails: `owner process start time was unavailable`. |
| `tests/e2e/helpers/electron-process-shutdown.unit.test.ts` | Alone: 6 pass, 2 fail. Descendant cleanup assertion sees false and grace assertion sees about 54 ms instead of >=2000; process-tree inspection is denied. Same precondition failure as attempt 5. |
| `src/main/codex-accounts/legacy-wsl-runtime-auth-drain-apply-script.test.ts` | Alone: 26 pass, 7 fail: expected SIGKILL, received null. The safe interruption helper requires process ancestry evidence unavailable here; no signaling safety check changed. |
| `src/main/orcad/orcad-duplicate-pty-repair-startup.test.ts` | Broad run: four hook-server startup failures. Alone: `Failed to start server. Is port 0 in use?` at `server.listen(port, '127.0.0.1')`, followed by Vitest's `EISDIR` source-map error while reporting the failure. This is separate from the fixed desktop mock rejection. |
| `tests/e2e/helpers/remote-skill-cloud-fixture.unit.test.ts` | Alone: its two bound-origin fixture promises reject, so `results.every(...fulfilled)` is false. Socket creation is prohibited. |
| `src/main/startup/single-instance-lock-exit.electron.test.ts` | Alone: all three fail because real Electron produces no `GATE_ENTERED` output. Real Electron launch is unavailable here. |
| `tests/e2e/helpers/recording-proxy.unit.test.ts` | Broad run: ten real listener cases fail. Needs a loopback server. |
| `src/main/codex/codex-shared-server-probe.test.ts` | Broad run: two real TCP cases fail (one times out at 30 s). Needs a listening socket. |
| `src/cli/handlers/orchestration/mutation-request.test.ts` | Broad run: six mock cases pass, one real socket recovery case times out at 15 s. |
| `src/cli/runtime/status.test.ts`, `src/cli/runtime/transport.test.ts`, `src/cli/runtime/runtime-listener-probe.test.ts` | Broad run: respectively one, two, and two real listener cases time out at 30 s each. |
| `src/cli/runtime/client-recovery.test.ts`, `src/cli/runtime/runtime-source-fence.test.ts`, `src/cli/runtime/websocket-transport.test.ts` | Broad run: respectively six, six, and seven real transport cases time out at 30 s each. |
| `src/cli/agent-launch-process.test.ts` | Broad run: its real-process/socket test times out at 60 s. |
| `src/cli/runtime/status-caller.test.ts`, `src/cli/runtime-client.test.ts`, `src/shared/remote-runtime-shared-control-connection.test.ts` | The broad run did not complete these files. They use the same denied socket setup (also individually evidenced in attempt 5); retain them for the host rather than claim a pass. |

Isolated rerun commands used the runner above with one file each; results/index: `/tmp/upstream3-a6-environment-reruns.log`, individual outputs `/tmp/upstream3-a6-alone-<basename>.log`.


## Delivery notes

- `tests/e2e/mission-plan-real-codex.smoke.spec.ts` is already untracked/ignored by `.git/info/exclude:16` (`tests/e2e/*.smoke.spec.ts`). Its fixed working-tree contents were typechecked (SHA-256 `20c958b5cb17323221a15a1eced68b8bed0ffd5c4acb0a4fdd51873ff71f6dd2`). The verifier must explicitly preserve/capture this file; a normal tracked diff or `git add -A` will not include it. This Worker did not edit `.git/info/exclude` or write the index.
- No protected manifest, lockfile, patch, decision, AGENTS/README, or vendor-egress baseline change. No dependency installation or pnpm auto-install occurred.
- The supplied `launchers/upstream3-a6-verify.command` is a post-worker host launcher: it gates on the finished worker/report, may switch branches, requires a clean committed tree, and runs the complete suite/Electron e2e. It was inspected but not executed inside this working-tree-only attempt.

## Remaining

No known in-scope implementation fix remains. Host verification must rerun the 21 environment-limited sidecar files and preserve the ignored smoke spec. The original environmental classification, cross-version harness, D75 MobilePage/pairing work, mobile-web-app suites, runtime-environment-preference timing issue, and dependency/patch/lockfile work remain out of scope and untouched. This is a Worker submission for independent host verification, not a claim that the complete host suite or Electron e2e passed here.
