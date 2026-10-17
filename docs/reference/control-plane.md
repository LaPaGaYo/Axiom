# Control Plane 子系统参考（M1 + M2-06a）

更新：2026-10-17 · 适用：M1-01～M1-09 已合入的 Mission Facade；M1-10 出口证据另见 [M1-exit-e2e.md](../review-evidence/axiom-m1/M1-exit-e2e.md)。
规范权威仍是 [Constitution](../PROJECT_CONSTITUTION.md) §1、ACCEPTED Decisions、[Glossary](../GLOSSARY.md) §4 与 [Architecture](../ARCHITECTURE.md)；本文定位实现，不新增权威或状态。

## 1. 用途与边界

Control Plane 决定并持久化 Mission、版本化 Goal/Plan、Task stage 与依赖 readiness；模型只提出建议，renderer 只展示投影。顶层对象与 RPC 使用 Mission / `axiom.*`（D1）。用户代码所在对象称 repository；Orca `Project` 仍是仓库/provider 身份类型。

M1 提供人工输入计划、审批、启动、暂停/恢复/取消、阻止 Orca 旁路与重启恢复。M2-05 起 `mission start` 创建集成基线并经 Scheduler admission 启动 Worker；M1 出口测试通过禁止全部 provider 保留 Attempt-free 语义。它不是 LLM coordinator、第二个终端/worktree 管理器，也不复活退役的 `coordinator.ts`。

Execution Kernel 继续拥有 Run、Orca Task、dispatch、PTY、进程、worktree、消息投递和收据。Axiom 经 `OrchestrationDb` 与现有 service/RPC 边界复用这些原语。权威 Mission 状态在 `missions.status`；权威 Task stage 在 `task_stages.stage`（D2）；`tasks.status` 只是执行投影。Mission 的 DAG 在 `mission_task_edges`，Orca `tasks.deps=[]`（D10）。

## 2. 模块地图

| 路径 | 职责 |
|---|---|
| `src/main/axiom/db/` | `axiom-store.ts` 聚合已启用的 side table 的访问；`missions-store.ts`、`revisions-store.ts`、`task-graph-store.ts`、`policy-audit-store.ts`、`artifacts-store.ts`、`agent-specs-store.ts` 分域 SQL；`axiom-rows.ts` / `row-codec.ts` 校验数据库行 |
| `src/main/axiom/mission-controller/` | `mission-controller.ts` 提供事务入口；`mission-lifecycle.ts`、`goal-lifecycle.ts`、`plan-materialization.ts`、`task-readiness.ts` 实现状态转换；`controller-context.ts` 定义错误与审计；`run-mailbox-consumer.ts` 消费 Run mailbox |
| `src/main/axiom/execution/attempt-launcher.ts` / `mission-caller.ts` | M2-05：预创建 Attempt worktree、合成 caller、D14 service 调用、dispatch 绑定与启动结算 |
| `src/main/axiom/execution/integration-base.ts` | D51：start 前以目标分支 HEAD 创建集成基线；已存在只沿用，M4 前不移动 |
| `src/main/axiom/execution/attempt-projection.ts` | `attempt_bindings` 与 Orca `projectFleetWorker` 投影，供 `axiom.attempt.show/list` 与 CLI 读接口 |
| `src/main/axiom/artifacts/` | M2-02：`ArtifactStore` 以 sha256 寻址文件，原子写入、读取校验、Mission/kind/related 过滤；根目录由 Control Plane 注入 |
| `src/main/axiom/context-builder/` | M2-02：七节强制集、确定性依赖 Artifact 排序、预算裁剪、脱敏、canonical manifest 和 Worker prompt template |
| `src/main/axiom/agent-factory/` | M2-03：先过滤，再由 RulesEngine 排序；生成 worker/planner AgentSpec，在同一事务持久化合同与选择审计，不启动进程 |
| `src/main/axiom/decision-engine/` | M2-03：闭集 choose/score/classify/rank 接口与确定性 RulesEngine；只能建议，不能修改 eligibility 或权威状态 |
| `src/main/axiom/scheduler/` | `scheduler.ts` 逐轮从数据库排序/校验并事务性 admission；`critical-path.ts` 计算最长下游链；`admission-blockers.ts` 真查 Question/Approval；`admission-budget.ts` 校验 Mission 总 Attempts/wall-clock；typed launch seam 在 M2-05 注入 |
| `src/main/axiom/admission/` | `mission-managed-run-guard.ts` 阻止 Orca RPC 修改 Mission 对象；四组测试固定 §4b 拦截 |
| `src/main/axiom/recovery/` | `recovery-service.ts` 恢复非终态 Mission、检查绑定、重算 readiness；Attempt 恢复尚为空钩子 |
| `src/main/axiom/control-plane.ts` | 按 `OrchestrationDb` WeakMap 缓存 store/controller/recovery/artifacts/contextBuilder/agentFactory/decisionEngine，维护进程内消费者取消句柄并接入生命周期 |
| `src/main/axiom/control-plane-boot.ts` | `startAxiomControlPlane` / `stopAxiomControlPlane`；启动恢复和退出停止 |
| `src/main/axiom/kernel-contract/` | M1-01 的 session party、Run/mailbox、Task 与 dispatch 身份契约测试；D14 的可执行依据 |
| `src/shared/axiom-contract/` | zod 对象/params/响应、`lifecycle.ts` 合法转换、`plan-proposal.ts` 与 `plan-task-graph.ts` 校验、`mutations.ts` 分类、`stage-labels.ts` 文案 |
| `src/main/runtime/rpc/methods/axiom/` | `mission.ts` / `goal.ts` / `plan.ts` / `task.ts` / `artifact.ts` / `policy.ts`；`../axiom.ts` 聚合到 `ALL_RPC_METHODS` |
| `src/cli/specs/axiom-*.ts` + `src/cli/handlers/axiom/` | `mission`、`mission goal`、`mission artifact`、`mission policy`、`plan`、`task` CLI；`input-files.ts` 解析 Goal / Plan，`rpc-command.ts` 调用与输出 |
| `src/renderer/src/components/missions/` + `src/renderer/src/lib/axiom-client.ts` | Mission list/Home、Plan 审批、Task 表；共享 schema 校验与 mutation envelope；刷新后以服务端状态对账 |

