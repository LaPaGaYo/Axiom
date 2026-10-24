# Control Plane 子系统参考（M2 出口）

更新：2026-10-20 · 适用：截至 M2-12 / D59 已合入 main 的行为；M2-11 attempt 2 测试与证据索引见 [M2-exit-e2e.md](../review-evidence/axiom-m2/M2-exit-e2e.md)，本候选宿主结果待 verifier 填写。M1 历史证据见 [M1-exit-e2e.md](../review-evidence/axiom-m1/M1-exit-e2e.md)。
规范权威仍是 [Constitution](../PROJECT_CONSTITUTION.md) §1、ACCEPTED Decisions、[Glossary](../GLOSSARY.md) §4 与 [Architecture](../ARCHITECTURE.md)；本文定位实现，不新增权威或状态。

## 1. 用途与边界

Control Plane 决定并持久化 Mission、版本化 Goal/Plan、Task stage 与依赖 readiness；模型只提出建议，renderer 只展示投影。顶层对象与 RPC 使用 Mission / `axiom.*`（D1）。用户代码所在对象称 repository；Orca `Project` 仍是仓库/provider 身份类型。

M2 已提供 Planner 提案、人工审批、Scheduler admission、Worker 通道、Candidate/Submission 结算、Attempt 恢复与 UI 投影；M3-01 接入 VerificationService，Submission 后 Task 推进到 `VERIFYING`，M3-02 在独立 worktree 执行检查并结算 PASS / FAIL / INCONCLUSIVE。`mission start` 创建集成基线并经 Scheduler admission 启动 Worker；M1 出口测试通过禁止全部 provider 保留 Attempt-free 语义。它不是 LLM coordinator、第二个终端/worktree 管理器，也不复活退役的 `coordinator.ts`。

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
| `src/main/axiom/admission/` | `mission-managed-run-guard.ts` 阻止 Orca RPC 修改 Mission 对象；五组测试固定 §4b 拦截 |
| `src/main/axiom/recovery/` | `recovery-service.ts` 恢复非终态 Mission、检查绑定、重算 readiness；启动、60 秒周期与退出邮件触发 Attempt reconciliation（规则 a–h 见 §4）；`attempt-reconciliation.ts` / `planner-reconciliation.ts` 对账 Attempt；`agent-exit-observation.ts` 读取 D59 的宿主 shell 前台证明 |
| `src/main/axiom/control-plane.ts` | 按 `OrchestrationDb` WeakMap 缓存 store/controller/recovery/artifacts/contextBuilder/agentFactory/decisionEngine，维护进程内消费者取消句柄并接入生命周期 |
| `src/main/axiom/control-plane-boot.ts` | `startAxiomControlPlane` / `stopAxiomControlPlane`；启动恢复和退出停止 |
| `src/main/axiom/kernel-contract/` | M1-01 的 session party、Run/mailbox、Task 与 dispatch 身份契约测试；D14 的可执行依据 |
| `src/shared/axiom-contract/` | zod 对象/params/响应、`lifecycle.ts` 合法转换、`plan-proposal.ts` 与 `plan-task-graph.ts` 校验、`mutations.ts` 分类、`stage-labels.ts` 文案 |
| `src/main/runtime/rpc/methods/axiom/` | Mission/Goal/Plan/Task/Artifact/Policy/Attempt/Message 方法；`../axiom.ts` 聚合到 `ALL_RPC_METHODS` |
| `src/cli/specs/axiom-*.ts` + `src/cli/handlers/axiom/` | `mission`（含 plan/goal/artifact/policy）、`plan`、`task`、`attempt`、`message` CLI；`input-files.ts` 解析 Goal / Plan，`rpc-command.ts` 调用与输出 |
| `src/renderer/src/components/missions/` + `src/renderer/src/lib/axiom-client.ts` | Mission list/Home、Plan 审批、Task 表与 Task Detail（Attempt、Submission、typed timeline）；共享 schema 校验与 mutation envelope；刷新后以服务端状态对账 |

新增逻辑不能进入 `@ts-nocheck` 的 runtime 文件（D12）；D59 明确授权的例外仅为完全标注类型的进程内转发访问器 `confirmTerminalShellForeground`，恢复决策仍在强类型 Control Plane 模块内。扩展 RPC 仍遵循 [orca-mapping](orca-mapping.md) §4c 的五步注册与 catalog 检查。

## 3. 持久数据：17 张 side table

权威数据库为 `<userData>/orchestration.db`。M1-03 的 `src/main/runtime/orchestration/db/schema/create-axiom-tables-sql.ts` / `migrate-v43.ts` 建全 17 张表；M1 的业务 store 使用下表前七张。已有表不改 CHECK 枚举，未来只做 additive migration。

| 表 | 内容 / M2 出口使用情况 |
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
| `submissions` | M2-07 store 已接入：完整严格 report JSON 与检查/限制/后续投影；dispatch_id UNIQUE，不提供更新方法 |
| `candidates` | M2-07 store 已接入：Control Plane 固定 commit/tree；ACTIVE → SUPERSEDED + superseded_by；Task/commit 唯一 |
| `artifacts` | M2-02 已写/读：Mission、kind、sha256、size、media type、related ids、createdBy；内容只存 `<userData>/axiom/artifacts/<sha256>` |
| `decisions` | M2-02 `listDecisions({ missionId, status })` 只读；ContextBuilder 包含 ACCEPTED 的 title/resolution；Decision service/RPC 写入者仍待后续 |
| `verification_runs` | M2-07 入 QUEUED；M3-01 事务领取、独立 worktree 准备与重启重排队；v45 保存 runtime_epoch、claim_count、worktree_id、started_at、finished_at |
| `integration_batches` | 表已建；M4 串行集成使用 |
| `approvals` | 表已建；M4 ApprovalGateway 使用，不复用 decision gate |

Milestone 存在 Plan JSON 内，没有独立表/状态机。Attempt 身份仍等于 Orca dispatch id，不存在 Axiom Attempt 表。M2-02 启用 Artifact/ContextPackage 写入和 Decision 读取；M2-03 启用 AgentSpec 写入和 policy routing 更新；M2-04 启用 attempt_bindings 写入与阻塞 Approval/Question 读取；M2-07 接入 Candidate/Submission/VerificationRun store 与结算写入；其余后续表目前只有建表和清理支持，不能把表存在当成产品能力已完成。

`create-tables.ts` 每次打开执行幂等 DDL，`SCHEMA_VERSION=44`；9 个查询索引、3 个删除触发器沿用 additive 模式。Task 删除清理 stage/边/binding，dispatch 删除仅清空 binding 的 dispatch 引用，Run 删除清理所属 Mission side rows。没有声明外键；v44 仅为 agent_specs.spec 与 mission_policies.routing 加列（TEXT NOT NULL DEFAULT '{}'），hasColumn 防止重复 ALTER，版本化探针从 v44 起检查这两列，v43 与更高版本降级路径保持透明。详细列见映射 §6。

所有 store 读取先用 zod 解析，不把 SQLite 行强制断言为领域对象。写入由 `runLifecycleWriteTransaction` 包裹，嵌套 savepoint 使 Run 创建和 Mission 创建能一起回滚；审计与状态同事务提交。

### ContextPackage（M2-02）

`plane.artifacts` 与 `plane.contextBuilder` 已由 Scheduler、launcher、submit 服务复用。Artifact id = `art_` + sha256(canonical `{missionId,kind,sha256}`)；相同 Mission/kind/bytes 返回既有元数据（首次 related/createdBy 不被重写），跨 kind/Mission 共用内容文件。先写 `.tmp-<random>` 再 rename；read 重新检查 hash/size，缺文件或不匹配返回 `artifact_corrupt`。put 上限 8 MiB；RPC 用 `contentBase64`，CLI `mission artifact put --mission … --kind … --file … --related …` 在本机读文件。read 的 `--json` 保留 base64，文本输出按 UTF-8；list 支持 kind 和单一 related id。

ContextBuilder 固定强制顺序：(1) Task spec；(2) PlanRevision revision/milestone/带邻居标题的入出边；(3) ACCEPTED Decisions；(4) 权限、Mission/Task 预算、并发、重试与 `axiom-submission-v1` 字段清单；(5) 目标分支的 AGENTS.md/CLAUDE.md，各最多 16 KiB（缺文件省略，读失败不静默忽略）；(6) policy 验证命令；(7) `none (first attempt)`，M3 补失败证据。只读这两个规则文件，不读工作区版本或 `.env*`。

预算按 `ceil(UTF-8 bytes / 4)` 估计，调用参数优先，其次已解析 policy.budget 的可选正整数 `contextTokens`，否则 24,000。M2-03 已加入共享 BudgetSchema，可在 mission create RPC 的 policy 中设置；后续预算修改仍需 M4 Approval。协议块计入第 4 节的 hash/token 数。强制集永不裁剪，超限设 `budgetExceededByMandatory: true`；候选按既有入边查询顺序（from_task_id）、再 created_at/id，去重后取直接上游的 handoff/worker_report，第一项放不下即停止，余项记 budget。

规则与候选在纳入前脱敏：PRIVATE KEY 块、指定 provider token 前缀（兼容 hyphen/underscore）和 AKIA key 替换为 `[REDACTED]`；规则先脱敏再截断。候选的敏感部分在 omitted 中以 redacted 记录，安全替换文本仍可纳入；section header 标记 redacted。manifest ranked hash 绑定脱敏后的正文；强制 hash 绑定渲染节（第 4 节另含协议）。

canonical manifest 无空白、对象键序固定，保留数组顺序，id = `ctx_` + sha256(canonical)。manifest 与完整 render template 均作为 Artifact 持久化，context row 只保留 JSON manifest/hash/引用。相同输入重复 build 不新增行或文件。模板最后的 `Axiom Worker protocol` 使用 D16 八个 `axiom attempt` verb；launcher 在交付时替换 `{{attemptId}}`；D73 之后模板不含任何凭据（身份由宿主核实）。

M2 之后：M3 将失败验证证据纳入重试 ContextPackage；DEF-4/5 的 skills 与代码知识输入按登记触发点复审。

### Provider selection（M2-03）

AgentFactory.build 接受 worker 的 missionId/taskId/contextPackageId，或 planner 的 missionId/goalRevisionId；引用必须存在且归属匹配。ContextPackage 是输入，不由 Factory 创建。主机安装集合由注入的 listInstalledProviders 提供，Control Plane 注入 detectInstalledAgentsWithShellPathHydration；此处不新增认证探测或网络调用。

执行身份由 provider（harness）、model 与 endpointProfile 组成。D57 的允许清单在 `src/main/axiom/agent-factory/certified-providers.ts` 的 `CERTIFIED_PROVIDER_COMBOS`；V1 只有下列四个组合，`endpointProfile` 均为 `subscription`（用户在 harness 中已有的登录或自行配置），不存储凭据。当前状态均为 `provisional`：D57 的 2026-10-20 修订记录真实 Codex smoke 未产出提案（目录信任阻塞）；D58 已 ACCEPTED（B structured/app-server 首选、A exec 后备），真实 provider 认证仍待通道实施与权限映射。D49 测试通过不认证真实组合；后续逐组合补宿主 evidence，证明收到 preamble → `axiom attempt inform` → 产出候选 → 合法 `axiom attempt submit`，再改为 `certified`；V1 出口前所有用到的组合必须完成认证。

| Provider | 模型选择方式 | Tier | 角色 | 最高风险 |
|---|---|---|---|---|
| claude | launch-arg | A | planner、worker | high |
| codex | launch-arg | A | planner、worker | high |
| antigravity | launch-arg | B | worker | medium |
| opencode | harness-default | B | worker | low |

