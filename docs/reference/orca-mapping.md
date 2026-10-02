# Axiom ↔ Orca 映射参考（orca-mapping）V1

更新日期：2026-09-26 · 审计快照：`stablyai/orca@646e9a5`（v1.4.197）· **冻结基线：`3eb1adec2`（tag `axiom-base`，D19）**——快照到基线之间唯一改变编排模型的提交是 #22555（party 解析，见 §4a 与 §9 第 14 条）· 仓库落位：`docs/reference/orca-mapping.md`
术语与枚举以 `docs/GLOSSARY.md` 为准；决策编号引用 `docs/decisions/DECISION_LOG.md`（D6a、D9–D16 为提议中）。

## 1. 用途与阅读方式

本文是「Axiom 领域对象 ↔ Orca 原语（表、类型、RPC、状态、文件）」的**权威对照**，实现 Control Plane（M1 起）前必读。
每一行映射都对应上游源码里实际存在的路径与标识符（相对仓库根目录）；核实不到的标为 `NOT FOUND`。
读法：§2 查对象落位 → §3 查状态/枚举换算 → §4 查 RPC 复用与拦截 → §5 查 Worker 通道 → §6 查迁移 → §7 查 M0 出口 → §8/§9 查落位与陷阱。
策略词汇：`reuse`（直接用 Orca 行/方法）、`extend-additive`（只加可选字段/参数/facet，不改既有语义与 CHECK）、`new side table`（Axiom 新表，外键指向 Orca id）。

## 2. 对象映射表

| Axiom 对象 | Orca 基础（表 / 类型 / 文件） | 策略 | 说明 |
|---|---|---|---|
| Mission | `runs`（`RunRow`，`db/schema/create-core-tables-sql.ts`；无 status 列）；`db.createRun`（`db/runs/run-create.ts`） | `new side table` `missions` + `reuse` runs | 1:1 绑定一个 Run 作为容器与 `run:<runId>` mailbox；Mission 状态只在 `missions.status`。`createRun` 要求 `coordinatorHandle/coordinatorPaneKey`：Mission 用合成身份 `axiom:mission:<missionId>`（`pane-key-match.ts` 对不可解析 pane key 走精确匹配） |
| GoalRevision | 无 | `new side table` `goal_revisions` | `runs.objective` 只存当前 ACTIVE goal 的一句摘要（投影） |
| PlanRevision | 无 | `new side table` `plan_revisions` | Task 集在批准时物化为 Orca `tasks` 行 + `task_stages` 行 |
| Milestone | 无 | 存于 `plan_revisions.milestones`（JSON） | V1 无状态机（A7） |
| Task | `tasks`（`TaskRow`，`db/schema/create-graph-tables-sql.ts`）；`db.createTask`（`db/tasks/task-store.ts`） | `reuse` tasks（`deps=[]`，D10）+ `new side table` `task_stages`（D2） | 项目级权威 = `task_stages.stage`；`tasks.status` 只是 Attempt 执行投影（§3a） |
| TaskEdge | 无（不用 `tasks.deps`，避免 `promoteReadyTasks` 抢先解锁） | `new side table` `mission_task_edges` | readiness 由 MissionController 按 stage 阈值计算 |
| Attempt | `dispatch_contexts`（`DispatchContextRow`）× `worker_dispatches`（`WorkerDispatchRow`）× liveness；`types.ts:290` 注释 "Dispatch ID is the Attempt identity" | `reuse` | **`attemptId ≡ dispatch_contexts.id`**；重试 = 新 dispatch，`retry_of_dispatch_id` 指向前一 Attempt；不新建 Attempt 表 |
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
| `STARTING` | `worker_dispatches.state` | `starting` |
| `RUNNING` | `worker_dispatches.state` | `ready`；`stopping` 也按 RUNNING 展示（DDL 注释：`start_unknown/stopping/stop_unknown` 不证明进程退出；术语表 §4.6 已采纳） |
| `SUBMITTED` | `worker_dispatches.state` + `dispatch_contexts.status` | `succeeded` ∧ `completed` |
| `FAILED` | `worker_dispatches.state` 或 `dispatch_contexts.status` | `failed`；`circuit_broken`（`DISPATCH_CIRCUIT_BREAK_FAILURES = 3`，`db/dispatch-context/dispatch-circuit-breaker.ts`）→ FAILED 且触发 B4 |
| `STOPPED` | `worker_dispatches.state` | `stopped`；`dispatch_contexts.termination_reason` ∈ `operator_close/signaled/exited/unknown` 作为附注 |
| `ABANDONED` | `worker_dispatches.state` | `abandoned`（`abandonWorkerDispatch`，`db/worker-dispatch/worker-dispatch-abandon.ts`） |
| `START_UNKNOWN` / `STOP_UNKNOWN` | `worker_dispatches.state` | `start_unknown` / `stop_unknown` |
| `liveness` | `PtyLivenessVerdict`（`src/shared/pty-liveness-verdict.ts`）；持久化为 facet `liveness` + freshness（`db/attempt-outcome-projection.ts`，`DEFAULT_FRESH_AFTER_MS = 60_000`） | `live / unverifiable / exited`（§3d） |
| `workspace` | `worker_terminal_resources.release_state` | `retained`→retained，`released`→released；`not_requested/requested/releasing/unknown` 折叠为 `pending`（术语表 §4.6） |
| 失败计数 | `dispatch_contexts.failure_count`（跨重试累加） | Control Plane 的 `retryPolicy.maxAttempts` 为权威计数，circuit breaker 是下限保护（B4） |

### 3c. 消息类型（D9）

Axiom 八种 → Orca `messages.type`（仅路由/授权语义；产品类型持久化在 `payload.axiom.type`，并携带 `missionId/taskId/attemptId/decisionId/artifactId`）：

| Axiom | Orca `type` | 为什么选它 |
|---|---|---|
| `INFORM` | `status` | 无生命周期副作用；`reconcileLifecycleMessage` 对其 `ignored` |
| `REQUEST` / `BLOCKED` / `REQUEST_SUBTASK` | `escalation` | `isDispatchMutationMessageType`（`src/shared/rpc-contract/orchestration-params.ts`）为真 → `send` 走 `resolveLifecycleAuthority`，免费获得 capability/assignee 校验；不能发给群组 |
| `QUESTION` | `question`（Attempt 级，经 `orchestration.ask` 建 `question_threads`）；Task 级另建 `decision_gates` | 见 §3e |
| `DECISION` | `status`（正文在 `decisions` 表） | Control Plane → Attempt mailbox 的通知 |
| `HANDOFF` | `handoff` | 无副作用；Axiom 在 RPC 层自行校验 capability |
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

