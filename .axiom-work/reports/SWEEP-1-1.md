# SWEEP-1 — Attempt 1

Base: `main` / `f1cd6481140683ffcfdf120bb3aa97eda0fa29d0`. Assigned branch: `axiom/attempt/SWEEP-1/1`. Work stays in the assigned checkout. No other model or external reviewer was invoked. No dependency was installed, and no shared contract or existing test file was changed.

## Execution and delivery state

The planner brief is the execution-ready M4 unit: recover missed admission and integration requests through the existing reconcile tick, preserve event-triggered refusal history, and avoid duplicate sweep refusals. No new timer or durable state is needed. The implementation follows its eight deliverables; the verification path is the nine new tests, baseline red check, unchanged timer tests, both unit runners, three compiler runs, quality/lint, scope checks and the earlier-task union. Host Mission e2e and independent acceptance remain the verifier responsibility. The launcher owns the commit; no merge, promotion or delivery is performed here.

Implementation and all required local validation are complete. Delivery state: ready for the launcher to commit and the independent verifier to assess, on the assigned branch with the worktree preserved. M4/SWEEP-1 acceptance remains pending that independent review and host Mission e2e; no milestone, Mission, integration or delivery completion is asserted by this Worker.

## Files and mechanism

- `src/main/axiom/scheduler/scheduler-contract.ts`: moves the four exported types unchanged, except for the final `sweep` member of ScheduleTrigger; its only import is the BudgetExhaustion type.
- `src/main/axiom/scheduler/scheduler.ts`: imports its three used types and re-exports all four through the original import path. The two behavior statements change: pending sweep uses `active.pending ?? trigger`, preserving an already waiting event; a sweep only calls the existing refusal audit when admissionRefusalRecorded is false. The audit call, round order, check/block/admit methods and scheduler.round behavior remain. Formatted size: 289 non-blank lines, including comments.
- `src/main/axiom/scheduler/admission-refusal.ts`: compares latest Task refusal against latest Task stage sequence and exact JSON text, using the existing read-model store query. Read-only and stateless.
- `src/main/axiom/scheduler/mission-sweep.ts`: e2e hold gate, executing-Mission enumeration, unawaited sweep requests, and bounded warnings without error contents.
- `src/main/axiom/control-plane-boot.ts`: one import and the existing interval callback now calls reconcile then sweepExecutingMissions. Five added lines and one removed line; boot reconcile, resume rounds, unref and stop stay unchanged.
- `src/main/axiom/scheduler/scheduler-sweep.test.ts`: six real-Scheduler tests.
- `src/main/axiom/control-plane-boot-sweep.test.ts`: three real-plane timer tests.
- `docs/reference/control-plane.md`: the new Scheduler sweep section and corrections to earlier descriptions.
- This report.

## Acceptance tests and fixture paths

The Scheduler fixture mirrors scheduler.test.ts: deterministic generated ids, real in-memory OrchestrationDb/AxiomStore/MissionController, the approved 12-Task fixture started through the controller, a real ArtifactStore in a temporary directory, real ContextBuilder and AgentFactory with installed-provider injection, a readRepositoryRules spy, RulesEngine, real Scheduler and EffectOutbox. The outbox is not started: admissions enqueue real effects without launching Workers. afterEach stops it, restores spies/environment, closes the database and removes the directory. No fake timers in these six tests. ContextPackages are counted with a mission-scoped SQL query; other durable objects use existing store reads.

