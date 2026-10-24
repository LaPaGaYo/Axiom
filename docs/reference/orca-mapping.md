# Axiom ↔ Orca 映射参考（orca-mapping）V1

更新日期：2026-10-23（UPSTREAM-3：新基线、搬家的路径与 schema 编号）；此前 2026-10-20（M2 出口，含 M2-12 / D59）· 审计快照：`stablyai/orca@646e9a5`（v1.4.197）· **冻结基线：`3eb1adec2`（tag `axiom-base`，D19）；2026-10-23 起为 `41661e3312`（tag `axiom-base-2`，D72 全量合并 UPSTREAM-3）**——快照到基线之间唯一改变编排模型的提交是 #22555（party 解析，见 §4a 与 §9 第 14 条）· 仓库落位：`docs/reference/orca-mapping.md`
术语与枚举以 `docs/GLOSSARY.md` 为准；决策编号引用 `docs/decisions/DECISION_LOG.md`（D6a、D7a、D9–D16 已于 2026-10-17 拍板）。

## 1. 用途与阅读方式

本文是「Axiom 领域对象 ↔ Orca 原语（表、类型、RPC、状态、文件）」的**权威对照**，实现 Control Plane（M1 起）前必读。
每一行映射都对应上游源码里实际存在的路径与标识符（相对仓库根目录）；核实不到的标为 `NOT FOUND`。
读法：§2 查对象落位 → §3 查状态/枚举换算 → §4 查 RPC 复用与拦截 → §5 查 Worker 通道 → §6 查迁移 → §7 查 M0 出口 → §8/§9 查落位与陷阱。
策略词汇：`reuse`（直接用 Orca 行/方法）、`extend-additive`（只加可选字段/参数/facet，不改既有语义与 CHECK）、`new side table`（Axiom 新表，外键指向 Orca id）。

## 2. 对象映射表

| Axiom 对象 | Orca 基础（表 / 类型 / 文件） | 策略 | 说明 |
|---|---|---|---|
| Mission | `runs`（`RunRow`，`db/schema/create-core-tables-sql.ts`；无 status 列）；`db.createRun`（`db/runs/run-create.ts`） | `new side table` `missions` + `reuse` runs | 1:1 绑定一个 Run 作为容器与 `run:<runId>` mailbox；Mission 状态只在 `missions.status`。`createRun({ coordinatorHandle: null, coordinatorPaneKey: null, coordinatorOrcaSessionId })`：Mission 的 coordinator 是合成 session party（D14），id 形如 `axiom-mission-<uuid v4>`（满足 `isOrcaSessionId`，不以 `term_`/`structworker_` 开头），持久化在 `missions.coordinator_orca_session_id`，每个 Mission 一个、永不复用（同 id 再建 Run 会解绑旧 Run 并 bump `consumer_generation`）；核实见 `docs/review-evidence/axiom-m1/D14-session-party-spike.md` 与 `src/main/axiom/kernel-contract/session-party-run.test.ts` |
| GoalRevision | 无 | `new side table` `goal_revisions` | `runs.objective` 只存当前 ACTIVE goal 的一句摘要（投影） |
| PlanRevision | 无 | `new side table` `plan_revisions` | Task 集在批准时物化为 Orca `tasks` 行 + `task_stages` 行 |
| Milestone | 无 | 存于 `plan_revisions.milestones`（JSON） | V1 无状态机（A7） |
| Task | `tasks`（`TaskRow`，`db/schema/create-graph-tables-sql.ts`）；`db.createTask`（`db/tasks/task-store.ts`） | `reuse` tasks（`deps=[]`，D10）+ `new side table` `task_stages`（D2） | 项目级权威 = `task_stages.stage`；`tasks.status` 只是 Attempt 执行投影（§3a） |
| TaskEdge | 无（不用 `tasks.deps`，避免 `promoteReadyTasks` 抢先解锁） | `new side table` `mission_task_edges` | readiness 由 MissionController 按 stage 阈值计算 |
| Attempt | `dispatch_contexts`（`DispatchContextRow`）× `worker_dispatches`（`WorkerDispatchRow`）× liveness；`types.ts:290` 注释 "Dispatch ID is the Attempt identity" | `reuse` | **`attemptId ≡ dispatch_contexts.id`**；重试 = 新 dispatch，Axiom 以 `attempt_bindings` seq + failed/started 审计关联。`dispatch_contexts.retry_of_dispatch_id` 仅在 Orca Task failed/blocked（circuit-break / abandon）时指回前次；首次 failDispatch 后 Task 为 ready，该列为 null；不新建 Attempt 表 |
| AgentSpec | `WorkerStartParams`（`src/shared/rpc-contract/orchestration-worker-start-params.ts`：`agent/model/effort/timeoutMs/worktree/setup`）与 `worker_dispatches.start_options` 为投影 | `new side table` `agent_specs`（内容寻址） | `agent_specs.id = sha256(spec)`；启动时投影为 `WorkerStartInput` |
| ContextPackage | 无 | `new side table` `context_packages` + Artifact 存储 | 取代 `buildDispatchPreamble`（§5） |
| Submission | `worker_done` 结算：`settleWorkerReport`（`db/dispatch-context/worker-report-settlement.ts`）；`tasks.result`（JSON） | `new side table` `submissions` + `extend-additive`（D11） | Axiom 先写 Submission 再调用 Orca 结算（§5 编号步骤） |
| Candidate | `attempt_observation_facts` facet `artifact_git`（`db/attempt-observation-types.ts`，生产中未写入） | `new side table` `candidates` + `extend-additive` facet | 由 Control Plane 快照生成（D4）；`artifact_git` facet 追加 `{artifacts, git}` 证据 |
| Artifact | 无（Orca `artifacts.*` RPC 是云分享功能，与此无关） | `new side table` `artifacts` + `<userData>/axiom/artifacts/<sha256>` | DB 只存引用与 hash（G4） |
| Message | `messages`（`MessageRow`；`type` CHECK 九种；`payload` JSON） | `reuse` + `payload.axiom`（D9） | 投递/唤醒/幂等全部复用（§3c、§5） |
| Question | `question_threads`（`db/schema/migrate-v2-v12.ts:121`）；`decision_gates`（`create-graph-tables-sql.ts`） | `reuse` | Attempt 级提问走 `question_threads`（`ask`）；Task 级阻塞走 `decision_gates`（§3e） |
| Decision | 无 | `new side table` `decisions` | 通知经 `messages.type='status'` |
| VerificationRun | 无；可写 `attempt_observation_facts` facet `outcome`（`finished_unverified` 等） | `new side table` `verification_runs` + `extend-additive` facet | 证据文件走 Artifact 存储 |
| IntegrationBatch | 无 | `new side table` `integration_batches` | Git 操作复用 `src/main/git/`（`worktree.ts`、`checkout.ts`） |
| Approval | 不复用 `decision_gates`（D7：`resolveGate` 不校验 options、无 pending 守卫、无 resolver/expiry） | `new side table` `approvals` | 精确动作 + inputs hash + 有效期 |
| Policy | Orca 全局设置局部投影：`nestedWorkerMaxDepth`（`src/shared/default-global-settings.ts:154`）、worker-start 模式（`rpc/methods/orchestration-worker-start-mode.ts`） | `new side table` `mission_policies` | Mission 级策略优先于全局设置 |
| AuditEvent | `mutation_receipts` / `mutation_caller_identities`（`create-core-tables-sql.ts`；幂等，不是审计） | `new side table` `audit_events` + `reuse` receipts | receipts 保留为幂等机制 |
| CompletionReport | 无 | Artifact `kind='completion_report'` | 由 `axiom.mission.completionReport` 生成 |

## 3. 状态与枚举映射

### 3a. Task：`task_stages.stage`（权威）↔ Orca `tasks.status`（投影）

`tasks.status` 的写入点：`transitionLifecycleWithDb`（`db/lifecycle-transition.ts`，`LEGAL_TRANSITIONS.task` 允许任意→任意）；调用方为 `updateTaskStatus`（`db/tasks/task-status-transition.ts`）、`settleWorkerReport`、`createDispatchContext`、`createGate/resolveGate`、`promoteReadyTasks`。

| Orca `tasks.status` | Orca 写入者 | Axiom 投影含义 | 可并存的 `task_stages.stage` |
|---|---|---|---|
| `pending` | `createTask` 且 deps 未满足 | 不应出现（D10：`deps=[]` 创建即 `ready`）；出现即 audit 告警 | — |
| `ready` | `createTask`、`promoteReadyTasks`、`resolveGate` | 仅表示「Orca 允许 `createDispatchContext`」（它要求 `task.status === 'ready'`），**不等于** Axiom `READY` | `DEFINED / READY / NEEDS_FIX / SUBMITTED…INTEGRATED`（无活跃 Attempt 的任何 stage） |
| `dispatched` | `createDispatchContext` | 存在活跃 Attempt | `RUNNING` |
| `completed` | `settleWorkerReport(outcome=succeeded)`、`updateTaskStatus('completed')` | **「当前 Attempt 已结算（succeeded）」**，UI/CLI 不得显示为「完成」 | `SUBMITTED / VERIFYING / VERIFIED / INTEGRATION_READY / INTEGRATED`，以及验证失败后的 `NEEDS_FIX` |
| `failed` | 结算 `failed`、`failWorkerStart`（`db/worker-dispatch/worker-dispatch-outcome.ts`）、`abandonWorkerDispatch` | 当前 Attempt 失败已结算 | `NEEDS_FIX / BLOCKED` |
| `blocked` | `createGate`（Task 级 Question）；`markWorkerStartUnknown`（同上文件，启动结果未知时 `dispatched → blocked`） | 有 pending gate，或 Attempt 启动结果未知 | stage 不变；`READY` 计算中「无阻塞 Question」为假；`start_unknown` 情形 Attempt 仍算 RUNNING（§3b）；重试预算耗尽的 `BLOCKED` 是 Axiom 自己的 stage，不写 Orca |

规则：`INTEGRATED` 与 `CANCELED` 是 Axiom 终态，Orca 侧不做对应写入；`CANCELED` 时若有活跃 Attempt，先 `workerStop/workerAbandon`。

### 3b. Attempt 投影（术语表 §4.6，逐值来源）

| Axiom 视图 | 来源列 / 类型 | 取值与备注 |
|---|---|---|
| `LAUNCH_PENDING` | `attempt_bindings.dispatch_id IS NULL` | admission 已提交但无 dispatch；liveness/workspace 为 null，M2-08 恢复 |
| `STARTING` | `worker_dispatches.state` | `starting` |
| `RUNNING` | `worker_dispatches.state` | `ready`；`stopping` 也按 RUNNING 展示（DDL 注释：`start_unknown/stopping/stop_unknown` 不证明进程退出；术语表 §4.6 已采纳） |
| `SUBMITTED` | `worker_dispatches.state` + `dispatch_contexts.status` | `succeeded` ∧ `completed` |
| `FAILED` | `worker_dispatches.state` 或 `dispatch_contexts.status` | `failed`；`circuit_broken`（`DISPATCH_CIRCUIT_BREAK_FAILURES = 3`，`db/dispatch-context/dispatch-circuit-breaker.ts`）→ FAILED 且触发 B4 |
| `STOPPED` | `worker_dispatches.state` | `stopped`；`dispatch_contexts.termination_reason` ∈ `operator_close/signaled/exited/unknown` 作为附注 |
| `ABANDONED` | `worker_dispatches.state` | `abandoned`（`abandonWorkerDispatch`，`db/worker-dispatch/worker-dispatch-abandon.ts`） |
| `START_UNKNOWN` / `STOP_UNKNOWN` | `worker_dispatches.state` | `start_unknown` / `stop_unknown` |
| `liveness` | `PtyLivenessVerdict`（`src/shared/pty-liveness-verdict.ts`）；持久化为 facet `liveness` + freshness（`db/attempt-outcome-projection.ts`，`DEFAULT_FRESH_AFTER_MS = 60_000`） | `live / unverifiable / exited`（§3d） |
| `workspace` | `worker_terminal_resources.release_state` | `retained`→retained，`released`→released；`not_requested/requested/releasing/unknown` 折叠为 `pending`（术语表 §4.6） |
| `role` | `attempt_bindings.agent_spec_id` → `agent_specs.spec.role` | M2-10：`planner / worker`，缺失 AgentSpec 时回退 worker；UI 不解析 branch 前缀 |
| `submission` | `submissions.dispatch_id` → `candidates.id` | M2-10：可选 id/candidateId/commitSha/treeSha/filesChanged/checksRun/limitations/risks/followUps/createdAt；Candidate 缺失报错，不伪造证据 |
| 失败计数 | `dispatch_contexts.failure_count`（跨重试累加） | Control Plane 的 `retryPolicy.maxAttempts` 为权威计数，circuit breaker 是下限保护（B4） |