### 3d. liveness 三词汇与来源类型

- 词汇：`PtyLivenessVerdict = {status:'exited'} | {status:'live', ptyIds} | {status:'unverifiable', reason}`（`src/shared/pty-liveness-verdict.ts`）。`exited` 需要宿主的正面证据；失联一律 `unverifiable`。
- 来源：`verifyUnstoppedPtys`（`src/main/runtime/unstopped-pty-verification.ts`）、`classifyWorkerTerminalProcessIncarnation`（`orchestration/worker-terminal-process-liveness.ts`）、`inspectWorkerTerminal`（`rpc/methods/orchestration/worker/worker-observation.ts`，状态 `unattached|missing|identity_changed|live|exited|unverifiable`）、fleet 投影（`src/shared/orchestration-fleet-projection.ts`）、facet `liveness`（`AttemptLivenessObservation = PtyLivenessVerdict`）。
- Axiom 归约规则：`inspectWorkerTerminal` 的 `unattached/missing/identity_changed` 一律视为 `unverifiable`（上游先例：`workerRead` 在 `worker-control.ts` 把非 `live/exited` 的观测折叠为 `'unverifiable'`），只有 `exited` 才允许 RecoveryService 结算为 FAILED/STOPPED；`unverifiable` 超过 policy 时限 → `ABANDONED` 并留证据。
- 不要混用的相邻词汇：宿主联系 `live/unverifiable/refused/retired`（`src/shared/runtime-host-contact.ts`）；Agent 活动 `working/blocked/waiting/done`（`src/shared/agent-status-types.ts`）。

### 3e. Question ↔ `question_threads` / `decision_gates`

| 场景 | Orca 机制 | 状态映射（Axiom `OPEN → ANSWERED / WITHDRAWN`） | 副作用 |
|---|---|---|---|
| Attempt 级（Worker 阻塞提问） | `orchestration.ask` → `createQuestion`/`answerQuestion`/`closeQuestionsForDispatch`（`db/questions/question-threads.ts`），`orchestration.reply` 作答 | `pending→OPEN`，`answered→ANSWERED`，`closed→WITHDRAWN`（dispatch 结算时自动 close） | dispatch 仍为 `dispatched`，Attempt 保持 RUNNING |
| Task 级（无活跃 Attempt；Planner/人类澄清） | `createGate`/`resolveGate`（`db/decision-gates/decision-gate-store.ts`） | `pending→OPEN`，`resolved→ANSWERED`，`timeout→WITHDRAWN`（`timeoutGate` 无生产调用者） | `createGate` 在 supervised worker 活跃时抛 `task_not_startable`，否则把活跃 dispatch 置 `completed`、Task 置 `blocked`；`resolveGate` 经 `updateTaskStatus(task,'ready')` 解锁 |

注意：D7 文字「gate 用于 Worker 提问」需修正为上表——Worker 提问必须走 `ask`/`question_threads`，gate 不能在 supervised Attempt 活跃时创建。`coordinator-decision-gates.ts`（`openDecisionGateFromMessage`、`reblockTasksWithPendingGates`）是退役 coordinator 的死代码，不复用。

## 4. RPC 映射

注册表：`ALL_RPC_METHODS`（`src/main/runtime/rpc/methods/index.ts`）→ `buildRegistry`（`rpc/core.ts`，重名抛 `duplicate_rpc_method:<name>`）→ `RpcDispatcher`（`rpc/dispatcher.ts`）。41 个 `orchestration.*` 方法聚合在 `rpc/methods/orchestration.ts`（`ORCHESTRATION_METHODS`）。

### 4a. Axiom 内部调用的 Orca 方法（经 service/DB 边界，不经 CLI）

| Orca 方法（文件） | Axiom 用途 | 备注 |
|---|---|---|
| `orchestration.runCreate`（`orchestration/runs/runs.ts`） | Mission 创建时建 Run | RPC 要求真实 coordinator party；Axiom 直接调 `db.createRun({coordinatorHandle: null, coordinatorPaneKey: null, coordinatorOrcaSessionId: <合成 id>})`（#22555 后已支持 session coordinator；D14） |
| `orchestration.taskCreate`（`messaging/message-methods.ts`） | PlanRevision 批准时物化 Task | 直接调 `db.createTask({deps: [], runId})` |
| `orchestration.workerStart`（`orchestration/worker/workers.ts` → `startLocalWorker`，`local-worker-start.ts`） | Scheduler 启动 Attempt | RPC 要求 `getCurrentRunForPane(coordinatorPane)`（否则 `consumer_fenced`）；`startLocalWorker` 又用 `params.from` 经 `resolveDispatchCallerWorktreeId` 解析终端 worktree。**需 additive 扩展**：允许 Control Plane caller（`creator: {kind:'system'}`，`db/dispatch-depth.ts` 已有此分支）直供预创建的 worktree id 与 `branchNameOverride`（分支 `axiom/attempt/<taskId>/<seq>`，D6a：dispatch id 在 worktree 之后才铸造，故用 Attempt 序号；`src/shared/worktree/create-types.ts`；`createWorkerWorktree` 目前只传 `name/baseBranch`）——D14，提议中 |
| `orchestration.workerStop` / `workerAbandon` / `workerRelease` / `workerRetain`（`worker/worker-stop.ts`、`worker-control.ts`、`worker-release.ts`） | 停止/放弃 Attempt、释放/保留 worktree 与终端 | 结算后候选未 superseded/INTEGRATED 前用 `workerRetain`（D4） |
| `orchestration.workerShow` / `workerRead` / `workerList`（`worker-control.ts`、`worker-list-method.ts`） | Attempt 观测、终端回读、fleet 投影 | `workerShow` 返回 `dispatch/worker/projection(fleet 判定)/observation(inspectWorkerTerminal 状态)/terminalResource`，`workerRead` 另附 `status.liveness`（PTY）与 `projection`（Agent） |
| `orchestration.dispatchShow`（`runs/dispatch-methods.ts:188`） | 展示 Attempt 的 dispatch 上下文 | `orchestration.dispatch` 本身不用（§4b） |
| `orchestration.send` / `check` / `inbox` / `reply` / `ask`（`messaging/*.ts`） | Worker 侧消息经 `axiom.attempt.*` 落到同一 `db.insertMessage` / `createQuestion`；Control Plane 回复 Worker 用 `send` 到 `dispatch:<attemptId>`（`from` 可为合成身份，`SendParams.from` 可选） | `worker_done/heartbeat` 在 `send-point-to-point.ts` 内同步结算；`check --wait` 长轮询 `RuntimeMessageWaiters`（`runtime-message-waiters.ts`） |
| `orchestration.gateCreate` / `gateResolve` / `gateList`（`gates/gates.ts`） | Task 级 QUESTION | 只允许 Control Plane 对 Mission Run 调用（人类经 UI → `axiom.message.*` → Control Plane） |
| `orchestration.requestShow`（`runs/mutation-request-show.ts`） | 查询幂等收据 | 与 `mutation_receipts` 配套 |
| Run mailbox 消费：`getUnreadRunMailbox` / `getOrCreateRunDelivery` / `acknowledgeRunDelivery` / `requireCurrentConsumer`（`db/runs/run-delivery.ts`） | MissionController 作为 `run:<runId>` 的确定性消费者 | 以 `runs.consumer_generation` 栅栏，重启后可续 |

