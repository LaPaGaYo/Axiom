# 自主软件工程控制平台：Project Charter V1.1

更新日期：2026-09-26  
项目代号：Axiom（D17 已确认）  
文档状态：V1.1  
基于：V1（2026-09-26）

> 术语与枚举以 `docs/GLOSSARY.md` 为准。「本项目」指 Axiom 工程本身，用户的代码仓库称 repository / 仓库。

## 1. Project Description

本项目将构建一个**目标驱动的自主软件工程控制平台**。

用户描述想要构建或修改的软件、技术约束和验收要求。平台理解目标和现有仓库，将目标转化为版本化计划与 Task DAG，动态组织适合每项任务的 AI Agent，在隔离的 Git worktree 中执行工作，并对结果进行独立验证和受控集成。

平台支持 Claude Code、Codex、Gemini、OpenCode 等可替换执行者。Agent 可以崩溃、重试或更换模型，但 Mission、Task、Decision、Artifact、VerificationRun 和 Approval 等权威状态持续存在。

平台以 Orca 衍生的 Execution Kernel 承载终端、PTY、Git、worktree、Agent 会话、SSH/WSL 和远端运行；我们的核心产品价值位于 Control Plane：规划、调度、上下文管理、验证、集成、重规划和人工治理。

### 一句话描述

> 将一个软件工程目标（Mission）转化为可执行、可验证的 Task DAG，并协调专业 AI Agent 团队持续推进直至完成。

### 英文描述

> A goal-driven software engineering control plane that turns Mission goals into verifiable task graphs and coordinates specialized AI agents through planning, execution, verification, integration, and delivery.

## 2. Subject

本项目研究和建设的主题是：

> **如何把多个能力不同、生命周期短暂且输出不完全可信的 AI Coding Agents，组织成一个能够长期、可靠地完成整个 Mission 的工程系统。**

这个主题包含五个核心问题：

1. 如何将开放式 Goal 转化为结构化、可版本化的 PlanRevision 和 Task DAG；
2. 如何根据 Task 动态选择 Agent、模型、技能、上下文、权限和工作区；
3. 如何使 Agent 在不共享无限 conversation 的情况下协作；
4. 如何独立验证 Agent 的工作，并安全地集成并行修改；
5. 如何在 Agent 失败、环境中断或计划变化时恢复和重新规划，同时保持人类控制权。

因此，本项目的 subject 不是"哪个模型写代码最好"，也不是"如何同时打开更多终端"。它关注的是多 Agent 软件工程的**控制、证据、可靠性和治理**。

## 3. Problem Statement

现有 AI Coding Agent 通常以单个会话或单次任务为中心。即使多个 Agent 可以并行运行，仍存在以下系统性问题：

- 目标、任务和 Agent 会话混在 conversation 中，没有持久化权威状态；
- Agent 能完成局部编码，却缺少 Mission 级依赖和完成度判断；
- Worker 自己声称"完成"，没有独立验收；
- 并行 worktree 各自通过测试，但合并后可能冲突或失败；
- Agent 间直接对话会造成上下文膨胀和 N² 通信；
- Agent 失败或会话丢失后，任务状态难以恢复；
- 权限、预算、递归创建 Agent 和危险操作缺少系统治理；
- 人类要持续 prompt、追踪、复查和手动合并，无法真正委托整个 Mission。

我们需要一个独立于任何单个 Agent 的 Control Plane，让软件交付过程具有持久状态、明确权威、验证证据和可恢复生命周期。

## 4. Vision

> 让一个人能够像管理高水平软件团队一样，向 AI 团队交付一个完整的 Mission，而不必逐个会话指导每一个实现步骤。

长期愿景是：用户描述想要实现的软件及其边界，平台能够在透明、可审查和受治理的条件下，自主组织执行过程，并向用户交付经过验证的结果和完整证据链。

我们追求的不是"完全不需要人"，而是让人类从日常调度和重复确认中解放出来，专注于产品意图、关键权衡和高风险批准。

## 5. 产品使命

> 建立一个可靠的 Control Plane，把 AI Agent 的推理与执行能力转化为持续、可验证的软件工程交付能力。

产品使命包含四项长期责任：