新增逻辑不能进入 `@ts-nocheck` 的 runtime 文件（D12）。扩展 RPC 仍遵循 [orca-mapping](orca-mapping.md) §4c 的五步注册与 catalog 检查。

## 3. 持久数据：17 张 side table

权威数据库为 `<userData>/orchestration.db`。M1-03 的 `src/main/runtime/orchestration/db/schema/create-axiom-tables-sql.ts` / `migrate-v43.ts` 建全 17 张表；M1 的业务 store 使用下表前七张。已有表不改 CHECK 枚举，未来只做 additive migration。

| 表 | 内容 / M1 使用情况 |
|---|---|
| `missions` | 使用：repository、target branch、Run/session 绑定、status、active revisions、`previous_status` |
| `goal_revisions` | 使用：版本化正文、约束、验收、provenance、ACTIVE/SUPERSEDED |
| `plan_revisions` | 使用：milestones/risks/proposal JSON、版本、Goal 关联、审批与拒绝理由 |
| `task_stages` | 使用：Orca Task id、Plan 关联、权威 stage、`previous_stage`、spec、retry policy、attempt count |
| `mission_task_edges` | 使用：物化后 Orca Task id 间的有向边及 readiness threshold |
| `mission_policies` | 使用：默认 concurrency/预算/阈值/审批与验证规则；v44 `routing` 由 policy RPC 更新；`nested_worker_max_depth=1` |
| `audit_events` | 使用：只追加的 sequence、actor、object、event、before/after、时间；mailbox 幂等依据 |
| `agent_specs` | M2-03 已写/读：v44 `spec` 存 canonical 完整合同，id = `spec_` + sha256；标量索引与合同必须一致 |
| `context_packages` | M2-02 已写/读：canonical manifest、预算；`mandatory_refs` = `[manifestArtifactId, renderArtifactId]`，`ranked_refs` = 已纳入候选 Artifact id |
| `attempt_bindings` | M2-04 admission 写/读：Task 序号、branch、AgentSpec、ContextPackage；`dispatch_id = NULL`，由 M2-05 launch 创建 dispatch 后回填（D6a） |
| `submissions` | 表已建；M2 submit 形成不可变 Worker 报告 |
| `candidates` | 表已建；M2 由 Control Plane 固定 commit/tree，Worker 不能自封候选 |
| `artifacts` | M2-02 已写/读：Mission、kind、sha256、size、media type、related ids、createdBy；内容只存 `<userData>/axiom/artifacts/<sha256>` |
| `decisions` | M2-02 `listDecisions({ missionId, status })` 只读；ContextBuilder 包含 ACCEPTED 的 title/resolution；Decision service/RPC 写入者仍待后续 |
| `verification_runs` | 表已建；M3 独立验证使用 |
| `integration_batches` | 表已建；M4 串行集成使用 |
| `approvals` | 表已建；M4 ApprovalGateway 使用，不复用 decision gate |

Milestone 存在 Plan JSON 内，没有独立表/状态机。Attempt 身份仍等于 Orca dispatch id，不存在 Axiom Attempt 表。M2-02 启用 Artifact/ContextPackage 写入和 Decision 读取；M2-03 启用 AgentSpec 写入和 policy routing 更新；M2-04 启用 attempt_bindings 写入与阻塞 Approval/Question 读取；其余后续表目前只有建表和清理支持，不能把表存在当成产品能力已完成。

`create-tables.ts` 每次打开执行幂等 DDL，`SCHEMA_VERSION=44`；9 个查询索引、3 个删除触发器沿用 additive 模式。Task 删除清理 stage/边/binding，dispatch 删除仅清空 binding 的 dispatch 引用，Run 删除清理所属 Mission side rows。没有声明外键；v44 仅为 agent_specs.spec 与 mission_policies.routing 加列（TEXT NOT NULL DEFAULT '{}'），hasColumn 防止重复 ALTER，版本化探针从 v44 起检查这两列，v43 与更高版本降级路径保持透明。详细列见映射 §6。

所有 store 读取先用 zod 解析，不把 SQLite 行强制断言为领域对象。写入由 `runLifecycleWriteTransaction` 包裹，嵌套 savepoint 使 Run 创建和 Mission 创建能一起回滚；审计与状态同事务提交。

### ContextPackage（M2-02）

`plane.artifacts` 与 `plane.contextBuilder` 供后续 Scheduler、launcher、submit 服务复用。Artifact id = `art_` + sha256(canonical `{missionId,kind,sha256}`)；相同 Mission/kind/bytes 返回既有元数据（首次 related/createdBy 不被重写），跨 kind/Mission 共用内容文件。先写 `.tmp-<random>` 再 rename；read 重新检查 hash/size，缺文件或不匹配返回 `artifact_corrupt`。put 上限 8 MiB；RPC 用 `contentBase64`，CLI `mission artifact put --mission … --kind … --file … --related …` 在本机读文件。read 的 `--json` 保留 base64，文本输出按 UTF-8；list 支持 kind 和单一 related id。

