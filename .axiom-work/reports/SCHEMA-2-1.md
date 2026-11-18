# SCHEMA-2 attempt 1 — implementation report

Date: 2026-11-17. Branch: `axiom/attempt/SCHEMA-2/1`. Base: `7f1eb8638711c84be95f67e0dce4c44edf6c124a` (main at the start). The launcher owns the snapshot commit; this report is a Worker handoff, not independent acceptance or integration.

## Task and execution boundary

This implements the second half of the “Axiom 的 schema 版本号” row in M4, D93 item 2 and its 2026-11-16 revision. SCHEMA-1 is integrated and supplies the row and reader. The problem is that an older build previously constructed its Control Plane against a newer schema. The required outcome is one structured refusal before construction, with boot and quit absorbing only that refusal and all paths that never ask for the Control Plane remaining available.

The supplied brief is the execution plan: six regression tests first; the shared construction guard and lifecycle catches; one restart spec; reference documentation; the prescribed red check and verification gates; this report for the verifier. Scope and non-goals are unchanged. Work stayed in the assigned checkout with its own toolchain. No other model CLI, service, reviewer or subagent was called. No dependencies were installed, rebuilt, copied, moved or linked. No runtime, contract, CLI or renderer product file was changed. No existing test or test-support file was changed. No governing document or sidecar was edited. The verifier retains independent review and the milestone completion decision.

## Files changed

| File | Change |
| --- | --- |
| `src/main/axiom/schema-support.ts` | New read-only version assertion and typed refusal recognizer; 22 non-blank lines, two exported function declarations, no type assertion. |
| `src/main/axiom/control-plane.ts` | Exactly one import and one call, before first construction; +2 / -0, 295 non-blank lines. |
| `src/main/axiom/control-plane-boot.ts` | Catch the schema refusal at the two lookups; start warns and returns, stop returns after stopping headless watchers; +20 / -2. |
| `src/main/axiom/mission-controller/controller-context.ts` | Append the error code as the last entry; +2 / -1 solely because the old final entry needs a comma. |
| `src/main/axiom/schema-support.test.ts` | New six-title unit file with actual database handles and RPC dispatchers. |
| `tests/e2e/mission-schema-newer.spec.ts` | New single-test restart spec, 92 non-blank lines. |
| `docs/reference/control-plane.md` | Module-table correction, two SCHEMA-1 sentence corrections, new SCHEMA-2 subsection, refusal-code row. |
| `docs/reference/orca-mapping.md` | One sentence in §4b; +2 / -0 including the blank line. |
| `.axiom-work/reports/SCHEMA-2-1.md` | This implementation and verification handoff. |

## Product behavior and exact shared-file diff

The assertion reads only the stored version through `readAxiomSchemaVersion(db.db)`. It throws only when stored exceeds supported. The error has exactly `reason`, numeric `stored`, numeric `supported`, and one string in `nextSteps`. Both English sentences include both numbers; the next step independently explains updating to the version that last opened the profile or a newer one. The existing controller-code passthrough exposes the new code without changing the RPC mapper.

A failed lookup never writes the WeakMap. A successful lookup is cached as before. The start catch surrounds only `getAxiomControlPlane`, warns with the mandated literal and error data, then returns undefined before any recovery or timer. The stop catch follows `stopHeadlessAttemptWatchers(runtime)` and returns without warning. Both catches rethrow every other error. The following is the complete line-by-line diff of the two shared entry files:

```diff
diff --git a/src/main/axiom/control-plane-boot.ts b/src/main/axiom/control-plane-boot.ts
index 429c14f91a..4a72a914ad 100644
--- a/src/main/axiom/control-plane-boot.ts
+++ b/src/main/axiom/control-plane-boot.ts
@@ -5,0 +6 @@ import { sweepExecutingMissions } from './scheduler/mission-sweep'
+import { isAxiomSchemaNewer } from './schema-support'
@@ -10 +11,10 @@ export async function startAxiomControlPlane(
-  const plane = getAxiomControlPlane(runtime)
+  let plane: ReturnType<typeof getAxiomControlPlane>
+  try {
+    plane = getAxiomControlPlane(runtime)
+  } catch (error) {
+    if (!isAxiomSchemaNewer(error)) {
+      throw error
+    }
+    console.warn('[axiom] Control Plane not started: database written by a newer Axiom', error.data)
+    return
+  }
@@ -78 +88,9 @@ export function stopAxiomControlPlane(runtime: OrcaRuntimeService): void {
-  const plane = getAxiomControlPlane(runtime)
+  let plane: ReturnType<typeof getAxiomControlPlane>
+  try {
+    plane = getAxiomControlPlane(runtime)
+  } catch (error) {
+    if (!isAxiomSchemaNewer(error)) {
+      throw error
+    }
+    return
+  }
diff --git a/src/main/axiom/control-plane.ts b/src/main/axiom/control-plane.ts
index 7f90f8b8f2..8f9735679e 100644
--- a/src/main/axiom/control-plane.ts
+++ b/src/main/axiom/control-plane.ts
@@ -32,0 +33 @@ import { getSelectedClaudeAccountIdForTarget } from '../claude-accounts/runtime-
+import { assertAxiomSchemaSupported } from './schema-support'
@@ -39,0 +41 @@ export function getAxiomControlPlane(runtime: OrcaRuntimeService) {
+    assertAxiomSchemaSupported(db)
```

## Six unit cases

All newer stamps are written through the opened database handle, before the first Control Plane request. Titles 1, 2, 5 and 6 obtain their own `OrchestrationDb(':memory:')` through `openDatabase`; the value import uses exactly `../runtime/orchestration/db`. `afterEach` restores mocks, runs all registered disposals in reverse order (including kernel cleanup and boot stop), closes every database and restores real timers.

1. `a database stamped by a newer Axiom gets no Control Plane`: raises the stamp to `AXIOM_SCHEMA_VERSION + 1`, snapshots complete rows of `axiom_schema`, `missions`, `audit_events` and `axiom_effects`, and calls the getter twice. Each call must throw `MissionControllerError` with the exact code and four data fields; both numbers appear in reason and the single next step. Each call leaves every snapshot identical. The error checks establish that neither call returns a Control Plane.
2. `a database at the Axiom schema version of this build gets its Control Plane as before`: opens a current database, checks that construction provides a store, and checks reference identity across two getter calls. This is the positive control and passes on main.
3. `an axiom request on a newer database answers the refusal with its reason and next step`: uses `rpcFixture`, raises `f.db.db` before the first call, and sends both `axiom.mission.list` and `axiom.mission.create`. Each response must have `ok: false`, the exact code and identical message, and exactly the four refusal data fields. Missions and audit rows remain absent. `axiom.namespace.get` is sent with undefined params and still succeeds.
4. `kernel verbs that must ask whether a Mission owns the Run are refused on a newer database`: sets up the existing kernel harness and creates one unmanaged Task before raising its stamp. A fresh dispatcher over `ORCHESTRATION_METHODS` receives requests without a caller. Bound-coordinator `taskCreate` and `reset {all:true}` must return the new code; `taskList` must succeed. The Run retains its complete preexisting Task rows, proving that the refusal also applies to a non-Mission Run and reset did not delete its Task. Harness cleanup runs in `afterEach`.
5. `start leaves a newer database alone and stop does not throw`: enables fake timers, raises the stamp, snapshots the four tables and records the pending timer count. Start must resolve undefined, emit exactly one warning with the literal prefix and both version numbers, and add no timer. Advancing two minutes leaves all snapshots unchanged. After clearing the warning spy, stop must not throw or warn and the timer count remains unchanged. Cleanup stops the runtime before closing the handle, including on a failing red run.
6. `an error that is not the refusal is thrown on by start and stop`: on a separately opened database, replaces `runtime.getOrchestrationDb` with a function that throws a test-owned Error. Start rejects with that same object; stop throws it. This is the second main control.

## Red check

Before production changes, the new file ran with main behavior: four failures (1, 3, 4, 5), two passes (2, 6). After implementation, the required explicit red check saved both candidate entry files, overwrote them with `git show main:src/main/axiom/control-plane.ts` and `git show main:src/main/axiom/control-plane-boot.ts`, and reran the new test file through the direct Bun runner. The new module and error-list entry stayed in place. A Python `finally` restored both candidate files byte for byte.

The explicit red run exited 1 with exactly four test failures and two passes, no load error or timeout:

- Title 1: `expected undefined to be an instance of MissionControllerError`; main returned a Control Plane.
- Title 3: `axiom.mission.list` returned `ok: true` instead of the refusal.
- Title 4: bound-coordinator `taskCreate` returned `ok: true` instead of the refusal.
- Title 5: start returned `{ missions: [], blocked: [] }` instead of undefined.
- Titles 2 and 6 passed unchanged.