`src/main/axiom/execution/attempt-projection.ts` 复用 `projectFleetWorker(runtime, db, dispatchId)` 的 state / resource / workspace；resource absent → workspace null；workspace.id → worktreeId。M2-05 的 `axiom.attempt.show/list` 已注册，异步经 `inspectWorkerTerminal` 读取执行宿主 liveness（按 §3d 折叠，不用 fleet 的 agent-status 判定），可选 `livenessReason` 优先保留 reason、否则保留非 live/exited 的 status，无则 null。

### 3c. 消息类型（D9）

Axiom 八种 → Orca `messages.type`（仅路由/授权语义；产品类型持久化在 `payload.axiom.type`，并携带 `missionId/taskId/attemptId/decisionId/artifactId`）：

| Axiom | Orca `type` | 为什么选它 |
|---|---|---|
| `INFORM` | `status` | 无生命周期副作用；`reconcileLifecycleMessage` 对其 `ignored` |
| `REQUEST` / `BLOCKED` / `REQUEST_SUBTASK` | `escalation` | M2-06a 在 `axiom.attempt.*` 先走共享 `resolveAttemptSender`，再由 MessageRouter 插入；不经内核 send 的生命周期结算，不发给群组 |
| `QUESTION` | `question`（Attempt 级，经 `orchestration.ask` 建 `question_threads`）；Task 级另建 `decision_gates` | 见 §3e |
| `DECISION` | `status`（正文在 `decisions` 表） | Control Plane → Attempt mailbox 的通知 |
| `HANDOFF` | `handoff` | 无副作用；Axiom 在 RPC 层复用宿主核实的 Worker 身份（D73） |
| `SUBMISSION` | `worker_done`（不经 `send`，由 `axiom.attempt.submit` 直接调用 `settleWorkerReport`） | §5 步骤 |

Orca 九种类型在 Axiom 中的用途：

| Orca `type` | Axiom 用途 |
|---|---|
| `status` | INFORM / DECISION 载体 |
| `dispatch` | **禁用**（Orca 旧式「把任务文本投进终端」的派发，Axiom 用 ContextPackage）；Worker 发出即拒绝 |
| `worker_done` | 仅由 Control Plane 结算路径产生；Worker 直接 `orchestration send --type worker_done` 对 Mission Run **拦截**（§4b） |
| `merge_ready` | **禁止 Worker 发出**（发出即拒绝，D9）；Axiom 不用它触发集成 |
| `escalation` | REQUEST / BLOCKED / REQUEST_SUBTASK 载体 |
| `handoff` | HANDOFF 载体 |
| `decision_gate` | 仅 Control Plane 在开 Task 级 gate 时使用；Worker 禁用 |
| `question` | QUESTION 载体（经 `ask`） |
| `heartbeat` | 执行内核 liveness 信号，不是产品消息类型；保留 5 分钟节奏（`preamble.ts` `HEARTBEAT_INTERVAL_MIN = 5`），写 `dispatch_contexts.last_heartbeat_at` |

M2-06a 的严格载荷契约在 `src/shared/axiom-contract/message-params.ts`（`AxiomMessagePayloadSchema`）；八种 D9 映射由 `axiomMessageRoutingType` 返回，Orca CHECK 枚举不变：

```json
{"axiom":{"version":1,"type":"HANDOFF","missionId":"mission-id","taskId":"task-id","attemptId":"dispatch-id","summary":"Evidence ready","artifactIds":["artifact-id"],"related":{"taskIds":["downstream-task-id"]}}}
```

`related` 可含 taskIds / decisionId / artifactId / submissionId（M2-07 additive；SUBMISSION publisher 填不可变 Submission id）。仅 REQUEST_SUBTASK 必须附 `subtask:{title,objective,allowedPaths,acceptanceCriteria,requiredEvidence,risk}`，其它类型禁止该字段。summary ≤ 2,000 字符；Submission 报告摘要可达 4,000，邮件超长时取前 1,999 字符加 `…`，原文留在 submissions.report。Artifact 与显式 Task 引用必须属于同 Mission。Mission/Task 身份来自身份核验后的 Attempt binding，Worker params 没有 to/type/missionId。Control Plane 副本发给 `run:<runId>`，INFORM/HANDOFF 另发直接下游（或非空显式 taskIds）最新 dispatched Attempt 的 `dispatch:<id>`；其 threadId 为 Control Plane 副本 id。详见 `control-plane.md` §6 Worker channel / §8。

### 3d. liveness 三词汇与来源类型

- 词汇：`PtyLivenessVerdict = {status:'exited'} | {status:'live', ptyIds} | {status:'unverifiable', reason}`（`src/shared/pty-liveness-verdict.ts`）。`exited` 需要宿主的正面证据；失联一律 `unverifiable`。
- 来源：`verifyUnstoppedPtys`（`src/main/runtime/unstopped-pty-verification.ts`）、`classifyWorkerTerminalProcessIncarnation`（`orchestration/worker-terminal-process-liveness.ts`）、`inspectWorkerTerminal`（`rpc/methods/orchestration/worker/worker-observation.ts`，状态 `unattached|missing|identity_changed|live|exited|unverifiable`）、fleet 投影（`src/shared/orchestration-fleet-projection.ts`）、facet `liveness`（`AttemptLivenessObservation = PtyLivenessVerdict`）。
- Axiom 归约规则：`inspectWorkerTerminal` 的 `unattached/missing/identity_changed` 一律视为 `unverifiable`（上游先例：`workerRead` 在 `worker-control.ts` 把非 `live/exited` 的观测折叠为 `'unverifiable'`），只有 `exited` 才允许 RecoveryService 结算为 FAILED/STOPPED；`unverifiable` 超过 policy 时限 → `ABANDONED` 并留证据。
- 不要混用的相邻词汇：宿主联系 `live/unverifiable/refused/retired`（`src/shared/runtime-host-contact.ts`）；Agent 活动 `working/blocked/waiting/done`（`src/shared/agent-status-types.ts`）。

### 3e. Question ↔ `question_threads` / `decision_gates`

| 场景 | Orca 机制 | 状态映射（Axiom `OPEN → ANSWERED / WITHDRAWN`） | 副作用 |
|---|---|---|---|
| Attempt 级（Worker 阻塞提问） | `axiom.attempt.ask` → `createQuestion`/`answerQuestion`/`closeQuestionsForDispatch`（`db/questions/question-threads.ts`），`axiom.message.answer` 作答（M2-06b）；Mission 的 orchestration.ask / reply 仍拒绝 | `pending→OPEN`，`answered→ANSWERED`，`closed→WITHDRAWN`（dispatch 结算时自动 close） | dispatch 仍为 `dispatched`，Attempt 保持 RUNNING |
| Task 级（无活跃 Attempt；Planner/人类澄清） | `createGate`/`resolveGate`（`db/decision-gates/decision-gate-store.ts`） | `pending→OPEN`，`resolved→ANSWERED`，`timeout→WITHDRAWN`（`timeoutGate` 无生产调用者） | `createGate` 在 supervised worker 活跃时抛 `task_not_startable`，否则把活跃 dispatch 置 `completed`、Task 置 `blocked`；`resolveGate` 经 `updateTaskStatus(task,'ready')` 解锁 |

注意：D7 文字「gate 用于 Worker 提问」需修正为上表——Worker 提问必须走 `ask`/`question_threads`，gate 不能在 supervised Attempt 活跃时创建。`coordinator-decision-gates.ts`（`openDecisionGateFromMessage`、`reblockTasksWithPendingGates`）是退役 coordinator 的死代码，不复用。

## 4. RPC 映射

注册表：`ALL_RPC_METHODS`（`src/main/runtime/rpc/methods/index.ts`）→ `buildRegistry`（`rpc/core.ts`，重名抛 `duplicate_rpc_method:<name>`）→ `RpcDispatcher`（`rpc/dispatcher.ts`）。41 个 `orchestration.*` 方法聚合在 `rpc/methods/orchestration.ts`（`ORCHESTRATION_METHODS`）。

### 4a. Axiom 内部调用的 Orca 方法（经 service/DB 边界，不经 CLI）

以下状态按 M2-12 / D59 合入后的实现回填；表中的 Orca RPC 名只定位原语，Control Plane 实际走 service/DB 边界。子系统现状见 [control-plane.md](control-plane.md)。