### 4b. 对 Mission 管理对象必须拦截/禁用的 Orca 入口

判定依据：`tasks.run_id`（或 `dispatch_contexts.run_id`）命中 `missions.run_id`。建议统一守卫模块 `src/main/axiom/admission/mission-managed-run-guard.ts`，在下列 handler 入口各加一行调用；拒绝码用新增 `mission_managed`（加入 `rpc/errors.ts` 的错误码表）。

| Orca 入口 | 现状 | 拦截点 |
|---|---|---|
| `orchestration.taskUpdate` 改 `status` | `updateTaskStatus` 只校验活跃 dispatch，可直接写 `completed` 并 `promoteReadyTasks` | `messaging/message-methods.ts` 的 `orchestration.taskUpdate` handler（不拦 `updateTaskStatus` 本身，`resolveGate` 内部要用它） |
| `orchestration.reset`（`--all/--tasks/--messages`） | `resetAll/resetTasks` 删除 `runs/tasks/dispatch_contexts/messages…`（`db/reset/orchestration-reset.ts`），破坏性且不删 Axiom 表 | `runs/reset-methods.ts` handler：存在任一 Mission 时拒绝，改走 `axiom.mission.cancel` + Approval（C14） |
| `orchestration.workerStart` / `orchestration.dispatch` | 任一 coordinator 终端可对 `ready` Task 启动 Attempt | `worker/workers.ts`、`runs/dispatch-methods.ts` handler：Mission Run 只接受 Control Plane caller（D10） |
| `orchestration.send --type` ∈ {`worker_done`, `merge_ready`, `dispatch`, `decision_gate`} 来自 Worker | `merge_ready/dispatch` 不经任何授权校验 | `messaging/send-methods.ts` handler：目标为 Mission Run 时按 §3c 表拒绝 |
| `orchestration.gateCreate` / `gateResolve` 来自非 Control Plane | 任一 coordinator 可开/关 gate 并改 Task 状态 | `gates/gates.ts` handler |
| `orchestration.runUse --takeover-legacy` / 重绑 coordinator | 会 `unbindOtherRunsForPane`、bump `consumer_generation` | `runs/runs.ts` handler：Mission Run 禁止被终端接管 |
| `orchestration.run` / `runStop`、CLI `orchestration coordinator-start` | 已退役：`RETIRED_ORCHESTRATION_METHODS`（`src/shared/orchestration-rpc-contract.ts`）→ `orchestration_migration_required(command_retired)`；CLI 在 `src/cli/handlers/orchestration/dispatch-handlers.ts:69` | 无需处理；文档中不再提「coordinator」 |
| `taskCreate` 带 `deps` | 会让 `promoteReadyTasks` 生效 | Mission Run 内 `deps` 非空即拒绝 |

### 4c. 新增 `axiom.*` 方法清单

约定：参数 zod schema 在 `src/shared/axiom-contract/<ns>-params.ts`；所有 mutation 需 `orchestrationContractVersion === 1` 与 `orchestrationRequestId`（幂等）；Worker 侧方法另需 envelope `orchestrationCapability`。「M」= mutation。

| 方法 | 参数要点 | 副作用 | M |
|---|---|---|---|
| `axiom.mission.create` | repo selector、targetBranch、goal、policy | `missions` + `db.createRun`（合成 coordinator）+ `goal_revisions`(ACTIVE) + `mission_policies` + `audit_events` | M |
| `axiom.mission.show` / `list` | missionId / 过滤、cursor | 无 | — |
| `axiom.mission.pause` / `resume` / `cancel` | missionId、reason | `missions.status`；cancel 先停活跃 Attempt；按 policy 需 Approval | M |
| `axiom.mission.deliver` | missionId、approvalId | 集成基线合入目标分支（D6），成功 → `COMPLETED` | M |
| `axiom.mission.completionReport` | missionId | 生成 Artifact `completion_report` | M |
| `axiom.goal.propose` / `activate` / `show` | missionId、goal 正文 / goalRevisionId | PROPOSED / ACTIVE+SUPERSEDED 前版 + `MAJOR_REPLAN` 触发 | M/M/— |
| `axiom.plan.propose` | missionId、planRevision（schema 校验）、provenance | `plan_revisions`(PROPOSED)，Mission → `PLAN_REVIEW` | M |
| `axiom.plan.approve` / `reject` | planRevisionId、resolver | APPROVED：物化 `tasks`(deps=[]) + `task_stages`(DEFINED) + `mission_task_edges`；旧 Task `inherit/cancel/rebind` 记录 | M |
| `axiom.plan.list` / `show` | missionId / planRevisionId | 无 | — |
| `axiom.task.list` / `show` | missionId、stage / taskId | 联查 `task_stages` × `tasks` × attempts | — |
| `axiom.task.create` | missionId、spec、edges、rationale（`MINOR_ADJUSTMENT`/FIX_TASK） | 同 approve 的物化路径 | M |
| `axiom.task.cancel` | taskId、authorized rationale | `CANCELED`；停活跃 Attempt | M |
| `axiom.attempt.submit` | attemptId、taskId、report（summary/filesChanged/checksRun/artifacts/limitations/questions/followUps） | §5 编号步骤 | M |
| `axiom.attempt.inform` / `request` / `blocked` / `handoff` / `requestSubtask` | attemptId、正文、相关 id | `verifyDispatchCapability` → `insertMessage`（§3c 类型）→ MessageRouter | M |
| `axiom.attempt.ask` | attemptId、question、options、timeoutMs / resume | 复用 `createQuestion` + 长轮询；`answerQuestion` 由 `axiom.message.answer` 触发 | M |
| `axiom.attempt.check` | attemptId、ack? | 读 `dispatch:<attemptId>` mailbox；带 `ack` 时为 M | —/M |
| `axiom.attempt.show` / `list` | attemptId / taskId | §3b 投影 | — |
| `axiom.attempt.stop` / `abandon` | attemptId、reason | 委托 `workerStop`/`workerAbandon` service | M |
| `axiom.verification.list` / `show` | candidateId / verificationRunId | 无 | — |
| `axiom.verification.resolveReview` | verificationRunId、verdict(PASS/FAIL)、reviewer、evidence | 仅 `INCONCLUSIVE` 可收敛 | M |
| `axiom.verification.rerun` | candidateId、reason | 新 `verification_runs`(QUEUED) | M |
| `axiom.integration.queue` / `show` | missionId / batchId | 无 | — |
| `axiom.integration.promote` | batchId、approvalId? | `PROMOTABLE/AWAITING_APPROVAL → PROMOTED`，基线 ref 前进 | M |
| `axiom.approval.list` / `grant` / `deny` / `revoke` | missionId / approvalId、resolver、note | `approvals.status`；grant 后单次 CONSUMED | —/M/M/M |
| `axiom.decision.propose` / `accept` / `reject` / `list` / `show` | missionId、decision 正文、provenance | `decisions`；accept 发 DECISION 通知 | M/M/M/—/— |
| `axiom.artifact.put` / `read` / `list` | missionId、kind、内容或路径、关联 id | 内容寻址写入 + `artifacts` 行 | M/—/— |
| `axiom.message.list` / `send` / `answer` | missionId、taskId?、attemptId?、type? / 目标 attemptId / questionMessageId、body | `send`→`insertMessage` 到 `dispatch:<id>`；`answer`→`answerQuestion` | —/M/M |
| `axiom.policy.show` / `update` | missionId、patch | 预算上调走 Approval | —/M |

