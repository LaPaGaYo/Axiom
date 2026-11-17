# SCHEMA-1 · Attempt 1

Status: implementation is ready for independent review; final acceptance is not claimed. The full Bun sidecar gate encountered four existing socket-startup failures in this sandbox; details below. The launcher owns the candidate commit, and the verifier owns host verification and acceptance.

## Scope and execution

The approved M4 execution unit is SCHEMA-1 under D93 item 2 and its 2026-11-16 revision. The goal is an independent, transactional Axiom schema stamp and baseline, with unchanged database caller behavior. SCHEMA-2, kernel renumbering, new caller APIs, and changes outside the brief are excluded. The assigned checkout is `/Users/henry/Documents/Axiom`, branch `axiom/attempt/SCHEMA-1/1`, initially clean at `757f87fd20` (the planner brief commit, also main).

PM intent and the GSD execution unit, dependencies, scope and acceptance path came from the approved brief and M4 row. I used the Superpowers execution, test-first, debugging and verification guidance within that scope. The explicit brief takes precedence over generic skill recommendations to create another worktree, add plan files, call reviewers or commit: work remains in the assigned checkout, the brief is the execution plan, and this report is the handoff. No external model CLI, hosted reviewer, subagent or network service was called. Repository content stayed on this machine.

- [x] Write the contract tests, beginning with a red fresh-open assertion.
- [x] Add the numbered Axiom runner, minimal kernel wiring, old-probe deletion, one fixture statement and two WSL census entries.
- [x] Correct the two reference documents without changing existing headings or earlier pinned text.
- [x] Format changed TypeScript only; run focused tests, the required four-file red check and restoration, broad Bun targets and three compiler stages.
- [x] Run all 74 SCHEMA-1 sidecar assertions, including the earlier-task union.
- [x] Record Node CI and full lint results; finish the diff review and retain the Attempt for the launcher/verifier handoff.

Write-scope enforcement is verification-time diff inspection; no runtime enforcement is claimed. The compatibility tradeoff is deliberate: current or newer stamps skip Axiom probes, while existing DDL still supplies missing tables, indexes and triggers on every open.

## Files changed

| Path | Change |
|---|---|
| `src/main/runtime/orchestration/db/schema/axiom-schema-steps.ts` | New, 75 total / 69 nonblank lines: the five-column table, constants, typed reader, one baseline step and transactional runner. |
| `src/main/runtime/orchestration/db/schema/axiom-schema-steps.test.ts` | New: exactly the eight specified titles, independent column definitions, real SQLite, temporary files for reopen tests, cleanup and rollback evidence. |
| `src/main/runtime/orchestration/db/orchestration-db.ts` | Exactly one import and one call after the kernel migration. |
| `src/main/runtime/orchestration/db/schema/create-tables.ts` | Exactly the old probe import and call removed. |
| `src/main/runtime/orchestration/db/schema/ensure-axiom-columns.ts` | Deleted with plain `rm`. |
| `src/main/runtime/orchestration/db/schema/ensure-axiom-columns.test.ts` | One added statement at line 69: `first.db.exec('DELETE FROM axiom_schema')`, next to the column drop. All existing titles and assertions unchanged. |
| `src/shared/wsl-move/wsl-move-storage-dispositions.ts` | Two entries, six added lines and no removals: schema file → orchestration, and the separate schema bookkeeping row → `notApplicableDisposition(62, ...)`. |
| `docs/reference/control-plane.md` | Corrected line 68 and inserted the SCHEMA-1 subsection immediately before Task spec. |
| `docs/reference/orca-mapping.md` | Corrected line 305 and added the separate bookkeeping-table paragraph at line 307; Mission side tables remain 21. |
| `.axiom-work/reports/SCHEMA-1-1.md` | This report. |

The two shared kernel-file diffs, line by line:

`orchestration-db.ts`, added at current lines 12 and 43 respectively:

```diff
+import { migrateAxiomSchema } from './schema/axiom-schema-steps'
+    migrateAxiomSchema(this.db)
```

`create-tables.ts`, removed from main lines 5 and 10 respectively:

```diff
-import { ensureAxiomColumns } from './ensure-axiom-columns'
-  ensureAxiomColumns.call(this)
```

