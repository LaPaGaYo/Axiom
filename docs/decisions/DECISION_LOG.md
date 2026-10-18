# Axiom 决策日志（Decision Log）V1

更新日期：2026-09-26
状态说明：`ACCEPTED` = Henry 已拍板；`PROPOSED` = 审查中提出、设计 v1.1 已按此撰写、**等待批准**；`REJECTED` = 提议被否决（保留记录）；`SUPERSEDED` = 被后续决策取代。带字母后缀的条目（如 D6a、D7a）是对已拍板决策的修正提议。
本日志是「Decision 需有出处、备选、理由与取代规则」这条规则在文档层的落地；代码里的 `decisions` 表应从这里的条目起编号。
延期到某个触发点再决定的事项登记在 `DEFERRED.md`（里程碑出口检查必须核对）。

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
  **修正（D6a，ACCEPTED Henry 2026-10-17）**：dispatch id（≡ attemptId）由 Orca 在 `createDispatchContext` 时铸造，晚于 worktree 与分支创建，因此分支名改为 `axiom/attempt/<taskId>/<seq>`（seq = 该 Task 的 Attempt 序号，Control Plane 递增），`attempt_bindings` 记录 `dispatch_id ↔ seq ↔ branch`；集成临时分支 `axiom/integrating/<batchId>`。
- promotion = 将集成基线合入用户指定的目标分支（默认仓库默认分支），按 policy 需 Approval；（措辞已由 D6a 修正）
  **修正（D6a 续，ACCEPTED Henry 2026-10-17）**：术语表把两件事分开——批次 promotion（`PROMOTED`）= 集成基线 ref 前进到批次合并 commit；**Delivery** = 集成基线合入目标分支（`axiom.mission.deliver`），按 policy 需交付 Approval。
- 目标分支与集成基线都属于「受保护分支」：Worker Attempt 不得直接合入。
**理由**：与指令「不得从 Worker Attempt 直接合入受保护的集成或主分支」一致；分支名前缀便于清理与识别。

## D7 · Approval 独立存储于 `approvals` 表 — ACCEPTED

**背景**：Orca `decision_gates` 的 `resolveGate` 不校验 resolution 是否在 `options` 内、无 pending-only 守卫、不记录 resolver 身份与过期；`createGate` 会把活跃 dispatch 标 `completed` 并把 Task 置 `blocked`。
**决定**：新建 `approvals` 表（action kind、scoped inputs hash、risk、requested_by、expires_at、resolver、resolution、outcome、executed_at）；Orca decision gate 仅用于 `QUESTION` 类阻塞。
**修正（D7a，ACCEPTED Henry 2026-10-17）**：映射核查发现 `createGate` 在 supervised worker 活跃时会拒绝，因此 gate 只能承载**没有活跃 Attempt** 的 Task 级 QUESTION（Planner/人类澄清）；Worker 运行中的提问走 `axiom attempt ask` → Orca `question_threads`。
**理由**：Approval 必须绑定精确动作与有效期，gate 的语义与守卫都达不到。

## D8 · V1 范围 = M0–M4 + M5 抽象层 — ACCEPTED

**决定**：V1 包含 M0（隔离）、M1（Mission Facade）、M2（Planning 与 Agent Factory）、M3（Independent Verification）、M4（Controlled Integration），以及 M5 中的：`DecisionEngine` 接口与 RulesEngine 基线实现、replan 分级触发（`NO_REPLAN / MINOR_ADJUSTMENT / MAJOR_REPLAN`，由规则判定）、`MAJOR_REPLAN` → Replanner 提出新 PlanRevision → 人工/policy 批准 → 旧 revision `SUPERSEDED` 的完整流程。放到 V1 之后的是：Jev 或其它学习型 DecisionEngine provider 的实验、基于历史表现/成本的 provider 路由学习、M6 remote/federation/mixed-version 验证。
**理由**：章程 Objective 7 与量化指标（「所有重大 Plan 变化产生新的 PlanRevision」）要求 V1 具备重规划闭环；可替换性只需接口 + 基线即可证明。

---

## D9 · 消息类型映射：产品类型放 payload，不改 Orca CHECK 枚举 — ACCEPTED（Henry 2026-10-17）

**背景**：`messages.type` 有 CHECK 约束（九种 Orca 类型）；新增枚举需迁移重建表。
**决定**：Axiom 八种类型作为 `payload.axiom.type` 持久化，`messages.type` 只用于路由语义，映射见术语表 §5；`merge_ready` 在 Axiom 中不允许由 Worker 发出（发出即拒绝）。
**理由**：零 schema 变更、保留 Orca 的 mailbox / 唤醒 / 幂等机制；产品语义仍可查询（payload 为 JSON）。
**风险**：按产品类型过滤需要 JSON 查询或额外索引表；如成为瓶颈再迁移。

## D10 · Orca `tasks.deps` 对 Axiom 管理的 Task 保持为空，DAG 只存于 Axiom 边表 — ACCEPTED（Henry 2026-10-17）

**背景**：Orca `promoteReadyTasks` 只看 `tasks.deps` 与 `completed`，会在上游仅「提交」时把下游置 `ready`。
**决定**：Axiom 创建 Orca Task 时 `deps = []`（Orca 侧立即 `ready`，仅表示「可被派发」这一必要条件）；依赖边存于 `mission_task_edges`；MissionController 的 Scheduler 是 Axiom Task 的唯一派发者，按 task stage 判断 READY；对 Axiom 管理的 Task，直接 `orchestration.workerStart` / `dispatch` 需被 admission 校验拒绝。
**理由**：不与 Orca 的提升逻辑打架；readiness 权威单一。

## D11 · Worker ↔ Control Plane 通道 = `axiom` CLI → `axiom.*` RPC，复用 Orca dispatch capability — ACCEPTED（Henry 2026-10-17）

**决定**：Worker 侧命令 `axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check`（命令形状由 D16 定为 `axiom attempt <verb>`），直接调用 `axiom.attempt.*` RPC；RPC 层复用 Orca 的 `--dispatch-capability` 校验（`hasLifecycleAuthority` + capability hash + `consumer_generation` 栅栏 + `mutation_receipts` 幂等）；Control Plane → Worker 的回复仍通过 Orca `dispatch:<id>` mailbox 投递以复用唤醒/nudge 机制。不引入 MCP server。
**理由**：Orca 已有 stale/duplicate/unauthorized 拒绝码，正好满足章程的两条量化指标；避免第二套认证。

## D12 · Axiom 代码放独立强类型模块，不进入 `@ts-nocheck` 的 `orca-runtime-*.ts` — ACCEPTED（Henry 2026-10-17）

**背景**：约 150 个 `orca-runtime-*.ts` 非测试模块中 137 个 `@ts-nocheck`。
**决定**：Control Plane 代码位于 `src/main/axiom/`（或等价目录），仅通过 RPC 方法注册与 service 边界接入 runtime；禁止在 `@ts-nocheck` 文件内新增 Axiom 逻辑。

## D13 · 文档语言与文件落位 — ACCEPTED（Henry 2026-10-17；M0 期间已按此落位）

**决定**：章程、架构、术语表、映射参考、决策日志为中文（英文术语保留）；`docs/PROJECT_CONSTITUTION.md` 与根 `AGENTS.md` 为英文（面向所有 AI 贡献者，与上游一致）。Claude Project 文档名 → 仓库路径：
`project-charter-v1.1.md → docs/PROJECT_CHARTER.md`；`architecture-v1.1.md → docs/ARCHITECTURE.md`；`glossary-v1.md → docs/GLOSSARY.md`；`project-constitution-v1.md → docs/PROJECT_CONSTITUTION.md`；`agents-md-v1.1.md → AGENTS.md`；`orca-mapping-v1.md → docs/reference/orca-mapping.md`；`decision-log-v1.md → docs/decisions/DECISION_LOG.md`。
## D14 · Control Plane 以 session party 身份调用 Orca 运行时 — ACCEPTED（Henry 2026-10-17；按基线 3eb1adec2 修订；M1 首个任务做映射核实）

**背景**：Orca 上游 #22555（已包含在冻结基线中）把所有 caller/target 统一解析为一个 orchestration party `{address, terminalHandle, paneKey, orcaSessionId}`（`src/main/runtime/orchestration/orchestration-party.ts`、`orchestration-caller-identity.ts`）；Run 绑定键是 pane key **或** Orca session id（`hasRunBindingKey`）；`createRun` 已接受 `coordinatorOrcaSessionId` 且 handle/pane 可为 null（`db/runs/run-create.ts`）；session caller 在 RPC 入口即被解析，`worker-start` 等动词对 session caller 不再要求 `from`。Axiom 的 Scheduler 是服务，不是终端。
**决定**：Control Plane 作为 **session party** 参与 orchestration——为每个 Mission 铸造一个符合 `isOrcaSessionId` 格式的合成 session id（不以 `term_`/`structworker_` 开头，不对应真实 agent 会话），用它 `createRun({coordinatorHandle: null, coordinatorPaneKey: null, coordinatorOrcaSessionId})`；Control Plane 在进程内直接构造 `OrchestrationSessionCaller`（`workspaceId` = Mission 仓库工作区），经 service 边界调用 `startLocalWorker` 等，不走 env 注入、不走参数声明（`resolveDeclaredCallerParty` 会拒绝以参数声明的 chat 型 caller，进程内路径不受此限）；dispatch creator 用既有 `{kind:'system'}`（`db/dispatch-depth.ts`，深度恒为 1）；`workerStart` 仍需 additive 增加可选的直供 `worktreeId` / `branchNameOverride`（D6a）。
**风险**：`resolveOrcaSessionParty` 把未记录为 structured worker 的 session id 视为 chat（`terminalHandle: null`）——作为 Run coordinator 与 mailbox 地址（`session:<id>`）可行，但任何依赖 handle 的路径（如旧式 mail 键）需要逐一核实；合成 id 必须持久化在 `missions` 表并在重启后复用，否则 Run 绑定失效。
**核实（M1-01，2026-10-17，`.axiom-work/verifications/M1-01-1.md`）**：核心成立——合成 id（推荐 `axiom-mission-<uuid v4>`）无需 session record 即解析为 chat party，可持有 Run（handle/pane 为 null）、物化 `deps=[]` 的 Task、以 `consumer_generation` 栅栏消费 `run:<runId>` 投递并在文件库重开后续接；5 个 `src/main/axiom/kernel-contract/*.test.ts` 把这些内核行为钉住。限定：RPC 入口的 session 解析要求真实 session record 与 lease，合成 id 走不了（设计如此，只在进程内构造 caller）；现有 `startLocalWorker` 还不是 D14 适配器（`params.from` 必填且 session 地址得到 `{kind:'session'}` creator、preamble 仍是旧协议、worktree lineage 把 `from` 当终端），M2 以 service-only additive 入参补齐（`dispatchCreator`、`worktreeId`、`branchNameOverride`、`preambleBuilder`、`dispatchMaxDepth`、`callerIdentity`，见 `orca-mapping.md` §4a）。`createRun` 自带 `BEGIN IMMEDIATE`，与 `runLifecycleWriteTransaction` 的组合由 M1-05 先用测试确认。不需要 D14a。

## D15 · `axiom.*` mutation 纳入 Orca 契约栅栏与幂等收据 — ACCEPTED（Henry 2026-10-17）

**背景**：契约栅栏（`orchestrationContractVersion`）与 `mutation_receipts` 幂等都由 `ORCHESTRATION_MUTATION_METHODS` 集合驱动，CLI 只给 `orchestration.` 前缀打版本戳。
**决定**：additive 扩展该集合与 CLI 打戳逻辑，把 `axiom.*` 的 mutation 方法纳入同一栅栏与收据机制，而不是另起一套。

## D16 · Worker CLI 命令挂在 `axiom attempt <verb>` 下 — ACCEPTED（Henry 2026-10-17；M0-11 保留的 CLI 名已按此）

**背景**：Orca CLI 已有顶层浏览器命令 `check`（`src/cli/specs/browser-basic.ts`），`axiom check` 会重名。
**决定**：Worker 面向的命令统一为 `axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check`；术语表已同步。

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

## D21 · 产品机器身份（bundle id、scheme、可执行名、发布源） — ACCEPTED

**决定**（Henry 2026-09-26）：app id / bundle id `com.lapagayo.axiom`（computer-use 辅助进程 `com.lapagayo.axiom.computer-use`，mobile `com.lapagayo.axiom.mobile`）；productName `Axiom`；URL scheme `axiom://`；可执行名 `Axiom`（macOS/Windows）与 `axiom-ide`（Linux 包与二进制）；CLI `axiom`（dev 构建 `axiom-dev`）；发布源 GitHub `LaPaGaYo/Axiom`；Windows 暂不签名（不设 `publisherName`）。
**后果**：`src/shared/local-build-compatibility-contract.json` 的 appId 变更后旧 Orca 数据目录不再互认（全新产品，可接受）；macOS TCC 授权随 bundle id 重置；M0-02 按此实施，并使 vendor-egress 基线相应收缩。
**取代规则**：更改 bundle id 需新 Decision，并评估权限重置与数据目录迁移。

## D22 · M0-01 集成记录 — ACCEPTED（事实记录）

vendor-egress ratchet（Codex attempt `axiom/attempt/M0-01/1`，候选 `7115f1cb9`）经独立验证（`.axiom-work/verifications/M0-01-1.md`：ratchet、27 个单测、`tc:node`、changed-code 质量门、完整 `pnpm lint` 全部 PASS；注入/allow 标记验收在沙盒独立复现）后以 `--no-ff` 合入 main（`7579ec17c`）。基线：544 个文件 / 763 个 (file, needle) 对，M0 后续任务只能使其收缩。


## D23 · M0-02 集成记录 — ACCEPTED（事实记录）

产品机器身份（D21）由 Codex 经 5 次 Attempt 完成（`axiom/attempt/M0-02/1..5`，同一基线 `0720ac7fa` 上叠加；attempt 2/4 为验证后的 NEEDS_FIX 返工，attempt 3 为 MINOR_ADJUSTMENT 范围扩展），候选 `369765e4f` 经独立验证（`.axiom-work/verifications/M0-02-5.md`）后以 `--no-ff` 合入 main（`9ac363a7e`）。验证事实：ratchet PASS 且基线 763 → 687 对（−76）；`tc:node/cli/web`、changed-code 质量门、`verify:cli-bin`、skill manifest/guides、完整 `pnpm lint` 全部 PASS；macOS computer-use 辅助进程 Swift 包在 Mac 上编译通过；全量 vitest 16 个失败文件中 13 个在 main 上同样失败（宿主环境）、2 个为计时抖动（候选与 main 各 10/10 焦点复跑通过）、1 个为上游测试缺陷（`tests/e2e/.cross-version-checkouts/` 未被排除）。
**保留的风险/后续**：真实打包、通用二进制 helper 构建与签名未演练（M0 出口检查）；29 处用户可见文案仍写 `orca://pair`（CLI 帮助/错误文本、渲染层标签、6 个 i18n 文件）→ 归入 M0-05；`e2e-worker-env-isolation` 与 `pty-runtime-hidden-at-spawn-mark` 两个上游测试的稳定性问题各立 hygiene 跟进项。

## D24 · M0-03 集成记录 — ACCEPTED（事实记录）