1. `a sweep round does not repeat a refusal that has not changed`: set installed providers to empty; stage_change refuses all three READY roots. Snapshot the whole Mission audit, effects, bindings, specs, ContextPackage count and stages. Sweep preserves that snapshot; policy appends a second refusal for every root.
2. `a sweep round writes a refusal whose data changed`: begin with no installed providers and Codex disallowed. After the first round, install Codex, which remains disallowed. Sweep appends one new refusal per root with changed installed/filtered data; the next sweep preserves the entire snapshot.
3. `a sweep round writes the first refusal after the Task changed stage`: a question gate initially holds T03; T01/T02 are refused. Move T01 READY → BLOCKED → READY through the controller and confirm its newer task.stage sequence. Resolve the T03 gate. Sweep records T01 again with the same data after the new stage and writes T03 first refusal. It does not assert deduplication for unchanged T02, so it passes on main.
4. `a sweep round that admits nothing writes nothing`: installed providers, no token cap, Claude provider cap 1 and a T03 question. First round admits T01, builds but caps T02, and skips T03. Sweep rebuilds T02 ContextPackage/AgentSpec and returns provider_concurrency/question with every captured durable object unchanged. Lower Mission concurrency to 1 through the store; the next sweep returns concurrency/question, builds no further contracts, and again changes nothing.
5. `a sweep admits what a lost round left`: e2e is explicitly off. The executing fixture has three READY roots and no prior round. Create a second planned Mission in the same store with its own controller/session and a distinct target branch, start and pause it. Call sweepExecutingMissions with the real Scheduler and await the observed round promise. Only the executing Mission receives sweep; its roots become RUNNING and scheduler.round says sweep. The paused roots stay READY.
6. `a sweep does not rename a trigger that is already waiting`: fail the first context build once after asking for policy then sweep inside the build. No admission occurs in that first round; its follow-up admits all roots and the sole round event says policy. Move those roots through NEEDS_FIX → READY through the controller; fail a build once with only sweep pending. That follow-up admits all three second Attempts and its round event says sweep. Readiness is called twice per flight.
7. `every tick asks one sweep round of each executing Mission and boot asks none`: real file-backed plane/mailbox runtime, two executing Missions and one paused status seeded through the store, e2e explicitly off, only scheduleRound mocked. Boot asks two resumes; each of two ticks adds one sweep per executing Mission; the paused Mission receives none, and stop prevents the next tick.
8. `a tick that cannot sweep leaves only a warning`: same real plane, e2e off; listMissions throws once only for the EXECUTING filter, preserving reconciliation reads. The timer returns normally and emits exactly the single sweep warning. Next tick requests again. A mockRejectedValue round produces exactly the identity-only round warning, without diagnostic details.
9. `the sweep is held under e2e unless a spec asks`: explicit e2e-on configuration and unset opt-in hold a tick; setting AXIOM_E2E_RUN_SWEEP to 1 allows it. With e2e off, setting the variable to 0 still allows it. Boot uses resumes throughout.

The boot fixture uses fake timers for the entire file and restores them after each test. It stops the plane, awaits both outbox and verification shutdown, restores mocks/environment, closes the database and removes its temporary directory.

## Verification evidence

All commands below use the checkout toolchain with `PATH=/Users/henry/.nvm/versions/node/v24.21.0/bin:$PATH`. The three compiler-stage runs passed on the final TypeScript. Each checked the node, web, CLI and process-host test projects (18,242 / 15,764 / 3,205 / 34 files). `pnpm tc` first failed at build:packages with listen EPERM; the authorized fallback `node config/scripts/run-typecheck-projects-in-parallel.mjs` was run three times, each exit 0. Logs: `/tmp/axiom-sweep-1-tc-{1,2,3}.log`. Runs 1 and 2 briefly overlapped; run 3 was standalone. No test suite overlapped another test suite.

The required explicit red check used `git show main:src/main/axiom/scheduler/scheduler.ts` and `git show main:src/main/axiom/control-plane-boot.ts` to replace just those two files, leaving all three new modules present. A Python `try/finally` restored their original bytes after both runners. Each runner reported 6 assertion failures and 3 passes, no load error, exception or timeout:

| Title | Assertion location | Expected missing behavior on main |
| --- | --- | --- |
| 1 | scheduler/scheduler-sweep.test.ts:90 | Whole snapshot gains three duplicate refusal audits. |
| 2 | scheduler/scheduler-sweep.test.ts:119 | Second sweep adds three more unchanged refusal audits. |
| 6 | scheduler/scheduler-sweep.test.ts:223 | Follow-up event says sweep instead of policy. |
| 7 | control-plane-boot-sweep.test.ts:65 | First tick leaves two calls, expected four. |
| 8 | control-plane-boot-sweep.test.ts:106 | No sweep listing occurs, so the expected single warning is absent. |
| 9 | control-plane-boot-sweep.test.ts:134 | Opting into e2e sweep still produces no round. |

