# Axiom 决策日志（Decision Log）V1

更新日期：2026-09-26
状态说明：`ACCEPTED` = Henry 已拍板；`PROPOSED` = 审查中提出、设计 v1.1 已按此撰写、**等待批准**；`REJECTED` = 提议被否决（保留记录）；`SUPERSEDED` = 被后续决策取代。带字母后缀的条目（如 D6a、D7a）是对已拍板决策的修正提议。
本日志是「Decision 需有出处、备选、理由与取代规则」这条规则在文档层的落地；代码里的 `decisions` 表应从这里的条目起编号。

---

## D1 · 顶层对象改名为 Mission，RPC/CLI 使用 `axiom` 前缀 — ACCEPTED

**背景**：Orca 已存在 `project.list` / `project.update` RPC、`orca project` CLI 与 `Project` 类型（仓库/provider 身份）。设计 V1 §16 拟新增的 `project.*` 方法会因重名在启动时抛 `duplicate_rpc_method`，且概念与 Orca 的 Project 混淆。
**备选**：(a) 保留 Project 一词、只加 `axiom.` 前缀；(b) 顶层对象改名，彻底避开；(c) 用 `cp.*` 前缀。
**决定**：(b)。顶层对象 = **Mission**；RPC 命名空间 `axiom.mission.*`、`axiom.plan.*`、`axiom.task.*`、`axiom.attempt.*`、`axiom.verification.*`、`axiom.integration.*`、`axiom.approval.*`、`axiom.decision.*`、`axiom.artifact.*`（术语表 §1 另扩展 `axiom.goal.*`、`axiom.message.*`、`axiom.policy.*`）；CLI 为 `axiom …`。产品代号 **Axiom**（D17 已确认）。
**理由**：与 Orca 概念零重叠；Mission 语义（有目标、需完成证据）贴切；源码核查 Mission 仅出现在 macOS「Mission Control」快捷键文案中。
**后果**：两份文档全文替换域对象 Project → Mission；用户的代码仓库统一称「repository / 仓库」；UI 不使用「Mission Control」作为标签以免与 macOS 混淆；章程原 §5 标题改为「产品使命」。
**取代规则**：无（代号已由 D17 定案）。

## D2 · Task 的项目级权威状态放在 side table `task_stages` — ACCEPTED

**背景**：Orca `tasks.status` 是 CHECK 枚举（`pending/ready/dispatched/completed/failed/blocked`），改枚举需重建表并影响降级；`worker_done succeeded` 会把 Task 置 `completed` 并在同一事务 `promoteReadyTasks` 解锁依赖任务。设计 V1 §6.2「两套投影、稳定后再看」与不变量 6 相抵触，且不接管 readiness 会违反不变量 4/8。
**备选**：(a) side table 为权威；(b) 迁移改 CHECK 枚举、单表单状态；(c) 维持原文。
**决定**：(a)。新表 `task_stages`（字段 `stage`，审查报告中曾称 delivery stage；改名是为了把「delivery」一词留给 Mission 级的最终交付：`DEFINED → READY → RUNNING → SUBMITTED → VERIFYING → VERIFIED → INTEGRATION_READY → INTEGRATED`，旁路 `NEEDS_FIX / BLOCKED / CANCELED`）是**唯一**项目级权威；Orca `tasks.status` 降为「Attempt 执行投影」，`completed` 语义 = 「Attempt 已结算」，任何 UI/CLI 不得把它显示为「完成」。
**理由**：符合上游「只加不改」惯例（`attempt_observation_facts` 先例）；不破坏 schema 降级；满足不变量 6。
**后果**：readiness 由 MissionController 按 task stage 计算（见 D10）；`orchestration.taskUpdate` 对 Axiom 管理的 Task 需拒绝直接改 status；UI 投影层需要 stage → 展示文案的映射。
**取代规则**：V2 若决定合并为单状态，需新 Decision 并附迁移与降级方案。

## D3 · 集成失败时原 Task 的处理规则 — ACCEPTED

**决定**：
- 文本冲突（git 无法自动合并）→ 原 Task 回 `NEEDS_FIX`，新 Attempt 的 ContextPackage 携带冲突证据（本质是 rebase 任务）；
- 合并成功但集成树回归失败（跨任务语义冲突）→ 新建 `FIX_TASK`，相关 Task 保持 `INTEGRATION_READY` 并对 FIX_TASK 加依赖；
- 两种情况下原候选一律标记 `SUPERSEDED`，不得再次入队。
**理由**：文本冲突只涉及单个候选，重做最省；语义冲突涉及多个已验证候选，作废它们会浪费验证证据，用新 Task 修复更可审计。

