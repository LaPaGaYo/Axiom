# Axiom 术语表（Glossary）V1

更新日期：2026-09-26
地位：**术语、角色名、枚举值、命名空间的唯一来源。** 其它文档（章程、架构、宪法、AGENTS.md、映射参考）引用本表；出现分歧以本表为准，修改枚举必须先改本表并记录 Decision。
仓库落位：`docs/GLOSSARY.md`。

---

## 1. 产品与命名

| 术语 | 定义 |
|---|---|
| **Axiom** | 产品代号（D17 已确认）。桌面应用、CLI、RPC 前缀、分支前缀、数据目录都用它。 |
| **Mission** | 顶层领域对象：用户想让 AI 团队完成的一个软件工程目标及其全部计划、任务、证据与治理记录。取代 V1 文档中的「Project」（D1）。一个 Mission 在 V1 绑定一个本地 Git repository，并对应一个 Orca Run。 |
| **repository / 仓库** | 用户的代码仓库。**不要**用「Project」指代它——Orca 里 `Project` 是仓库/provider 身份类型。 |
| **Control Plane / 控制平面** | Axiom 的确定性权威核心（见 §2）。不使用「Mission Control」作为 UI 标签，避免与 macOS Mission Control 混淆。 |
| **Execution Kernel / 执行内核** | Orca 衍生运行时：终端、PTY、Git/worktree、Agent 会话、SSH/WSL、orchestration 原语。只回答「在哪里、以什么进程和工作区执行」。 |
| **RPC 命名空间** | `axiom.mission.*`、`axiom.goal.*`、`axiom.plan.*`、`axiom.task.*`、`axiom.attempt.*`、`axiom.verification.*`、`axiom.integration.*`、`axiom.approval.*`、`axiom.decision.*`、`axiom.artifact.*`、`axiom.message.*`、`axiom.policy.*`。不得使用 `project.*`（Orca 已占用）。 |
| **CLI** | 二进制 `axiom`。M1 已交付：`axiom mission create\|show\|list\|start\|pause\|resume\|cancel`、`axiom mission goal propose\|activate\|show`、`axiom plan propose\|approve\|reject\|list\|show`、`axiom task list\|show\|cancel`；全部支持 `--json`，mutation 支持 `--retry-request`。`approval` / `attempt` 保留给后续里程碑；Worker 命令见 §5。 |
| **分支命名（D6，含修正）** | 集成基线 `axiom/integration/<missionId>`；Attempt 分支 `axiom/attempt/<taskId>/<seq>`（seq = 该 Task 的 Attempt 序号，由 Control Plane 递增；D6 原文的 `<attemptId>` 因 dispatch id 在 worktree 创建后才存在而改为序号，`attempt_bindings` 记录 `dispatch_id ↔ seq ↔ branch`）；集成临时分支 `axiom/integrating/<batchId>`；目标分支 = 用户指定（默认仓库默认分支）。 |
| **数据落位** | 权威状态：Orca `orchestration.db`（新增 Axiom side tables，迁移 v43 起）；证据/Artifact 内容：`<userData>/axiom/artifacts/<sha256>`（内容寻址，DB 只存引用与 hash，G4）。 |
| **Controlled Acceptance Fixture** | V1 演示与验收用的冻结仓库（D18）：固定 commit / Node / 包管理器版本，确定性离线检查，硬门槛见章程 §9；基线只经 fixture-version Decision 变更。v1 = 自建 FlowTask，`LaPaGaYo/flowtask-fixture` tag `fixture-v1`（commit `a6a8413`），manifest `fixture-manifest.v1.json`（D39、D42）。 |
| **Blind External Validation Fixture** | M4 基本完成后独立选定的第二个仓库（D18）；盲测前不得用于调优 prompt、路由规则、Task 模板或验证策略；提供泛化证据。 |
| **Fixture manifest** | 版本化的 fixture 描述：仓库 + commit、工具链版本、检查命令与时限、预置场景（deterministic failure / merge-only failure / Agent crash / retry / stale-completion）与预期结果；存为 Artifact。 |
| **契约级名称** | 提交合同 `axiom-submission-v1`；AgentSpec workspace 策略 `attempt-worktree`；对 Mission 管理对象越权调用的拒绝码 `mission_managed`；客户端协商的 runtime capability `axiom.control-plane.v1`。 |
| **代码落位（D12）** | `src/main/axiom/`（Control Plane 服务）、`src/shared/axiom-contract/`（zod schema 与类型：`lifecycle.ts`、`mission-objects.ts`、`plan-proposal.ts`、`plan-task-graph.ts`、`mission-params.ts`、`goal-params.ts`、`plan-params.ts`、`task-params.ts`）、RPC 方法经 `src/main/runtime/rpc/methods/index.ts` 注册。禁止在 `@ts-nocheck` 文件内新增逻辑。 |