Titles 3, 4 and 5 passed on main under both runners. Commands: `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/main/axiom/scheduler/scheduler-sweep.test.ts src/main/axiom/control-plane-boot-sweep.test.ts` and the same arguments through `node node_modules/vitest/vitest.mjs`. Logs: `/tmp/axiom-sweep-1-red-main-bun.log`, `/tmp/axiom-sweep-1-red-main-node.log`. After restoration SHA-256 was `9211c0d5ece80a3448e1b8df423aec606496db38ca6f50ab393f51d39c488f7e` for scheduler.ts and `ee3067edce7b1764bb5222745303fe638e775a017f33a53e29cb99de36c6617d` for control-plane-boot.ts.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm exec oxfmt --write` on the seven changed/new TypeScript files, followed by `pnpm exec oxfmt --check` on the same seven paths | Pass; formatter output retained, no Markdown formatted | Format check: all matched files correct |
| `pnpm test` on the two new files | Blocked before tests at build:packages / tsx listen EPERM | `/tmp/axiom-sweep-1-wrapper-red.log` |
| `pnpm tc` | Blocked before compiler at the same package-build step | `/tmp/axiom-sweep-1-tc-wrapper.log` |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs` ×3 | Pass, exit 0 each, all four projects | `/tmp/axiom-sweep-1-tc-1.log`, `-tc-2.log`, `-tc-3.log` |
| Direct Bun runner, the six focused test files | Pass, 6 files / 69 tests | `/tmp/axiom-sweep-1-focused.log` |
| Direct Bun runner, all SWEEP-1 sidecar targets | Pass, 292 files / 2,457 passed / 1 existing skipped test, 85.01 s | `/tmp/axiom-sweep-1-bun.log` |
| `bash .axiom-work/scripts/ci-axiom-unit.sh` | Pass, Node, 327 files / 2,643 passed / 1 existing skipped test, 90.68 s | `/tmp/axiom-sweep-1-node.log` |
| `pnpm run check:code-quality:changed` | Pass; zero new findings across all seven TypeScript files in every scan | `/tmp/axiom-sweep-1-quality.log` |
| `pnpm lint` | Pass, exit 0, including all ratchets and RPC catalog verification; five warnings in untouched docs/site files | `/tmp/axiom-sweep-1-lint.log` |
| Each unmodified SWEEP-1 sidecar `extra:` assertion, executed with bash | Pass, 81 checked / 0 failed | `/tmp/axiom-sweep-1-sidecar.log` |
| `python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"` (called by that sidecar) | Pass: `retired 10`; `ran 2300 skipped 616 failed 0 unique 2926` | Same sidecar log |
| `git diff --check`, scope/importer/heading checks | Pass; only the prescribed nine paths, all existing tests unchanged, original headings preserved; three non-trigger types match main byte-for-byte | Local read-only diff checks |