先按 TUI_AGENT_CONFIG 的顺序规范安装集合，排除 claude-agent-teams（Claude launch mode）。只检查矩阵内或已安装的 harness，按首个命中原因过滤：`not_installed`（矩阵内但未安装）→ `not_certified`（已安装但不在矩阵）→ `disallowed`（routing.disallowedProviders）→ `tier_too_low`（角色不在组合 roles、风险超过 maxRisk，或 highRiskTier=A 时高风险选择了非 A）。Planner 的筛选风险固定为 high；A 级仍由 structured-session enum 的 codex、claude 定义。filtered 按上述原因顺序排列，同原因保持配置顺序；未安装且未登记的 harness 不进入 filtered。无候选返回 no_eligible_provider，附 installed/filtered，无 spec 或 audit 写入。

RulesEngine 只对过滤后的闭集排序：preferredProviders 首次匹配得分 100 − index，然后 A 在 B 前，同分保持配置顺序。preferredProviders / disallowedProviders 只在矩阵范围内生效，偏好不能放行未认证的 harness（包括 gemini、continue）。所有 verb 都从输入集合取结果，Factory 再检查返回值是 eligible 集合的完整排列。model = routing.models[provider] 或 policy-default；OpenCode 使用 harness 自身默认模型，V1 不新增模型配置物化。每份 AgentSpec 固定 endpointProfile=subscription；Worker 高风险 effort=high，否则 medium，Planner 保持 medium。selection 持久化 installed/filtered/ranked/chosen/rationale，并写入 agent_spec.created 审计；ranked 是后续 fallback 顺序。

AgentSpec 的预算只含本次 Attempt 的 maxRuntimeMinutes（Task → Mission → 45）与可选 maxTokens（Task → Mission），不含 maxAttempts。worker 复制验收标准、scope.allowedPaths 写权限和首段路径去重排序后的 capabilities；planner 固定 planning、空写权限与 planner-worktree。规范 JSON 按 schema 键序生成并 sha256 寻址；INSERT OR IGNORE 只在插入时追加 agent_spec.created，两者同一事务。Factory 不改 Task stage、readiness、权限许可或 attempt_bindings，不创建 worktree、不启动 Worker。

axiom.policy.show/update 及 CLI `axiom mission policy show --mission <id> --json` / `update --mission <id> [--routing-file <json>] [--concurrency <n>] --json` 已注册。M2 patch 仅应用 routing（整体替换，省略字段使用默认值）与 concurrencyLimit；budget 键在 handler 的写入前检查中一律返回 approval_required（M4），其他未知键返回 invalid_argument。更新经现有 mutation fence/receipts，policy 与 policy.updated（before/after）同一事务持久化。

M2 之后：落实 D58 的执行通道与权限映射后补真实组合认证；M3 使用独立验证证据，不把 provisional 等同已认证。

## 4. 状态机与 readiness

完整枚举/转换见 Glossary §4、Architecture §6；代码源为 `lifecycle.ts`。M2 已合入的路径：

```text
Mission: create → ANALYZING → propose → PLAN_REVIEW → approve → PLANNED → start → EXECUTING
                          ← reject ←
Goal: 用户输入创建即 ACTIVE；后续 PROPOSED → ACTIVE，旧 ACTIVE → SUPERSEDED
Plan: PROPOSED → APPROVED 或 REJECTED
Task: approve → DEFINED；start → READY；admission → RUNNING；submit → SUBMITTED
      无 Submission 的失败 → NEEDS_FIX → READY（重试）或 BLOCKED（耗尽）；可授权 CANCELED
```

合法转换表包含未来阶段；M2 已推进 RUNNING / SUBMITTED，尚不执行独立验证、集成或 Mission 完成。Orca `completed` 仅指当前 Attempt 已结算，不能显示为 Task 完成；UI 只有 INTEGRATED 计入进度。

暂停/阻塞前的 Mission 状态保存在 `missions.previous_status`；resume 只用于 PAUSED，内部 unblock 用于 BLOCKED，恢复目标必须等于该字段。嵌套 PAUSED/BLOCKED 经持久 `mission.status` 审计回放恢复更早返回点。Task 进入 BLOCKED 保存 `task_stages.previous_stage`，解除时只能返回该 stage（或取消），不能任意跳跃。条件更新不命中时抛 `stale_state`。

M2 仍仅允许首个 Plan 批准；替代计划批准属于 M5。`plan-materialization.ts` 校验共享 schema、唯一 id、合法 milestone、端点、重复边、自环与 DAG 后，将提案 `T01` 等 id 映射为新 Orca Task id；Task 创建 `deps=[]`，Orca 投影即 `ready`，Axiom stage 为 DEFINED。批准后 Mission 为 PLANNED，此时不会 READY；必须 `mission start`。

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
| `policy.budget.maxAttempts` | Mission 总 Attempt 数 = 全部 Task `attempt_count` 之和 + Planner bindings 数量 | readiness 与 admission 重查；有 READY 候选且耗尽时 Mission BLOCKED |
| `policy.budget.maxRuntimeMinutes` | 默认每次 Attempt 运行时长上限，**不是** Mission 总时长 | AgentFactory 采用 Task → Mission → 45 分钟；M2-08 RecoveryService 按 `attempt_bindings.created_at` + Task spec / Mission policy 的 runtime cap enforce（两者均无 cap 时不限，不采用 Factory 的 45 分钟默认值）；不映射到 `workerStart.timeoutMs` |
| `policy.budget.maxWallClockMinutes` | 可选正数；Mission 自第一次 `mission.status.after.status = EXECUTING` 审计起的总 wall-clock，含暂停/阻塞时间 | admission 按注入时钟重查；有 READY 候选且耗尽时 Mission BLOCKED |
| `policy.concurrencyLimit` | Mission 的 RUNNING Task 总数 | admission 事务内重查；满额只跳过，不 BLOCKED |
| `policy.routing.providerConcurrency` | provider → 正整数上限，默认 `{}` 表示未设 provider cap | RUNNING Tasks 的最新 seq binding JOIN AgentSpec.provider；事务内重查，满额只跳过 |
| `task.retryPolicy.maxAttempts` | 单 Task Attempt 次数上限，权威计数为 `task_stages.attempt_count` | readiness 与 admission 重查，admission 返回 task_attempts |
| 单 Task 总时长、token/成本总预算 | 需要 Attempt 结算数据 | M2 不 enforce；后续结算/预算服务接入 |

Mission 总 Attempts/wall-clock 耗尽通过既有 `blockMission(missionId, budget_exhausted)` 保留 `previous_status = EXECUTING`，同事务追加 `budget.exhausted {dimension, limit, used}`；Approval 请求对象留给 M4。并发满额、无可选 provider 与 Question/Approval 不视为预算耗尽。

每轮返回 admitted（有序身份）与 skipped（taskId/reason）；skip reason 为 concurrency、provider_concurrency、task_attempts、question、approval、no_eligible_provider 或 stale。只有本轮 admitted 非空或 Mission 被预算阻塞才写一条 `scheduler.round {trigger, admitted, skipped}`；空轮和全部跳过的轮不写此事件。构建合同可留下可复用的内容寻址行，这不等于 admission。M2-12 / D59 在 boot recover 与消费者同步后，对每个 EXECUTING 且未因 Run 绑定丢失而 blocked 的 Mission 显式请求一轮 resume，覆盖已持久化 READY、readiness 没有变化的情形；没有 READY 时仍不写 scheduler.round。未发出的 binding 由 M2-08 orphan 规则结算，不重复使用旧 seq。


M2 之后：M3 的验证结算接入既有调度触发；M4 接预算 Approval，token/成本总预算仍未 enforce。

### Attempt launch（M2-05）

`axiom.mission.start` RPC 在同步 `startExecution` 事务前 await `ensureIntegrationBase`：先读 `refs/heads/axiom/integration/<missionId>`，不存在则读目标分支 HEAD 并 `git branch` 创建；存在则沿用 SHA，不 reset。`integration.base_created/base_reused` 记录 SHA。失败返回 `target_branch_not_found` / `integration_base_unavailable`，Mission 保持 PLANNED。按本 Task 的明确细化，M2 只验证存在，祖先关系与漂移检查在 M4 §12.3；Architecture §16.2 的旧 timeout 映射按下述 runtime-cap 规则解释。

启动顺序：读取已绑定 AgentSpec / ContextPackage render → 校验 Run/Task 与 prompt 大小 → 经现有 `createManagedWorktree` 从集成基线预创建 `axiom/attempt/<taskId>/<seq>`（不传 startupAgent）→ 直接调 `startLocalWorker` → CAS 回填 `attempt_bindings.dispatch_id` → audit / stage settlement。没有 `worktree_id` side-table 列；worktree id 写入启动 audit，读接口经 fleet 的 dispatch/workspace 读取。

只有显式配置 `routing.models[provider]`（AgentSpec 的 `model !== 'policy-default'`）时，launcher 才同时传 `model` 和 `reasoning.effort`；`reasoning.effort` 仅在此时生效。`policy-default` 时两者都省略，使用 provider 自身配置的模型与推理设置，避免内核拒绝 `--effort` 未配 `--model` 的组合。

`timeoutMs = resolveWorkerStartReadinessTimeoutMs(undefined)`（当前 60,000ms）只限制 readiness wait；Attempt runtime cap 由 M2-08 按 admission 的 `created_at` 和 Task spec / Mission policy 预算执行。`ready` 保持 RUNNING；`failed` 经 M2-08 的共享 settlement 走 RUNNING → NEEDS_FIX → READY；预算耗尽则 NEEDS_FIX → BLOCKED (`retry_budget_exhausted`)；`outcome_unknown` 保持 RUNNING，交 M2-08。dispatch 铸造前抛错时保留 NULL binding，记录经脱敏的失败 message，按同一重试规则转 stage。未绑定的读投影为 LAUNCH_PENDING；M2-08 已接入该状态与 START_UNKNOWN 的恢复及 NEEDS_FIX → READY。

`axiom.attempt.show/list` 异步经 `inspectWorkerTerminal` 读取执行宿主的 liveness（`live/exited` 原样保留，其余状态 → `unverifiable`，可选 `livenessReason` 优先保留 reason、否则保留非 live/exited 的 status，无则 null），不用 fleet 的 agent-status 判定；state、workspace 与 worktreeId 继续取自 `projectFleetWorker`，NULL dispatch 的 liveness/livenessReason 仍为 null。

M2-10 的 `AttemptSummary.role` 为绑定 AgentSpec 的 `spec.role`（`planner | worker`；spec 缺失时回退 `worker`），renderer 不解析 branch 前缀。可选 `submission` 通过 `getSubmissionByDispatch(dispatchId)` 与 `getCandidate(candidateId)` 联合投影，包含 `id / candidateId / commitSha / treeSha / filesChanged / checksRun / limitations / risks / followUps / createdAt`；无 Submission 时省略。Candidate 丢失是读取错误，不伪造 hash 或隐藏已提交证据。读取不改变状态，检查结果只是 Worker 报告，独立 Verification 仍由 M3 提供。


M2-06b：pending question_threads 通过 attempt_bindings 关联 Task；`blockingQuestionOrApproval` 使该 Task 无法 admission 新 Attempt。回答后 pending 消失并重算 readiness；当前 Attempt 仍 RUNNING，问题不改变其执行状态。超时或取消等待不自动关闭问题；结算由内核 closeQuestionsForDispatch 关闭。

M2 之后：D58 补 AgentSpec 到 harness 权限的确定性映射与真实启动证据；M3 消费不可变 Candidate。

### Planner（M2-09）