## 2. 分层与角色

**Provider activation（provider 激活记录）**：当前 Axiom profile 中由用户动作产生的本地设置记录 `providerActivations`，保存 provider id、首次动作时间及来源。D37 用它约束启动与空闲认证/用量请求；默认 `{}`，不能由机器全局凭据、PATH 或既有 hook 推断。不是认证成功证明，也不是 Mission Approval。来源限 `agent-launch`、`settings-hook-install`、`integrations-recheck`、`account-added`；具体持久化提案见 `.axiom-work/reports/M0-09-3.md`。

| 名称 | 类型 | 职责 | 不得做 |
|---|---|---|---|
| **Mission Experience Layer** | UI / CLI | Mission-first 界面与操作入口；投影 Control Plane 状态 | 持有权威状态；直接启动 shell；直接写 DB |
| **Mission Intelligence** | LLM（advisory） | 角色：**Planner**（需求理解、计划与 DAG proposal）、**Architect**（架构 Decision proposal）、**Reviewer**（语义 review、验收条件评估的 advisory 部分）、**Replanner**（失败诊断、replan 分级建议、新 PlanRevision proposal） | 改权威状态；标记 VERIFIED/INTEGRATED；授予权限；合并；推翻 deterministic FAIL |
| **DecisionEngine** | 接口 | 对封闭候选集做 `choose / score / classify / rank`。实现：**RulesEngine**（基线，必备）、**Jev**（可选 typed decision model）、小型 classifier、frontier-LLM fallback | 覆盖依赖 readiness、权限范围、必需测试、Approval 要求、集成顺序、破坏性动作策略 |
| **MissionController** | Control Plane 服务（`src/main/axiom/mission-controller/mission-controller.ts`） | Mission/Goal/PlanRevision/Task 生命周期、DAG 校验与 readiness、replan 触发、completion gate；是 Orca `run:<runId>` mailbox 的**确定性消费者**（取代 Orca 已退役的 LLM coordinator） | 依赖某个长驻 LLM 会话；内存态调度 |
| **Scheduler** | Control Plane 服务 | 从 READY Task 中按并发、预算、优先级选取并 admission；调用 AgentFactory 与 Execution Kernel 启动 Attempt | 越过 readiness；越过预算 |
| **AgentFactory** | Control Plane 服务 | 把 Task 编译为 AgentSpec（provider/model/reasoning/permissions/budget/workspace） | 生成不受策略约束的权限 |
| **ContextBuilder** | Control Plane 服务 | 生成内容寻址的 ContextPackage；强制包含集 + 排序候选集 + token 预算 | 注入完整历史或他人 transcript |
| **MessageRouter** | Control Plane 服务 | 类型化消息的校验、持久化、按对象关系与订阅路由 | 全局广播 |
| **VerificationService** | Control Plane 服务 | 对不可变候选运行 deterministic checks、acceptance checks、diff/Artifact inspection，编排 Reviewer 与升级 | 采信 Worker 自述；让 LLM 推翻 FAIL |
| **IntegrationController** | Control Plane 服务 | 单一集成权威：串行应用候选到集成基线、集成树回归、冲突/修复 Task、批次 promotion | 并行合并；静默解决语义冲突 |
| **ApprovalGateway** | Control Plane 服务 | 按 policy 生成、投递、校验、消费 Approval | 复用过期或范围不符的 Approval |
| **RecoveryService** | Control Plane 服务（`src/main/axiom/recovery/recovery-service.ts`） | 启动与周期性 reconciliation：对非终态 Attempt 询问执行宿主 liveness 并推进状态 | 把 `unverifiable` 判为失败或完成；重复启动 |
| **AuditLog** | Control Plane 服务 | 不可变 AuditEvent 记录 | — |
| **Worker** | 临时执行者 | Claude Code / Codex / Gemini / OpenCode 等在授权 worktree 内执行一次 Attempt；通过 `axiom` CLI 发类型化消息与 Submission | 自证完成；自行集成；派生 Worker；越权写入 |

## 3. 领域对象