There are no other changes in either file. The formatter was run on both and retained that exact diff. `SCHEMA_VERSION = 46`, `contract-constants.ts`, `migrate.ts`, every `migrate-v*.ts`, the skew resolver, the existing Axiom DDL modules and `axiom-tables-migration.test.ts` are unchanged. No existing test other than the one statement above was edited. No new class method, dependency, index, trigger, foreign key, second step, caller behavior or newer-version rejection was added.

## Implementation review

`migrateAxiomSchema` executes its own table DDL every time, then reads the row. A current or newer positive integer version returns without a row write. A missing or invalid version takes `BEGIN IMMEDIATE`, re-reads under that lock and applies only later numbered steps in list order. Another opener that completed the chain while this opener waited is respected, including a newer stamp. The baseline independently probes each of the eight columns through typed `prepare(...).all()` rows before any addition. The SQL identifiers and definitions are fixed module literals.

One upsert writes id 1, version 1, upstream_version 43, the resolved app version and SQLite time when the row is absent. Its conflict-update clause names only version, app_version and updated_at, preserving the existing upstream_version. Omitted appVersion resolves from the installed environment only when a step will be stamped; absent environment and explicit null both resolve to SQL NULL. A failure during steps or stamping rolls back and propagates, using the kernel runner's transaction shape. The comment at the ordered steps records both replay safety and the prohibition on removing or redefining objects that old DDL would recreate.

## Eight test titles and evidence

All schema snapshots select `type`, `name`, `tbl_name`, and `sql`, ordered by type and name. Four preserved-data tables are seeded with nontrivial values: agent_specs, mission_policies, verification_runs and artifacts. The three tables with baseline columns retain their other values through direct baseline repair. The test file imports OrchestrationDb directly, so the Bun launcher routes it through its SQLite-capable Node runtime pool. All reopen tests use files in fresh temporary directories. `afterEach` restores spies and the default fake app environment, closes remaining database handles and removes every directory created by the new test file.

| Exact title | Setup and proof |
|---|---|
| `a fresh database is stamped with the Axiom schema version` | Opens a fresh database. Checks the literal five-column list, full row (id 1/version 1/upstream 43), both constants, reader result, user_version 46, and no index or trigger for this table. Inserts with id 2 and id 1 separately fail the CHECK and primary key. |
| `a database written before the stamp existed is stamped without any other change` | Seeds four tables, drops axiom_schema, snapshots all remaining sqlite_master rows and all rows in those four tables, closes and reopens the file. Only the new table/stamp appears; every other schema row and seeded row is identical, and user_version stays 46. |
| `the baseline alone supplies every column Axiom added to existing tables` | Drops all eight columns and deletes the stamp on an already open database. Calls migrateAxiomSchema directly, without reopening or invoking the kernel chain. Checks every recovered type, NOT NULL flag and default expression, all preserved row values and the stamp. |
| `opening a stamped database again changes neither the row nor the schema` | Sets updated_at to `unchanged-marker`, snapshots the row and whole schema, then closes/reopens twice. Both comparisons remain exact, including the marker. |
| `a stamp from a newer Axiom is left as it is` | Sets version 99, upstream_version 97, app_version `99.0.0` and updated_at `future-marker`. Reopen preserves the entire row and schema; the reader returns 99. |
| `a missing stamp is repaired by running the steps again` | Seeds four tables, deletes just the row, verifies reader 0, then reopens. The stamp returns while all schema and seeded rows remain identical. Additional cases set version to 0, -1, 1.5 and a nonnumeric string: reader 0, direct repair to 1, app/time updated, and existing upstream_version 73 preserved. |
| `a step that fails leaves no partial change and the next run succeeds` | Drops all eight columns and deletes the row. A one-shot exec spy throws at the last missing column's ALTER. The error propagates; all dropped columns stay absent, schema and seeded rows equal the pre-call snapshot, there is no stamp and no open transaction. Removing the spy and calling again restores every definition and stamps 1. |
| `the stamp records the app version it is given` | Installs fake getVersion `1.2.3-schema-test` before the constructor and checks its stamp. Deletes the row before each direct call: explicit `4.5.6-explicit-test` wins, then explicit null stores SQL NULL. |

Title 7 injects exactly `new Error('baseline final column fault')` when that handle receives `ALTER TABLE verification_runs ADD COLUMN batch_id TEXT`. Every other exec delegates to the saved bound real method, including BEGIN, the seven earlier ALTERs, ROLLBACK and COMMIT. The fault flag is one-shot, and the spy is explicitly restored before the successful retry. This exercises real SQLite DDL rollback rather than mocking the migration result.