ContextBuilder 固定强制顺序：(1) Task spec；(2) PlanRevision revision/milestone/带邻居标题的入出边；(3) ACCEPTED Decisions；(4) 权限、Mission/Task 预算、并发、重试与 `axiom-submission-v1` 字段清单；(5) 目标分支的 AGENTS.md/CLAUDE.md，各最多 16 KiB（缺文件省略，读失败不静默忽略）；(6) policy 验证命令；(7) `none (first attempt)`，M3 补失败证据。只读这两个规则文件，不读工作区版本或 `.env*`。

预算按 `ceil(UTF-8 bytes / 4)` 估计，调用参数优先，其次已解析 policy.budget 的可选正整数 `contextTokens`，否则 24,000。M2-03 已加入共享 BudgetSchema，可在 mission create RPC 的 policy 中设置；后续预算修改仍需 M4 Approval。协议块计入第 4 节的 hash/token 数。强制集永不裁剪，超限设 `budgetExceededByMandatory: true`；候选按既有入边查询顺序（from_task_id）、再 created_at/id，去重后取直接上游的 handoff/worker_report，第一项放不下即停止，余项记 budget。

规则与候选在纳入前脱敏：PRIVATE KEY 块、指定 provider token 前缀（兼容 hyphen/underscore）和 AKIA key 替换为 `[REDACTED]`；规则先脱敏再截断。候选的敏感部分在 omitted 中以 redacted 记录，安全替换文本仍可纳入；section header 标记 redacted。manifest ranked hash 绑定脱敏后的正文；强制 hash 绑定渲染节（第 4 节另含协议）。

canonical manifest 无空白、对象键序固定，保留数组顺序，id = `ctx_` + sha256(canonical)。manifest 与完整 render template 均作为 Artifact 持久化，context row 只保留 JSON manifest/hash/引用。相同输入重复 build 不新增行或文件。模板最后的 `Axiom Worker protocol` 使用 D16 八个 `axiom attempt` verb；M2-05 必须在交付时替换所有 `{{attemptId}}` 和 `{{dispatchCapability}}`，不能把真实 capability 写回 template 或 package identity。

### Provider selection（M2-03）

AgentFactory.build 接受 worker 的 missionId/taskId/contextPackageId，或 planner 的 missionId/goalRevisionId；引用必须存在且归属匹配。ContextPackage 是输入，不由 Factory 创建。主机安装集合由注入的 listInstalledProviders 提供，Control Plane 注入 detectInstalledAgentsWithShellPathHydration；此处不新增认证探测或网络调用。

| Tier | Provider | 可选择范围 |
|---|---|---|
| A | structured-session enum 的 codex、claude | 一般/高风险 Worker、Planner |
| B | 其他 TuiAgent | 一般风险 Worker |

先按 TUI_AGENT_CONFIG 的顺序规范安装集合，排除 claude-agent-teams（Claude launch mode）。对已知 provider 依次记录 not_installed、disallowed、tier_too_low；高风险与 Planner 仅允许 A。无候选返回 no_eligible_provider，附 installed/filtered，无 spec 或 audit 写入。

RulesEngine 只对过滤后的闭集排序：preferredProviders 首次匹配得分 100 − index，然后 A 在 B 前，同分保持配置顺序。所有 verb 都从输入集合取结果，Factory 再检查返回值是 eligible 集合的完整排列。model = routing.models[provider] 或 policy-default；高风险 effort=high，否则 medium。selection 持久化 installed/filtered/ranked/chosen/rationale，ranked 是后续 fallback 顺序。

AgentSpec 的预算只含本次 Attempt 的 maxRuntimeMinutes（Task → Mission → 45）与可选 maxTokens（Task → Mission），不含 maxAttempts。worker 复制验收标准、scope.allowedPaths 写权限和首段路径去重排序后的 capabilities；planner 固定 planning、空写权限与 planner-worktree。规范 JSON 按 schema 键序生成并 sha256 寻址；INSERT OR IGNORE 只在插入时追加 agent_spec.created，两者同一事务。Factory 不改 Task stage、readiness、权限许可或 attempt_bindings，不创建 worktree、不启动 Worker。

axiom.policy.show/update 及 CLI `axiom mission policy show --mission <id> --json` / `update --mission <id> [--routing-file <json>] [--concurrency <n>] --json` 已注册。M2 patch 仅应用 routing（整体替换，省略字段使用默认值）与 concurrencyLimit；budget 键在 handler 的写入前检查中一律返回 approval_required（M4），其他未知键返回 invalid_argument。更新经现有 mutation fence/receipts，policy 与 policy.updated（before/after）同一事务持久化。

## 4. 状态机与 readiness

完整枚举/转换见 Glossary §4、Architecture §6；代码源为 `lifecycle.ts`。M1 可走：

```text
Mission: create → ANALYZING → propose → PLAN_REVIEW → approve → PLANNED → start → EXECUTING
                          ← reject ←
Goal: 用户输入创建即 ACTIVE；后续 PROPOSED → ACTIVE，旧 ACTIVE → SUPERSEDED
Plan: PROPOSED → APPROVED 或 REJECTED
Task: approve 物化 DEFINED；start 重算为 READY；可授权 CANCELED
```

合法转换表包含未来阶段，但 M1 没有推进 RUNNING、SUBMITTED、VERIFIED、INTEGRATED 或 COMPLETED 的产品执行链。Orca `completed` 仅指当前 Attempt 已结算，不能显示为 Task 完成；UI 只有 INTEGRATED 计入进度。

暂停/阻塞前的 Mission 状态保存在 `missions.previous_status`；resume 只用于 PAUSED，内部 unblock 用于 BLOCKED，恢复目标必须等于该字段。嵌套 PAUSED/BLOCKED 经持久 `mission.status` 审计回放恢复更早返回点。Task 进入 BLOCKED 保存 `task_stages.previous_stage`，解除时只能返回该 stage（或取消），不能任意跳跃。条件更新不命中时抛 `stale_state`。