- 把意图变成结构化计划；
- 把计划变成受控执行；
- 把执行结果变成验证证据；
- 把验证候选变成可安全交付的集成结果。

## 6. Primary Goal

本项目的首要目标是：

> **实现一个端到端的本地优先系统，使用户只需为一个中等规模仓库定义 Mission 的目标、约束和验收标准，系统即可生成 PlanRevision 与 Task DAG，动态调度多个 AI Agent，在隔离 worktree 中并行实现，独立验证每个 Submission，处理失败和冲突，经过受控集成及必要的人工 Approval 后，交付一个可运行且满足验收条件的结果。**

这个 Goal 包含清晰的完成含义：平台不仅能启动 Agent，还必须证明 Agent 的工作经过验证、合并后的系统仍然正确，并能够解释为什么 Mission 被判定为完成。

## 7. Strategic Objectives

### Objective 1：建立持久化 Mission 模型

建立 Mission、GoalRevision、PlanRevision、Milestone、Task、TaskEdge、Attempt、AgentSpec、ContextPackage、Submission、Candidate、Artifact、Message、Question、Decision、VerificationRun、IntegrationBatch、Approval、Policy、AuditEvent 和 CompletionReport 等权威对象；Milestone 在 V1 仅为 PlanRevision 内的分组标签，无独立状态机。

Goal 版本化：Goal 以 GoalRevision 持久化（`PROPOSED → ACTIVE → SUPERSEDED`，单一 `ACTIVE`）；Goal 变更即 `MAJOR_REPLAN` 触发，产生新 PlanRevision。

预期结果：关闭应用或 Agent 崩溃后，Mission 状态能够恢复；Task 生命周期不依赖 Agent 生命周期。

### Objective 2：从 Goal 生成可执行 Task DAG

让 Mission Intelligence 分析需求和仓库，提出结构化计划、依赖、验收标准和风险；由 Control Plane 校验并持久化为 PlanRevision 与 TaskEdge。

预期结果：所有可执行 Task 都有明确输入、依赖、范围、验收标准和完成证据要求。

### Objective 3：动态组织 Agent，而不是固定角色

根据 Task 的 capability、成本、风险、上下文和 provider 状态生成 AgentSpec，选择模型、reasoning、权限、预算与 worktree。

预期结果：同一系统能为前端、数据库、研究、测试或安全任务生成不同执行合同，并能在失败后换 Agent 重试。

### Objective 4：建立受控的 Agent 协作协议

通过 typed messages、Decision 和 Artifact 实现协作，消息类型固定为八种：`INFORM`、`REQUEST`、`QUESTION`、`DECISION`、`BLOCKED`、`HANDOFF`、`REQUEST_SUBTASK`、`SUBMISSION`；不依赖 Agent 阅读彼此完整 conversation。

预期结果：上下文随 Mission 规模增长仍可控制；通信可路由、可查询、可审计。

### Objective 5：让验证独立于 Worker

Worker 的完成报告只能形成不可变的 Submission，使 Task 进入 `SUBMITTED`；Control Plane 生成快照作为唯一 Candidate（D4）。独立 Verification 根据 Candidate、测试、lint、typecheck、build、验收标准和 diff 生成 verdict，review 不能推翻 deterministic `FAIL`。

预期结果：没有 `PASS` 的 VerificationRun，Task 不能进入 `INTEGRATION_READY`；错误的 Submission 会被拒绝或退回 `NEEDS_FIX`。

### Objective 6：建立可靠的并行集成机制

所有 `INTEGRATION_READY` 的候选进入单一 Integration Queue，由 IntegrationController 串行应用到集成基线（V1 每批一个候选，D5），并在集成树上运行完整回归。

预期结果：能够发现"每个分支单独通过、合并后失败"的问题：文本冲突使原 Task 回到 `NEEDS_FIX`，回归失败则创建 FIX_TASK（D3）。

### Objective 7：支持恢复、重试和重规划

平台识别 Agent crash、远端失联、连续验证失败、依赖变化和架构假设失效，执行安全重试、`MINOR_ADJUSTMENT` 或产生新 PlanRevision 的 `MAJOR_REPLAN`。

预期结果：失败不会导致整个 Mission 状态丢失；系统也不会把 `unverifiable` 错判为失败或完成。

