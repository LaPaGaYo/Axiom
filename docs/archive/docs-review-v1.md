# Axiom 项目文档审查报告（设计 V1 + 章程 V1）

审查日期：2026-09-26
**后记（同日）**：本报告第 6 节的决策已由 Henry 拍板，结果记录在 `decision-log-v1.md`，其中两处与本报告的推荐不同——D1 选择把顶层对象改名为 **Mission**（而非保留 Project），D2 的 side table 定名为 `task_stages`（而非 `task_delivery`）。本报告保持原样作为审查记录；以决策日志、术语表与 v1.1 文档为准。
审查对象：
- `autonomous-software-engineering-platform-design-v1.md`（下称「设计」）
- `project-charter-v1.md`（下称「章程」）
- Project Instructions（AGENTS.md 草案，下称「指令」）——作为第三方基准一起对照

核实方法：除逐条比对三份文本外，还把设计中关于 Orca 现有能力的每一条假设，对照上游 `stablyai/orca@646e9a5`（Orca 1.4.197，即设计声明的审计快照）的源码逐一核实。文中引用的路径均相对于仓库根目录，可在你的 fork 中直接查证。

---

## 1. 总体结论

两份文档方向一致、原则清晰，章程的 Success Criteria 是可测试的工程门槛而不是口号，这一点很好。三份文本在「LLM 提议 / Control Plane 裁决」「Task 生命周期 > Agent 生命周期」「Worker 完成 ≠ 验证通过」「单一集成队列」「完成需证据」这些核心不变量上没有冲突。

真正需要在动代码之前解决的，是下面五类问题：

| # | 类别 | 严重度 | 一句话 |
|---|---|---|---|
| 1 | **Orca 映射假设与代码不符** | P0 | `worker_done` 会直接把 Task 标为 `completed` 并立即解锁下游 Task；自动 coordinator/scheduler 已退役；`project.*` RPC 命名空间已被占用；decision gate 不具备 Approval 语义 |
| 2 | **状态机有缺口** | P0 | Task 的「双投影」与不变量 6 相抵触且未定权威；PlanRevision/Goal 没有审批生命周期；分支模型未定义；集成失败时原 Task 去向未定义 |
| 3 | **枚举与术语不统一** | P0 | 消息类型在四处文本中有 6/7/8 种三个版本；Coordinator / ProjectController / Integration Controller / integration owner 混用 |
| 4 | **M0 范围被低估** | P0 | 除品牌/updater/telemetry 外，登录、relay、push、feedback、changelog、nudge、kill-list、artifact 分享（代码强制 onorca.dev 域名）等端点全部硬编码 |
| 5 | **若干关键机制未设计** | P1 | 验证在哪个 worktree 跑、候选 commit 由谁生成、预算三级归属、证据存储、重启后的 reconciliation、权限执行的现实边界 |

建议：先出一版 v1.1 文档修订（把第 6 节的决策定下来并回写），再连接 fork 仓库开始 M0/M1。否则第一批 migration 和 RPC 就会踩到命名冲突和 readiness 语义错误。

---

## 2. 三份文本之间的不一致