| Orca 方法（文件） | Axiom 用途 | 备注 | M2 最终状态 |
|---|---|---|---|
| `orchestration.runCreate`（`orchestration/runs/runs.ts`） | M1 已实现：`src/main/axiom/mission-controller/mission-lifecycle.ts` 创建 Mission/Run | RPC 要求真实 coordinator party；Axiom 直接调 `db.createRun({coordinatorHandle: null, coordinatorPaneKey: null, coordinatorOrcaSessionId: <合成 id>})`（#22555 后已支持 session coordinator；D14）。`db/runs/run-create.ts` 通过 `runLifecycleWriteTransaction` 创建：顶层 `BEGIN IMMEDIATE`，嵌套时 savepoint，Run 与 Mission 可同事务回滚（M1-05） | 已实现（M1-05） |
| `orchestration.taskCreate`（`messaging/message-methods.ts`） | M1 已实现：`src/main/axiom/mission-controller/plan-materialization.ts` 批准时物化 Task | 直接调 `db.createTask({deps: [], runId})`，同事务写 `task_stages` 与 `mission_task_edges`；提案 id 映射为 Orca Task id | 已实现（M1-05、M2-06b task.create、M2-09 pseudo-task） |
| `orchestration.workerStart`（`orchestration/worker/workers.ts` → `startLocalWorker`，`local-worker-start.ts`） | Scheduler 启动 Attempt（首个调用者 M2-05） | RPC handler 以 `getCurrentRunForCoordinator(coordinator)` 解析 Run（否则 `consumer_fenced`）；M1-07 仍拒绝 Mission Run 的直接 RPC 调用。**M2-01 已实现 service-only `controlPlane?: ControlPlaneWorkerStart`**，类型位于 `src/main/runtime/rpc/methods/orchestration/worker/control-plane-worker-start.ts`，入口为同目录 `local-worker-start.ts`：`dispatchCreator?`（Control Plane 传 `{kind:'system'}`）、`worktreeId?`（精确 managed id；`params.worktree` 只能省略或为 `current`）、`branchNameOverride?`（仅内核新建 worktree；D6a 分支名）、`preambleBuilder?`（替换文本，保留投递与 turn observation）、`dispatchMaxDepth?`（只可收窄 runtime 上限；Mission 传 1）、`callerIdentity?`（null handle 不记录终端 lineage）。分支与 lineage 经同目录 `worker-start-agent-placement.ts` → `worker-worktree-creation.ts`；preamble 经 `worker-start-readiness-settlement.ts` → `deliver-worker-dispatch-preamble.ts`，深度上限 1 不提示 sub-workers。省略 bag 保持原行为；`params.from = caller.address`，`coordinator` 与 `callerSession` 同取合成身份，`existingTask` 为 Mission Task。RPC schema、handler、session-record / lease 校验均不变，六字段不进入 RPC params | 已实现（M2-01 seam、M2-05/09 启动） |
| `createManagedWorktree` + `startLocalWorker` service-only bag | M2-05 已实现：从 `axiom/integration/<missionId>` 预创建分支，再传 worktreeId、system creator、preambleBuilder、depth 1、同一 synthetic caller（coordinator/callerSession/callerIdentity） | `params.worktree = current`；bag 不传 branchNameOverride，branch override 只给 worktree service；receipt 三类均先 CAS 绑定 dispatch id，再 audit / settle | 已实现（M2-05/09） |
| `stopLocalWorker(runtime, dispatchId)`（`worker/local-worker-stop.ts`） / `releaseLocalWorker(runtime, dispatchId)`（`worker/local-worker-release.ts`） | M2-08 抽取原本地 stop/release body，RecoveryService 可经 service 边界调用 | RPC 保留 assertNotMissionManaged、federated 分支；本地 RPC 和 Control Plane 共用 dedupeWorkerStop，receipt/error/RPC params 不变；无 kernel 状态机变化，stop_unknown 的 live 重试限制见 control-plane.md §4 | 已实现（M2-08/09） |
| `orchestration.workerStop` / `workerAbandon` / `workerRelease` / `workerRetain`（`worker/worker-stop.ts`、`worker-control.ts`、`worker-release.ts`） | 经 stopLocalWorker / abandonWorkerDispatch / releaseLocalWorker / retainWorkerTerminalResource 停止、放弃与维护终端资源 | 结算后候选未 superseded/INTEGRATED 前用 `workerRetain`（D4） | 已实现（M2-07 retention、M2-08 recovery/cancel） |
| `orchestration.workerShow` / `workerRead` / `workerList`（`worker-control.ts`、`worker-list-method.ts`） | Attempt 观测、终端回读、fleet 投影 | `workerShow` 返回 `dispatch/worker/projection(fleet 判定)/observation(inspectWorkerTerminal 状态)/terminalResource`，`workerRead` 另附 `status.liveness`（PTY）与 `projection`（Agent） | 已实现（M2-05 观测/投影；终端回读仍用内核入口） |
| `OrcaRuntimeService.confirmTerminalShellForeground(handle)`（`src/main/runtime/terminal/layout/terminal-resize-listeners.ts`；原在 `orca-runtime-subscribe-to-terminal-resize.ts`，随上游 #27614 搬移） → controller `confirmForegroundProcess` | M2-12 / D59（attempt 2 修正）：Recovery 对 live、exact、PTY、ready Attempt 读取执行宿主的新鲜前台进程名，非空且 isShellProcess 判为 shell 时按 control-plane.md §4 c′ 结算 | 仅主进程内访问器，非 RPC；按 getOrchestrationDispatchAuthority 的 live PTY 路径解析 handle。controller.confirmForegroundProcess → daemon 请求 confirmForegroundProcess（daemon-pty-process-inspection → daemon-request-router → Session）→ foreground-process-tracker.confirmForegroundProcess → resolveAgentForegroundProcessWithAvailability(fresh)，node-pty 前台名作 fallback；controller 方法缺失时回退 getForegroundProcess。无 PTY / controller、null、非 shell、异常、超时（PTY_CONTROLLER_LIST_TIMEOUT_MS）均返回 false；SSH 返回 null。daemon confirmShellForeground 是 recovery barrier 的 settled owner，不作退出证明；不改 daemon、RPC、schema 或 PTY/fleet 投影 | 已实现（M2-12 attempt 2；宿主证据 `.axiom-work/verifications/M2-12-1.md`） |
| `orchestration.dispatchShow`（`runs/dispatch-methods.ts:188`） | 展示 Attempt 的 dispatch 上下文 | `orchestration.dispatch` 本身不用（§4b） | 已实现（Attempt 读接口直接读 dispatch；不另调该 RPC） |
| `orchestration.send` / `check` / `inbox` / `reply` / `ask`（`messaging/*.ts`） | Worker 侧消息经 `axiom.attempt.*` 落到同一 `db.insertMessage` / `createQuestion`；Control Plane 回复 Worker 用 `send` 到 `dispatch:<attemptId>`（`from` 可为合成身份，`SendParams.from` 可选） | `worker_done/heartbeat` 在 `send-point-to-point.ts` 内同步结算；`check --wait` 长轮询 `RuntimeMessageWaiters`（`runtime-message-waiters.ts`） | 已实现（M2-06a/b 路由、check、ask/answer） |
| `orchestration.gateCreate` / `gateResolve` / `gateList`（`gates/gates.ts`） | Task 级 QUESTION | Mission 的 gateCreate/gateResolve RPC 均拦截；现有 `message.answer` 回答的是 question_threads，不是 Task gate | 未实现 Mission Task gate 创建/解析入口；M2 只读取阻塞，M3 或以后接入 |
| `orchestration.requestShow`（`runs/mutation-request-show.ts`） | 查询幂等收据 | 与 `mutation_receipts` 配套 | 已实现（M1-06 envelope/receipts，M2 Worker 复用） |
| Run mailbox 消费：`getUnreadRunMailbox` / `getOrCreateRunDelivery` / `acknowledgeRunDelivery` / `requireCurrentConsumer`（`db/runs/run-delivery.ts`） | MissionController 的确定性消费者：`src/main/axiom/mission-controller/run-mailbox-consumer.ts`；启动/恢复接入 `src/main/axiom/control-plane-boot.ts` | 以 `runs.consumer_generation` 栅栏；先注册 exclusive waiter 再 drain，整批处理后 ack，审计按 message id 幂等，重启后可续；`src/main/axiom/recovery/recovery-service.ts` 校验持久 Run/session 绑定，正常恢复不写 recovery 成功事件，失败记 `recovery.run_binding_lost` | 已实现（M1-08、M2-06/08 扩展） |


### 4b. 对 Mission 管理对象必须拦截/禁用的 Orca 入口

判定依据：`tasks.run_id`（或 `dispatch_contexts.run_id`）命中 `missions.run_id`。M1-07 已实现统一守卫 `src/main/axiom/admission/mission-managed-run-guard.ts`，下列 handler 在对象解析后、首次写入前调用；`mission_managed` 已登记于 `src/main/runtime/rpc/errors.ts`。进程内 `caller: control_plane` 不能来自 RPC params。D73 只更换 Worker channel 的身份依据；本节 Mission admission 守卫全部保留。

| Orca 入口 | 内核原行为 / 风险 | 拦截点 | M1 实现 |
|---|---|---|---|
| `orchestration.taskUpdate` 改 `status` | `updateTaskStatus` 只校验活跃 dispatch，可直接写 `completed` 并 `promoteReadyTasks` | `messaging/message-methods.ts` 的 `orchestration.taskUpdate` handler（不拦 `updateTaskStatus` 本身，`resolveGate` 内部要用它） | `assertNotMissionManaged` → `messaging/message-methods.ts`（`taskUpdate`，Task 解析后） |
| `orchestration.reset`（`--all/--tasks/--messages`） | `resetAll/resetTasks` 删除 `runs/tasks/dispatch_contexts/messages…`（`db/reset/orchestration-reset.ts`），破坏性；v43 已加 side-table 删除清理触发器，RPC 仍须在删除前拒绝 | `runs/reset-methods.ts` handler：存在任一 Mission 时拒绝，改走 `axiom.mission.cancel` + Approval（C14） | `assertResetAllowed` → `runs/reset-methods.ts`（三种 scope 的首次副作用前） |
| `orchestration.workerStart` / `orchestration.dispatch` | 任一 coordinator 终端可对 `ready` Task 启动 Attempt | `worker/workers.ts`、`runs/dispatch-methods.ts` handler：Mission Run 只接受 Control Plane caller（D10） | `assertNotMissionManaged` → `worker/workers.ts`（`workerStart`）、`runs/dispatch-methods.ts`（`dispatch`），Run / Task 解析后 |
| `orchestration.send --type` ∈ {`worker_done`, `merge_ready`, `dispatch`, `decision_gate`} 来自 Worker | `merge_ready/dispatch` 不经任何授权校验 | `messaging/send-methods.ts` handler：目标为 Mission Run 时按 §3c 表拒绝 | `assertWorkerMessageAllowed` → `messaging/send-methods.ts`（目标 mailbox / Run 解析后，结算前） |
| `orchestration.gateCreate` / `gateResolve` 来自非 Control Plane | 任一 coordinator 可开/关 gate 并改 Task 状态 | `gates/gates.ts` handler | `assertNotMissionManaged` → `gates/gates.ts`（`gateCreate` / `gateResolve`，Task / gate 解析后） |
| `orchestration.runUse --takeover-legacy` / 重绑 coordinator | 会 `unbindOtherRunsForPane`、bump `consumer_generation` | `runs/runs.ts` handler：Mission Run 禁止被终端接管 | `assertNotMissionManaged` → `runs/runs.ts`（`runUse`，`getRun` 后、`bindRun` 前；任何 flags 都拒绝） |
| `orchestration.run` / `runStop`、CLI `orchestration coordinator-start` | 已退役：`RETIRED_ORCHESTRATION_METHODS`（`src/shared/orchestration-rpc-contract.ts`）→ `orchestration_migration_required(command_retired)`；CLI 在 `src/cli/handlers/orchestration/dispatch-handlers.ts:69` | 无需处理；文档中不再提「coordinator」 | 沿用 `rpc/orchestration-contract-fence.ts`；`admission/admission-rpc.test.ts` 验证两种 Run 均保持退役拒绝 |
| `taskCreate` 带 `deps` | 会让 `promoteReadyTasks` 生效 | Mission Run 内 RPC taskCreate 一律拒绝（含空 deps） | `assertTaskCreateAllowed` → `messaging/message-methods.ts`（`taskCreate`，Run 解析后；RPC 即使无 deps 也拒绝，只有 `axiom.plan.approve` 物化 Task + stage） |
| `workerStop` / `workerAbandon`（M2-06a） | 终止/放弃 Attempt，绕过 Control Plane | `worker/worker-stop.ts` / `worker-control.ts`，首次写入前 | dispatchId → `assertNotMissionManaged`；`admission-worker-control.test.ts` |
| `workerRelease` / `workerRetain` / `workerTerminalUserInput`（M2-06a） | 改变资源所有权、释放或保留终端 | `worker/worker-release.ts`；input 先解析 pane/session/handle | dispatch 或 pane 关联的资源 → 同一守卫；覆盖已结算资源与 remint，`admission-worker-control.test.ts` |
| `orchestration.ask`（M2-06a） | 创建 question_threads，绕过 typed Worker channel | `messaging/ask-methods.ts`，activeDispatch 后、createQuestion 前 | dispatchId → 同一守卫；`admission-rpc.test.ts` |
| `orchestration.reply`（M2-06a） | 直接读标记/回答，绕过 Control Plane answer | `messaging/message-methods.ts`，原消息解析后、markAsRead/answerQuestion 前 | original.run_id + 发送者 Run → 同一守卫；`admission-rpc.test.ts` |
| `orchestration.send` 群组（M2-06a） | @all / @worktree 等广播绕过对象关系路由 | `messaging/send-methods.ts`，sendGroupMessage 前 | routing.run / sender Run → 同一守卫，verb 为 `orchestration.send(group)`；`admission-rpc.test.ts` |
| `workerStart --on <environment>`（M2-06a 测试） | federation 远端派发越过 Scheduler | 沿用 `worker/workers.ts` 的既有 workerStart guard | 无代码更改；`admission-rpc.test.ts` 验证 Mission 在 federation 前拒绝，非 Mission 到达 federation seam |