| 对象 | 定义 | 权威 | Orca 基础 |
|---|---|---|---|
| **Mission** | 顶层工作对象；含状态、绑定仓库、目标分支、预算上限、policy | `missions` 表 | 1:1 对应一个 Orca `runs` 行（作为 mailbox/容器） |
| **GoalRevision** | Goal 的一个版本：目标、约束、成功标准、验收标准 | `goal_revisions` | 无 |
| **PlanRevision** | 一次被接受的计划版本：里程碑分组、Task 集、依赖、验收标准、风险；不覆盖历史 | `plan_revisions` | 无 |
| **Milestone** | PlanRevision 内的分组标签 + 出口条件；V1 无独立状态机（A7） | 存于 PlanRevision | 无 |
| **Task** | 持久工作单元：spec、scope、acceptance criteria、required evidence、risk、`retryPolicy.maxAttempts`、budget | 项目级：`task_stages`（D2）；执行级：Orca `tasks` | Orca `tasks`（`deps` 保持空，D10） |
| **TaskEdge** | Task DAG 的一条依赖边（readiness 阈值：V1 只支持上游 `INTEGRATED`，D69 修订；`VERIFIED` 枚举保留给 V2，提案带它会被拒） | `mission_task_edges` | 无（不用 Orca `tasks.deps`） |
| **FIX_TASK** | 没有肇事候选的 Mission 级失败（目标分支漂移合并冲突、全部集成后的最终全量回归失败，D70）时由 Control Plane 直接创建的修复 Task（replan 分级 `MINOR_ADJUSTMENT`）；批次级的 CONFLICT / FAILED 不建 FIX_TASK，原 Task 回 `NEEDS_FIX`（D79） | `tasks` + `task_stages`（普通 Task，`spec.kind = fix`） | 同 Task |
| **Integration Queue** | 按序等待集成的 `INTEGRATION_READY` 候选集合，由 IntegrationController 串行消费；持久化为 `integration_batches.status = QUEUED` 的批次 | `integration_batches` | 无 |
| **Attempt** | Task 的一次执行；`attemptId ≡ Orca dispatchId`（A5） | Orca `dispatch_contexts` + `worker_dispatches` + liveness；Axiom 轻表 `attempt_bindings`（`dispatch_id`、`seq`、`branch`、`agent_spec_id`、`context_package_id`） | 直接复用 + 绑定表 |
| **AgentSpec** | Attempt 的执行合同（非人格）：role、capabilities、provider/model/reasoning、permissions、budget、workspace 策略、contextPackageId、submission contract | `agent_specs`（内容寻址） | `WorkerStartParams` 的 `agent/model/effort` 等为投影 |
| **ContextPackage** | 本次 Attempt 的最小充分上下文，内容寻址、可复现；Planner 尚无 PlanRevision，M2-09 只存 manifest/render Artifacts，binding 的 contextPackageId 指向 render Artifact | Worker：`context_packages` + Artifact 存储；Planner：Artifact 存储 | 无 |
| **Submission** | Worker 提交的不可变记录：attemptId、candidate、report、artifacts、checksRun、limitations、questions、followUps（B5） | `submissions` | 扩展 Orca `worker_done` 结算（D11） |
| **Candidate** | 不可变候选身份：commit + tree hash，由 Control Plane 快照生成（D4） | `candidates` | `attempt_observation_facts` 的 `artifact_git` facet 可追加写入 |
| **Artifact** | 可寻址输出：代码 diff、报告、契约、截图、日志 | `artifacts`（元数据）+ 内容寻址存储 | 无 |
| **Message** | 类型化协作消息（§5） | Orca `messages`（`payload.axiom`，D9） | 直接复用 |
| **Question** | 阻塞性问题线程 | Orca `question_threads`（Attempt 运行中的 `ask`）；`decision_gates` 仅用于无活跃 Attempt 的 Task 级阻塞（D7） | 直接复用 |
| **Decision** | 架构或执行选择：options、resolution、rationale、authority、provenance、supersession | `decisions` | 无 |
| **VerificationRun** | 对一个 Candidate 的独立验收：checks、commands、tool versions、evidence refs、verdict、verifier | `verification_runs` | 无（可写 `outcome` facet） |
| **IntegrationBatch** | 一次串行集成：base、候选（V1 单个，D5）、应用结果、冲突、集成树回归证据、Approval、promotion 结果 | `integration_batches` | 无 |
| **Approval** | 绑定精确动作、输入 hash、风险、有效期、resolver、结果的单次授权 | `approvals`（D7） | 不复用 decision gate |
| **Policy** | Mission 级确定性规则：并发、预算、readiness 阈值、Approval 触发条件、验证要求、`nestedWorkerMaxDepth=1`、`unverifiable` 容忍时限（默认 30 分钟） | `mission_policies` | Orca global settings 部分投影 |
| **AuditEvent** | 不可变关键行为记录（含 actor、对象、前后状态、provenance） | `audit_events` | `mutation_receipts` 保留为幂等机制 |
| **CompletionReport** | Mission 完成证据链：Goal、PlanRevision、Task、Attempt、Artifact、Decision、验证、集成、promoted commits、风险 | Artifact（kind=`completion_report`） | 无 |