注册 5 步：(1) zod params 放 `src/shared/axiom-contract/<ns>-params.ts`（catalog 生成器只索引 `src/shared/**` 且被 `src/main/runtime/rpc/**` 相对导入的模块）；(2) `AXIOM_<NS>_METHODS = [defineMethod({ name: 'axiom.ns.verb', params, handler: (p, { runtime, orchestrationCapability }) => … })]` 放 `src/main/runtime/rpc/methods/axiom/<ns>.ts`，聚合为 `AXIOM_METHODS`（`methods/axiom.ts`）；(3) `...AXIOM_METHODS` 加入 `ALL_RPC_METHODS`（启动即验重名）；(4) `pnpm generate:rpc-params-catalog` 重新生成 `src/shared/rpc-contract/rpc-params-catalog.generated.ts`，`pnpm verify:rpc-params-catalog`（`pnpm lint` 内）必须通过；(5) CLI：spec 放 `src/cli/specs/axiom*.ts`，handler 放 `src/cli/handlers/axiom/`，顶层命令名加入 `CLI_COMMAND_NAMES`（`src/main/startup/cli-command-names.ts`，需保持排序；`src/cli/cli-command-name-parity.test.ts` 校验与 `COMMAND_SPECS` 一致）。

Envelope 字段（`RpcRequest`，`rpc/core.ts:44`）：`orchestrationContractVersion`（mutation 栅栏，`rpc/orchestration-contract-fence.ts`；缺失 → `orchestration_migration_required(client_contract_missing)`）、`orchestrationCapability`（dispatch capability，dispatcher 对**所有**方法注入 `ctx.orchestrationCapability`）、`orchestrationRequestId`（幂等键，`OrchestrationMutationExecutor`）。两处必须 additive 扩展才能覆盖 `axiom.*`：`isOrchestrationMutation`（`src/shared/orchestration-rpc-contract.ts:21` 的 `ORCHESTRATION_MUTATION_METHODS` 集合驱动栅栏与 `isDurableMutation` 收据）和 CLI 的版本戳（`src/cli/runtime/client.ts:133` 仅对 `orchestration.` 前缀写 `orchestrationContractVersion`）。建议新增 runtime capability `axiom.control-plane.v1`（`src/shared/protocol-version.ts`）供客户端协商。

### 4d. 现有命名冲突清单（`rg` 于 `src/main/runtime/rpc/methods/` 与 `src/main/startup/cli-command-names.ts` 核实）

| 命名空间 / 命令 | 实际方法 | 文件 |
|---|---|---|
| `project.*` | `project.list`、`project.update` | `rpc/methods/project-runtime-rpc-methods.ts`（经 `repo.ts` 展开）；`Project` = 仓库/provider 身份（`src/shared/project-types.ts`） |
| `projectHostSetup.*` | `list/create/setupExistingFolder/clone/update/delete` | 同上 |
| `projectGroup.*` | `list/create/update/delete/moveProject/scanNested/importNested` | `rpc/methods/repo.ts` |
| `automation.*` | `list/show/create/update/delete/runNow/runs` | `rpc/methods/automations.ts` |
| CLI `orca project` | 顶层命令 `project` | `cli-command-names.ts`；spec `src/cli/specs/project.ts` |
| CLI 顶层 `check` | 浏览器 checkbox 命令 `path: ['check']` | `src/cli/specs/browser-basic.ts:108`——因此 Worker 命令统一挂在 `axiom attempt <verb>`（术语表 §5、D16 提议中），与 `axiom.attempt.*` 对齐；无残余冲突 |

现存顶层 RPC 命名空间（46 个，`axiom`/`mission` 均未被占用）：`accounts agent agentHooks agentSession agentTeams aiVault artifacts automation browser clipboard computer diagnostics emulator files folderWorkspace git github gitlab host hostedReview jira linear markdown nativeChat network notifications orchestration pairing plugins preflight project projectGroup projectHostSetup repo runtime session settings skills speech ssh stats status terminal ui updater workspacePorts worktree`。

## 5. Worker 通道

**身份与传输**：Worker 进程内的 CLI 通过 `orca-runtime.json`（`getRuntimeMetadataPath`，`src/shared/runtime-bootstrap.ts`；含 `authToken`）连接 `rpc/unix-socket-transport.ts` 或 `ws-transport.ts`。调用者身份来自环境变量：`ORCA_TERMINAL_HANDLE`（PTY 派生时注入，`src/main/ipc/pty/ipc/spawn-options.ts:32`）、`ORCA_PANE_KEY`（remint 稳定的 pane 身份，`src/cli/handlers/orchestration/terminal-identity.ts`）、`ORCA_AGENT_LAUNCH_TOKEN`（agent 状态 hook 的启动令牌）、`ORCA_AGENT_HOOK_TOKEN`（hook 服务鉴权，`src/main/ipc/pty/host-env/spawn-env-keys.ts`）、`ORCA_AGENT_TEAMS_TOKEN`（`src/cli/index.ts:218`）；WSL 透传清单在 `src/main/pty/wsl-orca-env.ts`。process incarnation 由运行时从 pane 解析（`runtime.getTerminalProcessIncarnation`），不由调用者自报。