`axiom.mission.plan` / `axiom mission plan --mission <id> [--json]` 在 ANALYZING 启动一个 Planner。前置检查：Mission 存在、ACTIVE Goal 已绑定、没有 PROPOSED Plan、没有 dispatched 或 starting/ready/start_unknown/stopping/stop_unknown 的 Planner、Mission 总 Attempt 预算未耗尽、D57 有合格的 planner combo。失败不推进 Mission；无候选返回 `no_eligible_provider`，RPC error data 保留 filtered。Mission 不存在、已有提案、状态不符分别返回 `mission_not_found`、`plan_pending`、`illegal_transition`；已有活跃 Planner 返回带说明的 `invalid_argument`。并发启动在构建前与 admission 事务内都检查；尚未结束的 NULL dispatch binding 同样阻止重复启动。

`axiom.mission.plan` 因等待 Agent readiness，在本地 transport 上作为带 keepalive 的 long-poll 处理，CLI handler 已使用 120 s timeout。

`execution/planner-launcher.ts` 负责前置检查与 admission，实际 worktree + `startLocalWorker` 顺序复用 `createAttemptLauncher`，没有第二份启动序列、内核 manager 或 provider。AgentFactory 使用 `role: planner`、planning capability、`permissions.write=[]`、planner-worktree 与现有 model/effort 规则。基线 ref `axiom/integration/<missionId>` 存在则沿用，否则从 Mission targetBranch 创建；本入口不创建或推进集成基线。worktree 名为 `planner-<missionId>-<n>`，branch 为 `axiom/planner/<missionId>/<n>`。

每次规划创建一个 Orca pseudo-task：`spec={kind:'planner',missionId,goalRevisionId,seq:n}`、title=Planner、deps=[]、runId=Mission Run。它只有内核执行历史，**没有 task_stages 行**，不进入 DAG/readiness，也不出现在 `axiom task list`。每个 pseudo-task 只有一次 Attempt，binding.seq=1；branch 中的 n 为 Mission planner binding 数量 + 1。`listPlannerBindings(missionId)` 以 branch 前缀查询，运行时角色由绑定的 AgentSpec.role 确认，无新列。Planner 不占 Task 并发，但计入 Mission budget.maxAttempts；Worker readiness、admission 和子任务预算使用相同计数。

ContextBuilder 的 planner 形式为 `{missionId,role:'planner',goalRevisionId}`（launcher 另传本次基线 repositoryRef）。渲染顺序固定为：

1. Active GoalRevision id、objective、constraints、acceptanceCriteria。
2. 仓库规则，沿用 Worker 的 `readRepositoryRules`，读取本次基线的根 AGENTS.md / CLAUDE.md，分别脱敏并限制为 16 KiB，缺失省略。
3. `z.toJSONSchema(PlanProposalSchema.omit({provenance:true}))` 生成的 JSON Schema，以及唯一 Task id、合法边端点、默认 INTEGRATED、无环、至少一个 root、合法 milestoneId、kind/risk/maxAttempts 与可选 role 标签规则。
4. 两个 Task、一条边的最小示例。
5. `axiom plan propose --mission <id> --attempt {{attemptId}} --file <proposal.json> --json` 配方，要求 worktree 保持 clean，并明确将 proposal JSON 写到 worktree 外。

Planner 无 PlanRevision，因此只持久化 `context_package_manifest` 与 `context_package_render` 两个内容寻址 Artifacts，**不插入 context_packages**（其 plan_revision_id 为 NOT NULL）。binding.contextPackageId 为 render Artifact 的 `art_…` id；launcher 用 `artifacts.read` 取模板。preamble 由 preambleBuilder 交付时只替换 `{{attemptId}}`，D73 之后不含任何凭据。Planner dispatch 在该回调交付 preamble 前绑定，以支持快速 provider 在 readiness receipt 返回前提交。

`axiom.plan.propose` 的 planner 形式通过同一 Attempt 身份链（D73：宿主核实的 worker 身份 / assignee / 进程代次）鉴权，但显式要求 planner AgentSpec、同 Mission/Goal/Run 的 pseudo-task 与 planner branch；Worker 通道仍要求真实 Task stage。提交前对记录的 worker.worktree_id 执行 `git status --porcelain`，非空返回 `planner_worktree_dirty`（data.files 为 porcelain 文件列表，错误消息同时列出文件供 CLI 显示）并写 planner.rejected，Plan/Mission 不变；缺少 worktree 路径返回 `planner_worktree_missing`。Git IO 后再次鉴权。干净提案经原 `missions.proposePlan` 完成 ANALYZING → PLAN_REVIEW；provenance 由服务写为 `{kind:'planner',actor:provider,model?:explicitModel,at}`（遵循 M2-09 brief 与现行 ProvenanceSchema；D48 旧文的 model kind 不作为新增枚举）。

Plan 与 planner.proposed 的 Attempt 归属、mutation receipt 在同一外层事务提交，防止结算与停止之间崩溃丢失归属。提交后立即返回收据，通过 `setTimeout(..., PLANNER_STOP_GRACE_MS).unref()` 延迟 2,000ms 调用现有 `stopLocalWorker` / `releaseLocalWorker`，让 CLI 先收到响应再关闭其进程树；定时停止写 planner.stopped，记录 stop state 与 releaseDisposition。定时回调的异常只记录 Mission / dispatch 身份，stop_unknown 或资源维护失败交恢复处理，不回滚提案；宽限期内崩溃丢失定时器时，下一轮 Recovery 根据持久的 planner.proposed 补 stop/release。只读权限是合同约束；CLI Agent 没有运行时 filesystem write-scope 强制，G2 在 propose 时拒绝脏工作树，不自动清理文件或提交。

Recovery 扫描所有 planner bindings：未提案的 terminal worker 或确定 exited → planner.attempt_failed（去重），active exited 先 failDispatch，再请求 release；unverifiable / stop_unknown 沿用持久 liveness facet 时钟，容忍期后 abandon + planner.abandoned 与证据，再请求 release；live 超过 Mission policy.budget.maxRuntimeMinutes 时停止；已提案但未停止的 live Planner 补 stop/release。无 dispatch 的 orphan 经两倍 readiness window 留失败审计。以上不改变 Mission status；Mission cancel 沿用原 rule h，涵盖没有 stage 的 Planner。

审计事件：`planner.started / planner.launch_failed / planner.start_unknown`（missionId、goalRevisionId、seq、branch、worktreeId、provider）；`planner.proposed`（attemptId、planRevisionId、taskCount、edgeCount、rootCount）；`planner.rejected`（reason、files）；`planner.stopped`（state、releaseDisposition）；`planner.attempt_failed / planner.abandoned`（reason、放弃证据）。绑定后的 objectKind=attempt、objectId=dispatchId，绑定前失败以 pseudo-task id/seq 标识。

`TaskSpec.role?: string` 仅为 DEF-4 的非空标签，提案/批准/Task spec 原样保留；Task JSON 投影附带 spec。没有 skills 物化、CodeGraph（DEF-5）或 DEF-10 ①②③。

M2 之后：D58 解决真实 Planner 通道/目录信任与权限映射；M3 复审 DEF-4/5，Planner v2 与 replanning 留 M5。

### Recovery（M2-08）

`RecoveryService.recover()` 保留同步 Mission report；独立的 `async reconcileAttempts({missionId?})` 处理 Attempt。每次重新读取 binding、Task stage、worker/dispatch 与执行宿主观测；仅保存进行中的 Promise，重叠调用等待前一轮后重读持久状态。扫描非终态 Task 的 bindings，加上仍活跃的 kernel worker 对应 binding；CANCELED Task 的已结算资源也重查，补齐 kernel commit 与 release/audit 之间的崩溃窗口。旧 seq 不得结算最新 RUNNING admission。

启动时在 recover 后执行一次，每 60,000ms 执行一次（unref timer，stop 时清除）；消费者成功处理并 ack 含同 Mission bound dispatchId 的 kernel escalation 批次后再触发一轮。正常无变化的 tick 不写 audit。失败只记录身份到 console.warn，其他 Attempt 仍继续对账，报告 action=reconcile_failed，不能当作成功结算。

| 规则 | 读取与 kernel 操作 | 审计 / Axiom stage |
|---|---|---|
| a | starting/stopping 的 runtime_epoch 不同于当前 runtime：先 markWorkerStartUnknown / markWorkerStopUnknown，再 inspectWorkerTerminal | 保持 Task；后续按实际宿主 liveness 处置 |
| b | RUNNING、worker failed/stopped/abandoned、无 Submission | 共享 settlement；failed 且无既有 attempt.failed 时，在同一 recovery_terminal 事务内先补 attempt.failed{reason: kernel_failed, lastError: worker.last_error ?? null}，再 settlement；重复 tick 不追加。放弃已提交而 Axiom consequence 未提交时，从关联 evidence Artifact 补回 attempt.abandoned；stopped / abandoned 其余行为不变，kernel-first stop 的补审计不在本次范围 |
| c | RUNNING、活跃 worker（stop_unknown 除外）、宿主明确 exited：failDispatch(workerProcessExited=true, terminationReason=process_exited) | attempt.failed{reason: process_exited} → RUNNING → NEEDS_FIX → READY/BLOCKED |
| c′（D59；M2-12 attempt 2 修正证明来源） | inspectWorkerTerminal.status=live、exact=true、terminal 非 null（PTY 通道）、worker.state=ready（preamble readiness 已结算），且 confirmTerminalShellForeground(terminal.handle) 返回 true：执行宿主的新鲜前台进程名是 shell（isShellProcess），经 controller.confirmForegroundProcess 读取，方法缺失时回退 getForegroundProcess。每 tick 一次新证明，不缓存、不计数；SSH 返回 null（访问器返回 false）、structured 无 terminal，均不适用 | 对账 entry.liveness 折叠为 exited，沿用 c 的 failDispatch 与重试，attempt.failed{reason: process_exited, evidence: shell_foreground}；last_error 为 Worker agent exited without a Submission。Planner 无提案时同样 fail/release，planner.attempt_failed{reason: no_proposal, evidence: shell_foreground}，沿用该次证明、不重探测，后续 tick 保留该审计 |
| d | live、未命中 c′ 且非 stop_unknown：通常不动；now-createdAt 大于 Task spec.budget.maxRuntimeMinutes（无则 policy.budget.maxRuntimeMinutes，无 cap 不限）时 stopLocalWorker | stopped：attempt.stopped + settlement(runtime_budget_exceeded)；stop_unknown：只在首次停止结果写 attempt.stop_unknown，保持 RUNNING；下一 tick 无论宿主观测如何均走 e |
| e | unverifiable 或 worker stop_unknown：写 liveness facet 的变化；stop_unknown 固定记 `{status: unverifiable, reason: stop_unknown}`；到 unverifiableToleranceMinutes 后先 put evidence，再 abandonWorkerDispatch | attempt.unverifiable；超时 attempt.abandoned（含 evidenceArtifactId、disposition）+ settlement(unverifiable_tolerance_exceeded)；等待期间不重复 stop、不启动新 Attempt |
| f | RUNNING、最新 binding.dispatchId=null，超过两倍默认 readiness timeout（当前 120,000ms） | attempt.launch_pending_orphan + settlement；较新 pending 不动 |
| g | 有持久 Submission 且 terminal resource.release_state=not_requested：retainWorkerTerminalResource；M3-01 领取后 Task 已 VERIFYING 仍补 retain | attempt.terminal_retained / attempt.terminal_retain_failed，沿用 M2-07 的 taskId/submissionId/candidateId/retainDisposition；不改变 stage |
| h | Task CANCELED 或 Mission 终态：stop_unknown 无论宿主观测如何均 abandonWorkerDispatch；其他活跃且 live/exact 用 stopLocalWorker（start_unknown 仍可 stop），否则 abandonWorkerDispatch；结算后 releaseLocalWorker | attempt.stopped / attempt.abandoned，reason=mission_canceled；从 stop_unknown 放弃时另记 priorStop=stop_unknown 与放弃时折叠的 liveness；after.release 保留 requested completion / retained / already_released 真实收据；stage 不再变；已提交 Candidate 不提前释放 |