M1 仅允许首个 Plan 批准。`plan-materialization.ts` 校验共享 schema、唯一 id、合法 milestone、端点、重复边、自环与 DAG 后，将提案 `T01` 等 id 映射为新 Orca Task id；Task 创建 `deps=[]`，Orca 投影即 `ready`，Axiom stage 为 DEFINED。批准后 Mission 为 PLANNED，此时不会 READY；必须 `mission start`。

`task-readiness.ts` 对 DEFINED 重算 READY，要求：

1. Mission 为 EXECUTING，Task 所属 Plan 为同 Mission 的 APPROVED revision。
2. 每条上游边来自同 Mission/Plan；默认阈值需要 INTEGRATED；VERIFIED 阈值接受 VERIFIED、INTEGRATION_READY、INTEGRATED。
3. Task `attemptCount < retryPolicy.maxAttempts`，Mission policy 存在；配置了 `budget.maxAttempts` 时，Mission 总 attempt count 尚未耗尽。
4. 无阻塞 Question/Approval。M2-04 的 `blockingQuestionOrApproval(ctx, task)` 依次查询 Task 的 pending `decision_gates`、经 `attempt_bindings.dispatch_id` 关联的 pending `question_threads`，以及同 Mission 的 PENDING `approvals`。前两者返回 question；Approval 只匹配 `BLOCKING_APPROVAL_ACTION_KINDS = [budget_increase]`，返回 approval（M4 扩展）。resolved/timeout gate、answered/closed thread 与非阻塞 action kind 不拦截。DEFINED readiness 和 READY admission 共用此检查。

冻结 fixture 的 readiness 是 12 Tasks / 20 edges / 3 READY（T01–T03）/ 9 DEFINED；M2-05 的 admission 随后将三个根 Task 推至 RUNNING。无 eligible provider 的 M1 场景保持 READY。`parallelReady` 提示不是 readiness 权威。

### Scheduler admission 与预算（M2-04）

`Scheduler.scheduleRound(missionId, trigger)` 只处理 EXECUTING Mission，先重算 readiness，再按最长下游链长度降序、Task id 升序遍历 READY Tasks。每轮从数据库读取状态；同实例/同 Mission 的重叠调用只保留一个待执行 trigger，当前轮结束后再跑一轮，无 polling/timer。进程重启只需重新实例化 Scheduler；序号、计数、provider 占用均从数据库恢复。

ContextBuilder/AgentFactory 的异步构建在 admission 事务之前完成。事务内重新校验 Mission/Task、APPROVED Plan 与依赖、Question/Approval、预算/并发、构建前后的 Task/policy 一致性，以及 package/spec 存在且归属匹配；分配 `seq = max(seq) + 1`，写 `attempt_bindings(dispatch_id = NULL, branch = axiom/attempt/<taskId>/<seq>)`，CAS `READY → RUNNING` 并 `attempt_count += 1`，追加 `task.stage` / `attempt.admitted`。RUNNING 转换必须带 `actor: Scheduler` 与 `attemptCountDelta: 1`，否则 `illegal_transition(reason: admission_required)`。

只有 admission 提交成功后才 `await launch(attempt)`；M2-05 的 `plane.scheduler` 注入 `createAttemptLauncher`，launch 为必填。launcher 持久化 dispatch 绑定并按内核 receipt 结算，失败不抛回调度轮。Scheduler 的防御性 rejection audit 仍保留；没有 `launcher_unavailable` skip。

| 配置 | 含义 | M2 enforcement |
|---|---|---|
| `policy.budget.maxAttempts` | Mission 总 Attempt 数 = 全部 Task `attempt_count` 之和 | readiness 与 admission 重查；有 READY 候选且耗尽时 Mission BLOCKED |
| `policy.budget.maxRuntimeMinutes` | 默认每次 Attempt 运行时长上限，**不是** Mission 总时长 | AgentFactory 采用 Task → Mission → 45 分钟；M2-08 RecoveryService 按 `attempt_bindings.created_at` + 绑定 AgentSpec 的 `budget.maxRuntimeMinutes` enforce；不映射到 `workerStart.timeoutMs` |
| `policy.budget.maxWallClockMinutes` | 可选正数；Mission 自第一次 `mission.status.after.status = EXECUTING` 审计起的总 wall-clock，含暂停/阻塞时间 | admission 按注入时钟重查；有 READY 候选且耗尽时 Mission BLOCKED |
| `policy.concurrencyLimit` | Mission 的 RUNNING Task 总数 | admission 事务内重查；满额只跳过，不 BLOCKED |
| `policy.routing.providerConcurrency` | provider → 正整数上限，默认 `{}` 表示未设 provider cap | RUNNING Tasks 的最新 seq binding JOIN AgentSpec.provider；事务内重查，满额只跳过 |
| `task.retryPolicy.maxAttempts` | 单 Task Attempt 次数上限，权威计数为 `task_stages.attempt_count` | readiness 与 admission 重查，admission 返回 task_attempts |
| 单 Task 总时长、token/成本总预算 | 需要 Attempt 结算数据 | M2 不 enforce；后续结算/预算服务接入 |

Mission 总 Attempts/wall-clock 耗尽通过既有 `blockMission(missionId, budget_exhausted)` 保留 `previous_status = EXECUTING`，同事务追加 `budget.exhausted {dimension, limit, used}`；Approval 请求对象留给 M4。并发满额、无可选 provider 与 Question/Approval 不视为预算耗尽。