M1 出口第 3 条证据：`src/main/axiom/admission/mission-managed-run-guard.test.ts`、`admission-rpc.test.ts`、`admission-run.test.ts`、`admission-message.test.ts` 覆盖全表及非 Mission 对照。task-update / worker-start 的三层拒绝依次是：CLI 无终端身份时，`src/cli/handlers/orchestration/terminal-identity.ts` 的 `resolveCoordinatorTerminalHandle` 抛 `no_active_sender_terminal`（尚未发送 mutation RPC）；runtime Run 绑定解析返回 `run_required` / `consumer_fenced`；Mission 守卫返回 `mission_managed`（绑定 coordinator 的 RPC 测试覆盖）。出口 e2e `tests/e2e/mission-exit-m1.spec.ts` 要求三动词拒绝且全部 Mission/Task 快照不变，只接受上述固定集合；reset 仍仅接受 `mission_managed`。

### 4c. 新增 `axiom.*` 方法清单

M0 通过 `src/main/axiom/namespace-rpc.ts` 的 `axiom.namespace.get` 注册命名空间，保留的 RPC 命名空间、方法前缀与 CLI 顶层命令名统一定义在 `src/shared/axiom-contract/namespace.ts`。

约定：参数 zod schema 在 `src/shared/axiom-contract/<ns>-params.ts`；所有 mutation 需 `orchestrationContractVersion === 1` 与 `orchestrationRequestId`（幂等）；Worker 侧方法另经 `orchestrationCompatibilityEvidence` 解析宿主调用方，并核对 Attempt 身份（D73）。「M」= mutation。

M1 参数契约位于 `src/shared/axiom-contract/mission-params.ts`、`goal-params.ts`、`plan-params.ts`、`task-params.ts`，M1-06 已经由 `src/main/runtime/rpc/methods/axiom/{mission,goal,plan,task}.ts` 注册到 `methods/axiom.ts` / `methods/index.ts`，并接入 envelope 栅栏。CLI 实装为 `src/cli/specs/axiom-mission.ts`、`axiom-plan.ts`、`axiom-task.ts` 与 `src/cli/handlers/axiom/`（Goal 命令挂 `mission goal`）；生成 catalog、`cli-command-names.ts` 与 parity 测试已对齐。

下表明确区分已注册/已实现的方法（含 M3-01 Verification 读取）与后续契约占位；“未注册”不得作为当前可调用 API。`axiom.namespace.get`（M0-11，只读）继续注册。

| 方法 | 参数要点 | 副作用 | M | 当前状态 |
|---|---|---|---|---|
| `axiom.mission.create`（M1 已注册） | repo selector、targetBranch、goal、policy | `missions` + `db.createRun`（合成 coordinator）+ `goal_revisions`(ACTIVE) + `mission_policies` + `audit_events` | M | 已注册 / 已实现 |
| `axiom.mission.show` / `list`（M1 已注册） | missionId / 过滤、cursor | M2-10 MissionSummary 含 runId；reason 为最新同状态 mission.status 审计的 after.reason（无则省略） | — | 已注册 / 已实现 |
| `axiom.mission.plan`（M2-09 已注册） | missionId | ANALYZING 启动只读 Planner，pseudo-task/binding/spec/artifacts；响应 attemptId（可空）/seq/branch/worktreeId/provider；transport long-poll + CLI 120 s | M | 已注册 / 已实现 |
| `axiom.mission.start`（M1 已注册） | missionId | 用户启动：`PLANNED → EXECUTING`，D51 创建/沿用集成基线，重算 readiness 并触发 Scheduler admission/launch | M | 已注册 / 已实现 |
| `axiom.mission.pause` / `resume` / `cancel`（M1 已注册） | missionId、reason | `missions.status`；pause 停 admission；cancel 持久化 CANCELED 后 await M2-08 reconciliation（stop/abandon/release）；Approval 留 M4 | M | 已注册 / 已实现 |
| `axiom.mission.deliver` | missionId、approvalId | 集成基线合入目标分支（D6），成功 → `COMPLETED` | M | 未注册；M4 |
| `axiom.mission.completionReport` | missionId | 生成 Artifact `completion_report` | M | 未注册；M4 |
| `axiom.goal.propose` / `activate` / `show`（M1 已注册） | missionId、goal 正文 / goalRevisionId | PROPOSED / ACTIVE+SUPERSEDED 前版 + `MAJOR_REPLAN` 触发 | M/M/— | 已注册 / 已实现 |
| `axiom.plan.propose`（M1 已注册） | missionId、planRevision；人类 provenance 或 Planner attemptId/from + 宿主调用方身份（互斥） | `plan_revisions`(PROPOSED)，Mission → `PLAN_REVIEW`；Planner 强制 clean worktree、写 kind=planner/actor=provider、2 秒 stop grace | M | 已注册 / 已实现 |
| `axiom.plan.approve` / `reject`（M1 已注册） | planRevisionId、resolver；reject 另需 reason | APPROVED：物化 `tasks`(deps=[]) + `task_stages` + `mission_task_edges`，重算 readiness；旧 Task `inherit/cancel/rebind` 留给 M5 | M | 已注册 / 已实现 |
| `axiom.plan.list` / `show`（M1 已注册） | missionId / planRevisionId | 无 | — | 已注册 / 已实现 |
| `axiom.task.list` / `show`（M1 已注册） | missionId、stage / taskId | 联查 `task_stages` × `tasks` 返回 TaskListItem/spec；Attempt 与 Submission 详情经 attempt.list/show | — | 已注册 / 已实现 |
| `axiom.task.create`（M2-06b 已注册） | missionId、task（TaskSpec 无 id）、dependsOn、provenance | MissionController 在 active APPROVED plan 追加 DEFINED Task / edges；D50 检查、task.created + plan.minor_adjustment，重算 readiness、提交后 Scheduler trigger | M | 已注册 / 已实现 |
| `axiom.task.cancel`（M1 已注册） | taskId、authorized rationale | `CANCELED`；M2-08 reconciliation 处理活跃 Attempt，已提交 Candidate 不提前释放 | M | 已注册 / 已实现 |
| `axiom.attempt.submit`（M2-07 已注册，流程见 §5） | attemptId、from、senderPaneKey?、report（summary/filesChanged/checksRun/artifacts/limitations/risks/questions/followUps）；Task 从 binding 取 | Candidate/Submission、settleWorkerReportInTransaction、SUBMITTED、QUEUED；提交后 retention 与 SUBMISSION 邮件；响应 submission/candidate/duplicate | M | 已注册 / 已实现 |
| `axiom.attempt.inform` / `request` / `blocked` / `handoff` / `request-subtask`（M2-06a 已注册） | attemptId、from、summary、body?、artifactIds、related；子任务另有 subtask | `resolveAttemptSender` → MessageRouter（§3c），原子 mail / message.sent / mutation receipt | M | 已注册 / 已实现 |
| `axiom.attempt.ask`（M2-06b 已注册） | attemptId、from、question?、options?、timeoutMs?、resume? | authority → createQuestion（其原消息即 Control Plane 副本），receipt 后通知/长轮询；resume 同 dispatch，closed → dispatch_inactive | M | 已注册 / 已实现 |
| `axiom.attempt.check`（M2-06a 已注册） | attemptId、from、wait?、timeoutMs?、type? | 同一 authority check → 内核 checkWorkerMailbox；保留 generation fence / 长轮询，不开放 ack | — | 已注册 / 已实现 |
| `axiom.attempt.show` / `list`（M2-05 已注册） | attemptId / missionId、taskId? | M2-05 已注册：§3b fleet 状态/资源 + 执行宿主 liveness；M2-10 增加 role 与可选 submission（commit/tree/报告）；CLI `axiom attempt show/list` | — | 已注册 / 已实现 |
| `axiom.attempt.stop` / `abandon` | attemptId、reason | 委托 `workerStop`/`workerAbandon` service | M | 未注册；不早于 M3（后续 Task 定义） |
| `axiom.verification.show` / `list`（M3-01） | runId / missionId、taskId?、candidateId?、status? | 只读 VerificationRunView：全部 run 字段 + Candidate commit/tree + phase；缺失 run/Candidate → not_found；CLI verification show/list | — | 已注册 / 已实现 |
| `axiom.verification.resolveReview` | verificationRunId、verdict(PASS/FAIL)、reviewer、evidence | 仅 `INCONCLUSIVE` 可收敛 | M | 未注册；M3 |
| `axiom.verification.rerun` | candidateId、reason | 新 `verification_runs`(QUEUED) | M | 未注册；M3 |
| `axiom.integration.queue` / `show` | missionId / batchId | 无 | — | 未注册；M4 |
| `axiom.integration.promote` | batchId、approvalId? | `PROMOTABLE/AWAITING_APPROVAL → PROMOTED`，基线 ref 前进 | M | 未注册；M4 |
| `axiom.approval.list` / `grant` / `deny` / `revoke` | missionId / approvalId、resolver、note | `approvals.status`；grant 后单次 CONSUMED | —/M/M/M | 未注册；M4 |
| `axiom.decision.propose` / `accept` / `reject` / `list` / `show` | missionId、decision 正文、provenance | `decisions`；accept 发 DECISION 通知 | M/M/M/—/— | 未注册；不早于 M3（后续 Task 定义） |
| `axiom.artifact.put` / `read` / `list`（M2-02 已注册） | put：missionId、kind、contentBase64（≤8 MiB）、mediaType、related、createdBy；read：id；list：missionId、kind?、relatedTo? | 原子内容寻址写入 + `artifacts` 元数据；read 校验 hash；CLI 挂 `mission artifact`，无新顶层命令 | M/—/— | 已注册 / 已实现 |
| `axiom.message.list`（M2-06a 已注册） | missionId、type?、taskId?、attemptId?、pendingOnly? | 同 Run 的 typed messages + question_threads QUESTION 投影（question/options/answer/status），sequence 升序；QUESTION pending 按 thread 状态，REQUEST_SUBTASK pending 按 subtask.resolved | — | 已注册 / 已实现 |
| `axiom.message.answer`（M2-06b 已注册） | missionId、questionId、body | answerQuestion（当前 consumer_generation），question.answered，重算 readiness，通知 dispatch status waiter | M | 已注册 / 已实现 |
| `axiom.message.resolve`（M2-06b 已注册） | missionId、messageId、decision=accept/reject、rationale | accept 重跑六项 D50 检查，经 MissionController.createTask；reject 仅审计；subtask.resolved 清 pending，重复处置 invalid_argument | M | 已注册 / 已实现 |
| `axiom.message.send`（后续） | 目标 attemptId、body | insertMessage 到 dispatch mailbox | M | 未注册；不早于 M3（后续 Task 定义） |
| `axiom.policy.show` / `update`（M2-03，M3-02 扩展） | missionId、patch | routing/concurrencyLimit/verificationRules；verificationRules 严格校验并整体替换；budget 请求 approval_required（M4），未知键 invalid_argument | —/M | 已注册 / 已实现 |


注册 5 步：(1) zod params 放 `src/shared/axiom-contract/<ns>-params.ts`（catalog 生成器只索引 `src/shared/**` 且被 `src/main/runtime/rpc/**` 相对导入的模块）；(2) `AXIOM_<NS>_METHODS = [defineMethod({ name: 'axiom.ns.verb', params, handler: (p, { runtime, orchestrationCaller, orchestrationCompatibilityEvidence }) => … })]` 放 `src/main/runtime/rpc/methods/axiom/<ns>.ts`，聚合为 `AXIOM_METHODS`（`methods/axiom.ts`）；(3) `...AXIOM_METHODS` 加入 `ALL_RPC_METHODS`（启动即验重名）；(4) `pnpm generate:rpc-params-catalog` 重新生成 `src/shared/rpc-contract/rpc-params-catalog.generated.ts`，`pnpm verify:rpc-params-catalog`（`pnpm lint` 内）必须通过；(5) CLI：spec 放 `src/cli/specs/axiom*.ts`，handler 放 `src/cli/handlers/axiom/`，顶层命令名加入 `CLI_COMMAND_NAMES`（`src/main/startup/cli-command-names.ts`，需保持排序；`src/cli/cli-command-name-parity.test.ts` 校验与 `COMMAND_SPECS` 一致）。