## Red checks and restoration

The first version of the fresh-open test was run before any production edit. It failed at the literal column-list assertion: received `[]` instead of `id version upstream_version app_version updated_at` (one failed test). This established the missing feature without an import/load failure.

After the implementation and all eight tests passed, the required red check wrote main's exact bytes into these four paths using `git show main:<path>`: create-tables.ts, orchestration-db.ts, ensure-axiom-columns.ts, and ensure-axiom-columns.test.ts. The new module and new tests remained. The complete new test file ran through the Bun launcher with `--reporter=verbose`: **8 failed, exit 1**.

- Title 1 failed the same column-list assertion: received `[]`.
- Title 2 failed its DROP TABLE because axiom_schema did not exist.
- Titles 4 and 5 failed their UPDATE because axiom_schema did not exist.
- Title 6 failed its DELETE because axiom_schema did not exist.
- Titles 3 and 7 failed the fixture DELETE before their direct migration call because axiom_schema did not exist; title 8 failed its first constructor-stamp SELECT for the same reason. The brief permits either outcome for these three titles.

A `finally` restored the exact saved bytes of the three modified paths and removed ensure-axiom-columns.ts again with plain `rm`. Each path was compared byte-for-byte with the saved candidate state, including absence of the deleted file. No test assertion was changed for the red run. The subsequent complete Bun sidecar run passed the new tests and schema tests; only the four socket fixtures described below failed.

## Documentation corrections

Only the following existing sentences were corrected; all other pre-existing sentences and headings remain, including the old count in the §3 heading and the historical numbering in the mapping.

1. `docs/reference/control-plane.md:68`: “`verification_runs.batch_id TEXT` 在新库由 DDL 放在末列，已有库在内核编号迁移之后由 `axiom-schema-steps.ts` 的第 1 步（基线）补齐：Axiom 印记缺失或落后时，在 `BEGIN IMMEDIATE` 内重读版本，逐列探测并对缺列执行 `ALTER TABLE … ADD COLUMN`，与印记一起 `COMMIT`，失败 `ROLLBACK` 后重抛。” This replaces the old standalone pre-kernel probe.
2. Same line: “八列均存在但没有印记的库首次打开仍写入印记；已有当前或更新印记时不再取该链的写锁或探测列。” This replaces the claim that an existing column means no write.
3. Same line: “该步使用 Axiom 自己的版本号，不改 `user_version` 或内核的编号链，避免下次上游同步再次挪号；可空增列不影响旧版按列名读写。” This replaces the independent commit before numbered migration and the unnumbered status.
4. `docs/reference/orca-mapping.md:305`: “`verification_runs.batch_id TEXT` 在新文件由 DDL 作为末列建入，在已有文件由内核编号链之后的 `migrateAxiomSchema` 第 1 步（基线）补齐：印记缺失或落后时，在 `BEGIN IMMEDIATE` 内重读版本、探测八列并补缺，与印记一起提交；已有当前或更新印记时不再探测。” This replaces the former createTables call/order sentence.
5. Same line: “它占 Axiom 自己的第 1 号，不改 `user_version` 或内核编号链。” This states the new independent numbering.

The added subsection starts at `control-plane.md:72`: table ownership at 74; exact definitions and meanings at 78–82; open/transaction order and preserved upstream_version at 84; the eight-column baseline at 86; future-step rules and upgrade-test recipe (including DDL-only new tables taking a number) at 88; newer stamps, old DDL, constant 43, unsupported user_version above 46, and no caller yet at 90. `orca-mapping.md:307` adds the separate axiom_schema table, five columns and creator filename beside the unchanged 21 Mission tables.

## Commands and results

All test and compiler commands used this checkout's existing toolchain, with `/Users/henry/.nvm/versions/node/v24.21.0/bin` prepended to PATH: Node v24.21.0, pnpm 12.14.0, pinned Bun 1.4.3, Vitest 5.0.5, oxfmt 0.73.0, oxlint 1.88.0, Git 2.54.0. No install, add, remove, rebuild, module copying or symlinking command was run. No Markdown formatter was run.

Evidence logs remain in `/tmp/axiom-schema-1.SovkJw`; they are local execution evidence, not new repository artifacts.