## D4 · 候选 commit 由 Control Plane 在提交时生成快照 — ACCEPTED

**决定**：Worker 发出 `SUBMISSION` 后，Control Plane 在该 Attempt 的 worktree 上生成快照 commit（若工作区 clean 且 HEAD 已含全部改动则直接采用 HEAD），并以该 commit / tree hash 作为唯一不可变候选身份写入 Submission。
**理由**：不依赖各 provider 是否自行 commit；保证 VerificationRun 与 IntegrationBatch 绑定同一不可变对象；防止 Worker 提交后继续改动工作区。
**后果**：Attempt worktree 在结算后进入只读/保留状态直至候选 `SUPERSEDED` 或 Task `INTEGRATED`。

## D5 · V1 集成批次固定 size = 1 — ACCEPTED

**决定**：每个 IntegrationBatch 只含一个候选，按队列顺序串行应用；多候选批次留到 V1 之后。
**理由**：先把闭环跑通；避免批内部分冲突时的回退策略复杂度。
**取代规则**：引入多候选批次时须定义「部分冲突」策略并新开 Decision。

## D6 · 分支模型 — ACCEPTED

**决定**：
- 集成基线分支：`axiom/integration/<missionId>`，由 IntegrationController 独占写入；
- Attempt 分支：`axiom/attempt/<taskId>/<attemptId>`，在 child worktree 中从当前集成基线创建；（已由 D6a 取代）
  **修正（提议中，D6a）**：dispatch id（≡ attemptId）由 Orca 在 `createDispatchContext` 时铸造，晚于 worktree 与分支创建，因此分支名改为 `axiom/attempt/<taskId>/<seq>`（seq = 该 Task 的 Attempt 序号，Control Plane 递增），`attempt_bindings` 记录 `dispatch_id ↔ seq ↔ branch`；集成临时分支 `axiom/integrating/<batchId>`。
- promotion = 将集成基线合入用户指定的目标分支（默认仓库默认分支），按 policy 需 Approval；（措辞已由 D6a 修正）
  **修正（提议中，D6a 续）**：术语表把两件事分开——批次 promotion（`PROMOTED`）= 集成基线 ref 前进到批次合并 commit；**Delivery** = 集成基线合入目标分支（`axiom.mission.deliver`），按 policy 需交付 Approval。
- 目标分支与集成基线都属于「受保护分支」：Worker Attempt 不得直接合入。
**理由**：与指令「不得从 Worker Attempt 直接合入受保护的集成或主分支」一致；分支名前缀便于清理与识别。

## D7 · Approval 独立存储于 `approvals` 表 — ACCEPTED

**背景**：Orca `decision_gates` 的 `resolveGate` 不校验 resolution 是否在 `options` 内、无 pending-only 守卫、不记录 resolver 身份与过期；`createGate` 会把活跃 dispatch 标 `completed` 并把 Task 置 `blocked`。
**决定**：新建 `approvals` 表（action kind、scoped inputs hash、risk、requested_by、expires_at、resolver、resolution、outcome、executed_at）；Orca decision gate 仅用于 `QUESTION` 类阻塞。
**修正（提议中，D7a）**：映射核查发现 `createGate` 在 supervised worker 活跃时会拒绝，因此 gate 只能承载**没有活跃 Attempt** 的 Task 级 QUESTION（Planner/人类澄清）；Worker 运行中的提问走 `axiom attempt ask` → Orca `question_threads`。
**理由**：Approval 必须绑定精确动作与有效期，gate 的语义与守卫都达不到。

## D8 · V1 范围 = M0–M4 + M5 抽象层 — ACCEPTED

**决定**：V1 包含 M0（隔离）、M1（Mission Facade）、M2（Planning 与 Agent Factory）、M3（Independent Verification）、M4（Controlled Integration），以及 M5 中的：`DecisionEngine` 接口与 RulesEngine 基线实现、replan 分级触发（`NO_REPLAN / MINOR_ADJUSTMENT / MAJOR_REPLAN`，由规则判定）、`MAJOR_REPLAN` → Replanner 提出新 PlanRevision → 人工/policy 批准 → 旧 revision `SUPERSEDED` 的完整流程。放到 V1 之后的是：Jev 或其它学习型 DecisionEngine provider 的实验、基于历史表现/成本的 provider 路由学习、M6 remote/federation/mixed-version 验证。
**理由**：章程 Objective 7 与量化指标（「所有重大 Plan 变化产生新的 PlanRevision」）要求 V1 具备重规划闭环；可替换性只需接口 + 基线即可证明。