### Objective 8：保留人类治理

对需求歧义、PlanRevision 接受（可按 policy 自动）、权限提升、预算升级、不可逆操作、数据迁移、高风险 promotion 与最终交付设置明确的 Approval（经 ApprovalGateway）。

预期结果：系统自动处理日常协调，但不会未经授权执行高风险动作。

### Objective 9：提供 Mission-first 用户体验

用户首先看到 Goal、Plan、DAG、Progress、Risk、Evidence 和 Approvals；终端、diff、编辑器是可钻取的执行工作台。

预期结果：用户管理的是 Mission 和结果，不是几十个无法区分的终端窗口。

## 8. What We Must Achieve in V1

V1 必须完成一个可演示、可重复验证的垂直闭环：

```text
Goal
  → Repository Analysis
  → Human-reviewable Plan
  → Validated Task DAG
  → Dynamic Agent Assignment
  → Parallel Worktree Execution
  → Structured Submission
  → Independent Verification
  → Controlled Integration
  → Approval when required
  → Evidence-backed Completion
```

具体交付能力：

1. 为一个本地 Git repository 创建 Mission 与 GoalRevision；
2. 生成可审阅、可版本化并经人工或 policy 自动接受的 PlanRevision；
3. 建立带 TaskEdge 依赖和 acceptance criteria 的 Task DAG；
4. Claude Code、Codex、Gemini、OpenCode 中至少三种 provider 各至少完成一次 Attempt（不要求同时）；
5. 根据 Task 动态生成 AgentSpec 与 ContextPackage；
6. 在隔离 worktree 中同时并行执行至少三个 Task（不要求来自不同 provider）；
7. 支持八种 typed messages（含 `QUESTION`、`BLOCKED`、`HANDOFF`、`SUBMISSION`）；
8. 将 `SUBMITTED` 与 `VERIFIED` 严格分离；
9. 对不可变 Candidate 运行 deterministic checks；
10. 支持 VerificationRun `FAIL` → `NEEDS_FIX` → 新 Attempt；
11. 支持串行集成和集成树全量回归；
12. 支持集成冲突 → `NEEDS_FIX` 或 FIX_TASK；
13. 对高风险 promotion 与最终交付请求人工 Approval；
14. 应用重启后恢复 Mission、Task、Attempt 和 Evidence；
15. 根据所有 completion gates 给出最终完成判断和 CompletionReport；
16. 构建产物不向原厂（onorca.dev / stablyai）端点发送任何请求，并有自动化验证。

## 9. V1 范围与里程碑

V1 = M0–M4 全部，加上 M5 中的 `DecisionEngine` 接口与 RulesEngine 基线、replan 分级触发，以及 `MAJOR_REPLAN` → 新 PlanRevision → 批准 → 旧版本 `SUPERSEDED` 的完整闭环（D8，修订后）。放到 V1 之后的是 Jev 等学习型 DecisionEngine 实验、基于历史表现/成本的路由学习，以及 M6。

| 里程碑 | 一句话说明 | V1 |
|---|---|---|
| M0 隔离 | 新产品身份与网络隔离：品牌、更新源、telemetry、第三方 notice、网络出口清单与断言测试 | 是 |
| M1 Mission Facade | Mission/Goal/Plan 与 Orca Run/Task 的映射、`task_stages`、重启恢复、基础 UI | 是 |
| M2 Planning 与 Agent Factory | plan proposal、DAG 校验、AgentSpec、ContextPackage、provider routing 与预算 | 是 |
| M3 Independent Verification | Submission、Candidate、VerificationRun、deterministic checks、`NEEDS_FIX` 循环 | 是 |
| M4 Controlled Integration | Integration Queue、IntegrationController、集成树回归、FIX_TASK、Approval 与 promotion | 是 |
| M5 Replanning 与 Decision Engine | replan 分级、`MAJOR_REPLAN` 闭环、`DecisionEngine` 抽象、Jev 实验、历史表现与成本反馈 | 接口 + RulesEngine 基线 + replan 闭环；Jev 与学习型反馈否 |
| M6 Remote 与扩展 | 远端 mixed-version、SSH/WSL/federation 验证，再决定 cloud、mobile、多用户 | 否 |

### Demo 与验证 fixture（G8，D18）