| ID | 议题 | 设计 | 章程 | 指令 | 建议 | 优先级 |
|---|---|---|---|---|---|---|
| A1 | 消息类型枚举 | §3.5 六种（无 SUBMISSION）；§10 七种，`REQUEST` 兼含子任务；§8 用 `REQUEST_SUBTASK` | Obj4 用 `REQUEST_SUBTASK` | 八种，`REQUEST` 与 `REQUEST_SUBTASK` 并列 | 以指令的八种为唯一枚举（`REQUEST_SUBTASK` 独立，因为 Control Plane 对它有 scope/depth/dup/cost 专门校验）；设计 §3.5/§10 改写；设计 §4.6 的 Heartbeat 明确为执行内核信号而非产品消息类型 | P0 |
| A2 | 「三个 Agent 并行」口径 | §19-2：至少三个**不同 provider** 并行 | §8-6：并行执行至少三个 Task；§10：三个独立 Attempt/worktree/provider-session | — | 拆成两条：(a) ≥3 个 Task 并行执行；(b) ≥3 种 provider 各至少完成一次 Attempt（不要求同时） | P1 |
| A3 | 权威对象清单 | §5 十五个（含 AgentSpec、ContextPackage、Message/Event、AuditEvent） | Obj1 十一个 | Authority Map 含全部 | 章程 Obj1 与设计 §5 对齐，并补 `Submission`（见 B5） | P2 |
| A4 | 控制角色命名 | §10 `Coordinator/ProjectController`；§12 `integration owner`；§20 `Integration Controller` | `ProjectController`、`integration owner` | 未命名 | 术语表固定为 `ProjectController`（确定性服务）与 `IntegrationController`（确定性服务）；**删除 Coordinator 一词**——Orca 里 coordinator 是终端中的 LLM Agent，与「不要 Master Agent」原则相混 | P1 |
| A5 | Attempt 与 Dispatch | `Attempt/Dispatch` | `Attempt` | `Attempt / Orca Dispatch` | 明确 `attemptId ≡ dispatchId`（Orca 源码注释已写 "Dispatch ID is the Attempt identity"），不新建 Attempt 表 | P2 |
| A6 | Project 一词 | §16 拟新增 `project/plan/verify/integrate/approval` RPC | — | 全文使用 Project | **Orca 已有 `project.list`/`project.update` RPC、`orca project` CLI 与 `Project` 类型（= 仓库/provider 身份）**，重名方法启动即抛 `duplicate_rpc_method`。见决策 D1 | P0 |
| A7 | Milestone 的 V1 地位 | §5 有定义、M1 含 Milestone；§17 V1 必须项未提 | Obj1 含；§8 未提 | 含 | V1 降级为 PlanRevision 内的分组标签 + 出口条件，不做独立状态机 | P2 |
| A8 | Goal 版本化 | 「变更触发新 PlanRevision」 | 同 | 「Approved Goal revision」 | 定义 Goal 版本与审批：Goal 变更 = `MAJOR_REPLAN` 触发；只有一个 active Goal revision | P1 |
| A9 | Jev | 多处提及，无定义 | 同 | 同 | 加一句定义/引用，定位为可选 DecisionEngine provider | P2 |
| A10 | 人工审批清单 | §14 含「接受最初计划（可配置自动接受）」 | Obj8 无 plan acceptance | 无 | 对齐；PlanRevision 的 auto/manual 审批做成 Policy 配置 | P2 |
| A11 | Reviewer 角色 | §4.2 无 Reviewer（只有「完成度语义审查」）；§11 有 LLM review 层 | — | Planner/Architect/Reviewer/Replanner | §4.2 补 Reviewer，并写明其输出仅为 advisory、不能推翻 deterministic FAIL | P2 |
| A12 | 项目代号 | — | 「待定」 | — | Claude Project 已叫 Axiom；M0 的 bundle id / CLI 名 / URL scheme 依赖此决定 | P1 |

---

## 3. 状态机与生命周期缺口

### B1. Task 双投影 vs 不变量 6 —— P0

设计 §6.2 提出「保留 Orca 执行状态 + 新增 delivery stage，迁移稳定后再评估合并」。指令不变量 6 与「禁止模式」都反对第二套生命周期。代码事实进一步放大了风险：

- `tasks.status` 是 CHECK 枚举 `pending/ready/dispatched/completed/failed/blocked`（`src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts`）；新增枚举值需重建表并影响降级（`src/main/runtime/orchestration/orchestration-schema-version-skew.ts`）；上游惯例是**加 side table**，`attempt_observation_facts` 就是这么做的。
- `worker_done --outcome succeeded` 在同一事务里把 Task 置为 `completed` 并调用 `promoteReadyTasks` 解锁依赖它的 Task（`db/dispatch-context/worker-report-settlement.ts:88-276`）。

**影响**：如果只是「加一列 stage」而不接管 readiness 规则，下游 Task 会在上游仅「提交」（未验证、未集成）时就变为 READY——直接违反不变量 4 和 8。

**建议**（决策 D2）：
1. 新建 side table `task_delivery`（stage 枚举 = 设计 §6.2 的 DEFINED…INTEGRATED）作为**项目级唯一权威**；
2. Orca `tasks.status = completed` 的语义重定义为「Attempt 已结算」，UI/CLI 投影层不得把它显示为「完成」；
3. readiness 改为：依赖 Task 的 delivery stage ≥ 策略阈值（默认 `INTEGRATED`，可放宽到 `VERIFIED`），由 ProjectController 计算，`promoteReadyTasks` 不再作为依赖解锁的依据；
4. 文档 §6.2 删除「稳定后再评估」，直接写明权威归属。