---

## D9 · 消息类型映射：产品类型放 payload，不改 Orca CHECK 枚举 — PROPOSED

**背景**：`messages.type` 有 CHECK 约束（九种 Orca 类型）；新增枚举需迁移重建表。
**提议**：Axiom 八种类型作为 `payload.axiom.type` 持久化，`messages.type` 只用于路由语义，映射见术语表 §5；`merge_ready` 在 Axiom 中不允许由 Worker 发出（发出即拒绝）。
**理由**：零 schema 变更、保留 Orca 的 mailbox / 唤醒 / 幂等机制；产品语义仍可查询（payload 为 JSON）。
**风险**：按产品类型过滤需要 JSON 查询或额外索引表；如成为瓶颈再迁移。

## D10 · Orca `tasks.deps` 对 Axiom 管理的 Task 保持为空，DAG 只存于 Axiom 边表 — PROPOSED

**背景**：Orca `promoteReadyTasks` 只看 `tasks.deps` 与 `completed`，会在上游仅「提交」时把下游置 `ready`。
**提议**：Axiom 创建 Orca Task 时 `deps = []`（Orca 侧立即 `ready`，仅表示「可被派发」这一必要条件）；依赖边存于 `mission_task_edges`；MissionController 的 Scheduler 是 Axiom Task 的唯一派发者，按 task stage 判断 READY；对 Axiom 管理的 Task，直接 `orchestration.workerStart` / `dispatch` 需被 admission 校验拒绝。
**理由**：不与 Orca 的提升逻辑打架；readiness 权威单一。

## D11 · Worker ↔ Control Plane 通道 = `axiom` CLI → `axiom.*` RPC，复用 Orca dispatch capability — PROPOSED

**提议**：Worker 侧命令 `axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check`（命令形状由 D16 定为 `axiom attempt <verb>`），直接调用 `axiom.attempt.*` RPC；RPC 层复用 Orca 的 `--dispatch-capability` 校验（`hasLifecycleAuthority` + capability hash + `consumer_generation` 栅栏 + `mutation_receipts` 幂等）；Control Plane → Worker 的回复仍通过 Orca `dispatch:<id>` mailbox 投递以复用唤醒/nudge 机制。不引入 MCP server。
**理由**：Orca 已有 stale/duplicate/unauthorized 拒绝码，正好满足章程的两条量化指标；避免第二套认证。

## D12 · Axiom 代码放独立强类型模块，不进入 `@ts-nocheck` 的 `orca-runtime-*.ts` — PROPOSED

**背景**：约 150 个 `orca-runtime-*.ts` 非测试模块中 137 个 `@ts-nocheck`。
**提议**：Control Plane 代码位于 `src/main/axiom/`（或等价目录），仅通过 RPC 方法注册与 service 边界接入 runtime；禁止在 `@ts-nocheck` 文件内新增 Axiom 逻辑。

## D13 · 文档语言与文件落位 — PROPOSED

**提议**：章程、架构、术语表、映射参考、决策日志为中文（英文术语保留）；`docs/PROJECT_CONSTITUTION.md` 与根 `AGENTS.md` 为英文（面向所有 AI 贡献者，与上游一致）。Claude Project 文档名 → 仓库路径：
`project-charter-v1.1.md → docs/PROJECT_CHARTER.md`；`architecture-v1.1.md → docs/ARCHITECTURE.md`；`glossary-v1.md → docs/GLOSSARY.md`；`project-constitution-v1.md → docs/PROJECT_CONSTITUTION.md`；`agents-md-v1.1.md → AGENTS.md`；`orca-mapping-v1.md → docs/reference/orca-mapping.md`；`decision-log-v1.md → docs/decisions/DECISION_LOG.md`。
## D14 · Control Plane 以 session party 身份调用 Orca 运行时 — PROPOSED（按基线 3eb1adec2 修订）