每轮返回 admitted（有序身份）与 skipped（taskId/reason）；skip reason 为 concurrency、provider_concurrency、task_attempts、question、approval、no_eligible_provider 或 stale。只有本轮 admitted 非空或 Mission 被预算阻塞才写一条 `scheduler.round {trigger, admitted, skipped}`；空轮和全部跳过的轮不写此事件。构建合同可留下可复用的内容寻址行，这不等于 admission。每个新实例必须重新请求一轮（启动时的调度/未发出的 binding 恢复由 M2-08 接入）。


### Attempt launch（M2-05）

`axiom.mission.start` RPC 在同步 `startExecution` 事务前 await `ensureIntegrationBase`：先读 `refs/heads/axiom/integration/<missionId>`，不存在则读目标分支 HEAD 并 `git branch` 创建；存在则沿用 SHA，不 reset。`integration.base_created/base_reused` 记录 SHA。失败返回 `target_branch_not_found` / `integration_base_unavailable`，Mission 保持 PLANNED。按本 Task 的明确细化，M2 只验证存在，祖先关系与漂移检查在 M4 §12.3；Architecture §16.2 的旧 timeout 映射按下述 runtime-cap 规则解释。

启动顺序：读取已绑定 AgentSpec / ContextPackage render → 校验 Run/Task 与 prompt 大小 → 经现有 `createManagedWorktree` 从集成基线预创建 `axiom/attempt/<taskId>/<seq>`（不传 startupAgent）→ 直接调 `startLocalWorker` → CAS 回填 `attempt_bindings.dispatch_id` → audit / stage settlement。没有 `worktree_id` side-table 列；worktree id 写入启动 audit，读接口经 fleet 的 dispatch/workspace 读取。

只有显式配置 `routing.models[provider]`（AgentSpec 的 `model !== 'policy-default'`）时，launcher 才同时传 `model` 和 `reasoning.effort`；`reasoning.effort` 仅在此时生效。`policy-default` 时两者都省略，使用 provider 自身配置的模型与推理设置，避免内核拒绝 `--effort` 未配 `--model` 的组合。

`timeoutMs = resolveWorkerStartReadinessTimeoutMs(undefined)`（当前 60,000ms）只限制 readiness wait；Attempt runtime cap 由 M2-08 按 admission 的 `created_at` 和 bound spec 预算执行。`ready` 保持 RUNNING；`failed` 在尚有重试预算时转 NEEDS_FIX，否则 BLOCKED (`retry_budget_exhausted`)；`outcome_unknown` 保持 RUNNING，交 M2-08。dispatch 铸造前抛错时保留 NULL binding，记录经脱敏的失败 message，按同一重试规则转 stage。未绑定的读投影为 LAUNCH_PENDING；M2-08 负责该状态与 START_UNKNOWN 的恢复及 NEEDS_FIX → READY。

`axiom.attempt.show/list` 异步经 `inspectWorkerTerminal` 读取执行宿主的 liveness（`live/exited` 原样保留，其余状态 → `unverifiable`，可选 `livenessReason` 优先保留 reason、否则保留非 live/exited 的 status，无则 null），不用 fleet 的 agent-status 判定；state、workspace 与 worktreeId 继续取自 `projectFleetWorker`，NULL dispatch 的 liveness/livenessReason 仍为 null。


## 5. 合成 session party 与 Run 绑定（D14）

每个 Mission 铸造独立 `axiom-mission-<uuid v4>`，满足 `isOrcaSessionId`，不以 `term_` / `structworker_` 开头；持久化到 `missions.coordinator_orca_session_id`。`createRun` 参数为 `coordinatorHandle:null`、`coordinatorPaneKey:null`、该 session id。Mission 的 Run mailbox 为 `run:<runId>`。

这是进程内 Control Plane 身份，不是真实终端或 provider 会话；不能让终端声明该身份。重启复用持久绑定，绝不重新 `createRun`：同 session id 重建会解绑旧 Run、提升 `consumer_generation` 并驱逐旧消费者。`{kind:'system'}` 是 M2 dispatch creator 的内部权限，与合成 session party 的 Run 绑定是两个层次（Architecture §20 M1 行的 system principal 简写按 D14 理解）。

M1-01 契约证据见 `kernel-contract/*.test.ts` 与 [D14 spike](../review-evidence/axiom-m1/D14-session-party-spike.md)。M2-01 已在 `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts` 增加 service-only `controlPlane?: ControlPlaneWorkerStart`（类型在同目录 `control-plane-worker-start.ts`），首个实际调用者为 M2-05 `execution/attempt-launcher.ts`：六个 seam 字段的用法为 `dispatchCreator: {kind:'system'}`、精确的预创建 `worktreeId`、`branchNameOverride` 在此 bag 中省略（只传给预创建 worktree service）、ContextPackage 的 `preambleBuilder`、`dispatchMaxDepth: 1` 与 `callerIdentity`。同时填 `params.from = caller.address`，把同一合成身份作为 `coordinator` 和 `callerSession`，并传 Mission Task 为 `existingTask`。预创建 worktree 仅允许省略 `params.worktree` 或设为 `current`；branch / 所有权校验由 launcher 负责；深度 cap 取 runtime 与服务入参的较小值，preamble 在 cap 1 时不提示 sub-workers；null terminal handle 不作终端 lineage。省略 bag 保持原行为，文本替换沿用原有投递、turn observation 和失败路径。字段不进入 RPC schema，`workers.ts` 不传 bag，M1-07 对 Mission Run 的直接 `orchestration.workerStart` 拒绝保持不变（D10）；不得通过 RPC 参数自报 `caller:'control_plane'`。

## 6. RPC、envelope 与错误

