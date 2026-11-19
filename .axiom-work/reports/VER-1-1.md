# VER-1 attempt 1

## Scope and execution plan

Authority: the supplied VER-1 brief, `.axiom-work/briefs/VER-1.verify`, and accepted D90 item 2. The assigned branch is `axiom/attempt/VER-1/1`; starting HEAD and main are `f4c15bed58f6add31831064ed9853091eeecbd1c`, with a clean worktree. VER-1 is the runtime compatibility unit before VER-2 changes the software version and VER-3 documents sync/display policy. The supplied design and scope are sufficient to execute without another design approval.

Problem: raw app-version comparisons mistake the future Axiom 0.x line for old upstream releases. Success means preserving same-line behavior and early admissions while applying the recorded Orca baseline only at the three specified rules. The pairwise cross-line relation deliberately is not a sortable total order. No caller, version display, package version, persisted host record, shared parser, or governing document changes.

Execution stays in the assigned checkout. Only the ten authorized files may change. No other model, reviewer service, dependency operation, or external source is used; independent acceptance remains with the verifier, and the launcher makes the commit. The task risk includes verification-time scope enforcement rather than runtime write-scope enforcement. No new budget, retry, or approval policy is introduced.

- [x] Write the fourteen specified tests in the four new test files; reproduce the baseline-module absence and the three rule regressions.
- [x] Add `src/shared/orca-baseline.ts`: validate via `isValidAppVersion`, classify major 0/minor at least 1, expose the baseline projection and pairwise comparison.
- [x] Change only the import and comparison at the host rule, the profile-floor predicates, and the plugin host projection; format all eight changed/new TypeScript files with the repository formatter.
- [x] Append the exact section 10 heading to `docs/reference/orca-mapping.md`, documenting behavior and all required limits.
- [x] Save the three rule files, restore their main versions with `git show main:<path>`, run all fourteen tests, and restore the implementations; require exactly titles 5, 11, 12, and 13 to fail and ten to pass.
- [x] Run the Bun sidecar targets, the Node Axiom CI step, three compiler passes, changed-code quality, full lint, and every sidecar assertion including the union pins; record any sandbox limitation without changing unrelated code.
- [x] Inspect scope, changed-line budgets, all doc sentences, and acceptance evidence; leave the report and implementation for launcher snapshot and independent verification.

## Implemented files and kernel diff audit

| File | Change |
|---|---|
| `src/shared/orca-baseline.ts` | New baseline identity, validated Axiom-line classifier, upstream projection, and pairwise comparison; its only import is `./app-version`. |
| `src/main/ssh/orcad-host-version-admission.ts` | Use the pairwise cross-line comparison after the unchanged early admissions. |
| `src/shared/profile-state-build-compatibility.ts` | Treat an Axiom-line current or target version as having reached the profile floor. |
| `src/shared/plugins/plugin-manifest.ts` | Project only the host version onto the upstream line before the existing parser and numeric comparison. |
| `src/shared/orca-baseline.test.ts` | Titles 1–4; no production import except the new module. |
| `src/main/ssh/orcad-host-version-admission.test.ts` | Titles 5–9; real pure function and typed activation records. |
| `src/shared/profile-state-build-compatibility-lines.test.ts` | Titles 10–12; real profile rule. |
| `src/shared/plugins/plugin-engine-range-lines.test.ts` | Titles 13–14; real plugin gate. |
| `docs/reference/orca-mapping.md` | Append section 10 after section 9, retaining all previous text/headings. |
| `.axiom-work/reports/VER-1-1.md` | Task plan, implementation audit, test evidence, limitations and handoff. |

Every changed kernel line, numbered against main for removals and the final file for additions:

| File | Line | Change and reason |
|---|---|---|
| Host admission | main 5 removed | Remove the direct `compareAppVersions` import because the rule now needs cross-line semantics. |
| Host admission | final 5 added | Import `compareAppVersionsAcrossLines` from `../../shared/orca-baseline`. |
| Host admission | main 24 removed | Replace the raw comparison that wrongly ranks the baseline above Axiom 0.1.0. |
| Host admission | final 24 added | Compare the recorded and current app versions across lines, retaining the strict greater-than refusal. |
| Host admission | final 25 added | Preserve the exact `'host-newer'` result; the formatter puts this ternary arm on its own line. |
| Host admission | final 26 added | Preserve the `null` admission result; this is the formatter's other ternary arm. |
| Profile floor | final 2 added | Import `isAxiomLineVersion` from `./orca-baseline`. |
| Profile floor | main 11 removed | Replace the current-version predicate that mistakes 0.1.0 for a pre-SQLite build. |
| Profile floor | final 12 added | Limit the below-floor current-version bypass to non-Axiom versions. |
| Profile floor | final 13 added | Retain the existing floor predicate inside that conjunction. |
| Profile floor | final 14 added | Admit an Axiom-line target as SQLite-capable, including prereleases and normalized input. |
| Plugin manifest | final 2 added | Import `upstreamLineVersion` from `../orca-baseline`. |
| Plugin manifest | main 166 removed | Replace only the raw host parse, which rejects 0.1.0 against upstream engine requirements. |
| Plugin manifest | final 167 added | Parse the upstream-line projection of the host, preserving the range parser, suffix handling and numeric loop. |

Added plus removed lines: host **6 / 8**, profile **5 / 14**, plugin **3 / 8**. The baseline module has **23 / 60 nonblank lines**. No export was added to the three rule files; signatures, profile constant/message, host early admissions/refusal value and plugin range grammar are unchanged.

## Fourteen test cases

All titles below are literal and appear once in the four new files. Host titles 5–8 use an active `served-build`, a distinct `candidate-build`, and a nonempty recorded app version, so no early admission hides the comparison.

1. **the baseline names a release and a full commit id** — `src/shared/orca-baseline.test.ts`. Setup: Exact release and full commit, plus a 40-character hexadecimal match. Proves: The baseline identifies the audited full upstream sync.

2. **0.1.0 and later 0.x versions are on the Axiom line and placeholders and 1.x versions are not** — `src/shared/orca-baseline.test.ts`. Setup: 0.1.0, 0.2.0, 0.10.0 metadata, prereleases, v/V prefixes, whitespace and numeric leading zeros; negatives include 1.x/2.x, 0.0.x, the placeholder and malformed text. Proves: Only valid major-0/minor-at-least-1 versions classify as Axiom; projection returns the baseline only for them and otherwise preserves the exact input.

3. **two versions on the same line compare as app versions** — `src/shared/orca-baseline.test.ts`. Setup: Same-line Axiom and upstream pairs, numeric prerelease identifiers, build metadata, normalized input, placeholder and invalid text. Proves: Comparison keeps the expected negative/zero/positive result, release/prerelease ordering, ignored metadata and invalid-input zero.

4. **an Axiom-line version meets an upstream version at the baseline** — `src/shared/orca-baseline.test.ts`. Setup: 0.1.0, 0.2.0 and a normalized 0.10 prerelease against baseline, earlier/later upstream releases, a baseline prerelease, placeholder and invalid text; both directions around baseline and invalid text. Proves: Only cross-line pairs substitute the baseline; both Axiom versions meet 1.4.214 as equals and the relation is not suitable for list sorting.

5. **a host the baseline release served admits 0.1.0** — `src/main/ssh/orcad-host-version-admission.test.ts`. Setup: Recorded 1.4.214 and older 1.4.200, each with app 0.1.0. Proves: The baseline and older upstream hosts admit Axiom 0.1.0.

6. **a host a newer upstream release served refuses 0.1.0** — `src/main/ssh/orcad-host-version-admission.test.ts`. Setup: Recorded 1.4.300 with app 0.1.0. Proves: A newer upstream host still refuses with host-newer.

7. **a host a newer 0.x served refuses an older 0.x and admits a newer one** — `src/main/ssh/orcad-host-version-admission.test.ts`. Setup: Recorded 0.2.0 with apps 0.1.0 and 0.3.0. Proves: Same-line Axiom downgrades are refused and upgrades admitted.

8. **upstream versions on both sides are refused and admitted as before** — `src/main/ssh/orcad-host-version-admission.test.ts`. Setup: Both non-Axiom: newer, older and equal 1.x versions, 2.0.0, 0.0.1, placeholder in both positions, prerelease and invalid recorded version. Proves: Existing upstream comparisons and placeholder behavior remain intact.

9. **a stopped host restarting the same build and a record without a version are admitted** — `src/main/ssh/orcad-host-version-admission.test.ts`. Setup: Stopped record with previous equal to candidate and recorded 9.9.9; active records with missing or empty app version. Proves: The original two early admissions still precede the version rule.