V1 使用两类相互独立的 fixture。

**Controlled Acceptance Fixture（受控验收 fixture）**：V1 的主演示与验收仓库必须是一个冻结的、组织可控的仓库，满足全部硬门槛：

| 硬门槛 | 要求 |
|---|---|
| 许可 | 明确允许再分发 |
| 固定版本 | 固定 commit、Node 版本、包管理器版本 |
| 确定性检查 | 离线可复现的 build、typecheck、lint、unit 与 integration 测试 |
| 时限 | 快速验证路径 ≤ 3 分钟；全量回归路径目标 ≤ 8 分钟 |
| 规模 | 150–500 个受跟踪文件，≥ 20 个测试文件 |
| 可分解性 | 一个 Goal 可分解为 8–15 个 Task，其中 ≥ 3 个可独立并行就绪 |
| 预置场景 | deterministic failure、merge-only failure、Agent crash、retry、stale-completion |

fixture 基线在 V1 期间保持不变，除非通过明确的 fixture-version Decision；所有场景与预期结果存为版本化 fixture manifest。

暂定候选：**FlowTask @ `b551cfaeb7ce2d42433b29d63c43659a6b9e4d56`**，以两项条件为前提：许可明确确认；在固定的 Node 22 + pnpm 10 工具链下通过可复现性资格测试。若候选在 M0 出口前未满足每一项硬门槛，改用组织自有的参考任务管理应用。

**Blind External Validation Fixture（盲测 fixture）**：在 M4 实现基本完成后独立选定第二个仓库；盲测运行前不得用它调优规划 prompt、路由规则、Task 模板或验证策略。

Controlled fixture 上的成功证明确定性的端到端行为；blind fixture 上的成功提供系统能泛化到预备演示之外的证据。

## 10. Deliverables

### Product Deliverables

- 重新品牌化的跨平台桌面应用（Axiom）；
- Mission-first dashboard；
- Goal/Plan/DAG 管理界面；
- Agent Fleet 和 Attempt 观察界面；
- Verification、Integration 和 Approval 界面；
- 保留的 terminal/editor/diff/browser 工作台；
- `axiom` CLI（Mission 控制与 Worker 命令）。

### Engineering Deliverables

- 扩展后的 orchestration data model 与 migrations：`task_stages` side table（D2）、`approvals` 表（D7）、Submission 与 Candidate 实体（D4）；
- MissionController 和权威状态机；
- Planner/Replanner proposal contract；
- AgentFactory、AgentSpec 和 ContextPackage；
- Scheduler 和 budget/permission Policy；
- typed communication routing；
- 独立的 VerificationService；
- Integration Queue 与 IntegrationController；
- ApprovalGateway；
- audit/recovery 机制；
- DecisionEngine abstraction：RulesEngine 基线必备，Jev 作为可选 provider；
- M0：Orca fork 的品牌、更新、telemetry 和第三方 notice 隔离，以及**网络出口清单 + 断言测试**；
- `axiom.*` RPC 命名空间与 `axiom` CLI（D1）；
- 文档：`docs/GLOSSARY.md`、`docs/PROJECT_CONSTITUTION.md`、`docs/reference/orca-mapping.md`（落位按 D13，提议中）。

### Evidence Deliverables

- 可重放的 V1 demo scenario；
- 每个 Task 的 Attempt 和 Submission 证据；
- 故意失败的验证案例；
- Agent crash/recovery 案例；
- 两个候选各自通过但集成失败的案例；
- 人工 Approval 案例；
- 应用重启恢复案例；
- 网络出口断言测试结果；
- Controlled Acceptance Fixture 的资格测试记录与版本化 fixture manifest（D18）；
- Blind External Validation Fixture 的盲测运行记录（D18）；
- 最终 CompletionReport。

## 11. Success Criteria

V1 只有在以下条件全部满足时才算成功：