Envelope 字段（`RpcRequest`，`rpc/core.ts:44`）：`orchestrationContractVersion`（mutation 栅栏，`rpc/orchestration-contract-fence.ts`；缺失 → `orchestration_migration_required(client_contract_missing)`）、`orchestrationCompatibilityEvidence`（终端 / pane / 注入的 Orca session id；宿主解析为调用方身份）、`orchestrationRequestId`（幂等键，`OrchestrationMutationExecutor`）。M1-06 已完成两处 additive 扩展：`src/shared/axiom-contract/mutations.ts` 的 `AXIOM_MUTATION_METHODS` / `isAxiomMutation` 接入 `src/shared/orchestration-rpc-contract.ts` 的 `isOrchestrationMutation`，同一谓词驱动栅栏与 `isDurableMutation` 收据；`src/cli/runtime/client.ts` 对 `orchestration.` 与 `axiom.` 都写 `orchestrationContractVersion`。D73 将 CLI compatibility evidence 与宿主 session caller 解析接入 Worker 的 `axiom.attempt.*` 命令及 `axiom.plan.propose`；其余 Axiom 命令保持原调用方语义。`src/shared/protocol-version.ts` 已公布 `AXIOM_CONTROL_PLANE_RUNTIME_CAPABILITY = axiom.control-plane.v1`。

M1 响应契约见 `src/shared/axiom-contract/{mission,goal,plan,task}-params.ts`：单对象使用 `mission` / `goalRevision` / `planRevision` / `task`，列表使用 `missions` / `planRevisions` / `tasks`；mutation 另有内核 `mutation` 收据。Mission 返回 `MissionSummary`，Task 返回 `TaskListItem`（stage 是权威，orcaStatus 仅是执行投影）。`src/main/axiom/control-plane.ts` 按 `OrchestrationDb` WeakMap 惰性缓存 store/controller/recovery，M1-08 加入消费者生命周期；`control-plane-boot.ts` 在桌面 `src/main/startup/main-process-runtime-service.ts` 与 daemon `src/main/orcad/orcad-entry.ts` 启动/停止，不改变 runtime 类。Goal 激活仅允许 ANALYZING 或 EXECUTING，后者进入 REPLANNING 并记录 MAJOR_REPLAN；替换计划的批准仍是 M5。M2 已接启动与 cancellation stop/abandon/release；`MissionSummary.runId` 来自 missions.run_id，reason 来自最新匹配当前状态的 mission.status 审计（M2-10）。

M2-03 已注册 `axiom.policy.show`（read）/ `axiom.policy.update`（mutation）：params 在 `axiom-contract/policy-params.ts`，method 在 `rpc/methods/axiom/policy.ts`，聚合 AXIOM_METHODS、mutation fence/receipts 与 generated catalog 同步。CLI `mission policy show/update` 同时注册在 specs、handlers 与 handler-group-manifest 的 axiom-mission 分组，无新顶层名。budget 请求返回 approval_required；无可选 provider 返回 no_eligible_provider，两者透传 runtime error code。

M3-01 的 verification-params.ts 在 shared 定义 run/view/params/response；methods/axiom/verification.ts 聚合进 AXIOM_METHODS，catalog 同步生成；show/list 加入 exhaustive reads，不进 mutation fence。CLI specs/handler、axiom-verification group、formatter 与 startup/parity 名称同步。

M3-02：`axiom.policy.update.patch.verificationRules` 是可选的 additive 字段；CLI `mission policy update --verification-rules-file <json>` 与 routing-file 并列，读取严格 `verification-rules.ts` schema，沿用 policy.updated、envelope 与 mutation_receipts。PolicySchema 仍读取旧 JSON record；运行器把非法旧策略结算为 INCONCLUSIVE(policy_invalid)，交人。既有 verification_runs.commands / tool_versions 列通过带 claim fence 的 updateVerificationRun 写入，无 migration；状态转换守卫禁止 FAIL → PASS。

检查执行复用 `src/main/automations/precheck-runner.ts` 导出的 `spawnLocalShellCommand(command, cwd)`：runLocalPrecheck 与验证运行器共享这一个既有 shell spawn 点，选项不变，Axiom 不新增 child_process 直接导入。timeout / shutdown 仍复用导出的 `killLocalPrecheckProcessTree`；没有改 orchestration 内核。worktree 仍只由 runtime.createManagedWorktree / removeManagedWorktree 管理；非本地 repository 经 isRepoOnCatalogHost 判定，不执行本地命令。日志/判定走既有 ArtifactStore，Task 结算走 missions.transitionTaskStage，FAIL 重试共用 Axiom 侧 settleVerificationFailure。DEF-21 ⑥ 的 candidate_unchanged 守卫位于 Axiom 的 axiom_submit 事务、insertCandidate 前，按上一 ACTIVE Candidate 的 treeSha 拒绝相同树；不改变内核 worker_done 结算。

### 4d. 现有命名冲突清单（`rg` 于 `src/main/runtime/rpc/methods/` 与 `src/main/startup/cli-command-names.ts` 核实）

| 命名空间 / 命令 | 实际方法 | 文件 |
|---|---|---|
| `project.*` | `project.list`、`project.update` | `rpc/methods/project-runtime-rpc-methods.ts`（经 `repo.ts` 展开）；`Project` = 仓库/provider 身份（`src/shared/project-types.ts`） |
| `projectHostSetup.*` | `list/create/setupExistingFolder/clone/update/delete` | 同上 |
| `projectGroup.*` | `list/create/update/delete/moveProject/scanNested/importNested` | `rpc/methods/repo.ts` |
| `automation.*` | `list/show/create/update/delete/runNow/runs` | `rpc/methods/automations.ts` |
| CLI `orca project` | 顶层命令 `project` | `cli-command-names.ts`；spec `src/cli/specs/project.ts` |
| CLI 顶层 `check` | 浏览器 checkbox 命令 `path: ['check']` | `src/cli/specs/browser-basic.ts:108`——因此 Worker 命令统一挂在 `axiom attempt <verb>`（术语表 §5、D16），与 `axiom.attempt.*` 对齐；无残余冲突 |

现存顶层 RPC 命名空间（46 个，`axiom`/`mission` 均未被占用）：`accounts agent agentHooks agentSession agentTeams aiVault artifacts automation browser clipboard computer diagnostics emulator files folderWorkspace git github gitlab host hostedReview jira linear markdown nativeChat network notifications orchestration pairing plugins preflight project projectGroup projectHostSetup repo runtime session settings skills speech ssh stats status terminal ui updater workspacePorts worktree`。

## 5. Worker 通道

**身份与传输**：Worker 进程内的 CLI 通过 `orca-runtime.json`（`getRuntimeMetadataPath`，`src/shared/runtime-bootstrap.ts`；含 `authToken`）连接 `rpc/unix-socket-transport.ts` 或 `ws-transport.ts`。调用者身份来自环境变量：`ORCA_TERMINAL_HANDLE`（PTY 派生时注入，`src/main/ipc/pty/ipc/spawn-options.ts:32`）、`ORCA_PANE_KEY`（remint 稳定的 pane 身份，`src/cli/handlers/orchestration/terminal-identity.ts`）、`ORCA_AGENT_LAUNCH_TOKEN`（agent 状态 hook 的启动令牌）、`ORCA_AGENT_HOOK_TOKEN`（hook 服务鉴权，`src/main/ipc/pty/host-env/spawn-env-keys.ts`）、`ORCA_AGENT_TEAMS_TOKEN`（`src/cli/index.ts:218`）；WSL 透传清单在 `src/main/pty/wsl-orca-env.ts`。process incarnation 由运行时从 pane 解析（`runtime.getTerminalProcessIncarnation`），不由调用者自报。

**Worker 身份（D73，取代 D11 的 capability）**：`orchestration-session-caller.ts` 在参数解析前核验注入的 Orca session id，结构化 Worker 映射到其 assignee handle / pane；无 session caller 时先走 `assertLifecycleCallerIsNotAnotherParty`。`resolveAttemptSender` 复用 `workerReportRefusal`：拒绝 stopping，已记录 process incarnation 时用 `isDispatchProcessCurrent`，否则用 `isDispatchMessageSender`；再核对 `hasLifecycleAuthority`、最新 binding 及 Task/Mission/Run。Axiom 不铸造、传送或校验 dispatch capability。`prepareStartingWorkerAuthority` 仍持久化身份并推进 consumer_generation。

**拒绝码**：生命周期结算沿用 `unknown_task`、`unknown_dispatch`、`task_dispatch_mismatch`、`inactive_dispatch`、`stale_dispatch`、`sender_not_assignee` 与 payload 错误；Worker 报告规则增加 `dispatch_inactive`（stopping）和 `worker_identity_changed`（pane / process 不符），另一编排方终端为 `consumer_fenced`。`hasLifecycleAuthority` 比较 pane（leaf 等价），未记录 pane 时比较 assignee handle。`mutation_receipts` 仍按 `(caller_fingerprint, orchestrationRequestId)` 去重，同 id 不同载荷为 `request_mismatch`；session 身份进入载荷 hash。`assertAttemptRequestAuthority` 在 receipt lookup 前重验 Axiom Attempt，handler 在异步 IO 后仍再次检查。

**协议交付**（M2 最终状态）：

| Orca | Axiom | M2 最终状态 |
|---|---|---|
| `buildDispatchPreamble`（`orchestration/preamble.ts`）把 `orca orchestration send/heartbeat/ask/check` 配方 + 任务正文作为第一条 prompt 写进终端（`worker/deliver-worker-dispatch-preamble.ts`；失败码 `dispatch_preamble_undelivered`） | 保留投递与观测机制，替换文本：首条 prompt = ContextPackage 渲染（任务 spec、验收标准、Decision、依赖 Artifact、权限/预算、提交合同）+ `axiom` 命令配方；已用 service-only `controlPlane.preambleBuilder`，不改 RPC params | 已实现（M2-01/02/05/09） |
| 技能发现：`skills/orchestration/SKILL.md` 桩 + `orca skills get orchestration`（`skill-guides/orchestration.md` 与 `references/*.md`）；安装源 `ORCA_SKILLS_REPOSITORY_URL`（`src/shared/agent-feature-install-commands.ts`） | 独立 axiom skill 桩/指南未交付；当前协议随 ContextPackage/preamble 交付。RoleProfile/skills 物化按 DEF-4 在 M3 Reviewer 前复审（§7 的路径是规划） | 未实现；不早于 M3 |
| `worker_done` 载荷 `{taskId, dispatchId, outcome, filesModified, reportPath, phase}`（`src/cli/handlers/orchestration/message-payload.ts`） | `axiom attempt submit` 提交完整 Submission 合同（术语表 §3），`filesModified/reportPath` 由 Control Plane 回填给 Orca 结算 | 已注册 / 已实现（M2-07） |

**`axiom attempt submit` 结算流程**（D4/D11/D16；M2-07 已实现且已有宿主验证；M2-11 组合出口宿主结果另填）：

