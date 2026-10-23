# Task UPSTREAM-3 — baseline reset (D72), attempt 1: resolve the full merge of upstream/main and port Axiom's kernel seams

You are a Worker on the Axiom project (a product fork of stablyai/orca). This Task executes **D72** (`docs/decisions/DECISION_LOG.md`): one full merge of upstream `main` before M3-02. The verifier's launcher already ran the merge on the host and committed it with the conflict markers in place; you resolve it in the working tree. **Do not fetch, pull, merge, checkout, restore, stash, cherry-pick, `git rm` / `git add` or commit** — the sandbox cannot write `.git`; the launcher commits everything you leave in the tree (deletions included) when you finish.

## Where things are

- Revisions (`.axiom-work/upstream-3.target`): Axiom main at merge start `393c083ebd`, merge target upstream `41661e3312`, merge-base `3eb1adec20`. You are on `axiom/attempt/UPSTREAM-3/1`, which starts at the work branch `axiom/upstream-3/merge` (work commit 0 = the merge with markers, then the verifier's preparation commit).
- `.axiom-work/reports/UPSTREAM-3-inventory.md` — what the start script already resolved mechanically; do not redo it: the six locale catalogs (3-way JSON merge, Orca → Axiom on upstream strings), `package.json` (3-way; `check:vendor-egress-ratchet` kept in `lint`), `pnpm-lock.yaml` / `pnpm-workspace.yaml` (upstream's; installed on the host with pnpm 12.14.0), the 110 paths Axiom had deleted (`cloud/`, native mobile release workflows, `Casks/`) and 109 new upstream `cloud/` files (D33). Its review lists (lowercase `orca` in locale strings, keys upstream deleted that Axiom changed) are for the verifier; leave the catalogs alone unless a test needs a key.
- `.axiom-work/reports/UPSTREAM-3-dossier.md` — one entry per path left for you: class, Axiom vs upstream line counts, the Axiom commits that changed it (`codex(<ID>)` subjects name the Task: its brief is `.axiom-work/briefs/<ID>.md`, its report `.axiom-work/reports/<ID>-<seq>.md`, its integration record under `.axiom-work/verifications/`), recent upstream commits, and for files upstream deleted, the deleting commit and where the content moved when git could tell.
- `.axiom-work/scripts/upstream3-sides.sh <path> [--stat]` (read-only): Axiom's and upstream's diffs since the fork for one path, with the commits on each side.
- Markers: 544 conflict hunks in 301 files. 261 files carry **diff3** markers — `<<<<<<< axiom (main 393c083ebd)`, then `||||||| fork point (3eb1adec20)`, then `=======`, then `>>>>>>> upstream (41661e3312)`. 36 keep 2-way markers with the same labels (use the helper for the fork-point text). 4 were paired through a rename and keep git's labels, which name the old and the new path (`HEAD:<old path>` / `41661e33…:<new path>`).
- 91 **UD** paths: upstream deleted (or moved) a file Axiom changed; Axiom's copy is in the tree.
- Toolchain: `export PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH` first (the default shell resolves Node 26 / pnpm 10 placeholders). `node_modules` is already installed for the merged `package.json`. Typecheck with clean caches: `rm -f config/tsconfig.node.tsbuildinfo config/tsconfig.tc.cli.tsbuildinfo config/tsconfig.tc.web.tsbuildinfo` (plain `rm`, exactly these files), then `pnpm tc:node`, `pnpm tc:cli`, `pnpm tc:web`. The sandbox cannot run Electron; `listen EPERM`, process-inspection and FSEvents failures are environmental here.

Read before editing: D72 (this Task), D32 (branding — what is renamed and what never is), D21 (product identity), D25 (telemetry is a local no-op), D33 / D33a (deleted trees), D37 / D38 (cold-start zero egress, provider activation), D41 (upstream workflows lose `schedule:` / `push:` triggers), D14 / D15 (Control Plane as a session party; `axiom.*` mutations inside the contract fence), D12, and `docs/reference/orca-mapping.md` for the kernel seams.

## Objective — in this order; finish each before starting the next

1. **Every conflict resolved**: no line starting with `<<<<<<< `, `||||||| ` or `>>>>>>> ` anywhere in the tree, every AA file settled, every UD path decided.
2. **Axiom's kernel seams ported** to upstream's new structure (section "Kernel seams"; the design is fixed).
3. **Generated files regenerated**, never hand-merged.
4. **Typecheck green** — clean-cache `pnpm tc:node`, `pnpm tc:cli`, `pnpm tc:web` — including Axiom's own modules (`src/main/axiom/**` and friends) where an upstream API they call changed.
5. Only if budget remains: the focused tests in "Self-checks" and `pnpm lint`; fix failures the merge caused.

Not in this attempt (a later attempt does it for the whole tree): re-applying M0 dispositions to upstream code that merged **without** conflict — branding of new upstream user-visible strings, the `schedule:` / `push:` triggers of the 29 new upstream workflows, new vendor-egress needles (the ratchet currently reports about 148 new pairs), new telemetry events. Inside the files you resolve, apply them fully. List what you notice elsewhere under "For the M0 pass" in the report.

## Resolution rules

**R1 — brand-only files (152 UU, 56 UD).** Every line Axiom changed in the file since the fork is a product-name swap. Take upstream's text, redo Axiom's swaps on the corresponding upstream lines, and give new upstream user-visible text inside the resolved hunks the same treatment. D32 renames: the user-visible product name `Orca` → `Axiom`; the CLI `orca` → `axiom` (`axiom.cmd`, `axiom.exe`, dev `axiom-dev`, D21); the URL scheme `orca://` → `axiom://`; the release source `stablyai/orca` → `LaPaGaYo/Axiom` where Axiom's side shows it. Never renamed: identifiers, `ORCA_*` env vars, skill names (`orca-cli`, `orca-linear`, …), `orcad`, `orca.yaml`, `~/.orca`, test fixtures that are not user-visible, attribution and license text. When upstream deleted a brand-only file, accept the deletion (`rm`); if the dossier shows it moved, make the same swaps at the new location.

**R2 — substantive files (133 UU, 7 AA, 35 UD).** Find out why Axiom diverged (dossier commits → that Task's brief and report) and keep both intents on upstream's structure. Recurring cases:
- *Axiom ports of upstream fixes* (`codex(UPSTREAM-1)` / `codex(UPSTREAM-2)` commits; tables "已应用" in `docs/decisions/UPSTREAM_SYNC.md`): upstream's newer code wins; drop the port. The AA files `config/scripts/vitest-real-agent-home-write-guard.{ts,test.ts}`, `src/main/agent-trust-write-deadline.ts`, `src/main/codex/codex-hook-retired-commands.test.ts` and `src/main/startup/linux-secret-service-probe{,.test}.ts` came from these ports: take upstream's file, then re-add only Axiom-only behaviour that is still needed — the vitest guard must keep refusing writes under the real `~/.axiom` as well as every home upstream guards.
- *Identity (D21)*: Axiom's values win wherever they appear — app id / bundle id `com.lapagayo.axiom` (`.computer-use`, `.mobile`), productName `Axiom`, scheme `axiom://`, executables `Axiom` / `axiom-ide`, CLI `axiom`, release source `LaPaGaYo/Axiom`, Windows unsigned. Typical files: `config/electron-builder.config.cjs`, `electron.vite.config.ts`, `src/shared/release-channel.ts`, `src/types/build-constants.d.ts`, `src/main/updater*`, `mobile/app.json`, `native/windows-cli-launcher/*`, `config/scripts/electron-builder*.test.mjs`, `verify-dev-channel-packaging.test.mjs`, `release-cut-token-permissions.test.mjs`.
- *Telemetry (D25)*: `src/main/telemetry/**`, `src/preload/api/telemetry-api.ts`, `src/types/build-constants.d.ts`: no PostHog transport, no write key, `track()` stays a local validating no-op; take upstream's event and schema changes only where nothing leaves the machine.
- *Egress (D37)*: every use of `PRODUCT_EGRESS_POLICY`, `productReleaseRepositorySlug`, `resolveProductDocsUrl`, `isProviderActivated`, `recordProviderActivation`, `mayProbeAuthentication`, `probeCliAuthentication` that main has stays at the equivalent point (the seam check counts them).
- *Workflows (D41 / D33a)*: in `.github/workflows/*.yml` keep Axiom's removal of `schedule:` and `push:` triggers (and its `homebrew-bump.yml` / `release-*.yml` edits) while taking upstream's job changes; workflows Axiom deleted stay deleted. The workflow self-tests in `config/scripts/*workflow*.test.mjs` follow the workflow files.
- *`config/reliability-gates.jsonc`*: upstream rewrote it. Take upstream's file, then re-apply Axiom's changes (gates removed because their subject files went with `cloud/` — D33a — and any Axiom additions); `pnpm run check:reliability-gates` must pass.
- *`.gitignore`*: the union of both sides (Axiom's `.axiom-work/logs/`, `/launchers/` and its other entries stay).
- *`docs/site/**`*: upstream's content with D32 branding (M0-05b-2: pages Axiom removed stay removed; the install page says "pre-release: build from source").
- *`skill-guides/**`*: upstream's guides with D32 branding, then regenerate (R4).
- *Tests*: resolve them like the code they test; never delete an Axiom test to make a conflict go away — port it to the new API.
- A path that needs a product decision (for example, upstream deleted a subsystem an Axiom feature depends on): choose the smallest safe resolution that keeps the tree compiling and list it under "Blocked" in the report with file, line and the decision needed.

**R3 — UD files.** Follow the dossier fate: (a) upstream removed the feature → `rm` Axiom's copy and remove or retarget whatever still imports it; (b) upstream moved or split it → port Axiom's change to the new location(s), then `rm` the old path; (c) the file carries an Axiom feature whose host upstream removed → do not resurrect upstream's old code; the "Blocked" rule applies. `resources/skills/snapshot-registry.json` and `docs/reference/ci-runner-efficiency.md` follow (a) or (b) too. Record every UD decision in the report, one line each.

**R4 — generated files.** After their sources are resolved, regenerate with `pnpm run generate:rpc-params-catalog`, `pnpm run generate:bundled-skill-guides`, `pnpm run generate:skill-bundle-manifest` and `pnpm run sync:localization-runtime-catalog`; `config/scripts/ci-shard-timings.json` = upstream's file minus entries for test files that do not exist in the merged tree. `pnpm run verify:rpc-params-catalog` must pass and the catalog must still list every `axiom.*` method.

## Kernel seams (the design is fixed — D72 ④ and D14)

1. **Schema renumbering** (`src/main/runtime/orchestration/db/`):
   - `schema/migrate-v43.ts` = upstream's file byte for byte (`session:<id>` → `orca_session_id:<id>` respelling; idempotent).
   - Axiom's steps move up one, bodies unchanged except name and gate: Axiom's old `migrate-v43.ts` (side-table indexes and delete triggers) → `schema/migrate-v44.ts` (`migrateV44`, `if (current >= 44) return`); old `migrate-v44.ts` (`agent_specs.spec`, `mission_policies.routing`) → `migrate-v45.ts`; old `migrate-v45.ts` (`verification_runs` claim columns) → `migrate-v46.ts`. Get the old bodies with `git show 393c083ebd:<path>`.
   - `contract-constants.ts`: `SCHEMA_VERSION = 46`; comment lines upstream's `// v43: …`, then `// v44: Axiom Control Plane side tables (missions … audit_events).`, `// v45: canonical AgentSpec and Mission routing policy JSON.`, `// v46: durable VerificationService claims and isolated worktree ownership.`
   - `schema/migrate.ts`: call `migrateV43` … `migrateV46` in order, then this backfill, inside the same transaction:
     ```ts
     // Why: Axiom builds before UPSTREAM-3 numbered Axiom's own steps 43–45, so a database they wrote reports 43–45
     // without upstream's v43 address respelling. The respelling is idempotent and its WHERE clauses are the probe.
     if (current >= 43 && current <= 45) {
       migrateV43.call(this, 42)
     }
     ```
   - Tests (temporary directories only): a database shaped like an old Axiom build at `user_version = 45` (Axiom side tables present, `messages.from_handle = 'session:<id>'`, a `run_coordinator_handles` row with a `session:` handle) migrates to 46 with every address respelled and the `verification_runs` columns present; one at 43 in the old Axiom numbering ends the same; upstream's migration tests pass with `SCHEMA_VERSION` 46; Axiom's migration tests (`axiom-tables-migration.test.ts`, …) use the new numbers. No hand edits of persisted state anywhere (dev and e2e databases go through this path).
2. **Session address (D14)**: `src/main/axiom/execution/mission-caller.ts` builds the address with `formatOrcaSessionAddress` from `src/shared/orca-session-address.ts`; no hardcoded prefix. Axiom tests that spell `` `session:${id}` `` use the helper (or the literal `orca_session_id:` where they assert stored text). Afterwards ``git grep -n -e "'session:" -e '`session:' -- src/main/axiom src/shared/axiom-contract src/cli tests/e2e`` prints nothing.
3. **§4b admission guards**: every `assertNotMissionManaged`, `assertTaskCreateAllowed`, `assertWorkerMessageAllowed` and `assertResetAllowed` call that main has (`git grep -n -E "assert(NotMissionManaged|TaskCreateAllowed|WorkerMessageAllowed|ResetAllowed)" 393c083ebd -- src/main/runtime`) survives at the equivalent point of upstream's code — before the first mutation, with the same verb string.
4. **M2-01 service-only seam**: Axiom moved the worker start / stop / release logic into `src/main/runtime/rpc/methods/orchestration/worker/{control-plane-worker-start,local-worker-stop,local-worker-release}.ts` and kept the RPC handlers in `local-worker-start.ts`, `worker-stop.ts` and `worker-release.ts` thin. Keep that shape; port upstream's behaviour changes in those handlers into the extracted Axiom functions.
5. **Control Plane wiring**: `startAxiomControlPlane` / `stopAxiomControlPlane` in `src/main/orcad/orcad-entry.ts` and `src/main/startup/main-process-runtime-service.ts`; the `AXIOM_METHODS` registration; `AXIOM_HANDLER_GROUPS` and the `AXIOM_*_COMMAND_SPECS` in the CLI; `isAxiomMutation` (D15 contract fence); `'axiom.mission.plan'` as a long poll in `runtime-rpc-long-poll.ts`; `providerActivations` in settings. All stay.

`python3 .axiom-work/scripts/upstream3-seam-check.py` counts these touchpoints against the baseline from main (`.axiom-work/upstream-3-seams.tsv`) and must report 0 dropped; where upstream's restructuring legitimately merged two call sites, explain each drop in the report.

## Self-checks (run them and paste the results into the report)

- `git grep --untracked -n -I -E '^(<{7}|[|]{7}|>{7})( |$)' -- . ':!.axiom-work/**'` → nothing.
- `python3 .axiom-work/scripts/upstream3-seam-check.py` → 0 dropped.
- Clean-cache `pnpm tc:node`, `pnpm tc:cli`, `pnpm tc:web`.
- `pnpm run verify:rpc-params-catalog`, `pnpm run check:reliability-gates`.
- `pnpm test src/main/runtime/orchestration/db src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/cli/handlers/axiom src/cli/specs config/scripts/vitest-real-agent-home-write-guard.test.ts` — never the whole suite.
- `pnpm lint` (expected to stay red on `check:vendor-egress-ratchet` until the M0 pass; report the other failures).

## Rules

- Write only to the working tree, through edits, plain `rm` and `mv`. To take one side of a file wholesale: `git show 41661e3312:<path> > <path>` or `git show 393c083ebd:<path> > <path>`. Never `git checkout`, `git restore`, `git rm`, `git add`, `git stash`, `git reset` or `git clean`.
- Leave unchanged (the verifier merged or owns them): `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `AGENTS.md`, `README.md`, `docs/decisions/**`, and `.axiom-work/**` except your report. If a dependency is missing or a script name changed, report it instead of editing these.
- No `pnpm install/add/remove/rebuild/update/dedupe`, no new dependencies, no edits or symlinks under `node_modules`, no pnpm or node scripts outside the checkout.
- No `pnpm format` and no formatter over files you did not change; no `@ts-nocheck`; no `as` casts without a `SAFETY:` comment; no `// vendor-egress-ratchet: allow` markers and no new lines in `config/vendor-egress-baseline.txt` (it may only shrink); do not weaken the vitest real-home write guard; tests use a temporary HOME / userData only.
- `src/main/axiom/**` and `src/shared/axiom-contract/**` change only where an upstream API they use changed, keeping their behaviour (D12: Axiom code stays out of the `@ts-nocheck` runtime files).
- Work order: `src/main/runtime/orchestration/**`, `src/main/runtime/rpc/**`, the rest of `src/main/runtime/**`, `src/shared/**`, `src/main/**`, `src/preload/**`, `src/types/**`, `src/cli/**`, `src/renderer/**`, `config/**`, `tests/**`, `.github/**`, `skill-guides/**`, `resources/**`, `docs/site/**`, `mobile/**`, `native/**`, root files.
- Budget: if you cannot finish, stop at a file boundary with every file you touched fully resolved and list what remains under "Remaining" — the next attempt continues from your tree.

## Submission

Leave everything uncommitted and write `.axiom-work/reports/UPSTREAM-3-1.md`:
1. Counts: conflicts resolved, UD paths decided, files remaining.
2. Kernel seams: what you did for each of the five, with file:line.
3. Decision log, one line per substantive or UD path: `path — kept from Axiom / taken from upstream / ported to <path> — why`. Brand-only files by count only, plus any exception.
4. Self-check results (command, pass / fail, failing names), each failure classified: caused by the merge / environmental in the sandbox / for the M0 pass.
5. "For the M0 pass": new upstream user-visible `Orca` strings, identities, endpoints and workflows you noticed outside your files.
6. "Blocked" and "Remaining", if any.

## Attempt 2 addendum (verifier, 2026-10-22) — the M0 pass over shipped code

Attempt 1 (`da5d2c72a9`; your report `UPSTREAM-3-1.md`; review `.axiom-work/verifications/UPSTREAM-3-1.md`) resolved every conflict and the kernel seams. Two items stay open and are **not** in this attempt: B1 (upstream removed the dispatch capability — waiting for Henry on D73; leave Axiom's attempt-authority code and its failing tests as they are) and the vendor-egress treatment of upstream test samples (D74, pending). The sections above are background; objectives 1–3 and the kernel seams are done — keep them done.

Verifier changes on top of your commit: `pt.json` (a new upstream catalog) given the treatment the six catalogs got at merge start (`upstream3-catalogs.py`: 41 keys en.json no longer has dropped, Orca → Axiom on 1,010 values) and one upstream URL in `es.json` replaced by en.json's value; seam baseline lowered with notes (your three explanations held); empty `cloud/` directories removed; D73 / D74 proposed; `.axiom-work/reports/UPSTREAM-3-m0-candidates.md` written for this attempt.

### Objective (attempt 2): re-apply the M0 dispositions to upstream code that merged without conflict — shipped code only

1. **Vendor egress** — remove the 23 shipped-code pairs in the candidates report §1 by the M0 rules:
   - identities → D21 values: launchd / daemon labels `com.stablyai.orca.*` → `com.lapagayo.axiom.*` (keep the suffix structure), the terminal host bundle identity, anything that names the app to the OS; tests that assert them follow, and nothing else may still compare against the old prefix (`git grep com.stablyai`);
   - endpoints → `PRODUCT_EGRESS_POLICY` / `resolveProductDocsUrl` / `productReleaseRepositorySlug` (`src/shared/product-egress-policy.ts`) or removal, the way M0 treated the same kind of reference elsewhere; the mobile App Store / GitHub release update sources point at Axiom's release source or are disabled as M0-05a disabled the Android download;
   - telemetry → removed (D25): `config/scripts/release-javascript-artifact.mjs` neither requires nor hashes a PostHog key; the PostHog entry in `locale-ko-key-overrides.json` follows what the catalogs did;
   - comments citing upstream issues (`stablyai/orca#N`) → `upstream orca#N` (keeps the provenance, drops the identity);
   - `src/shared/portuguese-ui-language-migration.ts` keys on upstream's plugin id `plugin:stablyai.orca-portuguese/pt-BR`, which Axiom never shipped: remove the migration with its call sites and test, or keep it and say why in the report;
   - npm package names under the `@stablyai/` scope (`@stablyai/playwright-test` in `check-workspace-layout-rules.mjs`) stay; they belong to the D74 bucket.
2. **Workflows (D41)** — the five in §3 lose `push:` / `schedule:` and keep `workflow_dispatch` / `workflow_call` / `pull_request`; update any workflow self-test in `config/scripts` that asserts those triggers.
3. **Branding (D32) of new upstream user-visible text** — §4 lists 772 candidate lines in 414 files. For each: the product name → `Axiom`; CLI invocations in user-visible text → `axiom …`; `orca://` → `axiom://`; the never-renamed list of R1 holds. Leave false positives (identifiers inside strings, attribution) and name the notable ones in the report. Change i18n call-site defaults together with their en.json values (M0-05b-1 method: keys unchanged). Update tests that assert a changed string. `skill-guides/**` sources (e.g. `jira-tickets.md`, `orca-jira.md`): brand, then `pnpm run generate:bundled-skill-guides` and `pnpm run generate:skill-bundle-manifest`. `docs/site/**`: new pages and sections per D32.
4. **Lowercase `orca` in the catalogs** — the inventory's "upstream string with lowercase orca" lists for the six catalogs and `.axiom-work/reports/UPSTREAM-3-pt-orca-review.md` for `pt.json`: CLI command names in user-visible text → `axiom`, `orca://` → `axiom://`; `orca.yaml`, `.orca/…`, `~/.orca`, skill ids and `orcad` stay. Edit those values in place; no other catalog edits.

Also not in this attempt: the release workflow's signing debt (`TODO(M0-03)`) and the default visibility of new upstream features (a separate review).

### Sandbox commands that work (found in attempt 1)

`pnpm tc:*` and `pnpm test` stop in `build:packages` (tsx's CLI opens an IPC pipe: `listen EPERM`). Instead, in `src/packages/process-host` run `node --import tsx --conditions=orca-source scripts/build-dist.mjs`; then from the root `node config/scripts/run-typecheck-projects-in-parallel.mjs --project=config/tsconfig.node.json --project=config/tsconfig.tc.cli.json --project=config/tsconfig.tc.web.json`, and tests with `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --configLoader runner --no-cache <targets>`. `tc:node` stays at the 53 B1 errors; any other error is yours to fix.

### Self-checks for attempt 2

- `node config/scripts/check-vendor-egress-ratchet.mjs`: no new or grown pair outside the D74 bucket (tests, fixtures, `config/reliability-gates.jsonc`, `config/scripts/ci-shard-timings.md`, `@stablyai/` package names).
- `python3 .axiom-work/scripts/upstream3-seam-check.py` → 0 dropped.
- The three typechecks: nothing beyond the 53 B1 errors.
- `pnpm run verify:rpc-params-catalog`, `verify:bundled-skill-guides`, `verify:skill-bundle-manifest`, `check:reliability-gates`.
- Tests next to every file you change, the `config/scripts` workflow tests and `src/renderer/src/i18n`.
- `pnpm lint` (or its parts through the loader commands): everything before the ratchet stays green; report the ratchet's remaining pairs.

### Submission (attempt 2)

Write `.axiom-work/reports/UPSTREAM-3-2.md` (keep `UPSTREAM-3-1.md`): what you did for each §1 pair; the workflows; branding counts per area and the false positives you left; the catalog edits; self-check results; anything that bears on B1 or D74. The main brief's rules still apply (no git writes, no pnpm install, protected files untouched, no formatter over unchanged files, no `as` without `SAFETY:`, no allow markers, no baseline growth).

## Attempt 3 addendum (verifier, 2026-10-22) — B1 per D73, with D74 in place

Henry accepted **D73 option B** and **D74 option B** on 2026-10-22 ("D73 B、D74 B"; `docs/decisions/DECISION_LOG.md`). Attempt authority follows upstream's host-verified caller identity; Axiom does not rebuild the dispatch capability. The verifier has re-entered upstream's test samples and provenance links in `config/vendor-egress-baseline.txt` (D74; `.axiom-work/reports/UPSTREAM-3-egress-rebaseline.md`), so the ratchet now passes in full — any pair it reports is yours. Attempts 1 and 2 (conflicts, kernel seams, M0 pass; review `.axiom-work/verifications/UPSTREAM-3-2.md`) are done; keep them done.

### Environment rules after attempt 2

- Never edit `config/patches/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `mobile/package.json` or `mobile/pnpm-lock.yaml`. A patch edit changes its pnpm hash, the lockfile stops matching, and every `pnpm run` then starts an install that empties `node_modules` in the sandbox — that is what happened in attempt 2. The verifier restored upstream's `ws` patch and reinstalled the root and `mobile/` dependencies on the host just before this attempt.
- If any `pnpm` command starts resolving or installing dependencies, or prints "Cannot proceed with the frozen installation", interrupt it at once, do not retry it, use the loader commands from the attempt-2 addendum, and report it.

### Objective (attempt 3)

1. **`src/main/axiom/execution/attempt-authority.ts` — `resolveAttemptIdentity`.** Remove `orchestrationCapability` from `SenderInput`, the `verifyDispatchCapability` call and the hash comparison in `verifySubmissionReplay`. The authority check becomes upstream's worker-report rule on the Attempt's dispatch, reused rather than restated:
   - `workerReportRefusal` from `src/main/runtime/orchestration/worker-report-admission.ts` with the dispatch's worker state and `processCurrent` = (`!dispatch.process_incarnation` or `db.isDispatchProcessCurrent({ dispatchId, paneKey: sender.paneKey ?? null, processIncarnation: runtime.getTerminalProcessIncarnation(from) ?? null })`); a refusal throws its own code (`dispatch_inactive` / `worker_identity_changed`);
   - when the dispatch records no process incarnation, the caller must be the dispatch's message sender (`db.isDispatchMessageSender`), as in `messaging/send-point-to-point.ts`;
   - without a host-verified session caller, the lifecycle caller fence comes first (`assertLifecycleCallerIsNotAnotherParty` in `rpc/methods/orchestration/messaging/lifecycle-caller-fence.ts`, with the request's compatibility evidence) — the order upstream's `ask` uses (`messaging/ask-methods.ts`);
   - a structured (session) Worker is authorized the way upstream authorizes a structured worker's report (its host-resolved Orca session against the dispatch's assignee session); find that path and use it.
   Keep every Axiom check: binding lookup, `inactive_dispatch`, `stale_dispatch`, `hasLifecycleAuthority`, Mission / Task / Run consistency, mutation receipts. Replay of a settled Attempt's own Submission (`allowSubmissionReplay`) requires the dispatch's recorded pane and the same process incarnation, and refuses otherwise with `worker_identity_changed` (upstream removed `dispatch_capability_invalid`).
2. **Remove the capability plumbing.** `orchestrationCapability` leaves `src/main/runtime/rpc/methods/axiom/**` and `src/main/axiom/execution/{attempt-ask,attempt-submission,planner-proposal}.ts`; the CLI handlers `src/cli/handlers/axiom/{attempt,attempt-ask,plan}.ts` stop requiring `--dispatch-capability` and the Axiom command specs (`src/cli/specs/axiom-*.ts`) drop the flag — Axiom has no older host to serve; update help text, the RPC params catalog if params change, and the CLI tests. The Worker and Planner instructions in `src/main/axiom/context-builder/{render,planner-render}.ts` drop `--dispatch-capability {{dispatchCapability}}`, `attempt-launcher.ts` stops filling it, and their snapshots are regenerated. Afterwards `git grep -n -E "dispatchCapability|orchestrationCapability|dispatch-capability" -- src tests` may show only upstream's own CLI compatibility forwarding; list what remains and why.
3. **Tests.** Rewrite each capability-era case as its identity equivalent, keeping its intent:
   - accepted and idempotent on retry: the bound Worker's `submit`, `ask`, `blocked`, `handoff`, `inform`, `request`, `request-subtask`, `check`; the Planner's `plan propose --attempt`;
   - refused: a caller from another Attempt's process; the same pane after its process changed (another incarnation); another orchestration party's terminal (a Run coordinator, another Dispatch's worker); a `stopping` worker; a stale Attempt (a newer Attempt owns the Task); a settled Attempt, except a replay of its own Submission from the same pane and process.
   Fixtures stop expecting `prepareStartingWorkerAuthority` to return a token (it returns nothing now); use the identity fixtures upstream's own tests use. All 16 files that failed in attempt 1 must pass.
4. **Test triage from attempt 2's verification** (after 1–3). Run these and fix what the merge or the M0 pass broke; for anything environmental, reproduce it alone and put the error in the report: `config/scripts/{macos-terminal-host-bundle,ci-pr-concurrency-keys,ci-managed-ssh-execution,dependency-security-release,agent-state-rules-bundle,verify-skill-update-roundtrip,verify-cli-bin,pr-preflight-gates,pr-code-change-scope-format-route,pr-auxiliary-preflight-admission,mobile-web-terminal-engine-closure}.test.mjs`, `config/scripts/{main-entry-facade,process-host-dev-rebuild}.test.ts`, `config/scripts/build-mobile-web-app-bundle.test.mjs` and `config/scripts/mobile-web-app/**` (now that `mobile/` is reinstalled), and the daemon PTY tests `src/main/daemon/{repro-13767-shell-ready-marker-lost-to-exec,shell-ready,shell-ready-bash-wrapper,bash-prompt-command-composition,daemon-appimage-generation-launch,macos-daemon-launchd}.test.ts` if the sandbox can spawn shells (otherwise list them for the host).
5. **Not in scope:** verifying the caller through the socket peer process (D73 ④, DEF-25), any change to upstream's own worker-report rule, anything outside Attempt authority and the triage list.
6. **Docs:** in `docs/reference/orca-mapping.md`, update the rows that describe Axiom's use of the dispatch capability (D11 / D14 / D15 / §4b) to the identity model — factual and short. The verifier owns the decision log.

### Self-checks for attempt 3

Use the sandbox commands from the attempt-2 addendum. All three typechecks: **0 errors**. The attempt-1 focused test command plus `src/main/axiom/context-builder` and `src/main/runtime/rpc/methods/orchestration`: green. The triage list: fixed or evidenced. `python3 .axiom-work/scripts/upstream3-seam-check.py`: 0 dropped. `node config/scripts/check-vendor-egress-ratchet.mjs`: passes. `pnpm lint` (or its parts): passes. The `git grep` above as described.

### Submission (attempt 3)

Write `.axiom-work/reports/UPSTREAM-3-3.md`: the new authority check with file:line; the plumbing removed; the test mapping (old capability case → new identity case); the triage results; self-check results; anything left.

### Attempt 3 re-run note (verifier, 2026-10-22 21:50)

The first run of attempt 3 stopped after five minutes with "Selected model is at capacity"; the launcher committed what it had (`37bbf68bc0`: two test files and an in-progress report). This run continues on the same branch from that commit — keep what is useful, finish the objective, and replace the in-progress report with the full `UPSTREAM-3-3.md`.

Since then Henry accepted **D75**: V1 ships the desktop only; the phone companion stays dormant (not deleted) and the desktop package will stop embedding the mobile web bundle in a follow-up task. For this attempt that means: the `config/scripts/mobile-web-app/**` and `build-mobile-web-app-bundle` failures do not block — do not spend effort fixing them; give each failing file one line in the report (the error, and whether it reproduces alone). Everything else in the triage list still has to be fixed or evidenced, and two more files joined it in the partial run's verification: `src/main/runtime/rpc/methods/orchestration/worker/{failed-start-retry-release,worker-start-readiness-settlement}.test.ts`.


## Attempt 4 addendum (verifier, 2026-10-22) — two fixes, then stop

Attempt 3 (`45df53b579`; review `.axiom-work/verifications/UPSTREAM-3-3.md`) resolved B1: on the host all three typechecks, the full lint, the ratchet and every sidecar assertion pass. Two host test failures are real — fix exactly these:

1. `tests/e2e/helpers/fixture-plan-proposal.unit.test.ts` still calls the test provider's `submitFixture('attempt-1', 'dcap_fixture', 'mission-1', 'task-1')`. Attempt 3 dropped the capability parameter (`tests/e2e/helpers/axiom-test-provider.ts`: `submitFixture(attemptId, missionId, taskId)`), so the arguments shift and the crash marker for `task-1` is never consumed (`expected true to be false` inside the stub spy). Update the call(s) and expectations. Then search `tests/e2e/**` and `src/**` for every other caller of the provider functions whose signature attempt 3 changed — including the Electron specs `tests/e2e/*.spec.ts` and their helpers, which cannot run in the sandbox: make them consistent by reading.
2. `config/scripts/ci-closed-pr-cancellation.test.mjs` still expects the concurrency key `cloud-verify-refs/pull/<n>/merge`, but attempt 3 removed the deleted `cloud-verify.yml` (D33a) from `.github/workflows/ci-closed-pr-caches.yml`. Make the test agree with the workflow; keep every other key.

Host test runs use upstream's pinned Bun (`config/scripts/run-vitest.mjs` → `bun --bun vitest`). Run your targets the same way if the sandbox allows, otherwise with the loader command from the attempt-2 addendum, and say which you used.

Known and not yours: the D75 mobile-web-app failures (the host also lacks the merged Playwright version's browsers); the three macOS bash-3.2 failures (`ci-managed-ssh-execution`, `dependency-security-release`, `pr-auxiliary-preflight-admission`); the daemon PTY tests and `process-host-dev-rebuild` (the verifier re-runs them alone on the host). The environment rules of the attempt-3 addendum still apply (no edits under `config/patches/`, no manifest or lockfile edits, interrupt any pnpm auto-install).

Self-checks: the two files pass; `tests/e2e/helpers` and the `config/scripts/ci-*` tests pass; the typechecks stay at 0 errors; lint passes. Write `.axiom-work/reports/UPSTREAM-3-4.md`: the changes, the other callers found and updated, the test results and the runner used.

## Attempt 5 addendum (verifier, 2026-10-23) — what the full host verification found

Attempt 4 (`166514d016`) passed its sidecar. The full host verification of that candidate (`.axiom-work/verifications/UPSTREAM-3-full.md`) passed the M1/M2 exit e2e, the five fixture e2e specs, dev-build cold-start egress on three stacks (`{}`) and a real Codex Planner run. It found three groups of gaps; fix all three. Attempts 1–4 are done; keep them done. The environment rules of the attempt-3 addendum still apply.

### What the verifier established

- **Full suite**: 82 failing files / 225 tests. The verifier ran the same 75 non-cross-version files on a pristine upstream checkout (`41661e3312`) on the same host: **50 tests in 13 files fail identically on upstream** (environmental: real zsh/bash PTY startup, macOS bash 3.2, `/var` vs `/private/var`, the process-host dev rebuild) — not yours. **162 tests in 64 files fail only on the merge** — yours. Every test, with its first error line, is in `.axiom-work/reports/UPSTREAM-3-fullsuite-classification.md`. Also not yours: the 6 cross-version-wire files (upstream release tags; Axiom fetches upstream with `--no-tags`) and `mobile-web-app-drawer-render` (Playwright browser build missing).
- **Packaging**: `build:unpack` stops in Axiom's `afterPack` asar contract: `app.asar unexpected root entries: opencode.json` (a root file upstream added in `822fc5bed4`).
- **Packaged cold start** (foreground 75 s, fresh profile): two connections, both new since the M0 run (`{}`), both against D37 (no request before the user configures a provider or integration, or acts):
  - `github.com` — the agent-state-rules live update (`src/main/runtime/agent-state-rules/agent-state-rules-live-update.ts`): on by default in packaged builds (`isPackaged && settings.agentStateRulesLiveUpdates !== false`), started from `src/main/startup/main-process-runtime-service.ts` and `src/main/orcad/orcad-entry.ts`;
  - `www.google.com` — Google's s2 favicon service: `https://www.google.com/s2/favicons?domain=…` in `src/renderer/src/lib/agent-catalog.tsx`, `src/renderer/src/lib/open-in-app-catalog.tsx`, `src/shared/repo-icon.ts`.

### Objective (attempt 5)

1. **The 162 merge-caused tests pass, without weakening what they check.** Their causes:
   - **Branding copy (D32).** User-visible copy is Axiom, so a test that asserts "Orca" copy now asserts the Axiom copy. Where a phrase was rebranded in one place and not in its twins, make every user-visible occurrence agree — e.g. `'Remote Orca runtime closed the connection.'` is still produced by `remote-runtime-client-handshake.ts`, `remote-runtime-shared-control-protocol.ts` and `remote-runtime-terminal-multiplexer-base.ts` while `remote-runtime-request-frames.ts` says Axiom. `.axiom-work/reports/UPSTREAM-3-rebrand-leftovers.txt` lists every literal whose old bytes survive somewhere; most hits are comments, identifiers, i18n keys, import paths or skill names, and those stay as they are (D32).
   - **Persisted or parsed strings keep upstream's bytes** — they are identifiers under D32. The journal truncation marker: `journal-payload-bounds.ts` writes `[Axiom: output truncated …]` while `src/shared/structured-agent-session-projection.ts:72` matches `[Orca: output truncated …]`; restore upstream's marker, the streamed marker in `agent-session-delta-coalescer.ts` likewise, and the tests attempt 2 changed for them. The CLI retry advice is the opposite case — user-visible copy: `src/cli/runtime/transport.ts:85,98` still write "Restart Orca and try again." while `agent-launch-recovery.ts:78` and `orchestration-mutation-recovery.ts:217` strip "Restart Axiom and try again."; brand the writer, and make the test assert the Axiom phrase is gone. Look for any other reader (regex, `replace`, `includes`, `startsWith`, `===`, `switch`) of a literal attempt 2 rebranded, and list what you found.
   - **Axiom seams under upstream's new fixtures.** Upstream's new tests stub the store or runtime with only what upstream calls. `recordProviderActivation` (M0-09) needs `store.getSettings` / `updateSettings` in `pty-launch-parity` (31), `codex-account-restart-resume` (5) and `tests/e2e/terminal-account-restart.unit.test.ts`; `startAxiomControlPlane` (from `orcad-entry.ts`) needs `runtime.getOrchestrationDb` in `orcad-duplicate-pty-repair-startup` (4); Axiom's own `main-process-ready-runtime-activation.test.ts` needs `store.getProfileStorageDirectory`, which upstream now calls. Fix the test double — the minimal stub, once in a shared builder if the test has one — or `vi.mock` the Axiom module at the seam where the test is not about it. Do not make kernel or Axiom production code tolerate a fake.
   - **Upstream registries that must list Axiom.** `src/shared/host-operation-ownership.ts`: classify the `axiom` RPC namespace (41 methods unclassified, which callers treat as fail-closed) by where Axiom's methods run — the runtime that owns the orchestration DB — after reading how the classification is consumed. `src/shared/wsl-move/wsl-move-dispositions.ts`: map `src/main/runtime/orchestration/db/schema/create-axiom-tables-sql.ts` to its database and give each Axiom table the disposition upstream gives the orchestration tables beside it.
   - **Deliberate Axiom behavior (M0 / D37) under upstream's new tests**: keep each test's intent and express Axiom's behavior — e.g. `profile-cloud-auth-characterization` (skill sharing is unconfigured in Axiom builds: give the test a configured endpoint so it still exercises the 401 retry), `LinearAgentSkillSetupPrompt` (the install command comes from the product policy, not `stablyai/orca`), `agent-state-rules-live-update` (item 3).
   - **Investigate, then fix or explain**: `profile-state-offline-settings` (6) and `profile-project-domain-transfer` (3) — the raw Portuguese marker is migrated where upstream keeps it, yet the production files involved differ from upstream only in copy and `providerActivations`, so find what does differ; the skill-freshness group (`skill-freshness-inventory`, `agent-skill-nav-install-status`, `AgentSkillSetupPanel.freshness`, `FloatingTerminalOrchestrationDialog.freshness`: `installed` instead of `update-available`); `rate-limits/service-refresh-orchestration` (2); `appimage-copy-pre-extraction` (4) and `appimage-serve-preparation` (2); `orchestration-mutation-recovery` (the portable recovery command ignores a configured Windows executable); `SshHostRestartServerAction` (3); `MobilePage` (3) and `MobileHero` (1) — if the cause is copy, fix it; if it is the M0 relay removal, report it and leave the pairing UI to the D75 hygiene task. Each gets its cause in the report.
2. **Packaging.** Exclude `opencode.json` from the app in `config/electron-builder.config.cjs` `files`, beside the other root tool files, and extend the existing test that enumerates excluded root entries (`config/scripts/electron-builder-config.test.mjs`, `check-root-directory-entries.test.mjs`). `verify-packaged-app-asar-contents.cjs` stays as it is.
3. **Cold start (D37).**
   - Agent-state-rules live updates become opt-in: fetch only when `agentStateRulesLiveUpdates === true`; otherwise the bundled rules, on both start paths. Tests follow the opt-in default; the URL test expects the product's release repository (the ratchet forbids the vendor one).
   - No Google favicon requests. Agent catalog, open-in-app catalog and repo icons render a bundled icon where the repository ships one, otherwise their existing fallback; no other third-party image host takes Google's place. A recognizer that drops already-stored Google favicon URLs may stay.
   - Name in the report what rendered a favicon in a fresh profile's first 75 seconds.
4. **Not in scope**: the 50 environmental tests; the cross-version harness; the drawer render test; the terminal-host CDHash fallback of unsigned local builds; D75 pairing UI; dependencies, patches and lockfiles; `config/vendor-egress-baseline.txt` (pairs you remove only show as "Stale baseline", which does not fail; the verifier shrinks the baseline at integration).

### Self-checks (attempt 5)

Sandbox commands from the attempt-2 addendum; say which runner you used.
- `tc:node` / `tc:cli` / `tc:web`: 0 errors.
- The sidecar targets (they now cover the 62 files whose failures are all merge-caused, plus the directories your fixes touch): green.
- `src/main/runtime/orca-runtime.test.ts` and, if the sandbox can run live shells, `src/main/zsh-deferred-startup-line-init.live-shell.test.ts`: only the tests listed as environmental in the classification may fail.
- Seam check 0 dropped; ratchet passes; `pnpm lint` (or its parts) passes; `git grep -n -F 'google.com/s2/favicons?domain' -- src ':!*.test.*'` prints nothing.

### Submission (attempt 5)

Write `.axiom-work/reports/UPSTREAM-3-5.md`: for each cause group, the files changed and why; each investigated test and its cause; the persisted or parsed literals found and what you did with them; what rendered the favicon; self-check results; anything left.
