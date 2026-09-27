# 自主软件工程控制平台：Project Charter V1

更新日期：2026-09-26  
项目代号：待定  
文档状态：V1 基线

## 1. Project Description

本项目将构建一个**目标驱动的自主软件工程控制平台**。

用户描述想要构建或修改的软件、技术约束和验收要求。平台理解项目和现有代码库，将目标转化为版本化计划与 Task DAG，动态组织适合每项任务的 AI Agent，在隔离的 Git worktree 中执行工作，并对结果进行独立验证和受控集成。

平台支持 Claude Code、Codex、Gemini、OpenCode 等可替换执行者。Agent 可以崩溃、重试或更换模型，但 Project、Task、Decision、Artifact、Verification 和 Approval 等项目状态持续存在。

平台以 Orca 衍生的执行内核承载终端、PTY、Git、worktree、Agent 会话、SSH/WSL 和远端运行；我们的核心产品价值位于项目级 Control Plane：规划、调度、上下文管理、验证、集成、重规划和人工治理。

### 一句话描述

> 将软件项目目标转化为可执行、可验证的任务图，并协调专业 AI Agent 团队持续推进项目直至完成。

### 英文描述

> A goal-driven software engineering control plane that turns project goals into verifiable task graphs and coordinates specialized AI agents through planning, execution, verification, integration, and delivery.

## 2. Subject

本项目研究和建设的主题是：

> **如何把多个能力不同、生命周期短暂且输出不完全可信的 AI Coding Agents，组织成一个能够长期、可靠地交付完整软件项目的工程系统。**

这个主题包含五个核心问题：

1. 如何将开放式 Project Goal 转化为结构化、可版本化的 Plan 和 Task DAG；
2. 如何根据 Task 动态选择 Agent、模型、技能、上下文、权限和工作区；
3. 如何使 Agent 在不共享无限 conversation 的情况下协作；
4. 如何独立验证 Agent 的工作，并安全地集成并行修改；
5. 如何在 Agent 失败、环境中断或计划变化时恢复和重新规划，同时保持人类控制权。

因此，本项目的 subject 不是“哪个模型写代码最好”，也不是“如何同时打开更多终端”。它关注的是多 Agent 软件工程的**控制、证据、可靠性和治理**。

## 3. Problem Statement

现有 AI Coding Agent 通常以单个会话或单次任务为中心。即使多个 Agent 可以并行运行，仍存在以下系统性问题：

- 项目目标、任务和 Agent 会话混在 conversation 中，没有持久化权威状态；
- Agent 能完成局部编码，却缺少项目级依赖和完成度判断；
- Worker 自己声称“完成”，没有独立验收；
- 并行 worktree 各自通过测试，但合并后可能冲突或失败；
- Agent 间直接对话会造成上下文膨胀和 N² 通信；
- Agent 失败或会话丢失后，任务状态难以恢复；
- 权限、预算、递归创建 Agent 和危险操作缺少系统治理；
- 人类要持续 prompt、追踪、复查和手动合并，无法真正委托项目。

我们需要一个独立于任何单个 Agent 的项目控制系统，让软件交付过程具有持久状态、明确权威、验证证据和可恢复生命周期。

## 4. Vision

> 让一个人能够像管理高水平软件团队一样，向 AI 团队交付完整项目目标，而不必逐个会话指导每一个实现步骤。

长期愿景是：用户描述想要实现的软件及其边界，平台能够在透明、可审查和受治理的条件下，自主组织执行过程，并向用户交付经过验证的结果和完整证据链。

我们追求的不是“完全不需要人”，而是让人类从日常调度和重复确认中解放出来，专注于产品意图、关键权衡和高风险批准。

## 5. Mission

> 建立一个可靠的 Project Control Plane，把 AI Agent 的推理与执行能力转化为持续、可验证的软件工程交付能力。

Mission 包含四项长期责任：

- 把意图变成结构化计划；
- 把计划变成受控执行；
- 把执行结果变成验证证据；
- 把验证候选变成可安全交付的集成结果。

## 6. Primary Goal

本项目的首要目标是：

> **实现一个端到端的本地优先系统，使用户只需定义一个中等规模软件项目的目标、约束和验收标准，系统即可生成计划与 Task DAG，动态调度多个 AI Agent，在隔离工作区中并行实现，独立验证每项提交，处理失败和冲突，经过受控集成及必要的人工批准后，交付一个可运行且满足验收条件的项目结果。**

这个 Goal 包含清晰的完成含义：平台不仅能启动 Agent，还必须证明 Agent 的工作经过验证、合并后的系统仍然正确，并能够解释为什么项目被判定为完成。

## 7. Strategic Objectives

### Objective 1：建立持久化项目模型