**dispatch capability（`dcap_…`）**：铸造 `mintDispatchCapability`（只存 hash，写 `assignee_pane_key/process_incarnation`，`consumer_generation+1` 并 `fenceUnacknowledgedMailboxDeliveries`）、校验 `verifyDispatchCapability`（hash timingSafeEqual + pane 等价 + incarnation 相等）、撤销 `revokeDispatchCapability`，均在 `db/dispatch-context/dispatch-capability.ts`；结算时由 `settleWorkerReport` 写 `capability_revoked_at`。Worker 以 `--dispatch-capability` 传入，CLI 放进 envelope `orchestrationCapability`（`src/cli/handlers/orchestration/message-send-handler.ts:101`）。

**拒绝码全表**（`LifecycleRejectionCode`，`orchestration/lifecycle-reconciliation.ts:42`）：`sender_not_assignee`、`dispatch_capability_invalid`、`invalid_payload`、`missing_task_id`、`missing_dispatch_id`、`invalid_outcome`、`unknown_task`、`unknown_dispatch`、`task_dispatch_mismatch`、`inactive_dispatch`、`stale_dispatch`；结算层（`settleWorkerReportInTransaction`）产生 `unknown_task/unknown_dispatch/task_dispatch_mismatch/inactive_dispatch/stale_dispatch`；send 层（`resolveLifecycleAuthority`，`send-point-to-point.ts:161`）产生 `sender_not_assignee/task_dispatch_mismatch/dispatch_capability_invalid`；`ask` 抛 `dispatch_inactive` / `dispatch_capability_invalid`；派生深度超限抛 `nested_worker_depth_exceeded`（`src/shared/nested-worker-depth.ts`）。`hasLifecycleAuthority`（同文件 :17）：有 `assignee_pane_key` 时比对 sender pane（leaf 等价，`isSamePane`），否则退回 `assignee_handle === from_handle`。`mutation_receipts`：`OrchestrationMutationExecutor.run`（`rpc/orchestration-mutation-executor.ts`）按 `(caller_fingerprint, orchestrationRequestId)` 去重、同 id 不同载荷抛 `request_mismatch`，容量在 `orchestration/mutation-receipt-capacity.ts`；CLI 用 `--retry-request`（`src/cli/retry-request-flag.ts`）。

**协议交付**（Orca 现状 → Axiom 替换点）：

| Orca | Axiom |
|---|---|
| `buildDispatchPreamble`（`orchestration/preamble.ts`）把 `orca orchestration send/heartbeat/ask/check` 配方 + 任务正文作为第一条 prompt 写进终端（`worker/deliver-worker-dispatch-preamble.ts`；失败码 `dispatch_preamble_undelivered`） | 保留投递与观测机制，替换文本：首条 prompt = ContextPackage 渲染（任务 spec、验收标准、Decision、依赖 Artifact、权限/预算、提交合同）+ `axiom` 命令配方；在 `PreambleParams` 上 additive 增加自定义 builder 或 `cliCommand='axiom'` |
| 技能发现：`skills/orchestration/SKILL.md` 桩 + `orca skills get orchestration`（`skill-guides/orchestration.md` 与 `references/*.md`）；安装源 `ORCA_SKILLS_REPOSITORY_URL`（`src/shared/agent-feature-install-commands.ts`） | `skills/axiom/SKILL.md` 桩 + `axiom skills get axiom`（`skill-guides/axiom.md`）；安装源改为 fork 仓库（§7） |
| `worker_done` 载荷 `{taskId, dispatchId, outcome, filesModified, reportPath, phase}`（`src/cli/handlers/orchestration/message-payload.ts`） | `axiom attempt submit` 提交完整 Submission 合同（术语表 §3），`filesModified/reportPath` 由 Control Plane 回填给 Orca 结算 |

**`axiom attempt submit` 结算流程**（D4/D11/D16，复用 `settleWorkerReport`）：

1. RPC 层：`orchestrationMigrationFence` 通过；`OrchestrationMutationExecutor` 以 `orchestrationRequestId` 查 `mutation_receipts`，命中即回放收据（不重复执行）。
2. Handler 校验：`db.getDispatchContextById(attemptId)` 存在、`task_id === taskId`、`db.verifyDispatchCapability({dispatchId, capability: ctx.orchestrationCapability, paneKey, processIncarnation})` 为真；Submission 报告经 zod 校验；否则以 §5 拒绝码拒绝，**不改任何状态**。
3. 候选快照（D4）：在该 Attempt 的 worktree（`worker_dispatches.worktree_id`）上检查工作区；clean 且 HEAD 已含全部改动则采用 HEAD，否则由 Control Plane 生成快照 commit；取 `commit`/`tree` hash。
4. 单事务（`runLifecycleWriteTransaction(db.db, 'axiom_submit', …)`，`db/lifecycle-write-transaction-runner.ts`）内顺序写：`candidates`（ACTIVE，前一候选 SUPERSEDED）→ `submissions`（不可变）→ `artifacts` 引用 → 调用 `db.settleWorkerReportInTransaction({taskId, dispatchId, outcome:'succeeded', result: JSON(Orca 结果投影 + submissionId), observation})`；返回 `rejected` 则整体回滚并透传 code。
5. 同事务：`task_stages.stage = SUBMITTED`（from `RUNNING`）；`attempt_observation_facts` 追加 `artifact_git` facet；`audit_events` 记录；`verification_runs` 插入 `QUEUED`。
6. 提交后：`workerRetain` 保留 worktree（只读直到候选 SUPERSEDED/INTEGRATED）；`runtime.notifyMessageArrived('run:<runId>','worker_done')` 唤醒 MissionController；VerificationService 拉取队列。
7. 幂等：`settleWorkerReport` 对已结算 dispatch 返回 `duplicate: true`，Axiom 以 `submissions.dispatch_id UNIQUE` 保证一 Attempt 一 Submission。

`promoteReadyTasks` 在第 4 步仍会被调用，但因 `deps=[]` 无候选，Axiom 依赖不受影响（D10）。

## 6. 迁移方案（v43 起，只加不改）