产品出口策略由 Codex 经 2 次 Attempt 完成（`axiom/attempt/M0-03/1..2`；attempt 2 仅修复 `updater-test-harness.ts` 的 max-lines 违规），候选 `07f1d3aac` 经独立验证（`.axiom-work/verifications/M0-03-2.md`）后以 `--no-ff` 合入 main（`aefbf5b5b`）。实现：新增 `src/shared/product-egress-policy.ts`（纯常量，main/renderer/CLI 共用，配套测试钉死 V1 取值）；updater feed 改为 GitHub `LaPaGaYo/Axiom`（四个发布通道常量同指一个仓库），**自动/后台/唤醒检查关闭**，菜单手动检查保留；changelog、nudge、plugin kill-list、feedback/crash 上传、官方构建 diagnostics 上传全部为 `null` → 不发起任何请求（测试断言 mocked `net.fetch` 未被调用）；`ORCA_DIAGNOSTICS_TOKEN_URL` 编译期常量与 CI 注入删除。验证事实：ratchet PASS 且基线 687 → 652 对；焦点测试、`tc` ×3、changed-code 质量门、完整 `pnpm lint` PASS；全量 vitest 16 个失败文件 = 13 个已知环境性 + 2 个已知上游问题 + `ssh-remote-commands` 一次负载超时（焦点复跑 3/3 通过）。
**保留的风险/后续**：dev 通道共用一个仓库后 GitHub Atom feed 条目有限，若将来发布高频 dev tag 可能挤掉 stable/RC 条目（V1 不发布 dev 通道；通道枚举收敛另立任务）；真实打包与运行时代理抓包未演练（M0-08 / M0 出口）；crash 对话框与 diagnostics 设置的文案仍提及上传（M0-05）。

## D25 · V1 无产品遥测：移除 PostHog 传输与依赖，`track()` 保留为本地校验空操作 — ACCEPTED（Henry 2026-10-02）

**提议**：Axiom V1 不采集产品遥测。删除 `posthog-node` 依赖、PostHog 传输、`ORCA_POSTHOG_WRITE_KEY` 编译期常量、CI secret 注入与打包后常量校验脚本；`src/main/telemetry/client.ts` 的 `track()` 继续做事件 schema 校验与 burst-cap（保住 27+ 调用点与事件词表/validator 测试），然后丢弃；首启遥测同意横幅与"分享匿名使用数据"开关从 UI 移除，`settings.telemetry` 持久化字段保留（向后兼容，未来可接自有 sink）。本地 diagnostics（bundle 收集、crash minidump、Privacy 面板的 diagnostics 区）不是遥测，原样保留。
**备选**：(a) 仅置 `TELEMETRY_ENABLED=false` 并保留依赖——打包产物仍含 PostHog SDK，与 orca-mapping §7 验证策略（`package.json` 无 `posthog-node`）冲突；(b) 保留同意 UI 但无后端——开关无实际作用，误导用户。
**后果**：事件词表成为"预留接口"而非实时数据源；未来若要启用自有遥测需新 Decision 与新的 sink 实现 + 同意 UI。M0-04 按此实施。
**取代规则**：启用任何遥测传输需新 Decision，并重新引入同意 UI。

## D26 · M0-04 集成记录 — ACCEPTED（事实记录）

去遥测（D25）由 Codex 经 4 次 Attempt 完成（`axiom/attempt/M0-04/1..4`：1 = 实现；2 = 修 `no-useless-return` 并按授权撤掉同意 IPC 全链路；3 = 重生成运行时 catalog 后发现生成器会把孤儿字符串（含 `posthog` 关键字）搬进启动 bundle、被 ratchet 拦下，Worker 正确停下报告范围冲突；4 = 按上游做法 `ea102a9eb8` 用脚本从六个 locale 文件精确删除 34 个孤儿 key，运行时 catalog 与 main 字节一致），候选 `d02fab2ea` 经独立验证（`.axiom-work/verifications/M0-04-4.md`）后以 `--no-ff` 合入 main（`cf07b00a2`）。实现：`posthog-node` 从 `package.json`/lockfile/打包模块表移除；`src/main/telemetry/client.ts` 的 `track()` = 校验 → burst-cap → 丢弃；`ORCA_POSTHOG_WRITE_KEY` 常量、CI secret 注入与打包后校验脚本删除；首启同意横幅与 Privacy 面板的用量开关移除，同意 IPC 撤掉，`settings.telemetry` 数据模型保留。验证事实：ratchet 652 → 636；焦点测试、`tc` ×3、changed-code 质量门、`pnpm install --frozen-lockfile --offline`、完整 `pnpm lint` PASS；全量 vitest 失败集 = 已知 15 个（13 环境性 + 2 上游问题），无新失败。
**保留的风险/后续**：少量用户可见文案仍提及 telemetry/用量数据（M0-05）；打包启动的零遥测由 M0-08 出口抓包确认。

## D27 · M0-06a 集成记录 — ACCEPTED（事实记录）

cloud 服务置于产品出口策略之后，由 Codex 经 2 次 Attempt 完成（`axiom/attempt/M0-06a/1..2`；attempt 1 把"分享 host 列表为空即拒绝"放在 `axiom:` 分支之前导致产品自身深链被拒，并在沙盒跑 `pnpm install --offline --ignore-scripts` 弄坏宿主 Electron 二进制；attempt 2 按 addendum 修复解析顺序并补 pin 测试），候选 `75b3e74c3` 经独立验证（`.axiom-work/verifications/M0-06a-2.md`）后以 `--no-ff` 合入 main（`3b85ebcd6`）。因分支基线早于 M0-04 集成，合入后在合并树上执行回归（`.axiom-work/verify-merged.sh M0-04 M0-06a`，日志 `verify-merged-3b85ebcd6-*.log`）：基线重生成结果与自动合并一致（620 对），ratchet、两任务焦点测试、`tc` ×3、changed-code 质量门、全部额外断言、完整 `pnpm lint` 均 PASS。实现：`ProductEgressPolicy` 新增 `cloudAuth`/`pushGatewayOrigin`/`artifactShareApiOrigin`（均 `null`）与 `skillShareHosts`（空）；打包构建不再回退到任何厂商默认值，Orca Cloud 登录/relay、push、artifact 分享、skill cloud 在未设环境变量时为 `unconfigured`（不发请求），CLI `artifacts` 返回类型化的未配置错误；skill 分享链接仅接受裸 id 与 `axiom://skills/share/<id>`。
**保留的风险/后续**：UI 中仍有登录/分享邀请文案与入口（M0-05a/05b）；环境变量重新启用 artifact/skill API 时仅允许 policy host 或非打包 loopback，未来接入自有 host 需新 Decision；打包与代理抓包验证归 M0-08。流水线新规：Worker 不得在沙盒执行任何写 `node_modules` 的命令；`attempt.sh` 检测到篡改会先 `pnpm install --frozen-lockfile` 修复再验证；`verify-merged.sh` 成为合并树回归的标准工具。

## D28 · 采用 Ponytail"懒惰资深开发"规则（所有贡献者与 Worker） — ACCEPTED（Henry 2026-10-02）

**决定**：把 https://github.com/DietrichGebert/ponytail （MIT）的规则作为 `AGENTS.md` 的"Lazy Senior Dev Mode (Ponytail)"一节，对 Claude 与 Codex Worker 同时生效（Codex 自动读取仓库根 `AGENTS.md`，无需改 brief）：写代码前按阶梯停在第一个成立的台阶——YAGNI → 仓库已有实现 → 标准库 → 平台原生 → 已装依赖 → 一行 → 最后才写最小代码；bug 修根因不修症状；不加未被要求的抽象、依赖和脚手架；最短可用 diff。
**边界**：本节只收窄"怎么写"，不削弱架构不变量、边界处 schema 校验、`SAFETY:` 断言规则、`max-lines` 与模块命名规则、验证证据与 Decision 记录；"一个可运行检查"在本仓库等于一个聚焦的 vitest 测试；带上限的刻意简化要加 `ponytail:` 注释，属于架构层面的还要记 Decision 或后续 Task。Claude 侧同一规则以账号技能 `ponytail` 安装（原文 + Axiom 约束附注）。
**动机**（Henry）：避免把小任务做成大工程、反复造轮子。
**取代规则**：移除或放宽本节需新 Decision。

## D29 · 开发流水线引入 Jev 作为纯建议性分诊（M5 校准数据起点） — ACCEPTED（Henry 2026-10-03）

**决定**：在 A-lite 流水线的每次 Attempt 验证之后，调用 TypeSafe System One（`jev-latest`，HTTP API，Node 内置 `fetch`，无新依赖）对固定的类型化问题给出判断：每个失败测试"是否可能由候选 diff 引起"（Noul）、Worker 报告相对提交合同的完整性（Score 0–3）、是否越界（Noul）、每条建议 follow-up 的 replan 分级（Choice：NO_REPLAN / MINOR_ADJUSTMENT / MAJOR_REPLAN / NOT_A_WORK_ITEM）。结果写入 `.axiom-work/logs/jev-<ID>-<seq>-<ts>.json`，附 `human_verdict` 槽位由验证者填写人工裁定。
**边界**：纯建议，任何门禁、判定或合入都不依赖它（章程 Decision Engine Boundary；与产品代码无关，不经 `DecisionEngine` 抽象，因为它不在产品内）；API key 只存放于 Mac 的 `~/.config/axiom/typesafe.env`（mode 600，仓库之外，Codex 沙盒不可见），脚本不打印、不提交；无 key 时静默跳过；仅在 Mac 上运行（Codex 沙盒与 Claude 容器无该域名出口）。盲测 fixture（G8）不参与。
**动机**：Henry 希望借 Jev 更好地判断进度与方向；评估结论是它适合窄判断而非方向判断，故限定为分诊 + 提前积累 (状态, 问题, 答案, 人工裁定) 校准集供 M5 使用。首次运行（M0-06b attempt 2）：报告完整性 2.99/3、越界概率 0.20（将 addendum 授权纳入状态后从 0.48 降至 0.20）、三条 follow-up 均判 NO_REPLAN，与验证者判断一致。
**取代规则**：让 Jev 的输出影响任何门禁或自动决定需新 Decision，且必须经产品侧 `DecisionEngine` 抽象。

## D30 · M0-06b 集成记录 — ACCEPTED（事实记录）

marketplace 官方源禁用 / skills 安装源改 `LaPaGaYo/Axiom` / star 提示禁用，由 Codex 经 2 次 Attempt 完成（`axiom/attempt/M0-06b/1..2`：attempt 1 确定性门全过，但全量 suite 抓到 `src/shared/plugins/plugin-marketplace.ts` 在模块加载时 import `resources/**` 的真实回归；attempt 2 改为由 `plugin-bundled-bootstrap.ts` 运行时读取的索引作为"bundled 身份即在索引中"的信任依据、以参数传入 install 链路，publisher 不再授予信任），候选 `686034b92` 经独立验证（`.axiom-work/verifications/M0-06b-2.md`，含全量 suite：回归消失，失败集 = 已知 15 + 2 个负载性抖动）后以 `--no-ff` 合入 main（`7043764a3`），合并树回归（`verify-merged.sh M0-06b`）PASS，基线 620 → 594 对。
**保留的风险/后续**：`resources/plugins/**` 内置插件仍沿用上游 publisher 身份（仅资源标识）；用户自行添加的 marketplace 源按请求刷新；Landing/support 等 GitHub 链接文案归 M0-05a。卫生项：`.github/workflows/pr.yml` 自 M0-01 起缺少 `check-vendor-egress-ratchet` 步骤（`pr-workflow-lint-parity` 一直失败的真实原因）→ 新开 M0-HYG 任务与上游测试稳定性问题一并处理。

## D31 · M0-05a 集成记录 — ACCEPTED（事实记录）

产品链接 / README / 署名 / `orca://` 文案由 Codex 经 2 次 Attempt 完成（`axiom/attempt/M0-05a/1..2`；attempt 2 仅把 `MobilePage.test.tsx` 超出 800 行的用例拆到 `MobilePage.install-links.test.tsx`），候选 `0062a1873` 经独立验证（`.axiom-work/verifications/M0-05a-2.md`，含全量 suite：失败集 = 已知集合，无新失败）后以 `--no-ff` 合入 main（`50b4301b1`），基线 594 → 559 对。实现：policy 新增 `repositoryUrl`/`issuesUrl`（由 `updateFeed` 推导）、`docsUrl`（仓库 README）、`communityLinks`（空）；渲染层/CLI 的上游仓库链接、文档站链接、Discord/X 链接、`https://app.orca.dev/skills/share/…` 形式、移动端 APK 下载链接全部改为读 policy 或不渲染；29 处 `orca://pair` 文案改为 `axiom://pair`（六个 locale 只替换子串，key 不变）；`README.md` 重写为 Axiom（使命、状态、Based on Orca 署名、Developing、Documentation、License）；新增 `NOTICE.md`（MIT，Lovecast Inc. 版权与修改声明）；`LICENSE` 未动。
**保留的风险/后续**：UI 字符串与 i18n 值里的产品名 "Orca"、`docs/site/**`、内置 skill 指南文案归 M0-05b（会改变 i18n key hash，需要 Henry 决定翻译回退与 `docs/site/` 去留）；移动端面板本身由 M0-07 移出构建。

## D32 · 品牌文案与文档站：UI 字符串 "Orca"→"Axiom"，翻译允许回退英文，上游文档站保留并改造 — ACCEPTED（Henry 2026-10-03）

**决定**（Henry）：应用与 CLI 中用户可见的产品名全部改为 Axiom；其他五种语言若因此丢失翻译，回退英文可以接受；`docs/site/`（上游文档站）保留，改造为 Axiom 的文档而不是删除。
**实施方式**（验证者核实后的最小方案）：本仓库的 i18n key 是稳定标识（`auto.<file>.<sha1>` 只在 `localize-renderer-strings.mjs` 为**新**字符串生成时计算；既有 `translate(key, default)` 调用的 key 不随 default 变化），`verify-localization-extraction` 对 "en.json 值 ≠ 调用点默认值" 只报告不失败。因此 M0-05b-1 同时改调用点默认文本与六个 catalog 的**值**、key 不动：翻译得以保留（品牌词在各语言里都是拉丁拼写，直接替换），运行时必需 catalog 不膨胀；Henry 接受的"回退英文"成为兜底而非必然。不改的东西：标识符、`ORCA_*` 环境变量（D13）、skill 名（`orca-cli` 等）、`orcad`、测试 fixture、署名文本。M0-05b-2：`docs/site` 改名改链接，删除 `mobile`/`android-apk`/`telemetry` 三页，安装页改为"预发布：从源码构建"，首页注明文档继承自 Orca 正在修订；内置 skill 指南的产品名同样处理并重生成 manifest。
**取代规则**：若将来需要改 skill 名、守护进程名或环境变量名，需新 Decision 并评估兼容性（D13）。

## D33 · 上游 cloud 基础设施树删除；mobile 树保留但声明为不交付 — ACCEPTED（Henry 2026-10-03）