Logs: `/tmp/axiom-schema-2.q24aP9/initial-red.log` and `/tmp/axiom-schema-2.q24aP9/restored-main-red.log`. The broad candidate run after restoration is recorded below.

## Restart spec, step by step

The single test is `SCHEMA-2: a database a newer Axiom wrote is left alone and the app still works`. It uses the existing empty-fixture signature and lint comment, a 180-second timeout, a restart session with `ORCA_BACKGROUND_LAUNCH: '1'`, and no fixture-repository requirement or skip.

1. Create its own temporary directory and two separate repositories with `git init` and one empty commit each; each commit supplies `user.name` and `user.email` through `-c`.
2. First launch, await session readiness, add the first repository through `repo.add`, and validate a nonempty repo id with zod.
3. Read `axiom.mission.list` through the desktop helper and parse the empty list. This ensures the orchestration database has opened and been stamped.
4. Close the first launch. Open `orchestration.db` under the restart profile, capture the entire `axiom_schema` row, update only version to 99, and close the handle in `finally`.
5. Second launch, await readiness, and require the desktop Mission list call to reject with code `axiom_schema_newer`.
6. Add the second repository through `repo.add` and validate its nonempty id, showing an unaffected kernel request works after refusal.
7. Wait for the exact `Missions` button to become visible, click it, filter role `alert` by `written by a newer Axiom`, take the first match, and require visibility plus `axiom_schema_newer` text.
8. Close the app. Reopen the profile database and require the original full stamp with only version changed to 99, plus no rows in missions, audit_events or axiom_effects. Close the handle in `finally`.
9. Outer `finally` disposes the restart session and then removes its own temporary directory even if disposal throws.

Electron cannot be launched in this sandbox, so the spec was written and typechecked but not executed. Its three host runs, host red check against main's getter, and all other Mission e2e regressions remain the verifier's work.

## Documentation edits with lines

The entries below quote every corrected or appended sentence in an existing paragraph/table, and identify every paragraph added under the new heading. No existing heading was removed or renamed; Markdown was not formatted.

- `docs/reference/control-plane.md:31`: | `src/main/axiom/control-plane-boot.ts`                                           | `startAxiomControlPlane` / `stopAxiomControlPlane`；启动恢复和退出停止；更新的 Axiom schema 上 start / stop 不启动或停止 Control Plane，start 仅警告一次                                                                                                                                                                                                                                    |

- `docs/reference/control-plane.md:90`: 更高的 Axiom 印记原样保留；Control Plane 的拒绝与启动行为见下节 Newer Axiom schema（SCHEMA-2）。旧构建即使见到更新印记，仍会运行自己的“缺失即创建”DDL。`upstream_version` 首次一律写 43，不从数据库的 `user_version` 推算；Axiom 链不重写已有行的该值，直到同步改变内核链才调整。数据库 `user_version` 高于本构建的 46 时超出本构建支持范围，写下 43 不是兼容性承诺。Control Plane 的首次构造现通过本模块的读取函数检查印记，见下节。

- `docs/reference/control-plane.md:92`: ### Newer Axiom schema（SCHEMA-2）

- `docs/reference/control-plane.md:94`: D93 第 2 条的 2026-11-16 修订：每个进程第一次为一个 OrchestrationDb 请求 Control Plane 时，`getAxiomControlPlane` 在构造 store、outbox、Scheduler、verification、recovery 或消费者之前调用 `assertAxiomSchemaSupported(db)`。它仅用 `readAxiomSchemaVersion(db.db)` 读取印记的 version，与本构建的 `AXIOM_SCHEMA_VERSION` 比较，不写任何行；stored 大于 supported 时拒绝，既不构造也不缓存 Control Plane，后续请求仍重新读取并拒绝。通过的数据库按原样缓存；已经存在的 Control Plane 不复查印记，因此另一个进程后来提高版本不会停止它。