M1 已注册 `axiom.mission.create/show/list/start/pause/resume/cancel`、`axiom.goal.propose/activate/show`、`axiom.plan.propose/approve/reject/list/show`、`axiom.task.list/show/cancel`；M2-02 已注册 `axiom.artifact.put/read/list`（put 参与 mutation fence/收据）；M2-05 已注册只读 `axiom.attempt.show {attemptId}` / `list {missionId, taskId?}`；返回 `attempt` / `attempts`（Glossary §4.6），未知 dispatch 返回 `attempt_not_found`，CLI 为 `axiom attempt show/list`。M0 的 `axiom.namespace.get` 保留。其他命名空间/方法在映射 §4c 标为后续。

`AXIOM_MUTATION_METHODS` → `isOrchestrationMutation` 同时接入契约栅栏与 durable mutation 收据。mutation envelope 必须带 `orchestrationContractVersion:1`，缺失/不匹配会被 `orchestration_migration_required` 拒绝；不要把版本字段放进 params。调用方按约定必须带 `orchestrationRequestId`；内核收到该字段时，以 caller fingerprint + id 查 `mutation_receipts`：同 payload 回放，异 payload 拒绝 `request_mismatch`。当前内核无 request id 时直接执行，不提供去重，调用方不得依赖它自动补幂等。

CLI `src/cli/runtime/client.ts` 为 `axiom.*` 打版本戳，为 durable mutation 默认生成 request id，`--retry-request` 沿用原 id；`axiom-client.ts` 为 renderer mutation 生成 id，不确定重试复用 id 与原 payload。Worker capability envelope 在 M2 接入，M1 CLI user commands 不冒充 Worker。runtime 公布 `axiom.control-plane.v1` capability。

CLI JSON 输出是 `{ ok, result, ... }` / `{ ok:false, error:{code,...}, ... }`；单对象 result 用 `mission` / `goalRevision` / `planRevision` / `task`，列表用 `missions` / `planRevisions` / `tasks`。MissionSummary 不包含 Run id；TaskListItem 的 `id` 是 Orca Task id，不是提案 id。

### Worker channel（M2-06a，D9 / D11 / D16）

已注册五个 mutation：`axiom.attempt.inform` / `request` / `blocked` / `handoff` / `request-subtask`。参数为 `{attemptId, from, senderPaneKey?, summary, body?, artifactIds?, related?, subtask?}`；只有 `request-subtask` 接受且必须带 `subtask`。严格 schema 不接受 `to`、自报 `type` 或 Mission/Task 身份。summary 与可选 body 各 ≤ 2,000 字符；较长内容先 `axiom mission artifact put`，再引用 Artifact id。`artifactIds` / `related.artifactId` 必须属于同 Mission，显式 `related.taskIds` 必须属于同 Mission，否则 `invalid_argument`，不写消息或审计。

`execution/attempt-authority.ts` 在写入前按以下顺序校验（六动词共用）：

1. dispatch 不存在 → `unknown_dispatch`；没有 `attempt_bindings` → `unknown_dispatch`。
2. dispatch 非 `dispatched` → `inactive_dispatch`。
3. 同 Task 存在更高 seq（包括尚未绑定 dispatch 的 admission）→ `stale_dispatch`。
4. 由 runtime 与 `orchestrationCallerIdentity` 解析 sender，调用内核 `verifyDispatchCapability`；缺失、错误、撤销的 capability 或 pane/process 不匹配 → `dispatch_capability_invalid`，保留内核 reason。
5. 内核 `hasLifecycleAuthority` 失败 → `sender_not_assignee`；外来 pane 会先返回 `dispatch_capability_invalid`，因为 `verifyDispatchCapability` 已在 `hasLifecycleAuthority` 之前强制校验 pane 等价性，`sender_not_assignee` 仅保留给缺少 `assignee_pane_key` 的 legacy row 的 handle 鉴权回退（仍须先通过 capability 校验）。
6. binding、Task、Mission、Run 关联不一致 → `task_dispatch_mismatch`。

CLI `axiom attempt <verb> --attempt <id> --dispatch-capability <token> --summary <text>` 支持 `--body` / `--body-file`（互斥）、可重复 `--artifact` / `--related-task`；子任务另需 `--title --objective --allowed-path --acceptance --evidence`，risk 默认 low。from 复用 `resolveOrchestrationTerminalHandle`（`--from` / `ORCA_TERMINAL_HANDLE`），pane metadata 来自 `ORCA_PANE_KEY`；runtime 自行解析 pane，不信任该参数授予权限。capability 放 envelope，mutation 复用 `callOrchestrationMutation` 与 `--retry-request <原 UUID>`。失败的新请求不留收据；已完成请求沿用内核回放语义，同 id + 同 params 不重复写入，改变 params → `request_mismatch`。

`axiom.attempt.check {attemptId, from, senderPaneKey?, wait?, timeoutMs?, type?}` 是 read，不进 mutation 集合；鉴权后调用 `checkWorkerMailbox` 读取 `dispatch:<attemptId>`。type 是内核路由类型（可逗号分隔），保留 delivery replay、generation fence 与长轮询。CLI 为等待显式加 10 秒 transport grace；不新增 ack 参数，返回内核 deliveryId 等证据。

`axiom.message.list {missionId, type?, taskId?, attemptId?, pendingOnly?}` 是 read，按 messages.sequence 从旧到新返回 `{messages:[{id,type,taskId,attemptId,summary,artifactIds,related,subtask?,createdAt,pending}]}`。读取 Mission Run 的全部严格 Axiom 载荷（包括投递副本），跳过普通/非法载荷；`REQUEST_SUBTASK` 在没有同 Mission、`objectKind: message`、`objectId: messageId` 的 `subtask.resolved` 审计时为 pending。M2-06b 写 resolution，本 Task 不创建 Task。

## 7. Admission 守卫（映射 §4b）

`mission-managed-run-guard.ts` 按 Run、Task、dispatch 查 Mission 归属，在对象解析后、首次写入前拒绝。非 Mission Run 保持原行为；未知对象保持原错误。以下路径在 M1-07 / M2-06a 落地：