## 4. 状态枚举

### 4.1 Mission
```text
DRAFT → ANALYZING → PLAN_REVIEW → PLANNED → EXECUTING → FINALIZING → READY_FOR_APPROVAL → COMPLETED
EXECUTING ↔ REPLANNING
任一非终态 → PAUSED（可恢复到前一状态）/ BLOCKED / FAILED / CANCELED
FINALIZING → EXECUTING（漂移合并冲突或最终全量回归失败，建 FIX_TASK，D70 / D79）
READY_FOR_APPROVAL → FINALIZING（交付前目标分支 HEAD 已变，D70）
```
- `PLAN_REVIEW`：PlanRevision 已 PROPOSED，等待人工或 policy 自动批准。
- `FINALIZING`：所有 required Task 已 `INTEGRATED` 或经授权 `CANCELED`，运行最终全量回归与 completion gate 评估。
- Delivery 是动作不是状态：`READY_FOR_APPROVAL →（Delivery）→ COMPLETED`。
- `READY_FOR_APPROVAL`：等待最终交付 Approval（若 policy 要求）。
- **Delivery / 交付**：把集成基线合入目标分支的最终动作；成功后进入 `COMPLETED`。
- `BLOCKED`：阻塞解除（Approval GRANTED / DENIED、Question ANSWERED、预算经 Approval 上调或 replan）后回到进入前的状态；进入前的状态持久化在 `missions.previous_status`（与 `PAUSED` 相同）。
- `BLOCKED(delivery_denied)`：交付 Approval 被 DENIED；人选择修改后重交（回 `EXECUTING`，走 Goal / plan 调整）或 `CANCELED`；EXPIRED 则重新请求，不自动交付（D70）。
- `PAUSED`：停止新 admission 与新 VerificationRun 领取；运行中的 Attempt 按 policy `pauseMode: drain | stop`（默认 `drain`）；集成不开新批次、进行中的批次跑完；wall-clock 预算与 Approval 过期停表；恢复回 `previous_status`（D70）。

### 4.2 GoalRevision
`PROPOSED → ACTIVE → SUPERSEDED`（用户直接编写的 Goal 创建即 ACTIVE；模型提出的修正为 PROPOSED）。Goal 变更 = `MAJOR_REPLAN` 触发。

### 4.3 PlanRevision
`PROPOSED → APPROVED → SUPERSEDED`；`PROPOSED → REJECTED`。同一 Mission 任一时刻只有一个 APPROVED（active）。新 revision 生效时旧 Task 按 `inherit / cancel / rebind` 三种方式处理并记录。

### 4.4 Task stage（项目级权威，`task_stages.stage`）
```text
DEFINED → READY → RUNNING → SUBMITTED → VERIFYING → VERIFIED → INTEGRATION_READY → INTEGRATED
RUNNING           → NEEDS_FIX（Attempt FAILED / STOPPED / ABANDONED 且重试预算未耗尽）
VERIFYING         → NEEDS_FIX（FAIL）
INTEGRATION_READY → NEEDS_FIX（IntegrationBatch CONFLICT 或 FAILED，候选 SUPERSEDED，D79）
NEEDS_FIX         → READY（新 Attempt）
任一非终态        → BLOCKED / CANCELED
BLOCKED           → 按原因解除（D70 修订）：回到进入前的非运行 stage（READY / VERIFYING / INTEGRATION_READY …）；只有 Attempt 仍活着的 Question 答复回 RUNNING
```
- `READY` = 上游依赖全部 `INTEGRATED`（V1 只支持这一阈值，D69 修订）∧ PlanRevision APPROVED ∧ Mission EXECUTING ∧ 无阻塞 Question/Approval ∧ 预算未耗尽。
- `INTEGRATION_READY` = `VERIFIED` ∧ 全部上游依赖 `INTEGRATED`；条件在进入时评估。高风险 Approval 只在批次 `PROMOTABLE` 之后（§4.9，D79），Task 级不再要求 Approval。
- `BLOCKED` 的进入原因与解除（D70 修订、D79）：重试预算耗尽（`retry_budget_exhausted`：经 Approval 提升预算 → READY，或取消 / replan）、`HUMAN_REVIEW` 等待（review 收敛）、批次 Approval 被拒（`approval_denied`：带理由重做 → NEEDS_FIX，或取消）、阻塞 Question（答复后 Attempt 仍活着 → RUNNING，已结束 → READY，答复进强制上下文）；其余原因解除后回 READY，不回 RUNNING。
- `INTEGRATED` = 所属 IntegrationBatch 已 `PROMOTED`（候选已成为集成基线的一部分）。
- 重试预算耗尽 → `BLOCKED(retry_budget_exhausted)`：人选经 Approval 加预算、取消，或重新规划（V1 的 replan 只由人发起，D8 修订；B4）。
- 终态：`INTEGRATED`、`CANCELED`。