**背景**：Orca 上游 #22555（已包含在冻结基线中）把所有 caller/target 统一解析为一个 orchestration party `{address, terminalHandle, paneKey, orcaSessionId}`（`src/main/runtime/orchestration/orchestration-party.ts`、`orchestration-caller-identity.ts`）；Run 绑定键是 pane key **或** Orca session id（`hasRunBindingKey`）；`createRun` 已接受 `coordinatorOrcaSessionId` 且 handle/pane 可为 null（`db/runs/run-create.ts`）；session caller 在 RPC 入口即被解析，`worker-start` 等动词对 session caller 不再要求 `from`。Axiom 的 Scheduler 是服务，不是终端。
**提议**：Control Plane 作为 **session party** 参与 orchestration——为每个 Mission 铸造一个符合 `isOrcaSessionId` 格式的合成 session id（不以 `term_`/`structworker_` 开头，不对应真实 agent 会话），用它 `createRun({coordinatorHandle: null, coordinatorPaneKey: null, coordinatorOrcaSessionId})`；Control Plane 在进程内直接构造 `OrchestrationSessionCaller`（`workspaceId` = Mission 仓库工作区），经 service 边界调用 `startLocalWorker` 等，不走 env 注入、不走参数声明（`resolveDeclaredCallerParty` 会拒绝以参数声明的 chat 型 caller，进程内路径不受此限）；dispatch creator 用既有 `{kind:'system'}`（`db/dispatch-depth.ts`，深度恒为 1）；`workerStart` 仍需 additive 增加可选的直供 `worktreeId` / `branchNameOverride`（D6a）。
**风险**：`resolveOrcaSessionParty` 把未记录为 structured worker 的 session id 视为 chat（`terminalHandle: null`）——作为 Run coordinator 与 mailbox 地址（`session:<id>`）可行，但任何依赖 handle 的路径（如旧式 mail 键）需要逐一核实；合成 id 必须持久化在 `missions` 表并在重启后复用，否则 Run 绑定失效。

## D15 · `axiom.*` mutation 纳入 Orca 契约栅栏与幂等收据 — PROPOSED

**背景**：契约栅栏（`orchestrationContractVersion`）与 `mutation_receipts` 幂等都由 `ORCHESTRATION_MUTATION_METHODS` 集合驱动，CLI 只给 `orchestration.` 前缀打版本戳。
**提议**：additive 扩展该集合与 CLI 打戳逻辑，把 `axiom.*` 的 mutation 方法纳入同一栅栏与收据机制，而不是另起一套。

## D16 · Worker CLI 命令挂在 `axiom attempt <verb>` 下 — PROPOSED

**背景**：Orca CLI 已有顶层浏览器命令 `check`（`src/cli/specs/browser-basic.ts`），`axiom check` 会重名。
**提议**：Worker 面向的命令统一为 `axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check`；术语表已同步。

## D17 · 产品代号定为 Axiom — ACCEPTED

**决定**：产品代号 **Axiom**（Henry 于 2026-09-26 确认）。桌面应用、`axiom` CLI、`axiom.*` RPC 前缀、`axiom/*` 分支前缀、`<userData>/axiom/` 数据目录、`src/main/axiom/` 代码目录均沿用；D1 中「待最终确认」的保留条件解除。

## D18 · Demo 与验证 fixture 采用双 fixture 制（G8） — ACCEPTED

**决定**（Henry 提供的原文，作为规范文本保留）：

> ## G8 — Demo and Validation Fixtures
>
> V1 uses two independent fixture classes.
>
> ### Controlled Acceptance Fixture
>
> The primary V1 demo and acceptance repository SHALL be a frozen, organization-controlled repository with:
>
> - an explicit redistribution license;
> - a pinned commit, Node version, and package-manager version;
> - deterministic offline build, typecheck, lint, unit, and integration tests;
> - a fast verification path of no more than 3 minutes;
> - a full regression path targeted at no more than 8 minutes;
> - 150–500 tracked files and at least 20 test files;
> - one Goal decomposable into 8–15 Tasks, with at least three Tasks independently ready for parallel execution;
> - predefined deterministic failure, merge-only failure, Agent crash, retry, and stale-completion scenarios.
>
> The fixture baseline SHALL remain unchanged during V1 except through an explicit fixture-version Decision. All scenarios and expected outcomes SHALL be stored as versioned fixture manifests.
>
> The provisional candidate is FlowTask at `b551cfaeb7ce2d42433b29d63c43659a6b9e4d56`, conditional on explicit license confirmation and a green reproducibility qualification under a pinned Node 22 and pnpm 10 toolchain.
>
> If the candidate does not satisfy every hard gate before the M0 exit, the project SHALL use an organization-owned reference task-management application instead.
>
> ### Blind External Validation Fixture
>
> A second, independently selected repository SHALL be chosen after the M4 implementation is substantially complete.
>
> It SHALL NOT be used to tune planning prompts, routing rules, Task templates, or verification policies before the blind validation run.
>
> Success on the controlled fixture proves deterministic end-to-end behavior. Success on the blind fixture provides evidence that the system generalizes beyond its prepared demonstration.