1. **已接入** RPC 栅栏与 OrchestrationMutationExecutor：orchestrationRequestId 命中回放收据（CLI --retry-request），异载荷 request_mismatch。
2. **已接入** resolveAttemptSender 校验 dispatch/binding/最新 seq、宿主调用方、运行时 pane/process、hasLifecycleAuthority、Task/Mission/Run 一致性；SubmissionReportSchema 严格校验完整报告。artifacts[] 每个 id 必须同 Mission 且 related 含 Task 或 Attempt。拒绝发生在 Git 前，无领域写入。
3. **已接入** candidate-snapshot：splitWorktreeIdForFilesystem(worker_dispatches.worktree_id)；symbolic-ref 验证绑定分支（并验证绑定名为 axiom/attempt/<taskId>/<seq>）；status --porcelain clean → HEAD，否则 git add -A 后 `git -c user.name="Axiom Control Plane" -c user.email=axiom@localhost commit --no-verify -q -m "axiom: candidate snapshot <attemptId>"`（add/commit 都加 -c core.hooksPath=<临时空目录>，完成后删除该空目录）；rev-parse HEAD / HEAD^{tree} 后再次核验分支。branch mismatch 为 invalid_argument: candidate_branch_mismatch；不写集成基线/目标分支，不运行 Worker hooks。
4. **已接入**单事务 runLifecycleWriteTransaction(db.db, 'axiom_submit', …)：异步 Git 后重新核对 seq/活跃 authority 与 Artifact；写 candidates ACTIVE（id=cand_+sha256(taskId+':'+commit)）、旧 ACTIVE → SUPERSEDED + superseded_by、submissions 完整不可变 report 与 checks_run/limitations/follow_ups、artifact_git facet；调用 settleWorkerReportInTransaction({taskId,dispatchId,outcome:'succeeded',result,observation})。result 含 submissionId/candidateId/filesModified/reportPath；rejected 抛 OrchestrationError(code) 整体回滚。artifacts 内容不重写，只引用已上传 id。
5. **已接入**同事务：MissionController.transitionTaskStage(actor='AttemptSettlement',reason='submission') 推 RUNNING → SUBMITTED；写 verification_runs QUEUED（verifier=VerificationService，commands=[]、tool_versions={}、verdict_detail={}）；写 attempt.submitted 及 candidate.superseded。artifact_git 只放 {artifacts:present|absent,git:changed|clean}；commit/tree 只在 candidates；Orca observation 记录 worker_report facet。
6. **已接入**提交后：先独立调用 db.retainWorkerTerminalResource（内核自行拥有事务），再在 store.transaction('attempt_retain') 记录 attempt.terminal_retained 与 retainDisposition；retain 异常记录 attempt.terminal_retain_failed，保持已提交的结算与队列并继续发信。MessageRouter 直接 insertMessage(type='worker_done', payload.axiom.type='SUBMISSION')，不走 orchestration.send、reconcileLifecycleMessage 或 Worker send 守卫；消息出现时 dispatch 已 completed。summary 超 2,000 时取前 1,999 字符加 `…`，完整报告留在 submissions.report；related.submissionId 指向不可变 Submission。router 保存 submit receipt 并 notifyMessageArrived('run:<runId>','worker_done')。既有 stage_change 提交后触发 Scheduler，结算回滚不触发；M2 只入队，VerificationService 在 M3 才拉取。
7. **已接入**幂等：dispatch_id UNIQUE + 同 Attempt keyed queue；第二次认证 submit 返回既有 Submission/Candidate、duplicate=true，不生成 Candidate/VerificationRun。已完成收据先核验当前身份再回放；结算后只允许凭原 pane、同一 process incarnation 与最新 binding 读取既有 Submission（不重新激活 Dispatch）。未保存 Axiom Submission 的内核重复结算拒绝 inactive_dispatch。后续 Attempt 采用同 Task 相同 commit → invalid_argument: candidate_exists（UNIQUE(task_id,commit_sha)，不按 tree 去重）。

**相对原七步的明确差异**：artifact_git 按 M2-07 brief 提前到第 4 步；Attempt 2 addendum（2026-10-19）把 retention 从第 5 步事务移至第 6 步提交后，保持 kernel 不变。retention 是终端资源维护，不属于结算原子性；commit 后、retain 前崩溃会留下已结算 dispatch 与 not_requested 资源，M2-08 RecoveryService 可补 retain。retain 的 disposition 不再写入 attempt.submitted，改用独立审计；already_released / no_owned_resource 非错误。共享 MessageRelatedSchema 增加可选 submissionId，MessageSummarySchema 仍限 2,000。post-commit 唤醒由持久 SUBMISSION MessageRouter 完成；邮件补写使用既有 Submission 原文与 id，重复 submit 不重跑 retention。临时空 core.hooksPath 保留，因为 prepare-commit-msg 不受 --no-verify 抑制；保留 --no-verify 与指定身份，不修改 Git 配置。Attempt 1 报告保留历史红测与例外请求，当前修复与验证记录见 `.axiom-work/reports/M2-07-2.md`；没有迁移、CHECK 修改或 kernel 改动。

`promoteReadyTasks` 在第 4 步仍会被调用，但因 `deps=[]` 无候选，Axiom 依赖不受影响（D10）。

M2-11 组合出口固定错误优先级：forged → worker_identity_changed；认证 duplicate → 原 Submission/Candidate + duplicate=true（不是错误）；crash 后 seq 1 replay → inactive_dispatch（终态检查先于 stale seq）；A 的 Attempt + B 的进程 → worker_identity_changed（进程身份先于关联检查）。每次比较完整受测持久行与所有 fixture refs；宿主结果见 [M2-exit-e2e.md](../review-evidence/axiom-m2/M2-exit-e2e.md)。M3 才消费 QUEUED，M4 才集成；D58 的真实执行通道/权限映射与 D57 认证尚未完成。

## 6. 已落地迁移（v43 起，只加不改）

> **UPSTREAM-3（D72）后的编号**：上游自己的 v43（存储地址 `session:<id>` → `orca_session_id:<id>`）原样保留；Axiom 的迁移整体后移一位——原 v43 / v44 / v45 现为 v44 / v45 / v46，`SCHEMA_VERSION = 46`；存量停在 43–45 的库补跑一次幂等的地址改写。本节下文仍按原编号书写。

**为什么不改现有 CHECK 枚举**：`createTables`（`db/schema/create-tables.ts`）在每次打开时执行 `CREATE TABLE IF NOT EXISTS`，`IF NOT EXISTS` 不会放宽已有表的 CHECK（`migrate-v39.ts` 注释）；放宽 CHECK 只能重建表并复制（v39 对 `worker_terminal_archives` 的做法）。而 `resolveOrchestrationMigrationStartVersion`（`orchestration/orchestration-schema-version-skew.ts:184`）在 `storedVersion > schemaVersion` 时原样打开数据库——旧二进制会读到新枚举值，`LEGAL_TRANSITIONS[entity][state]` 查不到即崩溃，`TaskStatus` 等联合类型也失真。上游先例是 side table：`attempt_observation_facts` 的 DDL 注释 "Attempt evidence stays additive so old Task/Dispatch/worker CHECK enums remain wire-compatible"；`hasCompletePostV6Schema` 只探测列/索引/`messages` 的 `'question'`，不探测新表，因此新表对降级探针透明。

**实现文件**：`src/main/runtime/orchestration/db/schema/create-axiom-tables-sql.ts` 的 `createAxiomTablesSql()` 定义以下 17 张表、9 个查询索引和 3 个删除触发器；`db/schema/create-tables.ts` 在 core / graph DDL 之后、迁移之前执行它。`db/schema/migrate-v43.ts` 的 `migrateV43(this, current)` 在 `current >= 43` 时早退，否则复用同一索引 / 触发器 SQL；`db/schema/migrate.ts` 在 v42 之后调用它，`db/contract-constants.ts` 的 `SCHEMA_VERSION = 45`。fresh DB 与旧 v42 文件都由每次打开时的 `CREATE TABLE IF NOT EXISTS` 建表；M2-03 的 migrate-v44.ts 在 v43 后运行，对 agent_specs.spec 与 mission_policies.routing 使用 hasColumn 守卫、仅 ALTER TABLE ADD COLUMN TEXT NOT NULL DEFAULT '{}'；fresh DDL 同步包含两列。版本探针从 v44 起检查这两列。M3-01 的 migrate-v45.ts 同样以 hasColumn 守卫追加 verification_runs 的 runtime_epoch TEXT、claim_count INTEGER NOT NULL DEFAULT 0、worktree_id TEXT、started_at TEXT、finished_at TEXT；fresh DDL 与五条 v45 版本探针同步。旧行保留；重开幂等；不改变 v43/v44 或 future-version 降级路径。

Axiom 的 status / stage / kind 等可扩展枚举均为 `TEXT NOT NULL`，不加 CHECK，由 `axiom-contract` 在写入边界校验；唯一例外是 D11 永久固定的 `nested_worker_max_depth = 1`；可空的 `missions.previous_status` / `task_stages.previous_stage` 分别保存 PAUSED / BLOCKED 的返回状态。所有列名用 snake_case，时间戳用 `TEXT NOT NULL DEFAULT (datetime('now'))`，JSON 用 `TEXT`（集合 / 对象默认 `[]` / `{}`）；有生命周期变化的行带 `updated_at`，不可变证据只带 `created_at`。

不声明外键，删除清理沿用 `ADDITIVE_LIFECYCLE_DELETE_TRIGGERS_SQL` 模式：`trg_tasks_delete_axiom` 清除该 Task 的 stage、任一端点的边、Attempt binding；`trg_dispatches_delete_axiom` 只把 binding 的 `dispatch_id` 置空并保留历史；`trg_runs_delete_axiom` 先按 Mission id 清除全部 side rows，再删除 Mission。除 `missions` 自身以外，每张表都持久化 `mission_id`（`mission_policies` 用它作主键，其余均为 `TEXT NOT NULL`），避免先删 Task / Dispatch 后丢失历史行的 Mission 归属；清理只写 Axiom 表，不更改 Orca 表 / 索引 / 触发器 / view，v44 的版本化探针仅增加 spec/routing 两列的存在性检查。`orchestration.reset` 的 Mission admission 拦截由 M1-07 实现（§4b）。

M1-04～M1-08 的业务写入使用七张表：`missions`、`goal_revisions`、`plan_revisions`、`task_stages`、`mission_task_edges`、`mission_policies`、`audit_events`。其余十张表已建、尚无 M1 业务写入者；下表描述后续数据用途，不表示 Attempt/验证/集成能力已实现。迁移验证见 `src/main/runtime/orchestration/db/schema/axiom-tables-migration.test.ts`；store 验证见 `src/main/axiom/db/axiom-store.test.ts` 与 `axiom-rows.test.ts`。