- `docs/reference/control-plane.md:96`: 所有需要 Control Plane 的 `axiom.*` 请求均被拒绝，包括读请求；`axiom.namespace.get` 不需要它，仍可用。需要询问 Mission 是否拥有 Run 的内核入口也拒绝：`workerStart`、`workerRelease`、`workerRetain`、`workerStop`、`workerAbandon`、`workerTerminalUserInput`、`gateCreate`、`gateResolve`、`send`（worker_done / merge_ready / dispatch / decision_gate 及群组）、`reply`、`ask`、`taskCreate`、`taskUpdate`、`dispatch`、`runUse`、`reset`。守卫不能读 Mission 行来判定所有权，因此只要进入这个查询，即使命名的是没有 Mission 的 Run 也拒绝，不猜测；没有解析到 Run / Task / dispatch / sender 的入口可在查询前返回，pane 输入只有关联 Worker 资源才查询，taskCreate 必须查询，reset 的每一种 scope 都必须查询。普通 orchestration 的 Worker 报告、回复和派发也因此不可用，直到更新 Axiom。

- `docs/reference/control-plane.md:98`: 持有活跃 dispatch 的 Agent session 发出的受限请求同样拒绝，不要求这个 dispatch 属于 Mission：包括 runCreate、dispatch、workerStart、taskCreate 以及 permission 不是 workspace 的所有方法，因 caller-authority 的所有权检查需要 Control Plane。身份层先拒绝的调用仍先得到 `caller_not_desktop`，例如没有 Agent 活跃 dispatch 的 CLI 人类操作；为记录身份拒绝而做的补充归属查询会吞掉 schema 错误。凡是不请求 Control Plane 的功能继续工作：终端、编辑器、源代码管理、浏览器、`orchestration.taskList`，以及桌面调用的 `orchestration.runCreate`。

- `docs/reference/control-plane.md:100`: 统一拒绝为 `MissionControllerError`，code 与 message 均为 `axiom_schema_newer`，沿现有 RPC passthrough 返回四个 data 字段：`reason` 是含有 `written by a newer Axiom`、两个版本号以及 Missions 与 orchestration commands 在更新前不可用的一句英文；`stored` 是数据库版本号，`supported` 是本构建支持的版本号，均为数字；`nextSteps` 只有一句英文，要求更新到最后打开此 profile 的 Axiom 版本或更新版本，并再次写出两个数字。renderer 显示 code 与 reason，Mission 页的 alert 与 toast 使用同一文本，失败后停止五秒读取；CLI 的 mission / plan / task 命令显示 code 与 message（所以 code 重复），随后显示 `Next step: …`，不显示 reason。此处不新增本地化文本。

- `docs/reference/control-plane.md:102`: 启动捕获且仅捕获这个拒绝，警告一次 `[axiom] Control Plane not started: database written by a newer Axiom` 并附 data，resolve undefined，不启动 recovery、outbox、Scheduler、timer 或 consumer。退出先执行 `stopHeadlessAttemptWatchers(runtime)`，再遇到同一拒绝时安静返回；其它错误照旧抛出。数据库仍会打开，内核与 Axiom 的“缺失即创建”DDL 仍会运行；本检查不是开库拦截、降级工具或逐请求检查，缺失或较旧的印记仍由构造器先修复。由于 reset 被拒绝，产品不能在这样的数据库里删除 Run 或 Task，Axiom 的删除触发器不会因此触发；用户在曾经属于 Worker 的 pane 中打字时发送的终端报告也被拒绝，renderer 静默丢弃该拒绝。

- `docs/reference/control-plane.md:1454`: | `axiom_schema_newer` | 数据库由更新的 Axiom 写过；需要 Control Plane 的请求不可用，data 给出 reason、stored、supported、nextSteps；更新到最后打开此 profile 的 Axiom 或更新版本，见 §3 的 SCHEMA-2 小节 |

- `docs/reference/orca-mapping.md:168`: SCHEMA-2：数据库由更新的 Axiom 写过时，守卫需要查询 Control Plane 的这些入口无论命名哪个 Run 都返回 `axiom_schema_newer`，因为它不能读取 Mission 所有权并据此放行（见 control-plane.md §3 的 Newer Axiom schema 小节）。

## Commands and results

Tools: Node `v24.21.0`, pnpm `12.14.0`, Bun `1.4.3`, Vitest `5.0.5`, Git `2.54.0 (Apple Git-157)`. Commands used this checkout's installed toolchain with `/Users/henry/.nvm/versions/node/v24.21.0/bin` prepended to PATH. Detailed logs are in `/tmp/axiom-schema-2.q24aP9/`.