| Orca 入口 | 守卫 / RPC 文件（`src/main/runtime/rpc/methods/` 下） |
|---|---|
| taskUpdate 修改 status | `assertNotMissionManaged`；`orchestration/messaging/message-methods.ts` |
| taskCreate（有/无 deps 均拒绝） | `assertTaskCreateAllowed`；同上，仅 Plan 批准物化 Mission Task |
| reset all/tasks/messages | `assertResetAllowed`；`orchestration/runs/reset-methods.ts`；数据库存在任一 Mission 即拒绝 |
| workerStart / dispatch | `assertNotMissionManaged`；`orchestration/worker/workers.ts`、`orchestration/runs/dispatch-methods.ts` |
| send worker_done / merge_ready / dispatch / decision_gate | `assertWorkerMessageAllowed`；`orchestration/messaging/send-methods.ts`；同步结算前拦截 |
| gateCreate / gateResolve | `assertNotMissionManaged`；`orchestration/gates/gates.ts` |
| runUse，包括 takeover-legacy | `assertNotMissionManaged`；`orchestration/runs/runs.ts`；bindRun 前拒绝 |
| run / runStop / coordinator-start | 保持退役；契约 fence / CLI dispatch-handlers 拒绝 |
| workerStop / workerAbandon（M2-06a） | `assertNotMissionManaged`；`orchestration/worker/worker-stop.ts` / `worker-control.ts`，首次 stop/abandon 前 |
| workerRelease / workerRetain / workerTerminalUserInput（M2-06a） | `orchestration/worker/worker-release.ts`；输入先解析 pane（含 session/handle），守卫查资源的 dispatch，覆盖已结算保留资源与 pane remint |
| ask（M2-06a） | `orchestration/messaging/ask-methods.ts`；activeDispatch 解析后，createQuestion 前；Worker ask 由 M2-06b 提供 |
| reply（M2-06a） | `orchestration/messaging/message-methods.ts`；原消息 run_id 与发送者 Run 两侧检查，markAsRead / answerQuestion 前 |
| send(group)，含 @all / @worktree（M2-06a） | `orchestration/messaging/send-methods.ts`；路由与发送者 Run 检查，sendGroupMessage 前 |
| workerStart --on（M2-06a 测试） | 沿用 `worker/workers.ts` 的 M1-07 守卫；测试证明 federation 前拒绝，无新增内核代码 |

M2-06a 的 `admission-worker-control.test.ts` 与 `admission-rpc.test.ts` 覆盖上述入口的 Mission/非 Mission 对照。Control Plane 后续 stop/abandon 调用走 service 边界；进程内 `caller: 'control_plane'` 不对 RPC params 开放。