**提议**：删除 `cloud/`（529 个文件：relay/push/login 的部署与运维基础设施）及其 CI（`.github/workflows/cloud-*.yml`、`.github/actions/cloud-sql-rollout-lease/`、CODEOWNERS 对应行）——`src/`、`config/`、`tests/` 均不依赖它，git 历史保留。`mobile/`（3394 个文件）保留在树中：桌面构建与若干根级门禁（`build-mobile-web-app-bundle.mjs`、oxlint/knip/reliability-gates 配置、changed-code 质量门）引用它，删除成本高于收益；但移除其发布/CI 工作流（`mobile.yml`、`mobile-android-release.yml`、`mobile-ios-release.yml`、`install-mobile-dependencies` action，PR 工作流中的 mobile 依赖安装与 mobile web app 作业），并在 vendor-egress ratchet 中把 `mobile/**` 声明为不交付代码予以排除。桌面端的移动配对面板不在本决定范围内。
**备选**：按 orca-mapping §7 原表述"保留目录但移出默认构建"同时保留 cloud/——cloud 与桌面产品零耦合，保留只剩噪音与误导；或连 mobile/ 一起删——需要改动 6+ 个根级配置与脚本，且桌面端配对功能的去留是产品决定，留待 V1 之后。
**后果**：ratchet 基线减少约 205 对（cloud ~126 + mobile ~79）；上游针对 onorca 基础设施的工作流不再存在于本仓库。
**取代规则**：恢复 cloud/ 或删除 mobile/ 需新 Decision。

## D33a · 修正 D33：`mobile/` 仍是交付代码（桌面包内含 mobile web bundle），保留在 ratchet 与 CI 中；只删原生发布工作流 — ACCEPTED（Henry 2026-10-04）

**背景**：M0-07 attempt 1 的 Worker 正确地停下并提交了部分结果（`.axiom-work/reports/M0-07-1.md`）：(a) brief 里"`src/`、`config/`、`tests/` 不依赖 `cloud/`"不成立——`src/main/runtime/push/push-host-proof-vector.test.ts` 从 `cloud/packages/push-contract` 引入 fixture，`tests/e2e/relay-region-{correction,compatibility}.unit.test.ts` 测的是 cloud relay 代码，`config/reliability-gates.jsonc` 有四条门禁引用 cloud 路径，`config/scripts/source-tree-walk-benchmark.mjs` 扫描 `cloud/apps`；(b) D33 把 `mobile/` 当作不交付代码排除出 ratchet 的前提是错的——`config/electron-builder.config.cjs` 在打包时把 `mobile/` 构建出的 **mobile web bundle**（`out/mobile-web`，桌面端配对手机时提供的网页版 companion）装进桌面应用，所以 `mobile/` 的代码随桌面产品交付，其中的厂商出口 needle 必须继续受 ratchet 约束；打包工作流里的 `install-mobile-dependencies` 步骤也因此不能删。
**决定**：
- `cloud/` 照删，先处理依赖：push-contract 的 proof-vector fixture 移入 `src/main/runtime/push/__fixtures__/`；删除两个 cloud relay 的 e2e 测试；reliability gates 中以 cloud 文件为测试对象的两条（`relay.control-activation-ownership`、`relay.assignment-headroom-scope`）移除，另两条（`mobile-relay.endpoint-recovery`、`desktop-relay.assignment-backpressure`）只去掉 cloud 源码链接；benchmark 去掉 `cloud/apps`；lint/scope 配置里的 cloud 忽略模式与注释留作后续清理。
- `mobile/` **不**从 ratchet 排除（撤回 attempt 1 的排除；基线只减 cloud 的 pair）；保留 `mobile.yml` 检查、`install-mobile-dependencies` 及其所有使用、`pr.yml` 的 `mobile_web_app` 作业；只删 `mobile-android-release.yml` 与 `mobile-ios-release.yml`（原生 App 不构建不发布）。
- 是否把"手机 companion"整体从桌面端移除（连同 web bundle、配对 UI、relay/push 客户端）是另一个产品决定，不在 M0 内。
**取代规则**：取代 D33 中关于 mobile ratchet 排除与 mobile CI 的部分；cloud/ 删除部分不变。

## D34 · M0-05b-2 集成记录 — ACCEPTED（事实记录）

文档站与内置 skill 文案由 Codex 经 2 次 Attempt 完成（attempt 1 `fa480d1e6`：54 页文档站 + `skill-guides/**` 改完、三页删除、`@axiom/docs`，但 `skills/*/SKILL.md` 是从 `skill-stubs/` 生成的——brief 漏列了源目录，Worker 正确地拒绝手改生成物并报告；attempt 2 `f141c24ca`：改 9 个 stub 源文件（30 处产品名 + 3 处命令名）后用仓库命令重生成，生成器按原文剥掉的 Linux 读屏段落保持逐字不变），经独立验证（`.axiom-work/verifications/M0-05b-2-2.md`：ratchet、焦点测试、`tc` ×3、changed-code 质量门、九条 `git grep` 断言、`node --test` 文档站 13 项、`verify:bundled-skill-guides`、manifest 校验、完整 `pnpm lint` 全部 PASS）后合入 main（`fde906de9`，plumbing 合并以免占用正在跑队列的工作树）。基线 559 对不变：`docs/**` 与 skill 路径不在 ratchet 扫描根内，brief 的"必须缩小"写错。
**保留的风险/后续**：文档页仍有描述上游行为之处（首页已注明"继承自 Orca、修订中"）；`skill-stubs/_shared/cli-resolution.md` 的 Linux 读屏段落与 `generate-bundled-skill-guides.mjs` 里剥它的正则应一起删除（MINOR_ADJUSTMENT，`config/scripts` 小任务）；`docs/site/public/docs/**` 媒体文件名仍含 `orca`（资源名，非文案）。合并树全量回归见 D36。

## D35 · M0-05b-1 集成记录 — ACCEPTED（事实记录）

应用与 CLI 的产品名（D32）由 Codex 经 4 次 Attempt 完成（1 = 改名本身，948 个文件，仅 `max-lines` 一处不过；2 = 两条提示语缩短，完整 lint 过，但**全量** suite 抓到 49 个 `src/main`/`src/shared`/`config/scripts` 测试文件断言旧文案——brief 的焦点测试目标没盖到这些目录；3 = 更新 48 个测试文件的 59 处期望值、重生成 6 个 shell wrapper 快照、两处 `as Error` 改为无断言匹配器，全量 suite 只剩 14 个已知环境性文件 + `macos-tcc-prompt-localization`，Worker 正确地拒绝把该测试改弱；4 = 授权后改 `config/scripts/locale-macos-tcc-key-overrides.mjs` 的 12 条翻译值（catalog 修复策略的源头，不改会被回写成 Orca）），候选 `a90f4070d` 经独立验证（`.axiom-work/verifications/M0-05b-1-4.md`：全量 suite 14 失败 = 已知环境性集合、ratchet、`tc` ×3、changed-code 质量门、三条非空转 extra、完整 `pnpm lint` PASS）后合入 main（`f16d28587`，plumbing 合并）。实现：渲染层 876 段、CLI 742、main 454、shared 140、六个 catalog 值（en 782 / es 608 / fr 779 / ja 771 / ko 778 / zh 789）、运行时 catalog 77；**key 全部不动**（六个 catalog 叶子数不变，翻译全部保留，`en.json` 里剩下的 9 个 "Orca" 都是 key）；extraction drift 52 = main；基线 559 不变。
**保留的风险/后续**：`# Orca-generated …` shell 标记串与 `orca.yaml`/`Orca.app` 路径字面量有意保留（兼容旧版本写出的文件）；流水线教训已记入 `claude/workflow-a-lite-v1.md`（仓库范围文本改动的 sidecar 目标必须是全 suite；`! rg …` 断言在这台 Mac 上空转，已改 `git grep` 并让 `verify.sh` 对缺命令判失败）。合并树全量回归见 D36。

## D36 · M0-07 集成记录与 M0-05b-2 / M0-05b-1 / M0-07 合并树回归 — ACCEPTED（事实记录）

cloud/ 与原生 mobile 发布 CI 的移除（D33 经 D33a 修正）由 Codex 经 4 次 Attempt 完成（1 = Worker 因 brief 前提不成立而停下并提交部分结果，促成 D33a；2 = 配置改动就绪但 `git rm`/`git mv` 被沙盒拒绝——沙盒保护 `.git/`；3 = 改用 `rm`/`mv`：570 个文件删除 + push-contract 的 proof-vector fixture 搬入 `src/main/runtime/push/__fixtures__/`，并发现五处引用已删文件的残留；4 = 按授权清掉残留：第五条 reliability gate、三个 workflow 形状测试、`unit-tests.yml` 的 `relay_integration` 作业、`mobile.yml` 的过期触发路径），候选 `ae1505f13` 经独立验证（`.axiom-work/verifications/M0-07-4.md`）后以 `--no-ff` 合入 main（`a15d380e7`；两处冲突按既定规则解决：sidecar 取分支版本、决策日志取 main 版本）。实现：`cloud/`（528 文件）、26 个 `cloud-*` 工作流、`cloud-sql-rollout-lease` action、`mobile-{android,ios}-release.yml`、两个 cloud relay e2e 测试及其 helper 删除；reliability gates 135 → 132；`mobile/` **保留在 ratchet 与 CI 中**（撤回 attempt 1 的排除），基线 559 → 434（恰为 cloud 的 pair 数）。
**合并树回归**（`verify-main.command` 两次，main `a15d380e7` 与 `919500130`）：第一次抓到 4 个 `config/scripts/*-skill-guidance.test.mjs` 断言 M0-05b-2 改名前的指南文案 → M0-05b-2 attempt 3 更新这四个测试并合入（`919500130`）；第二次（2026-10-10，`verify-merged-919500130-20261010-114223.log`）：基线重生成无变化（434）、ratchet、`tc` ×3、changed-code 质量门、三个任务的全部 10 条 sidecar 断言、完整 `pnpm lint` PASS；全量 vitest 13 个失败文件 = `known-environmental.txt` 全集（`relay-region-correction` 已随 cloud 删除，从名单移除），无新失败。M0-05b-2、M0-05b-1、M0-07 三者的集成证据至此完整。
**保留的风险/后续**：托管 CI 尚未在新的工作流形状上跑过（本地 `pr-workflow-lint-parity` 与形状测试通过）；lint/scope 配置里的 cloud 忽略模式、`check-root-directory-entries` 的合成 fixture、四处引用 cloud 路径的注释、`ci-shard-timings.json` 里已删测试的计时条目留待一次 hygiene 任务；是否整体移除桌面端的手机 companion 另行决定（D33a）。

## D37 · 冷启动零出口：用户配置 provider / 集成或主动触发之前，应用不发起任何网络请求 — ACCEPTED（Henry 2026-10-10）

**背景**：M0-08 的运行时抓包（记录型本地代理；Chromium 走 `--proxy-server`，Node/undici 与子进程走 `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`）在全新 profile 冷启动 + 空转 20 s 内记录到 `chatgpt.com` ×2 与 `github.com` ×2，两种场景（停在 onboarding / 进入主窗口）完全一致、可复现（`.axiom-work/logs/verify-M0-08-{1,2}-*.log`，证据 `docs/review-evidence/axiom-m0/M0-08-egress-capture.md`）。源码归因（Worker 报告 `.axiom-work/reports/M0-08-2.md`）：(1) 用量/限额服务启动 1 s 后的延迟刷新调用 Codex 的 usage / reset-credit 接口（`src/main/rate-limits/codex-backend-usage-client.ts`、`codex-reset-credit-client.ts`），并可能先执行一次 Codex CLI 的配额探测（子进程继承代理环境，故被记录）；(2) onboarding / Landing 挂载时的 preflight 无条件执行 `gh auth status`（`src/main/preflight/agent-detection.ts:256,383`），`gh` 访问 github.com。两者都不是上游厂商遥测，而是用户未配置、未操作时的自动外联。
**决定**：V1 原则——冷启动与空闲不外联。preflight 只做本地检测（二进制存在、版本）；认证探测（`gh auth status`、Codex 配额/用量）只在用户显式"连接/检查"或已配置对应 provider / 集成后运行；用量轮询只在至少一个账号已配置时启动。`tests/e2e/golden-egress-cold-start.spec.ts` 成为 M0 出口门禁（必须绿）。
**备选**：(a) 把 `chatgpt.com`、`github.com` 加入 e2e 允许名单——掩盖问题；(b) 保持现状、e2e 降级为报告——失去门禁价值。
**后果**：onboarding 中 GitHub / Codex 的状态在用户点"连接"前显示"未检查"；M0-09 实施，叠在 M0-08 分支上，两者一起合入以保持 main 没有红检查。
**取代规则**：允许任何启动期自动外联需新 Decision 并进入出口策略。

**归因更正（2026-10-10，M0-09 attempt 2 的宿主抓包，`.axiom-work/logs/verify-M0-09-2-20261010-154117.log`）**：带进程归因的记录代理把两个域名都定位到**启动期由 Axiom 自己拉起的两个 `codex` 进程**——`chatgpt.com` ×2 来自这两个 `codex` 进程本身，`github.com` ×2 来自它们各自派生的 `git remote-https https://github.com/openai/plugins.git`（Codex CLI 启动 app-server 时同步插件市场）。拉起点是 `src/main/startup/main-process-ready-runtime.ts` 的启动期 managed-hook 对账：`ensureRealHomeCodexHookState` 与 `installManagedAgentHooks → codexHookService.install()` 各跑一次 `codex app-server` trust-grant 会话（dev 启动日志恰有两行 `[codex-trust-grant] granted … via codex app-server`），只要 PATH 上有 `codex` 就在全新 profile 上无条件执行。背景里点名的两条路径这次没有出流量——用量轮询只在窗口可见且聚焦时运行（后台 e2e 从不聚焦），`gh` 在这台机器上没有产生流量——但代码上都是无条件的，仍按本决定关闭并以单元测试覆盖。决定本身不变。

## D38 · M0-08 + M0-09 集成记录：冷启动零出口门禁与 provider activation — ACCEPTED（事实记录）

运行时出口抓包（M0-08，2 次 Attempt：1 = 实现，`tc:cli` TS6307 / 猜测的 UI 等待 / 证据文件被 `docs/**` 忽略；2 = 修复，候选 `1441dee69`，作为测试与证据改动 VERIFIED 但因 e2e 为真红而留在分支上）与冷启动零出口（M0-09，5 次 Attempt：1 = lsof 归因，`github.com` = `git-remote-http`、`chatgpt.com` 未归因；2 = 300 ms 保持 + `netstat -anv` + `ps` 血缘 + 分栈选择，两个域名都定位到启动期的两个 `codex` 进程及其派生的 `git remote-https https://github.com/openai/plugins.git`；3 = 产品改动——每个 profile 的 **provider activation** 记录与各处门禁，e2e 转绿，但 `tc:cli` 未跑、两份规范文档被 oxfmt 重排、非 Codex provider 永不激活；4 = 三项收尾（`tsconfig.cli.json` 登记新模块、还原两份文档的格式、PTY 启动统一入口按 `launchAgent` 记录激活）；候选分支全量 suite 抓到焦点目标盖不到的一个真失败——`global-fetch-call-site-audit` 把名为 `fetch` 的回调参数当成裸 fetch 调用点；5 = 仅改参数名），最终候选 `b1fba5f8e` 经独立验证（`.axiom-work/verifications/M0-09-5.md`；全量 suite 在 attempt 4 候选上跑，与最终候选只差该改名，改名后审计测试与全部 rate-limits suite 在 attempt 5 上复跑通过）后一次合入 main（`--no-ff` 合并 `3a88dae3b`；唯一冲突是两边都新增的流水线 brief/sidecar，取分支版本），再在 main 上跑 M0-08 + M0-09 sidecar 并集（含两次冷启动 e2e）与完整 lint（`verify-merged-3a88dae3b-20261010-190012.log`：ratchet 434、`tc` ×3、changed-code 质量门、11 条额外断言（两次冷启动 e2e 共 8 个 tally 全为 `{}`）、完整 lint 全部 PASS；焦点单测 2 个失败文件均为已知环境性——`startup-shell-portability.live-shell` 与计时敏感的 `pty-runtime-hidden-at-spawn-mark`，后者在 8 分钟前同一代码的 attempt 5 焦点验证中通过）。基线 434 对不变。