### B2. `VERIFIED → INTEGRATION_READY` 的条件未定义 —— P1

建议：`INTEGRATION_READY = VERIFIED ∧ 全部上游依赖已 INTEGRATED ∧（不需要 Approval ∨ Approval 已生效）`。

### B3. 集成失败 / 冲突时原 Task 的去向未定义 —— P1

设计 §6.5 只说生成 `CONFLICT_TASK` / `FIX_TASK`，没说原候选是否作废、原 Task 停在哪个 stage。建议规则（决策 D3）：
- 文本冲突（git 无法自动合并）→ 原 Task 回 `NEEDS_FIX`，新 Attempt 的 ContextPackage 携带冲突证据（本质是 rebase 任务）；
- 合并成功但回归失败（跨任务语义冲突）→ 新建 `FIX_TASK`，相关 Task 保持 `INTEGRATION_READY` 并对 FIX_TASK 加依赖；
- 两种情况都要把原候选标记为 `superseded`，不得再次入队。

### B4. 重试预算耗尽后的 Task 终态 —— P1

- Task 状态机没有 FAILED；`maxAttempts` 写在 AgentSpec（单次 Attempt 的合同）里，但语义是 Task 级。
- Orca 已有 `dispatch_contexts.failure_count` + circuit breaker（状态 `circuit_broken`，`dispatch-circuit-breaker.ts`），与设计的 maxAttempts 重叠。

建议：`Task.retryPolicy.maxAttempts`（Task 级）；`AgentSpec.budget` 只管单次 Attempt（runtime / tokens / cost）；耗尽 → Task `BLOCKED` + 触发 replan 分级 + 按 policy 请求 Approval；明确 circuit breaker 与 retryPolicy 谁是权威计数（建议以 Control Plane 计数为准，circuit breaker 作为下限保护）。

### B5. Submission 不是持久对象 —— P1

指令定义了内容丰富的 Worker Submission Contract，但设计里 `SUBMISSION` 只是消息类型 + Attempt 状态。VerificationRun 需要绑定「不可变候选 + 报告」，必须有实体可引用。

代码事实：Orca `worker_done` 载荷只有 `{taskId, dispatchId, outcome, filesModified, reportPath, phase}`（`src/cli/handlers/orchestration/message-payload.ts`），结果存入 `tasks.result`。

建议：定义 `Submission` 实体（或 Artifact kind=`submission`）：`attemptId`、`candidate {commit, tree}`、schema 化的 report、artifacts、checksRun、limitations、questions、followUps；`worker_done` 以**可选附加字段**方式扩展（满足 mixed-version 规则）。候选快照由谁生成见决策 D4。

### B6. Attempt 状态机与 Orca 实际词汇不一致 —— P1

| 设计 §6.3 | Orca 实际 |
|---|---|
| `CREATED → PLACING → STARTING → RUNNING → SUBMITTED`；`START_UNKNOWN`；`FAILED/STOPPED/ABANDONED`；`RELEASED/RETAINED` | `dispatch_contexts.status`: `pending/dispatched/completed/failed/circuit_broken`；`worker_dispatches.state`: `starting/ready/start_unknown/failed/succeeded/stopping/stop_unknown/stopped/abandoned`；`worker_terminal_resources.release_state`: `not_requested/retained/requested/releasing/released/unknown` |

缺口：`CREATED/PLACING` 不存在；`stop_unknown` 未提；`unverifiable` 不是 Attempt 状态而是 liveness verdict（`src/shared/pty-liveness-verdict.ts`），设计需说明「RUNNING + liveness=unverifiable」如何表达与恢复。建议 §6.3 改写为「Attempt = dispatch_context × worker_dispatch × liveness 三元投影」，不发明平行枚举。

### B7. Project 状态机把集成线性化了 —— P1

§6.1 `EXECUTING → INTEGRATING → READY_FOR_APPROVAL` 是线性的，但 §7 流程里集成是与执行持续交错的。建议：`EXECUTING`（含持续集成）→ `FINALIZING`（最终批次 + 完成门评估）→ `READY_FOR_APPROVAL` → `COMPLETED`；`PLANNED` 前增加 `PLAN_REVIEW`（等待人工/自动批准）。

### B8. PlanRevision 没有生命周期 —— P0