| Command / check | Result |
|---|---|
| `pnpm test src/main/runtime/orchestration/db/schema/axiom-schema-steps.test.ts` | Stopped in build:packages: tsx could not listen on its local pipe (`EPERM`). No test ran in this wrapper; used the authorized direct stage. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/main/runtime/orchestration/db/schema/axiom-schema-steps.test.ts` before production changes | Expected red: one failed assertion, described above; `initial-red.log`. |
| Same direct Bun command targeting the new file, ensure-axiom-columns.test.ts, axiom-tables-migration.test.ts and wsl-move-dispositions.test.ts | **PASS: 4 files / 31 tests**; `focused-bun.log`. |
| Same direct Bun command targeting the new test file with `--reporter=verbose`, on the four-file red tree | Expected red: **8 failed**; `four-file-red.log`; exact restoration verified afterwards. |
| Direct Bun command with every target from `.axiom-work/briefs/SCHEMA-1.verify` | **FAIL: 2 files failed, 425 passed, 1 skipped; 4 tests failed, 3,577 passed, 7 skipped**, 136.60 seconds; `sidecar-bun.log`. All four failures are the socket-startup refusals below. No skip was added. |
| Direct Bun command with orchestration-cli-subprocess.test.ts and orchestration-message-delivery-identity.test.ts, `--reporter=verbose` | Same **4 failures / 4 passes**, 11.81 seconds; isolates the socket cause; `existing-cli-failures.log`. |
| `bash .axiom-work/scripts/ci-axiom-unit.sh` | **PASS under Node: 328 files, 2,651 tests passed, 1 existing skipped**, 101.32 seconds; `ci-node.log`. This is the unchanged CI command read by the repository script, including the schema folder and all eight new titles. |
| `pnpm tc` | Stopped in build:packages with the same tsx `listen EPERM`; `tc-wrapper.log`. No debugging or package rebuild was attempted. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs`, three consecutive runs | **PASS ×3, exit 0 each**, all four configured compiler projects, zero type errors; `tc-1.log`, `tc-2.log`, `tc-3.log`. The verifier still runs the full wrappers on the host. |
| `pnpm exec oxfmt --write` with the six new/modified TypeScript paths explicitly listed | **PASS**, retained formatter output; no deleted, unrelated or Markdown file was passed. |
| `pnpm run check:code-quality:changed` | **PASS**, zero new findings in every reported category; `changed-quality.log`. |
| `pnpm lint` | **PASS, exit 0**, including RPC catalog and all configured audits/ratchets; `lint.log`. Five warnings on unchanged docs-site TSX files, an unchanged layout-writer baseline warning, and informational localization coverage notes remain; no lint error or new finding. |
| Every `extra:` assertion in SCHEMA-1.verify, each executed individually by bash with its exit checked | **PASS: 74 run, 0 failed**; `sidecar-assertions.log`. |
| `python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"`, as SCHEMA-1 assertion 31 | **PASS**: `retired 10`; `ran 2357 skipped 624 failed 0 unique 2991`. No pin or retirement list was edited. |
| `git diff --check main` | **PASS**; final scope and report checks are recorded below. |

The Bun sidecar target list was read directly from the brief: src/main/axiom; src/shared/axiom-contract; src/main/runtime/rpc/methods/axiom; the three dispatcher Axiom caller/session/terminal authority tests; src/main/runtime/orchestration; src/shared/wsl-move; src/cli/handlers/axiom; and src/cli/axiom-verification.test.ts.

## Existing test failures: stopped, identified, unchanged

The broad run exposed four failures in two pre-existing test files. I stopped implementation changes, reported them, and ran only those two files once to obtain precise causes. No fixture or assertion was changed, skipped or weakened. These are failures before the behavior assertions, at `await server.start()`:

| Test file and exact title | Failing call / cause |
|---|---|
| `src/main/runtime/orchestration-cli-subprocess.test.ts` — `emits newline-flushed JSON keepalives to stderr while waiting` | line 90: Unix socket listen refused with EPERM. |
| Same file — `validates reset scopes against an isolated runtime through the built CLI` | line 236: same refusal. |
| Same file — `creates a late dependent as ready through the built CLI and runtime` | line 358: same refusal. |
| `src/main/runtime/orchestration-message-delivery-identity.test.ts` — `keeps the built CLI count and Delivery output aligned with isolated SQLite state` | line 476: same refusal. |

Every stack reaches `src/main/runtime/rpc/unix-socket-transport.ts:67`, `server.listen(this.endpoint, ...)`, with `code: EPERM`, `syscall: listen`, and an isolated test directory's `.sock` path. This is the sandbox refusing socket startup after the database has opened; the CLI assertions were not reached. Their behavior remains unverified here and must be rerun outside this sandbox. The unrelated four in-process delivery-identity cases passed in the focused diagnosis. I did not attempt to expand permissions or work around the socket restriction.