完整测试为 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message}.test.ts`。task-update / worker-start 有三层拒绝：CLI 无终端身份时，`src/cli/handlers/orchestration/terminal-identity.ts` 的 `resolveCoordinatorTerminalHandle` 先抛 `no_active_sender_terminal`，尚未发送 mutation RPC；进入 runtime 后，Run 绑定解析可返回 `run_required` / `consumer_fenced`；到达 Mission 守卫后返回 `mission_managed`，由 M1-07 绑定 coordinator 的 RPC 测试覆盖。不能为取得某个错误码而给终端接管合成 Run。

## 8. Mailbox 与恢复

M2-05 启动审计：`attempt.started` / `attempt.launch_failed` / `attempt.start_unknown` 的 objectKind 为 attempt，绑定后 objectId = dispatchId，after 含 taskId/seq/branch/worktreeId/provider；绑定前失败的 objectId = taskId/seq，after 含脱敏 message。`integration.base_created` / `integration.base_reused` 的 objectKind 为 mission，after 含 sha。这些事件不代表 Submission、验证或完成。

M2-04：MissionController 在 startExecution 提交后触发 mission_start；resumeMission/unblockMission 提交后触发 resume；transitionTaskStage/cancelTask/recomputeReadiness 实际移动 stage 后触发 stage_change。recomputeReadiness 无变化不触发。嵌套事务（mailbox、RPC、admission）延至当前同步调用栈提交后才触发，并核对持久审计以抑制回滚事务的通知。control-plane.ts 以 fire-and-forget 调用 scheduleRound，拒绝仅 console.warn，不抛回生命周期调用者；manual 可由服务调用者显式请求。现有 RunMailboxConsumer 的 readiness 调用沿用此入口，无新增轮询。

`RunMailboxConsumer` 先注册 exclusive waiter 再 drain backlog，避免读空到订阅之间丢唤醒；waiter 的独占仅限进程。`getOrCreateRunDelivery` 与 `acknowledgeRunDelivery` 用启动时捕获的 generation 栅栏，不能重读并采用别人的新 generation。

一批消息在 store 事务内按 message id 查 `audit_events` 去重：普通载荷写 `mailbox.message`，合法同 Mission 的 `payload.axiom` 改写 `message.received`；两种事件共同作为去重依据。重算 readiness，成功后才 ack。语义是 at-least-once delivery + 幂等效果，不能先 ack 再处理。处理失败留下批次以供重放；仍采用固定退避 250ms、扫描 Mission audit 去重，消息量增长后需评估索引与有界 retry/escalation。`consumer_fenced` 写 `mailbox.consumer_fenced`，将 Mission BLOCKED 并停止消费者。

M2-06a `MessageRouter` 在 `store.transaction('message_route', …)` 内写 Control Plane 副本、下游副本与 `message.sent`（含 type/taskId/attemptId/recipients），并保存 mutation receipt；提交后向每个收件地址 `notifyMessageArrived`。Control Plane 地址必须为 `run:<runId>`：M1-08 的 `getOrCreateRunDelivery` 不消费 coordinator 的 `session:<id>` 直邮。INFORM/HANDOFF 默认只投 sender Task 的直接下游最新且 dispatched 的 Attempt；非空 `related.taskIds` 替换默认受众。REQUEST/BLOCKED/REQUEST_SUBTASK 只投 Control Plane；所有副本以 Control Plane 消息 id 为 threadId，从不使用群组地址。

`message.received.after = {type, taskId, attemptId, messageId}`；REQUEST_SUBTASK 在同事务另写 `subtask.requested.after = {...ids, subtask}`，作为 D50 step 1 的可查询待决项；BLOCKED 另写 `attempt.blocked_reported`。这三个事件的 objectKind 都是 message，objectId 是收到的消息 id，重放不重复记录。BLOCKED 只是 Worker 报告，在 M2 不改 Task stage 或 Attempt：Worker 仍可能运行，后续 RecoveryService / submit 才结算。

`startAxiomControlPlane` 在桌面 `src/main/startup/main-process-runtime-service.ts` 与 daemon `src/main/orcad/orcad-entry.ts` 接入。每次启动先 `RecoveryService.recover()`，再为 ANALYZING / PLAN_REVIEW / PLANNED / EXECUTING 启消费者；boot 幂等，quit 停止全部消费者。create/start/resume/unblock 同步启动，pause/block/cancel 停止；持久状态不依赖这些内存句柄。

恢复逐个检查非终态 Mission：Run 必须存在，合成 session id 必须有效且 `runBoundToCoordinator` 成立；否则 BLOCKED，记录一次 `recovery.run_binding_lost`，不悄悄重建 Run。正常恢复重算 readiness，**不会写 recovery 成功事件**；若 readiness 实际移动，仍按正常 Task 转换审计。

`reconcileAttempts()` 明确返回 `no_attempts_in_m1`。Architecture §16.1 的 Attempt liveness、队列重驱、Approval 过期与周期 reconciliation 是后续全量目标；M1 没有宣称这些已完成。`docs/plans/M1.md` 的早期 M1-01 笔记写过先 drain 后注册，实际 M1-08 实现与测试为先注册再 drain，以实现为本节事实来源。

## 9. 操作与后续里程碑

操作只经 CLI/RPC；不要手改数据库。先 `axiom repo add --path <repo> --json` 注册，再以返回的 `repo.id` 使用 `--repo id:<id>`。检查示例：

```sh
axiom mission list --json
axiom mission show --mission <missionId> --json
axiom mission goal show --mission <missionId> --goal <activeGoalRevisionId> --json
axiom plan list --mission <missionId> --json
axiom plan show --plan <planRevisionId> --json
axiom task list --mission <missionId> --json
axiom task show --task <taskId> --json
axiom attempt list --mission <missionId> --json
axiom attempt show --attempt <dispatchId> --json
```

`mission create --goal-file` 支持 Markdown（全文 objective，空 acceptanceCriteria）或 GoalBody JSON；`plan propose --file` 需要 PlanProposal JSON，fixture decomposition 必须先转换。`plan approve --plan <id> --resolver <actor>` 后再 `mission start`。UI 从 Mission list 选择，Refresh 或 mutation 后重读；选择的 Mission id 不跨重启持久化。

| 错误/诊断 | 含义与操作 |
|---|---|
| `no_active_sender_terminal` | CLI 没有终端身份，命令未到达 runtime；不是 Mission 损坏 |
| `mission_managed` | Orca 入口试图越过权威；改用相应 `axiom mission/plan/task` 动作。reset 不是取消；破坏性恢复需后续 Approval 路径 |
| `consumer_fenced` | caller/consumer 的绑定或 generation 已失效；CLI 拒绝不等于 Mission 损坏。若 Mission BLOCKED，检查 `mailbox.consumer_fenced` 及绑定证据，不抢占/重建 Run |
| `run_required` | Orca caller 没有可用 coordinator Run；仅传 `--run` 不能获得权限 |
| `run_binding_lost` | RecoveryService 诊断；关联审计 `recovery.run_binding_lost`，Mission BLOCKED，需保留证据后处理绑定，不把失联当成功恢复 |
| `plan_pending` | 已有 PROPOSED 计划；先查看并 approve/reject，不重发新计划 |
| `stale_state` | 预期源状态与数据库不符；重读当前对象再决定动作；不盲目覆盖 |
| `plan_invalid` / `illegal_transition` | 提案结构/DAG/Goal 关联无效，或转换不合法；看错误 data，修正输入 |
| `replan_not_supported` | M1 不能批准替代计划；Goal 在 EXECUTING 激活虽可进入 REPLANNING，完整替代闭环留给 M5 |
| `orchestration_migration_required` / `request_mismatch` | 契约 envelope 缺失/不兼容，或同幂等 id 换了载荷；升级兼容客户端或为新意图使用新 id |

后续边界按 Architecture §20 排序：M2-02/03/04 已提供 AgentSpec/ContextPackage、RulesEngine、Scheduler 与预算 admission；M2-05 已接 Attempt launcher/读接口；M2 后续增加 Planner、Worker 通道、Submission/Candidate；M3 加独立验证与 NEEDS_FIX；M4 加串行集成、Approval、Delivery/完成门及全对象恢复；M5 加完整 replanning 与可替换决策模型；M6 才覆盖远端扩展。

M2-06a 已补 §7 的 admission 入口；M2-06b 实现 ask/answer、D50 确定性检查、task.create 与 message.resolve；M2-07 实现 submit；M2-10 将待决项接入 Mission Home。出口 e2e 仍需覆盖 Attempt、submission 与 bound-coordinator `mission_managed` 路径；单元/RPC 证据不替代宿主验证。