**要点**：
- **Controlled Acceptance Fixture**：冻结的、组织可控的仓库；硬门槛 = 明确的再分发许可、固定 commit / Node / 包管理器版本、确定性离线 build/typecheck/lint/unit/integration、快速验证路径 ≤ 3 分钟、全量回归 ≤ 8 分钟（目标）、150–500 个受跟踪文件且 ≥ 20 个测试文件、一个 Goal 可分解为 8–15 个 Task 且 ≥ 3 个可并行就绪、预置 deterministic failure / merge-only failure / Agent crash / retry / stale-completion 场景。基线在 V1 期间不变，除非有 fixture-version Decision；场景与预期结果存为版本化 fixture manifest。
- **候选**：FlowTask @ `b551cfaeb7ce2d42433b29d63c43659a6b9e4d56`，以「许可确认 + Node 22 / pnpm 10 下可复现资格测试通过」为条件；M0 出口前未过全部硬门槛则改用自有的参考任务管理应用。
- **Blind External Validation Fixture**：M4 基本完成后独立选定；盲测前不得用它调优规划 prompt、路由规则、Task 模板或验证策略。Controlled fixture 证明确定性端到端行为；blind fixture 提供泛化证据。

**后果**：M0 出口标准新增「Controlled Acceptance Fixture 资格测试」；章程 §9 与架构 §20/§21 据此改写；fixture manifest 成为 Evidence Deliverable；AGENTS.md 增加 fixture 使用规则。
**待明确**：盲测是否必须「通过」才算 V1 成功，还是「已执行并记录结果」即可（原文只说 success 提供泛化证据）。

## D19 · fork 基线冻结在上游 `3eb1adec2`（tag `axiom-base`） — ACCEPTED

**背景**：文档审计快照为 `646e9a5`（2026-09-25）；连接仓库时 fork `LaPaGaYo/Axiom` 的 main 已在 `408499ec5`（比快照多 137 个上游提交），上游 main 又前进到 `3eb1adec2`（2026-09-26，#23291）。fork 内尚无任何 Axiom 改动。
**决定**（Henry 2026-09-26）：先 fast-forward 到上游 main `3eb1adec2` 再冻结。已执行：`git merge --ff-only upstream/main`，本地 tag `axiom-base = 3eb1adec2`（push 到 origin 待在 Mac 上完成）。V1 期间不再同步上游，除非新的 Decision。
**复核**：`646e9a5..3eb1adec2` 共 148 个提交，触及 orchestration/RPC 的 11 个中只有 #22555（party 解析）改变了编排模型（见 D14 修订）；其余为 native-chat、session tab、终端 handoff 移除等外围改动。审计报告的关键结论（`worker_done` 直接 `completed` 并解锁下游、`project.*` 占用、消息类型 CHECK 枚举、artifact 强制 onorca.dev 域、coordinator 已退役、`nestedWorkerMaxDepth=1`、`SCHEMA_VERSION=42`、`docs/` 缺 ARCHITECTURE/CONSTITUTION/CHARTER、`@ts-nocheck` 基线 132 个 runtime 模块）在新基线上全部复核成立。

## D20 · OpenAI 模型的接入方式：A-lite（Codex 在 Mac 上运行，由 Claude 经计算机使用启动） — ACCEPTED

**背景**：Claude 可用的两个 shell（Mac 上的本地 Linux 沙盒、云端沙盒）对 `api.openai.com` 与 `chatgpt.com` 的连接都被网络策略拦截（代理 403）；本地沙盒也看不到 Mac 上已登录的 `~/.codex`；仓库要求 Node 24 + pnpm 12 与 Electron 原生模块，沙盒只有 Node 22、无 pnpm，因此 `pnpm install / tc / test` 也只能在 Mac 上跑。
**决定**（Henry 2026-09-26）：Codex CLI 在 Henry 的 Mac 上运行；Claude 通过「计算机使用」在 Terminal 中启动 `codex exec`（以及 pnpm 安装/检查命令），Task 简报与运行日志放在仓库的 `.axiom-work/`（简报纳入版本控制，日志 gitignore）；Claude 通过连接的文件夹读取结果、审核 diff、发起验证命令。
**理由**：这是当前网络策略下唯一能让 Codex 真正在仓库里干活的方式；也是 Axiom 「简报 → Worker 执行 → 独立验证 → 集成」流程的手工演练。
**取代规则**：若网络设置放行 `api.openai.com` 且提供 OpenAI API key，可改为 Claude 直接驱动 Codex（原方案 A）。
