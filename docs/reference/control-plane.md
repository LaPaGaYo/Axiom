# Control Plane 子系统参考（M1 + M2-03）

更新：2026-10-17 · 适用：M1-01～M1-09 已合入的 Mission Facade；M1-10 出口证据另见 [M1-exit-e2e.md](../review-evidence/axiom-m1/M1-exit-e2e.md)。
规范权威仍是 [Constitution](../PROJECT_CONSTITUTION.md) §1、ACCEPTED Decisions、[Glossary](../GLOSSARY.md) §4 与 [Architecture](../ARCHITECTURE.md)；本文定位实现，不新增权威或状态。

## 1. 用途与边界

Control Plane 决定并持久化 Mission、版本化 Goal/Plan、Task stage 与依赖 readiness；模型只提出建议，renderer 只展示投影。顶层对象与 RPC 使用 Mission / `axiom.*`（D1）。用户代码所在对象称 repository；Orca `Project` 仍是仓库/provider 身份类型。

M1 提供人工输入计划、审批、启动、暂停/恢复/取消、阻止 Orca 旁路与重启恢复。它没有调度 Worker，也不会因为 `mission start` 就启动 provider。它不是 LLM coordinator、第二个终端/worktree 管理器，也不复活退役的 `coordinator.ts`。

Execution Kernel 继续拥有 Run、Orca Task、dispatch、PTY、进程、worktree、消息投递和收据。Axiom 经 `OrchestrationDb` 与现有 service/RPC 边界复用这些原语。权威 Mission 状态在 `missions.status`；权威 Task stage 在 `task_stages.stage`（D2）；`tasks.status` 只是执行投影。Mission 的 DAG 在 `mission_task_edges`，Orca `tasks.deps=[]`（D10）。

## 2. 模块地图

| 路径 | M1 职责 |
|---|---|
| `src/main/axiom/db/` | `axiom-store.ts` 聚合已启用的 side table 的访问；`missions-store.ts`、`revisions-store.ts`、`task-graph-store.ts`、`policy-audit-store.ts`、`artifacts-store.ts`、`agent-specs-store.ts` 分域 SQL；`axiom-rows.ts` / `row-codec.ts` 校验数据库行 |
| `src/main/axiom/mission-controller/` | `mission-controller.ts` 提供事务入口；`mission-lifecycle.ts`、`goal-lifecycle.ts`、`plan-materialization.ts`、`task-readiness.ts` 实现状态转换；`controller-context.ts` 定义错误与审计；`run-mailbox-consumer.ts` 消费 Run mailbox |
| `src/main/axiom/artifacts/` | M2-02：`ArtifactStore` 以 sha256 寻址文件，原子写入、读取校验、Mission/kind/related 过滤；根目录由 Control Plane 注入 |
| `src/main/axiom/context-builder/` | M2-02：七节强制集、确定性依赖 Artifact 排序、预算裁剪、脱敏、canonical manifest 和 Worker prompt template |
| `src/main/axiom/agent-factory/` | M2-03：先过滤，再由 RulesEngine 排序；生成 worker/planner AgentSpec，在同一事务持久化合同与选择审计，不启动进程 |
| `src/main/axiom/decision-engine/` | M2-03：闭集 choose/score/classify/rank 接口与确定性 RulesEngine；只能建议，不能修改 eligibility 或权威状态 |
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
| `attempt_bindings` | 表已建；M2 关联 Task 序号、branch、dispatch、AgentSpec、ContextPackage（D6a） |
| `submissions` | 表已建；M2 submit 形成不可变 Worker 报告 |
| `candidates` | 表已建；M2 由 Control Plane 固定 commit/tree，Worker 不能自封候选 |
| `artifacts` | M2-02 已写/读：Mission、kind、sha256、size、media type、related ids、createdBy；内容只存 `<userData>/axiom/artifacts/<sha256>` |
| `decisions` | M2-02 `listDecisions({ missionId, status })` 只读；ContextBuilder 包含 ACCEPTED 的 title/resolution；Decision service/RPC 写入者仍待后续 |
| `verification_runs` | 表已建；M3 独立验证使用 |
| `integration_batches` | 表已建；M4 串行集成使用 |
| `approvals` | 表已建；M4 ApprovalGateway 使用，不复用 decision gate |