**实现要点**：`GlobalSettings.providerActivations`（可选、默认 `{}`、zod 校验、渲染层不可写）记录用户在**本 profile** 中对某 provider 的首次动作（识别到的 agent 启动、Settings 装 hook、Integrations "Connect / Re-check"、添加 Codex 账号）；启动期 managed-hook 对账只为已激活的 Codex 跑 app-server trust-grant；非强制 preflight 只做本地检测并以 additive 的 `checked: false` 报告"未检查"（UI 显示"未检查 / Not checked"并保留 Connect / Re-check）；用量服务在没有已激活 provider 时不调度任何刷新，之后只抓已激活的 provider，手动刷新不受影响。`golden-egress-cold-start` 在宿主上两种场景均为 `{}`，成为 M0 出口门禁。

**保留的风险/后续**：老 profile 需要一次用户动作才会重新开始启动期 hook 刷新（启动路径按需 grant，能力不丢）；`opencode`/`minimax` 没有对应启动 id，只能经手动刷新或其它记录路径；后台 e2e 观察不到前台用量轮询与 `gh auth status`，这两处门禁靠单元测试（前台抓包列入 M0 出口检查）；`typecheck:e2e` 在 main 上仍为既有红（hygiene）。流水线教训：sidecar 断言先在候选上试跑；Worker 不得对 Markdown 跑格式化；`config/tsconfig.cli.json` 显式枚举 main 模块，CLI 可达图里新增模块必须登记。

## D39 · Controlled Acceptance Fixture 改为自建：`LaPaGaYo/flowtask-fixture`（MIT），Orca 式合成仓库继续用于 CI 级测试 — ACCEPTED（Henry 2026-10-15）

**背景**：D18/G8 写的暂定候选 "FlowTask @ `b551cfaeb7ce2d42433b29d63c43659a6b9e4d56`" 没有对应的仓库——项目文档、仓库、记忆里都没有 URL，Henry 本人也没有这个仓库；按 D18 的后备条款（候选在 M0 出口前过不了全部硬门槛即改用组织自有的参考任务管理应用）应改为自建。现成候选经核查也不满足硬门槛：小型 CLI（`taskbook`、`taskmd`、`locus` 一类）只有几十个文件、几乎没有测试套件；大型应用（Planka、Focalboard、super-productivity、Vikunja）文件数以千计、依赖数据库或外部服务、全量测试远超 8 分钟；而 fixture 必须由我们控制才能预埋五个场景、冻结 commit、写 manifest。上游 Orca 从未有过验收 fixture：它的 e2e 用 `tests/e2e/helpers/seeded-test-repo.ts` 在临时目录生成一个几乎空的 git 仓库，配合 `tests/e2e/fixtures/golden-stub-agent/` 的假 agent 脚本测 UI 与运行时。
**决定**（Henry 2026-10-15，仓库已建）：Controlled Acceptance Fixture 为自建的 **FlowTask** 参考任务管理应用，仓库 `https://github.com/LaPaGaYo/flowtask-fixture`，许可 MIT。形态：TypeScript（strict、ESM）；领域 = 项目 / 任务 / 标签 / 依赖 / 重复规则 / 活动日志 / 视图与报表；`flowtask` CLI；`node:http` 的本地 JSON API；JSON 文件存储（原子写入；不用原生依赖，保证离线确定性）；vitest 单测 + 以子进程方式驱动 CLI 与 API 的集成测试；`tsc` 构建；oxlint；注入式时钟与随机源，测试中不碰真实时间与网络。工具链固定：Node 22（`.nvmrc`）、pnpm 10（`packageManager` 精确版本）、锁文件提交。硬门槛按 D18：150–500 个受跟踪文件、≥ 20 个测试文件、`verify:fast`（typecheck + lint + 单测）≤ 3 分钟、`verify:full`（+ build + 集成）目标 ≤ 8 分钟、一个可拆成 8–15 个 Task（≥ 3 个可并行就绪）的 Goal、五个预置场景（deterministic failure / merge-only failure / Agent crash / retry / stale-completion）以版本化 manifest 固定。分两步交付：FT-01 应用本体与检查命令；FT-02 场景、manifest v1、Goal 分解参考与宿主时限资格测试；通过后冻结 commit 为 fixture v1（之后只经 fixture-version Decision 变更）。
**分工**：Orca 式的合成仓库 + 假 agent 继续作为 Axiom 控制平面 M1–M4 单测 / e2e 的手段（秒级、CI 每次跑）；FlowTask fixture 只用于验收与演示（章程 §21 的 12 条成功标准、D18 的场景复现）。
**后果**：M0 出口项 "fixture 候选通过全部硬门槛并冻结 manifest v1" 改为对自建仓库执行；fixture 的开发用同一套 brief → Codex → 独立验证流水线（在 Mac 上单独 clone，不进 Axiom 仓库）；D18 的"候选 FlowTask @ b551cfae…"条目视为已被本决定取代。
**取代规则**：更换 fixture 仓库或改变其基线 commit 需新的 fixture-version Decision。

## D40 · M0-10 / M0-11 / M0-12 / M0-13 集成记录：隔离后 hygiene、`axiom.*` 命名空间、打包产物品牌与 `app.asar` 内容契约；M0 出口打包证据 — ACCEPTED（事实记录）

四个任务各经 brief → Codex Worker → 独立验证后 `--no-ff` 合入 main（验证记录在 `.axiom-work/verifications/`）：

- **M0-10 hygiene**（attempt 1，候选 `ef0d1e3a3`，`M0-10-1.md`；合并 `72aa50d74`）：config/.github 中的 cloud 残留、`ci-shard-timings.json` 过期条目、skill 存根、`docs/relay-region-correction/` 删除、feature-wall 的文档链接改经 `resolveProductDocsUrl`（`docsSiteOrigin: null` 时不渲染外链）、`package.json` 元数据（`license: MIT`、`homepage` → `LaPaGaYo/Axiom`、`author: LaPaGaYo`；`name` 仍为 `orca`，待单独决定）、`docs/review-evidence/axiom-m0/vendor-egress-baseline-notes.md`。基线 434 → **430** 对。宿主单测在 `startup-shell-portability.live-shell.test.ts` 上挂起 28 分钟：该文件在 `verify.sh` 里排除并记入 known-environmental。
- **M0-11 `axiom.*` 命名空间**（attempt 1，候选 `e1310d609`，`M0-11-1.md`；合并 `9d7909edd`）：`src/shared/axiom-contract/namespace.ts`（`AXIOM_RPC_NAMESPACE`、12 个方法前缀、保留 CLI 命令名 `mission plan task approval attempt`）、`src/main/axiom/namespace-rpc.ts` 的 `axiom.namespace.get`（params `null`）、与上游 RPC 方法与 CLI 命令的碰撞测试。只是命名空间占位与守卫，不含任何产品行为。
- **M0-12 打包产物品牌**（attempt 1 改字符串；attempt 2 修宿主构建，候选 `05f193fe4`，`M0-12-2.md`；合并 `ddb91bcdd`）：macOS computer-use helper 显示名 `Axiom Computer Use`、主应用六条 `extendInfo` 用途描述与 helper 两条用途描述改为 Axiom 文案、`main.swift` 12 条用户可见字符串；bundle id（`com.lapagayo.axiom.computer-use`）、Swift 模块/产品标识符与源码路径、`orca-computer-use-macos` / `orca-keyboard-layout` / `orca-notification-status` 可执行文件名保持。附带修复：Apple Swift 6.4 / Xcode 26 的 SwiftPM 默认把全部 `--triple` 构建写到 `.build/out/Products/Release`，上游 `build-computer-macos.mjs` 的 lipo 找不到输入——`swift build --help` 含 `--build-system` 时追加 `--build-system native`（`config/scripts/build-computer-macos-swift-args.mjs`，能力检测，旧工具链不受影响）。`verify-main`（M0-10/11/12 sidecar 并集 + 完整 lint）在 `ddb91bcdd` 上通过（失败文件仅 known-environmental）。
- **M0 出口打包检查**（`launchers/pack-unpack.command`、`launchers/e2e-packaged-egress.command`，证据 `docs/review-evidence/axiom-m0/M0-13-packaged-app.md`）：在 `ddb91bcdd` 上 electron-builder `--dir` 出包 `dist/mac-arm64/Axiom.app`，Info.plist 身份全部为 Axiom（`com.lapagayo.axiom`、`Axiom`、URL scheme `axiom`、helper 身份如上）；打包应用在回环录制代理下前台运行 75 s（含聚焦窗口与 onboarding），tally **`{}`**——补上了 D38 留下的"后台 e2e 看不到前台用量轮询与 `gh auth status`"缺口。但解析 `app.asar` 发现 electron-builder 的 `files` 是黑名单且不读 `.gitignore`：`.axiom-work/`（337 MB 日志）、`launchers/`、`test-results/`、`.anti-slop-plugin/`、`dist/` 等和六个工具文件都在包里（895 MB，asar 471 MB、15 个根条目）。
- **M0-13 `app.asar` 内容契约**（attempt 1 候选 `a13675d04`，`M0-13-1.md`，合并 `7a7f17c3e`）：14 条新排除项 + `config/scripts/verify-packaged-app-asar-contents.cjs`（`afterPack` 中只读 asar 头：根目录必须恰为 `out resources package.json LICENSE NOTICE.md`，任何 `.log` / `.axiom-work` / `launchers` / `test-results` / `.git` 路径都拒绝，unpacked 条目同样受检），25 个新测试（含用 electron-builder 真实 `FileMatcher` 验证 `out/mobile-web` 仍打包，D33a）。在候选上真实打包：`[verify-packaged-app-asar-contents] OK`，包 **572 MB**，asar 133 MB、5 个根条目、4,424 个条目、无禁止路径（验证者独立解析头部复核）。合并树全量 vitest（`verify-M0-02-5-20261016-010352.log`：9,896 个文件，33 个失败文件）抓到焦点目标盖不到的一个真回归：`config/scripts/electron-builder-runtime-resources.test.mjs` 两个驱动真实 `afterPack` 的测试没有 `app.asar` 夹具，被新守卫打红 → **attempt 2**（候选 `b3532a7b2`，`--base main`：共享的 `config/scripts/test-support/packaged-app-asar-fixture.mjs` 给两个测试种一个白名单布局的 asar，守卫不变；焦点 73/73、完整 lint 绿；`M0-13-2.md`，合并 `0c5e61560`）。其余 32 个失败文件 = 13 个 known-environmental + 19 个 `config/scripts/mobile-web-app-*-render` 测试——它们在 `mobile/node_modules` 缺失时自动跳过，装上之后需要 Playwright 的 chromium headless shell（`launchers/playwright-install.command` 已装，合并后链式回归里复跑）。 合并后（main `7d07bf3d3`）由 `launchers/chain.command` 一次跑完：M0-10..13 sidecar 并集回归（ratchet 430、`tc` ×3、changed-code 质量门、24 条额外断言、**完整 lint PASS**；焦点单测 1,693 个文件中 6 个失败文件 = known-environmental 的 `skill-recipe-shell` + 5 个需要 Playwright webkit 的 mobile-web 渲染测试（chromium 装好后 19 个里 14 个已转绿；webkit 随后安装））→ 打包（`pack-unpack-20261016-130758.log`：守卫 OK、572 MB、身份不变）→ 打包产物前台抓包 75 s（`packaged-egress-20261016-130840.log`：tally `{}`）。证据文档 `docs/review-evidence/axiom-m0/M0-13-packaged-app.md` 记录 A/B/C 三次打包与两次抓包。

**连带的 hygiene 决定**：装了 `mobile/node_modules`（打包 `build:mobile-web` 需要）之后，`pnpm lint` 的 `audit:code-quality:native` 能解析 mobile 的 import，报出 9 个上游既有的 `import/no-cycle`（`mobile/src/transport/*`、`mobile/src/terminal/document/*`）。上游 CI 在装 mobile 依赖之前跑这一步、其 changed-code 门为此显式 `--allow`，所以从未见过这些告警。为让 `pnpm lint` 不依赖宿主是否打过包，`config/oxlint-code-quality-native-plugins.json` 对 mobile 关掉 `import/no-cycle`（`e66514e7e` + `bc95b92bb`：oxlint 的 override glob 以配置文件所在目录 `config/` 为根，必须写成 `**/mobile/**/*.{ts,tsx}`——在隔离环境对 oxlint 1.85.0 验证过；顺带发现该文件里上游原有的不带 `**/` 的 override（renderer 的 jsx-a11y、mobile 的 exhaustive-deps）从来没有生效，进 hygiene 清单）；mobile 是交付但不维护的代码（D33a），这 9 个环进 hygiene 清单。

**保留的风险/后续**：`CFBundleShortVersionString` 仍沿用上游版本线 1.4.214（首个 Axiom 发布版本需 Decision）；asar 内仍有 2 处 `stablyai` 字符串——`NOTICE.md` 归属（必须保留）与 mobile `ProtocolBlockScreen` 指向上游 releases / App Store 的用户可点链接（hygiene）；`orca-keyboard-layout` / `orca-notification-status` 可执行文件名、NSIS 文案、`package.json.name` 待 hygiene 决定；Windows/Linux 未在此打包；签名/公证不在 M0 范围。流水线教训（已记入 workflow 手册）：任何驱动真实 `afterPack` 的测试必须进 sidecar targets；`attempt.sh` 对 seq>1 现在尊重显式 `--base`（`fb4fbff0f`）；运行中的流水线脚本不能被改写（bash 边读边执行；全部脚本体已包进 `main()`，`5fa35dc7d`）；宿主装了 `mobile/node_modules` 之后全量 suite 还需要 Playwright 的 chromium + webkit（`launchers/playwright-install.command`）。

**同期的 fixture 进展**（D39 的 FT-01）：`LaPaGaYo/flowtask-fixture` 两个 Attempt 后验收（`.axiom-work/verifications/FT-01-2.md`）：219 个受跟踪文件、61 个测试文件、214 + 17 个测试，`verify:fast` ≈ 2.5 s、`verify:full` ≈ 4 s、第二次 `verify:fast` 字节一致，每个导出都有直接测试并由契约测试机械保证；fixture `main` = `60f3824` 已推送。冻结为 v1 等 FT-02。
## D41 · 托管 CI（GitHub Actions）在 fork 里的职责与裁剪 — ACCEPTED（Henry 2026-10-16：选项 A；B/C 延期到 M1 控制平面代码合入后复审）