指令的授权顺序、Task 归属、replan 规则都依赖「approved PlanRevision」，但两份文档只说「不覆盖历史」。建议：`PROPOSED → APPROVED → SUPERSEDED / REJECTED`；任一时刻只有一个 active revision；新 revision 生效时旧 Task 的继承 / 取消 / 重绑规则要写明。

### B9. Verification 升级后的终态 —— P2

`INCONCLUSIVE → SPECIALIST_REVIEW / HUMAN_REVIEW` 之后如何收敛？写明：review 只能把 `INCONCLUSIVE` 变为 `PASS/FAIL`，**不能**推翻 deterministic `FAIL`。

### B10. Integration 状态机缺 Approval 节点与批次策略 —— P2

`PROMOTABLE → AWAITING_APPROVAL → PROMOTED / REJECTED`；批次中一个候选冲突时整批停止还是剔除继续（决策 D5）。

### B11. 分支模型未定义 —— P0

「integration base」「protected integration branch」「main」三者关系、promotion 是否等于快进目标分支、Attempt 分支命名都没有定义，而 M1 的 worktree 创建就要用到。见决策 D6。

---

## 4. 对照 Orca 源码的核实结果

设计对 Orca 的 17 项事实性假设中 16 项成立（表/RPC/liveness 词汇/federation/Git 2.25 基线/脚本名/provider 列表等均核实无误）。下面是**与设计假设有出入或设计没有考虑到**的部分：

| ID | 文档假设 | 代码事实 | 影响 | 建议 | 优先级 |
|---|---|---|---|---|---|
| C1 | Worker 完成 = 提交 | `worker_done succeeded` → Task `completed` → `promoteReadyTasks`（`worker-report-settlement.ts`）；`taskUpdate` 可直接把 status 设为任何值 | 下游任务被提前解锁；伪造 `worker_done` 即可「完成」 | 见 B1；同时限制 `orchestration.taskUpdate` 对 status 的写权限 | P0 |
| C2 | 「复用现有 Run 生命周期」 | `runs` 表**没有 status 列**；自动 `Coordinator` 循环、`coordinator_runs`、`orchestration.run/runStop`、CLI `coordinator-start` 已退役（返回 `orchestration_migration_required`/`command_retired`）；当前 coordinator 是终端里跟 skill guide 的 LLM Agent | 没有可复用的调度器；「Run」只是容器 | Scheduler 必须新建：确定性、DB 驱动、可重启；ProjectController 成为 `run:<runId>` mailbox 的确定性消费者（这是最自然的插入点） | P0 |
| C3 | Approval ← decision gate 泛化 | `resolveGate` 不校验 resolution 是否在 `options` 内、无 pending-only 守卫、不记录 resolver 身份与过期（`decision-gate-store.ts:97-125`）；`createGate` 会把活跃 dispatch 标为 `completed` 并把 Task 置 `blocked` | gate 只能承担 QUESTION 类阻塞，达不到指令要求的「scoped Approval」 | 新建 `approvals` side table（action、inputs hash、risk、expiry、resolver、outcome）；gate 保留给 QUESTION（决策 D7） | P1 |
| C4 | 新增 `project.*` RPC | `project.list`/`project.update` 已存在（`rpc/methods/project-runtime-rpc-methods.ts`）；另有 `projectHostSetup.*`、`projectGroup.*`、`automation.*`、CLI `orca project` | 重名即启动失败；概念混淆 | 产品前缀命名空间（决策 D1） | P0 |
| C5 | 自定义消息类型 | `messages.type` CHECK 固定九种：`status/dispatch/worker_done/merge_ready/escalation/handoff/decision_gate/question/heartbeat`；`worker_done/heartbeat/escalation/decision_gate` 不能发给群组 | 新类型需迁移（v43）或 side table | 做一张「产品类型 ↔ Orca 类型」映射表；`merge_ready` 在产品中禁止由 Worker 触发集成 | P1 |
| C6 | Worker ↔ Control Plane 通道需设计 | 已存在：CLI + `--dispatch-capability dcap_…`（只存 hash，`consumer_generation` 栅栏）；拒绝码 `stale_dispatch/sender_not_assignee/dispatch_capability_invalid/…`；`mutation_receipts` 提供幂等；**无 MCP server**，agent hooks 只上报状态 | 正面：章程「重复 completion 不产生重复转换」「stale Attempt 无法完成」已有现成机制 | 设计 §3.6/§16 明确复用此通道，不另起 MCP | P2 |
| C7 | Worker 不能派生 Worker | `nestedWorkerMaxDepth` 默认 1，>1 时 Worker 可直接 `workerStart` 子 worker（`src/shared/nested-worker-depth.ts`） | 违反不变量 | 产品 policy 强制 depth=1，子任务只能走 `REQUEST_SUBTASK` | P1 |
| C8 | VerificationRun 需新实体 | `attempt_observation_facts` 已声明六种 facet（`process_turn/artifact_git/worker_report/coordinator_ack/liveness/outcome`）但只写 `worker_report`；`projectAttemptOutcome` 已有 `finished_unverified` 结果 | 可借用而非重造 | 新建 `verification_runs` 表，证据以 `artifact_git`/`outcome` facet 追加写入 | P2 |
| C9 | M0 = 品牌/updater/telemetry | 硬编码端点还包括：`login.onorca.dev`、`relay.onorca.dev`、`push.onorca.dev`、`www.onorca.dev/v1/feedback`、`onorca.dev/whats-new/*`、`onorca.dev/plugins/kill-list.json`、`share.onorca.dev`（**代码强制只接受 onorca.dev 域**，`artifact-cloud-config.ts`）、skills 安装源、star 提示、marketplace；PostHog 无 CI key 时静默；Crashpad `uploadToServer:false` | M0 范围至少大一倍 | M0 增加「网络出口清单」交付物 + 自动化测试（构建产物不向 onorca.dev / stablyai 发任何请求） | P0 |
| C10 | — | 约 150 个 `orca-runtime-*.ts` 非测试模块中 137 个是 `@ts-nocheck`，含 `getOrchestrationDb` 所在模块（`config/ts-nocheck-baseline.txt`） | 新逻辑放进去会失去类型保护 | Control Plane 代码放独立、强类型模块，只通过 RPC/service 边界接入 | P1 |
| C11 | 指令的 Required Reading | 仓库只有 `docs/STYLEGUIDE.md` 与 52 篇 `docs/reference/*`；**没有** ARCHITECTURE / PROJECT_CONSTITUTION / PROJECT_CHARTER；orchestration 文档在 `skill-guides/` | 指令引用了不存在的文件 | 由本两份文档派生生成，见第 7 节 | P1 |
| C12 | 三种 provider | 39 个 TUI agent 可启动；结构化 session adapter 只有 Claude 与 Codex；Gemini/OpenCode 走 PTY 注入 | V1 目标可行；但 Gemini/OpenCode 的会话观测粒度更粗 | 章程注明 provider 能力分级 | 信息 |
| C13 | — | LICENSE 为 MIT © 2026 Lovecast Inc.；`package.json` 无 `license` 字段 | M0 Third-Party Notices | 保留 LICENSE 与署名，补 license 字段 | P2 |
| C14 | — | `orchestration.reset` 是破坏性 RPC | — | 纳入 Approval 门 | P2 |
| C15 | — | orchestration 的「实验性」开关只是 renderer localStorage 标记，RPC 始终注册 | — | 产品化时移除该标记 | 信息 |