Bun full command:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/main/runtime/rpc/dispatcher-axiom-caller-authority.test.ts src/main/runtime/rpc/dispatcher-axiom-session-coverage.test.ts src/main/runtime/rpc/dispatcher-axiom-terminal-authority.test.ts src/cli/handlers/axiom src/cli/axiom-verification.test.ts
```

The focused command uses that same runner/config with these targets: `src/main/axiom/scheduler/scheduler-sweep.test.ts`, `src/main/axiom/control-plane-boot-sweep.test.ts`, `src/main/axiom/scheduler/scheduler.test.ts`, `src/main/axiom/control-plane-boot.test.ts`, `src/main/axiom/control-plane-effects-boot.test.ts`, `src/main/axiom/recovery/attempt-restart.test.ts`. CI script printed and ran its workflow command under Node, including the wider schema/CLI/renderer targets. Both runners used Vitest 5.0.5; the Bun executable is 1.4.3. Unit runs emitted the existing Vite configuration-loader warning.

New files were registered with `git add --intent-to-add` before sidecar checks. It succeeded in this checkout; no temporary index/object-directory fallback or Git environment variables were used. Scope checks cover forbidden paths, carried pins, new source restrictions and secret-shaped literals. No sidecar or retired/list file was modified.

Initial baseline red run, before changing either existing product file: exactly titles 1, 2, 6, 7, 8 and 9 failed at assertions; 3, 4 and 5 passed. Initial fixture-only corrections were a distinct target branch for the paused Mission (the real start guard rejects an occupied target) and awaiting fake timer advancement without assuming it returns undefined (Vitest returns its API object).

Focused green run: direct Bun runner, both new files plus scheduler.test.ts and all three existing tick-driving files, 6 files / 69 tests passed. `control-plane-boot.test.ts`, `control-plane-effects-boot.test.ts` and `recovery/attempt-restart.test.ts` passed unchanged.

Toolchain: the initial shell selected Node 20 and could not select pinned pnpm. Setting PATH to the already installed Node 24.21.0 selected pnpm 12.14.0. The pnpm test wrapper then stopped in build:packages with the documented tsx local-socket listen EPERM. Per the brief, subsequent unit runs use the stage behind the wrapper; no installation, rebuild, node_modules relocation or wrapper debugging.

## Documentation corrections

Final line numbers in `docs/reference/control-plane.md` (base line in parentheses when shifted):

| Line | Correction |
| --- | --- |
| 142 | Event rounds still append refusals; sweeps deduplicate only an equal refusal after the current stage. Missing policy-trigger requests recover via sweep while running, or boot after a crash. |
| 188 | One pending trigger remains; sweep preserves pending events and the existing reconcile timer requests rounds. No claim of no timer behind rounds remains. |
| 210 | First trigger list now includes sweep; scheduler.round emission conditions are unchanged. |
| 376 | Integration restart description now includes periodic repair of a lost request while the process is running. |
| 380 | Existing trigger list gains periodic sweep and continuation expiry; ended failed requests can receive three more tries each minute, with merge/regression per try. The old 300-line-limit statement is replaced by the four-type extraction and compatible re-export. |
| 382 | New `### Scheduler sweep（SWEEP-1）` section directly after Integration requests: scheduling/e2e/errors, trigger meaning, refusal/read-model rule, all remaining write paths and contract rebuild costs, coalescing, time/external changes and limits. |
| 751 (727) | Reconcile tick responsibilities now include sweep after reconcile; only the unchanged Attempt reconciliation is described as audit-free, with Scheduler writes qualified by the new section. |
| 784 (760) | Recovery description names both boot resume and periodic sweep as integration-request repair. |
| 1378 (1354) | Second trigger list includes sweep; continuation and boot triggers remain explicit, and mailbox handling creates no separate timer. |
| 1392 (1368) | Integration queue recovery can repair requests at boot and on periodic sweep. |
| 1396 (1372) | Recovery follow-up note also includes periodic request repair. |

Every existing heading is preserved. The document was edited as text, never passed to a formatter. Governing plans/Decisions/Glossary/Architecture remain planner-owned and unchanged.

## Differences and limits

No product-scope deviations. Verification differences from wrapper invocation are the authorized direct-stage fallback for the tsx socket sandbox restriction and the initial shell selection of the already-installed Node 24 toolchain. No temporary Git index fallback was needed. Full lint passed with five existing warnings in untouched docs/site files (four next/no-img-element and one jsx-a11y/prefer-tag-over-role); no warning suppression or unrelated fix was added. The independent verifier, not another model or a local self-review, owns acceptance. No existing test failed because of an added sweep tick.

- A sweep round is not free: one precheck transaction per waiting Task; for each Task reaching contract construction, two repository-rule reads and a rebuild each minute. Content-addressing avoids unchanged writes; changed content writes again.
- A failing round, for example because the repository cannot be read, now fails and warns once a minute.
- An integration request that ended failed while its Task remained INTEGRATION_READY is requested again once a minute, with three tries each and a merge/regression per try. This existing retry behavior remains unbounded.
- Refusal data that flip back and forth are written on every flip.
- A lost trigger waits up to one tick before the replacement request; coalescing and round runtime may add delay.
- The sweep does nothing under e2e unless AXIOM_E2E_RUN_SWEEP=1. Host Mission specs are not run by this Worker.
- A VERIFIED Task that fails integration eligibility still has no explanatory pending reason. No provider-cap reorder, round bound, schema change or new timer is introduced.