建立 Project、Goal、PlanRevision、Milestone、Task、Attempt、Artifact、Decision、VerificationRun、IntegrationBatch 和 Approval 等权威对象。

预期结果：关闭应用或 Agent 崩溃后，项目状态能够恢复；Task 生命周期不依赖 Agent 生命周期。

### Objective 2：从 Goal 生成可执行 Task DAG

让 Project Intelligence 分析需求和代码库，生成结构化计划、依赖关系、验收标准和风险；由 Control Plane 校验并持久化。

预期结果：所有可执行 Task 都有明确输入、依赖、范围、验收标准和完成证据要求。

### Objective 3：动态组织 Agent，而不是固定角色

根据 Task 的 capability、成本、风险、上下文和 provider 状态生成 AgentSpec，选择模型、reasoning、权限、预算与 worktree。

预期结果：同一系统能为前端、数据库、研究、测试或安全任务生成不同执行合同，并能在失败后换 Agent 重试。

### Objective 4：建立受控的 Agent 协作协议

通过 typed messages、Decision 和 Artifact 实现 QUESTION、BLOCKED、HANDOFF、REQUEST_SUBTASK 等协作，不依赖 Agent 阅读彼此完整 conversation。

预期结果：上下文随项目规模增长仍可控制；通信可路由、可查询、可审计。

### Objective 5：让验证独立于 Worker

Worker 的完成报告只能进入 Submission。独立 Verification 根据不可变 commit、测试、lint、typecheck、build、验收标准和 diff 生成 verdict。

预期结果：没有验证证据的 Task 不能进入集成队列；错误的“完成”报告会被拒绝或退回修复。

### Objective 6：建立可靠的并行集成机制

所有通过验证的候选进入单一 Integration Queue，由 integration owner 串行应用，并在合并后的代码树上运行完整测试。

预期结果：能够发现“每个分支单独通过、合并后失败”的问题，并创建 conflict/fix Task。

### Objective 7：支持恢复、重试和重规划

平台识别 Agent crash、远端失联、连续验证失败、依赖变化和架构假设失效，执行安全重试、局部调整或新 PlanRevision。

预期结果：失败不会导致整个项目状态丢失；系统也不会把 `unverifiable` 错判为失败或完成。

### Objective 8：保留人类治理

对需求歧义、权限提升、预算升级、不可逆操作、数据迁移和 promotion 设置明确 Approval Gate。

预期结果：系统自动处理日常协调，但不会未经授权执行高风险动作。

### Objective 9：提供 Project-first 用户体验

用户首先看到 Goal、Plan、DAG、Progress、Risk、Evidence 和 Approvals；终端、diff、编辑器是可钻取的执行工作台。

预期结果：用户管理的是项目和结果，不是几十个无法区分的终端窗口。

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

1. 为一个本地 Git repository 创建 Project 和 Goal；
2. 生成可审阅且可版本化的 PlanRevision；
3. 建立带 dependencies 和 acceptance criteria 的 Task DAG；
4. 至少支持 Claude Code、Codex、Gemini/OpenCode 中三种执行者；
5. 根据 Task 动态生成 AgentSpec 与 ContextPackage；
6. 在隔离 worktree 中并行执行至少三个 Task；
7. 支持 typed question、blocked、handoff 和 submission；
8. 将 Worker 提交与验证通过严格分离；
9. 对不可变候选运行 deterministic checks；
10. 支持 verification failure → fix/retry；
11. 支持串行集成和合并后全量回归；
12. 支持 conflict → conflict task；
13. 对高风险 promotion 请求人工批准；
14. 应用重启后恢复 Project、Task、Attempt 和 Evidence；
15. 根据所有 completion gates 给出最终完成判断和项目报告。

## 9. Deliverables

### Product Deliverables

- 重新品牌化的跨平台桌面应用；
- Project-first dashboard；
- Goal/Plan/DAG 管理界面；
- Agent Fleet 和 Attempt 观察界面；
- Verification、Integration 和 Approval 界面；
- 保留的 terminal/editor/diff/browser 工作台；
- 项目控制 CLI。

### Engineering Deliverables

- 扩展后的 orchestration data model 与 migrations；
- ProjectController 和权威状态机；
- Planner/Replanner proposal contract；
- Agent Factory、AgentSpec 和 ContextPackage；
- Scheduler 和 budget/permission policy；
- typed communication routing；
- independent Verification service；
- Integration Queue 与 integration owner；
- Approval Gateway；
- audit/recovery 机制；
- DecisionEngine abstraction，Jev 作为可选 provider；
- Orca fork 的品牌、更新、telemetry 和第三方 notice 隔离。

### Evidence Deliverables