**背景**：A-lite 流水线的门禁在 Mac 上本地执行（`verify.sh` / `verify-merged.sh` / 全量 suite / 打包检查），推送 main 从不经过 PR。上游工作流清单（`.github/workflows/`，38 个）按触发方式分：
- **只在 `pull_request` 跑的门禁**：`pr.yml`（lint、anti-slop、code-quality、changed-code 门、分片单测、e2e 等——真正的上游门禁）、`pr-test-loc.yml`、`bun-profile-tests.yml`、`git-command-termination-runtime.yml`、`pi-owner-runtime.yml`、`pi-provider-runtime.yml`、`release-ref-validation.yml`、`performance-contracts.yml`（+ schedule）、`computer-e2e.yml`（+ schedule）。**直接推 main 时一个都不跑。**
- **push main 会跑的**：`ci-cache-warmup.yml`（+ schedule）、`mobile.yml`、`skill-update-roundtrip.yml`（+ merge_group）。
- **按 cron 定时跑、且没有 `github.repository == 'stablyai/orca'` 守卫的**：`ci-cache-warmup`、`computer-e2e`、`e2e`、`node-next-compat`、`packaged-browser-e2e`、`performance-contracts`、`terminal-ime-e2e`、`terminal-perf`——如果仓库不是 GitHub 意义上的 fork（schedule 在 fork 里默认禁用），这些会在 LaPaGaYo/Axiom 上按上游节奏消耗 Actions 分钟数。
- **只手动触发 / 有仓库守卫的**（上游发布基础设施：`daily/hourly/release-mac-build`、`dev-channel-win-build`、`docs`、`homebrew-bump`、`readme-downloads-badge`、`release-policy` 等）：在 fork 里是死代码，无害。
- 只对上游个人分支触发的（`daemon-relocation-spike`、`win-update-e2e`、`win-update-survival-e2e`：`branches: Jinwoo-H/windows-update-survival`）：无害。
会话里没有 LaPaGaYo/Axiom 的 GitHub API 访问权，托管 CI 的实际运行状态只能由 Henry 在 Actions 页查看。

**选项**：
- A（推荐，最小）：把 8 个无守卫的定时工作流和 3 个 push-main 工作流改为仅 `workflow_dispatch`（或加 `if: github.repository == 'stablyai/orca'`），不删文件、不动 `pr.yml`；托管 CI 在 M0–M1 期间只作为手动可触发的第二信号，门禁继续以本地验证记录为准（AGENTS.md 的"独立验证"由 Claude 在 Mac 上执行）。Hygiene 任务一次完成，顺带清掉工作流里仍引用已删除脚本/路径的步骤。
- B：给 `pr.yml` 加 `push: branches: [main]`，让每次推送跑上游全套门禁。代价：`pr.yml` 的 changed-code 门用 `github.event.pull_request.base.sha`，push 事件要改用 `github.event.before`；分片单测与 e2e 在 GitHub runner 上每次推送约 1–2 小时、多台 runner；macOS runner 分钟数昂贵；而且上游 e2e 在 fork 环境的通过率未知（我们本地有 13 个已知环境性失败文件，runner 上会是另一组）。
- C：删除全部上游工作流，只留一个 Axiom 自己的 `ci.yml`（lint + tc + 单测分片），在 M1 之后随控制平面代码一起设计。

**决定**（Henry 2026-10-16）：**选项 A**。实施为 hygiene 任务 M0-14：10 个工作流去掉 `schedule:` 与 `push:` 触发（`ci-cache-warmup`、`mobile`、`skill-update-roundtrip`、`computer-e2e`、`e2e`、`node-next-compat`、`packaged-browser-e2e`、`performance-contracts`、`terminal-ime-e2e`、`terminal-perf`），保留 `workflow_dispatch` / `workflow_call` / `pull_request`，不删文件、不动 `pr.yml`；同步更新断言这些触发器的工作流自测（`ci-cache-warmup-workflow`、`skill-update-roundtrip-workflow`、`terminal-ime-e2e-workflow`、`computer-e2e-workflow` 等）。推送 main 之前的门禁仍是本地的 `verify-merged` + 全量 suite + 打包检查。
**延期复审（登记在 `docs/decisions/DEFERRED.md`，不可遗忘）**：B（`pr.yml` 加 push 触发）与 C（Axiom 自己的 `ci.yml`）在 **M1 控制平面代码首次合入 main 之后、M1 出口之前**重新决定；届时需带上 fork 里托管 CI 的实际运行记录（Actions 页）与本地门禁的时长数据。
**取代规则**：B/C 的复审结果以新 Decision（D41a 或独立编号）记录并取代本条的 CI 策略；在那之前任何新增工作流默认只允许 `workflow_dispatch` / `workflow_call` / `pull_request` 触发。

## D42 · fixture-version Decision：Controlled Acceptance Fixture v1 冻结为 `LaPaGaYo/flowtask-fixture` @ `a6a8413`（tag `fixture-v1`） — ACCEPTED（事实记录；执行 D39 的冻结条款，Henry 可在 M0 出口确认时否决）

**背景**：D39 把 fixture 改为自建，并规定「候选通过全部硬门槛并冻结 manifest v1」为 M0 出口项、「更换 fixture 仓库或改变其基线 commit 需新的 fixture-version Decision」。两个 fixture Task 都已走完 brief → Codex Worker → 独立验证 → `--no-ff` 合入 fixture `main` 的流水线：FT-01（应用，`.axiom-work/verifications/FT-01-2.md`，fixture `main` `60f3824`）与 FT-02（五个场景、stub worker、`fixture-manifest.v1.json`、参考 Goal 分解、`qualify` / `scenarios:check`，`FT-02-2.md`，fixture `main` `a6a8413`）。FT-02 的 attempt 1 只败在 `qualify` 的 `fast-identical` 门（oxlint 的 `Finished in <n>ms` 计时行让两次 `verify:fast` 输出不等）；attempt 2 只归一化 `Finished in …` 行里的时长片段（文件数与线程数保留），差异时报告首个不同行，并由 `scripts/qualify.test.mjs` 固定下来。

**决定**：fixture v1 基线 = commit **`a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642`**（fixture `main`；注释标签 **`fixture-v1`**，标签对象 `ae59963`，由 `launchers/fixture-tag.command` 创建并只推送 `refs/tags/fixture-v1` 这一个引用）；manifest = `fixture-manifest.v1.json`（sha256 `00377615f5273c20c85c528bfe4e45933494853f14fdc90f39fb25e2441afa9d`，`manifestVersion: 1`，`baselineRef: "fixture-v1"`）。硬门槛对照（D18 / 章程 §9）：

| 硬门槛 | v1 实测（验证者独立核对，非 Worker 自述） |
|---|---|
| 许可 | MIT（仓库 LICENSE 与 manifest 一致） |
| 固定版本 | commit `a6a8413` / tag `fixture-v1`；Node 22（`.nvmrc`）、pnpm 10.34.7（`packageManager`）、TypeScript 7.0.2、vitest 4.1.12、oxlint 1.88.0；锁文件已提交且自 FT-01 起字节不变 |
| 确定性检查 | `typecheck` / `lint` / `test:unit` / `build` / `test:integration` 离线可复现；`qualify` 在已提交树上连续 PASS 两次（`fast-identical`：两次 `verify:fast` 输出在归一化计时片段后一致） |
| 时限 | `verify:fast` ≈ 2.5 s（预算 180 s）、`verify:full` ≈ 4.2 s（预算 480 s）、`scenarios:check` ≈ 43 s、`verify:fixture` ≈ 48 s（macOS arm64，12 核） |
| 规模 | 254 个受跟踪文件、62 个 `*.test.ts`（另有 4 个 `scripts/*.test.mjs`）；214 单测 + 20 集成 + 23 脚本测试 |
| 可分解性 | `GOAL.md`「Sprints and planning」→ `scenarios/goal/decomposition.json`：12 个 Task（T01–T12），3 个根 Task 可并行就绪（T01 Sprint 实体与校验、T02 表格 CSV 互换、T03 就绪工作报表），最长依赖链 7，每个 Task 列出允许改动的文件 |
| 预置场景 | S1 `deterministic-failure`（6 步）、S2 `merge-only-failure`（semantic + textual，11 步）、S3 `agent-crash`（crash → 137/SIGKILL + 半写文件无报告、hang → 每秒心跳不退出、succeed，3 步）、S4 `retry`（4 步）、S5 `stale-completion`（5 步）：全部 29 步由 `pnpm run scenarios:check` 机械证明，期望值（含精确的失败测试名与 `git apply --check` 拒绝）写在 manifest；验证者在 Linux VM 上独立复核了补丁序列与 stub worker 的退出码/文件副作用 |

**冻结规则**：V1 期间 Axiom 的验收与演示一律以 `fixture-v1`（manifest 的 `baselineRef`）为基线。任何对基线 commit、manifest、场景补丁或 stub worker 的修改都必须经新的 fixture-version Decision（D42a、D42b…）并产生新 tag（`fixture-v2`…）与新的 manifest 版本号；已推送的 `fixture-v1` 标签不得移动或删除。fixture 仓库的 `main` 之后可以继续演进（例如为 M3/M4 增加场景），但 Axiom 引用的永远是 tag，不是 `main`。

**后果**：M0 出口项「fixture 候选通过全部硬门槛并冻结 manifest v1」完成；章程 §9 的「暂定候选 FlowTask @ b551cfae…」段落改写为冻结后的事实（修订记录第 13 条）；Evidence Deliverable「Controlled Acceptance Fixture 的资格测试记录与版本化 fixture manifest」= `FT-01-2.md` + `FT-02-2.md`（Axiom 仓库）+ `fixture-manifest.v1.json` + `docs/FIXTURE.md` + `REPORT-FT-01.md` / `REPORT-FT-02.md`（fixture 仓库）。

**保留的观察/风险**：S2（semantic a、textual a/b）、S4、S5 的补丁都改 `src/services/date-range.ts` 第 7–10 行——各场景按 manifest 各自在新的基线树上执行，互不影响；但组合演示只能是 S1 + {S2 | S4 | S5} 之一 + S3，不能把 S2/S4/S5 叠到同一棵树上。`qualify` 的 `clean` 门在脏树上必失败（设计如此：Worker 在沙箱里永远过不了它，由 launcher 提交后验证者重跑）。资格测试只在 macOS arm64 上跑过，Linux/Windows 宿主的时限未测（manifest 预算留了 ≥ 60× 余量）。Worker 的负面对照（改掉 S1 补丁的故意缺陷后 `scenarios:check` 在 `one-failure` 步失败）记录在 `REPORT-FT-02.md`，验证者未重复执行。

**取代规则**：更换仓库、基线 commit、manifest 版本或场景集合需新的 fixture-version Decision；本条不取代 D39 的分工（Orca 式合成仓库继续用于 M1–M4 的单测 / e2e）。

## D43 · M0 出口检查清单 — ACCEPTED（Henry 2026-10-17：M0 关闭）

**背景**：章程 §9 定义 M0 = 新产品身份与网络隔离（品牌、更新源、telemetry、第三方 notice、网络出口清单与断言测试）；D18 追加 fixture 资格测试；D40 追加打包证据；`DEFERRED.md` 要求里程碑出口逐条核对延期事项。下表逐项对照，每项都指向独立验证记录（`.axiom-work/verifications/`）或证据文档，没有一项靠 Worker 自述。

| 出口项 | 证据 | 状态 |
|---|---|---|
| 产品机器身份（bundle id、URL scheme、CLI / 可执行名、发布仓库） | M0-02（`M0-02-5.md`，D21）；打包产物 Info.plist 身份全部为 Axiom（`docs/review-evidence/axiom-m0/M0-13-packaged-app.md`） | 完成 |
| 更新源、changelog / nudge、插件 kill-list、反馈与崩溃上传、官方诊断 | M0-03（`M0-03-2.md`） | 完成 |
| 产品 telemetry 移除 | M0-04（`M0-04-4.md`，D25） | 完成 |
| 品牌与文案：应用 / CLI / 文档站 / README / attribution notice、`orca://` 残留；打包 helper 显示名与权限提示文案 | M0-05a、M0-05b-1、M0-05b-2（D32）；M0-12（`M0-12-2.md`） | 完成；asar 内仍有 2 处 `stablyai`（`NOTICE.md` 归属必须保留；mobile `ProtocolBlockScreen` 的上游链接 = hygiene） |
| 云服务 / 插件市场 / 技能来源纳入产品出口策略 | M0-06a、M0-06b | 完成 |
| 上游云基础设施树与原生移动发布 CI 移除 | M0-07（D33 / D33a） | 完成 |
| 网络出口清单 + 断言测试 | vendor-egress ratchet 基线 430 对（M0-10）；冷启动 / 空闲零出口（M0-08 FAIL for cause → M0-09 PASS，D37 / D38）；打包产物前台 75 s 抓包 tally `{}`（D40） | 完成 |
| `axiom.*` RPC 命名空间与 CLI 命令名无碰撞 | M0-11（`M0-11-1.md`） | 完成 |
| 打包产物内容契约（`app.asar` 根目录白名单、禁止路径守卫） | M0-13 两个 attempt（`M0-13-1.md`、`M0-13-2.md`）：572 MB、asar 5 个根条目、守卫 OK | 完成（仅 macOS arm64；签名 / 公证与 Windows / Linux 打包不在 M0 范围） |
| 托管 CI 策略 | D41 选项 A → M0-14（`M0-14-2.md`）；B / C = DEF-1 | 完成（DEF-1 在 M1 复审） |
| Controlled Acceptance Fixture 资格测试 + manifest v1 冻结 | FT-01、FT-02、D42（`fixture-v1`） | 完成 |
| 三份文档（`docs/GLOSSARY.md`、`docs/PROJECT_CONSTITUTION.md`、`docs/reference/orca-mapping.md`）与 `AGENTS.md` | 已在仓库 | 完成（落位规则 D13 仍 PROPOSED，随 M1 前置 Decision 一并拍板） |
| 延期事项核对（`DEFERRED.md`） | DEF-1（M1 控制平面首次合入后）、DEF-2（M1 Settings UI 排期时）、DEF-3（首个发布版本前）全部 OPEN，触发点都在 M0 之后 | 核对完成，不阻塞 |

**明确留到 M0 之后的**：Windows / Linux 打包与签名 / 公证；`package.json.name`、`CFBundleShortVersionString`、`orca-*` helper 可执行文件名与 NSIS 文案（DEF-3）；mobile 代码的 9 个 `import/no-cycle` 与 `ProtocolBlockScreen` 上游链接（hygiene 清单）；上游 `typecheck:e2e` 在 main 上本就红（hygiene）。

**决定**（Henry 2026-10-17）：确认上表，**M0 关闭**（Axiom main `3a5c63832`，fixture `fixture-v1`）。M1 的前置 Decision D6a、D7a、D9–D16 已于 2026-10-17 全部 ACCEPTED，M1 的任务分解随后以 brief 形式提出。
**取代规则**：无。M0 之后发现的 M0 范围内缺口以新的 M0-nn Task 记录并在本条下追加一行，不重开里程碑。

## D44 · M1（Mission Facade）任务分解与顺序 — ACCEPTED（Henry 2026-10-17）