| Command/check | Result |
| --- | --- |
| `pnpm exec oxfmt --write` on exactly the six changed/new TypeScript files | Exit 0; formatter output retained. The unit file was formatted again after its one-line cleanup-style fix. No Markdown formatter was run. |
| `pnpm test src/main/axiom/schema-support.test.ts` | Wrapper exit 1 in `build:packages`, before testing: tsx `listen EPERM`. Direct runner used below. |
| `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts src/main/axiom/schema-support.test.ts` on initial main behavior and the explicit restored-main check | Both expected red runs: 4 failed / 2 passed, as detailed above. |
| Direct Bun runner on `schema-support.test.ts`, `control-plane-boot.test.ts`, `rpc-reads.test.ts` | Initial green and final green after the cleanup-style fix: 3 files / 43 tests passed, exit 0. Includes the existing table-driven RPC passthrough test for the new code. `focused-green.log`, `focused-final.log`. |
| Direct Bun runner on every target in `SCHEMA-2.verify` | 516 files passed / 2 failed / 1 existing skipped; 4,530 tests passed / 4 failed / 7 existing skipped. The four failures are exactly the documented socket restriction, listed below; no other failure. `bun-targets.log`. The Bun launcher assigns SQLite-importing files, including the new unit file, to its existing `node-runtime` pool. |
| `bash .axiom-work/scripts/ci-axiom-unit.sh` | Exit 0: 329 files passed, 2,658 tests passed and 1 existing skipped, under Node. Includes the final new six-title file. `node-ci.log`. Native runtime was checked only, not rebuilt. |
| `pnpm tc` | Wrapper exit 1 in the same package-build socket restriction. `tc-wrapper.log`. |
| `node config/scripts/run-typecheck-projects-in-parallel.mjs` | Three consecutive clean runs, each exit 0 with no errors in any project. One additional clean run after replacing the test cleanup's `reverse()` with `toReversed()`. `typecheck-1.log` through `typecheck-3.log`, `typecheck-final.log`. |
| `pnpm run typecheck:e2e` | Wrapper exit 1 in the same package-build socket restriction. `e2e-wrapper.log`. |
| `node config/scripts/run-e2e-typecheck.mjs` | Exit 1 with 226 diagnostics, **zero in the new spec**. 221 are under tests/ and 5 are imported mobile-source diagnostics. No per-file test count grows against the checked-in ratchet; total test allowance is 222. `e2e-typecheck.log`. See the stale-baseline note below. |
| `pnpm run check:code-quality:changed` | Final exit 0, zero new findings in all seven categories across the six TypeScript files. `changed-quality-final.log`. |
| `pnpm lint` | Final exit 0, all stages finished, including RPC-catalog verification and boundary/ratchet checks. Existing informational warnings remain; no new lint error. `lint-final.log`. |
| SCHEMA-2 sidecar assertions | All 60 non-union assertions pass, zero failed. The remaining assertion is the separately completed union invocation below. `schema-2-assertions.log`. |
| `python3 -I .axiom-work/scripts/union-sidecar-check.py "$PWD"` | Exit 0; `retired 10`; final line `ran 2406 skipped 641 failed 0 unique 3057`. `union-sidecars.log`. |
| `git diff --check` | Exit 0. Final scope inspection includes the four new files through the temporary intent-to-add index. |

The exact broad Bun invocation was:

```sh
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts \
  src/main/axiom src/shared/axiom-contract \
  src/main/runtime/rpc/methods/axiom src/main/runtime/rpc/methods/orchestration \
  src/main/runtime/rpc/dispatcher-axiom-caller-authority.test.ts \
  src/main/runtime/rpc/dispatcher-axiom-session-coverage.test.ts \
  src/main/runtime/rpc/dispatcher-axiom-terminal-authority.test.ts \
  src/main/runtime/orchestration src/cli/handlers/axiom src/cli/axiom-verification.test.ts
```

The CI script read and ran its current workflow command under Node:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts \
  src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom \
  src/main/runtime/orchestration/db/schema src/cli/specs src/cli/handlers/axiom \
  src/renderer/src/components/missions src/renderer/src/lib/axiom-client.test.ts \
  src/renderer/src/lib/missions-view.test.ts \
  tests/e2e/helpers/fixture-plan-proposal.unit.test.ts
