# VerificationRun — UPSTREAM-3 attempt 5 and the repeat host verification

- Task: UPSTREAM-3 (D72). Attempt 5 scope: the gaps found by the full host verification of attempt 4 (`UPSTREAM-3-full.md`): 162 merge-caused tests, `opencode.json` in `app.asar`, two packaged cold-start connections against D37.
- Candidate: `e921a5ff1d` (launcher commit, branch `axiom/attempt/UPSTREAM-3/5`, base `abdd71d60c`) + verifier fixes `bb2346c979` (two test strings) and this commit (one stale test file).
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 00:23–01:16 MDT (53 min, 568,194 tokens); report `.axiom-work/reports/UPSTREAM-3-5.md`.
- Verifier: Claude. Chain `chain-20261023-002319.log`; launcher verifications `verify-UPSTREAM-3-5-20261023-011627.log` and, after the first fix, `verify-UPSTREAM-3-5-20261023-012802.log`; host verification `host-verify-UPSTREAM-3-5-20261023-013926.log` (`launchers/upstream3-host-verify.command`). Henry approved tonight's packaged foreground run ("可以，今晚可以继续跑").

## Change (174 files; 47 outside `*.test.*` files, of which a few are test harnesses, two sidebar goldens and the generated runtime-required English catalog)

- Branding (D32): tests assert Axiom copy; phrases rebranded in one place are now branded in their twins (remote-runtime close / timeout messages across `src/shared/remote-runtime-*`, the web runtime client and the terminal multiplexer; `popout.html` / `space.html` titles; CLI help examples). Identifiers stay (`ORCA_*`, `orcad`, skill ids, IPC keys, reason codes, i18n keys).
- Persisted or parsed strings keep upstream bytes: both truncation markers (`journal-payload-bounds.ts`, `agent-session-delta-coalescer.ts`) are byte-identical to `41661e3312` again, matching the unchanged projection reader. User-visible CLI retry advice is branded on both sides (`src/cli/runtime/transport.ts:85,98` writer, the two strippers). Classifiers and hint regexes accept the legacy "Remote Orca runtime" spelling from older hosts; the portable recovery command recognises `axiom` and `orca` prefixes.
- Real defects found by the migrated tests: upstream's new Codex hook reconciler at startup read only the hook opt-out and bypassed Axiom's provider-activation gate (D37) — `main-process-ready-runtime.ts:117` now uses `shouldInstallStartupManagedAgentHook`; the AppImage generation reader looked for `orca-ide` while Axiom packages `axiom-ide` (D21) — `appimage-cache-identity.ts:13`.
- Axiom seams under upstream fixtures: store / runtime doubles completed (`pty-launch-parity` fixture builder, account-restart tests), `vi.mock` of `axiom/control-plane-boot` in the orcad PTY-repair test; no production interface weakened.
- Registries: `host-operation-ownership.ts` classifies the `axiom` namespace as `host` (consumer `host-route-call.ts:31` routes to the runtime owning the host state; unclassified = fail-closed); `wsl-move-storage-dispositions.ts` maps `create-axiom-tables-sql.ts` to the orchestration database and gives the 17 Axiom tables the orchestration tables' `rewrite-desktop` disposition.
- Deliberate Axiom behavior under upstream tests: skill sharing unconfigured (test injects a local endpoint to keep the 401 retry), product-policy install / release URLs, skill freshness fixtures on `LaPaGaYo/Axiom`, provider activation in the rate-limit fixture, the Portuguese plugin migration that attempt 2 removed (tests now assert the stored value stays; raw-preservation checks kept). Recorded divergence: Axiom keeps no migration from upstream's `stablyai.orca-portuguese` plugin id (no Axiom build ever offered that plugin).
- Packaging: `!opencode.json{,/**/*}` in `config/electron-builder.config.cjs` `files`, with the existing root-exclusion tests extended; the asar contract unchanged.
- Cold start (D37): agent-state-rules live updates only when `agentStateRulesLiveUpdates === true` (both start paths share the implementation); no Google s2 favicon URL anywhere in production code — agent catalog (CodeBuddy now maps to its shipped PNG), open-in-app presets (shipped PNG or the existing glyph), repo icons (stored favicon URLs rejected, the website-favicon picker option and the package.json-homepage auto-detection removed).
- Not done, by the brief: the three `MobilePage` Relay cases (M0 removed the Relay choice; D75 hygiene owns the pairing UI).