10. **0.1.0 may switch to a later 0.x and to an upstream build at or past the floor** — `src/shared/profile-state-build-compatibility-lines.test.ts`. Setup: Current 0.1.0 with targets 0.2.0, 0.10.0 prerelease, 1.4.214, 1.4.215 and its prerelease. Proves: Axiom can switch to later Axiom builds and upstream builds at or beyond the SQLite floor.

11. **0.1.0 refuses a build from before the floor** — `src/shared/profile-state-build-compatibility-lines.test.ts`. Setup: Current 0.1.0 with targets 1.4.213, floor prerelease, placeholder and invalid text. Proves: Axiom protects SQLite profile storage and returns the existing rollback guidance.

12. **a build at the floor may switch to 0.1.0** — `src/shared/profile-state-build-compatibility-lines.test.ts`. Setup: Current 1.4.214 with 0.1.0, its prerelease and its normalized metadata form. Proves: The upstream floor build may switch to an Axiom build.

13. **0.1.0 satisfies a range the baseline satisfies and fails a range past the baseline** — `src/shared/plugins/plugin-engine-range-lines.test.ts`. Setup: Axiom 0.1.0 and later/prefixed/suffixed forms with >=1.0.0, >=1.4.214, >=1.4.215 and >=0.99.0. Proves: Baseline-supported plugin ranges pass, a range past the baseline fails, and 0.x ranges cannot express an Axiom minimum.

14. **an upstream host version is compared as before** — `src/shared/plugins/plugin-engine-range-lines.test.ts`. Setup: Upstream host 1.4.0 against lower/equal/higher minima, ignored prerelease/build suffixes, an older host and the placeholder. Proves: Existing plugin admissions and refusals are preserved.


## Test-first and explicit red check

The test-first run initially had the expected absent-module suite error plus rule failures 5, 11, 12 and 13 (six existing-behavior cases passed). After adding only the baseline module, all fourteen collected: exactly four failed and ten passed. After the minimal rule edits and formatting, all fourteen passed.

The separate, required red check saved all three implemented rule files, replaced each with the exact bytes from `git show main:<path>`, ran the four new test files with `--reporter=verbose`, and restored the saved bytes in a `finally` block. All restored files were byte-checked against their saved contents. The new module and all tests stayed in place throughout. Command:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --reporter=verbose src/shared/orca-baseline.test.ts src/main/ssh/orcad-host-version-admission.test.ts src/shared/profile-state-build-compatibility-lines.test.ts src/shared/plugins/plugin-engine-range-lines.test.ts
```

Observed exit **1**, **4 failed / 10 passed**, with precisely these failures:

| Title number | Failure with main's rules |
|---|---|
| 5 | Received `'host-newer'` where `null` was expected for recorded 1.4.214 and app 0.1.0. |
| 11 | Received `null` rather than a message containing `--profile-id` for target 1.4.213; the containment assertion rejects null. |
| 12 | Received the original SQLite rollback message where `null` was expected for current 1.4.214 and target 0.1.0. |
| 13 | Received `false` where `true` was expected for host 0.1.0 and range >=1.0.0. |

Titles **1, 2, 3, 4, 6, 7, 8, 9, 10 and 14 passed**. No rule file remains reverted. Raw output: `explicit-red.log` in the temporary evidence directory listed below.

## Documentation sentences and required limits

The exact appended heading is `## 10. Version lines and the Orca baseline（VER-1）` at line 418. Every added sentence follows, with its final `docs/reference/orca-mapping.md` line; this also records every limitation required by the brief:

- **Line 420:** The Axiom line comprises valid app versions with major 0 and minor at least 1, including surrounding whitespace, a leading `v` or `V`, prereleases and build metadata as accepted by `isValidAppVersion`.
- **Line 421:** The other line retains the existing upstream comparison behavior, including `1.x`, `0.0.x`, the headless placeholder `0.0.0-orcad`, and invalid text; these values are not classified as Axiom-line versions.
- **Line 422:** `ORCA_BASELINE` in `src/shared/orca-baseline.ts` records this build's kernel baseline as release `1.4.214` and commit `41661e33128c3a308a570aa0ed96ce24910a98c4`, from the full upstream sync of 2026-10-23 (D90 item 2).
- **Line 423:** A full upstream sync changes the baseline; individual cherry-picked fixes do not, and the constant is updated by hand until VER-3 writes down the sync rule.
- **Line 425:** Host admission preserves its two early admissions and otherwise compares versions unchanged within one line, substituting this build's baseline for the Axiom version only when the pair crosses lines.
- **Line 426:** The profile floor treats every Axiom-line version as having reached SQLite profile storage, while other versions retain the existing `1.4.214` floor check and refusal message.
- **Line 427:** The plugin gate evaluates `engines.orca` against the host's upstream-line version (the baseline for an Axiom-line host), preserving the existing `>=x.y.z` grammar and numeric comparison.
- **Line 429:** The cross-line comparison orders one pair for a rule and must not sort a list: `0.1.0` and `0.2.0` both compare equal to `1.4.214`, while they compare differently to each other.
- **Line 430:** A build from before VER-1, or an upstream build, does not see a host served by a `0.x` build as newer than itself.
- **Line 431:** The line is identified by the major number (with minor at least 1 for Axiom), so these rules must be reviewed before Axiom reaches `1.0.0`.
- **Line 432:** A host's record still stores the app's version, not the baseline.
- **Line 433:** Host and plugin refusal messages still print the app's version, which can read oddly beside an upstream number.
- **Line 434:** The baseline used by a rule is this build's baseline, not the baseline of the build that wrote a host's record.
- **Line 435:** A plugin cannot request a minimum Axiom `0.x` version: every range of the form `>=0.x.y` is satisfied by any Axiom-line `0.x` host.
- **Line 436:** Updater ordering, build-picker sorting and remote-runtime version comparison still compare app versions as they are.
- **Line 437:** VER-1 does not change `package.json` or display the baseline, so the current `1.4.214` build keeps its existing answers.

## Toolchain and evidence location

Commands run in `/Users/henry/Documents/Axiom` with `/Users/henry/.nvm/versions/node/v24.21.0/bin` prepended to PATH: Node **24.21.0**, pnpm **12.14.0**, Vitest **5.0.5**, repository-pinned Bun **1.4.3**. The initial login shell had Node 20.20.0 and could not select pnpm; choosing the already-installed repository Node 24 environment resolved that startup issue. No dependency installation, rebuild, relinking or copying occurred.

Temporary logs and byte-exact red-check backups are under `/var/folders/71/dmf5g_3n6dz5jyfqcn85_rhm0000gn/T/axiom-ver-1-s_b96nib`. New files were registered successfully with `git add --intent-to-add` using the normal repository index; the temporary-index fallback was unnecessary, and no alternate Git environment was passed to tests.

## Commands and results

All test commands use the worktree's existing dependencies. Compiler/test wrapper failures are reported separately from the underlying checks.