## Deviations and operational constraints

- No product-scope or architecture deviation. The numbered list contains only the requested baseline; the kernel chain remains untouched.
- The generic lifecycle's design/plan approval and branch choices were already resolved by the user, D93 and the assigned Attempt. No redundant approval, extra worktree, new planning file, provider delegation, commit or merge was introduced.
- The shell initially selected Node 20 and its pnpm invocation failed to switch to pnpm 12.14.0. Selecting the already installed Node 24 toolchain resolved that launcher mismatch; no installation was attempted.
- The pnpm test/tc wrappers were blocked at the documented build:packages socket step. I used the direct stages expressly allowed by the brief, and recorded the full-wrapper gap separately.
- `git add --intent-to-add` was attempted on the three new files and refused because `.git/index.lock` is read-only in this sandbox. For git-dependent checks only, I created a temporary index and object directory, ran `git read-tree HEAD`, and registered the three new paths with intent-to-add. The variables were `GIT_INDEX_FILE=/tmp/axiom-schema-1.SovkJw/index`, `GIT_OBJECT_DIRECTORY=/tmp/axiom-schema-1.SovkJw/objects`, `GIT_ALTERNATE_OBJECT_DIRECTORIES=/Users/henry/Documents/Axiom/.git/objects`. The real index and objects were not modified. These variables were never passed to any test or compiler run. The launcher must register the new files in the real index when making its candidate commit.
- Title 6 includes bounded extra cases for invalid versions and preserving an existing upstream_version, without another title or existing test edit. These test explicit reader/upsert requirements that the eight basic scenarios otherwise leave uncovered.
- The broad Bun gate is not clean in this environment because of the four named socket failures. That limitation is not treated as a pass or “fixed” by modifying tests. Host Mission specs and the real-development-database copy check remain the verifier's work, as assigned in the brief.

## Final scope review

The final diff is confined to the ten paths above. New-file registration for checks uses the temporary index; the real checkout still reports those three files as untracked for the launcher to add. The formatter output survives the red restoration unchanged. Shared-kernel diffs remain exactly +2/-0 and +0/-2, the old fixture is exactly +1/-0, and the WSL census is exactly +6/-0. All forbidden kernel-chain and existing-test paths remain identical to main. All existing reference-document headings are retained. The source reader search finds only the new schema module and its tests; the caller wiring adds only the required constructor call. No secret-like value, suppression or out-of-scope change was introduced.

The developer-side review checked the lock re-read, preservation of a newer stamp, invalid-version replay, atomic rollback, upstream_version preservation, typed row reads, fixed SQL identifiers, app-version precedence, cleanup, scope and documentation against the brief. It is an implementation review, not the independent acceptance review. The finishing-branch handoff preserves this Attempt for the launcher; no integration choice or new approval is needed here.

## Limits and handoff

- A stamp says which Axiom last ran a registration or schema step, not that every object is intact. DDL and column probes repair missing objects only; no comparison checks existing definitions. A current stamp skips baseline column probes.
- An older build still executes its own “create when missing” DDL when it opens a database with a newer stamp. Leaving the stamp untouched does not make old code compatible with arbitrary future schema changes.
- `upstream_version` is the constant 43 on insertion until a sync changes the kernel chain. Existing values survive Axiom updates. It is not inferred from user_version; user_version above 46 is outside this build's supported range.
- Outside the new schema module itself, nothing reads the stamp yet except tests. SCHEMA-2 will decide the application's newer-Axiom behavior; this task adds no caller guard, error or message.
- Two live processes competing for the first stamp were not exercised. Locking and the second read implement the specified serialization; the rollback test covers a mid-baseline fault, not disk failure or process death.
- As in the kernel runner, a rollback failure would replace the original error. No separate recovery policy was added.
- No real development database was opened or modified. Host integrity_check, per-table row counts, every Mission e2e spec and independent immutable-candidate review remain outstanding with the verifier.

Delivery state: changes are retained in the assigned Attempt checkout for the launcher's candidate snapshot and verifier review. No commit, push, merge, promotion, Task acceptance or milestone completion is claimed. SCHEMA-1 stays pending independent verification; SCHEMA-2 remains outside this Attempt.