Milestone 存在 Plan JSON 内，没有独立表/状态机。Attempt 身份仍等于 Orca dispatch id，不存在 Axiom Attempt 表。M2-02 启用 Artifact/ContextPackage 写入和 Decision 读取；M2-03 启用 AgentSpec 写入和 policy routing 更新；其余后续表目前只有建表和清理支持，不能把表存在当成产品能力已完成。

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
4. 无阻塞 Question/Approval。M1 的 `blockingQuestionOrApproval()` 明确返回 `none`，因为没有这些写入者；M2 admission 前必须替换。时间/token/成本预算与并发 enforcement 也归 M2。

冻结 fixture 初次启动因此是 12 Tasks / 20 edges / 3 READY（T01–T03）/ 9 DEFINED，12 个 Orca 投影均 ready。`parallelReady` 提示不是 readiness 权威。

## 5. 合成 session party 与 Run 绑定（D14）

每个 Mission 铸造独立 `axiom-mission-<uuid v4>`，满足 `isOrcaSessionId`，不以 `term_` / `structworker_` 开头；持久化到 `missions.coordinator_orca_session_id`。`createRun` 参数为 `coordinatorHandle:null`、`coordinatorPaneKey:null`、该 session id。Mission 的 Run mailbox 为 `run:<runId>`。

这是进程内 Control Plane 身份，不是真实终端或 provider 会话；不能让终端声明该身份。重启复用持久绑定，绝不重新 `createRun`：同 session id 重建会解绑旧 Run、提升 `consumer_generation` 并驱逐旧消费者。`{kind:'system'}` 是 M2 dispatch creator 的内部权限，与合成 session party 的 Run 绑定是两个层次（Architecture §20 M1 行的 system principal 简写按 D14 理解）。

M1-01 契约证据见 `kernel-contract/*.test.ts` 与 [D14 spike](../review-evidence/axiom-m1/D14-session-party-spike.md)。M2-01 已在 `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts` 增加 service-only `controlPlane?: ControlPlaneWorkerStart`（类型在同目录 `control-plane-worker-start.ts`），首个调用者为 M2-05 attempt-launcher：传 `dispatchCreator: {kind:'system'}`、精确的预创建 `worktreeId`、仅新建时使用的 `branchNameOverride`、ContextPackage 的 `preambleBuilder`、`dispatchMaxDepth: 1` 与 `callerIdentity`。同时填 `params.from = caller.address`，把同一合成身份作为 `coordinator` 和 `callerSession`，并传 Mission Task 为 `existingTask`。预创建 worktree 仅允许省略 `params.worktree` 或设为 `current`；branch / 所有权校验由 launcher 负责；深度 cap 取 runtime 与服务入参的较小值，preamble 在 cap 1 时不提示 sub-workers；null terminal handle 不作终端 lineage。省略 bag 保持原行为，文本替换沿用原有投递、turn observation 和失败路径。字段不进入 RPC schema，`workers.ts` 不传 bag，M1-07 对 Mission Run 的直接 `orchestration.workerStart` 拒绝保持不变（D10）；不得通过 RPC 参数自报 `caller:'control_plane'`。

## 6. RPC、envelope 与错误

M1 已注册 `axiom.mission.create/show/list/start/pause/resume/cancel`、`axiom.goal.propose/activate/show`、`axiom.plan.propose/approve/reject/list/show`、`axiom.task.list/show/cancel`；M2-02 已注册 `axiom.artifact.put/read/list`（put 参与 mutation fence/收据）；M0 的 `axiom.namespace.get` 保留。其他命名空间/方法在映射 §4c 标为后续。