| Command | Result | Evidence file |
|---|---|---|
| `git show 41661e33128c3a308a570aa0ed96ce24910a98c4:package.json` | Confirmed upstream release 1.4.214 at the full baseline commit. | Observed command output |
| `pnpm test` with the four new files | Exit 1 before test execution: package-build `tsx` IPC socket failed with `listen EPERM`. No package-build debugging or dependency operation followed. | `test-first-wrapper.log` |
| Direct Bun runner, four new files before the module | Expected red: missing new module, four rule failures, six passing tests. | `test-first.log` |
| Direct Bun runner, new module plus original rules | Expected red: 4 failed / 10 passed. | `baseline-red.log` |
| `pnpm exec oxfmt --write` with exactly the eight changed/new TypeScript files | Exit 0; formatter output retained, including the host ternary layout. No Markdown or unrelated file was formatted. | Observed command output |
| `pnpm exec oxfmt --check` with the same eight TypeScript files | Exit 0; all matched files use the correct format. | Observed final command output |
| Direct Bun runner, four new files after implementation | Exit 0; 14 passed in 4 files. | `focused-green.log` |
| Explicit main-rule red check above | Expected exit 1; precisely titles 5, 11, 12, 13 failed; the other ten passed; implementations restored. | `explicit-red.log` |
| Direct Bun runner, exact sidecar targets below | Exit 1; 231 files passed, 9 failed, 7 skipped (runner reported 248 total); 2,520 tests passed, 17 failed, 64 skipped; 9 errors. Details below. | `bun-targets.log` |
| Final direct Bun focused regression command below, after restoring implementations | Exit 0; **70 passed in 11 files**, including all fourteen new tests, the unchanged app-version/profile tests, plugin schema/discovery, managed-host decision and updater callers. | `final-focused.log` |
| `pnpm tc` | Exit 1 at the same package-build IPC socket restriction, before the compiler stage. | `tc-wrapper.log` |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs`, run 1 | Exit 0; all four configured projects reported no type errors. | `typecheck-1.log` |
| Same compiler-stage command, run 2 | Exit 0; all four configured projects reported no type errors. | `typecheck-2.log` |
| Same compiler-stage command, run 3 | Exit 0; all four configured projects reported no type errors. | `typecheck-3.log` |
| `pnpm run check:code-quality:changed` | Exit 0; zero new findings in each scan across all 8 TypeScript files, comparing against main `f4c15bed58f6`. | `quality.log` |
| `pnpm lint` | Exit 0; full chain completed, including the RPC catalog and vendor ratchet. Existing repository warnings/report-only notices remain; no changed-code findings. | `lint.log` |
| `bash .axiom-work/scripts/ci-axiom-unit.sh` | Exit 0; native-runtime check passed without rebuilding, then the exact Axiom CI step ran under Node: **340 files passed, 2,707 tests passed, 1 existing test skipped**. | `node-ci.log` |
| `git add --intent-to-add --` with the new module, four new tests and report | Exit 0; makes new files visible to diff/grep assertions. | Observed command output |
| `git diff --check` | Exit 0; no whitespace errors. | Observed command output |
| `ps -o pid= -p $$` | Shell denied `ps` with “operation not permitted”, confirming that real process-table checks are unavailable in this sandbox. | Observed command output |

The three compiler runs each covered Node, CLI, web and the process-host package test project (18,267 / 3,207 / 15,772 / 34 checked files respectively). The standard runner's existing Vite configuration warning appeared in test logs; no configuration was changed.

Exact broad Bun command (the `targets:` line from the sidecar, unchanged):

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/shared/orca-baseline.test.ts src/shared/app-version.test.ts src/shared/profile-state-build-compatibility.test.ts src/shared/profile-state-build-compatibility-lines.test.ts src/shared/plugins src/main/plugins src/main/managed-server src/main/wsl src/main/ssh/orcad-host-version-admission.test.ts src/main/ssh/orcad-remote-deploy.test.ts src/main/ssh/orcad-runtime-maintenance.test.ts src/main/ssh/ssh-host-server-on-connect-stopped-elsewhere.test.ts src/main/ssh/managed-server-update-check.test.ts src/main/ssh/managed-server-update-deps.test.ts src/main/updater-sqlite-profile-downgrade.test.ts src/main/updater.build-channel-selection.test.ts src/main/updater
```