**背景**：M0 已关闭（D43）；M1 的前置 Decision D6a、D7a、D9–D16 已全部拍板。架构 §20 给出 M1 的范围与三条出口标准，但没有可执行的 Task 粒度。
**决定**：M1 按 `docs/plans/M1.md` 的 10 个 Task 执行：M1-01 D14 映射核实 spike（只写测试与报告，不改生产代码；结论若推翻 D14 则记 D14a）→ M1-02 共享契约 → M1-03 迁移 v43（一次建全 `orca-mapping.md` §6 的 side table，之后只 additive 加列）→ M1-04 AxiomStore → M1-05 MissionController 与状态机（不启动 Attempt）→ M1-06 `axiom.mission/goal/plan/task` RPC + 契约栅栏 / 幂等收据 + CLI → M1-07 admission 守卫（映射 §4b 全部拦截点）→ M1-08 run mailbox 消费者骨架 + RecoveryService（M1 子集）→ M1-09 Mission Home + Task 列表 → M1-10 在 `fixture-v1` 上的出口 e2e、`docs/reference/control-plane.md`、DEF-1 复审。M1 不含 Planner：Plan 经 CLI / RPC 以 JSON 喂入（fixture 的 `scenarios/goal/decomposition.json` 即 M1 的参考 Plan），M2 再接 Planner。M1 出口标准 = 架构 §20 的三条 + `DEFERRED.md` 逐条核对。
**理由**：每个 Task 一次 Codex attempt 可完成、可独立验证并有明确 sidecar 门；把最大的不确定性（Control Plane 以什么身份接入内核）放在第一个 Task 用测试钉住；schema 一次到位避免 M2–M4 反复 bump `SCHEMA_VERSION`。
**后果**：`docs/plans/M1.md` 是 M1 的 PlanRevision 等价物（Axiom 自身的 Control Plane 尚不存在）；brief 在 `.axiom-work/briefs/M1-nn.md`，验证记录在 `.axiom-work/verifications/`；分解的拆分 / 合并 / 新增以本条下的修订行记录，不重写本条。
**取代规则**：M1 出口 Decision 记录实际完成情况并关闭本条；范围变更经修订行。

## D45 · DEF-1 复审：托管 CI 的后半部分 — ACCEPTED（Henry 2026-10-17：A + C-lite）

**背景**：D41 选了 A（本地门禁为权威，上游工作流原样保留、只在 PR 上触发），并把 B / C 延到 M1 控制平面代码合入后复审（DEF-1）。触发点已到：M1-01～M1-10 全部合入 main。复审数据（2026-10-17）：

| 数据 | 事实 |
|---|---|
| fork 的 Actions 运行记录 | `GET repos/LaPaGaYo/Axiom/actions/runs` → `total_count: 0`：fork 上从未跑过任何托管工作流（上游 40 个工作流都是 `pull_request` / `workflow_dispatch` / 带 paths 过滤的 `push`；Axiom 直接推 `main`、不走 PR），托管 CI 目前贡献 0 信号，分钟数 0 |
| 上游 `pr.yml` 的体量 | 1,197 行、约 14 个 job：code_paths 守卫、static analysis（≈ 20 项 check / ratchet / verify）、typecheck（`ubuntu-24.04-arm`）、git compatibility、codex index-heal、xterm patch sync、shell contracts、`unit-tests.yml` 8 分片、orcad browser provider、mobile web bundle、cross-version wire、managed hooks Node 18；changed-code 门依赖 `github.event.pull_request.base.sha` |
| 本地 attempt 门禁（57 次 launcher 验证：M0 44、M1 13，`docs/review-evidence/axiom-m1/M1-exit-e2e.md#local-gate-timings`） | M1 中位数：unit（定向 targets）5 s、typecheck 0–1 s（增量缓存）、changed-code quality 2 s、完整 lint 80 s、墙钟 94 s；renderer 任务 141–188 s。固定成本 = 完整 lint |
| 合并树检查 `verify-main`（M1 十个 sidecar 的并集 + 完整 lint，main `4db3ad86c`，`verify-merged-4db3ad86c-20261017-045350.log`） | 1,739 个测试文件 / 16,235 个测试：16,214 通过、20 skipped、1 失败 = 已登记的环境性 flake `src/main/ipc/pty-runtime-hidden-at-spawn-mark.test.ts`（定向重跑 8/8 绿）；unit 142 s，extras 全过，lint 82 s，墙钟约 4 min |
| 全量 suite（`pnpm test` on main `4db3ad86c`，`fullsuite-main-20261017-045905.log`） | 9,943 个测试文件：9,852 通过、79 skipped、11 失败——全部在已登记的 known-environmental 列表上（与 M0-09 的全量基线集合相同）；1 个未跑 = 会挂起宿主的 `src/shared/startup-shell-portability.live-shell.test.ts`（verify.sh 一直排除它，fullsuite 启动器已同步排除）；94,245 个测试：93,635 通过、25 失败（全在那 11 个文件里）、1 expected fail、513 skipped；约 14 min 墙钟（04:59–05:13）。M1 没有引入新失败 |
| 只能在宿主跑的部分 | Electron e2e（headless，`ORCA_BACKGROUND_LAUNCH=1`）与 fixture 出口 e2e（`AXIOM_FIXTURE_REPO`）：Worker 沙箱不能启动 Electron（SIGABRT）/ 不能绑 socket；Linux CI 需要 xvfb 才能跑 Electron |

**选项**：
- **A（维持）**：只靠本地 launcher 门禁。成本 0；风险：单机、单平台（macOS arm64），没有第二台机器的独立信号。
- **B**：上游 `pr.yml` 加 `push: branches: [main]`：每次推送跑完整上游矩阵（估 60–120 runner-min / push，含 ARM runner；含依赖宿主环境的 suite，flake 风险），changed-code 门要改成 `github.event.before`，并且改动上游工作流文件会增加 rebase 冲突面。
- **C**：删上游工作流、只留 Axiom 自己的 `ci.yml`：丢掉全部上游覆盖，对上游的 diff 大，rebase 代价高。
- **A + C-lite（建议）**：A 继续作为权威门禁；只**新增一个** Axiom 自己的小工作流 `.github/workflows/axiom-ci.yml`（`push: branches: [main]` + `workflow_dispatch`；`ubuntu-latest`、Node 24、`pnpm install --frozen-lockfile`）：`pnpm tc:node && pnpm tc:cli && pnpm tc:web`、`pnpm lint`、`pnpm test src/main/axiom src/shared/axiom-contract src/main/runtime/rpc/methods/axiom src/cli/specs src/cli/handlers/axiom src/renderer/src/components/missions src/renderer/src/lib/axiom-client.test.ts tests/e2e/helpers/fixture-plan-proposal.unit.test.ts`。估 6–10 min / push，Linux 上的第二信号，不碰任何上游工作流文件（它们保持 PR-only 休眠，rebase 零冲突）。前提：Henry 在 fork 的 Settings → Actions 里启用 Actions（fork 默认关闭）。fixture 出口 e2e 在 M1 仍只在宿主跑；若第二信号证明有用，M2 再加 xvfb 的 Electron e2e job。

**决定**（Henry 2026-10-17）：**A + C-lite**。本地 launcher 门禁仍是权威；新增 `.github/workflows/axiom-ci.yml` 作为 Linux 上的第二信号，由 M2-00 hygiene Task 提交（brief 由 verifier 写，Worker 实现，launcher 验证）；上游工作流文件一律不动。`DEFERRED.md` 的 DEF-1 改为 `RESOLVED (D45)`。前提动作（Henry）：在 fork 的 Settings → Actions 启用 Actions。
**取代规则**：CI 策略再变更以新 Decision 取代本条；D41 的 A 部分不受影响。
- **首次托管运行记录（2026-10-17）**：run #1 `39055324479`（main `0b4a67ced`，M2-00 合入）：Lint 3 m 17 s 绿、Axiom tests 1 m 18 s 绿、Typecheck 54 s **红**（真实类型错误，见 D46 修订行 / M1-11 / D47）；run #2 `39057000785`（main `c305070cd`，M1-11 合入）：**全绿**，Typecheck 110 s、Lint 198 s、Axiom tests 68 s，总时长 3 m 21 s。第二信号已就位：每次推送 main 约 3.5 min，三个 job 并行。

## D46 · M1 出口检查清单 — ACCEPTED（Henry 2026-10-17：M1 关闭）

**背景**：架构 §20 给 M1 三条出口标准；D44 要求出口 = 三条 + `DEFERRED.md` 逐条核对；`docs/plans/M1.md` 另要求 M1-05 之后每次合入跑 `verify-main`、M1-08 之后跑一次全量 suite。下表逐项对照，每项都指向独立验证记录（`.axiom-work/verifications/`）或证据文档，没有一项靠 Worker 自述。M1 的十个 Task 共 15 个 attempt，全部在 2026-10-17 00:40–04:50 内完成并合入（main `4db3ad86c`）。