```

The four broad-run failures all stop at `UnixSocketTransport.start` / `server.listen`, with `listen EPERM`, before the behavior they test. They were left unchanged as directed:

- `src/main/runtime/orchestration-message-delivery-identity.test.ts` — `keeps the built CLI count and Delivery output aligned with isolated SQLite state`.
- `src/main/runtime/orchestration-cli-subprocess.test.ts` — `emits newline-flushed JSON keepalives to stderr while waiting`.
- The same subprocess file — `validates reset scopes against an isolated runtime through the built CLI`.
- The same subprocess file — `creates a late dependent as ready through the built CLI and runtime`.

The first changed-quality and lint runs found one new `unicorn(no-array-reverse)` error in the new test's teardown. The sole fix was `disposals.splice(0).toReversed()`; it preserves reverse cleanup order. The unit file was formatted, both gates passed on rerun, Node CI passed, and the focused Bun set and compiler passed again. No rule or suppression was changed.

For the e2e ratchet, the existing comparator was called with the captured compiler output through its exported `main`, avoiding another compiler run. It exits 1 because `tests/e2e/relay-region-correction.unit.test.ts` now has 0 errors while its untouched baseline allows 1; the comparator requires pruning even for a decrease. Using its `countTestTypeErrors` and the existing `diffCounts` functions confirms `grown: []`, current 221 versus baseline 222, with that single shrunk entry. This meets the Task's at-or-under requirement; the comparator itself is **not** reported as passing. `config/**` is explicitly out of scope, so the stale entry was not pruned. No diagnostic mentions `mission-schema-newer.spec.ts`.

The final local scope review found only the nine allowed files. The helper and getter remain 22 and 295 non-blank lines; the e2e spec is 92; the shared-file diffs remain +2/-0 for the getter, +20/-2 for boot, +2/-1 for the controller error list, and +2/-0 for orca-mapping. The final unit file keeps exactly the six required titles. All existing test files, product layers outside Axiom, and governing artifacts remain unchanged.

## Differences and environmental accommodations

There are no intentional product-scope deviations. The provided design and task scope replace generic skill suggestions to create additional planning files, ask again for design approval, use other implementers, create another worktree, or open a PR. The existing assigned branch is retained for the launcher and independent verifier.

The default shell initially selected Node 20 and could not run this repository's pnpm; subsequent commands select the already-installed Node 24.21.0 using PATH. `pnpm test`, `pnpm tc`, and `pnpm run typecheck:e2e` each stopped in `build:packages` because tsx could not listen on its local pipe (`listen EPERM`). As directed, no wrapper or dependency was debugged or changed; the underlying stages ran directly. No temporary Git variables are passed to tests.

`git add --intent-to-add` for the four new files was refused with `.git/index.lock: Operation not permitted`. As explicitly allowed in the brief, a temporary index and object directory were created under `/tmp/axiom-schema-2.q24aP9/git-checks`; `git read-tree HEAD` initialized that index, and the same four paths were registered with intent-to-add there. Diff/grep assertions and changed-code quality received `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES` (the latter points to this checkout's `.git/objects`). Tests, compiler runs, and lint received none of them. The checkout's real index and refs were not changed; the launcher must add the new files when creating its commit.

## Limits and delivery state

- The check runs when a process first asks for a Control Plane for that database. A cached Control Plane is not rechecked or stopped if another process later raises the stamp.
- The database still opens. The kernel's and Axiom's create-when-missing DDL still runs before this boundary. The stamp is not a schema-definition integrity check, and this change is not a downgrade mechanism. Missing and older stamps are handled by the existing constructor.
- Kernel verbs requiring Mission ownership checks refuse even Runs no Mission owns. Restricted requests of any Agent session holding an active dispatch also refuse. Plain orchestration Worker reports, replies and dispatch therefore do not work there until Axiom is updated.
- Product reset cannot delete Runs or Tasks on that database, so Axiom delete triggers do not fire through those product operations.
- The terminal report when a user types in a former Worker pane is refused; the renderer silently drops that refusal.
- The renderer shows the code and reason. The CLI shows the code/message (the code twice) and next step, not the reason. Both sentences are English.
- The refusal is deliberately broad at the shared Control Plane boundary. Paths that never ask for it remain available, including namespace discovery, terminal/editor/source-control/browser features, taskList and desktop runCreate. Earlier identity refusals remain earlier where they occur before the Control Plane lookup.
- This working tree is prepared for independent verification, not self-accepted, merged, delivered or milestone-complete. No commit, push, PR, merge, branch deletion or worktree deletion was performed. The launcher creates the immutable Candidate; the verifier decides acceptance and M4 status after its host checks.
