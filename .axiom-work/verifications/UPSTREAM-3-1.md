# VerificationRun — UPSTREAM-3 attempt 1

- Task: UPSTREAM-3 — D72 baseline reset: full merge of upstream `main` at `41661e3312` (Axiom main `393c083ebd`, merge-base `3eb1adec20`). Attempt 1 scope: resolve every conflict (294 UU, 7 AA with markers; 91 UD), port the kernel seams (schema renumbering with backfill, session address, §4b guards, M2-01 seam, Control Plane wiring), regenerate generated files, typecheck green.
- Candidate: `da5d2c72a9` (branch `axiom/attempt/UPSTREAM-3/1`, base `d12e3a37bc` = work commit 0 `cda0d49f15` + verifier preparation).
- Worker: Codex CLI 0.163.0 (`gpt-6-astra`, reasoning `max`), 18:27–19:13 MDT (46 min, 694,559 tokens); report `.axiom-work/reports/UPSTREAM-3-1.md` (602 lines).
- Verifier: Claude. Launcher verification `verify-UPSTREAM-3-1-20261022-191313.log` (`OVERALL=FAIL`); independent review below.

## Launcher gates
| Check | Result |
|---|---|
| vendor-egress ratchet | FAIL — 121 new pairs / 15 grown, expected: the M0 pass over cleanly merged upstream code is a later attempt (see D74 for the split) |
| unit targets (orchestration db, `src/main/axiom`, axiom-contract, `methods/axiom`, CLI axiom handlers and specs, real-home guard) | FAIL — 16 files / 131 tests, all B1 (dispatch capability removed upstream) |
| clean-cache `tc:node` / `tc:cli` / `tc:web` | FAIL (53 errors in 25 files, all B1) / PASS (3,172 files) / PASS (15,673 files) |
| changed-code quality | not applicable: the merge-base with `origin/main` makes every upstream change "changed"; the script died with `spawnSync … E2BIG` on 23k files after 452 s. Run it at integration with `ORCA_CODE_QUALITY_BASE` set to the upstream target |
| sidecar extras | 12 / 15 PASS. FAIL: seam check (4 drops, reviewed below — all explained); the `session:` grep (one false positive: `tests/e2e/default-tabs-mark-crash-relaunch.spec.ts:28` names the IPC channels `session:set` / `session:patch`); `test ! -e cloud` (empty directories the start script's resolver left when it removed the 109 new upstream `cloud/` files — removed by the verifier, nothing tracked) |
| full lint | FAIL at `check:vendor-egress-ratchet`; every command before it passes (oxlint, anti-slop, both code-quality audits, reliability gates — 146, dead classes, max-lines, ts-nocheck, runtime-electron) |

## Independent review
- Conflicts: 0 marker lines in the tree; every UD path decided (91 deletions, moves recorded per path). Protected inputs unchanged against the work branch: `package.json`, lockfile, workspace file, AGENTS.md, README.md, `docs/decisions/**`.
- Schema (D72 ④): `migrate-v43.ts` byte-identical to upstream; Axiom's steps are now v44–v46 with bodies unchanged except name and gate; `SCHEMA_VERSION = 46` with upstream's v43 comment kept; `migrate.ts` replays the idempotent respelling for stored versions 43–45 inside the same transaction; `orchestration-schema-version-skew.ts` completeness probes moved to 45 / 46 (traced: an old-Axiom file at 43, 44 or 45 resolves to its own stamp and runs only the idempotent steps above it plus the backfill). New migration tests use temporary directories only.
- Session address (D14): `mission-caller.ts` uses `formatOrcaSessionAddress`; Axiom fixtures use the helper or the stored `orca_session_id:` spelling.
- §4b: 17 guard calls on main and in the candidate (14 `assertNotMissionManaged`, one each of the other three), each before the first mutation with the same verb.
- M2-01 seam and Control Plane wiring kept (start / stop in orcad and desktop startup, `AXIOM_METHODS`, CLI handler groups and specs, `isAxiomMutation`, `axiom.mission.plan` long poll, `providerActivations`); the regenerated RPC catalog lists the same 41 `axiom.*` methods as main.
- Seam-check drops, verified against the trees: `AXIOM_INDEXES_AND_DELETE_TRIGGERS_SQL` (moved into the Axiom-owned `migrate-v44.ts`, which the check excludes); `isProviderActivated` 9 → 8 (upstream deleted the real-home hook sweep `setSystemCodexHomeHookSweepSuppressed`, whose suppression predicate was the ninth use; launch gating moved to `codex/codex-runtime-home-launch-preparation.ts`, rate-limit gating to `provider-account-services.ts`); `'axiom.cmd'` 17 → 15 (upstream deleted the unused `ssh-remote-cli-launcher.ts` and its test, `5651141700`). Baseline lowered with these notes; the check now reports 137 touchpoints, 0 dropped.
- Spot checks: telemetry client, preload telemetry API, build constants, electron-builder config, release channel and `mobile/app.json` carry no PostHog / stablyai / `com.stably` reference; `appId` `com.lapagayo.axiom`, productName `Axiom`; `.gitignore` keeps Axiom's `.axiom-work/*` entries and `/launchers/`; upstream workflows that Axiom stripped of `schedule:` / `push:` stay stripped. UD samples (`ipc/agent-trust.ts` → upstream pre-trust `21d4ae9448`; the Codex trust-rollback pair → `cfa43e7eab`; `structured-worker-child-identity-env.ts` → `structured-session-child-env.ts`; the C# Windows launcher → upstream's Rust `native/windows-cli-launcher/src/main.rs`) match the upstream commits named.
- B1 (blocking): upstream `9afd1101ff` removed the dispatch capability D11 relied on. The Worker stopped without a fail-open shim and recommended an Axiom-owned token adapter. Verifier position: recommend adopting upstream's process / session identity instead — see D73 (PROPOSED, needs Henry).
- Verifier fixes in the preparation commit for attempt 2: the new upstream `pt.json` catalog given the treatment the six catalogs got at merge start (41 keys en.json no longer has dropped, Orca → Axiom on 1,010 values; `upstream3-catalogs.py`), one upstream URL in `es.json` replaced by en.json's value, empty `cloud/` directories removed, seam baseline lowered as above, the `session:` assertion narrowed to the address form.

## Verdict
PARTIAL — not integrable. Continue: attempt 2 = M0 pass over shipped code (D74 option B's first half); B1 after Henry decides D73; vendor-egress treatment of upstream test samples after D74.