| 出口项 | 证据 | 状态 |
|---|---|---|
| 出口 1：应用重启后 Mission / GoalRevision / PlanRevision / Task / stage 不丢 | M1-08 文件 DB 重启测试（`control-plane-boot.test.ts`，`M1-08-2.md`）；M1-10 在 `fixture-v1` 上的宿主 e2e：关闭并在同一 profile 重启，`mission show` / `goal show` / `plan show` / `task list` 载荷逐字节相同、Mission `EXECUTING`、`recovery.run_binding_lost` 0、Mission Home 与 Task 表文本相同（`M1-10-2.md`；`docs/review-evidence/axiom-m1/M1-exit-e2e.md` 实测表） | 完成 |
| 出口 2：直接 `orchestration.taskUpdate` / `workerStart` / `reset` 打 Mission Run 被拒 | M1-07 RPC 级：绑定 coordinator 的 `taskUpdate` / `workerStart` / `dispatch` / `reset` → `mission_managed`，状态快照不变（`admission-rpc.test.ts`，`M1-07-1.md`）；M1-10 真实 CLI：`reset --tasks` → `mission_managed`，`task-update` / `worker-start` → `no_active_sender_terminal`（CLI 身份层，命令未到 runtime；三层拒绝：CLI 身份 → runtime Run 绑定 `run_required` / `consumer_fenced` → Mission 守卫），前后 CLI 快照与 Mission 状态不变 | 完成（CLI 只能到达第一层；bound-coordinator 路径由 RPC 测试证明） |
| 出口 3：映射 §4b 每个拦截点有测试 | M1-07 四个测试文件 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message}.test.ts`（含非 Mission Run 对照） | 完成（M2 需把 `workerStop` / `workerAbandon` / `workerRelease` / `workerRetain` / `workerTerminalUserInput`、`ask` / `reply`、群发路由、federation 纳入守卫评审） |
| D14 映射核实 spike | M1-01（`M1-01-1.md`，`docs/review-evidence/axiom-m1/D14-session-party-spike.md`）：合成 `axiom-mission-<uuid>` session party 成立，D14 保留 | 完成 |
| 共享契约（枚举与术语表一一对应、PlanProposal / DAG 校验、params / 响应 schema） | M1-02（`M1-02-2.md`；glossary parity test） | 完成 |
| Schema v43：映射 §6 的 17 张 side table 一次建全，之后只 additive | M1-03（`M1-03-2.md`；`axiom-tables-migration.test.ts`） | 完成（M1 业务写入 7 张；其余 10 张只建表） |
| AxiomStore（zod 行校验、savepoint 事务） | M1-04（`M1-04-1.md`） | 完成 |
| MissionController：Mission / Goal / Plan 生命周期、Task 物化、readiness 重算、`previous_status` / `previous_stage` | M1-05（`M1-05-1.md`） | 完成（不启动 Attempt；`blockingQuestionOrApproval()` 为 M1 存根） |
| `axiom.mission/goal/plan/task` RPC + 契约栅栏 / 幂等收据 + CLI | M1-06（`M1-06-1.md`） | 完成 |
| run mailbox 消费者骨架 + RecoveryService（M1 子集）+ 桌面 / daemon 启动接入 | M1-08（`M1-08-2.md`） | 完成（`reconcileAttempts()` 空钩子；250 ms 固定退避与 audit 扫描去重是 M2 的上限） |
| Mission Home + Task 列表（missions 视图、envelope 客户端、stage 文案、headless e2e） | M1-09（`M1-09-2.md`；宿主 e2e `mission-home-task-list.spec.ts` PASS） | 完成（Settings → Shortcuts 文案副作用与一处注释重复词 → M2 UI Task） |
| `docs/reference/control-plane.md`（AGENTS.md Required Reading）+ 映射 §2 / §4a / §4b / §4c / §6 / §8 回填 | M1-10（`M1-10-2.md`） | 完成 |
| 合并树检查 `verify-main`（M1 十个 sidecar 并集 + 完整 lint） | main `4db3ad86c`：1,739 文件 / 16,214 通过 / 1 失败 = 已登记环境 flake（`verify-merged-4db3ad86c-20261017-045350.log`） | 完成 |
| 全量 suite（`pnpm test`） | main `4db3ad86c`：9,943 文件：9,852 通过 / 79 skipped / 11 失败（全部 = known-environmental 基线，与 M0-09 全量基线相同）/ 1 未跑（已知挂起的 live-shell suite，verify.sh 一直排除）；93,635 测试通过；无新失败（`fullsuite-main-20261017-045905.log`） | 完成 |
| 延期事项核对（`DEFERRED.md`） | DEF-1 触发点已到 → D45（待 Henry）；DEF-2 的触发点（Settings / Integrations UI 排期）M1 未触及，OPEN；DEF-3（首个发布前）OPEN | 核对完成（DEF-1 与本条同时决定） |

**明确留到 M2 的**（均已写入各验证记录的 Observations 或 `docs/plans/M1.md`）：`MissionSummary` 不含 Run id 与暂停 / 阻塞 reason（renderer 已预留可选字段）；readiness 的 Question / Approval 存根与预算 / 并发 enforcement；consumer 退避与去重策略；Attempt 身份（= dispatch id）与 attempt-launcher seams（`startLocalWorker` additive 入参）；Planner；Settings 文案恢复 Apple 名称 + 注释笔误；UI 选择不跨重启、无轮询；出口 e2e 增加 Attempts / submissions / bound-coordinator 路径；环境 flake `pty-runtime-hidden-at-spawn-mark.test.ts` 在满负载时再现（3/4 次广泛运行失败、定向 8/8 通过）→ M2 hygiene 调查；上游 `typecheck:e2e` 基线 214 条（hygiene）。

**决定**（Henry 2026-10-17，回复"D43确认"——D43 已于 M0 关闭时接受，按上下文记为对本条的确认）：确认上表，**M1 关闭**（Axiom main `4db3ad86c` = M1-10 合入；本条与 D45 的文档提交在其后，fixture `fixture-v1`）。M2 的任务分解随后以 `docs/plans/M2.md` + Decision 提出（Scheduler / AgentSpec / ContextPackage / Attempt / Worker / Submission / Candidate；Planner 接入；admission 扩展）。
**取代规则**：无。M1 之后发现的 M1 范围内缺口以新的 M1-nn Task 记录并在本条下追加一行，不重开里程碑。
- **修订 2026-10-17（M1-11）**：首次托管 Axiom CI 运行（run 39055324479，main `0b4a67ced`）的 typecheck job 失败：`src/main/runtime/rpc/methods/ui-state-schema-parity-checks.ts(33,7)` 的值域 parity 断言——M1-09 把 `missions` 加进了 `TopLevelView` 与 `TOP_LEVEL_VIEW_LOOKUP`，没加进 RPC 的 `TopLevelViewSchema`（`src/shared/rpc-contract/client-ui-params.ts`）。本地 launcher 的 `tc:node` 九个 attempt 都是 1 s 的增量运行（stale `config/tsconfig.node.tsbuildinfo`），清缓存后 8 s 即复现同一错误。以 M1-11 修复（一行 + 运行时守卫测试），不重开 M1；流水线侧见 D47。

## D47 · 本地 typecheck 门禁改为清缓存运行（事实记录，2026-10-17）

**背景**：D45 的第一次托管运行就抓到一个本地门禁漏掉的真实类型错误（见 D46 修订行）。原因是三个 tsconfig 都是 `composite`，`config/tsconfig.*.tsbuildinfo` 让 `pnpm tc:*` 在 1 s 内返回，且对跨文件的类型级断言（`AssertNoMissingValues`）没有重新检查。
**决定**：`.axiom-work/verify.sh` 在三个 typecheck 门之前 `rm -f` 这三个 `tsbuildinfo` 缓存（干净的 `tc:node` 在验证者的 Mac 上 8 s；`verify-merged.sh` 复用同一脚本，自动获得）。托管 `axiom-ci.yml` 的 typecheck job 本来就是干净 checkout，保持不变。
**后果**：每个 attempt 的验证多出十几秒；M1-01～M1-10 的 typecheck PASS 记录只证明增量检查通过，M1-11 之后才是干净检查。首次托管运行的 lint（3 m 17 s）与 Axiom tests（1 m 18 s）job 绿；typecheck job 在 M1-11 合入后的第二次运行中核验。
**取代规则**：无。

## D48 · Planner v1 的形态：经 attempt-launcher 启动的只读规划 Agent，提案只能走 `axiom plan propose` — ACCEPTED（Henry 2026-10-17）

**背景**：架构 §7 第一步是"Planner 分析代码库与约束（只读 worktree）→ `axiom.plan.propose`"；M1 没有 Planner，计划由人用 JSON 喂入（D44）。M2 要接 Planner，但 V1 不新增 API key 存储、不新增 provider 适配层（§16.4），Mission Intelligence 的模型调用必须经现有 provider 适配层。
**决定**：Planner v1 = 一个 `role: planner` 的 AgentSpec，由与 Worker 相同的 attempt-launcher 在只读 planner worktree（`axiom/planner/<missionId>/<n>`，从集成基线创建；`permissions.write = []`）里以用户已有的 A 级 provider（结构化会话：Codex / Claude Code）启动；它的首条 prompt = Goal 正文 + 仓库规则 + PlanProposal JSON 契约 + `axiom plan propose --mission <id> --file <path>` 配方；提案只能经现有 `axiom.plan.propose` 进入（`provenance.kind = 'model'`），Mission `ANALYZING → PLAN_REVIEW`，批准仍由人在 Plan review 里完成（自动批准是 policy 项，M5 再议）。Planner 的 Attempt 结束后 worktree 释放；Planner 对权威状态没有任何直接写路径；其 diff 必须为空。启动入口 RPC `axiom.mission.plan`（CLI `axiom mission plan --mission <id>`）。
**备选**：(a) 进程内直接调 provider API 生成计划——V1 无 API key 存储，且绕过 Worker 通道的 capability / 收据；(b) 把 Planner 做成单独子系统——重复 launcher / worktree / 观测机制。
**后果**：Planner 复用 Scheduler 之外的直接启动路径（不占 Task 并发额度，但受 Mission 总 Attempt 预算约束）；`attempt_bindings` 需要能表示非 Task 的 planner 绑定（M2-09 的 brief 决定表示方式，不改 CHECK 枚举）；Planner 质量不在 M2 出口标准内（只要求 schema-valid、无环、≥ 1 根），M5 的 replanning 复用同一入口。
**取代规则**：Planner 改为进程内模型调用或多轮规划需新 Decision 取代本条。

## D49 · 确定性测试 provider（fake agent）用于 e2e 与宿主回归 — ACCEPTED（Henry 2026-10-17）

**背景**：M2 出口要证明 3 个 Attempt 并行 `RUNNING → SUBMITTED`、非法 Submission 被拒、重启不重复启动。真实 provider 不确定、有成本、沙箱里跑不了；Orca 自己的 e2e 已有 fake agent 机制（`tests/e2e/helpers/fake-agent-command-override.ts`、`golden-stub-agent.ts`：用 `ORCA_*` 启动覆盖把 `codex` 命令换成脚本）。fixture v1 自带确定性 stub Worker（`scenarios/stub-worker/worker.mjs`：按场景打补丁、写 `REPORT.md`，可 crash / hang）。
**决定**：e2e 与宿主回归使用"测试 provider"= Orca 的 fake-agent 启动覆盖 + 一个脚本化 agent：读 preamble 里的 Attempt 身份与 capability，在 Attempt worktree 里执行 fixture 的 stub Worker（`--scenario <按 Task 映射> --attempt <seq>`），然后调用 `axiom attempt submit --dispatch-capability …`（可按场景改为 `ask` / `blocked` / 直接退出 / 挂起）。它只存在于 `tests/e2e/` 与 fixture，**产品里没有这个 provider**，AgentFactory 的 provider 清单不包含它；M2 出口的"三种 provider"中它算一种，其余两种必须是真实 provider。
**后果**：出口 e2e 可在宿主确定性运行（验证者的 chain）；真实 provider 的 smoke（Codex 必有）作为补充证据而非唯一证据；D18 的 fixture 场景（retry / stale-completion / agent-crash / deterministic-failure / merge-only-failure）从 M2 起逐个被 e2e 消费。
**取代规则**：无；测试 provider 的协议随 Worker 通道变化而更新。

## D50 · `REQUEST_SUBTASK` 的 V1 策略：落为待决项，确定性检查通过且 policy 允许时才自动建 Task — ACCEPTED（Henry 2026-10-17）

**背景**：Constitution / AGENTS.md：Worker 不得直接派生 Worker；`REQUEST_SUBTASK` 由 Control Plane 在检查范围、深度、重复、依赖、成本、权限后决定是否建 Task。M2 要实现动词与检查，但 Planner / replanning（M5）与 Approval（M4）还不在。
**决定**：V1 的 `REQUEST_SUBTASK` 处理 = (1) 消息持久化（`payload.axiom.type = REQUEST_SUBTASK`，关联 Task / Attempt）并在 Mission Home 显示为待决项；(2) Control Plane 跑确定性检查：请求的 `scope.allowedPaths` ⊆ 发起 Task 的 scope、嵌套深度 = 1（`nested_worker_max_depth`）、与现有 Task 标题 / scope 无重复、依赖边不成环、Mission 预算仍有余量、发起 Attempt 有效；(3) 全部通过且 `mission_policies.approval_rules.subtaskAutoCreate === true` 时经 `axiom.task.create`（`MINOR_ADJUSTMENT`）物化为 DEFINED Task 并加边 `原 Task → 新 Task`；否则保持待决，由人在 UI 里接受（走同一 `task.create`）或拒绝，审计记录理由；默认 `subtaskAutoCreate = false`。发起 Attempt 不因请求而阻塞，可继续或 `blocked`。
**后果**：M2 不引入递归派生；`axiom.task.create` 在 M2-06 注册；M5 的 replan 分级可以把大量 `REQUEST_SUBTASK` 升级为 `MAJOR_REPLAN` 触发。
**取代规则**：Approval 接入（M4）后，自动建 Task 的条件可改为 policy + Approval；以新 Decision 取代。

## D51 · 集成基线 ref `axiom/integration/<missionId>` 在 `mission start` 时由 MissionController 创建（D6 的细化）— ACCEPTED（Henry 2026-10-17）

**背景**：D6 规定 Attempt 分支从集成基线 `axiom/integration/<missionId>` 创建，基线只由 IntegrationController 写；但 IntegrationController 是 M4 的，而 M2 的 attempt-launcher 已经需要一个基线来建 worktree。
**决定**：`axiom.mission.start`（`PLANNED → EXECUTING`）时，MissionController 以目标分支当前 HEAD 创建 `axiom/integration/<missionId>`（已存在则校验其祖先关系并沿用，不重置）；在 M4 之前该 ref 只读——任何 Attempt、验证或人工流程都不得移动它；M4 的 IntegrationController 接管后是唯一写者（PROMOTED = 前进该 ref）。创建失败（目标分支不存在等）→ `mission start` 失败且 Mission 保持 PLANNED（事务回滚）。
**后果**：D6 的"只由 IntegrationController 写"改读为"创建由 MissionController 在 start 时完成一次，之后只由 IntegrationController 前进"；目标分支漂移（§12.3）仍在 M4 处理。
**取代规则**：无。

## D52 · M2（Planning 与 Agent Factory）任务分解与顺序 — ACCEPTED（Henry 2026-10-17）

**背景**：M1 已关闭（D46）；架构 §20 的 M2 行给出范围与两条出口标准；D46 列出了 M1 遗留给 M2 的项；D48–D51 补齐了 M2 开工前的四个形态决定。
**决定**（Henry 2026-10-17：全部按提议 ACCEPTED，从 M2-01 开始；Mac 上可用的真实 provider：Codex、Claude Code、Gemini CLI）：M2 按 `docs/plans/M2.md` 的 11 个 Task 执行：M2-00 `axiom-ci.yml`（已完成）→ M2-01 内核 seam（`startLocalWorker` 的 service-only additive 入参，D14 适配器）→ M2-02 ArtifactStore + ContextBuilder → M2-03 AgentSpec + AgentFactory + RulesEngine 基线 → M2-04 Scheduler + 事务性 admission + 预算 → M2-05 attempt-launcher + `axiom.attempt.show/list` → M2-06 Worker 通道 `axiom attempt inform/request/blocked/handoff/request-subtask/ask/check` + admission 扩展 → M2-07 `axiom attempt submit` 结算 + Candidate 快照 → M2-08 RecoveryService（Attempt 子集）+ pause / cancel 处置 → M2-09 Planner v1 → M2-10 UI（Attempt 与待决项 + M1 文案遗留）→ M2-11 出口 e2e + 文档 + hygiene。出口标准 = §20 两条 + 重启不重复启动 + §4b 新增拦截点有测试 + 三种 provider（测试 provider 必有，真实 provider 以安装为准）+ `DEFERRED.md` 核对，详见计划文件。
**理由**：先把内核 seam 钉死（最大不确定性），再按 ContextPackage → AgentSpec → admission → launcher → Worker 通道 → 结算 → 恢复的依赖顺序推进；Planner 放在 launcher 与通道之后以复用它们；UI 与出口 e2e 最后。每个 Task 一次 Codex attempt 可完成、可独立验证、有 sidecar 门。
**后果**：`docs/plans/M2.md` 是 M2 的 PlanRevision 等价物；brief 在 `.axiom-work/briefs/M2-nn.md`；验证记录在 `.axiom-work/verifications/`；分解的拆分 / 合并 / 新增以本条下的修订行记录。粗估 3–5 个工作日的流水线时间。
**取代规则**：M2 出口 Decision 记录实际完成情况并关闭本条；范围变更经修订行。
- **修订 2026-10-17（M2-06 拆分）**：M2-06 拆为两个 Task 以保持单次 attempt 可完成：**M2-06a** = Worker 动词 `axiom attempt inform / request / blocked / handoff / request-subtask / check`（dispatch capability 校验、D9 载荷、MessageRouter M2 子集、`axiom.message.list`）+ 映射 §4b 新增拦截点（workerStop / Abandon / Release / Retain / TerminalUserInput、ask / reply、群发、federation）；**M2-06b** = `axiom attempt ask` + `axiom.message.answer`、D50 的确定性检查与 `axiom.task.create`、待决项 `axiom.message.resolve`。顺序 M2-06a → M2-06b → M2-07，其余不变。另记：M2-05 用了 6 个 attempt，其中 3 次是只有宿主才能证伪的 brief 事实（`--effort` 需 `--model`；fleet 投影的 liveness 只看 hook；daemon 让 PTY 跨重启存活），已写入 `.axiom-work/verifications/M2-05-6.md`。
- **修订 2026-10-17（M2-06c 新增，D53）**：在 M2-06b 之后、M2-07 之前插入 **M2-06c** = provider 退休规则（`ProviderFilterReason.retired`、`RETIRED_PROVIDERS = { gemini }`、`preferredProviders` 唯一覆盖、文档示例名改 Antigravity），1 个 attempt；本条决定行中的"Mac 上可用的真实 provider：Codex、Claude Code、Gemini CLI"由 D53 取代为 Codex、Claude Code、Antigravity CLI。
- **修订 2026-10-17（M2-06c 改为 D57）**：M2-06c 的范围由 D53 的 provider 退休规则改为 D57 Worker 认证矩阵的 V1 子集（`not_certified`、`endpointProfile`、产品内置的四个 `provisional` 组合）；brief 待恢复开发时重写。

## D53 · Gemini CLI 退役与 Antigravity CLI 接替（provider 退休规则）— ACCEPTED（Henry 2026-10-17）

**背景**：Google 于 2026-06-18 停止为个人账号（AI Pro / AI Ultra / 免费层）提供 Gemini CLI 服务（google-gemini/gemini-cli discussion #28017）；企业 Gemini Code Assist 许可与 API key 认证不受影响；替代品为 Antigravity CLI（二进制 `agy`，安装脚本 `https://antigravity.google/cli/install.sh`，安装时迁移 Gemini CLI 的 skills / MCP / agent profiles）。Orca 上游早已把它建模为 `antigravity` TuiAgent（`detectCmd: 'agy'`、`preflightTrust`、粘贴节流），Axiom 的 `DEFAULT_ORDER` 自动包含它。但 Henry 的 Mac 上 `gemini` 0.46.0 仍装在 `/opt/homebrew/bin/gemini`，M2-03 的 provider 选择按"已安装"把它排进候选——Scheduler 可能把 Task 派给一个无法启动的 provider，白白消耗 attempt。
**决定**：Axiom 增加 provider 退休规则：`ProviderFilterReason` 新增 `retired`（枚举与过滤顺序 `not_installed → retired → disallowed → tier_too_low`，取第一个命中）；`src/main/axiom/agent-factory/provider-selection.ts` 维护 `RETIRED_PROVIDERS`（首批：`gemini`，since 2026-06-18，附原因）；已安装的退休 provider 默认过滤，**唯一**解除方式是 Mission 的 `routing.preferredProviders` 明确点名（API key / 企业账号用户）。`TUI_AGENT_CONFIG` 与 Orca 探测层不改（上游职责）。Henry 机器的真实 provider 清单改为 Codex、Claude Code、Antigravity CLI（取代 D52 决定行中的 "Gemini CLI"）；章程 V1 出口第 4 条与架构文档里的示例名 "Gemini" 改为 "Antigravity（原 Gemini CLI）"，"至少三种 provider 各完成一次 Attempt"的要求不变。实现为 **M2-06c**（排在 M2-06b 之后、M2-07 之前，1 个 attempt）。
**备选**：(B) 只卸载本机 Gemini CLI、不改代码——对一台机器有效，对产品无效（任何装过 gemini 的用户都会撞上死 provider）；(C) 并入 M2-11 hygiene——期间 e2e / fixture 需用 `disallowedProviders: ['gemini']` 兜底，且 M2-09 Planner 与 M2-11 出口 e2e 会在真实机器上先碰到它。
**理由**：退役是产品级事实而非单机配置；规则确定性、可审计（`selection.filtered` 留痕）、可覆盖（显式偏好），符合"Decision Engine 只对过滤后的闭集排序"的边界；改动小（一个枚举值、一个常量、一个过滤分支）。
**后果**：`AgentSpec.selection.filtered.reason` 枚举变化 → 术语表 §4.13 增加 `ProviderFilterReason` 行；M2-03 测试里 tier-B 示例改用 `antigravity`；M2-11 出口 e2e 在 Henry 机器上应看到 `gemini` 被记为 `retired`、`antigravity` 可被选中。Codex 流水线不受影响（Axiom 自身的 Worker 仍是 Codex；`~/.codex/config.toml` 自 2026-10-17 18:00 起 `model_reasoning_effort = "max"`）。
**取代规则**：Google 恢复个人账号服务，或 Orca 上游在 `TUI_AGENT_CONFIG` 中引入 provider 生命周期标记时，由新 Decision 收缩或移除 `RETIRED_PROVIDERS`。
- **修订 2026-10-17（D57）**：退休名单机制由 D57 的认证矩阵取代——gemini 不在矩阵中即不可用，过滤原因改为 `not_certified`（不再新增 `retired`）；Gemini CLI 停服与 Antigravity 接替的事实、文档示例名改动保留；M2-06c 改为实现 D57 的 V1 子集。