**为什么不改现有 CHECK 枚举**：`createTables`（`db/schema/create-tables.ts`）在每次打开时执行 `CREATE TABLE IF NOT EXISTS`，`IF NOT EXISTS` 不会放宽已有表的 CHECK（`migrate-v39.ts` 注释）；放宽 CHECK 只能重建表并复制（v39 对 `worker_terminal_archives` 的做法）。而 `resolveOrchestrationMigrationStartVersion`（`orchestration/orchestration-schema-version-skew.ts:184`）在 `storedVersion > schemaVersion` 时原样打开数据库——旧二进制会读到新枚举值，`LEGAL_TRANSITIONS[entity][state]` 查不到即崩溃，`TaskStatus` 等联合类型也失真。上游先例是 side table：`attempt_observation_facts` 的 DDL 注释 "Attempt evidence stays additive so old Task/Dispatch/worker CHECK enums remain wire-compatible"；`hasCompletePostV6Schema` 只探测列/索引/`messages` 的 `'question'`，不探测新表，因此新表对降级探针透明。

**落位**：新建 `db/schema/migrate-v43.ts`（`migrateV43(this, current)`，`current >= 43` 早退），在 `migrate.ts` 的 `migrateV42.call(this, current)` 之后调用；`SCHEMA_VERSION` 在 `db/contract-constants.ts` 改为 `43` 并追加版本注释。新表 DDL 同时放入新文件 `db/schema/create-axiom-tables-sql.ts` 并由 `createTables` 执行（与 `structured_pointer_operations` 相同：fresh DB 由 createTables 建表，v43 只建索引/补列）。Axiom 表的删除清理沿用 `ADDITIVE_LIFECYCLE_DELETE_TRIGGERS_SQL` 模式（`create-graph-tables-sql.ts`）挂到 `tasks`/`dispatch_contexts` 的 AFTER DELETE；但 `orchestration.reset` 对 Mission 已拦截（§4b）。所有列名用 snake_case，时间戳用 `TEXT`（`datetime('now')`），JSON 用 `TEXT`，与上游一致。

| 表 | 关键列（≤8） | 备注 |
|---|---|---|
| `missions` | `id PK`, `run_id UNIQUE`, `repo_id`, `repo_path`, `target_branch`, `status`, `active_goal_revision_id`, `active_plan_revision_id` | status 取术语表 §4.1；`integration_branch = axiom/integration/<id>` 可派生 |
| `goal_revisions` | `id PK`, `mission_id`, `revision INTEGER`, `status`, `objective`, `constraints`(JSON), `acceptance_criteria`(JSON), `provenance`(JSON) | `UNIQUE(mission_id, revision)` |
| `plan_revisions` | `id PK`, `mission_id`, `revision`, `status`, `goal_revision_id`, `milestones`(JSON), `risks`(JSON), `supersedes_id` | 同上；`rejected_reason` 可加 |
| `task_stages` | `task_id PK`(→`tasks.id`), `mission_id`, `plan_revision_id`, `stage`, `spec`(JSON), `retry_policy`(JSON), `attempt_count`, `updated_at` | **唯一项目级权威**；`spec` 含 scope/acceptance/evidence/risk |
| `mission_task_edges` | `mission_id`, `from_task_id`, `to_task_id`, `readiness_threshold`(`INTEGRATED` 或 `VERIFIED`), `plan_revision_id` | `PK(from_task_id, to_task_id)`；DAG 无环由 Control Plane 校验 |
| `agent_specs` | `id PK`(sha256), `role`, `provider`, `model`, `reasoning`(JSON), `permissions`(JSON), `budget`(JSON), `workspace_strategy` | 内容寻址；Attempt 经 `attempt_bindings` 关联（下一行） |
| `attempt_bindings` | `task_id`, `seq INTEGER`（`PK(task_id, seq)`）, `branch`, `dispatch_id`（可空，`UNIQUE`，`createDispatchContext` 后回填）, `agent_spec_id`, `context_package_id`, `created_at` | admission 时先写行（此时 dispatch 尚不存在，D6a），启动成功后回填 `dispatch_id` |
| `context_packages` | `id PK`(sha256), `task_id`, `plan_revision_id`, `manifest`(JSON), `token_budget`, `mandatory_refs`(JSON), `ranked_refs`(JSON) | 内容在 Artifact 存储 |
| `submissions` | `id PK`, `dispatch_id UNIQUE`, `task_id`, `candidate_id`, `report`(JSON), `checks_run`(JSON), `limitations`(JSON), `follow_ups`(JSON) | 不可变 |
| `candidates` | `id PK`, `dispatch_id`, `task_id`, `commit_sha`, `tree_sha`, `status`(`ACTIVE` 或 `SUPERSEDED`), `superseded_by`, `created_at` | `UNIQUE(task_id, commit_sha)` |
| `artifacts` | `id PK`, `mission_id`, `kind`, `sha256`, `size_bytes`, `media_type`, `related`(JSON ids), `created_by` | 内容在 `<userData>/axiom/artifacts/<sha256>` |
| `decisions` | `id PK`, `mission_id`, `status`, `title`, `options`(JSON), `resolution`, `authority`, `provenance`(JSON) | `supersedes_id` 可加 |
| `verification_runs` | `id PK`, `candidate_id`, `task_id`, `status`, `verdict_detail`(JSON), `commands`(JSON), `tool_versions`(JSON), `verifier` | 证据引用走 `artifacts` |
| `integration_batches` | `id PK`, `mission_id`, `base_commit`, `candidate_ids`(JSON，V1 长度 1), `status`, `merge_commit`, `conflicts`(JSON), `approval_id` | 单一集成权威串行写 |
| `approvals` | `id PK`, `mission_id`, `action_kind`, `inputs_hash`, `risk`, `status`, `expires_at`, `resolver` | 另加 `requested_by`, `resolution`, `outcome`(JSON，执行结果), `executed_at` |
| `mission_policies` | `mission_id PK`, `concurrency_limit`, `budget`(JSON), `readiness_threshold`, `approval_rules`(JSON), `verification_rules`(JSON), `nested_worker_max_depth`(=1), `updated_at` | Mission 级覆盖全局设置 |
| `audit_events` | `id PK`, `mission_id`, `actor`, `object_kind`, `object_id`, `event`, `before`(JSON), `after`(JSON) | 只追加；`sequence INTEGER PRIMARY KEY AUTOINCREMENT` 可替代 `id` |