基础 liveness 与 `axiom.attempt.show/list` 共用 `foldAttemptLiveness`：live/exited 原样，unattached/missing/identity_changed/unverifiable → unverifiable。c′ 只在 Recovery 折叠额外的执行宿主证明；不改 `inspectWorkerTerminal`、`foldAttemptLiveness`、show/list 或 fleet 投影，不以 title、hook、Agent activity 推断死亡。`starting / start_unknown / stopping / stop_unknown` 与终态 worker 不满足 c′ 的 ready 条件。访问器仅在主进程内读取 controller `confirmForegroundProcess`：daemon 请求经 `Session.confirmForegroundProcess()` 到 `foreground-process-tracker.confirmForegroundProcess`，用 `resolveAgentForegroundProcessWithAvailability(fresh)` 新鲜解析进程表，node-pty 的前台进程名作 fallback；controller 没有该方法时才用 `getForegroundProcess`。结果必须为非空字符串，去除首尾空白与 login-shell 名的前导 `-` 后由 `isShellProcess` 判为 shell；null、非 shell、无 live PTY、无 controller、异常或超过 `PTY_CONTROLLER_LIST_TIMEOUT_MS` 均返回 false，不用旧结果补证明。daemon 的 `confirmShellForeground` 回答 recovery barrier 的 settled owner（alternate-screen dead-TUI recovery），不是进程退出证明；M2-12 attempt 2 明确不再调用它。两次宿主 IO await 结束后重新读取 Task、Mission、worker 的持久权威，Submission / cancel / 新 Attempt 的栅栏仍优先。

agent 退出后到下一次成功 reconcile（≤ 一个 60 s 间隔），`attempt show` 仍可显示 RUNNING / liveness=live。reconciliation 是将其转为 FAILED 并触发 retry 的权威；show/list 的 liveness 仍表示 PTY，shell 未退出时即使 Attempt 已 FAILED 也可继续为 live。starting/stopping 的新 runtime 归一化不代替宿主 liveness。SQLite UTC 时间戳经内核 exposeUtcTimestamp 解析，避免本地时区改变 runtime/orphan deadline。

`attempt_observation_facts` 最新 liveness facet 的 homeReceivedAt 是持久的 unverifiable-since：进入 unverifiable 只写一条；连续 tick 不写；恢复 live 写一条 live，下一次失联重新计时。stop_unknown 的停止结果仍未确认，即使宿主再次 live，也不写 live fact 重置该时钟；runtime-budget stop 的下一 tick 开始按 e 计时。reconcile report 的 liveness 仍保留实际宿主折叠值，stop_unknown 的计时事实与证据明确记录 reason=stop_unknown。证据 JSON 含 taskId/attemptId/seq/branch/worktreeId、workerState/dispatchStatus、liveness/reason、since/abandonedAt/toleranceMinutes 与该 Attempt 的 observationFacts；Artifact kind=evidence、related=[Task,dispatch]。无宿主退出证据时不冷启动同一 Attempt/worktree。

`settleAttemptWithoutSubmission` 在一个 store transaction 中只处理最新且无 Submission 的 RUNNING binding：RUNNING → NEEDS_FIX（原 reason），再按权威 attemptCount < retryPolicy.maxAttempts 转 READY（retry）或 BLOCKED（retry_budget_exhausted，previousStage=NEEDS_FIX）。不增加 attemptCount。launcher 的 launch_failed 与 Scheduler 的未绑定 launch_rejected 共用该入口；Orca Task failed/blocked 时，launcher 传最新 dispatch 为 retryOf，包含 abandoned/circuit_broken 后的新 Attempt。首次 failDispatch 将 Orca Task 置 ready，kernel 不接受 retryOf，故该重试的 `dispatch_contexts.retry_of_dispatch_id` 为 null；Axiom 重试关系由 `attempt_bindings` 的 seq 顺序及 `attempt.failed → attempt.started{seq:2}` 审计证明。READY 触发既有 stage_change 调度，暂停 Mission 不 admission。

所有拥有 BEGIN IMMEDIATE 的 kernel 操作均在 Axiom transaction 外完成，再写 Axiom consequence；failDispatch 已用可嵌套 savepoint，可与 audit/两次 stage change 同事务。保留/释放遵守内核 disposition，不能强制清理 possibly-live 或 identity_unproven 资源。

`axiom.mission.cancel` 先同步持久化 CANCELED/Task CANCELED，再 await reconciliation；返回 `{mission, attempts?}`，entries 为 `{attemptId,taskId,seq,liveness,action}`。CLI 每 Attempt 输出 action；旧响应省略 attempts 仍兼容。pause 只停止 admission；RUNNING Attempt 继续，cancel/restart 的剩余清理由同一恢复路径处理。

**stop_unknown 的内核边界（M2-08 Attempt 2）**：beginWorkerStop 拒绝第二次 stop，受支持的退出路径是 abandon；这与 verifier 核对的上游 Orca `ce2d60834c` 一致，不需要改内核或增加生命周期边。取消时下一 tick 直接 abandon（无 evidence Artifact），记录 priorStop、放弃时的宿主 liveness 与 release 收据；RUNNING 时无论宿主观测如何，按 e 等待 tolerance 后带 evidence abandon。abandon 只结束执行权威，不宣称进程退出；possibly-live 资源仍由内核保留，通常 release 为 retained / identity_unproven。旧 runtime stranded stopping 归一化后遵守同一规则；同 runtime 正在 stopping 的调用仍拥有结果，恢复不抢占。后续 tick 不重复 attempt.stop_unknown，取消审计重放保留最初的 priorStop/liveness，不因宿主观测变化重复记录。`.axiom-work/reports/M2-08-1.md` 保留为历史证据，其 scope-gap 判断由本规则取代；修复与验证记录见 `.axiom-work/reports/M2-08-2.md`。

M3-01 的 VerificationService 在 Mission recovery 后、首次 kick 前尝试验证队列重驱，逐项失败不阻止启动（见 Verification 节）；既有 60 s reconcile 同时触发 verification.kick，重试未完成的清理。M3-02/04 接检查与失败证据；M4 扩展 Integration/Approval 恢复。D58 的新通道必须保持相同 liveness 语义。

## 5. 合成 session party 与 Run 绑定（D14）

每个 Mission 铸造独立 `axiom-mission-<uuid v4>`，满足 `isOrcaSessionId`，不以 `term_` / `structworker_` 开头；持久化到 `missions.coordinator_orca_session_id`。`createRun` 参数为 `coordinatorHandle:null`、`coordinatorPaneKey:null`、该 session id。Mission 的 Run mailbox 为 `run:<runId>`。

这是进程内 Control Plane 身份，不是真实终端或 provider 会话；不能让终端声明该身份。重启复用持久绑定，绝不重新 `createRun`：同 session id 重建会解绑旧 Run、提升 `consumer_generation` 并驱逐旧消费者。`{kind:'system'}` 是 M2 dispatch creator 的内部权限，与合成 session party 的 Run 绑定是两个层次（Architecture §20 M1 行的 system principal 简写按 D14 理解）。

M1-01 契约证据见 `kernel-contract/*.test.ts` 与 [D14 spike](../review-evidence/axiom-m1/D14-session-party-spike.md)。M2-01 已在 `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts` 增加 service-only `controlPlane?: ControlPlaneWorkerStart`（类型在同目录 `control-plane-worker-start.ts`），首个实际调用者为 M2-05 `execution/attempt-launcher.ts`：六个 seam 字段的用法为 `dispatchCreator: {kind:'system'}`、精确的预创建 `worktreeId`、`branchNameOverride` 在此 bag 中省略（只传给预创建 worktree service）、ContextPackage 的 `preambleBuilder`、`dispatchMaxDepth: 1` 与 `callerIdentity`。同时填 `params.from = caller.address`，把同一合成身份作为 `coordinator` 和 `callerSession`，并传 Mission Task 为 `existingTask`。预创建 worktree 仅允许省略 `params.worktree` 或设为 `current`；branch / 所有权校验由 launcher 负责；深度 cap 取 runtime 与服务入参的较小值，preamble 在 cap 1 时不提示 sub-workers；null terminal handle 不作终端 lineage。省略 bag 保持原行为，文本替换沿用原有投递、turn observation 和失败路径。字段不进入 RPC schema，`workers.ts` 不传 bag，M1-07 对 Mission Run 的直接 `orchestration.workerStart` 拒绝保持不变（D10）；不得通过 RPC 参数自报 `caller:'control_plane'`。

## 6. RPC、envelope 与错误

M2-09 增加 mutation `axiom.mission.plan {missionId}`，响应 `{attempt:{attemptId:string|null,seq,branch,worktreeId:string|null,provider}}`；CLI 成功文本为 `Planner started: attempt <id> on <branch>`。`axiom.plan.propose` 的两个互斥形式为 `{missionId,planRevision,provenance}`（既有人工作法）或 `{missionId,planRevision,attemptId,from?}`（Planner）。后者由 CLI 的 `--attempt` 指明 Attempt，调用方身份由宿主核实（D73），from 复用 Worker terminal/session 解析，仍使用既有契约版本与 mutation receipts。传入 attemptId 时不得自报 provenance。`plan_pending` / `illegal_transition` 继续由原 proposal settlement 返回。Planner 的 `planner_worktree_dirty` / `planner_worktree_missing` 与既有 `no_eligible_provider` 经共享 mapper 的 structured runtime passthrough 保留 code/data，不走 `invalid_argument` 的 computer-use recovery 分支。Attempt 1 的映射阻塞已在 Attempt 2 修复，验证见 `.axiom-work/reports/M2-09-2.md`；旧报告保留为历史记录。

M1 已注册 `axiom.mission.create/show/list/start/pause/resume/cancel`、`axiom.goal.propose/activate/show`、`axiom.plan.propose/approve/reject/list/show`、`axiom.task.list/show/cancel`；M2-02 已注册 `axiom.artifact.put/read/list`（put 参与 mutation fence/收据）；M2-05 已注册只读 `axiom.attempt.show {attemptId}` / `list {missionId, taskId?}`；返回 `attempt` / `attempts`（Glossary §4.6），未知 dispatch 返回 `attempt_not_found`，CLI 为 `axiom attempt show/list`。M0 的 `axiom.namespace.get` 保留。M2 的 policy、Worker verbs、message、task.create 与 mission.plan 已注册（详见本节对应段）；未注册方法在映射 §4c 明确标为后续。

`AXIOM_MUTATION_METHODS` → `isOrchestrationMutation` 同时接入契约栅栏与 durable mutation 收据。mutation envelope 必须带 `orchestrationContractVersion:1`，缺失/不匹配会被 `orchestration_migration_required` 拒绝；不要把版本字段放进 params。调用方按约定必须带 `orchestrationRequestId`；内核收到该字段时，以 caller fingerprint + id 查 `mutation_receipts`：同 payload 回放，异 payload 拒绝 `request_mismatch`。当前内核无 request id 时直接执行，不提供去重，调用方不得依赖它自动补幂等。

CLI `src/cli/runtime/client.ts` 为 `axiom.*` 打版本戳，为 durable mutation 默认生成 request id，`--retry-request` 沿用原 id；`axiom-client.ts` 为 renderer mutation 生成 id，不确定重试复用 id 与原 payload。Worker 身份在 M2 接入（D73 之后由宿主核实，不再随 envelope 携带 capability），M1 CLI user commands 不冒充 Worker。runtime 公布 `axiom.control-plane.v1` capability。