| 表 | 关键列 | 备注 |
|---|---|---|
| `missions` | `id PK`, `run_id UNIQUE NOT NULL`, `coordinator_orca_session_id UNIQUE NOT NULL`, `repo_id`, `repo_path`, `target_branch`, `status`, `active_goal_revision_id`, `active_plan_revision_id`, `previous_status` | status 取术语表 §4.1；`integration_branch = axiom/integration/<id>` 可派生；D51/M2-05 在 mission start 前从 target HEAD 创建一次，已有 ref 沿用，M4 前只读 |
| `goal_revisions` | `id PK`, `mission_id`, `revision INTEGER`, `status`, `objective`, `constraints`(JSON), `acceptance_criteria`(JSON), `provenance`(JSON) | `UNIQUE(mission_id, revision)` |
| `plan_revisions` | `id PK`, `mission_id`, `revision`, `status`, `goal_revision_id`, `milestones`(JSON), `risks`(JSON), `proposal`(JSON `{ tasks, edges }`，保留提案 Task id，批准时映射为 Orca id), `supersedes_id`, `rejected_reason`, `provenance`(JSON) | `UNIQUE(mission_id, revision)` |
| `task_stages` | `task_id PK`(→`tasks.id`), `mission_id`, `plan_revision_id`, `stage`, `previous_stage`, `spec`(JSON), `retry_policy`(JSON), `attempt_count`, `updated_at` | **唯一项目级权威**；`spec` 含 scope/acceptance/evidence/risk |
| `mission_task_edges` | `mission_id`, `from_task_id`, `to_task_id`, `readiness_threshold`(`INTEGRATED` 或 `VERIFIED`), `plan_revision_id` | `PK(from_task_id, to_task_id)`；DAG 无环由 Control Plane 校验 |
| `agent_specs` | `id PK`(sha256), `role`, `provider`, `model`, `reasoning`(JSON), `permissions`(JSON), `budget`(JSON), `workspace_strategy`, `spec TEXT NOT NULL DEFAULT '{}'`（v44） | M2-03 内容寻址完整合同，标量列保持一致；Attempt 经 `attempt_bindings` 关联（下一行） |
| `attempt_bindings` | `task_id`, `seq INTEGER`（`PK(task_id, seq)`）, `branch`, `dispatch_id`（可空，`UNIQUE`，`createDispatchContext` 后回填）, `agent_spec_id`, `context_package_id`, `created_at` | M2-04 admission 事务写行并推进 READY → RUNNING：`seq = max(seq) + 1`、branch = `axiom/attempt/<taskId>/<seq>`、`dispatch_id = NULL`（dispatch 尚不存在，D6a）；M2-05 launch 创建 worktree/dispatch 后经 `bindAttemptDispatch` CAS 回填；ready 保持 RUNNING，failed → NEEDS_FIX/BLOCKED，outcome_unknown 保持 RUNNING；dispatch 前异常保留 NULL binding 并同样转 NEEDS_FIX/BLOCKED |
| `context_packages` | `id PK`(sha256), `task_id`, `plan_revision_id`, `manifest`(JSON), `token_budget`, `mandatory_refs`(JSON), `ranked_refs`(JSON) | M2-02 写/读；mandatory_refs 为 manifest/render Artifact id，ranked_refs 为已纳入上游 Artifact id；内容在 Artifact 存储 |
| `submissions` | `id PK`, `dispatch_id UNIQUE`, `task_id`, `candidate_id`, `report`(JSON), `checks_run`(JSON), `limitations`(JSON), `follow_ups`(JSON) | M2-07 store 写/读；不可变，report 含完整合同 |
| `candidates` | `id PK`, `dispatch_id`, `task_id`, `commit_sha`, `tree_sha`, `status`(`ACTIVE` 或 `SUPERSEDED`), `superseded_by`, `created_at` | `UNIQUE(task_id, commit_sha)` |
| `artifacts` | `id PK`, `mission_id`, `kind`, `sha256`, `size_bytes`, `media_type`, `related`(JSON ids), `created_by` | M2-02 写/读；内容在 `<userData>/axiom/artifacts/<sha256>` |
| `decisions` | `id PK`, `mission_id`, `status`, `title`, `options`(JSON), `resolution`, `authority`, `provenance`(JSON) | M2-02 按 Mission/status 读取；`supersedes_id` 列已建；Decision 写入者后续接入 |
| `verification_runs` | `id PK`, `candidate_id`, `task_id`, `status`, `verdict_detail`(JSON), `commands`(JSON), `tool_versions`(JSON), `verifier`, `runtime_epoch TEXT`, `claim_count INTEGER NOT NULL DEFAULT 0`, `worktree_id TEXT`, `started_at TEXT`, `finished_at TEXT`（后五列 v45，除 claim_count 外可空） | M2-07 入 QUEUED；M3-01 CAS 领取、独立 worktree 准备、启动重排队；M3-02 检查、verdict 与 Task 结算、cleanupPending；`idx_verification_runs_status(status,created_at,id)` 支持领取与周期恢复；verdict_detail 只存摘要与引用；证据内容走 artifacts |
| `integration_batches` | `id PK`, `mission_id`, `base_commit`, `candidate_ids`(JSON，V1 长度 1), `status`, `merge_commit`, `conflicts`(JSON), `approval_id` | 单一集成权威串行写 |
| `approvals` | `id PK`, `mission_id`, `action_kind`, `inputs_hash`, `risk`, `status`, `expires_at`, `resolver` | 已建 `requested_by`, `resolution`, `outcome`(JSON，执行结果), `executed_at` |
| `mission_policies` | `mission_id PK`, `concurrency_limit`, `budget`(JSON), `readiness_threshold`, `approval_rules`(JSON), `verification_rules`(JSON), `nested_worker_max_depth`(=1), `unverifiable_tolerance_minutes INTEGER NOT NULL DEFAULT 30`, `updated_at`, `routing TEXT NOT NULL DEFAULT '{}'`（v44） | M2-03 provider 偏好/禁用/高风险 tier/model；policy RPC 更新 routing/concurrency，M3-02 增加 verificationRules 严格校验后整对象替换；budget 修改拒绝至 M4 |
| `audit_events` | `sequence INTEGER PRIMARY KEY AUTOINCREMENT`, `mission_id`, `actor`, `object_kind`, `object_id`, `event`, `before`(JSON), `after`(JSON) | 只追加；另有 `created_at`，sequence 删除后不复用 |

## 7. M0 网络出口与身份清单