## 7. M0 网络出口与身份清单

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
| PostHog | `https://us.i.posthog.com` | `src/main/telemetry/client.ts:104`；编译期 `ORCA_BUILD_IDENTITY`/`ORCA_POSTHOG_WRITE_KEY`（`electron.vite.config.ts`、`.github/workflows/release-cut.yml`） | `disable` | 无 key 时静默，但依赖 `posthog-node` 仍打包；建议移除依赖 |
| Crashpad | `uploadToServer: false`，无 submitURL | `src/main/crash-reporting/crashpad-capture.ts:70` | `keep-behind-flag` | 本地 minidump 保留 |
| feedback / 用户提交崩溃报告 | `https://www.onorca.dev/v1/feedback` | `src/main/ipc/feedback-request.ts:13`（`FEEDBACK_API_URL`）；mobile `mobile/src/diagnostics/connection-diagnostics-submission.ts:3` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 桌面反馈与崩溃上传已关闭；mobile 不在 M0-03 范围 |
| diagnostics 上传 | 编译期常量 `ORCA_DIAGNOSTICS_TOKEN_URL`（CI 设 `https://www.onorca.dev/diagnostics/token`） | `src/main/observability/diagnostic-upload-endpoint.ts`；`.github/workflows/release-cut.yml:1408` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 官方构建不上传；非官方构建保留开发者环境变量覆盖 |
| login / relay | `https://login.onorca.dev`（client id `orca-desktop`）、`https://relay.onorca.dev` | `src/main/orca-profiles/profile-cloud-auth-config.ts:24,26` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 云账号/手机配对 V1 不需要 |
| push | `https://push.onorca.dev`（env `ORCA_PUSH_GATEWAY_URL` 可覆盖） | `src/main/runtime/push/push-gateway-origin.ts:4` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 同上 |
| artifact 分享 | 原默认 `https://share.onorca.dev`；现只接受 policy origin 的 host，或未打包构建的 loopback | `src/main/artifacts/artifact-cloud-config.ts`；`src/cli/handlers/artifacts.ts` | `keep-behind-flag`（默认关） — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | 保留 `artifacts.*` RPC 与 CLI `artifacts`；未配置返回 typed unconfigured，CLI 非零退出 |
| skill share link | `app.orca.dev`、`share.onorca.dev` | `src/shared/skill-share-link.ts:2` | `disable` — implemented in M0-06a via `src/shared/product-egress-policy.ts`; env flags remain | share hosts 为空时只接受 bare ids；cloud skills 沿用 artifact API 配置 |
| plugin kill-list | `https://onorca.dev/plugins/kill-list.json` | `src/main/plugins/plugin-kill-list-service.ts:10` | `disable` — implemented in M0-03 via `src/shared/product-egress-policy.ts` | 不请求远程列表；保留本地缓存，refresh 无副作用 |
| marketplace | `https://github.com/stablyai/orca-plugins.git` | `src/shared/plugins/plugin-marketplace.ts:12,119` | `replace`/`disable` | — |
| skills 安装源 | `https://github.com/stablyai/orca`（`ORCA_SKILLS_REPOSITORY_URL`）；下载白名单 `https://storage.googleapis.com` | `src/shared/agent-feature-install-commands.ts:3`；`src/main/runtime/runtime-skill-install-commands.ts:89,171` | `replace` | `axiom` skill 的安装源 |
| star 提示 | `ORCA_REPO = 'stablyai/orca'`（经 `gh`） | `src/main/github/client/fetch/orca-star.ts:2` | `disable` | — |
| Casks | `homepage "https://onorca.dev/"` | `Casks/orca.rb:12`、`Casks/orca@rc.rb` | `replace`/删除 | — |
| mobile / cloud | `com.stably.orca.mobile`、scheme `orca`、slug `orca-mobile`；Firebase `onorca-cloud`；terraform `cloud/infra/terraform/environments/*.tfvars` | `mobile/app.json:4,9,18,77`；`mobile/google-services.json:4-5` | `disable`（V1 不构建 `mobile/`、`cloud/`） | 保留目录但移出默认 workspace 构建 |
| 文档站/README 链接 | `docs/site/`、README badges | `docs/site/**`、`README.md` | `replace` | 非网络出口，但含品牌 |

**验证策略**：(1) 构建期常量断言：vitest 用例读取上列文件，断言不含 `onorca.dev`、`stablyai`、`posthog`、`com.stablyai`（允许列表：`LICENSE`、`docs/audits/**`、本文件）；并断言 `package.json` 无 `posthog-node` 依赖、`electron-builder.config.cjs` 的 `appId/productName/protocols/publish` 等于 Axiom 常量。(2) 运行时出口断言：e2e 以 `ORCA_BACKGROUND_LAUNCH=1` 启动打包产物，Chromium 侧用 `--proxy-server` 指向本地记录代理（Electron `net.fetch` 走 Chromium 网络栈），Node 侧设 `HTTPS_PROXY`/`HTTP_PROXY`（`posthog-node`、`fetch` 走 Node 网络栈），冷启动 + 打开 Mission + 完成一次 Attempt 后断言对 `onorca.dev` / `stablyai` / `posthog.com` / `api.github.com` 的请求数为 0；代理日志作为 M0 交付物存档。(3) `pnpm lint` 内新增 `verify:egress-allowlist` 脚本，对 `src/**` 做 `rg` 扫描。

## 8. 代码落位与类型安全

- `src/main/axiom/`：Control Plane 服务（`mission-controller/`、`scheduler/`、`agent-factory/`、`context-builder/`、`message-router/`、`verification/`、`integration/`、`approval/`、`recovery/`、`audit/`、`admission/`、`db/`）；只通过 `OrchestrationDb` 实例与 runtime service 边界接入，RPC handler 在 `src/main/runtime/rpc/methods/axiom/`。
- `src/shared/axiom-contract/`：zod schema 与类型（状态枚举、消息 payload、Submission 合同、RPC params）；renderer/CLI/main 共用；枚举值与 `docs/GLOSSARY.md` 一一对应，改枚举先改术语表并记 Decision。
- `@ts-nocheck` 基线：`config/ts-nocheck-baseline.txt` 共 176 项，其中 `src/main/runtime/orca-runtime-*.ts` **137** 项（非测试 `orca-runtime-*.ts` 共 150 个）；`config/scripts/check-ts-nocheck-ratchet.mjs` 是只减不增的 ratchet（`pnpm lint` 内 `check:ts-nocheck-ratchet`），新文件带 `@ts-nocheck` 直接 CI 失败。规则：Axiom 不在这些文件内新增逻辑（D12）；如必须触碰（例如 `getNestedWorkerMaxDepth`，`orca-runtime-resolve-worktree-selector.ts:118`），只加一行委托到强类型模块。
- `getOrchestrationDb()` 位于 `orca-runtime-automation-operations.ts:152`（`@ts-nocheck`），但其返回类型 `OrchestrationDb`（`orchestration/db/orchestration-db.ts`，非 nocheck）是强类型的。应对：`src/main/axiom/db/axiom-store.ts` 以构造注入 `OrchestrationDb` 实例（`constructor(private readonly db: OrchestrationDb)`），所有 SQL 集中在该 store 并配 vitest（`:memory:` 数据库，与上游 `*.test.ts` 同法）；runtime 只暴露一个 `getAxiomControlPlane()` 访问器。禁止 `as` 断言（上游规则：仅 `as const`，不可避免时加 `SAFETY:` 注释）。
- Attempt 启动：新建 `src/main/axiom/execution/attempt-launcher.ts` 调用 `startLocalWorker`（additive 参数，§4a），不复制 worker 生命周期、worktree 管理或终端管理。