## Verifier fixes

1. `bb2346c979` — `src/cli/runtime-client.test.ts:448` and `src/cli/runtime/transport.test.ts:137` still expected "The Orca runtime closed the connection …" after the producer was branded; the sandbox could not run them (`listen EPERM`). Both strings now match the producer.
2. This commit — delete `tests/e2e/agent-trust-completion.unit.test.ts`. Axiom cherry-picked it with upstream #23148 (`5e476506a4`); upstream deleted it in #23744 (`21d4ae9448`) together with the modules it imports (`src/renderer/src/lib/agent-trust-preflight`, `src/main/ipc/agent-trust`), which attempt 1 correctly took as deleted. Not a conflict path (added on our side only), so it survived and fails at import. It is the only file in the merged tree that an upstream-style cherry-pick added and upstream later removed.

## Launcher gates (after fix 1)

| Check | Result |
|---|---|
| vendor-egress ratchet | PASS (stale entries only inform) |
| unit targets (61 targets: the 62 wholly merge-caused files, Axiom, contracts, CLI, native chat, Codex, startup, settings, packaging and icon tests) | 1,388 files passed, 1 failed; 13,533 tests passed, 3 failed — the three D75 `MobilePage` Relay cases |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | PASS / PASS / PASS |
| sidecar extras | 21 / 21 PASS (incl. truncation markers byte-identical to upstream, no favicon URL construction, `opencode.json` excluded) |
| full lint | PASS |
| changed-code quality | not applicable to the full merge (E2BIG); run at integration against the upstream base |

## Host verification on `bb2346c979`

| Check | Result |
|---|---|
| Full vitest (`fullsuite-UPSTREAM-3-5-20261023-013927.log`) | 42 files reported: 26 `mobile-web-app` render suites fail at launch (Playwright `chromium_headless_shell-1248` not installed on the host for the merged Playwright; D75), 4 cross-version-wire files (release tags), `agent-trust-completion.unit.test.ts` (fix 2), and 11 files whose failures are re-run below |
| Failures re-run alone vs the same files on pristine `41661e3312` (`upstream-baseline-20261023-015456.log`; `host-verify-classification-20261023-013926.md`) | 47 failing tests: **44 environmental** (identical upstream: real PTY shells, bash 3.2, `/var` vs `/private/var`, process-host dev rebuild), **3 merge-caused = the D75 `MobilePage` cases**; 0 baseline-only |
| e2e `mission-exit-m1` + `mission-exit-m2` | PASS — 2 passed (1.4 min) |
| e2e five fixture specs | PASS — 5 passed (44.7 s) |
| Cold-start egress, dev build, three stacks × two scenarios | PASS — every host and attributed tally `{}` |
| Real Codex Planner smoke (`.axiom-work/smoke/plan-codex-20261023-020132/`) | PASS — 1 passed (13.9 min): `PLAN_REVIEW` after 823 s, `planrev_b08437daa9de` PROPOSED with 12 tasks, Planner audits started → proposed → stopped, source `bb2346c979` |
| Pack (`pack-unpack-20261023-021532.log`) | PASS — `[verify-packaged-app-asar-contents] OK — roots: LICENSE, NOTICE.md, out, package.json, resources`; `CFBundleIdentifier = com.lapagayo.axiom` |
| Packaged app, foreground 75 s, fresh profile (`packaged-egress-20261023-021627.log`) | PASS — tally `{}`; vendor hosts none; non-loopback total 0 (attempt 4: `github.com`, `www.google.com`) |

Observed, not a gate: the unsigned local build still logs `macOS terminal host fallback reason=prepare-failed … Could not read designated => from codesign` (the terminal-host helper needs a code signature); revisit when Axiom builds are signed.

## Verdict

VERIFIED for integration. Remaining failures are environmental on this host (identical on pristine upstream, the missing Playwright browser build, release tags) or the three D75 `MobilePage` cases deferred to the D75 hygiene task. Next: `git commit-tree <this tree> -p main -p 41661e3312`, fast-forward main, verify-main with `UPSTREAM-3` added and `ORCA_CODE_QUALITY_BASE=41661e3312`, retire any older sidecar pin that UPSTREAM-3 overturned on purpose (recorded), tag `axiom-base-2` = `41661e3312`, push main and that one tag.