## D54 · Skills 分配：按 agent 分工预配 skill 包、人工确认后生效；实施延期（DEF-4）— ACCEPTED（方向，Henry 2026-10-17）

**背景**：2026-10-17 架构对齐时 Henry 提出希望系统（含 Jev）能"分配 skills"。现有设计没有 skills 这一一等概念：AgentSpec 的 `capabilities` 由 Task 的 scope 路径确定性推导（M2-03）；ContextPackage 只有强制集 + 排序候选集（M2-02）；provider 侧的 skills（Orca 的 skill recipes、各 CLI 的项目级 skills 目录，例如 Codex Worker 用的 `branch-finish`）属于 Worker plane，Axiom 目前不干预。可借鉴的外部做法：AICU-Graph 用角色 YAML 引用 `skills_dir` 与 MCP 名，运行时把 skill 目录 symlink 进各 CLI 的项目级 skills 目录（评估见项目文档 `claude/external-projects-review-v1.md`）。
**决定（方向）**：skills 按 **agent 分工（角色）预配**，不由模型逐 Task 临场挑选：引入版本化、内容寻址的 **RoleProfile**（角色 → skill 包 + MCP 服务器 + 角色规则）；AgentFactory 把 RoleProfile 解析出的 skills 写进 AgentSpec（新字段 `skills`，与 `capabilities` 并列，进入 spec 的内容寻址）；attempt-launcher 在 Attempt worktree 中按 provider 把 skill 目录物化到该 CLI 的项目级 skills 目录（复用 Orca 既有的 skills 安装与 manifest 校验，不新造一套）。**人工确认**：RoleProfile 由用户维护与批准（作为 Mission policy 的一部分，改动走 `policy.updated` 审计）；Planner 提案的每个 Task 带 `role`，PlanRevision 的批准即确认该分工与对应 skill 包；RulesEngine 基线按角色匹配，Jev 之后只对候选 skill 做 advisory 排序（D8、不变量 10）。Worker 不能自行扩展 skills——等同权限扩展，需 Approval。
**实施**：延期，登记 **DEF-4**；触发点 = M2-09 Planner brief 定稿前（Task spec 需带 `role`）且 M3 Reviewer 角色落地前。在此之前 Worker 只用 provider 自带或用户机器上已有的 skills。
**理由**：角色级预配确定、可审计、可复现（内容寻址进 AgentSpec）；逐 Task 由模型临场挑 skill 既难验证，又把权限面交给了模型，违反"LLM 提议、Control Plane 授权"的不变量 1。
**取代规则**：DEF-4 复审时的 Decision 决定 RoleProfile 的 schema、存储与 UI 入口；Jev 参与 skill 排序需单独 Decision。

## D55 · 长期演进原则：借用的组件放在接口之后、按子系统逐步换成 Axiom 自有实现；CodeGraph 先内置 — ACCEPTED（方向，Henry 2026-10-17）

**背景**：2026-10-17 架构对齐。Henry 定下两条长期方向：(1) CodeGraph 现在内置进产品（代码智能数据源），之后换成 Axiom 自己的实现；(2) Orca 的代码随着 Axiom 推进逐步被 Axiom 自有实现取代，最终整个产品都是 Axiom 自己的东西。现状：main 与 upstream/main（stablyai/orca，2026-09-26 `3eb1adec2`）的 merge-base 就是该上游头，fork 之后未再同步；Axiom 在其上 318 个提交、与上游相差 2,598 个文件——Control Plane 全部是 Axiom 代码（`src/main/axiom/` 112 个文件、`src/shared/axiom-contract/` 33 个），其余多为 M0 的品牌与网络隔离；执行内核 `src/main/runtime/` 有 128 个文件改动（Axiom RPC 注册、M1-07 / M2-06a 的 §4b 拦截点、M2-01 的 service-only seam）。
**决定（原则）**：
1. **借用即为替换做准备**：任何借来的组件（Orca 内核子系统、CodeGraph、Jev）只能通过 Axiom 定义的接口 / seam 进入（`DecisionEngine`、`CodeIntelligence`、attempt-launcher 所用的 `startLocalWorker` seam 等）；Axiom 侧代码不得依赖借用方的内部词汇（CodeGraph 的 node / edge 命名要映射成 Axiom 自己的 schema）；基线实现必须存在，缺了借用方照常运行（不变量 10 的精神推广到全部借用组件）。
2. **CodeGraph 先内置**：作为 `CodeIntelligence` 的第一个 provider 随 Axiom 打包（走 ripgrep `@vscode/ripgrep-universal` 按平台二进制随构建复制的先例）；条件与复审数据见 DEF-5；替换路径 = Axiom 自有的 tree-sitter 索引器实现同一接口 → 只读并行对照（不作为权威）→ 切换 → 移除依赖。
3. **Orca 按子系统替换，不整体重写**：顺序由产品需要决定（预期：orchestration 的 Run / Dispatch / 消息层 → provider adapters 与 agent sessions → worktree / git 服务 → 终端 / PTY / daemon → UI 壳与 RPC 框架）；每个子系统的替换 = 一次 Decision + 迁移 + 对照测试（新实现先在接口后面跑通既有测试，再切换，再删旧码）。**原位替换**：任何时刻每个子系统只有一个权威实现（不变量 6；不允许第二套 worktree / terminal / worker 生命周期或 Task / 消息存储）；在被替换前照常复用，AGENTS.md 的 "Execution Kernel Boundary" 不变。
4. **V1 范围不变**（D8）：V1 期间内核照常复用，不做子系统替换；若某个 Orca 子系统阻塞 V1，以单独 Decision 提前处理。
5. **上游同步截止点另行决定**（DEF-7）：替换越多，合并 upstream 修复越难；在 V1 出口前、或首个内核子系统替换提出时评估是否冻结上游同步（fork freeze），冻结前一次性合入所需的上游修复（安全、Electron / Node 升级、provider 适配）。
6. **署名与许可**：Orca 为 MIT；`NOTICE.md` 的衍生声明在最后一段 Orca 代码移除前都保留，每次子系统替换后更新通告范围；CodeGraph（MIT）内置时加入通告。
7. **范围**：本条针对 Orca 与 CodeGraph 的代码；Electron、node-pty、SQLite、tree-sitter 等通用开源库不是 Orca 或 CodeGraph 的代码，不在本条范围（是否替换由各自的 Decision 决定）。
**理由**：产品价值在 Control Plane，内核只回答"在哪里、以什么进程执行"；借用让 V1 更快到达可验证闭环，接口化让替换成为可控的工程而不是一次重写。
**后果**：章程 §1 与架构 §4.5 各加一段长期方向（本次一并修改）；DEF-5 的方向定为"内置"；新增 DEF-6（AICU-Graph 借鉴项）与 DEF-7（替换路线图与上游同步截止点）；此后每个 brief 里引入借用组件时必须指明接口与基线。
**取代规则**：每个子系统的替换由各自的 Decision 记录；本条原则只由 Henry 修订。

## D56 · 上游同步策略：只摘取安全、平台（Electron / Node 升级）与 provider 适配修复 — ACCEPTED（Henry 2026-10-17）

**背景**：D55 把上游同步截止点留给 DEF-7。2026-10-17 首次只读初筛（`git fetch --no-tags upstream main`）：fork 点 `3eb1adec2`（2026-09-26）之后 stablyai/orca 已有 **2,965** 个提交（三周，约 140 个 / 天；fix 1,229、test 323、feat 322、refactor 195、perf 110），upstream 头 `ce2d60834c`（2026-10-17）；双方都改过的文件 1,017 个；Electron 43.7.0 → 43.7.8，Node engines 仍为 24。整体合并已不现实。
**决定**（Henry）：V1 期间只从上游摘取三类修复——**安全**（漏洞、凭据 / 权限、用户配置完整性）、**平台**（Electron / Node 升级、原生模块与 OS 兼容修复）、**provider 适配**（Axiom 实际使用的 provider 的启动 / 信任 / hooks / 就绪修复）；新功能、新增 provider、UI、重构、mobile / cloud / telemetry / marketplace、上游自身 CI 一律不摘。是否在 V1 出口冻结上游同步仍留在 DEF-7。
**流程**：
1. **初筛**：每周一次，另在出现安全公告或 provider CLI 行为变化时临时一次；从上次同步点起按路径（`package.json` 的 Electron / Node 行、`src/shared/tui-agent-config.ts`、`agent-trust*`、`src/main/agent-hooks/`、原生模块配置）与提交标题关键词做第一轮过滤，验证者逐条确认归类；upstream 只 `fetch --no-tags`，从不 push。
2. **应用**：每批一个 `UPSTREAM-n` Task 走 A-lite 流水线；Worker 用 `git cherry-pick -x` 保留来源，冲突按 M0 品牌映射解决，上游重构导致无法干净 cherry-pick 时做最小语义移植；**依赖变更**（`package.json` / `pnpm-lock.yaml`、Electron 升级）不在 Codex 沙盒执行，由验证者经宿主 launcher 安装后提交锁文件；D55 之后已被 Axiom 取代的子系统，上游修复只做语义移植或记 N/A。
3. **验证**：完整门禁 + 全量 suite + M0 网络隔离检查（vendor-egress 棘轮、`verify:egress-allowlist`、打包产物 egress 金丝雀——上游修复不得重新引入对原厂端点的请求）；provider 类修复加跑宿主 e2e（`mission-attempt-launch.spec.ts`）。
4. **记录**：`docs/decisions/UPSTREAM_SYNC.md` 记每批的上游范围、已应用 SHA 与对应 Axiom 提交、跳过项及类别、冲突与移植、验证日志，并推进同步点。
**理由**：上游节奏（约 140 提交 / 天）与 1,017 个重叠文件使整体合并不可行；安全与平台修复是 fork 最难独立获得的部分；provider 适配直接决定 Attempt 能否启动。
**后果**：DEF-7 去掉"上游同步策略"一项（保留冻结时点与替换路线图）；首批候选记在 `UPSTREAM_SYNC.md`（未应用，开发恢复后排期）。
**取代规则**：DEF-7 复审（V1 出口前）决定是否冻结；冻结时以新 Decision 取代本条。

## D57 · Worker 认证矩阵：身体（harness）× 大脑（model）× 接入方式（endpoint profile），只有登记的组合才能承担 Attempt — ACCEPTED（Henry 2026-10-17）

**背景**：2026-10-17 架构对齐（"Axiom 是办公室、agent 是员工、模型是大脑、skills 是经验"）时厘清：Codex CLI、Claude Code、Antigravity、OpenCode、CodeBuddy 等是 agent harness（身体与工作方式），不是模型。Orca 支持三四十种 harness 是它作为多 agent 终端的卖点（上游三周 2,965 个提交里有 332 个与 provider 适配有关）。M2-03 的选择规则是"已安装即候选"（A 级 = 结构化会话的 `claude` / `codex`，其余 TuiAgent 为 B 级），因此 Henry 的 Mac 上从未验证过 `axiom attempt` 协议的 `continue` 也会成为 B 级候选；D53 的退休名单只覆盖了 gemini 这一个特例。Orca 现有启动目录（`worker-launch-preferences`）：`claude` 接受任意模型名（如 `aws-bedrock-opus-5`），`antigravity` 接受账号范围的模型名，`opencode` 2 的 TUI 不接受 `--model`。
**决定**：
1. **三分**：Worker 的执行身份 = `provider`（harness）× `model`（模型，或 `harness-default` = 由 harness 自己的配置决定）× `endpointProfile`（接入方式：`subscription` = 用户在 harness 中已登录的订阅或已自行配置的凭据；以后可有 `api-key:<vendor>`、`gateway:<name>`、`local:<runtime>`）。AgentSpec 新增 `endpointProfile`（V1 只取 `subscription`）；凭据只以引用出现，绝不写入 AgentSpec 或 ContextPackage（两者内容寻址并存档）。
2. **认证矩阵（允许清单）**：AgentFactory 只在矩阵登记的组合中选择；已安装但未登记的 harness 记过滤原因 `not_certified`（新增；过滤顺序 `not_installed → not_certified → disallowed → tier_too_low`）。每条登记：provider、模型选择方式（启动参数 / harness 默认）、endpointProfile、可承担的角色（planner / worker）与最高风险等级、状态（`provisional` = 由 Decision 列入、证据待补；`certified` = 附宿主协议一致性 e2e 证据：收到 preamble → `axiom attempt inform` → 产出候选 → `axiom attempt submit` 合法报告）、认证时的 harness 版本。
3. **V1 初始矩阵**（均为 `provisional`；M2-07 合入后补认证证据；V1 出口前所有用到的组合必须为 `certified`）：Claude Code + Claude（启动参数选模型；A 级：planner 与全部风险等级）；Codex + GPT（同上，A 级）；Antigravity + Gemini（启动参数选模型；B 级：worker，低 / 中风险）；OpenCode + harness 默认模型（B 级：worker，仅低风险——它的大脑由用户在 OpenCode 中的配置决定，Axiom 看不见）。其余 harness（含 `gemini`、`continue`、`codebuddy`）登记前不承担 Attempt。
4. **路由**：RulesEngine 只在矩阵组合的闭集上排序（Mission 的 `preferredProviders` / `disallowedProviders` 照旧生效）；NEEDS_FIX 后的新 Attempt 沿 `selection.ranked` 升级到更强组合；按历史通过率与成本学习排序属 V1 之后（D8，经 DecisionEngine）。独立验证（M3）对所有组合一视同仁，便宜组合做砸了由验证拦截，不因组合而放宽。
5. **延期（DEF-8）**：Axiom 自管的非订阅接入方式（API key / 网关 / 本地 runtime：复用 Orca `src/main/host/electron-secret-store.ts`、按 Attempt 注入环境变量、凭据范围扩大需 Approval）；用户在产品内对新组合运行一致性测试完成本机认证；`opencode` 等不可启动选模型的 harness 经 worktree 级配置按 Attempt 选模型（与 DEF-4 同一物化机制，物化文件必须排除在 Candidate 快照之外）；harness 版本变化后的复验规则。M2 的固定约定"V1 不新增 API key 存储"不变。
6. **与 D53 的关系**：Gemini CLI 停服与 Antigravity 接替的事实、文档示例名改动保留；退休名单机制由本条取代（gemini 不在矩阵即不可用）。M2-06c 改为实现本条的 V1 子集，恢复开发时重写 brief。
**理由**：自治系统只应把真实工作交给验证过能遵守协议的组合；允许清单比退休名单安全（上游每周都在新增 provider，denylist 永远追不上）；三分让"同一身体换大脑""同一大脑换接入方式"都成为显式、可审计的选择，也为 D55 的自有 harness 留好接口。
**后果**：`ProviderFilterReason` 改为 `not_installed | not_certified | disallowed | tier_too_low`（术语表 §4.13 随 M2-06c 更新）；`selection.filtered` 只需列出已安装未登记的 harness 与登记未安装的组合，顺带解决 M2-11 记录的 `not_installed` 膨胀；D56 上游初筛的"provider 适配"范围收窄为矩阵内的 harness。
**取代规则**：矩阵条目的增删以本条下的修订行记录；DEF-8 复审时的 Decision 决定非订阅接入方式与本机认证。