## 9. 上游陷阱清单

| # | 事实（核实位置） | 对 Axiom 的含义 |
|---|---|---|
| 1 | Worker 报告即终局：`worker_done succeeded` 在同一事务把 Task 置 `completed` 并 `promoteReadyTasks`；`LEGAL_TRANSITIONS.task` 任意→任意，`taskUpdate` 可直接写 `completed`（`db/lifecycle-transition.ts`、`worker-report-settlement.ts:276`、`task-status-transition.ts:109`） | `completed` 只能解释为「Attempt 已结算」；权威在 `task_stages`；`taskUpdate` 与 `deps` 对 Mission Run 拦截（§4b、D2、D10） |
| 2 | 自动调度器已退役：`Coordinator`（`orchestration/coordinator.ts`）、`coordinator_runs`、`orchestration.run/runStop`、CLI `coordinator-start` 返回 `orchestration_migration_required/command_retired`；现行 coordinator 是终端里跟 skill guide 的 LLM | 没有可复用的 Scheduler；MissionController 自建确定性、DB 驱动、可重启的调度，并作为 `run:<runId>` mailbox 消费者（`run-delivery.ts`） |
| 3 | decision gate 不是 Approval：`resolveGate` 不校验 options、无 pending-only 守卫、无 resolver/expiry；`createGate` 在 supervised worker 活跃时拒绝，否则把活跃 dispatch 置 `completed`（`decision-gate-store.ts`） | Approval 独立建表（D7）；gate 仅用于无活跃 Attempt 的 Task 级 Question（§3e） |
| 4 | 命名冲突：`project.*`、`projectHostSetup.*`、`projectGroup.*`、`automation.*`、CLI `project`、CLI 顶层 `check`；"Task" 在 GitHub/Linear/Jira 模块另有含义；重名启动即抛 `duplicate_rpc_method` | 全部走 `axiom.*` / `axiom …`（D1）；Worker 命令挂 `axiom attempt <verb>`（D16，提议中） |
| 5 | 契约栅栏：所有 orchestration mutation 需 `orchestrationContractVersion: 1`；栅栏与幂等收据都由 `ORCHESTRATION_MUTATION_METHODS` 集合驱动，CLI 只对 `orchestration.` 前缀打版本戳 | `axiom.*` 必须 additive 接入该集合与 CLI 戳（§4c），否则既无栅栏也无幂等 |
| 6 | 137/150 个 `orca-runtime-*.ts` 为 `@ts-nocheck`，含 `orca-runtime-core.ts` 与 `getOrchestrationDb` 所在模块 | Axiom 逻辑放独立强类型模块，注入 `OrchestrationDb`（§8） |
| 7 | 厂商端点硬编码且部分强制（artifact API 必须 onorca.dev）；auth/feedback/artifact 服务端不在仓库；PostHog 无 key 静默，但 changelog/nudge/kill-list/feedback/login/relay/push 路径仍活跃 | M0 出口清单与自动化断言（§7）；不能只改品牌 |
| 8 | 文档与代码不一致：orchestration「实验性」开关只是 renderer `localStorage['orca.orchestration.enabled']`（`src/renderer/src/lib/orchestration-setup-state.ts`），RPC 始终注册；`docs/site/content/docs/cli/orchestration.mdx:12` 仍写 "Settings → Experimental" | 产品化时删除该开关与文案（C15）；不要把它当安全边界 |
| 9 | `nestedWorkerMaxDepth` 默认 1（`src/shared/default-global-settings.ts:154`），>1 时 Worker 可直接 `workerStart` 子 worker（preamble 的 `buildSubDispatchSection`，`resolveChildDispatchDepth` 只按深度拒绝） | `mission_policies.nested_worker_max_depth` 固定 1；Mission Run 内非 Control Plane 的 `workerStart` 一律拒绝，子任务只能走 `REQUEST_SUBTASK`（C7） |
| 10 | `dispatch_contexts.depth` 默认 1 且 "fails closed"；`DispatchCreator {kind:'system'}` 是进程内根创建者、不可由调用者自报（`db/dispatch-depth.ts`） | Scheduler 用 `system` creator 启动 Attempt，深度恒为 1 |
| 11 | License：`LICENSE` 为 MIT © 2026 Lovecast Inc.；`package.json`（`orca@1.4.197`）无 `license` 字段 | 保留 LICENSE 与署名，补 `license: "MIT"` 与 Third-Party Notices（C13） |
| 12 | `orchestration.reset` 删除全部编排表且不知道 Axiom 表（`db/reset/orchestration-reset.ts`） | 对 Mission 拦截并纳入 Approval；Axiom 表挂 AFTER DELETE 触发器兜底（§6） |
| 13 | `createRun` 一 coordinator 一 Run（`unbindOtherRunsForCoordinator`）；`workerStart` 要求 caller 当前绑定该 Run | Mission 用合成 session party（第 14 条），不得复用真实终端 pane 或真实 agent 会话，否则用户的终端/会话会被解绑 |
| 14 | **#22555（基线内）**：caller/target 统一为 party `{address, terminalHandle, paneKey, orcaSessionId}`（`orchestration/orchestration-party.ts`、`orchestration-caller-identity.ts`）；Run 绑定键 = pane key 或 Orca session id；`createRun` 接受 `coordinatorOrcaSessionId`（handle/pane 可 null）；session caller 在 `rpc/dispatcher.ts` 入口解析（`rpc/orchestration-session-caller.ts`），`worker-start` 等动词对 session caller 不再要求 `from`；未记录为 structured worker 的 session id 按 chat 处理（`terminalHandle: null`），`resolveDeclaredCallerParty` 拒绝以参数声明的 chat caller | D14 据此修订：Control Plane 以每 Mission 一个合成 Orca session id 作为 session party 充当 Run coordinator（mailbox `session:<id>`），在进程内直接构造 `OrchestrationSessionCaller`，dispatch creator `{kind:'system'}`；合成 id 持久化于 `missions` |