### 4.5 Task 执行投影（Orca `tasks.status`，非权威）
`pending / ready / dispatched / completed / failed / blocked`。`completed` 含义 = 「当前 Attempt 已结算」，UI 不得显示为「完成」。

### 4.6 Attempt（投影：状态不新建表，`attempt_bindings` 只做绑定）
| Axiom 视图 | 来源 |
|---|---|
| `LAUNCH_PENDING` | `attempt_bindings.dispatch_id IS NULL`：admission 已提交，尚未绑定内核 dispatch；`liveness / workspace = null`，恢复由 M2-08 负责 |
| `STARTING / RUNNING / SUBMITTED / FAILED / STOPPED / ABANDONED / START_UNKNOWN / STOP_UNKNOWN` | Orca `worker_dispatches.state`（`starting→STARTING`、`ready→RUNNING`、`stopping→RUNNING`、`succeeded→SUBMITTED`、`failed`、`stopped`、`abandoned`、`start_unknown`、`stop_unknown`）与 `dispatch_contexts.status`（`circuit_broken` → 视为 FAILED 且触发 B4） |
| `liveness: live / unverifiable / exited` | 经 `inspectWorkerTerminal` 读取执行宿主判定（`PtyLivenessVerdict`），不用 fleet 的 agent-status 判定；`live/exited` 原样保留，其余状态折叠为 `unverifiable`，可选 `livenessReason: string \| null` 保留 reason 或非 live/exited 的原始 status |
| `workspace: retained / released / pending` | `worker_terminal_resources.release_state`（`retained`、`released`；其余 `not_requested / requested / releasing / unknown` 折叠为 `pending`） |
规则：`liveness = unverifiable` 期间 Attempt 视为仍在 RUNNING，禁止对同一 worktree 冷启动新 Attempt；超过 policy 时限后由 RecoveryService 转 `ABANDONED` 并留证据。

### 4.7 Candidate
`ACTIVE → SUPERSEDED`。

### 4.8 VerificationRun
```text
QUEUED → RUNNING → PASS | FAIL | INCONCLUSIVE
INCONCLUSIVE → SPECIALIST_REVIEW | HUMAN_REVIEW → PASS | FAIL
任一非终态 → CANCELED（候选被 SUPERSEDED）
RUNNING → QUEUED（应用启动时由 VerificationService 重排队，D64 修订）
```
Review 只能收敛 `INCONCLUSIVE`，**不能**推翻 deterministic `FAIL`。

M3-02（D65 / D68）完整转换表：

| 当前状态 | 可转入 |
| -------------------- | ------------------------------------------ |
| QUEUED | RUNNING、CANCELED |
| RUNNING | PASS、FAIL、INCONCLUSIVE、QUEUED、CANCELED |
| INCONCLUSIVE | SPECIALIST_REVIEW、HUMAN_REVIEW、CANCELED |
| SPECIALIST_REVIEW | PASS、FAIL、HUMAN_REVIEW、CANCELED |
| HUMAN_REVIEW | PASS、FAIL、CANCELED |
| PASS、FAIL、CANCELED | 无（终态；仍可更新 cleanupPending 元数据） |

M3-02 新增 phase `checking`（确定性命令执行中）与 `verdict`（证据已持久化、判定已结算）。verdict reason：`checks_failed`（FAIL）、`environment`（环境失败，直接交人）、`flaky`（重跑通过）、`known_flaky`（人工隔离名单）、`non_code`（Task 的 requiredEvidence 去空白后为空，须由人或 Reviewer 确认 Artifact）、`policy_invalid`（旧策略不符合严格 schema，直接交人）；PASS 的 reason 为 `checks_passed`。INCONCLUSIVE 保持 Task VERIFYING，后续 M3-05 才路由审查。verdictDetail 只存摘要与 Artifact 引用；完整命令输出及摘录在内容寻址的证据中。