`AXIOM_MUTATION_METHODS` → `isOrchestrationMutation` 同时接入契约栅栏与 durable mutation 收据。mutation envelope 必须带 `orchestrationContractVersion:1`，缺失/不匹配会被 `orchestration_migration_required` 拒绝；不要把版本字段放进 params。调用方按约定必须带 `orchestrationRequestId`；内核收到该字段时，以 caller fingerprint + id 查 `mutation_receipts`：同 payload 回放，异 payload 拒绝 `request_mismatch`。当前内核无 request id 时直接执行，不提供去重，调用方不得依赖它自动补幂等。

CLI `src/cli/runtime/client.ts` 为 `axiom.*` 打版本戳，为 durable mutation 默认生成 request id，`--retry-request` 沿用原 id；`axiom-client.ts` 为 renderer mutation 生成 id，不确定重试复用 id 与原 payload。Worker capability envelope 在 M2 接入，M1 CLI user commands 不冒充 Worker。runtime 公布 `axiom.control-plane.v1` capability。

CLI JSON 输出是 `{ ok, result, ... }` / `{ ok:false, error:{code,...}, ... }`；单对象 result 用 `mission` / `goalRevision` / `planRevision` / `task`，列表用 `missions` / `planRevisions` / `tasks`。MissionSummary 不包含 Run id；TaskListItem 的 `id` 是 Orca Task id，不是提案 id。

## 7. Admission 守卫（映射 §4b）

`mission-managed-run-guard.ts` 按 Run、Task、dispatch 查 Mission 归属，在对象解析后、首次写入前拒绝。非 Mission Run 保持原行为；未知对象保持原错误。以下路径均在 M1-07 落地：

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

完整测试为 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message}.test.ts`。task-update / worker-start 有三层拒绝：CLI 无终端身份时，`src/cli/handlers/orchestration/terminal-identity.ts` 的 `resolveCoordinatorTerminalHandle` 先抛 `no_active_sender_terminal`，尚未发送 mutation RPC；进入 runtime 后，Run 绑定解析可返回 `run_required` / `consumer_fenced`；到达 Mission 守卫后返回 `mission_managed`，由 M1-07 绑定 coordinator 的 RPC 测试覆盖。不能为取得某个错误码而给终端接管合成 Run。

## 8. Mailbox 与恢复

`RunMailboxConsumer` 先注册 exclusive waiter 再 drain backlog，避免读空到订阅之间丢唤醒；waiter 的独占仅限进程。`getOrCreateRunDelivery` 与 `acknowledgeRunDelivery` 用启动时捕获的 generation 栅栏，不能重读并采用别人的新 generation。

一批消息在 store 事务内按 message id 查 `audit_events` 去重，写 `mailbox.message`，重算 readiness，成功后才 ack。语义是 at-least-once delivery + 幂等效果，不能先 ack 再处理。处理失败留下批次以供重放；M1 固定退避 250ms、扫描 Mission audit 去重，M2 需评估消息量和有界 retry/escalation。`consumer_fenced` 写 `mailbox.consumer_fenced`，将 Mission BLOCKED 并停止消费者。

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

后续边界按 Architecture §20 排序：M2-02/03 已提供 AgentSpec/ContextPackage 与 RulesEngine；M2 后续增加 Planner、Scheduler、Attempt/Worker、预算 admission、Submission/Candidate；M3 加独立验证与 NEEDS_FIX；M4 加串行集成、Approval、Delivery/完成门及全对象恢复；M5 加完整 replanning 与可替换决策模型；M6 才覆盖远端扩展。

M2 还需将 workerStop/Abandon/Release/Retain/TerminalUserInput、ask/reply、跨 Run 群发与 federation 纳入 admission 评审，并在出口 e2e 加 Attempt、submission 和可到达时的 bound-coordinator `mission_managed` 路径。M1 出口验证不能替代这些后续证据。