| 成功标准 | 可观察证据 |
|---|---|
| Goal 被转换为合法 Task DAG | GoalRevision、`APPROVED` PlanRevision、DAG validation 和 acceptance criteria 可查看 |
| 至少三个 Task 并行执行 | 同一时刻三个 `RUNNING` Attempt，各有独立 worktree 记录 |
| 至少三种 provider 可用 | 三种 provider 各有至少一次完成的 Attempt（不要求同时） |
| Agent 不是状态权威 | 伪造或错误的 `SUBMISSION` 无法直接进入 `INTEGRATION_READY` |
| 验证可以发现真实错误 | 故意引入的测试失败得到 `FAIL`，Task 进入 `NEEDS_FIX` |
| 系统能修复失败 | 生成新 Attempt，重新验证并保留历史 |
| 并行结果能够安全集成 | 集成树回归被执行；冲突进入 `NEEDS_FIX` 或 FIX_TASK，而不是静默覆盖 |
| 系统可恢复 | 应用重启后 Mission 身份、Task stage、Attempt 和证据不丢失 |
| Agent 可替换 | 某次 Attempt 失败后可更换 provider 继续同一 Task |
| 高风险动作需要授权 | 未批准的 promotion 停在 `AWAITING_APPROVAL`，Approval 记录可审计 |
| 完成有证据 | CompletionReport 能关联 Goal、PlanRevision、Task、Attempt、验证和集成结果 |
| 演示可复现 | 全部成功标准在 Controlled Acceptance Fixture 上按 fixture manifest 复现（D18） |
| 有泛化证据 | 在 Blind External Validation Fixture 上完成一次未经调优的端到端运行并记录结果（D18；是否必须通过待定） |

### 建议量化指标

第一阶段使用工程门槛，而不是营销指标：

- `100%` `INTEGRATED` Task 具有 `PASS` 的 VerificationRun；
- `100%` `PROMOTED` IntegrationBatch 具有集成树回归结果；
- `0` 个未授权高风险动作；
- `0` 个因应用重启丢失的权威 Mission/Task 状态；
- `0` 个请求到原厂端点；
- 重复的 `SUBMISSION` 不产生重复状态转换；
- stale Attempt 无法使当前 Task 进入 `SUBMITTED`；
- 所有 `MAJOR_REPLAN` 产生新的 PlanRevision；
- 所有 Approval 能够关联具体 action 和执行结果。

产品效率指标应在可靠性闭环稳定后再收集，例如人类干预次数、完成时间、token/成本、一次验证通过率和重规划频率。

## 12. Non-Goals for V1

V1 不以以下事项为完成条件：

- 完全无人监督地部署到生产环境；
- 支持所有 coding agent 和模型；
- 多用户 SaaS、组织 tenancy 和 enterprise billing；
- 云端大规模 Agent fleet；
- 移动端完整控制；
- 无限制递归创建 Agent；
- 替代 GitHub、Jira 或完整 IDE；
- 训练自有基础模型；
- 将 Jev 作为不可替换的核心依赖；
- Jev 超出 `DecisionEngine` 接口与 RulesEngine 基线之外的实验（D8）；
- 多候选 IntegrationBatch（V1 固定一个候选，D5）；
- 远端/federation 与 mixed-version 验证（D8，M6）；
- 自动解决所有架构和产品歧义；
- 保证 AI 永远生成正确代码。

Non-goal 的意义是保持 V1 聚焦：先证明 Mission 控制闭环可靠，再扩展规模和自动化程度。

## 13. Target User

### Primary User

能够定义产品目标并审阅代码或工程证据的个人开发者、技术创始人或小型工程团队负责人。

他们通常：

- 同时使用多个 Coding Agent；
- 希望并行推进工作；
- 不想手动管理每个 worktree 和终端；
- 需要知道哪些结果真正通过验证；
- 愿意在关键决策和高风险操作上保留控制权。

### Initial Product Assumption

V1 首先服务单个本地用户，而不是多人组织。产品可以使用用户已有的 Claude、Codex、Gemini 或 OpenCode 配置，并在本地 repository 上执行。

## 14. Product Promise

对用户的承诺不是：

> "我们会启动很多 Agent。"

而是：

> "你定义 Mission 的目标，我们把它组织成可观察、可恢复、可验证的工程过程；系统向你展示证据，并只在真正需要你判断时请求介入。"

## 15. Completion Definition

Mission 不能因为所有 Worker 都停止而被标记为完成。收尾依次经过 `EXECUTING → FINALIZING → READY_FOR_APPROVAL →（Delivery 动作）→ COMPLETED`，只有满足以下条件才可进入 `COMPLETED`：