---

## 5. 尚未定义的设计内容

| ID | 缺口 | 建议 | 优先级 |
|---|---|---|---|
| G1 | 验证在哪个 worktree 执行 | 独立 verification worktree checkout 候选 commit；或在 worker worktree 内先确认 `HEAD == candidate` 且工作区 clean。前者独立性更强，后者更省资源；V1 建议前者 | P1 |
| G2 | 权限执行的现实边界 | 对 CLI agent 无法在运行时强制 write scope。V1 = provider 配置尽力而为 + Verification 的 diff scope 检查（越界即 FAIL）。**要作为已知限制写进文档** | P1 |
| G3 | 预算的三级归属 | Project / Task / Attempt 三级：tokens、cost、wall-clock、attempts；「预算增加需 Approval」要求 approved limit 是持久化字段 | P1 |
| G4 | 证据与 Artifact 存储 | 大日志不进 SQLite；内容寻址目录（如 `<userData>/axiom/artifacts/<sha256>`）+ DB 只存引用与 hash | P1 |
| G5 | 重启后的 reconciliation | 启动时 ProjectController 对所有非终态 Attempt 询问执行宿主 liveness（live/unverifiable/exited）并据此转换；Scheduler 状态完全从 DB 派生，不允许内存态 | P1 |
| G6 | V1 = 哪些里程碑 | 章程交付物含 DecisionEngine 抽象（M5），但设计 §17 未含；建议 V1 = M0–M4 + M5 的抽象层与规则基线，Jev 实验与 M6 放 V1 之后（决策 D8） | P1 |
| G7 | 非代码 Task 的验证路径 | 研究/文档类 Task 没有 deterministic checks 时的 verdict 依据：Artifact 存在性 + schema + acceptance LLM review + 可选人工 | P2 |
| G8 | Demo fixture | 「中等规模真实代码库」未选定；建议 M1 前定下并写入章程（语言、规模、测试套件、预期 Task 数） | P2 |
| G9 | ContextPackage 存储与 token 预算规则 | 内容寻址 + 强制包含集（安全/合同/权限）+ 排序候选集 | P2 |
| G10 | Worker 的 provider 能力分级 | 结构化会话 vs PTY 注入，对 Attempt 观测、超时判定的影响 | P2 |