- 可重放的 V1 demo scenario；
- 每个任务的 Attempt 和提交证据；
- 故意失败的验证案例；
- Agent crash/recovery 案例；
- 两个分支分别通过但集成失败的案例；
- 人工 approval 案例；
- 应用重启恢复案例；
- 最终项目 completion report。

## 10. Success Criteria

V1 只有在以下条件全部满足时才算成功：

| 成功标准 | 可观察证据 |
|---|---|
| Goal 被转换为合法 Task DAG | PlanRevision、DAG validation 和 acceptance criteria 可查看 |
| 至少三个 Agent 并行工作 | 三个独立 Attempt、worktree 和 provider/session 记录 |
| Agent 不是状态权威 | 伪造或错误的 `worker_done` 无法直接进入 integration-ready |
| 验证可以发现真实错误 | 故意引入的测试失败被 VerificationRun 拒绝 |
| 系统能修复失败 | 生成 fix/retry Attempt，重新验证并保留历史 |
| 并行结果能够安全集成 | 合并后测试执行，冲突会创建 Task 而不是静默覆盖 |
| 系统可恢复 | 应用重启后项目身份、任务和证据不丢失 |
| Agent 可替换 | 某次 Attempt 失败后可更换 provider 继续同一 Task |
| 高风险动作需要授权 | 未批准 promotion 被阻止，批准记录可审计 |
| 完成有证据 | Completion Report 能关联所有目标、Task、验证和集成结果 |

### 建议量化指标

第一阶段使用工程门槛，而不是营销指标：

- `100%` integrated Task 具有通过的 VerificationRun；
- `100%` promoted IntegrationBatch 具有合并后回归结果；
- `0` 个未授权高风险动作；
- `0` 个因应用重启丢失的权威 Project/Task 状态；
- 重复 worker completion 不产生重复状态转换；
- stale Attempt 无法完成当前 Task；
- 所有重大 Plan 变化产生新的 PlanRevision；
- 所有人工批准能够关联具体 action 和执行结果。

产品效率指标应在可靠性闭环稳定后再收集，例如人类干预次数、完成时间、token/成本、一次验证通过率和重规划频率。

## 11. Non-Goals for V1

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
- 自动解决所有架构和产品歧义；
- 保证 AI 永远生成正确代码。

Non-goal 的意义是保持 V1 聚焦：先证明项目控制闭环可靠，再扩展规模和自动化程度。

## 12. Target User

### Primary User

能够定义产品目标并审阅代码或工程证据的个人开发者、技术创始人或小型工程团队负责人。

他们通常：

- 同时使用多个 Coding Agent；
- 希望并行推进项目；
- 不想手动管理每个 worktree 和终端；
- 需要知道哪些结果真正通过验证；
- 愿意在关键决策和高风险操作上保留控制权。

### Initial Product Assumption

V1 首先服务单个本地用户，而不是多人组织。产品可以使用用户已有的 Claude、Codex、Gemini 或 OpenCode 配置，并在本地 repository 上执行。

## 13. Product Promise

对用户的承诺不是：

> “我们会启动很多 Agent。”

而是：

> “你定义项目目标，我们把它组织成可观察、可恢复、可验证的工程过程；系统向你展示证据，并只在真正需要你判断时请求介入。”

## 14. Completion Definition

项目不能因为所有 Worker 都停止而被标记为完成。只有满足以下条件才可进入 `COMPLETED`：

1. 当前 Goal 的所有必需 acceptance criteria 均有证据；
2. 当前 PlanRevision 中所有 required Task 均已 integrated 或被明确取消且有批准依据；
3. 所有 VerificationRun 的必需检查通过；
4. 最终 IntegrationBatch 已在目标 base 上通过完整回归；
5. 没有未解决的 blocking Decision、Question 或 Approval；
6. 风险和已知限制已记录；
7. 最终 Completion Report 已生成；
8. 若 policy 要求，用户已批准最终交付。

Completion Report 至少回答：

- 原始目标是什么；
- 实际交付了什么；
- 哪些 Task 和 Plan 发生过变化；
- 使用了哪些 Agent 和 Attempt；
- 运行了哪些验证；
- 最终集成的是哪些 commit；
- 是否仍有已知限制或风险；
- 为什么系统认为项目已经完成。

## 15. 最终判断

我们真正要 achieve 的不是“构建一个能控制多个 AI Agent 的桌面应用”。

我们要 achieve 的是：

> **证明一个持久化、确定性控制的软件工程系统，能够把多个短生命周期、不同能力且输出需要验证的 AI Agent，组织成一个可以可靠完成真实项目的动态团队。**

当平台可以从 Goal 出发，形成 Plan 和 Task DAG，完成多 Agent 执行、独立验证、冲突处理、受控集成、失败恢复、人工治理，并最终提供可审计的完成证据时，这个项目才实现了它的核心目标。