CLI JSON 输出是 `{ ok, result, ... }` / `{ ok:false, error:{code,...}, ... }`；单对象 result 用 `mission` / `goalRevision` / `planRevision` / `task`，列表用 `missions` / `planRevisions` / `tasks`。M2-10 的唯一 `MissionSummary` 形状包含 `runId`；可选 `reason` 来自该 Mission 最新一条 `mission.status` 且 `after.status === mission.status` 的审计的 `after.reason`，缺失时省略。所有 Mission RPC（含 mutation 响应）共用 `missionSummary(mission, store)`。TaskListItem 的 `id` 是 Orca Task id，不是提案 id。

### Worker channel（M2-06a/b，D9 / D11 / D16）

已注册五个 mutation：`axiom.attempt.inform` / `request` / `blocked` / `handoff` / `request-subtask`。参数为 `{attemptId, from, senderPaneKey?, summary, body?, artifactIds?, related?, subtask?}`；只有 `request-subtask` 接受且必须带 `subtask`。严格 schema 不接受 `to`、自报 `type` 或 Mission/Task 身份。summary 与可选 body 各 ≤ 2,000 字符；较长内容先 `axiom mission artifact put`，再引用 Artifact id。`artifactIds` / `related.artifactId` 必须属于同 Mission，显式 `related.taskIds` 必须属于同 Mission，否则 `invalid_argument`，不写消息或审计。

`execution/attempt-authority.ts` 在写入前按以下顺序校验（含 ask 的七动词共用）：

1. dispatch 不存在 → `unknown_dispatch`；没有 `attempt_bindings` → `unknown_dispatch`。
2. dispatch 非 `dispatched` → `inactive_dispatch`。
3. 同 Task 存在更高 seq（包括尚未绑定 dispatch 的 admission）→ `stale_dispatch`。
4. 调用方身份由宿主核实（D73，取代 dispatch capability，上游已删除）：由 runtime 与 `orchestrationCallerIdentity` 解析调用方；有宿主核实的会话调用方时按其 Orca session 对照 Dispatch 的 assignee，否则先过 lifecycle caller fence（另一编排方的终端被拒），再按上游 `workerReportRefusal` 校验 Dispatch 与进程代次（→ `dispatch_inactive` / `worker_identity_changed`）；Dispatch 未记录进程代次时调用方必须是该 Dispatch 的消息发送方。已结算 Attempt 只允许同一 pane、同一进程代次重放自己的 Submission。
5. 内核 `hasLifecycleAuthority` 失败 → `sender_not_assignee`。
6. binding、Task、Mission、Run 关联不一致 → `task_dispatch_mismatch`。

CLI `axiom attempt <verb> --attempt <id> --summary <text>` 支持 `--body` / `--body-file`（互斥）、可重复 `--artifact` / `--related-task`；子任务另需 `--title --objective --allowed-path --acceptance --evidence`，risk 默认 low；M2-06b 可重复 `--depends-on` 对应 subtask.dependsOn。from 复用 `resolveOrchestrationTerminalHandle`（`--from` / `ORCA_TERMINAL_HANDLE`），pane metadata 来自 `ORCA_PANE_KEY`；runtime 自行解析 pane，不信任该参数授予权限。调用方身份由宿主核实（D73：终端 / 会话 → Dispatch → 进程代次，见 orca-mapping 的 Worker 身份一节），mutation 复用 `callOrchestrationMutation` 与 `--retry-request <原 UUID>`。失败的新请求不留收据；已完成请求沿用内核回放语义，同 id + 同 params 不重复写入，改变 params → `request_mismatch`。

`axiom.attempt.check {attemptId, from, senderPaneKey?, wait?, timeoutMs?, type?}` 是 read，不进 mutation 集合；鉴权后调用 `checkWorkerMailbox` 读取 `dispatch:<attemptId>`。type 是内核路由类型（可逗号分隔），保留 delivery replay、generation fence 与长轮询。CLI 为等待显式加 10 秒 transport grace；不新增 ack 参数，返回内核 deliveryId 等证据。

`axiom.message.list {missionId, type?, taskId?, attemptId?, pendingOnly?}` 是 read，按 messages.sequence 从旧到新返回 `{messages:[{id,type,taskId,attemptId,summary,artifactIds,related,subtask?,createdAt,pending}]}`。读取 Mission Run 的全部严格 Axiom 载荷（包括投递副本），跳过普通/非法载荷；`REQUEST_SUBTASK` 在没有同 Mission、`objectKind: message`、`objectId: messageId` 的 `subtask.resolved` 审计时为 pending。M2-06b 增加内核 question_threads 的 QUESTION 投影：即使无 payload.axiom，也按 question message id 与 dispatch 关联识别；附带 question、options、answer（answer_body）、status，pending 仅在 status=pending 时为 true。CLI：`axiom message list --mission <id> [--type <T>] [--pending] --json`。

M2 之后：M3 复用 typed channel 投递验证证据；D58 的执行通道不能绕过身份 / 进程代次栅栏（D73）。

### Submission settlement（M2-07，D2 / D4 / D11 / D16）

`axiom.attempt.submit` 已注册为 mutation，参数 `{attemptId, from, senderPaneKey?, report}`，Task/Mission 从 binding 解析，不能由 Worker 自报；响应 `{submission, candidate, duplicate}`。报告严格要求 summary（≤4,000）、filesChanged、checksRun（command/result=pass|fail|skipped、可选 durationMs/note）、artifacts、limitations、risks、questions、followUps；拒绝多余字段。每个 Artifact 必须属于同 Mission，且 related 包含 Task 或 Attempt；Artifact 内容先独立上传，本事务只保存引用，不复制内容。

```sh
axiom mission artifact put --mission <missionId> --kind worker_report --file REPORT.md --related <taskId> --json
axiom attempt submit --attempt <attemptId> --report <path.json> --json
```

实现位于 `execution/candidate-snapshot.ts` / `attempt-submission.ts` 与 `db/{candidates,submissions,verification-runs}-store.ts`，步骤对照映射 §5：

| 步骤 | 当前实现与写入 |
|---|---|
| 1 · 栅栏/收据 | 复用 AXIOM_MUTATION_METHODS、OrchestrationMutationExecutor；`--retry-request` 原载荷回放，变更载荷 request_mismatch |
| 2 · 鉴权/报告 | resolveAttemptSender 校验 dispatch、binding、seq、宿主核实的身份与进程代次（D73）、assignee、Mission/Run；zod 与 Artifact 归属在 Git 前校验 |
| 3 · 快照 | 从 worker_dispatches.worktree_id 用 splitWorktreeIdForFilesystem 取路径；先验当前 branch，再 status --porcelain；dirty → add -A + Control Plane identity commit --no-verify（两次写操作均以临时空 core.hooksPath 禁用全部 hooks），clean → 采用 HEAD；读 commit/tree 后再验 branch |
| 4 · 结算事务 | runLifecycleWriteTransaction('axiom_submit')：Candidate ACTIVE、旧 ACTIVE SUPERSEDED、不可变 Submission、artifact_git facet；settleWorkerReportInTransaction(succeeded)，rejected → 抛原 code 回滚；无 Axiom Submission 的内核 duplicate 也拒绝 |
| 5 · 同事务后续 | actor=AttemptSettlement 推 RUNNING → SUBMITTED；VerificationRun QUEUED；candidate.superseded / attempt.submitted；事务内任何异常回滚整笔 |
| 6 · 提交后保留与消息 | 先独立调用 retainWorkerTerminalResource，再用 store.transaction('attempt_retain') 审计 disposition 或失败；MessageRouter 直接 db.insertMessage(type=worker_done, payload.axiom.type=SUBMISSION)，不经 send/reconcileLifecycleMessage；此时 dispatch 已 completed；router 保存 submit receipt，再 notifyMessageArrived；stage_change 的既有提交后触发器重调度 |
| 7 · 重复 | 同 dispatch 返回原 Submission/Candidate、duplicate=true，不再 Git/结算/入队；同 Attempt 的并发请求复用既有 keyed queue 串行化；重启后靠 DB UNIQUE 与收据，内存队列不保存权威状态 |

结算之后，重复 submit 仅允许读取既有 Submission：只接受同一 pane、同一进程代次的调用方（D73），并校验最新 binding 与 hasLifecycleAuthority，不恢复任何权限；其他 pane 或进程代次 → `worker_identity_changed`。不同请求丢失了提交后的消息时，可用认证后的重复 submit 补写一条；已有消息不重复插入。Git 在事务外，事务失败可能留下快照 commit；重试采用 clean HEAD，禁止 reset/clean/checkout 撤销证据。

Candidate id 为 `cand_` + sha256(taskId + ':' + commit)。M3-02 / DEF-21 ⑥ 在 `axiom_submit` 事务内、insertCandidate 之前比较该 Task 上一 Attempt 的 ACTIVE Candidate：treeSha 相同即 `invalid_argument: candidate_unchanged`（即使 commit 不同），不写 Candidate / Submission / VerificationRun，Attempt 保持 RUNNING，可以修改后再提交。首个 Candidate 不受此限制；新树正常接受并 supersede 旧候选。数据库的 Task/commit 唯一键仍拒绝其它重复身份（candidate_exists），不得把旧 Candidate 改绑。环境修复后的同一 Candidate 重跑留给 M3-05 的显式路径。候选快照只允许在绑定的 `axiom/attempt/<taskId>/<seq>` 分支，不前进集成基线/目标分支。通用 stage API 对非 AttemptSettlement 的 RUNNING → SUBMITTED 返回 illegal_transition（reason=submission_required）。

**Attempt 2 addendum（2026-10-19）**：retention 属于终端资源维护，移至结算提交后、SUBMISSION 消息之前；内核方法自行拥有事务，保持不变。成功以独立事务记录 `attempt.terminal_retained` 与 retainDisposition（含 already_released / no_owned_resource，均非错误）；异常只记录 `attempt.terminal_retain_failed`，不回滚 Submission/Candidate/stage/VerificationRun，也不阻止发信。若在 commit 与 retain 之间崩溃，已结算 dispatch 与 not_requested 资源保留，M2-08 RecoveryService 已实现补 retain；重复 submit 不重跑 retention。

Submission 的 summary 仍完整保存（≤4,000）；SUBMISSION 邮件沿用 MessageSummarySchema 的 2,000 字符上限，超长取前 1,999 字符加 `…`。共享 MessageRelatedSchema 增加可选 submissionId；publisher 在不可变 id 生成后写入 `related: {submissionId}`，Artifact ids 不混入 Submission id。消息丢失后的重复提交也使用原 Submission 的摘要、Artifact 和 id。Attempt 1 的例外请求与红测是历史证据；当前实现与回归结果见 `.axiom-work/reports/M2-07-2.md`，已有宿主结果见 `.axiom-work/verifications/M2-07-2.md`。

M2-07 宿主 spec 为 `tests/e2e/mission-attempt-submit.spec.ts`（需要 AXIOM_FIXTURE_REPO），D49 provider 解析既有 Artifact 配方取得 Mission/Task id；先记录 preamble ledger，再跑冻结 retry/attempt-1/succeed stub；在 REPORT.md 副本尾部追加 Mission/Task/Attempt 归属后上传、submit。冻结 stub 的报告内容原本完全相同，归属附记防止内容去重命中另一 Task 的 related 元数据；不改变 fixture patch 或场景。设置 ORCA_E2E_CLI_ENTRY 的 fixture helper 启用该后半段；旧 launch spec 不设置它，仍测试 RUNNING 与重启，原有断言不放宽。M2-11 仅对新 exit flow 设置一次性 crash marker；已有两条 spec 的宿主通过记录见 `.axiom-work/verifications/M2-10-1.md`，本次仍需回归。