M3-03（D65 2026-10-24 修订）新增 verdict reason：`scope_violation`（FAIL，候选改动越界）、`secret_detected`（FAIL，新增行命中密钥模式）、`dangerous_change`（INCONCLUSIVE，危险路径未在 scope 中明确命名）、`diff_too_large`（INCONCLUSIVE，patch 超过扫描上限）。diff 不可得仍为 `environment`，detail 为 `integration_base_unavailable` / `merge_base_unavailable` / `diff_unavailable`；diff 给出的 INCONCLUSIVE 一律 escalation=human。

M3-03b（D65 修订 ⑦–⑨）新增 `test_tampering`（INCONCLUSIVE，测试删除、跳过 / 聚焦标记净增、断言净减或抑制注释净增，直接交人）、`artifact_missing`（FAIL，非代码 Task 没有引用 Artifact）、`artifact_invalid`（FAIL，非代码 Artifact 为空、UTF-8 无效或 JSON 无效）。非代码 Artifact 不可读为 `environment`，detail=`artifact_unreadable`，直接交人。`non_code` 取代旧 `no_checks`：即使仓库门禁全绿也不 PASS；`nonCodeTasks=human_confirm` 交人，`artifact_only` 按 `inconclusiveRouting`。代码 Task 的 Artifact 检查只记证据，不改变 verdict。

M3-01 的 `verdictDetail.phase`：`claimed`（事务领取）、`prepared`（独立 worktree 已 detached 检出并核验 Candidate commit/tree）、`prepare_failed`（准备失败，INCONCLUSIVE）、`requeued`（重启回收后重排队）、`canceled`（Candidate SUPERSEDED、Candidate 行缺失 `candidate_missing` 或 Task stage 已改变）。`prepared` 仍是 RUNNING，不代表验证通过；M3-02 才执行检查并产生 verdict。重启重排队的 run 可续接已 `VERIFYING` 的 Task，不回退 stage；普通 QUEUED 仍要求 SUBMITTED。每次领取递增 `claimCount`，记录 `runtimeEpoch / worktreeId / startedAt / finishedAt`；VerificationService 在启动时先回收旧 worktree 再重排队，保留旧审计与 Artifact。回收失败的 run 保持 RUNNING 与旧 epoch，标记 cleanupPending，由后续 kick / 60 s tick 重试；不阻止其他 run 或 Control Plane 启动。

### 4.9 IntegrationBatch
```text
QUEUED → APPLYING → TESTING → PROMOTABLE → PROMOTED
APPLYING → CONFLICT      （→ 原 Task NEEDS_FIX，修复从集成基线 + 预合并的旧候选继续，D79）
TESTING  → FAILED        （→ 原 Task NEEDS_FIX，修复从失败批次的合并 commit 继续，D79）
PROMOTABLE → AWAITING_APPROVAL → PROMOTED | REJECTED
任一非终态 → SUPERSEDED
APPLYING / TESTING → QUEUED（应用重启时由 RecoveryService 丢弃临时分支后重排队）
```
`PROMOTED` = 集成基线 ref 前进到该批次的合并 commit；Delivery（集成基线合入目标分支）是 Mission 级动作，见 §4.1。
`AWAITING_APPROVAL` 是唯一的高风险 Approval 点（D79）：合并树回归通过后才进入；等待期间让出队头，GRANTED 时基线已动则重新合并并重跑回归再晋升；`REJECTED`（DENIED）→ 候选 SUPERSEDED、Task `BLOCKED(approval_denied)`。

### 4.10 Approval
`PENDING → GRANTED | DENIED | EXPIRED | REVOKED`；`GRANTED → CONSUMED`（单次使用，执行后即消费）。

### 4.11 Decision
`PROPOSED → ACCEPTED | REJECTED`；`ACCEPTED → SUPERSEDED`。

### 4.12 Question
`OPEN → ANSWERED | WITHDRAWN`（映射 Orca `pending / answered / closed`）。

### 4.13 其它固定词汇
- Liveness verdict：`live / unverifiable / exited`（执行宿主拥有执行真相）。
- Replan 分级：`NO_REPLAN / MINOR_ADJUSTMENT / MAJOR_REPLAN`（V1：`MAJOR_REPLAN` 只由人发起，`MINOR_ADJUSTMENT` 是 Control Plane 确定性动作的审计标签；自动分级在 V2，D8 修订、DEF-36）。
- 风险等级：`low / medium / high`；`high` 默认需要 Approval。
- Verification check 结果：`pass / fail / environmental / inconclusive / skipped`（D68；`environmental` 包括 `tool_missing / timeout / killed / setup_failed`；`skipped` 需给出 `time_budget_exhausted / setup_failed` 等策略依据）。