Exact final focused Bun command:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/shared/orca-baseline.test.ts src/main/ssh/orcad-host-version-admission.test.ts src/shared/profile-state-build-compatibility-lines.test.ts src/shared/plugins/plugin-engine-range-lines.test.ts src/shared/app-version.test.ts src/shared/profile-state-build-compatibility.test.ts src/shared/plugins/plugin-manifest.test.ts src/main/plugins/plugin-discovery.test.ts src/main/managed-server/lifecycle/orcad-managed-update-decision.test.ts src/main/updater-sqlite-profile-downgrade.test.ts src/main/updater.build-channel-selection.test.ts
```

The Node CI command is read directly from `.github/workflows/axiom-ci.yml` by the existing CI script and is printed in `node-ci.log`; its 340 files were not reduced.

### Broader Bun failures and remaining verification risk

Socket failures include both Unix sockets and loopback TCP: the sandbox refuses `listen`, producing `EPERM`, followed in some suites by setup timeouts and cleanup errors. Real process checks also cannot use `ps`. These are not silently treated as passing, and no existing test, timeout, skip, sidecar, or source outside scope was changed.

| Existing test file | Observed failure |
|---|---|
| `src/main/managed-server/lifecycle/orcad-managed-tunnel-identity-restart.test.ts` | All 3 tests fail at Unix socket listen: WSL caller persistence, same-host/new-runtime recovery, and refusal of a different host. |
| `src/main/managed-server/lifecycle/orcad-managed-pairing-repair-restart.test.ts` | Both tests fail at Unix socket listen: re-pairing after host restart and refusing a different pinned key. |
| `src/main/managed-server/lifecycle/orcad-stdio-bridge-provider.test.ts` | Loopback listen EPERM, 60-second setup timeout, then cleanup of an absent echo server. |
| `src/main/wsl/wsl-orcad-connection.test.ts` | Loopback listen EPERM, 60-second setup timeout, then cleanup of an absent server. |
| `src/main/wsl/wsl-orcad-stdio-bridge.test.ts` | Loopback listen EPERM, 60-second setup timeout, then cleanup of an absent echo server. |
| `src/main/wsl/wsl-orcad-watch.test.ts` | Three tests time out after refused loopback listen: bridge exit code, refused port, and never reporting a self-caused exit. |
| `src/main/managed-server/install/remote-install-noisy-sftp-wire.test.ts` | Uncaught loopback listen EPERM while starting the local SSH server; named by the runner's unhandled-error report. |
| `src/main/managed-server/install/orcad-remote-shell-commands.integration.test.ts` | Six real-process failures: both split-entry PID cases read DEAD instead of LIVE; a reused PID reads LIVE instead of DEAD; both orcad entry names remain still-running instead of stopped; zombie detection never observes the expected process state. |
| `src/main/managed-server/install/remote-node-runtime-store-gc.test.ts` | Two real-shell cases return an empty removed-runtime list: idle-runtime collection and stale-lock recovery. |
| `src/main/managed-server/host-state/orcad-state-snapshot-shell.test.ts` | One process-group lock case reads process group 0 instead of a value greater than 1. |

The final three rows exercise real process observation; the direct `ps` denial supports a sandbox explanation, but their full successful behavior still needs verification on the host. The broad runner additionally reported `EISDIR` while reading a source map during error reporting. Its 64 skips and the Node run's one skip come from existing tests; this task added none. The failed broad run is **not** a clean acceptance result, even though the 70 relevant pure/caller regressions and the complete Node Axiom CI step passed.

## Differences from the brief and delivery state

There is no implementation-scope or behavior deviation. The supplied brief is the design and execution authority, so the local skill workflow was narrowed to its authorized files, this report, and direct local implementation; no extra plan document, worktree, reviewer agent/service, commit, merge or dependency operation was introduced. Independent review belongs to the designated verifier.

The prescribed fallback was necessary for both `pnpm test` and `pnpm tc`: their package-build stage cannot open its IPC socket. The direct Bun test stage was used, and the direct complete compiler stage passed three times. The normal Git index accepted intent-to-add, so no temporary Git environment was needed. Full lint passed with pre-existing warnings rather than a silent log. The remaining difference from the desired acceptance outcome is the broad Bun run's environment/process failures listed above, which need host execution.

Implementation and documentation are ready for the launcher's snapshot and independent verification. This report does not grant acceptance, change authoritative Task state, integrate the branch or mark the parent milestone complete. VER-2 remains responsible for the software-version change; VER-3 remains responsible for the sync rule and baseline display.

## Final scope and assertion audit

- The final report/scope recheck passed all 52 non-union assertions; the union result below remained valid because no source or governing file changed afterward; output is in `final-assertions.log`.
- All **53** assertions in `.axiom-work/briefs/VER-1.verify` ran individually and passed, including the union script; full output is in `sidecar.log`.
- The exact union command was `python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"`; exit **0**, with `retired 23` and final line **`ran 2660 skipped 719 failed 0 unique 3402`**.
- All fourteen literal titles satisfy the brief's punctuation/word constraints; added type assertions are limited to `as const`.
- Diff review confirms exactly the ten authorized paths, four modified existing files, six new files, no deletion, no existing-test change, and no forbidden source/dependency/governing-document change.
- The main-rule restoration audit matches the formatter-produced implementation bytes, the baseline module is 23 nonblank lines, and all three kernel diffs stay within their budgets.
- Self-review traced both host callers, both profile build switches, plugin discovery/staging and startup's app-version source; only the three shared decision points changed.
- The report preserves the required limits in the quoted section-10 sentences above; no unresolved product-design question was found.

Verification work is complete within this sandbox. The delivery state is **implementation ready for independent verification, with the broad Bun suite requiring a host rerun**. The assigned branch and checkout are preserved for the launcher; there is no worker-created commit or promotion.