M3-01 在结算事务返回后触发 verification.kick(missionId)，拒绝/重复提交不触发；M3-02 在同一 drain 执行检查、记录 verdict；M4 才集成/释放 Candidate。D49 提交不构成真实 provider 认证。

### Verification（M3-01 / M3-02）

`verification/verification-service.ts` 是确定性的独立消费者；不启动模型、不采信 Worker 的 checksRun。`kick(missionId?)` 在整个 Control Plane 内合并为一个串行 drain；Mission 参数是触发提示，队列从 DB 读取，直到没有可领取的 run。三个入口：Submission 的 `axiom_submit` 事务返回后（拒绝/重复不触发）、启动恢复完成后、既有 60 s Attempt reconcile closure。没有新的 timer 或队列表。

`store.transaction('verification_claim', …)` 按 created_at/id 读取最老 QUEUED：Candidate ACTIVE 且 Task SUBMITTED 时，CAS `UPDATE … WHERE id=? AND status='QUEUED'` 的 changes 必须为 1，然后写 runtimeEpoch、claimCount+1、startedAt、`{phase:'claimed',claim}`；同事务由 MissionController 推 `SUBMITTED → VERIFYING`，写 `verification.claimed`。CAS 失败不写 stage/audit。SUPERSEDED Candidate、Candidate 行缺失或 stage 不符的 QUEUED run 变 CANCELED（reason=candidate_superseded/candidate_missing/task_stage_changed）并写 `verification.canceled`，继续领取后续 run；缺失 Candidate 不抛异常堵住队列。重启续跑例外：只有 phase=requeued/reason=restart、claimCount>0 的 run 可以继续其已 VERIFYING 的 Task，不回退或重复推进 Task stage。

准备在事务外执行：从 Candidate 的 Attempt binding.branch 创建 `axiom/verify/<runId>/<claimCount>`，name=`verify-<taskId>-<claimCount>`。只调用 runtime.createManagedWorktree，路径由 runtime 决定；runHooks=false、setupDecision=skip、awaitTerminalProvisioning=false、observeSetupCompletion=false、activate=false，lineage.noParent=true，orchestrationContext 记录 Mission 的 Orca runId 与 taskId（D64 2026-10-20 修订）。返回后立即持久化 worktree_id，再以 gitOptionsForWorktree/splitWorktreeIdForFilesystem 在该 worktree checkout --detach Candidate.commitSha、branch -f 同一验证分支到该 commit；校验 HEAD、HEAD^{tree}、分支 ref 与 detached 状态。checkout 禁用仓库 hooks。绝不修改 Attempt worktree，不 reset/clean。

成功保持 RUNNING，verdictDetail 为 `{phase:'prepared',claim,worktreeId,candidateCommitSha,candidateTreeSha,baseline:{branch},evidenceArtifactIds}`；内容寻址 Artifact kind=evidence、mediaType=application/json、createdBy=VerificationService、related=[runId,taskId,candidateId] 保存准备事实、runtimeEpoch 和时间戳，再事务写 `verification.prepared`。baseline.branch 是 Attempt 分支名，不能当作 M3-03 diff 的基线 commit。准备失败先回收已创建的 worktree，再 INCONCLUSIVE/finishedAt，`phase=prepare_failed`、reason=candidate_missing/candidate_mismatch/worktree_unavailable、脱敏 detail 与 `verification.inconclusive`；Task 仍 VERIFYING。回收失败保留 worktree_id/cleanupPending，后续 kick 与下一启动重试，不能把删除失败伪装成已回收。

每个 plane 的 runtimeEpoch=`epoch_<UUID>`。`startAxiomControlPlane` 在同步 Mission recovery 后 await `verification.recoverAtBoot()`，之后才 kick；即使 recovery 拒绝也仅 console.warn，继续安装 reconcile timer、同步消费者并调度 resume，保留 bootGeneration 的停止/重启栅栏。旧 epoch 的 RUNNING run（新进程中的所有 RUNNING）先 removeManagedWorktree(`id:<recordedId>`,{force:true})，只容忍明确的 already-gone，再 CAS 为 QUEUED，清空 worktree_id/runtime_epoch，写 `{phase:'requeued',reason:'restart',previousClaim}` 与 `verification.requeued`；历史 Artifact/audit 保留。

恢复逐项隔离失败：worktree 删除失败的 run 保持原 status、runtimeEpoch 与 worktree_id，保留原 phase 数据并设 cleanupPending=true；同一 boot generation 每个 run 只写一次 `verification.recovery_failed {worktreeId,reason:'worktree_removal_failed'}`，不记录原始 Git/runtime 输出。只有审计去重集合在进程内，重试资格与 worktree 归属均由 DB 决定。每次 kick 在 drain QUEUED 前经带 status 索引的查询重试旧 epoch RUNNING，以及 cleanupPending 的 PASS / FAIL / INCONCLUSIVE / SPECIALIST_REVIEW / HUMAN_REVIEW / CANCELED；后者成功只清空 worktree_id/cleanupPending，不重排队或改变 verdict。既有 60 s tick 因而可修复临时删除失败，无需重启。`recoverVerifications` 返回 `{requeued,cleaned,failed}`（重排队 run 数、清理的已结算/orphan worktree 数、失败项数），有失败时记录计数警告，其他项继续。

仅启动时通过 runtime.listManagedWorktrees 回收 `axiom/verify/` 分支孤立条目（不用文件系统扫描，不强制删除未记录的 orphan）。创建到记录 id 之间的崩溃由该扫描覆盖；detached 之前已记录 id。单个 orphan 删除失败只警告并继续；关联已知 run 时写同一 recovery_failed 审计，不将旧 claim 的 orphan 标记为当前 worktree 的 cleanupPending。已在本轮按持久 id 处理的 worktree 不重复扫；本 epoch 正在运行的 worktree 不被回收。成功恢复后再次执行不写新审计。

读入口 `axiom.verification.show {runId}` / `list {missionId,taskId?,candidateId?,status?}` 返回全部 VerificationRun 字段加 Candidate commit/tree 与 `phase=verdictDetail.phase??null`，缺失 run 或 Candidate 返回 not_found，不伪造 hash。CLI 对应 `axiom verification show --run` / `list --mission [--task] [--candidate] [--status]`，均支持 --json。

phase 词汇为 `claimed | prepared | checking | verdict | prepare_failed | requeued | canceled`，不是新的状态机。M3-02 消费 RUNNING/prepared 并运行/记录 deterministic checks 与 verdict、结束时回收 worktree；M3-05 接 INCONCLUSIVE 升级；M3-09 根据 lineage 过滤 renderer worktree 列表（本阶段仍可见）。

**M3-02：确定性检查与结算（D65 / D68 验证侧）**

`verification-rules.ts` 的严格 schema 用于 `axiom.policy.update.patch.verificationRules` 的写入校验，以及运行器读策略；未知键（含旧占位键 commands）或类型错误拒绝写入，RPC 返回 invalid_argument。patch 替换整份 verificationRules，不是深合并。PolicySchema 的存储契约仍为 JSON record，旧行仍可加载；运行器遇到不符合 schema 的旧值直接 INCONCLUSIVE(policy_invalid)、escalation=human，不执行命令。ContextBuilder 用 safeParse 读取同一存储值，非法时仍可构建 ContextPackage，并以固定行 `Verification rules are invalid (policy_invalid); the independent verifier will escalate to a human.` 代替命令列表。CLI 为 `axiom mission policy update --mission <id> --verification-rules-file <json>`，沿用 envelope、收据与 policy.updated 审计。

| 策略键                | 默认值 / 含义                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| repositoryGates       | `{}`；low / medium / high 的可选命令数组                                                                                                   |
| timeBudgetMinutes     | 30，正整数；一次运行共用的 deadline                                                                                                        |
| inconclusiveRouting   | specialist；可选 human                                                                                                                     |
| nonCodeTasks          | human_confirm；可选 artifact_only                                                                                                          |
| dangerousPathPatterns | `.github/workflows/**`、pnpm-lock.yaml、package-lock.json、yarn.lock、package.json、`.axiom-work/**`；仅解析，M3-03 使用                   |
| setupCommands         | `[]`                                                                                                                                       |
| retryOnce             | 常见测试前缀：pnpm / npm / yarn / bun 的 test、run test；npx vitest、vitest、npx jest、jest、pytest、python -m pytest、go test、cargo test |
| knownFlaky            | `[]`；人工维护的失败名模式，只有 `*` 是通配符                                                                                              |

策略中的命令去首尾空白且不得为空。`resolveVerificationPlan(taskSpec, rules)` 同时供 ContextBuilder 和运行器使用：setupCommands 原顺序（不去重），Task 的 requiredEvidence 逐项去首尾空白、跳过空项，再去重且保留声明顺序（不对合法但未 trim 的 Task 数据抛错），最后追加 task.risk 对应的 repositoryGates（去掉已经列出的命令）。每项带 source=setup/evidence/gate。Worker 的 checksRun 从不参与验证判定；报告声称全绿也不能抵消实际失败。

`verification-checks.ts` 在 prepare 成功后、同一全局串行 drain 中先写 phase=checking，再在 `splitWorktreeIdForFilesystem(worktreeId).worktreePath` 执行。只支持本地 repository；connectionId 非空或 executionHostId 非 local 的 repository 在建 worktree 之前交给运行器，得到 INCONCLUSIVE(environment)、detail=remote_repository_unsupported、escalation=human。进程选项沿用 automation precheck：shell=true、cwd、process.env、POSIX detached、windowsHide；超时和 shutdown 都复用其 killLocalPrecheckProcessTree，不新增 tree-kill。POSIX 停止时保留 helper 的延迟 SIGKILL，并等它执行后才允许回收。

deadline 从检查阶段开始（prepare 不计入），每条命令只得到剩余时间。退出 0=pass；ENOENT/EACCES、退出 127/9009=environmental(tool_missing)；deadline kill=environmental(timeout)；非本方发送的 signal=environmental(killed)；其它非零=fail；其它 spawn 错误=environmental(spawn_failed)。deadline 已过而尚未启动的命令=skipped(time_budget_exhausted)。setup 第一条非 pass 的已执行命令归 environmental(setup_failed)，余下 setup/evidence/gate 全部 skipped(setup_failed)。evidence/gate 的 fail 不短路后续检查。

retryOnce 对命令与前缀规范化空白，只允许相等、前缀后接空格或冒号；`pnpm run test:unit` 命中，fixture 的 `pnpm run verify:full` 不命中。匹配的 fail 在同一 worktree 最多重跑一次；两个 Attempt 的日志均保留，第二次 pass 使该 check 为 inconclusive(flaky)，第二次 fail 保持 fail。重试环境失败或预算耗尽不抹除第一次 deterministic fail。仍为 fail 且抽取出的失败名非空、全部匹配 knownFlaky（并无环境失败的重试）时变 inconclusive(known_flaky)，结算事务写一次 `verification.known_flaky {checkIndex, failures}`；系统不增加隔离名单。

| Check 集合（按优先顺序）    | Verdict / reason                                  | escalation / Task                               |
| --------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| 任一 fail                   | FAIL / checks_failed                              | VERIFYING → NEEDS_FIX → READY 或 BLOCKED        |
| 无 fail，任一 environmental | INCONCLUSIVE / environment                        | human；保持 VERIFYING                           |
| 无以上，任一 inconclusive   | INCONCLUSIVE / flaky（有 flaky 时）或 known_flaky | inconclusiveRouting；保持 VERIFYING             |
| 无命令                      | INCONCLUSIVE / no_checks                          | human_confirm → human，否则 inconclusiveRouting |
| 无以上，仍有 skipped        | INCONCLUSIVE / environment                        | human；不会把未执行的命令当成通过               |
| 全部 pass                   | PASS / checks_passed                              | VERIFYING → VERIFIED                            |