---

## 6. 需要拍板的决策

| ID | 决策 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 产品命名空间与 Project 一词 | (a) RPC/CLI 用 `axiom.*` 前缀，领域术语保留 Project；(b) 把顶层对象改名（Program / Initiative / Mission）彻底避开 Orca 的 Project；(c) 用 `cp.*`（control plane）前缀 | (a)：文档改动最小；代码里类型名用 `AxiomProject` 与 Orca `Project` 区分 |
| D2 | Task 权威状态 | (a) side table `task_delivery` 为权威，Orca status 降为执行投影；(b) 迁移改 CHECK 枚举，单表单状态；(c) 维持设计原文「两套投影、稳定后再看」 | (a)：符合上游惯例、不破坏降级、满足不变量 6 |
| D3 | 集成失败时原 Task 去向 | 见 B3 | B3 的规则 |
| D4 | 候选 commit 由谁生成 | (a) Worker 自行 commit，Control Plane 只记录；(b) Control Plane 在结算时于 worker worktree 生成快照 commit，并以此为唯一候选身份 | (b)：不依赖各 provider 行为一致，且保证不可变性 |
| D5 | 集成批次策略 | (a) V1 固定 batch size = 1；(b) 多候选批次 + 冲突时整批停止；(c) 多候选 + 剔除冲突候选继续 | (a)：先把闭环跑通，多候选批次留到 V1 之后 |
| D6 | 分支模型 | 建议：`axiom/integration/<projectId>` 为集成基线；Attempt 分支 `axiom/attempt/<taskId>/<attemptId>`；promotion = 集成分支合入目标分支（需 Approval） | 如建议 |
| D7 | Approval 存储 | (a) 新 side table `approvals`；(b) 迁移扩展 `decision_gates` | (a) |
| D8 | V1 里程碑范围 | 见 G6 | M0–M4 + M5 抽象层 |

---

## 7. 建议的文档修订与后续步骤

### 7.1 文档动作（对应指令的 Required Reading）

1. `docs/PROJECT_CHARTER.md` ← 章程 v1.1：合并 A2/A3/A8/A10/A12 与 G6/G8；
2. `docs/ARCHITECTURE.md` ← 设计 v1.1：合并第 3 节全部状态机修订、第 4 节的映射修正、第 5 节缺口；
3. `docs/PROJECT_CONSTITUTION.md`：从指令中抽出 12 条不变量、授权顺序、禁止模式、完成规则——指令本身引用它，但它目前不存在；
4. `docs/GLOSSARY.md`：术语与枚举的唯一来源（消息类型、各对象状态、角色名）；
5. `docs/reference/orca-mapping.md`：产品对象 ↔ Orca 表 / RPC / 状态的映射表（本报告第 4 节可作为初稿）；
6. 指令中「Execution Kernel 复用清单」删去「现有 orchestration Run 生命周期」中已退役的 coordinator 部分。

### 7.2 代码动作（M0/M1 前置）

1. 连接 fork 仓库目录，核对 fork 与上游 `646e9a5` 的差异（是否已开始 M0）；
2. 按 D1 决定命名空间后，先做一个空的 `axiom.*` RPC 命名空间 + CLI 命令名注册，验证不与现有方法冲突；
3. M0 增加「网络出口清单」与自动化断言测试；
4. M1 的第一条 migration（v43）只加 side table，不动现有 CHECK 枚举；
5. 用 `run:<runId>` mailbox 的确定性消费者替代 LLM coordinator，作为 ProjectController 的第一个落点。