| 词汇 | 值与含义 |
|---|---|
| `TaskSpec.role` | 可选的非空字符串标签（M2-09 / DEF-4）；提案、批准物化与 Task spec 保留它，不参与 provider 路由、角色权限或 skills 物化。省略时保持既有行为。 |
| `ProviderFilterReason` | `not_installed \| no_account \| not_certified \| disallowed \| tier_too_low`，按此顺序取首个命中原因（D57、D83）；`no_account` = macOS / Linux 未选中 Axiom 管理的对应 Codex / Claude 账号。 |
| `RoleRouting` | `routing.roles.planner` / `routing.roles.worker` 的可选 `{ provider, model, effort }`（D82，2026-10-27）；角色模型优先于 `routing.models[provider]`，最后回退 `policy-default`（harness 默认模型，无写死型号）。 |
| `Effort` | `low \| medium \| high \| xhigh`；角色配置优先，Planner 默认 `high`，Worker 按风险：high → `high`，其余 → `medium`（D82）。 |
| `crossProvider` | `routing.crossProvider` 默认 `true`；Worker 在有至少两个合格 provider 时优先使用不同于 Planner 的 provider。Planner 来源先取已批准 PlanRevision 的 `provenance.actor`，再取最新 Planner AgentSpec；角色显式 provider 仍优先。只有一个合格 provider 时允许同家，选择理由与审计记录是否应用交叉（D82）。 |
| `requireCertified` | `routing.requireCertified` 默认 `false`；打开后 provisional 组合在 `not_certified` 槽位过滤，V1 验收运行时打开（D57）。 |
| `attempt.launch_observed` | Claude `system/init` 的实际启动证据：harnessVersion、model、permissionMode、skills、plugins、mcpServers、apiKeySource；超出请求与 launchBaseline 的值另记 `attempt.launch_mismatch`（D83）。 |
| `launchBaseline` | Claude 组合的可选、版本固定的 harness 启动基线：`harnessVersion`、内建 `skills` 名称与 `evidence` 路径；复制到 `requested.launchBaseline`，缺失时为 null 并记 `harness_baseline_missing`（D83，M3-08f）。 |
| Axiom policy tier（`--managed-settings`） | Mission Claude 启动的 Axiom 策略层：Worker argv 传单行内联 JSON，Planner SDK 传 `managedSettings` 对象；模型不能覆写。文件路径形式会被 harness 静默忽略，不使用（D83）。 |
| `harness_baseline_stale:<version>` | `system/init` 的 Claude 版本（去掉 `(Claude Code)` 后缀）与记录的 `launchBaseline.harnessVersion` 不同的信息性 mismatch；升级需重新验证，运行时不自动重写基线（D57、D83、DEF-8）。 |
| `attempt.permission_denied` | Mission Claude Planner 未被允许规则放行的工具提示由宿主自动拒绝的审计，带 toolName 与不含输入内容的 summary（D63）。 |
| `endpointProfile` | `subscription`（V1）：用户在 harness 中已有的登录或自行配置的凭据；进入 AgentSpec 的内容寻址，不包含凭据本身（D57）。 |
| `caller_not_desktop` | 人工动作（`desktop_only` 方法）收到非桌面应用的调用（本机 CLI、配对设备或无法认定）时的拒绝码（D78）。 |
| `caller_not_permitted_for_agent` | 宿主已解析为 Axiom Attempt / Planner / Reviewer dispatch 的会话调用非 `workspace` 方法、Agent 审批 / 回答或创建 Run / Worker / Orca Task 时的第二层拒绝码（D78）；不替代桌面传输边界。 |
| `authority.refused` | 调用方守卫拒绝动作且宿主会话能关联 `attempt_bindings` 时追加的审计事件；归属该 Mission / Task，记录 `method`、`callerKind`、`attemptId`（D78）。 |
| `workerPosture` | `sandboxed`（默认：`workspace-write`、网络关闭、审批桥）\| `bypass`（只作 policy 显式后备，`third_party` 仓库不可用）（D63 当前全文）。 |
| `repositoryTrust` | `own`（默认）\| `third_party`：第三方仓库只许 sandboxed 姿态的 Worker（D63 当前全文）。 |
| `threshold_not_supported` | 提案或 policy 里出现 `VERIFIED` 依赖阈值时的错误码（V1 只支持 `INTEGRATED`，D69 修订）。 |
| `integration_merge` | 集成失败后修复 Attempt 的基线：CONFLICT = 当前集成基线 + 预合并的旧候选，FAILED = 失败批次的合并 commit（D79）。 |
| `scope_extended` | 集成失败的修复需要动 Task scope 之外、但当前 PlanRevision 已授权某个 Task 写的文件时，写进该 Attempt AgentSpec 的扩展与审计（D79）。 |
| `approval_denied` / `delivery_denied` | 批次 Approval 被拒时 Task 的 BLOCKED 原因（D79）/ 交付 Approval 被拒时 Mission 的 BLOCKED 原因（D70）。 |
| `pauseMode` | `drain`（默认）\| `stop`：Mission PAUSED 时运行中 Attempt 的处理（D70）。 |