每个 verdict 的事务都带 id、expectedStatus=RUNNING、expectedRuntimeEpoch、expectedClaimCount，且要求 Task 仍 VERIFYING、Candidate 仍是该 Task 的 ACTIVE Candidate。CAS 丢失不写 verdict / stage / audit，仍回收本次 worktree。PASS 的 stage actor=VerificationService、reason=verification_passed，审计 verification.passed。FAIL 经 execution/attempt-settlement.ts 的 settleVerificationFailure，同事务先 NEEDS_FIX(verification_failed)，再按 attemptCount < retryPolicy.maxAttempts 进入 READY(retry) 或 BLOCKED(retry_budget_exhausted)，审计 verification.failed {failures}。INCONCLUSIVE 只结算 run 与 verification.inconclusive {reason, escalation}，M3-05 才接审查。updateVerificationRun 根据术语表 §4.8 的完整转换表拒绝非法变化，FAIL/PASS/CANCELED 终态不可再改判；无 status 的元数据更新仍合法。

证据先写、后回收 worktree：每条执行（含重跑与版本探针）的 stdout/stderr 各为 text/plain、kind=log Artifact，先脱敏再持久化；每流上限 MAX_ARTIFACT_BYTES（8 MiB），超限保留最前 1 MiB 与最新尾部，中间一行 `[axiom: <n> bytes omitted]`，记录 truncated 与原始字节数。失败名支持 Vitest `FAIL <file> > <name>`（可带 project 列）、Jest `● <suite> › <name>`（使用前面的 FAIL 文件头）和 fixture 的 deterministic reporter `<test-file> > <test fullName>: <message>`（在首个 ` > ` 后的首个 `: ` 处截断），每项最多 20 个、每名最多 300 字符。未知格式不猜测。失败/环境/不确定 check 的摘录围绕 FAIL、×、✗、Error、AssertionError、ERR_、failed、not found；无标记取末尾，单项 ≤40 行 / 4 KiB，总计 ≤32 KiB；摘录脱敏。

verdict 文档为单个 application/json、kind=evidence Artifact，createdBy=VerificationService、related=[runId,taskId,candidateId]。包含 verdict/reason/escalation、checks（index/source/command/result/reason、exitCode/signal/durationMs、attempts、failures/excerpt、stdoutArtifactId/stderrArtifactId、truncated、每流原始字节数与截断标记）、工具探针记录、toolVersions、deadline 与时间戳。版本命令 node/pnpm/git --version 在检查之后运行，每个最多 10 秒且仍在同一预算内；缺失或未能取得版本记 unavailable，不影响 verdict。resolved commands 与 toolVersions 写到既有列；verdictDetail 仅存 phase=verdict、verdict/reason/escalation、verdictArtifactId、保留 prepare 证据的 evidenceArtifactIds，以及 check 的 index/source/command/result/reason/exitCode/durationMs/failures 摘要。日志和摘录不放 SQLite；verification show 因而能列出失败测试。重复内容沿用 ArtifactStore 的内容去重；verdict 文档的引用固定本次运行的关联。

回收失败保留 worktreeId 与 cleanupPending=true；周期恢复现覆盖 PASS、FAIL、INCONCLUSIVE、两类 review 与 CANCELED 的待清理行，清理只更新元数据，不改变 verdict。shutdown 中 VerificationService.stop 中止运行中的进程树、停止 drain；RUNNING 保留，下一 boot 回收并重新 QUEUED。同一 plane 的 stop/start 也先等待旧 drain 退出，再换 epoch 恢复。E2E 唯一 hold seam：getMainE2EConfig().enabled 且 AXIOM_E2E_HOLD_VERIFICATION=1 时停在 prepared；非 E2E 模式不读取此变量。withFixtureMission 默认设置 hold，runVerification=true 时省略；新的 mission-verification.spec.ts 用 per-Task scenario marker 驱动三个冻结场景，并在批准的测试计划设 maxAttempts=1，阻止后续 Attempt 抢跑断言。

### Questions 与 D50 待决项处置（M2-06b）

`axiom.attempt.ask {attemptId, from, senderPaneKey?, question?, options?, timeoutMs?, resume?}` 为 mutation；question 与 resume 至少一项。鉴权后调用内核 `createQuestion`，直接使用它创建并投递到 `run:<runId>` 的消息，不创建第二封 QUESTION。先持久化 acceptance receipt，再通知 Run、长轮询 `dispatch:<attemptId>`：answered 返回 answer / answerMessageId；deadline 返回 timedOut；断连 signal 返回 cancelled；内核结算将 pending thread 关闭，等待者返回 dispatch_inactive。timeout 使用内核 clamp（默认 600 秒、上限 1800 秒）。resume 只接受同一 dispatch 的 question id；`--retry-request` 回放收据，恢复等待使用新请求 + resume。CLI 支持可重复 `--option` 与 `--timeout-ms`，transport 比内层等待多 5 秒。

`axiom.message.answer {missionId, questionId, body}` 是唯一 Mission answer 路径：核对 Mission/Attempt 归属，以当前 `run.consumer_generation` 调用 `answerQuestion`，记录 question.answered / receipt、重算 readiness，再通知 `dispatch:<id>` 的 status waiter。同内容重答幂等，异内容 answer_conflict；closed → dispatch_inactive。ask / answer 的内核函数各自拥有 BEGIN IMMEDIATE，不能嵌入另一写事务；内核写入后同步保存 Axiom 审计及收据，再通知。CLI 为 `axiom message answer --mission <id> --question <messageId> --body <text>`。

`axiom.task.create {missionId, task, dependsOn, provenance}` 经唯一的 `MissionController.createTask` 写入；task 为不带 id 的 TaskSpec，dependsOn 可为空。只允许 PLANNED / EXECUTING 且 active PlanRevision 为 APPROVED（否则 mission_not_executing / plan_pending）。事务内检查重复、依赖、预算；物化 tasks（deps=[]）、task_stages（DEFINED）与 mission_task_edges，写 task.created / plan.minor_adjustment，再重算 readiness（执行中 root 可立即 READY）。提交后触发 Scheduler。原 PlanRevision proposal 保留，新增 Task 绑定该 revision，不创建新 revision。CLI `axiom task create --mission <id> --file <task.json> [--depends-on <taskId>]* --json`；JSON 是 TaskSpec（无 id），user provenance 的 at 使用文件 mtime 保持重试稳定。D50 的 model provenance 只存本次 Task audit，不改变 PlanRevision provenance schema。

| D50 检查 / 分支 | 确定性行为 |
|---|---|
| scope | 分隔符与点路径规范化后，每个 allowedPath 等于或在请求者 scope 内，按目录边界判断 |
| depth | 请求者的 task.created.after.origin 不得是 request_subtask（最多一层） |
| duplicate | Mission 内不得有规范化后相同路径集合或 trim + case-insensitive 相同标题 |
| dependency | 所有 dependsOn 属于 Mission；追加原 Task → 新 Task 及请求依赖后 orderPlanTasks 无环 |
| budget | policy.budget.maxAttempts 若设置，须大于 Mission attemptCount 总和 |
| attempt | 请求者 binding 匹配 Task/Mission，dispatch 仍为 dispatched |
| 全部通过，subtaskAutoCreate 严格 boolean true | 消费者在 subtask.requested 后经 createTask 创建；继承 retryPolicy、milestoneId，kind=task，risk 默认 low；边使用 Mission readinessThreshold；subtask.resolved.decision=auto_accept |
| 检查失败 / 自动创建未启用 | 保持 pending；失败写 subtask.checks_failed（failed 数组），无 Task 创建 |
| 人工 accept | `axiom.message.resolve {missionId,messageId,decision:'accept',rationale}` 重跑全部检查，再走相同 createTask；失败仍 pending |
| 人工 reject | 同一 resolve，decision=reject；只写 subtask.resolved，不创建 Task |

所有成功处置写 `subtask.resolved.after = {decision,reason,taskId?}`；再次 resolve 返回 invalid_argument。CLI `axiom message resolve --mission <id> --message <id> --accept|--reject --rationale <text>` 要求恰好一个决定。用户 task.create 无请求 Attempt，仅执行 duplicate / dependency / budget；来源请求的创建仍执行六项。answer、resolve、task.create 均进 AXIOM_MUTATION_METHODS，与 ask 一起使用既有 envelope 栅栏和收据。M4 接 Approval，M5 将请求量作为 replan 信号。

M2 之后：M3 复用 Question/待决项投影；M4 接 Approval，M5 使用 REQUEST_SUBTASK 作为 replan 输入。

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
| ask（M2-06a） | `orchestration/messaging/ask-methods.ts`；activeDispatch 解析后，createQuestion 前；Worker ask 已由 M2-06b 提供 |
| reply（M2-06a） | `orchestration/messaging/message-methods.ts`；原消息 run_id 与发送者 Run 两侧检查，markAsRead / answerQuestion 前 |
| send(group)，含 @all / @worktree（M2-06a） | `orchestration/messaging/send-methods.ts`；路由与发送者 Run 检查，sendGroupMessage 前 |
| workerStart --on（M2-06a 测试） | 沿用 `worker/workers.ts` 的 M1-07 守卫；测试证明 federation 前拒绝，无新增内核代码 |

M2-06a 的 `admission-worker-control.test.ts` 与 `admission-rpc.test.ts` 覆盖上述入口的 Mission/非 Mission 对照。Control Plane 的 stop/abandon 调用已走 M2-08 service 边界；进程内 `caller: 'control_plane'` 不对 RPC params 开放。