1. 当前 `APPROVED` PlanRevision 中所有 required Task 均已 `INTEGRATED`，或被明确 `CANCELED` 且有授权依据（进入 `FINALIZING` 的前提）；
2. 当前 `ACTIVE` GoalRevision 的所有必需 acceptance criteria 均有证据；
3. 所有必需 VerificationRun 为 `PASS`；
4. 最终 IntegrationBatch 已 `PROMOTED`，且集成基线通过最终全量回归；
5. 没有未解决的 blocking Question、Decision 或 Approval；
6. 风险和已知限制已记录；
7. CompletionReport 已生成；
8. 若 policy 要求，已在 `READY_FOR_APPROVAL` 取得最终交付 Approval；
9. Delivery 成功：集成基线已合入目标分支。

CompletionReport 至少回答：

- 原始目标是什么；
- 实际交付了什么；
- 哪些 GoalRevision、PlanRevision 和 Task 发生过变化；
- 使用了哪些 Agent 和 Attempt；
- 运行了哪些验证；
- 最终 promoted 的是哪些 commit；
- 是否仍有已知限制或风险；
- 为什么系统认为 Mission 已经完成。

## 16. 最终判断

我们真正要 achieve 的不是"构建一个能控制多个 AI Agent 的桌面应用"。

我们要 achieve 的是：

> **证明一个持久化、确定性控制的软件工程系统，能够把多个短生命周期、不同能力且输出需要验证的 AI Agent，组织成一个可以在真实仓库上可靠完成 Mission 的动态团队。**

当平台可以从 Goal 出发，形成 PlanRevision 和 Task DAG，完成多 Agent 执行、独立验证、冲突处理、受控集成、失败恢复、人工治理，并最终提供可审计的完成证据时，这个项目才实现了它的核心目标。

## 修订记录（V1.1 相对 V1）

| # | 修改 | 来源 |
|---|---|---|
| 1 | 文档头：Axiom（D17 确认）、V1.1、基于 V1；加「术语与枚举以 `docs/GLOSSARY.md` 为准」 | A12、D1 |
| 2 | 领域对象 Project → Mission；用户仓库称 repository/仓库；原 §5 改「产品使命」；Project Control Plane → Control Plane；Project Intelligence → Mission Intelligence | D1、A6 |
| 3 | Obj1 对象清单对齐术语表 §3，Milestone 仅为分组标签；新增 Goal 版本化 | A3、A7、A8 |
| 4 | Obj4 消息类型改为八种 | A1、D9（提议中） |
| 5 | Obj5 引入 Submission/Candidate，review 不能推翻 `FAIL`；Obj6 改 IntegrationController、单候选批次、冲突规则；全文改用 task stage 名 | B5、D4、B9、A4、D5、D3、D2 |
| 6 | Obj7 用 replan 分级词汇；Obj8 加「PlanRevision 接受（可按 policy 自动）」 | 术语表 §4.13、A10 |
| 7 | §8 第 1 条改为 Mission 与 GoalRevision；第 4/6 条按 A2 拆分；第 7 条改八种消息；新增第 16 条网络出口验证 | A2、A1、C9 |
| 8 | 新增 §9「V1 范围与里程碑」与「Demo 与验证 fixture」（双 fixture 制、FlowTask 候选与硬门槛）；原 §9–§15 顺延为 §10–§16 | G6、D8、G8、D18 |
| 9 | §10 Engineering Deliverables：MissionController、IntegrationController、`task_stages`、`approvals`、Submission/Candidate、M0 网络出口清单 + 断言测试、`axiom` 命名空间、三份文档 | A4、D2、D7、C9、C11、D13（提议中） |
| 10 | §11 成功标准：拆分并行/provider；新增 0 个原厂请求；`worker_done` → 伪造或错误的 `SUBMISSION` 无法直接进入 `INTEGRATION_READY` | A2、C9、C1 |
| 11 | §12 Non-Goals 新增多候选批次、远端/federation 与 mixed-version、Jev 超出接口与基线的实验 | D5、D8 |
| 12 | §15 Completion Definition 对齐 Mission 状态与精确 stage 名 | B7、术语表 §4.1 |