## 5. 消息类型与 Orca 映射（D9）

| Axiom 类型 | 谁可发 | 典型接收者 | Orca `messages.type`（仅路由） | 说明 |
|---|---|---|---|---|
| `INFORM` | Worker、Control Plane | 受影响 Task 的订阅者 | `status` | 状态/兼容性变化 |
| `REQUEST` | Worker | MissionController | `escalation` | 资源、权限、Control Plane 动作 |
| `QUESTION` | Worker、Control Plane | 指定 Agent / specialist / 人类 | `question`（+ decision gate） | 阻塞性问题 |
| `DECISION` | Control Plane | 依赖该 Decision 的 Task | `status` | 决策通知；正文在 `decisions` 表 |
| `BLOCKED` | Worker | MissionController | `escalation` | 无法继续 |
| `HANDOFF` | Worker | 下游 Task/Agent | `handoff` | 产物与责任交接 |
| `REQUEST_SUBTASK` | Worker | MissionController | `escalation` | 请求新范围工作；由 Control Plane 校验后创建 Task |
| `SUBMISSION` | Worker | VerificationService | `worker_done`（经 Axiom 结算） | 不可变候选 + 报告 |

- `payload.axiom.type` 持久化产品类型；每条消息必须带 missionId 与相关 taskId / attemptId / decisionId / artifactId。
- `merge_ready`、`dispatch`、`decision_gate` 不允许由 Worker 发出；`heartbeat` 是执行内核 liveness 信号，不是产品消息类型。
- Worker CLI 命令统一挂在 `axiom attempt <verb>` 下：`axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check`（`check` 读取自己的 mailbox）。不用顶层 `axiom check`——Orca CLI 已有顶层浏览器命令 `check`（`src/cli/specs/browser-basic.ts`）。调用方身份由宿主核实（D73：终端 / pane / Orca session，不接受命令行指定）；人做的决定不经 CLI，只接受桌面应用（D78）。
- Worker 在 Attempt 运行中提问走 `axiom attempt ask`（Orca `ask` / `question_threads`）；Orca decision gate 只用于**没有活跃 Attempt** 的 Task 级阻塞（`createGate` 在 supervised worker 活跃时会拒绝）。

## 6. Orca 术语对照

| Orca 术语 | 在 Axiom 中 |
|---|---|
| Run | Mission 的容器与 mailbox（`run:<runId>`）；`runs` 表无 status，Mission 状态在 `missions` 表 |
| coordinator | 已退役的 LLM 协调者概念；Axiom **不使用**，由 MissionController 消费 run mailbox |
| dispatch / DispatchContext | Attempt |
| worker / worker_dispatches | Attempt 的受监督进程 |
| caller identity（`RpcCallerIdentity`、`OrchestrationSessionCaller`） | 宿主按传输层与注入的会话认定调用方：`desktop` / `local-cli` / `paired-device`；Attempt 动词另按终端 / pane / Orca session 与进程代次核实（D73）；人做的决定只接受 `desktop`（D78） |
| decision gate | 仅承载无活跃 Attempt 时的 Task 级 QUESTION 阻塞；不是 Approval |
| `ask` / question_threads | Attempt 运行中的 QUESTION 通道 |
| session party / 合成 session id（D14） | Control Plane 参与 orchestration 的身份：每个 Mission 一个符合 `isOrcaSessionId` 格式的合成 Orca session id，作为 Run coordinator 与 `session:<id>` mailbox 地址；进程内直接构造 `OrchestrationSessionCaller`，dispatch creator `{kind:'system'}` |
| party（#22555） | Orca 对 caller/target 的统一表示 `{address, terminalHandle, paneKey, orcaSessionId}`；PTY agent = 终端（handle + pane），结构化会话 = Orca session id |
| federation / `--on <environment>` | 远端放置；V1 之后 |
| child worktree | 每个 Attempt 一个 |
| heartbeat | 执行内核 liveness 信号 |
| `merge_ready` | Axiom 中禁止 Worker 使用 |
| `Project` | 仓库/provider 身份；与 Mission 无关 |