M0-09 / D37：`orca-data.json` 的 GlobalSettings 增加可选 `providerActivations`（默认 `{}`）。`src/shared/provider-activation.ts` 的 zod schema 在设置加载与更新边界校验；缺失或无效记录按空处理，不从全局 CLI 凭据迁移。main 的 `provider-activation/provider-activation.ts` 记录用户动作；renderer settings 更新不能直接注入该字段。Codex hook 启动修复、preflight 认证与后台用量检查读取同一 profile 记录。现有 RPC 的 preflight 结果仅增加可选 `checked: false` 表示未检查，保留 boolean `authenticated`；旧 runtime 省略该字段时兼容原行为。无 orchestration DB migration 或新 RPC。提案与完整读写入口见 `.axiom-work/reports/M0-09-3.md`；实测归因见 [M0-08 出口证据](../review-evidence/axiom-m0/M0-08-egress-capture.md#attribution-m0-09)。

| 类别 | 端点或标识 | 文件路径 | V1 处置 | 备注 |
|---|---|---|---|---|
| app id / AppUserModelID | `com.stablyai.orca` | `config/electron-builder.config.cjs:77`；`src/shared/local-build-compatibility-contract.json`；`src/main/startup/dev-instance-identity.ts:6` | `replace` | compatibility-contract 的 `appId` 影响 daemon/state 兼容性判定，改后旧数据目录不再互认 |
| computer-use bundle id | `com.stablyai.orca.computer-use` | `src/main/computer/macos-computer-use-permissions.ts:13` | `replace` | macOS TCC 授权随 bundle id 重置 |
| URL scheme / productName | `orca` / `Orca` | `config/electron-builder.config.cjs:175-176` | `replace` | `axiom://` |
| 可执行名 | `Orca`（mac/win）、`orca-ide`（linux 包名与 bin） | `config/electron-builder.config.cjs:422,586,602-603,624` | `replace` | CLI 名 `orca/orca-ide/orca-dev` 硬编码在 `CheckParams/AskParams` 的 `compatibilityCliCommand` 枚举（`src/shared/rpc-contract/orchestration-params.ts`）——additive 加 `axiom/axiom-dev` |
| publish 源 | GitHub `stablyai/orca`（dev 通道 `orca-hourly/orca-daily/orca-adhoc`）；`publisherName 'SignPath Foundation'` | `config/electron-builder.config.cjs:71-75,442,673-674`；`config/dev-app-update.yml` | `replace` | 未签名前 Windows updater 的 publisherName 校验会失败 |
| updater feed | `https://github.com/stablyai/orca/releases/latest/download` | `src/main/updater/updater-setup.ts:162`；`updater-release-feed.ts:206` | `replace`（所有通道；自动检查关闭） — implemented in M0-03 via `src/shared/product-egress-policy.ts` | M0 默认关闭自动更新 |
| prerelease feed / 构建列表 | `…/releases.atom`；`https://api.github.com/repos/<repo>/releases` | `src/main/updater-prerelease-feed.ts:5-6`；`src/main/updater-release-builds.ts:22,102`；通道 `src/shared/release-channel.ts` | `replace`（所有通道；自动检查关闭） — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 注意这两个文件在 `src/main/` 根，不在 `updater/` |
| changelog / nudge | `https://onorca.dev/whats-new/changelog.json`、`https://onorca.dev/changelog`；`https://onorca.dev/whats-new/nudge.json` | `src/main/updater-changelog.ts:13,45`；`src/main/updater-nudge.ts:12`（由 `src/main/updater/updater-nudge.ts` 调用） | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | null 端点在网络调用前返回；不再轮询 nudge |
| PostHog | — | `src/main/telemetry/client.ts` | `disable` | implemented in M0-04: transport and dependency removed; `track()` is a validated local no-op |
| Crashpad | `uploadToServer: false`，无 submitURL | `src/main/crash-reporting/crashpad-capture.ts:70` | `keep-behind-flag` | 本地 minidump 保留 |
| feedback / 用户提交崩溃报告 | `https://www.onorca.dev/v1/feedback` | `src/main/ipc/feedback-request.ts:13`（`FEEDBACK_API_URL`）；mobile `mobile/src/diagnostics/connection-diagnostics-submission.ts:3` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 桌面反馈与崩溃上传已关闭；mobile 不在 M0-03 范围 |
| diagnostics 上传 | 编译期常量 `ORCA_DIAGNOSTICS_TOKEN_URL`（CI 设 `https://www.onorca.dev/diagnostics/token`） | `src/main/observability/diagnostic-upload-endpoint.ts`；`.github/workflows/release-cut.yml:1408` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 官方构建不上传；非官方构建保留开发者环境变量覆盖 |
| login / relay | `https://login.onorca.dev`（client id `orca-desktop`）、`https://relay.onorca.dev` | `src/main/orca-profiles/profile-cloud-auth-config.ts:24,26` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 云账号/手机配对 V1 不需要 |
| push | `https://push.onorca.dev`（env `ORCA_PUSH_GATEWAY_URL` 可覆盖） | `src/main/runtime/push/push-gateway-origin.ts:4` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 同上 |
| artifact 分享 | 原默认 `https://share.onorca.dev`；现只接受 policy origin 的 host，或未打包构建的 loopback | `src/main/artifacts/artifact-cloud-config.ts`；`src/cli/handlers/artifacts.ts` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 保留 `artifacts.*` RPC 与 CLI `artifacts`；未配置返回 typed unconfigured，CLI 非零退出 |
| skill share link | `app.orca.dev`、`share.onorca.dev` | `src/shared/skill-share-link.ts:2` | `disable` — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | share hosts 为空时只接受 bare ids；cloud skills 沿用 artifact API 配置 |
| plugin kill-list | `https://onorca.dev/plugins/kill-list.json` | `src/main/plugins/plugin-kill-list-service.ts:10` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 不请求远程列表；保留本地缓存，refresh 无副作用 |
| marketplace | `officialPluginMarketplace: null` | `src/shared/product-egress-policy.ts`；`src/shared/plugins/plugin-marketplace.ts`；`src/main/plugins/plugin-marketplace-service.ts` | `disable` — implemented in M0-06b | 不预置官方源、不自动 git fetch；手动添加来源保留；官方 provenance/badge 关闭；本地 bundled 插件按 bootstrap 运行时读取的索引精确身份授权，shared 模块不导入资源索引 |
| skills 安装源 | `https://github.com/LaPaGaYo/Axiom`（`ORCA_SKILLS_REPOSITORY_URL`）；下载白名单 `https://storage.googleapis.com` | `src/shared/product-egress-policy.ts`；`src/shared/agent-feature-install-commands.ts`；`src/main/runtime/runtime-skill-install-commands.ts` | `replace` — implemented in M0-06b | 安装源从 D21 updateFeed 派生；保留 installer CDN 与既有导出名 |
| star 提示 | `starPromptRepository: null` | `src/shared/product-egress-policy.ts`；`src/main/github/client/fetch/orca-star.ts`；`src/main/star-nag/service.ts`；`src/main/startup/main-process-ready-runtime.ts` | `disable` — implemented in M0-06b | 不注册触发器、不显示 nag、不执行 star check/create gh；保留兼容 IPC 空操作 |
| Casks | `homepage "https://onorca.dev/"` | `Casks/orca.rb:12`、`Casks/orca@rc.rb` | `replace`/删除 | — |
| mobile / cloud | D21 mobile 身份；上游 mobile/cloud 服务标识 | `mobile/`；原 `cloud/` | D33a：删除 `cloud/` 及其 CI；原生 mobile 应用不构建、不发布，删除 Android/iOS 发布工作流 | mobile web bundle 仍以 `out/mobile-web` 随桌面应用交付；`mobile/` 保留根级门禁与 vendor-egress ratchet 覆盖，保留 mobile 验证 CI、依赖安装、缓存与 web bundle 构建（bundle 也随 orcad 模板交付）；桌面配对入口在 V1 休眠（D75 修订）：侧边栏、View 菜单、外观设置、设置 › Mobile、恢复的 Mobile 视图与 `--mobile-pairing` 统一看 `src/shared/mobile-pairing-availability.ts` 的 `MOBILE_PAIRING_AVAILABLE`（false），配对代码不删 |
| 文档站/README 链接 | `repositoryUrl` / `issuesUrl` / `docsUrl`（Axiom README）；`communityLinks: []` | `src/shared/product-egress-policy.ts`；renderer / CLI 链接；`README.md`；`NOTICE.md` | `replace` — M0-05a | 保留 MIT attribution；隐藏 Changelog / community / Android APK 下载；`docs/site/**` 的保留或删除及 UI 品牌文案归 M0-05b |

**验证策略**（M0-08）：

1. **已实现：构建期身份与出口策略断言。** `src/shared/product-build-identity.test.ts` 用 `createRequire` 读取 `config/electron-builder.config.cjs`，钉住 D21 的 `appId/productName/protocols/publish`，与 `local-build-compatibility-contract.json` 的 appId 对齐，检查 `package.json` 的各依赖区及 `pnpm.overrides` 无已移除的遥测 SDK；直接复用 `src/shared/product-egress-policy.test.ts` 的完整策略断言，避免重复维护禁用端点与空 host 列表。
2. **已实现：冷启动出口捕获规格，实际运行证据状态见归档。** `tests/e2e/golden-egress-cold-start.spec.ts` 复用 `helpers/orca-app.ts`，以 `ORCA_BACKGROUND_LAUNCH=1` / `electron-headless` 启动 `globalSetup` 构建的桌面应用（非签名安装包）。两个全新 profile 分别到达 onboarding 与默认主窗口，各观察 20 秒。`tests/e2e/helpers/recording-proxy.ts` 仅记录并拒绝连接；Chromium 使用 `--proxy-server`，Node 全局 undici `fetch` 使用 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 与 `NODE_USE_ENV_PROXY=1`，loopback 走默认 bypass / `NO_PROXY`。规格附加并打印完整 host tally，拒绝任何厂商 host，其他非 loopback host 原样保留供验证者判读。运行 `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e:egress-cold-start`；证据及 raw HTTP、`ws`、native 等覆盖边界归档在 [M0-08-egress-capture.md](../review-evidence/axiom-m0/M0-08-egress-capture.md)。Mission/Attempt 流程不属于 M0 冷启动规格，后续里程碑另验。
3. **已取代：不再新增 `verify:egress-allowlist`。** M0-01 的 `config/scripts/check-vendor-egress-ratchet.mjs` 已在 `pnpm lint` 中执行 `check:vendor-egress-ratchet`，覆盖“源代码不得新增厂商 needle”策略；基线只能缩减，断言数据使用逐行 allow 标记。

## 8. 代码落位与类型安全

`src/main/axiom/db/axiom-store.ts` 的 `AxiomStore` 集中 M1 七张 side table 的数据访问，所有读取遵循「parse rows, never cast」：逐表 zod row schema 校验后转换为共享契约对象。

- `src/main/axiom/` 的 M1 实装：`db/`、`mission-controller/`、`admission/`、`recovery/`、`kernel-contract/`，以及 `control-plane.ts` / `control-plane-boot.ts`；service/DB 边界与模块职责见 [control-plane.md](control-plane.md)。`scheduler/`、`agent-factory/`、`context-builder/`、`message-router/`、`verification/`、`integration/`、`approval/` 等仍属后续规划路径，不是已存在的 M1 服务。
- `src/shared/axiom-contract/` 的 M1 实装：`lifecycle.ts`、`mission-objects.ts`、`plan-proposal.ts` / `plan-task-graph.ts`、四域 params/响应、`mutations.ts`、`stage-labels.ts`；枚举与 Glossary 一一对应，renderer/CLI/main 共用。Worker payload / Submission 合同后续添加。
- M1-09 UI：`src/renderer/src/components/missions/` + `src/renderer/src/lib/axiom-client.ts`；store 只持有选择/请求等 UI 状态，刷新与 mutation 后重新读取 `axiom.*`；`stage-labels.ts` 将 stage 与执行投影分开呈现。
- `@ts-nocheck` 基线：`config/ts-nocheck-baseline.txt` 共 176 项，其中 `src/main/runtime/orca-runtime-*.ts` **137** 项（非测试 `orca-runtime-*.ts` 共 150 个）；`config/scripts/check-ts-nocheck-ratchet.mjs` 是只减不增的 ratchet（`pnpm lint` 内 `check:ts-nocheck-ratchet`），新文件带 `@ts-nocheck` 直接 CI 失败。规则：Axiom 不在这些文件内新增逻辑（D12）；如必须触碰（例如 `getNestedWorkerMaxDepth`，`orca-runtime-resolve-worktree-selector.ts:118`），只加一行委托到强类型模块。
- `getOrchestrationDb()` 位于 `orca-runtime-automation-operations.ts:152`（`@ts-nocheck`），但其返回类型 `OrchestrationDb`（`orchestration/db/orchestration-db.ts`，非 nocheck）是强类型的。M1-04 已在 `src/main/axiom/db/axiom-store.ts` 构造注入 `OrchestrationDb`，SQL 分布在同目录按域拆分的 store 文件，配套 `:memory:` 测试；M1-06 的 `getAxiomControlPlane(runtime)` 位于 `src/main/axiom/control-plane.ts`，不在 runtime 类上新增访问器。禁止 `as` 断言（上游规则：仅 `as const`，不可避免时加 `SAFETY:` 注释）。
- Attempt 启动（M2-05 已实现）：以 `src/main/axiom/execution/attempt-launcher.ts` 调用 `startLocalWorker`（additive 参数，§4a），不复制 worker 生命周期、worktree 管理或终端管理。

## 9. 上游陷阱清单

| # | 事实（核实位置） | 对 Axiom 的含义 |
|---|---|---|
| 1 | Worker 报告即终局：`worker_done succeeded` 在同一事务把 Task 置 `completed` 并 `promoteReadyTasks`；`LEGAL_TRANSITIONS.task` 任意→任意，`taskUpdate` 可直接写 `completed`（`db/lifecycle-transition.ts`、`worker-report-settlement.ts:276`、`task-status-transition.ts:109`） | `completed` 只能解释为「Attempt 已结算」；权威在 `task_stages`；`taskUpdate` 与 `deps` 对 Mission Run 拦截（§4b、D2、D10） |
| 2 | 自动调度器已退役：`Coordinator`（`orchestration/coordinator.ts`）、`coordinator_runs`、`orchestration.run/runStop`、CLI `coordinator-start` 返回 `orchestration_migration_required/command_retired`；现行 coordinator 是终端里跟 skill guide 的 LLM | 没有可复用的 Scheduler；MissionController 自建确定性、DB 驱动、可重启的调度，并作为 `run:<runId>` mailbox 消费者（`run-delivery.ts`） |
| 3 | decision gate 不是 Approval：`resolveGate` 不校验 options、无 pending-only 守卫、无 resolver/expiry；`createGate` 在 supervised worker 活跃时拒绝，否则把活跃 dispatch 置 `completed`（`decision-gate-store.ts`） | Approval 独立建表（D7）；gate 仅用于无活跃 Attempt 的 Task 级 Question（§3e） |
| 4 | 命名冲突：`project.*`、`projectHostSetup.*`、`projectGroup.*`、`automation.*`、CLI `project`、CLI 顶层 `check`；"Task" 在 GitHub/Linear/Jira 模块另有含义；重名启动即抛 `duplicate_rpc_method` | 全部走 `axiom.*` / `axiom …`（D1）；Worker 命令挂 `axiom attempt <verb>`（D16） |
| 5 | 契约栅栏：所有 orchestration mutation 需 `orchestrationContractVersion: 1`；栅栏与幂等收据都由 `ORCHESTRATION_MUTATION_METHODS` 集合驱动，CLI 只对 `orchestration.` 前缀打版本戳 | `axiom.*` 必须 additive 接入该集合与 CLI 戳（§4c），否则既无栅栏也无幂等 |
| 6 | 137/150 个 `orca-runtime-*.ts` 为 `@ts-nocheck`，含 `orca-runtime-core.ts` 与 `getOrchestrationDb` 所在模块 | Axiom 逻辑放独立强类型模块，注入 `OrchestrationDb`（§8） |
| 7 | 厂商端点硬编码且部分强制（artifact API 必须 onorca.dev）；auth/feedback/artifact 服务端不在仓库；PostHog 无 key 静默，但 changelog/nudge/kill-list/feedback/login/relay/push 路径仍活跃 | M0 出口清单与自动化断言（§7）；不能只改品牌 |
| 8 | 文档与代码不一致：orchestration「实验性」开关只是 renderer `localStorage['orca.orchestration.enabled']`（`src/renderer/src/lib/orchestration-setup-state.ts`），RPC 始终注册；`docs/site/content/docs/cli/orchestration.mdx:12` 仍写 "Settings → Experimental" | 产品化时删除该开关与文案（C15）；不要把它当安全边界 |
| 9 | `nestedWorkerMaxDepth` 默认 1（`src/shared/default-global-settings.ts:154`），>1 时 Worker 可直接 `workerStart` 子 worker（preamble 的 `buildSubDispatchSection`，`resolveChildDispatchDepth` 只按深度拒绝） | `mission_policies.nested_worker_max_depth` 固定 1；Mission Run 内非 Control Plane 的 `workerStart` 一律拒绝，子任务只能走 `REQUEST_SUBTASK`（C7） |
| 10 | `dispatch_contexts.depth` 默认 1 且 "fails closed"；`DispatchCreator {kind:'system'}` 是进程内根创建者、不可由调用者自报（`db/dispatch-depth.ts`） | Scheduler 用 `system` creator 启动 Attempt，深度恒为 1 |
| 11 | License：`LICENSE` 为 MIT © 2026 Lovecast Inc.；`package.json`（`orca@1.4.197`）无 `license` 字段 | 保留 LICENSE 与署名，补 `license: "MIT"` 与 Third-Party Notices（C13） |
| 12 | `orchestration.reset` 删除全部编排表且不知道 Axiom 表（`db/reset/orchestration-reset.ts`） | 对 Mission 拦截并纳入 Approval；Axiom 表挂 AFTER DELETE 触发器兜底（§6） |
| 13 | `createRun` 一 coordinator 一 Run（`unbindOtherRunsForCoordinator`）；`workerStart` 要求 caller 当前绑定该 Run | Mission 用合成 session party（第 14 条），不得复用真实终端 pane 或真实 agent 会话，否则用户的终端/会话会被解绑 |
| 14 | **#22555（基线内）**：caller/target 统一为 party `{address, terminalHandle, paneKey, orcaSessionId}`（`orchestration/orchestration-party.ts`、`orchestration-caller-identity.ts`）；Run 绑定键 = pane key 或 Orca session id；`createRun` 接受 `coordinatorOrcaSessionId`（handle/pane 可 null）；session caller 在 `rpc/dispatcher.ts` 入口解析（`rpc/orchestration-session-caller.ts`），`worker-start` 等动词对 session caller 不再要求 `from`；未记录为 structured worker 的 session id 按 chat 处理（`terminalHandle: null`），`resolveDeclaredCallerParty` 拒绝以参数声明的 chat caller | D14 据此修订：Control Plane 以每 Mission 一个合成 Orca session id 作为 session party 充当 Run coordinator（mailbox `orca_session_id:<id>`），在进程内直接构造 `OrchestrationSessionCaller`，dispatch creator `{kind:'system'}`；合成 id 持久化于 `missions` |