完整测试为 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message,admission-worker-control}.test.ts`；逐入口证据见 [M2 出口矩阵](../review-evidence/axiom-m2/M2-exit-e2e.md)。task-update / worker-start 有三层拒绝：CLI 无终端身份时，`src/cli/handlers/orchestration/terminal-identity.ts` 的 `resolveCoordinatorTerminalHandle` 先抛 `no_active_sender_terminal`，尚未发送 mutation RPC；进入 runtime 后，Run 绑定解析可返回 `run_required` / `consumer_fenced`；到达 Mission 守卫后返回 `mission_managed`，由 M1-07 绑定 coordinator 的 RPC 测试覆盖。不能为取得某个错误码而给终端接管合成 Run。

M2 之后：M3 新增验证入口继续走 Control Plane；D58 如新增执行通道，必须保留本表的旁路拦截。

## 8. Mailbox 与恢复

M2-08 新审计：attempt.unverifiable（taskId/seq/reason/since）、attempt.abandoned（reason/disposition/evidenceArtifactId?）、attempt.failed、attempt.stopped、attempt.stop_unknown、attempt.launch_pending_orphan；取消的停止/放弃事件还含 release 收据。attempt 对象 id 为 dispatchId，未绑定 launch 用 taskId/seq；无变化不追加相同结果。mailbox.retry_exhausted 为 Mission 对象事件，含 runId/consumerGeneration/reason；message 去重和 Attempt 结果审计使用 idx_audit_events_object，索引为 CREATE INDEX IF NOT EXISTS，无 schema version 变化。

M2-12 / D59：`attempt.failed.after.reason` 为 `process_exited | kernel_failed`；前者来自 Recovery 的宿主退出证明，c′ 另带可选 `after.evidence = shell_foreground`，PTY 退出不加该字段；后者补齐内核先失败的事件，另带 `after.lastError`（string 或 null）。kernel_failed 补审计与 Task settlement 同事务，既有 attempt.failed 不重写。`planner.attempt_failed` 在 c′ 无提案失败时保留 `reason = no_proposal`，同样带 `evidence = shell_foreground`；没有增加生命周期枚举。

M2-07 提交审计：`attempt.submitted` 的 objectKind=attempt、objectId=dispatchId，after 含 stage=SUBMITTED、taskId、submissionId、candidateId、verificationRunId。`candidate.superseded` 的 objectKind=candidate、objectId=旧 Candidate id，after 含 SUPERSEDED 与 supersededBy；二者与结算同事务。提交后的独立 `attempt_retain` 事务记录 `attempt.terminal_retained` 或 `attempt.terminal_retain_failed`（同一 Attempt，after 含 taskId/submissionId/candidateId）；成功另带 retainDisposition（retained/already_released/no_owned_resource/release_committed），失败不持久化原始内核错误内容。消费者已有 `message.received` 路径覆盖 SUBMISSION，只记收件审计，不二次结算或验证。

M2-05 启动审计：`attempt.started` / `attempt.launch_failed` / `attempt.start_unknown` 的 objectKind 为 attempt，绑定后 objectId = dispatchId，after 含 taskId/seq/branch/worktreeId/provider；绑定前失败的 objectId = taskId/seq，after 含脱敏 message。`integration.base_created` / `integration.base_reused` 的 objectKind 为 mission，after 含 sha。这些事件不代表 Submission、验证或完成。

M2-04：MissionController 在 startExecution 提交后触发 mission_start；resumeMission/unblockMission 提交后触发 resume；transitionTaskStage/cancelTask/recomputeReadiness 实际移动 stage 后触发 stage_change。recomputeReadiness 无变化不触发。嵌套事务（mailbox、RPC、admission）延至当前同步调用栈提交后才触发，并核对持久审计以抑制回滚事务的通知。control-plane.ts 以 fire-and-forget 调用 scheduleRound，拒绝仅 console.warn，不抛回生命周期调用者；manual 可由服务调用者显式请求。现有 RunMailboxConsumer 的 readiness 调用沿用此入口，无新增轮询。

`RunMailboxConsumer` 先注册 exclusive waiter 再 drain backlog，避免读空到订阅之间丢唤醒；waiter 的独占仅限进程。`getOrCreateRunDelivery` 与 `acknowledgeRunDelivery` 用启动时捕获的 generation 栅栏，不能重读并采用别人的新 generation。

一批消息在 store 事务内按 message id 查 `audit_events` 去重：普通载荷写 `mailbox.message`，合法同 Mission 的 `payload.axiom` 改写 `message.received`；两种事件共同作为去重依据。重算 readiness，成功后才 ack。语义是 at-least-once delivery + 幂等效果，不能先 ack 再处理。处理失败留下批次以供重放；M2-08 使用 250ms × 2^(n−1)、上限 30s 的 waitForMessage(typeFilter=[]) 退避，通知不能绕过等待；成功 drain 后清零，连续 8 次失败则 blockMission(consumer_retry_exhausted)、写 mailbox.retry_exhausted 并停止。hasMessageAudit 使用 mission_id/object_kind/message object_id 与两种去重事件的 SELECT 1 LIMIT 1；idx_audit_events_object(mission_id, object_kind, object_id) 在每次打开 DB 时幂等创建，不再逐批扫描 Mission audit。`consumer_fenced` 写 `mailbox.consumer_fenced`，将 Mission BLOCKED 并停止消费者。

M2-06a `MessageRouter` 在 `store.transaction('message_route', …)` 内写 Control Plane 副本、下游副本与 `message.sent`（含 type/taskId/attemptId/recipients），并保存 mutation receipt；提交后向每个收件地址 `notifyMessageArrived`。Control Plane 地址必须为 `run:<runId>`：M1-08 的 `getOrCreateRunDelivery` 不消费 coordinator 的 `session:<id>` 直邮。INFORM/HANDOFF 默认只投 sender Task 的直接下游最新且 dispatched 的 Attempt；非空 `related.taskIds` 替换默认受众。REQUEST/BLOCKED/REQUEST_SUBTASK 只投 Control Plane；所有副本以 Control Plane 消息 id 为 threadId，从不使用群组地址。

`message.received.after = {type, taskId, attemptId, messageId}`；REQUEST_SUBTASK 在同事务另写 `subtask.requested.after = {...ids, subtask}`，作为 D50 step 1 的可查询待决项；BLOCKED 另写 `attempt.blocked_reported`。这三个事件的 objectKind 都是 message，objectId 是收到的消息 id，重放不重复记录。BLOCKED 只是 Worker 报告，在 M2 不改 Task stage 或 Attempt：Worker 仍可能运行，后续 RecoveryService / submit 才结算。

`startAxiomControlPlane` 在桌面 `src/main/startup/main-process-runtime-service.ts` 与 daemon `src/main/orcad/orcad-entry.ts` 接入。每次启动先 `RecoveryService.recover()`，再为 ANALYZING / PLAN_REVIEW / PLANNED / EXECUTING 启消费者；全部消费者同步后，对 report.missions 中每个 EXECUTING 且不在 report.blocked 的 Mission 触发 `scheduleRound(missionId, 'resume')`（M2-12 / D59）。因此即使 Task 已 READY、readiness 没有移动，也会重新调度；按 Mission 合并，空轮不写 scheduler.round，PAUSED / BLOCKED / 终态不请求轮次。调用失败沿用 control-plane.ts 的 catch + console.warn，不抛回 boot。boot 幂等，quit 停止全部消费者。create/start/resume/unblock 同步启动，pause/block/cancel 停止；持久状态不依赖这些内存句柄。

恢复逐个检查非终态 Mission：Run 必须存在，合成 session id 必须有效且 `runBoundToCoordinator` 成立；否则 BLOCKED，记录一次 `recovery.run_binding_lost`，不悄悄重建 Run。正常恢复重算 readiness，**不会写 recovery 成功事件**；若 readiness 实际移动，仍按正常 Task 转换审计。

`reconcileAttempts()` 的 Attempt 子集由 M2-08 接入启动、周期与退出消息触发（§4 Recovery）。M3-01 的 VerificationService 负责 Verification 队列重驱；Integration 队列重驱与 Approval 过期由 M4 接入。`docs/plans/M1.md` 的早期 M1-01 笔记写过先 drain 后注册，实际 M1-08 实现与测试为先注册再 drain，以实现为本节事实来源。

M2-06b 审计：question.created / question.answered 的 objectKind=message、objectId=question message id；前者带 Task/Attempt，后者带 answerMessageId 与 status，不复制回答正文。消费者按 question_threads 识别无 Axiom payload 的 QUESTION，写 message.received。REQUEST_SUBTASK 的 subtask.requested、checks_failed、resolved 与 Task 创建在同批事务内；重放不重复创建。task.created 带 origin/provenance/messageId?；plan.minor_adjustment 带 classification=MINOR_ADJUSTMENT、origin=user|request_subtask、Task 与边。人工接受失败在返回 invalid_argument 前保留 checks_failed 审计，仍可修复后重试或拒绝。

M3-01 已由 VerificationService 在启动时回收过期 RUNNING worktree 并重新 QUEUED，保留审计与 Artifact；M4 接 Integration 与 Approval 过期恢复，不以收件/ACK 代替完成证据。

## 9. M2 出口操作与后续里程碑

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

`mission create --goal-file` 支持 Markdown（全文 objective，空 acceptanceCriteria）或 GoalBody JSON。`axiom mission plan --mission <id>` 启动 Planner，等 `mission show` 为 PLAN_REVIEW 后查看 `plan list/show`，执行 `plan approve --plan <id> --resolver <actor>`，再 `mission start --mission <id>`。人工 `plan propose --file` 路径仍可用，需要 PlanProposal JSON，fixture decomposition 必须先转换。UI 从 Mission list 选择，Refresh 或 mutation 后重读；选择的 Mission id 不跨重启持久化。

M2-10：Mission Home 的 Attempt 计数仅包含 `role=worker` 的 RUNNING / SUBMITTED；Planner 为 STARTING / RUNNING 时显示进行中。ANALYZING 可 Start Planner；进行中的 mutation、活跃 Planner 或 PROPOSED plan 禁用重复启动。Planner readiness 的长等待期间保留 busy。Pending items 用 `message.list({missionId,pendingOnly:true})` 列出 QUESTION / REQUEST_SUBTASK，点击跳到所属 Task Detail。Task Detail 读取 Task 范围的 Attempt / message 列表，展示最新提交的 Attempt 的 Candidate 证据与按时间升序的单列消息；pending QUESTION 可回答，pending REQUEST_SUBTASK 可附理由接受/拒绝。answer/resolve/plan 均走统一 request-id envelope，不确定重试复用同一载荷的 id；成功或失败都重读 RPC，不用 mutation 响应推断权威状态。Task 选择只在当前 Mission 会话内保留，切换 Mission 时清空。worktreeId 经既有 `activateWorktreeFromSidebar` 导航，不新增执行面板。

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
| `replan_not_supported` | M2 仍不能批准替代计划；Goal 在 EXECUTING 激活虽可进入 REPLANNING，完整替代闭环留给 M5 |
| `orchestration_migration_required` / `request_mismatch` | 契约 envelope 缺失/不兼容，或同幂等 id 换了载荷；升级兼容客户端或为新意图使用新 id |

M2 出口证据以 [M2-exit-e2e.md](../review-evidence/axiom-m2/M2-exit-e2e.md) 的六条矩阵与 verifier 的宿主记录为准。新 exit spec 要求在同一 profile 完成 Planner → approve → start → 三根并行 → 一根 crash/retry → 三个 SUBMITTED，并比较四类提交前后持久行及 refs。shell 存活时的退出证明、kernel-first 失败审计与 boot resume 已由 M2-12 / D59 修复，历史诊断分支的宿主结果见 [M2-12 验证](../../.axiom-work/verifications/M2-12-1.md)；本候选仍须复验。`mission-attempt-launch.spec.ts` 保留重启身份/无重复启动的独立证据；M2-10 的五个既有宿主 spec 仍须回归。不得把未运行、skip、QUEUED 或 Worker 自报检查解释为独立验证 PASS。

| 后续责任 | M2 出口边界 |
|---|---|
| M2 出口复验 | M2-12 已合入；verifier 运行本候选的出口与五个既有宿主 spec，填写证据并决定验收；不再保留已修复的审计/boot 缺口为待办 |
| D58（ACCEPTED）/ D57 | 按 B 首选、A 后备实施 Codex/Claude 执行通道与 AgentSpec 权限映射，补真实 provider smoke 与认证。当前仅 D49 确定性 provider 已有提交实证；不能宣布“三 provider”完成 |
| M3 | 独立 VerificationService、Candidate worktree、deterministic verdict、Reviewer advisory、失败证据与 NEEDS_FIX 重试；复审 DEF-4/5/6/9/10 对应项 |
| M4 | 串行 Integration、Approval、Delivery、完成门与全对象恢复；集成基线在此之前不前进 |
| M5 / M6 | 替代 PlanRevision、完整 replanning / 决策模型；远端扩展与 mixed-version 验证 |

选择 Mission/Task 仍只保留在会话内，未交付跨重启 UI 选择持久化；不是权威对象丢失。本 Task 不扩展这项产品范围。verifier 核验宿主结果与已知缺口；M2 退出决定由 Henry 在证据与 D58 处置齐备后记录。

M2 之后：先处理 D58 的真实执行阻塞与 M3 验证责任；本参考文档的闭合不代表里程碑已获退出批准。
