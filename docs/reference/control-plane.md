# Control Plane 子系统参考

更新：2026-11-03 · 适用：M2 出口基线及本文标注的 M3 增量；M3-04b-3 为本候选实现，宿主验收结果待 verifier 填写。M2-11 attempt 2 测试与证据索引见 [M2-exit-e2e.md](../review-evidence/axiom-m2/M2-exit-e2e.md)，M1 历史证据见 [M1-exit-e2e.md](../review-evidence/axiom-m1/M1-exit-e2e.md)。
规范权威仍是 [Constitution](../PROJECT_CONSTITUTION.md) §1、ACCEPTED Decisions、[Glossary](../GLOSSARY.md) §4 与 [Architecture](../ARCHITECTURE.md)；本文定位实现，不新增权威或状态。

## 1. 用途与边界

Control Plane 决定并持久化 Mission、版本化 Goal/Plan、Task stage 与依赖 readiness；模型只提出建议，renderer 只展示投影。顶层对象与 RPC 使用 Mission / `axiom.*`（D1）。用户代码所在对象称 repository；Orca `Project` 仍是仓库/provider 身份类型。

M2 已提供 Planner 提案、人工审批、Scheduler admission、Worker 通道、Candidate/Submission 结算、Attempt 恢复与 UI 投影；M3-01 接入 VerificationService，Submission 后 Task 推进到 `VERIFYING`，M3-02 在独立 worktree 执行检查并结算 PASS / FAIL / INCONCLUSIVE。`mission start` 创建集成基线并经 Scheduler admission 启动 Worker；M1 出口测试通过禁止全部 provider 保留 Attempt-free 语义。它不是 LLM coordinator、第二个终端/worktree 管理器，也不复活退役的 `coordinator.ts`。

Execution Kernel 继续拥有 Run、Orca Task、dispatch、PTY、进程、worktree、消息投递和收据。Axiom 经 `OrchestrationDb` 与现有 service/RPC 边界复用这些原语。权威 Mission 状态在 `missions.status`；权威 Task stage 在 `task_stages.stage`（D2）；`tasks.status` 只是执行投影。Mission 的 DAG 在 `mission_task_edges`，Orca `tasks.deps=[]`（D10）。

## 2. 模块地图

| 路径                                                                             | 职责                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/axiom/db/`                                                             | `axiom-store.ts` 聚合已启用的 side table 的访问；`missions-store.ts`、`revisions-store.ts`、`task-graph-store.ts`、`policy-audit-store.ts`、`artifacts-store.ts`、`agent-specs-store.ts` 分域 SQL；`axiom-rows.ts` / `row-codec.ts` 校验数据库行                                                          |
| `src/main/axiom/mission-controller/`                                             | `mission-controller.ts` 提供事务入口；`mission-lifecycle.ts`、`goal-lifecycle.ts`、`plan-materialization.ts`、`task-readiness.ts` 实现状态转换；`task-adjustment.ts` 调整 Task spec / 重试预算并解决 BLOCKED 待处理项；`controller-context.ts` 定义错误与审计；`run-mailbox-consumer.ts` 消费 Run mailbox |
| `src/main/axiom/execution/attempt-launcher.ts` / `mission-caller.ts`             | M2-05：预创建 Attempt worktree、合成 caller、D14 service 调用、dispatch 绑定与启动结算                                                                                                                                                                                                                    |
| `src/main/axiom/execution/integration-base.ts`                                   | D51：start 前以目标分支 HEAD 创建集成基线；已存在只沿用，M4 前不移动                                                                                                                                                                                                                                      |
| `src/main/axiom/execution/attempt-projection.ts`                                 | `attempt_bindings` 与 Orca `projectFleetWorker` 投影，供 `axiom.attempt.show/list` 与 CLI 读接口                                                                                                                                                                                                          |
| `src/main/axiom/artifacts/`                                                      | M2-02：`ArtifactStore` 以 sha256 寻址文件，原子写入、读取校验、Mission/kind/related 过滤；根目录由 Control Plane 注入                                                                                                                                                                                     |
| `src/main/axiom/context-builder/`                                                | M2-02 / M3-04b-3：八节强制集、确定性依赖 Artifact 排序、预算裁剪、脱敏、canonical manifest 和 Worker prompt template                                                                                                                                                                                                 |
| `src/main/axiom/agent-factory/`                                                  | M2-03：先过滤，再由 RulesEngine 排序；生成 worker/planner AgentSpec，在同一事务持久化合同与选择审计，不启动进程                                                                                                                                                                                           |
| `src/main/axiom/decision-engine/`                                                | M2-03：闭集 choose/score/classify/rank 接口与确定性 RulesEngine；只能建议，不能修改 eligibility 或权威状态                                                                                                                                                                                                |
| `src/main/axiom/scheduler/`                                                      | `scheduler.ts` 逐轮从数据库排序/校验并事务性 admission；`critical-path.ts` 计算最长下游链；`admission-blockers.ts` 真查 Question/Approval；`admission-budget.ts` 校验 Mission 总 Attempts/wall-clock；typed launch seam 在 M2-05 注入                                                                     |
| `src/main/axiom/admission/`                                                      | `mission-managed-run-guard.ts` 阻止 Orca RPC 修改 Mission 对象；五组测试固定 §4b 拦截                                                                                                                                                                                                                     |
| `src/main/axiom/recovery/`                                                       | `recovery-service.ts` 恢复非终态 Mission、检查绑定、重算 readiness；启动、60 秒周期与退出邮件触发 Attempt reconciliation（规则 a–h 见 §4）；`attempt-reconciliation.ts` / `planner-reconciliation.ts` 对账 Attempt；`agent-exit-observation.ts` 读取 D59 的宿主 shell 前台证明                            |
| `src/main/axiom/control-plane.ts`                                                | 按 `OrchestrationDb` WeakMap 缓存 store/controller/recovery/artifacts/contextBuilder/agentFactory/decisionEngine，维护进程内消费者取消句柄并接入生命周期                                                                                                                                                  |
| `src/main/axiom/control-plane-boot.ts`                                           | `startAxiomControlPlane` / `stopAxiomControlPlane`；启动恢复和退出停止                                                                                                                                                                                                                                    |
| `src/main/axiom/kernel-contract/`                                                | M1-01 的 session party、Run/mailbox、Task 与 dispatch 身份契约测试；D14 的可执行依据                                                                                                                                                                                                                      |
| `src/shared/axiom-contract/`                                                     | zod 对象/params/响应、`lifecycle.ts` 合法转换、`plan-proposal.ts` 与 `plan-task-graph.ts` 校验、`mutations.ts` 分类、`stage-labels.ts` 文案                                                                                                                                                               |
| `src/main/runtime/rpc/methods/axiom/`                                            | Mission/Goal/Plan/Task/Artifact/Policy/Attempt/Message 方法；`../axiom.ts` 聚合到 `ALL_RPC_METHODS`                                                                                                                                                                                                       |
| `src/cli/specs/axiom-*.ts` + `src/cli/handlers/axiom/`                           | `mission`（含 plan/goal/artifact/policy）、`plan`、`task`、`attempt`、`message` CLI；`input-files.ts` 解析 Goal / Plan，`rpc-command.ts` 调用与输出                                                                                                                                                       |
| `src/renderer/src/components/missions/` + `src/renderer/src/lib/axiom-client.ts` | Mission list/Home、Plan 审批、Task 表与 Task Detail（Attempt、Submission、typed timeline）；共享 schema 校验与 mutation envelope；刷新后以服务端状态对账                                                                                                                                                  |

新增逻辑不能进入 `@ts-nocheck` 的 runtime 文件（D12）；D59 明确授权的例外仅为完全标注类型的进程内转发访问器 `confirmTerminalShellForeground`，恢复决策仍在强类型 Control Plane 模块内。扩展 RPC 仍遵循 [orca-mapping](orca-mapping.md) §4c 的五步注册与 catalog 检查。

## 3. 持久数据：19 张 side table

权威数据库为 `<userData>/orchestration.db`。M1-03 的 `src/main/runtime/orchestration/db/schema/create-axiom-tables-sql.ts` / `migrate-v43.ts` 建立原有 17 张表；M3-06 在每次打开的幂等 DDL 增加 `axiom_effects`，M3-06-3-2 增加 `supervision_settings`，共 19 张表；M1 的业务 store 使用下表前七张。已有表不改 CHECK 枚举，未来只做 additive migration。

| 表                    | 内容 / M2 出口使用情况                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `missions`            | 使用：repository、target branch、Run/session 绑定、status、active revisions、`previous_status`                                               |
| `goal_revisions`      | 使用：版本化正文、约束、验收、provenance、ACTIVE/SUPERSEDED                                                                                  |
| `plan_revisions`      | 使用：milestones/risks/proposal JSON（tasks、edges、warnings）、版本、Goal 关联、审批与拒绝理由                                                                        |
| `task_stages`         | 使用：Orca Task id、Plan 关联、权威 stage、`previous_stage`、spec、retry policy、attempt count                                               |
| `mission_task_edges`  | 使用：物化后 Orca Task id 间的有向边及 readiness threshold                                                                                   |
| `mission_policies`    | 使用：默认 concurrency/预算/阈值/审批与验证规则；v44 `routing` 由 policy RPC 更新；`nested_worker_max_depth=1`                               |
| `audit_events`        | 使用：只追加的 sequence、actor、object、event、before/after、时间；mailbox 幂等依据                                                          |
| `supervision_settings` | M3-06-3-2：全局 / Mission 停滞档位的只追加修订；有效值、写入权威与通知投影见 Supervision rules |
| `agent_specs`         | M2-03 已写/读：v44 `spec` 存 canonical 完整合同，id = `spec_` + sha256；标量索引与合同必须一致                                               |
| `context_packages`    | M2-02 已写/读：canonical manifest、预算；`mandatory_refs` = `[manifestArtifactId, renderArtifactId]`，`ranked_refs` = 已纳入候选 Artifact id |
| `attempt_bindings`    | M2-04 admission 写/读：Task 序号、branch、AgentSpec、ContextPackage；`dispatch_id = NULL`，由 M2-05 launch 创建 dispatch 后回填（D6a）       |
| `submissions`         | M2-07 store 已接入：完整严格 report JSON 与检查/限制/后续投影；dispatch_id UNIQUE，不提供更新方法                                            |
| `candidates`          | M2-07 store 已接入：Control Plane 固定 commit/tree；ACTIVE → SUPERSEDED + superseded_by；Task/commit 唯一                                    |
| `artifacts`           | M2-02 已写/读：Mission、kind、sha256、size、media type、related ids、createdBy；内容只存 `<userData>/axiom/artifacts/<sha256>`               |
| `decisions`           | M2-02 `listDecisions({ missionId, status })` 只读；ContextBuilder 包含 ACCEPTED 的 title/resolution；Decision service/RPC 写入者仍待后续     |
| `verification_runs`   | M2-07 入 QUEUED；M3-01 事务领取、独立 worktree 准备与重启重排队；v45 保存 runtime_epoch、claim_count、worktree_id、started_at、finished_at   |
| `integration_batches` | 表已建；M4 串行集成使用                                                                                                                      |
| `approvals`           | 表已建；M4 ApprovalGateway 使用，不复用 decision gate                                                                                        |
| `axiom_effects`       | M3-06 admission / VerificationRun 同事务入队；按 kind / Mission 串行执行 dispatch 或验证唤醒，保存 due_at、失败次数、lease epoch 与结果 |

Milestone 存在 Plan JSON 内，没有独立表/状态机。Attempt 身份仍等于 Orca dispatch id，不存在 Axiom Attempt 表。M2-02 启用 Artifact/ContextPackage 写入和 Decision 读取；M2-03 启用 AgentSpec 写入和 policy routing 更新；M2-04 启用 attempt_bindings 写入与阻塞 Approval/Question 读取；M2-07 接入 Candidate/Submission/VerificationRun store 与结算写入；其余后续表目前只有建表和清理支持，不能把表存在当成产品能力已完成。

`create-tables.ts` 每次打开执行幂等 DDL，当前 `SCHEMA_VERSION=46`（UPSTREAM-3 后编号）；12 个查询索引、4 个删除触发器沿用 additive 模式。M3-06 不加版本或 migrate 文件，以新 Mission 删除触发器清理 effects，兼容已经存在的 Run 删除触发器。Task 删除清理 stage/边/binding，dispatch 删除仅清空 binding 的 dispatch 引用，Run 删除清理所属 Mission side rows。没有声明外键；v44 仅为 agent_specs.spec 与 mission_policies.routing 加列（TEXT NOT NULL DEFAULT '{}'），hasColumn 防止重复 ALTER，版本化探针从 v44 起检查这两列，v43 与更高版本降级路径保持透明。详细列见映射 §6。

所有 store 读取先用 zod 解析，不把 SQLite 行强制断言为领域对象。写入由 `runLifecycleWriteTransaction` 包裹，嵌套 savepoint 使 Run 创建和 Mission 创建能一起回滚；审计与状态同事务提交。

### Task spec：逐条验收合同（M3-04b-2）

Task 的 `acceptanceCriteria` 为 `{text, check}` 数组：`check.kind=command` 带一个精确 shell `command`；`artifact` 可带 `artifactKind`，要求 Submission 引用可读、非空且种类匹配的 Artifact；`human` 只用于命令和 Artifact 都不能证明、必须由人确认的要求。GoalRevision 的用户文本仍为 `string[]`。AgentFactory 将解析后的对象写入内容寻址 AgentSpec；Plan review 显示文本及 command / Artifact / human check 标记。

M3-05-2：新 Task 至少有一个 command 或 artifact criterion；空标准或纯 human 经唯一的 `validateTaskAcceptance` 返回 `acceptance_uncheckable` error，message 同时指出这两种可检查类型。`TaskSpec.coversGoalCriteria?: number[]` 最多 50 个非负整数，是该 Task 帮助满足的 active Goal acceptanceCriteria 零基索引；Goal 有标准时 Planner 应为每个 Task 声明，没有标准时可省略。字段是声明的覆盖关系，不证明验收已满足；旧 Task 不设置它仍能读取。

`acceptance.ts` 的纯函数 `resolveAcceptance` 是兼容解释的唯一入口：已存字符串变为同文本的 human criterion；已存 `requiredEvidence` 中尚无 criterion 携带的非空命令，按原顺序追加为 `{text: 'Command passes: <command>', check: {kind: 'command', command}}`。`acceptanceCommands` 去重并保留 criterion 顺序。`requiredEvidence` 已退役，只作兼容读取；不迁移或重写已存 PlanRevision / Task JSON。验证、上下文、CLI、renderer 和 AgentFactory 都消费解析结果。`axiom task show --json` 暴露解析后的 spec，文本输出列出证明方式。

### ContextPackage（M2-02）

`plane.artifacts` 与 `plane.contextBuilder` 已由 Scheduler、launcher、submit 服务复用。Artifact id = `art_` + sha256(canonical `{missionId,kind,sha256}`)；`createdBy=attempt:<id>` 的 Artifact 另外把 createdBy/related 纳入身份，以保留相同内容在不同 Attempt 的出处。相同身份重复 put 返回既有元数据，跨 kind/Mission/Attempt 共用内容文件。先写 `.tmp-<random>` 再 rename；read 重新检查 hash/size，缺文件或不匹配返回 `artifact_corrupt`。put 上限 8 MiB；RPC 用 `contentBase64`，CLI `mission artifact put --attempt <id> --mission … --kind … --file …` 在本机读文件；Worker 上传必须绑定 Attempt，出处与关联由宿主填写（D78，见调用方权限节）。read 的 `--json` 保留 base64，文本输出按 UTF-8；list 支持 kind 和单一 related id。

ContextBuilder 固定强制顺序：(1) Task spec；(2) PlanRevision revision/milestone/带邻居标题的入出边；(3) ACCEPTED Decisions；(4) 权限、Mission/Task 预算、并发、重试与 `axiom-submission-v1` 字段清单；(5) 目标分支的 AGENTS.md/CLAUDE.md，各最多 16 KiB（缺文件省略，读失败不静默忽略）；(6) policy 验证命令；(7) Previous-Attempt failure evidence（M3-04，见下）；(8) Answered questions（M3-04b-3，source=`questions:<taskId>`，无答案时固定为 `none`）。只读这两个规则文件，不读工作区版本或 `.env*`。

M3-04：Worker context 在 admission 插入 binding 之前，以 `store.nextAttemptSeq(taskId)` 调用与 launcher 共用的 `resolveAttemptBaseline`。第 7 节由 `context-builder/previous-attempt.ts` 准备 `{source, content}`，仍逐节经过 `redactContext`；协议仍绑定第 4 节的 hash/token 数。首个 Attempt 的本节正文 `none (first attempt)`、source `previous-attempt:m2` 均不变；M3-04b 新增 Worker 协议会改变完整 render 与 package 的内容 hash。后续 integration baseline 用一行说明从集成基线重来及原因（自然语言与固定 reason code），source 为 `previous-attempt:<reason>`；`previous_attempt_not_submitted` 若带非空 `skippedAttempts`，也追加下述声明与人工调整行；`secret_detected` 另列失败 run 的密钥路径、模式名，并明确不得重新引入秘密，不携带匹配文本或该候选的历史。

candidate baseline 的第 7 节按以下顺序渲染，source 为 `verification:<runId>`：

1. `This Attempt continues the previous Candidate <commitSha> from Attempt <previousSeq>; fix the failures below in this tree. Do not weaken, skip or delete tests, assertions, lint rules or checks to make them pass.`
2. D85 / M3-04b：接续行之后按 seq 升序列出 `skippedAttempts`。`unchanged` 保留 `Attempt <seq> exited without changing this Candidate; its report said: <summary>`；`no_change` 为 `Attempt <seq> declared no_change (<reason>); its report said: <summary>`；`blocked` 为 `Attempt <seq> declared blocked_by_scope naming <paths>; its report said: <summary>`。随后按审计顺序列出本 Task 的 `task.adjusted`：`A human adjusted this Task after Attempt <afterAttemptSeq>: ...`，仅列新增 allowedPaths、发生变化的 maxAttempts（前值 → 后值）、`acceptance criteria replaced (<n> → <m>)`（有全量替换时）及 rationale。candidate baseline 只纳入 `afterAttemptSeq >= previousSeq`；带 skipped Attempts 的 integration baseline 只纳入 `afterAttemptSeq >= 1`。摘要、路径与 rationale 均先脱敏、最多取 500 字符，再作 JSON 单行引用并转义反引号与角括号；无摘要用 `(no summary)`，路径列表另受显示预算限制。声明、调整行与失败摘录共用 8 KiB UTF-8 预算；`previous-attempt-text.ts` 在预算不足时优先保留最新声明和人工调整，再按原顺序显示所保留的行，明确提示省略的早期证据；最后保留 `If the failures below cannot be fixed inside allowedPaths, say so in limitations and name the paths or commands at fault; do not submit an unchanged tree.`，随后列失败 run 的 verdict 与 reason。
3. 最新 run 的 `verdictDetail.acceptance[]` 按 criterion 顺序逐行列出：`[pass] <text>`、`[fail] <text> — <command> (<n> failures)`、`[human] <text> — a person confirms this; do not try to prove it with code changes`、`[inconclusive] <text>` 或 `[skipped] <text>`。text / command 先脱敏再作 JSON 单行引用；legacy run 无 acceptance 时不猜测各 criterion 的结果，不再把全部要求列作未证明。M3-05：若 `resolution.verdict=FAIL`，所选 `resolution.criteria` 索引替换为 `[fail] <quote(text)> — a human judged this failed: <quote(rationale)>`；不再显示对应的 human 提醒行。
4. `result: fail` 的 checks，按 index 升序：command、exitCode、最多 20 个失败名、verdict evidence Artifact（`verdictDetail.verdictArtifactId`）中对应 index 的 excerpt。对最新 FAIL run 中每个失败名，沿同 Task 的历史 run 顺序向前检查连续出现区间；若从更早 run 起每次都有，追加 `(persisting since Attempt <seq>)`，seq 来自那个 run 的 Attempt binding。已从最新 run 消失的 finding 不再列出。每项摘录最多 40 行，所有模型文本经 `quote`；声明、状态、失败名、摘录及其余证据共享 8 KiB UTF-8 上限，按完整引用行裁剪，关闭 excerpt 边界并提示省略。Artifact 缺失、读取/解析失败或找不到该项时写 `excerpt unavailable`，不阻止重试。
5. `verdictDetail.diff` 中的 scope violations、secret findings（仅路径与模式名）、dangerous changes（路径与模式）。越界路径带明确的 remove/revert 指令：scope 对 merge-base 比较，留在树里会再次失败。
6. 上一 Submission 的 transcript Artifact id（存在时）；`axiom mission artifact read --artifact <id>` 配方只给 terminal fallback，headless 不给 CLI 指令。与 `attempt show` 共用导出的 `findSubmissionTranscriptArtifactId`，不内联 transcript。

M3-05：最新 run 的 `resolution.verdict=FAIL` 时，criterion 前增加 `A human resolved verification run <id> as FAIL: <quote(rationale)>`；PASS resolution 不增加失败行。待审旧 run 的 `verdictDetail.rerun`，或绑定新 run / Task / Candidate 的 `verification.rerun_requested` 审计，提供 `Verification was re-run on the same candidate after the criteria changed: <quote(rationale)>`。所有人工文本经 `quote` 脱敏并引用；预算先预留节标题、这些人工处置与逐条 criterion，再放入声明 / 调整历史，完整节仍受 8 KiB 限制。Task 的 run 按 created_at / 插入顺序排序，同一秒的新 rerun 不会因随机 UUID 排在旧 run 前。

只读已存 run、verdict Artifact、Task spec 与 transcript 元数据，不重跑检查、不读取 Worker 当前输出。相同输入得到相同 package id；run id 变化会改变 source 与 package id。

预算按 `ceil(UTF-8 bytes / 4)` 估计，调用参数优先，其次已解析 policy.budget 的可选正整数 `contextTokens`，否则 24,000。M2-03 已加入共享 BudgetSchema，可在 mission create RPC 的 policy 中设置；后续预算修改仍需 M4 Approval。协议块计入第 4 节的 hash/token 数。强制集永不裁剪，超限设 `budgetExceededByMandatory: true`；候选按既有入边查询顺序（from_task_id）、再 created_at/id，去重后取直接上游的 handoff/worker_report，第一项放不下即停止，余项记 budget。

规则与候选在纳入前脱敏：PRIVATE KEY 块、指定 provider token 前缀（兼容 hyphen/underscore）和 AKIA key 替换为 `[REDACTED]`；规则先脱敏再截断。候选的敏感部分在 omitted 中以 redacted 记录，安全替换文本仍可纳入；section header 标记 redacted。manifest ranked hash 绑定脱敏后的正文；强制 hash 绑定渲染节（第 4 节另含协议）。

canonical manifest 无空白、对象键序固定，保留数组顺序，id = `ctx_` + sha256(canonical)。manifest 与完整 render template 均作为 Artifact 持久化，context row 只保留 JSON manifest/hash/引用。相同输入重复 build 不新增行或文件。模板最后的 `Axiom Worker protocol` 按执行通道生成：headless 使用文件 Artifact 和最终 JSON report（见 M3-08 节），terminal fallback 保留 D16 八个 `axiom attempt` verb；两种模板的协议都参与 ContextPackage 内容寻址，launcher 在交付时替换 `{{attemptId}}`；D73 之后模板不含任何凭据（身份由宿主核实）。

M3-04b 的两种协议都要求结束前运行本 worktree 可执行的 `Required verification commands`，按 acceptanceCriteria 和现有 AGENTS.md / CLAUDE.md / REVIEW.md 重读完整 diff；未运行的检查逐项写 `checksRun {result: skipped, note}`，该报告不决定 verdict。只使用本 worktree 的工具链，不 symlink、复制或借用其它目录的 node_modules / .bin / caches；缺依赖写入 limitations。headless 以 `outcome` 声明 submitted / no_change / blocked（见 §4）；无可修时不改树，范围不足时停止且不得越界。terminal fallback 在停止前用 `axiom attempt blocked --reason … --path …` 报告相同结论。

M3-04b-3：第 8 节从本 Task 的 typed QUESTION 消息及其 `question.answered` 审计读取答案，按审计 sequence 倒序取最新 10 条；内核 ask 的答案不进入本节。每行 `Q (Attempt <asking seq>): <quote(question)> — A: <quote(answer)>`，seq 从提问时的 binding 取，Worker 与人的文本均经 `previous-attempt-text.quote` 脱敏、单行 JSON 引用、转义反引号与角括号（每段最多 500 字符 / 1,600 bytes）。整节连标题、换行、预算省略提示不超过 4 KiB，按完整引用行裁剪。两种 Worker 通道始终包含本节，后续每次 build 重读审计，不复制答案到新存储；新增强制节与报告 schema 的 caps 改变 `context-builder.test.ts` 的 terminal / headless 两个 packageId pin。DEF-4/5 的 skills 与代码知识输入仍按登记触发点复审。

M3-06-3-3b：仅 headless 且 Task 或 Mission 有 maxTokens 时，在 `Permissions, budget and submission contract` 后插入必带 `Token budget` 节。每个设限的 owner 给出 cap、build 时账本已用和 max(0, cap−used) 剩余。Task 说明单位为新 token（未命中缓存的输入、cache writes、output）、跨全部 Attempts 累计，达 cap 时宿主停止、保全并阻塞直到人提高 cap；Mission 说明达 cap 不再启动新 Attempt。Codex 原地续的 stdin continuationPrompt 复用同样文字，caller 传当前 caps/totals。无 cap 时两个提示保持原样，TUI 无此节。sameContract 如同 Previous-Attempt failure evidence 一样跳过 Token budget 的 hash，使单独用量变化不结束原地续；cap 仍在被比较的 Permissions JSON 中，调整 cap 仍使合同改变。

### Provider selection（M2-03）

AgentFactory.build 接受 worker 的 missionId/taskId/contextPackageId，或 planner 的 missionId/goalRevisionId；引用必须存在且归属匹配。ContextPackage 是输入，不由 Factory 创建。主机安装集合由注入的 listInstalledProviders 提供，Control Plane 注入 detectInstalledAgentsWithShellPathHydration；此处不新增认证探测或网络调用。

执行身份由 provider（harness）、model 与 endpointProfile 组成。D57 的矩阵在 `src/main/axiom/agent-factory/certified-providers.ts` 的 `CERTIFIED_PROVIDER_COMBOS`；`endpointProfile` 均为 `subscription`，不存储凭据。D82 的 V1 真实 provider 为 Codex 与 Claude Code，均支持 planner、worker；保留的 Antigravity/OpenCode 条目不扩大 V1 范围。当前只有 Codex 为 `certified`（宿主证据见 `.axiom-work/verifications/M3-08-smoke-real-codex.md`），Claude 保持 `provisional`，由 verifier 的真实宿主 smoke 决定认证。确定性 fake 测试不认证真实组合。Claude Worker 的 `maxRisk: high` 以 OS sandbox 启用且 `failIfUnavailable: true` 为前提（D57 ④）；无 OS sandbox 的组合不得据此取得 high 风险资格。

| Provider    | 模型选择方式    | Tier | 角色            | 最高风险 |
| ----------- | --------------- | ---- | --------------- | -------- |
| claude      | launch-arg      | A    | planner、worker | high     |
| codex       | launch-arg      | A    | planner、worker | high     |
| antigravity | launch-arg      | B    | worker          | medium   |
| opencode    | harness-default | B    | worker          | low      |

先按 TUI_AGENT_CONFIG 的顺序规范安装集合，排除 claude-agent-teams（Claude launch mode）。只检查矩阵内或已安装的 harness，按首个命中原因过滤：`not_installed` → `no_account`（macOS/Linux 的 Codex 或 Claude 未选择受管账号；D83）→ `not_certified`（不在矩阵，或 `routing.requireCertified=true` 且 status 不是 certified）→ `disallowed` → `tier_too_low`（角色不在组合 roles、风险超过 maxRisk，或 highRiskTier=A 时高风险选择非 A）→ `account_cooldown`（仅 Worker，当前选中账号仍在等待 usage-limit continuation）。Planner 的筛选风险固定为 high。filtered 按原因顺序排列，同原因保持配置顺序。无候选返回 no_eligible_provider，附 installed/filtered；配置的角色 provider 被过滤时还附 roleProviderUnavailable。Factory 不写 spec 或 audit；no_account 的 provider-specific 提示指向 Settings › Accounts。Scheduler 沿用 `task.admission_refused`，Task 保持 READY，skip reason 仍为 `no_eligible_provider`。因 `account_cooldown` 过滤且无候选时，错误 data / 拒绝 audit 另附 `accountCooldown: [{provider,until}]`（只列实际以该原因过滤的 provider）。存在其它候选时按原规则排名并转给它；`selection.filtered` 仍为严格 `{provider,reason}`，配置的角色 provider 被冷却时 `roleProviderUnavailable=account_cooldown`。Windows / WSL 保留既有路径。

M3-06-2a-2 / D88：`agent-factory/account-cooldown.ts` 从所有 Mission 的 pending `attempt.continue` 派生只读 view：仅 `failureClass=usage_limit`、未来 dueAt、Task 仍 READY 且无比 payload.seq 更新的 Attempt，并且 payload.account 匹配当前启动账号时生效；多个等待取最晚 dueAt。无 account、其它账号 / failure class、已到期、running / done / failed / retired、已取消或已有新 Attempt 都不计。只为有候选 effect 的 provider 调用现有启动 home resolver，每个 view 最多一次；Claude await `resolveClaudeHomeForWorkerLaunch()`，Codex 调用 `resolveCodexHomeForWorkerLaunch()`。无 home 或解析抛错时不冷却，宁可多启动一次，也不冻结错误的账号。view 的 clock 注入，无状态、无写入、无 timer；control-plane 只接线。一次 `buildWorkerContracts` 的两次 selection 共用同一 view，异步读取在 `agent_spec` 事务外完成；途中 cooldown 开始 / 到期不会造成 provider changed。Planner 不读 view、不受此过滤。过滤在 RulesEngine 排名之前完成，engine 无权重新纳入冷却 provider。

RulesEngine 只对 eligible 闭集排序：`routing.roles[role].provider` 最高，其次 Worker 的跨 provider 偏好，再次 preferredProviders（100 − index），然后 A 在 B 前，同分保持配置顺序。角色配置不能绕过过滤；不可用原因写入 selection 与 `agent_spec.created.roleProviderUnavailable`。`routing.crossProvider` 默认 true：Worker 以 active APPROVED PlanRevision 的 `provenance.actor` 为 planner provider，否则回退最新 Planner AgentSpec（同秒按 audit sequence），否则为空；有至少两个候选时优先不同 provider，只有一个时允许相同 provider。显式角色 provider 优先。selection.rationale 说明应用或回退原因，`agent_spec.created.crossProvider` 与执行组合保存 `{plannerProvider, applied}`。Factory 仍检查 DecisionEngine 返回的是 eligible 的完整排列。

`routing.roles` 默认 `{}`，含可选 planner/worker `RoleRouting = {provider?, model?, effort?}`；`routing.requireCertified` 默认 false，保留 provisional 的开发流程。model 按 `roles[role].model ?? routing.models[provider] ?? 'policy-default'` 解析；不硬编码模型默认值，policy-default 使用订阅 harness 的默认模型。effort 支持 low/medium/high/xhigh，按角色显式值优先，否则 Planner=high、high 风险 Worker=high、其余 Worker=medium。OpenCode 仍使用 harness 默认模型。selection 的新增字段可选，历史 AgentSpec 可继续读取；routing 新字段有默认值，没有 RPC 参数形状变更。

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
      headless no_change / blocked → NEEDS_FIX → BLOCKED（交人调整，不自动重试）
```

合法转换表包含未来阶段；M2 推进 RUNNING / SUBMITTED，M3 增加独立验证与人工处置，集成和 Mission 完成仍归后续里程碑。Orca `completed` 仅指当前 Attempt 已结算，不能显示为 Task 完成；UI 只有 INTEGRATED 计入进度。

暂停/阻塞前的 Mission 状态保存在 `missions.previous_status`；resume 只用于 PAUSED，内部 unblock 用于 BLOCKED，恢复目标必须等于该字段。嵌套 PAUSED/BLOCKED 经持久 `mission.status` 审计回放恢复更早返回点。Task 进入 BLOCKED 保存 `task_stages.previous_stage`，通常解除时返回该 stage（或取消）；M3-05 的明确例外是满足同候选重验条件时，以 actor=user / reason=rerun_requested 转 VERIFYING。条件更新不命中时抛 `stale_state`。

M3-04b / D70 ② 的 Task 阻塞处置复用该返回点，不增加 stage：

| BLOCKED reason           | 来源                                                           | 人工解除                                                                                                     |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `scope`                  | headless 声明 `blocked_by_scope`                               | 桌面 `axiom.task.adjust` 扩大 allowedPaths，`BLOCKED → NEEDS_FIX → READY`（均为 reason=adjusted），或 cancel |
| `candidate_disputed`     | headless 声明 `candidate_already_correct` / `cannot_reproduce` | 人复核后以 rationale-only adjust 重开上述路径，或 cancel；不改写确定性 FAIL；也可只替换 criteria 后，经 M3-05 的 rerun 重验同 Candidate     |
| `token_budget_exhausted` | Task 全部 Attempts 的新 token 已达 cap；监工停止或 READY 准入检查 | 桌面 task.adjust 的 maxTokens 必须高于已用量，按 previousStage 返回；次数也耗尽时同次提高 maxAttempts，否则全笔回滚 |
| `retry_budget_exhausted` | 原失败 / 验证修复循环耗尽 Task 预算                            | adjust 提高 maxAttempts 后经 previousStage 回 READY，或 cancel / replan                                      |

上述 NEEDS_FIX → READY 都要求调整后 `attemptCount < maxAttempts`；否则整笔调整回滚并返回 `retry_budget_exhausted`。声明 Attempt 仍占 seq、计入已消耗次数，扩大 scope 本身不退还预算。具体参数、审计与权限见 §6「人工 Task 调整」。

M2 仍仅允许首个 Plan 批准；替代计划批准属于 M5。`plan-materialization.ts` 校验共享 schema、唯一 id、合法 milestone、端点、重复边、自环与 DAG 后，将提案 `T01` 等 id 映射为新 Orca Task id；Task 创建 `deps=[]`，Orca 投影即 `ready`，Axiom stage 为 DEFINED。批准后 Mission 为 PLANNED，此时不会 READY；必须 `mission start`。

`task-readiness.ts` 对 DEFINED 重算 READY，要求：

1. Mission 为 EXECUTING，Task 所属 Plan 为同 Mission 的 APPROVED revision。
2. 每条上游边来自同 Mission/Plan，且上游必须为 INTEGRATED。V1 不支持 VERIFIED 阈值（D69，2026-10-25 修订）：提案校验返回 error `threshold_not_supported`，创建 Mission / 更新 policy 默认阈值时拒绝 VERIFIED；存量 VERIFIED 边按 INTEGRATED 判定，不迁移、不改枚举。
3. Task `attemptCount < retryPolicy.maxAttempts`，Mission policy 存在；配置了 `budget.maxAttempts` 时，Mission 总 attempt count 尚未耗尽。
4. 无阻塞 Question/Approval。M2-04 的 `blockingQuestionOrApproval(ctx, task)` 依次查询 Task 的 pending `decision_gates`、经 `attempt_bindings.dispatch_id` 关联的 pending `question_threads`、本 Task 尚无 `question.answered` 审计的 typed QUESTION 消息，以及同 Mission 的 PENDING `approvals`。前三者返回 question；Approval 只匹配 `BLOCKING_APPROVAL_ACTION_KINDS = [budget_increase]`，返回 approval（M4 扩展）。resolved/timeout gate、answered/closed thread 与非阻塞 action kind 不拦截。DEFINED readiness 和 READY admission 共用此检查。typed QUESTION 不随 Attempt 结算关闭，READY Task 的 Scheduler skip reason 为 `question`；答复后重新触发 admission，即使 readiness 没有 stage 变化。VERIFIED / INTEGRATED 不参与 admission，不因待答问题降级。

冻结 fixture 的 readiness 是 12 Tasks / 20 edges / 3 READY（T01–T03）/ 9 DEFINED；M2-05 的 admission 随后将三个根 Task 推至 RUNNING。无 eligible provider 的 M1 场景保持 READY。`parallelReady` 提示不是 readiness 权威。

### Scheduler admission 与预算（M2-04）

`Scheduler.scheduleRound(missionId, trigger)` 只处理 EXECUTING Mission，先重算 readiness，再按最长下游链长度降序、Task id 升序遍历 READY Tasks。每轮从数据库读取状态；同实例/同 Mission 的重叠调用只保留一个待执行 trigger，当前轮结束后再跑一轮，无 polling/timer。进程重启只需重新实例化 Scheduler；序号、计数、provider 占用均从数据库恢复。

ContextBuilder/AgentFactory 的异步构建在 admission 事务之前完成。事务内重新校验 Mission/Task、APPROVED Plan 与依赖、Question/Approval、预算/并发、构建前后的 Task/policy 一致性，以及 package/spec 存在且归属匹配；分配 `seq = max(seq) + 1`，写 `attempt_bindings(dispatch_id = NULL, branch = axiom/attempt/<taskId>/<seq>)`，CAS `READY → RUNNING` 并 `attempt_count += 1`，追加 `task.stage` / `attempt.admitted`。RUNNING 转换必须带 `actor: Scheduler` 与 `attemptCountDelta: 1`，否则 `illegal_transition(reason: admission_required)`。

M3-06：admission 同事务写 `attempt.dispatch` effect；Scheduler 不再持有或调用 launcher。提交后由 outbox 执行器调用原有 `createAttemptLauncher`，后者仍持久化 dispatch 绑定并按内核 receipt 结算。防御性 rejection audit 和 settlement 移到执行器的 `onExhausted`，actor 仍为 Scheduler；没有 `launcher_unavailable` skip。

| 配置                                 | 含义                                                                                                        | M2 enforcement                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `policy.budget.maxAttempts`          | Mission 总 Attempt 数 = 全部 Task `attempt_count` 之和 + Planner bindings 数量                              | readiness 与 admission 重查；有 READY 候选且耗尽时 Mission BLOCKED                                                                                                                                                                               |
| `policy.budget.maxRuntimeMinutes`    | 默认每次 Attempt 运行时长上限，**不是** Mission 总时长                                                      | AgentFactory 采用 Task → Mission → 45 分钟；M2-08 RecoveryService 按 `attempt_bindings.created_at` + Task spec / Mission policy 的 runtime cap enforce（两者均无 cap 时不限，不采用 Factory 的 45 分钟默认值）；不映射到 `workerStart.timeoutMs` |
| `policy.budget.maxWallClockMinutes`  | 可选正数；Mission 自第一次 `mission.status.after.status = EXECUTING` 审计起的总 wall-clock，含暂停/阻塞时间 | admission 按注入时钟重查；有 READY 候选且耗尽时 Mission BLOCKED                                                                                                                                                                                  |
| `policy.concurrencyLimit`            | Mission 的 RUNNING Task 总数                                                                                | admission 事务内重查；满额只跳过，不 BLOCKED                                                                                                                                                                                                     |
| `policy.routing.providerConcurrency` | provider → 正整数上限，默认 `{}` 表示未设 provider cap                                                      | RUNNING Tasks 的最新 seq binding JOIN AgentSpec.provider；事务内重查，满额只跳过                                                                                                                                                                 |
| `task.retryPolicy.maxAttempts`       | 单 Task Attempt 次数上限，权威计数为 `task_stages.attempt_count`                                            | readiness 与 admission 重查，admission 返回 task_attempts                                                                                                                                                                                        |
| 单 Task 总时长、成本总预算     | 需要 Attempt 结算数据                                                                                       | M2 不 enforce；后续结算/预算服务接入                                                                                                                                                                                                             |

M3-06-3-3b：`policy.budget.maxTokens` 在 maxAttempts、maxWallClockMinutes 之后检查，used 为 Mission 的全部账本 new_tokens（包括非 final 行）；达到上限时 round.blocked=`maxTokens`。运行中的 Attempts 不受 Mission cap 停止。Planner preflight 也在 Mission tokens 达 cap 时返回 `budget_exhausted`、data=`{reason:budget_exhausted}`（与 maxAttempts 一样），但不计量 Planner 本身。

Task cap 检查在 Mission 预算之后、Task 次数检查之前，分别在 `scheduler_precheck` 与 `scheduler_admission` 内重查。READY Task 的 `spec.budget.maxTokens` 已达 cap 时，同事务以 Scheduler 写 `READY → BLOCKED(token_budget_exhausted)` 和 Task 对象的 `budget.exhausted {dimension:maxTokens,limit,used}`，跳过原因 `task_tokens`；继续遍历其它 Tasks，不阻塞 Mission。cap=0 也阻止首次准入。

Mission 总 Attempts/wall-clock/new-token 耗尽通过既有 `blockMission(missionId, budget_exhausted)` 保留 `previous_status = EXECUTING`，同事务追加 `budget.exhausted {dimension, limit, used}`；Approval 请求对象留给 M4。并发满额、无可选 provider 与 Question/Approval 不视为预算耗尽。

每轮返回 admitted（有序身份）与 skipped（taskId/reason）；skip reason 为 concurrency、provider_concurrency、task_attempts、task_tokens、question、approval、backoff、no_eligible_provider 或 stale。只有本轮 admitted 非空或 Mission 被预算阻塞才写一条 `scheduler.round {trigger, admitted, skipped}`；空轮和全部跳过的轮不写此事件。构建合同可留下可复用的内容寻址行，这不等于 admission。M2-12 / D59 在 boot recover 与消费者同步后，对每个 EXECUTING 且未因 Run 绑定丢失而 blocked 的 Mission 显式请求一轮 resume，覆盖已持久化 READY、readiness 没有变化的情形；没有 READY 时仍不写 scheduler.round。M3-06 的 pending dispatch effect 在重启后继续启动同一 seq；无 effect 的旧 binding 和已退役 effect 仍由 M2-08 orphan 规则结算。

M2 之后：M3 的验证结算接入既有调度触发；M4 接预算 Approval，token/成本总预算仍未 enforce。

### Task 等待与 Mission 待处理项（M3-09-1）

`read-models/waiting-context.ts` 为每次读取收集 Mission、policy、Task stages、带 PlanRevision 身份的 edges、plans、bindings、ACTIVE Candidates、最新 VerificationRuns、并发计数及 Mission budget。`task-waiting-on.ts` 按 Glossary §4.4a 的规范 first-match 表返回每个 Task 唯一的 `waitingOn`；Task list/show handler 使用它，adjust/cancel/create 的响应不变。clock 由读 handler 传入，一次读取使用同一个时间；直接调用投影可注入固定时钟。

这是纯读：没有新表、index、audit event、cursor、seen state 或等待原因的持久字段。它不申请准入、不计量 tokens、不安排后续 round、不改变 Task / Mission / run。Task tokens 是账本总和的普通比较；Mission 仅 EXECUTING 时调用 scheduler 的 `budgetExhaustion`，ANALYZING 只检查 Planner preflight 已支持的 attempts / tokens。active Planner 判定抽到 `execution/active-planner-attempt.ts`，preflight 和 pending 共用。没有新增 timer、模型或 DecisionEngine 调用。

`question / approval / task_tokens / task_attempts / backoff / concurrency / no_eligible_provider` 使用 Scheduler 的词；展示把 dependency、question、approval 放在预算与退避之前，Scheduler 先检查预算/退避，多个条件同时成立时不同是预期行为。BLOCKED 使用最近一次入 BLOCKED 的 `task.stage.after.reason`。no_eligible_provider 使用比最新 task.stage 序号更大的最后拒绝审计，直到下一轮前可能过期；有 accountCooldown 时 until 是最早结束时间，读操作不重新判断 provider。provider_concurrency 没有独立持久投影，显示 next_round。

`axiom.mission.pending` 是 read-class、strict `{missionId}`，无 CLI。它组合 Mission 启动/恢复/重新规划、PROPOSED plans、未答问题、人工验证、Task 阻塞、子任务请求、follow-up、current stall 通知及全局 open supervision proposal。kind / reason / action 集与状态限制的唯一完整定义在 Glossary §4.4a。仅使用对象原有文本；supervision proposal 当前没有文本字段，因此不合成 summary。BLOCKED Mission 只有 Mission cancel；stall notice 只有 Task cancel。actions 只镜像明确的 Mission status、Task stage 与最新 run 条件，命令仍执行自身的完整权限、参数和竞态校验。

blocking item 的 blocks 为非终态自身与同 plan 的去重传递下游数量；Mission / plan review / Planner question 为全部非终态 Tasks；non-blocking 为 0。排序：blocking 优先 → blocks 降序 → kind 规范次序 → since 升序 → id 升序。终态 Mission 返回空列表；终态 Task 的 question 不列。person=true 的 Task 应有一个 blocking question、Mission/plan review 或自身 human_review/task_blocked 覆盖；Approval 留 M4。已知例外是裸 kernel decision gate：`createGate` 不创建 message，pending 不编造条目。

since 从相关持久 row/audit 转为 UTC ISO 8601：Mission 最新匹配状态审计（预算 BLOCKED 用 budget.exhausted）；ANALYZING 在 Planner 结束后重新可启动时，取状态审计之后的最新 planner.launch_failed / attempt_failed / stopped / abandoned。plan 用 plan.proposed，消息用 createdAt，review 用最新 run.updatedAt，Task block 用 task.stage（provider 拒绝用 admission_refused；upstream_canceled 用规范化后最早的相关取消时间），stall 用 notifiedAt，supervision proposal 用 createdAt。缺失的旧审计以对象的 row 时间回退，plan 以 provenance.at 回退；不会用读取时间伪装事件时间。

尚未持久阻塞的预算项：wall-clock 从首次 EXECUTING 起点与 limit 算出阈值时刻；attempts 取最近 binding 的创建时间（缺失则回退相关状态时间）；tokens 取当前正数账本行的最近 measuredAt。Mission 项不会早于当前状态或 Planner 结束的相关证据。证据限制：当前 token 账本覆盖测量值，没有首次越界历史；旧 binding 缺失、被退还计数的中断 Attempt、Task cap 调整也可能无法重建精确越界时刻。这些 since 表示现存证据时间，不能保证首次耗尽时间；保留纯读且不新增历史，已用 ponytail 注明。plan_review 在 PAUSED / BLOCKED 时保留项但不列 approve / reject，因为两个命令都要求 PLAN_REVIEW；这是对 brief 无条件 action 表的显式收窄。

Mission 事实只在每次 context 中计算；Task 审计使用显式列的 ORDER BY sequence DESC LIMIT 1 读取并缓存 stage，避免逐 Task 扫 Mission 历史。Mission wall-clock budget 保留已有的一次历史读取。DAG 在内存中按 PlanRevision 关联；每个不同 blocking Task 一次去重遍历，有意的小图 O(T×(T+E)) 上限已用 ponytail 注明。每次调用重新计算，没有跨调用缓存。

### Effect outbox (M3-06)

D87 / DEF-48 ① 的 v0 迁移两个副作用；M3-06-2a 增加 attempt.continue，`plane.effects` 持有 `EffectOutbox`。`axiom_effects` 是第 18 张 side table，列为 `id`、`mission_id`、`kind`、`effect_key`、严格 kind-specific JSON `payload`、`status`、`due_at`、`attempts`、`lease_epoch`、`last_error`、`created_at`、`updated_at`；`UNIQUE(kind,effect_key)` 防止同一请求重复入队，`(status,due_at)` 索引用于领取。due_at 始终由 `Date.toISOString()` 写入并按文本比较。新增表、索引和 Mission 删除触发器都是 `IF NOT EXISTS`，旧 v46 数据库每次打开时获得它们；不 bump `SCHEMA_VERSION`，不改原 Run 删除触发器，Run 删除仍清理其 Mission 的 effects。

| kind | key / payload | 执行器 |
|---|---|---|
| `attempt.dispatch` | `<taskId>/<seq>` / `{taskId,seq,branch,agentSpecId,contextPackageId}` | 先跳过已被更新 seq 取代的 effect，再调用既有 launcher；一个 Attempt 恰有一个 dispatch，已绑定或不再 RUNNING 时沿用其 no-op 守卫；`maxAttempts=1` |
| `verification.enqueue` | VerificationRun id / `{runId}` | `void verification.kick().catch(warn)`，不等待验证 drain；`maxAttempts=3`，失败退避 1 s、5 s |
| `attempt.continue` | 被中断的 `<taskId>/<seq>` / `{taskId,seq,chain,failureClass,resetsAt?}` | 到期只请求该 Mission 的 Scheduler round，重读 EXECUTING、READY、无更新 seq；`maxAttempts=3`，抛错退避 1 s、5 s，onOrphan=retry |

`enqueue` 只能在调用方事务内执行，否则抛错。Scheduler 在 `scheduler_admission` 与 binding、RUNNING、attempt.admitted 一起写；Submission 在 `axiom_submit` 与 QUEUED run 一起写；rerun 在 `verification_rerun` 与新 run、审计、收据一起写。微任务仅唤醒；回滚没有 effect 行，执行器不会执行。相同 key 的 pending / failed / retired / done 条目被重新置为 pending、payload 替换、attempts 归零、dueAt 更新；running 条目不改。

状态为 `pending | running | done | failed | retired`。领取按 `due_at,rowid`，以状态 CAS 变为 running 并记录进程 epoch 与 lease 时间（updated_at）。每个 `(kind,missionId)` 最多一个 running，不同 lane 独立；执行在事务外、提交后。返回 `done` 标记完成；返回 `{later: ISO}` 变 pending、保留失败次数；抛错才增加 attempts，未耗尽按 backoff 延后，耗尽标 failed，追加 `effect.failed {kind,key,attempts,lastError}`（actor `EffectOutbox`、objectKind `effect`、objectId effect id），再调用 onExhausted。lastError 经 `redactContext` 脱敏且最多 2,000 字符。dispatch 的 onExhausted 保留原 `attempt.launch_failed {reason:'launch_rejected'}`（actor Scheduler、objectId taskId/seq）与原 settlement。launcher 自己吞下的失败仍由原逻辑结算，effect 为 done；done 仅表示执行器返回，不是 Worker 成功或 Task 完成。

启动顺序在第一次 reconcile 与 resume rounds 之前运行 `effects.recoverAtBoot()`、`effects.start()`。旧 epoch 的 running 逐项交给 onOrphan：`retry` 变 pending、due now、失败次数不变；`done` 完成；`{retire:reason}` 变 retired 并追加 `effect.retired {kind,key,reason}`（actor EffectOutbox、objectKind effect）。dispatch 已绑定 → done；未绑定而内核存在该 Task 的 dispatch 且没有任何 binding 引用它 → retired(`dispatch_outcome_unknown`)，保留原绑定交 orphan 规则，绝不二次启动；没有这种内核启动证据 → retry。verification 唤醒可安全 retry。v0 只有一个 Control Plane 进程持有数据库，无按时间过期的租约。

恢复按 effect 隔离：某条缺少执行器、onOrphan 抛错 / 拒绝或存储写入失败时，保留该行原有的 running、旧 lease epoch 和全部字段，继续恢复后续条目；遍历结束后才以第一个错误拒绝。未恢复的租约只关闭自己的 `(kind,missionId)` lane，其它 lane 仍可执行。启动捕获失败，只警告 `[axiom] Effect recovery incomplete; continuing Control Plane startup`（不输出错误文本），继续启动 outbox、对账定时器、消费者与 resume rounds。既有 60 s reconcile tick 每次先重试旧 epoch 的恢复，再 kick effects 并启动 Attempt 对账（不等待 effect drain），防止刚可重试的旧租约先被 orphan 规则消耗；失败只警告，不停止本轮或后续对账。恢复成功后按同一 retry / done / retired 规则处理；持续失败的条目在 `axiom mission effect list` 中保持 running，直到问题修复。

未绑定 Worker 的 reconcile：pending effect → unchanged，无论 binding 多旧；running effect 的 `2 × readiness timeout` 从 lease 的 updated_at 起算；retired / failed / done / 无行使用原 binding.created_at。Planner 不经过这个 effect，保留原直接启动及恢复。每次 drain 后仅一个 unref setTimeout 对准最早未来 dueAt；既有 60 s reconcile tick 也 kick。stop 清 timer、停止新领取并让正在执行的操作完成，下一次 start 前 kick 无效。done 行不自动清理；不认识 attempt.continue 的旧版本不能解码含该 kind 的 effect 行，不能把这样的降级当作可用恢复。

只读 `axiom.effect.list {missionId,status?}` 返回 `{effects}`，按 `created_at,rowid` 排序；caller class 为 read，不是 mutation。CLI：`axiom mission effect list --mission <id> [--status <s>] [--json]`；文本列 `KIND KEY STATUS ATTEMPTS DUE LAST_ERROR`。

E2E seam：仅当 `getMainE2EConfig().enabled` 且 `AXIOM_E2E_HOLD_ATTEMPT_DISPATCH=1`，dispatch 返回 `{later: now + 250 ms}`。`withFixtureMission({holdAttemptDispatch:true,restart:true,runVerification:true})` 的 restart 清该 hold；`inspectFixtureMission.effects` 展示持久行。`mission-effect-outbox.spec.ts` 观察至少 5 s 无启动，再重启证明同一 seq / branch 只启动一次并验证。Electron 由宿主 verifier 运行。

### Attempt launch（M2-05）

`axiom.mission.start` RPC 在同步 `startExecution` 事务前 await `ensureIntegrationBase`：先读 `refs/heads/axiom/integration/<missionId>`，不存在则读目标分支 HEAD 并 `git branch` 创建；存在则沿用 SHA，不 reset。`integration.base_created/base_reused` 记录 SHA。失败返回 `target_branch_not_found` / `integration_base_unavailable`，Mission 保持 PLANNED。按本 Task 的明确细化，M2 只验证存在，祖先关系与漂移检查在 M4 §12.3；Architecture §16.2 的旧 timeout 映射按下述 runtime-cap 规则解释。

启动顺序：读取已绑定 AgentSpec / ContextPackage render → 校验 Run/Task 与 prompt 大小 → `resolveAttemptBaseline` → 经现有 `createManagedWorktree` 预创建 `axiom/attempt/<taskId>/<seq>`（不传 startupAgent）→ 校验修复基线 HEAD、必要时重开 Orca task → 直接调 `startLocalWorker` → CAS 回填 `attempt_bindings.dispatch_id` → audit / stage settlement。没有 `worktree_id` side-table 列；worktree id 写入启动 audit，读接口经 fleet 的 dispatch/workspace 读取。

M3-04 / D64 ①：`execution/attempt-baseline.ts` 是 ContextBuilder 与 launcher 共用的纯存储判定，从 seq−1 向前检查（D85 / M3-04b）。M3-06-2b 在每个无 Submission 的 Attempt 优先检查可用保全快照，见下文 Interrupted Attempt continuation 的基线表；没有可用快照时，只有该 dispatch 的 `attempt.failed.after.settlement.kind` 为 `unchanged | no_change | blocked | interrupted` 才允许越过，最多走到 seq 1；缺 binding / dispatch、普通失败或其它无 Submission 情形立即回集成基线。找到 Submission 后，其 Candidate 仍为 ACTIVE、该 Candidate 最新 VerificationRun（按 createdAt 再 id 排序取最后一项，不预先过滤 FAIL）为 FAIL 且 reason 不是 `secret_detected`，才返回 candidate baseline（previousSeq、Candidate、VerificationRun、skippedAttempts）。`previousSeq` 是 Candidate 所属 Attempt 的序号；`skippedAttempts: {seq, attemptId, kind, reason?, paths?, failureClass?, reportSummary: string | null}[]` 按 seq 升序记录被越过的 Attempt，无则空数组。`previous_attempt_not_submitted` 的 integration baseline 同样保留已越过的 skippedAttempts，例如 seq 1 声明 blocked、人工调整后的首次重试。其它情况按顺序返回 integration baseline：

| reason                             | 条件                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `first_attempt`                    | seq 1                                                                                                                                             |
| `previous_attempt_not_submitted`   | 向前检查未找到 Submission / 可用保全快照，或遇到未经上述四种 settlement 审计的无 Submission Attempt（包括崩溃、放弃、launch 失败）；附带已跨过的 skippedAttempts |
| `previous_candidate_superseded`    | Submission 的 Candidate 不再 ACTIVE（缺失也不采用）                                                                                               |
| `previous_verification_not_failed` | 无 run，或最新 run 不是 FAIL                                                                                                                      |
| `secret_detected`                  | 最新 FAIL 的 reason 为 secret_detected；附带该 run 供安全证据展示，历史含秘密的 Candidate 不可续接                                                |

candidate baseline 将完整 `candidate.commitSha` 传给 `createManagedWorktree.baseBranch`，新分支仍为本次 `attempt.branch`。创建后用返回的 `worktree.git.head` 验证；未提供时在新 worktree 中经 `gitExecFileAsync` / `gitOptionsForWorktree` 执行 `rev-parse HEAD`。不等于 Candidate commit 则抛出消息恰为 `fix_base_mismatch` 的异常，既有 catch 审计 `attempt.launch_failed {message}` 并按 launch_failed 结算；不 reset、改写或删除任何分支/worktree。integration baseline 仍从 `axiom/integration/<missionId>` 起，Planner 的 baseBranch 不变。

HEAD 验证完成后、构造 WorkerStartParams 之前，Worker launcher 重新读取 Orca task：仅当 status=completed 且紧邻上一 Attempt 有 Submission 时，经内核公开 `db.updateTaskStatus(taskId, 'ready')` 重开，再读 task 并不带 retryOf 启动。这也适用于 secret_detected 的干净重试；内核在活动 dispatch 存在时拒绝重开。completed 但无上一 Submission 仍 launch 失败；failed/blocked 沿用既有 retryOf 路径；Planner 不经过此逻辑。

Worker 的 `attempt.started`、`attempt.start_unknown`、receipt 后的 `attempt.launch_failed` 在既有 after 字段中增加 `baseline: {kind, reason?, candidateId?, commitSha?}`；发生重开时增加 `orcaTaskReopened: true`。receipt 前的异常审计也保留已解析的 baseline 与已完成的重开标记，message 仍脱敏。

terminal fallback 只有 AgentSpec 的 `model !== 'policy-default'` 时，launcher 才同时传 `model` 和 `reasoning.effort`；`policy-default` 时两者都省略，避免内核拒绝 `--effort` 未配 `--model` 的组合。Claude Mission Planner 的 structured channel 另由下述 pins 直接消费 per-role model/effort。

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
3. `z.toJSONSchema(PlanProposalSchema.omit({provenance:true}))` 生成的 JSON Schema，以及唯一 Task id、合法边端点、V1 只允许 INTEGRATED（VERIFIED 边报 threshold_not_supported）、无环、至少一个 root、合法 milestoneId、kind/risk/maxAttempts 与可选 role 标签规则。
4. 两个 Task、一条边的最小示例。
5. Codex 保留 `axiom plan propose --mission <id> --attempt {{attemptId}} --file <proposal.json> --json` 配方，proposal JSON 写到 worktree 外；Claude 只能调用 Axiom MCP 工具 `plan_propose`，输入 `{ "proposal": <完整 PlanProposal> }`，按工具返回的 schema issues 修正后重试，同一 Attempt 由 Control Plane 保持一个 PlanRevision。Claude 提示词不再含 shell 提案命令或文件约定，禁止创建、编辑、提交文件，只允许只读 git 命令。两者均要求 worktree 保持 clean。

M3-04b-2 / D85 rule 2 修订：每个 `acceptanceCriteria` 项都是 `{text, check}`。最小示例横跨两个 Task 展示 command、artifact 和 human 三种 check。command 从仓库根原样执行且须 exit 0，单行、一个命令，不含 `;`、`&`（含 `&&`）、`|`（含 `||`）、`>`、`<`、反引号、`$(`；首个空白分隔 token 必须是允许程序（按完整名称或 basename 匹配，含 `=` 的 token 不是程序）。允许集为 `verificationRules.evidenceCommands.allowedPrograms` 加全部 setupCommands / repositoryGates 使用的程序，提示词列出解析后的集合。期望与描述只写 `text`，不在 `command` 加 “output” 或 “with exit code 0”。artifact 表示提交引用可读、非空 Artifact，指定 artifactKind 时须匹配；human 只在命令和 Artifact 都无法证明时使用，由人确认，应少用且计划会标明。`requiredEvidence` 已退役并拒绝新写入。同一 schema 的 `.describe()` 进入提示词 JSON Schema 与 MCP plan_propose 输入 schema；持久合同不含 transform，JSON Schema 转换不需特殊 io / unrepresentable 选项。

提案在结构验证后、插入 PlanRevision 前检查：非空 legacy 字段 → `plan_invalid` / `required_evidence_retired`，path=`['tasks',i,'requiredEvidence']`；字符串 criterion → `criterion_shape`，path=`['tasks',i,'acceptanceCriteria',j]`。随后对 `resolveAcceptance` / `acceptanceCommands` 的命令执行 D85 边界检查；非法项为 `evidence_command_invalid`，path=`['tasks',i,'acceptanceCriteria',j,'check','command']`，j 是 criterion index，不是去重后的命令 index。CLI / MCP 保留 code、severity、message、path、taskIds，Planner 同回合可修正，失败不插入 PlanRevision。已存旧提案审批保留兼容读取。Human `axiom.task.create` 使用相同检查，路径从 `['task',…]` 开始；REQUEST_SUBTASK 使用同一命令验证，失败 reason 为 `evidence`。旧 policy 无法解析时以默认 VerificationRules 检查，边界不失效；执行时不重复检查。边界限制形状与程序，不限制程序能力（验证沙盒属 M3-10 / DEF-46）；`pnpm run verify:full output with exit code 0` 的程序合法，故仍通过，靠 planInvalidPatterns 与 M3-09 计划卡处置，不启发式检测参数或读取 package.json。

M3-05-2 的 proposal-side checks 在同一回合区分 error 与 advisory warning：

- `acceptance_uncheckable`：`plan_invalid {errors:[{code,severity:'error',message,taskIds:[task.id],path:['tasks',i,'acceptanceCriteria']}]}`；Task create / adjust 使用 `['task','acceptanceCriteria']`，REQUEST_SUBTASK 的 `checkSubtask` 调用同一 validator，在既有检查拒绝路径返回 failed reason `acceptance_uncheckable`，不创建 Task。
- `coverage_index_out_of_range`：proposePlan / createTask 解析 active Goal 后检查；索引 ≥ Goal 标准数为 `plan_invalid` error，path 指向 `coversGoalCriteria` 的项位置。纯 proposal validator 不猜测 Goal。
- `incomplete_coverage`：Goal 有标准且存在未声明覆盖的项时，单条 warning 带 `taskIds:[]`、`uncovered:[{index,text}]`。
- `scope_overlap`：每个没有任一方向依赖路径的无序 Task 对至多一条，带 `taskIds:[a,b]`、全部重叠条目 `paths:[{a:entry,b:entry}]`；literal / literal 互作路径前缀匹配，literal / glob 用 literal 匹配 glob，glob / glob 只在原字符串相等时重叠，`.` 与所有路径重叠（复用 `matchesPathPattern`，不改 diff gate）。该保守规则可能漏掉不同 glob 的相交；共享 dependency manifests / lockfiles 应集中到一个 Task 或加依赖（DEF-21 ⑦）。
- `insufficient_parallel_roots`：仅显式要求根数量时产生，带 roots 的 taskIds、expected、found；改为可接受的 warning，不是 error。

三种 warning 均为严格的 code 判别合同，顺序按 code 再按 taskIds，路径与 id 也保持确定性。proposePlan 在 schema、acceptance、command、Goal 归属和索引检查通过后计算并一次性写入 `plan_revisions.proposal.warnings`；旧 blob 缺少 warnings 解码为 `[]`，不加表、列或 stage。读方和批准不重算 warning。`plan.proposed.after` 保持整个 PlanRevision（现在包含 warnings）；`plan.approved.after` 在既有 status / activePlanRevisionId / provenance 旁增加 `warnings:[{code,taskIds}]` 与 `coverage:{covered,total}`，将批准绑定到当时可读的 warnings。它们是 advisory，人可带着 warning 批准；本 Task 不增加 renderer 告警 UI，也不把审计当成阅读行为的观测。

`axiom.plan.show / list` 的 PlanRevision 返回持久 warnings。show 另外从存储的 plan.tasks 与其 `goalRevisionId` 对应 Goal（不是当前 active Goal）计算 `coverage:{criteria:[{index,text,taskIds}],uncovered:number[]}`，供 M4 completion gate（DEF-20 ②）消费；taskIds 为提案 id、去重排序。list 不增加 coverage。CLI `axiom plan show` 表格后打印 `WARNINGS`（如 `[scope_overlap] T03 ∥ T08: <path>, <path>`、`[incomplete_coverage] uncovered: #0 "<text>"`）和 `COVERAGE`（`#0 "<text>" ← T01, T04` 或 `← (none)`）；空列表为 `none`。MCP `plan_propose` 成功收据增加 `warnings:[{code,taskIds}]`；它是交给人的收据，不是重试要求，已有 PROPOSED 时仍返回 `plan_pending`。Planner prompt 要求声明覆盖、每个 Task 可检查、并行 scope 不重叠；最小示例仅在 Goal 有标准时为两个 Task 添加 `coversGoalCriteria:[0]`。

后加的 desktop / REQUEST_SUBTASK Task 仍跑 acceptance 与 coverage-index 检查，但不修改已存 proposal，也不重算 warnings：warnings 描述被批准的提案，后加 Task 在其范围之外；show 的 coverage 同样只投影存储的提案。M4 如何结合实际集成与验证证据判定完成不在本 Task 范围内。

Planner 无 PlanRevision，因此只持久化 `context_package_manifest` 与 `context_package_render` 两个内容寻址 Artifacts，**不插入 context_packages**（其 plan_revision_id 为 NOT NULL）。binding.contextPackageId 为 render Artifact 的 `art_…` id；launcher 用 `artifacts.read` 取模板。preamble 由 preambleBuilder 交付时只替换 `{{attemptId}}`，D73 之后不含任何凭据。Planner dispatch 在该回调交付 preamble 前绑定，以支持快速 provider 在 readiness receipt 返回前提交。

`axiom.plan.propose` 的 planner 形式通过同一 Attempt 身份链（D73：宿主核实的 worker 身份 / assignee / 进程代次）鉴权，但显式要求 planner AgentSpec、同 Mission/Goal/Run 的 pseudo-task 与 planner branch；Worker 通道仍要求真实 Task stage。提交前对记录的 worker.worktree_id 执行 `git status --porcelain`，非空返回 `planner_worktree_dirty`（data.files 为 porcelain 文件列表，错误消息同时列出文件供 CLI 显示）并写 planner.rejected，Plan/Mission 不变；缺少 worktree 路径返回 `planner_worktree_missing`。Git IO 后再次鉴权。干净提案经原 `missions.proposePlan` 完成 ANALYZING → PLAN_REVIEW；provenance 由服务写为 `{kind:'planner',actor:provider,model?:explicitModel,at}`（遵循 M2-09 brief 与现行 ProvenanceSchema；D48 旧文的 model kind 不作为新增枚举）。

Plan 与 planner.proposed 的 Attempt 归属、mutation receipt 在同一外层事务提交，防止结算与停止之间崩溃丢失归属。提交后立即返回收据，通过 `setTimeout(..., PLANNER_STOP_GRACE_MS).unref()` 延迟 2,000ms 调用现有 `stopLocalWorker` / `releaseLocalWorker`，让 CLI 先收到响应再关闭其进程树；定时停止写 planner.stopped，记录 stop state 与 releaseDisposition。定时回调的异常只记录 Mission / dispatch 身份，stop_unknown 或资源维护失败交恢复处理，不回滚提案；宽限期内崩溃丢失定时器时，下一轮 Recovery 根据持久的 planner.proposed 补 stop/release。只读权限是合同约束；CLI Agent 没有运行时 filesystem write-scope 强制，G2 在 propose 时拒绝脏工作树，不自动清理文件或提交。

Recovery 扫描所有 planner bindings：未提案的 terminal worker 或确定 exited → planner.attempt_failed（去重），active exited 先 failDispatch，再请求 release；unverifiable / stop_unknown 沿用持久 liveness facet 时钟，容忍期后 abandon + planner.abandoned 与证据，再请求 release；live 超过 `policy.budget.maxRuntimeMinutes ?? PLANNER_RUNTIME_BUDGET_MINUTES` 时以 `runtime_budget_exceeded` 停止（默认 30 分钟，仅 Planner）；已提案但未停止的 live Planner 补 stop/release。结构化 Claude Planner 的回合结束无提案走下文 c″，不等待 60 s tick；默认预算覆盖回合结束信号丢失的情形。c″ 使用已开始 send 或与已接纳 send 关联的 result 证据，覆盖尚无 journal 输出即失败的回合；startup / queued idle 与子 Agent 结束信号不触发 Mission 回调。无 dispatch 的 orphan 经两倍 readiness window 留失败审计。以上不改变 Mission status；Mission cancel 沿用原 rule h，涵盖没有 stage 的 Planner。

审计事件：`planner.started / planner.launch_failed / planner.start_unknown`（missionId、goalRevisionId、seq、branch、worktreeId、provider）；`planner.proposed`（attemptId、planRevisionId、taskCount、edgeCount、rootCount）；`planner.rejected`（reason、files）；`planner.stopped`（state、releaseDisposition）；`planner.attempt_failed / planner.abandoned`（reason、放弃证据）。绑定后的 objectKind=attempt、objectId=dispatchId，绑定前失败以 pseudo-task id/seq 标识。

`TaskSpec.role?: string` 仅为 DEF-4 的非空标签，提案/批准/Task spec 原样保留；Task JSON 投影附带 spec。没有 skills 物化、CodeGraph（DEF-5）或 DEF-10 ①②③。

M2 之后：D58 解决真实 Planner 通道/目录信任与权限映射；M3 复审 DEF-4/5，Planner v2 与 replanning 留 M5。

### Headless Worker（M3-08；D82 ③ / D58 / D63）

macOS / Linux 的 Codex 与 Claude Worker 走 `channel=headless`、`posture=headless-sandboxed`；其他 provider 与 Windows 保持既有路径，Worker fallback 审计为 `channel=tui`、`posture=tui-bypass`。认证状态独立于 adapter 存在。Codex 通过既有只读 home seam 与 D83 布置逻辑设置 `CODEX_HOME`；Claude 使用 registration 的 launch-purpose resolver，且解析结果必须等于被选中 managed profile 的 home，不能回退到用户 system home。未选账号或 system fallback 抛 `no_account`。

`execution/headless-worker-command.ts` 通过既有 Codex executable resolver 或 `agentCmdOverrides.codex` 选可执行文件；不调用 shell 的 codex function。命令为 `exec --json --color never -s workspace-write -c sandbox_workspace_write.network_access=false -c approval_policy="never" -c features.hooks=false -C <worktree> -o <attemptDir>/last-message.md [model/effort] -`。model/effort 使用现有 option catalog；policy-default 省略 model，effort 仍来自 AgentSpec。prompt 从 `<attemptDir>/prompt.md` 重定向到 stdin，argv/audit 不含 prompt 内容。`<userData>/axiom/attempts/<attemptId>/` 是 worktree 外的宿主目录，保存 prompt、launch.json（基线 commit / branch / worktree binding）、events.jsonl、last-message.md 与 exit-code；worktree 的 `.axiom/prompt.md` 是相同 prompt 的恢复副本。context 被压缩后，Worker 必须先重读该文件。

D14 service-only `controlPlane.headless.prepare(dispatchId)` 在 dispatch 创建后、terminal spawn 前绑定 Attempt 并准备命令，RPC 不能请求该字段。强制 terminal mode，复用 `createTerminal({command, env})`，跳过 startupAgent/default args、交互 readiness 与 preamble paste。POSIX wrapper 用 tee 保存 JSONL，读取 `PIPESTATUS[0]`，临时文件 rename 发布 exit-code，再保持 shell 存活直到既有 D76 release；spawn 后即 ready。dispatch/custody/prepareStartingWorkerAuthority 与 PTY liveness 仍由内核负责，没有第二套进程生命周期。

`execution/attempt-exit-submission.ts` 的串行队列与 CLI submit 共用。launch 后的 250 ms exit-file watcher 和恢复对账调用同一幂等入口；重启只凭持久 exit-code 结算，不对 headless Attempt 使用 D59 shell-foreground 证据。host 鉴权重新核对当前 dispatched dispatch、RUNNING Task、最新 binding、Mission/Run 与 worktree/branch。exit 0、provider turn 未失败且最终 fenced JSON 通过 `HeadlessSubmissionReportSchema` 时按 outcome 结算；schema 省略宿主计算的 filesChanged，artifacts 改为 `.axiom/artifacts/` 下的 path/kind/mediaType。路径必须解析到该目录内的普通、单链接文件，单个 Artifact 上限仍为 8 MiB。宿主把最终 report 存为 worker_report，并把所有 Worker Artifact 归属为 `createdBy=attempt:<id>`、`related=[taskId,attemptId]`。

M3-04b 为 headless 报告增加可选的严格判别联合 `outcome`；省略等同 `{outcome: 'submitted'}`，沿用原 Submission 路径。另两种为 `{outcome: 'no_change', reason: 'candidate_already_correct' | 'cannot_reproduce'}`，以及 `{outcome: 'blocked', reason: 'blocked_by_scope', paths}`；blocked 的 paths 必须有 1–50 条 trim 后非空字符串，每条 ≤500 字符。终端 `SubmissionReportSchema` 不增加 outcome，旧报告仍可读取。

D85 / M3-08i：exit 0 且 outcome=submitted（或省略）的有效报告若收到精确 `OrchestrationError(invalid_argument, candidate_unchanged)`，结算为 `unchanged_candidate`（审计 `settlement.kind=unchanged`），watcher 停止、reconciliation 返回 failed / exited。摘要脱敏后 ≤2000 字符，limitations 脱敏后每项 ≤500 字符、最多 20 项，并保留 worker_report Artifact、ACTIVE Candidate id/commit/tree、lastMessageExcerpt 与原事件证据。失败后重复调用返回 unchanged、不追加审计；丢失释放定时器仍由既有恢复释放规则补齐。其它 Submission 错误仍交 watcher / recovery 重试，原 invalid-report 路径和终端提交行为不变。

**声明结算（M3-04b，D85 第 5 条 / D82 ③）**：有效 `no_change` / `blocked` 报告不调用 settleSubmission、不快照树、不创建 Submission / Candidate；先存报告及其 Artifacts，再由 `attempt-exit-declared.ts` 在 `headless_exit_declared` 事务内重新核实 host authority、`failDispatch(workerProcessExited=true, terminationReason=process_exited)`、写一次 attempt.failed、路由 typed BLOCKED 并转换 Task。audit 的 objectKind=attempt、objectId=attemptId，after 为 `{taskId, reason: process_exited, evidence: exit_code, exitCode: 0, settlement: {kind: no_change|blocked, reason, paths?}, candidate?: {id,commitSha,treeSha}, worktreeChanged, reportArtifactId, artifactIds, reportSummary, limitations, lastMessageExcerpt, ...eventAudit}`；candidate 仅引用仍 ACTIVE 的旧候选。paths 脱敏后最多 50×500 字符，reportSummary ≤2000，limitations ≤20×500；lastMessageExcerpt 与事件证据沿用退出路径的脱敏规则。`worktreeChanged` 是只读 `git status --porcelain` 的非空行数；即使树已改动，声明仍按下表结算，该计数只是证据，不是准入门。

| 声明 reason                 | settlement.kind | Task stage 路径                                                            |
| --------------------------- | --------------- | -------------------------------------------------------------------------- |
| `blocked_by_scope`          | `blocked`       | RUNNING → NEEDS_FIX (`attempt_blocked`) → BLOCKED (`scope`)                |
| `candidate_already_correct` | `no_change`     | RUNNING → NEEDS_FIX (`attempt_no_change`) → BLOCKED (`candidate_disputed`) |
| `cannot_reproduce`          | `no_change`     | RUNNING → NEEDS_FIX (`attempt_no_change`) → BLOCKED (`candidate_disputed`) |

路由只看类型化 reason，不分析报告文本；即使还剩重试次数，也不自动回 READY。`settleDeclaredAttempt` 与普通失败结算共用「最新 RUNNING binding、dispatch 匹配、无 Submission」栅栏；消息与 stage 同事务回滚。BLOCKED 消息含 `blocked: {reason,paths}`、Task/Attempt 身份、`related.taskIds=[taskId]`、`artifactIds=[reportArtifactId,...artifactIds]`，summary 为脱敏后的 `Attempt <seq> declared <reason>` 与路径（≤2000），body 为报告摘要（≤4000）；无路径时 paths=[]。它立即成为 pending 待处理项，直到人工 adjust / cancel 写 `blocked.resolved`。事务提交后安排既有失败 Worker release，结果为 `declared`；watcher 停止、reconciliation 返回 failed / exited，再调用返回 unchanged，不追加结算。确定性 FAIL 保留，后续 Attempt 必须重新独立验证。

headless `snapshotCandidate` 使用临时私有 Git index，排除 `.axiom/`，不会删除已有 index.lock；commit-tree + 带旧值检查的 update-ref 只写 Attempt branch，并以空 hooksPath 禁用 hooks。filesChanged 从 launch baseline 到 Candidate commit 的 Git diff 计算。后续 Candidate / Submission / VerificationRun transaction、transcript archive 与 release 沿用现有实现，Worker 报告仍不等于独立验证。

非零退出、provider turn 失败（即使 exit 0）、缺报告、非法报告或非法 Artifact 进入 `headless_exit_failure`。普通 failed 仍调用 `settleAttemptWithoutSubmission`；环境中断见下节。M3-08e 的 2 秒 grace、E2E hold、失败 Worker release 与 60 秒恢复释放不变。audit 原字段全部保留（exitCode、脱敏 lastError / lastErrorEvent / lastMessageExcerpt、reportError、session / usage 等），仅加类型化 failure；重连 error 行本身不阻止有效成功报告。Codex 错误优先取 turn.failed.error.message，否则取最后 error.message；thread.started.thread_id 记为 providerSessionId，最后一次 turn.completed.usage 原样记录，不累加或重复计数。

### Interrupted Attempt continuation（M3-06-2a / M3-06-2b / M3-06-2c；D88 / D68 / D64）

`execution/attempt-failure-classification.ts` 是纯、never-throw 分类器。Claude 每个 JSON object 进入同一个内核 `ClaudeUsageLimits`，调用 observe / assistant / result；Axiom 不解析限额元数据、不读取账号快照、不分析 assistant 散文。下表按顺序 first-match，表中 retryable 与 source 持久化在 `attempt.failed.after.failure`。结构化失败取 assistant error 或 result 的错误字段；HTTP 状态与 terminal_reason 分支只读取失败 result。

| 规则 / 信号 | class | retryable | source | settlement.kind |
|---|---|---|---|---|
| a. 内核识别到 Claude usage refusal | usage_limit | true | structured | interrupted |
| b. assistant authentication_failed / oauth_org_not_allowed / account_on_hold / verification_required / cloud_credential_error | permission_error | false | structured | interrupted |
| c. assistant billing_error | usage_limit | false | structured | interrupted |
| d. assistant overloaded / server_error，或失败 result HTTP 408 / 409 / ≥500 | provider_error | true | structured | interrupted |
| e. assistant invalid_request / model_not_found / max_output_tokens，或 result HTTP 400 / 404 / 413 / 422、terminal_reason=prompt_too_long | validation_error | false | structured | failed |
| f. result HTTP 401 / 403 | permission_error | false | structured | interrupted |
| Codex 错误文本（Claude 未命中 a–f 的 fallback）：quota / rate.?limit / usage limit / insufficient.credit / 429；仅 Codex 可再从自己的 rollout 补 window / resetsAt（M3-06-2a-3） | usage_limit | true | text | interrupted |
| 同一 fallback：auth(?:entication\|orization)? / unauthori[sz]ed / login / log(?:ged)? in / invalid.token / 401 | permission_error | true | text | interrupted |
| g. 无可识别 event，或文本 / event 解析的外层异常 | unknown | true | absent | interrupted |
| g. 其余有 event 的失败（包括 fixture work failed / Fixture Worker crashed） | unknown | false | absent | failed |

M3-06-2a-2 删除未被生产调用的 `headlessFailureKind`，原两份测试的所有行改断言 `classifyHeadlessFailure(...).kind`，期望不变。Claude 结构化 pass 内异常仅表示“无结构化 verdict”：仍走文本正则和有 event 的失败规则，函数整体仍不抛错。未带内核 refusal 的 assistant `error: rate_limit` 没有单列规则，仍走文本 fallback；真实 harness 探测没有支持独立规则的证据，此项无行为改动。

两组正则保持原词汇、大小写不敏感；文本认证证据弱，只走等待与三次上限。`transport_error` 只在词汇中，本 Task 没有可靠信号，因此从不产生。裸 HTTP 429 没有 assistant quota evidence 时由内核拒绝推断限额，仍可走原文本 fallback。failure 的 `resetsAt` 只用于 usage_limit（ISO datetime），window 为 session / weekly / weeklyModel / credits；两者均来自内核 failure.usageLimit。只保留 `now < resetsAt ≤ now + 8 days`，过期或越界 reset 丢弃。

usage_limit 的退出结算从本 dispatch 的 `attempt.headless_prepared` audit 用 zod 读取 `combination.effective.claudeConfigDir` 或 `codexHome`（`{kind:account,path}`，非空 path）。若有效，continuation payload 可选增加 `account: {provider,key}`；key 统一经 `accountKey` 计算为 `sha256(JSON.stringify([provider, exactHomePath]))` 的小写十六进制，effect 不存 path。当前选中 home 也经同一个函数计算。缺失 / 非法 audit 只省略 account，不阻断结算；旧 payload / AgentSpec 仍可解码。restart 的 unknown 路径不加 account。

M3-06-2a-3：`readAttemptAccount` 一次读取该 dispatch 的启动审计，同时给出单向 account key 与临时 home path；path 只到 reader，不进入退出审计、effect 或日志。仅 Codex 且纯文本分类已是 `usage_limit` 时，在 `headless_exit_failure` 事务开始前 await `readCodexRolloutLimit`，事务内没有异步文件读取。线程 id 来自已退出 Worker 的首个 stdout `thread_id`；起点来自 `worker_dispatches.created_at`（SQLite UTC 经既有转换后使用），不是 rollout 自述：新会话取本 Attempt，M3-06-2c 原地续取 `session.originSeq` 对应的最初 Attempt，因 rollout 仍在会话创建日的目录。reader 不改变 class / retryable / source / settlement.kind，source 仍为 text；Claude 与其它 Codex 失败完全不调用 reader。

reader 只接受 1–128 位 ASCII 字母、数字、下划线或连字符的 thread id，不接受点、分隔符或 glob。只枚举启动日到今天的本地日期目录 `<account home>/sessions/YYYY/MM/DD`，不递归扫描 home；匹配 `rollout-*-<thread id>.jsonl`，选修改时间最新的一份普通文件。真实路径必须在 sessions 内，sessions 根本身不能是外跳的符号链接，日期目录与文件外跳也返回无证据；只读打开最终文件，核对 inode / device 和真实路径，不跟随被替换的最终符号链接，不读 FIFO。只读该文件尾部最多 256 KiB，截断时丢掉首行（无换行则整个尾部不解析）。

只解析 `event_msg / token_count` 的 `rate_limits`：`limit_id`、`primary / secondary` 中的 `used_percent / window_minutes / resets_at`、`rate_limit_reached_type`。其它内容在白名单校验边界丢弃；无对话内容、账号信息或路径被返回或记入错误。窗口映射为 app-server 字段，null 保持 null；按文件顺序喂给一个内核 `CodexUsageLimits`，调用其 usageLimitExceeded failure 查询，只取 usageLimit 的 window / resetsAt。Axiom 不比较比例、不选窗口。window 原样保留，reset 只在 `now < reset ≤ now + 8 days` 时转 ISO 写 failure。缺 home / thread、非法 id、文件缺失 / 不可读、全部行畸形、内核异常均不抛错且不补证据；混入的畸形行跳过。无写入、网络、刷新、timer 或策略键。

限制：真实账号撞限时的 rollout 值尚未观察，reset 是 best-effort；没有证据仍按 M3-06-2a 阶梯和每 Task 三连规则。spent 窗口只与 quota 文本一起被信任；若账号仍能用 credits 工作，却因临时 quota-like 错误退出，仍会等待该 spent 窗口。其它 limit id 被内核忽略（包括上游 #58413 所述 all-null 快照），不能提供 reset。特别大的最后一轮可能让最后一个有效记录落在 256 KiB 尾部之外。依赖 Codex 0.163.0 的目录 / 字段名和内核解释行为，升级可能改变两者；此处不读轮询快照、不做撞限前配速、不保全工作树或恢复 session。

同一 `headless_exit_failure` 事务做 failDispatch、attempt.failed、`RUNNING → NEEDS_FIX(interrupted)` 并 `attemptCountDelta=-1`，撤销 admission 的计数，seq 始终递增。最新 binding、RUNNING、无 Submission 的栅栏避免重复退款；存储防止计数负数。失败写 effect 或消息时整笔回滚。普通 interruption 的 chain = 1 + 前一个 seq 的 attempt.continue.payload.chain（若无为 1；done / failed / retired 均计入）。可重试且 chain < 3 时 `→ READY(retry_after_interruption)`，同事务 enqueue continuation；dueAt = 有效 reset + 60 秒，否则 now + [1,5,15] 分钟的第 chain 档。第三档仅在未来提高次数上限后可达。不可重试或第三次连续中断 `→ BLOCKED(environment)`、previousStage=NEEDS_FIX，并按该 Attempt 归因路由一个 pending typed BLOCKED，含 `{reason:environment,paths:[]}`，summary 写 class 和连续次数；此时不 enqueue，不产生 retry_budget_exhausted。M3-06-2c 的 `resume_refused` 复用此事务与退款，但不增加 chain 且 dueAt=now，详见下文原地续。

Scheduler 在 admission 检查最新 seq 的 continuation：只有 pending 且 dueAt 在未来才返回 `backoff`，因此 unrelated stage_change / boot resume 不会提前开始。到期执行器重读 Mission EXECUTING、Task READY 且无更新 Attempt，再 await 该 Mission 的 scheduleRound(stage_change)，不自行启动 Worker；其它状态跳过本 Mission。usage_limit 在处理本 Mission 之后，无论该 Mission 当前状态如何，还逐个 await 所有其它 EXECUTING Mission 的 stage_change round，然后返回 done；其它 failure class 不唤醒其它 Mission。任一个 round 拒绝都进入同一 effect 的既有重试策略。Question、Approval、预算、并发、暂停、取消仍由 Scheduler 保证。执行器抛错最多试 3 次、间隔 1s / 5s，onOrphan=retry；最终 failed 或 retired 均不挡 admission，任何后续 round 都可放行 READY Task。重启恢复 pending 行和 outbox 的单一到期 timer，不丢等待。

桌面 `axiom.task.adjust` 同事务 retire 该 Task 的 pending continuation，写 `effect.retired {kind,key,reason:superseded_by_task_adjust}`，随后原有 round 可立即放行。实际退休了 usage_limit continuation 时，提交后还唤醒所有其它 EXECUTING Mission（外层事务回滚则全部不发）；未退休任何行或退休其它 class 时没有跨 Mission 唤醒。BLOCKED(environment) 走原 previousStage → NEEDS_FIX → READY，原 blocked.resolved 消除 pending item。Worker-facing params / CLI 仍只接受 blocked_by_scope、candidate_already_correct、cannot_reproduce；environment 仅宿主能写。

Recovery 仅对两种旧 runtime 的 headless 结束复用上述 interruption 结算（D88 2026-11-11 修订 ③）：c 的宿主观察到 process_exited，以及 b 的该 Attempt 自己的 worker 行为 abandoned / terminal_missing、runtime_epoch 不同于当前 runtime（null 也不同）、且 Attempt 目录没有退出路径接受的整数 exit-code。两者 failure=`{class:unknown,retryable:true,source:absent}`、attempt.failed evidence=runtime_restarted；前者 reason=process_exited，后者 reason=terminal_missing 且 lastError 取 worker.last_error。“由更早的 runtime 启动”包含跨重启存活后才消失的 Worker。两者均退款、等待，连续三次仍交人。已有 exit-code 仍先尝试 submitExitedAttempt；内核已结算而退出路径拒绝它时，b 保持计数且不保全，不在此处理其退出内容。same-epoch process exit / terminal_missing、TUI、其它 kernel terminal、launch orphan/rejected、timeout（runtime limit）、unverifiable timeout、unchanged / declared 路径不变。

没有 `attempt.preserved` 的旧 Attempt 仍按原基线回溯越过 interrupted，skippedAttempts 记录 failureClass（旧审计无 failure 时 unknown），保留原 ACTIVE / latest FAIL Candidate 与验证摘录。没有保全审计的后继说明仍明确说未携带任何未提交工作，也不满足原地续条件。M3-06-2b 的保全与接着做规则如下；符合 M3-06-2c 确定性规则的 Codex 后继可在同一工作树恢复原会话，其余沿用新工作树、新会话。

常数集中在 interruption-policy.ts，无新 policy key。仅 e2e config enabled 时读取 `AXIOM_E2E_INTERRUPTION_BACKOFF_MS`（正整数逗号列表），替代 ladder 并将 reset slack 置 0；非法值沿用生产默认值。Codex 未获得有效 rollout reset 时，账号 cooldown 仍只持续当前 ladder 的一档；每档结束最多 concurrencyLimit 个 Task（每个 Mission 的并发上限，多个 Mission 可各自探测）再次试探账号，每个 Task 自己连续三次 interruption 后仍 BLOCKED(environment)。等待计入 Mission wall-clock。账号 cooldown 仅随其 continuation 到期、人工调整或取消该账号所有等待 Task、或选择其它账号而解除；取消 / 切换账号仅在每个 Mission 下一轮被看见，不主动唤醒其它 Mission，已经等待的 Task 切换账号后仍保留自己的 backoff。已失效 Task / 非 pending effect 不再是冷却证据。billing、结构化 sign-in 等等待无法解决的失败不产生 continuation，故不产生 cooldown；旧的弱文本认证 fallback 仍按原规则等待，但不形成 usage-limit 账号冷却。每轮拒绝仍重复写 audit。不读内核轮询限额、不刷新 usage、不激活 provider、不加网络调用。旧构建不能解码带 account 的严格 continuation payload；不能安全依赖降级处理这种等待。

#### Headless worktree preservation and continuation（M3-06-2b / M3-06-2b-2 / M3-06-2b-3）

保全入口包括 `settleHeadlessExitFailure` 的 interrupted / failed 退出路径，以及 Recovery 的四种 headless 结束：内核 worker 已 `stopped`（b）、宿主观察到进程 `exited`（c）、runtime-budget stop 收到 `stopped` 回执（d）、旧 runtime 的 `abandoned / terminal_missing` 且无可接受 exit marker（b 的 D88 修订 ③）。前三者的固定顺序是 **stop → 宿主证明进程已退出 → preserve → settle**；第四种接受内核的终端丢失结论，**kernel verdict → preserve → interrupted settlement**，不把它升级为原地续的进程退出硬证据。捕获的 terminal_missing proof 在任何工作树 IO 前重读该 worker 行，要求 headless、abandoned、terminal_missing 和旧 runtime；入口另查 exit marker，非 ENOENT 的读取错误使该 binding 本轮 reconcile_failed、下轮重试。b / c 不再次停止。`stop_unknown` 不保全、不结算，仍走原容忍时钟。`headless-launch-record.ts` 与退出路径共享 launch 读取、provider authority 与 binding 检查：worktreeId 必须匹配 kernel worker，branch 必须匹配 binding；路径从 worktreeId 解析。`baselineSha` 仍取 Worker 可写的 launch 记录，非新的宿主权威。恢复捕获读不到 / 无法解析 / 不匹配 launch 时不捕获、不写 `attempt.preserved`，原结算继续；恢复优先尝试的退出路径只对共享读取 / binding 检查识别的损坏 launch 记录让路；有效退出路径的 Artifact / 事务错误仍重试，不改归类或退款。`preserved-snapshot.ts` 在结算事务之前检查分支，通过与 Candidate 共用的 `worktree-snapshot.ts` 临时私有 index 捕获全部未忽略文件（排除 `.axiom/`），不写原 index、HEAD、branch 或工作文件。树等于 **launch baseline 的树** 时返回 `empty`，没有新 commit / ref；即使 Worker 已自行提交，也不拿 HEAD 的树作 empty 判定。否则 commit 的 parent 为工作树 HEAD，保留 Worker 提交的祖先链，message 为 `axiom: preserved snapshot <attemptId>`，固定身份、禁用 hooks，并 create-only 发布 `refs/axiom/preserved/<taskId>/<seq>`。重放遇到同 Attempt message 的既有 commit 时原样采用；不同 message 是 `ref_conflict`。同一宿主内同一 Attempt 的重叠捕获共享进行中的 Promise，等待唯一捕获完成，避免 ref 锁已持有但尚未发布的空窗口；create-only 发布竞争失败仍重新读取已经发布的 ref，同 message 采用该 commit 与 tree，不能把它报告为 `git_failure` 或覆盖 ref。

两份 diff 用途不同：`readCandidateDiff` / `evaluateDiffGate` 沿用独立验证的集成 merge-base 到保全 commit 的三点差异，产生 scope paths 与秘密发现 `{path,pattern}`，不存匹配文本；内核 `gitChangeListArgs` / `parseGitChangeList` 读取 `baselineSha..<preserved>`，给出该 Attempt 自己的变化和可用的增删行数。scope paths 排序；任一列表超过 200 项，或三点 diff 缺失 / 不完整，都不继续该快照。路径若需脱敏则不再是可靠路径身份，保守返回 `diff_unavailable`，避免脱敏后的名字通过另一条 scope pattern。

所有捕获错误变为 `unavailable`，固定 reason 为 worktree_missing / branch_mismatch / ref_conflict / git_failure / git_timeout / diff_unavailable / diff_incomplete / too_many_paths；已有 commit 时仍记录 ref / sha。不暴露 Git 原始错误，不删除任何已写对象或 ref，不安排保全重试，不因捕获失败改变结算。Git 操作使用有界 timeout；其结果不构成 Candidate、Submission、VerificationRun 或 stage transition。

`headless-handoff-records.ts` 从本 Attempt 的 eventsText 纯解析真实记录，畸形行跳过、其它工具忽略、整体不抛错。Codex 配对 command_execution started / completed，取 agent_message；Claude 配对 Bash tool_use / tool_result，取 assistant text。最后 5 条消息各保留尾部 1,000 字符；最后 20 条 shell 命令各保留命令前 300 字符和输出尾部 300 字符，记录 Codex exit code / Claude error flag，未完成命令标记 unfinished。全部先 `redactContext` 再截断；常数集中于 `preservation-policy.ts`，无 Policy key。

有保全结果或任一记录时，事务前存一份 version 1 JSON `log` Artifact（application/json、createdBy=AttemptSettlement、related=[Task,Attempt]），包含消息、命令、该 Attempt 自己的变化与身份；不关联 Submission，不是 transcript，也不是会流向下游 Task 的 handoff / worker_report。Artifact 失败只省略 id。随后同一个 `headless_exit_failure` 事务重新验证 authority，原有 `attempt.failed` 旁写 `attempt.preserved`：`{taskId,result,baselineSha,artifactId?}`，result 不含 own changes。两条审计同成同败；捕获期间若其它路径已结算，既有 current / RUNNING / dispatch 栅栏拒绝本事务，不写保全审计；已生成的不可变 ref 或 Artifact 可留存。

恢复捕获与 Artifact 写入均在数据库事务外 await；结束前重新读取 Mission、当前未提交的 RUNNING Task / binding / dispatch 与 worker 状态，失去权威则本分支不写结束审计或结算，从对账顶部重读；先前在 live/current 时写下的 stall observation 仍是观察事实。`attempt-recovery-endings.ts` 把 `attempt.preserved` 经 recovery audit helper（actor=RecoveryService、附 taskId / seq）与原结算写进同一事务，二者同成同败。b 的 stopped 在两种通道都补 `attempt.stopped {reason: kernel_stopped}`；d 改为 `timeout`，并在同一事务内先写 timeout 规则的 `attempt.supervised`（M3-06-3）。c 的同 runtime headless `attempt.failed` 新增 `settlement: {kind: failed}`，没有 exit marker / 自身错误的归因；旧 runtime 的 `evidence: runtime_restarted`、interrupted 退款与阶梯，以及 TUI 原行保持不变。停止后、Axiom 事务前崩溃由下一次 b 修复，已经发布的快照照样复用。

M3-06-2b-3 的 `attempt-daemon-loss.ts` 在捕获后复查同一 durable authority（并再次确认 terminal_missing verdict）；失效则不写本分支，从对账顶部重读。`recovery_daemon_loss` 事务按序写 `attempt.failed {reason: terminal_missing, lastError, failure: {class: unknown, retryable: true, source: absent}, evidence: runtime_restarted, settlement: {kind: interrupted}}`、有捕获结果时的 `attempt.preserved`，然后调用既有 `settleInterruptedAttempt`；recovery audit helper 添加 taskId / seq。退款、stage 与 attempt.continue effect 同成同败。内核已关闭 dispatch，所以没有 fail、stop、abandon 或 release 调用，也不写 attempt.abandoned、不重新关联 evidence Artifact；action=interrupted。后续 tick 不二次审计或退款。

基线按 seq 逆序访问每个无 Submission 的 Attempt，使用 Task **当前** allowedPaths：

| 保全证据 | 选择 / 审计 |
|---|---|
| preserved、无 secret、每条 scope path 命中当前 scope | `snapshot`；记录 Attempt seq / id、ref / commit / tree、scope paths、baselineSha、Artifact id 与自己的 ending：优先解析既有 attempt.failed（interrupted failure class / failed lastError、reportError，附恢复证据），否则取 attempt.stopped 的 `{kind: stopped, reason}`；停止向前选择 |
| preserved、存在 secret | `notContinued.reason=secret`，即使以后扩大 scope 也不采用 |
| preserved、当前 scope 不包含全部路径 | `notContinued.reason=out_of_scope`，列出 offending paths；以后人工允许该路径可使旧快照可用 |
| empty | `notContinued.reason=empty` |
| unavailable / 非法审计 | `notContinued.reason=unavailable`，保留固定 detail |
| 无保全审计 | 结果形状与旧实现完全一致，不添加空的 notContinued 字段 |

未采用时继续原规则：interrupted / unchanged / no_change / blocked 可越过并找到更早快照；failed / stopped 阻断并回集成基线，并说明未采用原因。没有 attempt.preserved 时输出形状完全不变。snapshot 的 `underlying` 解析被采用 Attempt 自己的基线，递归快照折叠到底层 Candidate / integration；因此连续两次保全修复仍携带原失败 Candidate 及其最新 VerificationRun。`underlying` 不携带它自己那次回溯的 `notContinued`——被采用的 Attempt 当初没有继承什么是它的历史，不是后继的基线；后继上下文对这些更早的 Attempt 只保留原有的跳过说明，不再出现"从集成基线起步"的句子。`skippedAttempts` 与人工调整证据仍保留。

未命中下文原地续时，launcher 复用内核从 commit 创建新工作树。两种放置路径都要求 snapshot baseline 的 HEAD 等于保全 commit，否则 `fix_base_mismatch`；新的 launch.json.baselineSha 即该 commit。`attempt.started` / `attempt.headless_prepared` 的 baseline 记录 `kind=snapshot,strategy=continued,reason=preserved_snapshot,previousSeq,attemptId,commitSha`；未采用时记录 `strategy=not_continued,notContinued=[{seq,attemptId,reason,paths?,detail?}]` 及实际 candidate / integration 基线。retryOf、maxAttempts、普通中断的退款、阶梯、连续三次上限与账号 cooldown 不变；恢复拒绝的 chain / dueAt 例外见下文。

必带 Previous-Attempt failure evidence 段的新内容最多 3 KiB（总段仍 8 KiB）。先保留继承 commit、launch baseline 与精确查看自身差异的命令，再说明所有集成基线上新增工作尚未验证、截断动作可能已生效或仍运行且重复前须确认、先看工作树和历史、先 review 并负责保留 / 修改 / 撤回继承工作。退出路径的 failed 前驱仍说明其自身错误与做法可能有问题；stopped 前驱在必带部分写出 recorded reason，并警示停止前的方向可能错误或卡住、先复核再继承。`runtime_restarted` 明确说启动它的 runtime 重启后该 Attempt 进程已不在；同 runtime 的 `process_exited` 明确说进程结束但没有 exit marker、原因未知，不说它因自身错误而失败。这三种说明先于变长记录，200 条路径与超长记录不能挤掉它们。Artifact 的最近消息 / 命令按新到旧在剩余预算内引用为数据和线索（消息引用其结尾 500 个字符，因为结尾说明上一次做到了哪里）；缺失 / 无法读取 Artifact 只省略记录，变化列表回退到审计 scope paths。底层失败 Candidate 证据随后显示，并注明继承变化可能尚未修复它。未采用的 Attempt 改写为具体原因，out-of-scope 命名路径；没有保全审计的行保持原文。最终 Candidate 仍对集成基线的全部变化独立验证。

限制：停止接口不变，没有新增 grace phase，也不保证 harness 有机会收尾；快照是终端关闭时磁盘留下的状态，可能含半写文件。逃离终端进程树的后代仍可能写入，所以继承者必须 review，最终全量验证仍是边界。内核 `abandoned` 仅上述旧 runtime 的 terminal_missing 无 exit marker 情形保全并按 interrupted 结算；同 runtime 的 terminal_missing、退出路径拒绝的整数 exit marker、Axiom stage=abandoned、内核 `failed`、不确定停止之后的 abandonment 均保持计数且不保全。库存查询失败而没有内核 verdict 的 deferral 仍走容忍期后的 e。daemon 死亡时孩子进程可能继续运行；内核 verdict 仅证明终端丢失，后继新工作树隔开它们，不恢复旧会话。该 abandoned worker 的终端资源仍 owned，不在此释放。TUI、Planner、launch orphan、取消、声明 blocked / no_change、unchanged-Candidate 仍无捕获。对账按 binding 顺序 await 捕获，会延迟本轮后续 Attempt；没有新增 timer / 重试或整体 wall-clock deadline，沿用例程的逐 Git 命令 timeout（显式 30 s，分支检查与验证 diff 的内核只读默认 120 s），加上文件、Artifact IO 与既有 Git admission 等待。保全 ref / commit 永不删除，包括检测到秘密的 commit；除忽略规则与 `.axiom/` 外所有工作树内容都会散列进仓库，没有独立大小上限。秘密扫描与验证一样只看相对集成基线的新增行；超过 200 路径的树仍保全但不续接。记录依赖 Codex 0.163.0 / Claude Code 2.1.312 事件形状，形状变化可退化到无记录。接着做继承的是尚未 review 的工作，可能是半途的错误方向；保全层本身不恢复 session、不收集额外 Worker 笔记，原会话恢复由下面的原地续层决定。

#### Codex in-place continuation / 原地续（M3-06-2c；D88 2026-11-11 修订 ①②④⑤⑥）

`attempt-launcher.ts` 先以原来的 `resolveAttemptBaseline` 选择基线，再由 `attempt-placement.ts` 在创建任何工作树之前调用 `decideInPlaceContinuation`。判定只用于 seq > 1 的 headless Worker，读取绑定、AgentSpec、ContextPackage manifest、宿主审计、捕获的事件文件、内核账号 home resolver 与真实 Git；不读 Worker report 或 rollout 对话，不从内核工作树记录推断当前分支。这样可在 admission / 合同已经确定之后、任何放置副作用之前决定是否复用。首个 Attempt、TUI 与 Planner 保持原路径；其它 headless 后继也记录 `fresh` 的具体原因。判定失败或证据读取异常选择 fresh，原基线选择不变。

`in-place-continuation.ts` 按下列顺序惰性取证，返回首个不满足规则的 reason；前项失败不会读取后项。任一实际执行的 reader 抛错或超时直接返回 `evidence_unreadable`，不是继续尝试后面的规则。

| reason | 宿主记录与判定 |
|---|---|
| `not_interrupted` | N−1 binding / dispatch 缺失，或没有 `attempt.failed.settlement.kind=interrupted`，或有 `attempt.stopped` / Submission。停止、普通失败、已提交结果后的修复均用新会话。 |
| `resume_refused` | N−1 的 `attempt.failed.reason=resume_refused`；不再恢复被拒绝的会话。 |
| `no_exit_evidence` | N−1 的失败既不是 `evidence=exit_code` 且 exitCode 为整数，也不是 `reason=process_exited,evidence=runtime_restarted`。仅 `terminal_missing` 的内核结论不通过。 |
| `snapshot_unusable` | N−1 的 `attempt.preserved` 缺失、非法、Task 不匹配或 result=unavailable；非空 preserved 必须正是当前 baseline 采用的 N−1 snapshot，故原 scope / secret 门继续有效。empty 可继续检查。 |
| `agent_changed` | 当前与 N−1 绑定的 AgentSpec 的 provider、model 或 reasoning.effort 不同。 |
| `capability_unproven` | 本次启动实际探测的 `effective.harnessVersion` 不在该 provider 的 `sessionResume.harnessVersions`。与命令构建共用 binary resolver、与启动组合共用缓存的版本 probe；只要求当前版本命中证据记录。 |
| `account_changed` | 本次 `resolveCodexHomeForWorkerLaunch()` 的 home 与 `readAttemptAccount` 从 N−1 启动审计读取的 home 不同；路径仅临时比较，不复制到新的审计字段。 |
| `contract_changed` | 两份 manifest 的 planRevisionId、mandatory section 名称或顺序不同，或除 `Previous-Attempt failure evidence` 与 `Token budget` 外任一 section 的 sha256 不同。回答 Question / 仓库规则改变也会使合同不同；连续恢复时逐个前驱比较。 |
| `session_unknown` | N−1 的失败审计没有合法 providerSessionId，且其宿主 events.jsonl 前 64 KiB 内也没有合法的首个 thread.started id；id 必须匹配 `^[A-Za-z0-9_-]{1,128}$`。若 N−1 自己是原地续，事件中的 id 还必须等于其启动请求的 id，originSeq 不能晚于 N−1。 |
| `session_record_missing` | 从 origin Attempt 的 `worker_dispatches.created_at` 到现在的本地日期目录中，没有该 id 的 `rollout-*.jsonl` 或 `rollout-*.jsonl.zst` 普通文件。复用 `codex-session-record.ts` 的有界日期遍历与真实路径检查；只看名称 / 元数据，不读 rollout 内容、不递归扫描 home。 |
| `worktree_changed` | N−1 的 launch.json 不可用、worktreeId 与 worker 行或 branch 与 binding 不符、baselineSha 与保全审计不符、目录缺失，或真实 Git 分支 / HEAD / 私有 index 捕获的树不符。preserved 要求旧 HEAD 为快照 parent、树为 snapshot.treeSha；empty 要求 HEAD / 树等于 launch baseline，且当前 `attemptBaselineRef` 仍解析到该 commit。已在 N 分支、目标 commit 和对应树上的同一 Attempt 重放允许继续。 |
| `evidence_unreadable` | reader 异常 / 超时，或所需的 AgentSpec、home、manifest、origin dispatch 时间等不能读取；选择新工作树与新会话。 |

当前只有 Codex 的 capability 记录覆盖 `codex-cli 0.163.0`，证据为 `.axiom-work/verifications/M3-06-2-resume-probe.md` 和 `.axiom-work/verifications/M3-06-2c-resume-refusal-probe.md`。没有会话长度阈值；上下文压缩由 harness 负责。`originSeq` 为 N−1 的序号，若 N−1 已恢复则沿用它的 originSeq；`fromSeq` 始终为 N−1。

通过全部规则后，`in-place-worktree.ts` 以 create-only `update-ref` 在目标 commit 建立 N 的 binding.branch，再以 `symbolic-ref` 把 HEAD 指到该分支，以 `read-tree` 把真实 index 对齐目标树；不改变工作文件。若已在 N 分支且 HEAD 为目标 commit，只执行 index 对齐。最后再次核对分支、HEAD 与 index=HEAD；目标为 preserved commit，empty 则为 N−1 的 launch baseline。N−1 的旧分支和 `refs/axiom/preserved/<taskId>/<seq>` 留在原处。此后直接使用旧 worktree id / path，不调用 createManagedWorktree；原 `prepareWorkerFixLaunch` 的 HEAD 检查、retryOf、caller address 与 dispatch 生命周期继续使用。开始写 ref 后的错误作为普通 launch failure 抛出，不再切换到新工作树兜底。

原地续的 argv 为原 Codex `exec` 参数之后、最后一个 `-` 之前插入 `resume <id>`；`-C` 指向复用的目录，env、`-o`、model 与 effort 参数不变。两份提示各司其职：`<attemptDir>/prompt.md` 是交给 stdin 的短 continuation prompt，按序含 Mission / Task / 新 Attempt 三行身份、继续同一未完任务而不替换原请求、复用的前驱结束说明、同一工作树与新分支 / commit、切断动作可能已生效或仍运行的告诫、先看工作树和 Git 历史、完整合同的位置与优先级、一个 fenced json 最终报告约定；不嵌 Task spec、仓库规则或证据摘录。`<worktree>/.axiom/prompt.md` 仍是带新 Attempt id 的完整当前合同，模糊或压缩后读取，与记忆冲突时以该文件为准。`launch.json.baselineSha` 仍从接管后的 HEAD 读取。fresh 的放置、argv、env、两份完整提示、launch.json 与 combination 沿用原行为。

放置判定在 headless prepare 之前把 `session` 放入 Worker audit：`{strategy:resumed_in_place,id,originSeq,fromSeq}` 或 `{strategy:fresh,reason}`，随 `attempt.headless_prepared`、`attempt.started` 以及判定后的 `attempt.launch_failed` 持久化。首个 Attempt、TUI、Planner 不增加此字段；原 `baseline` 审计保留，session 决定恢复会话和工作树，baseline 决定继承哪个 commit。

退出路径以该 Attempt 自己的启动审计识别原地续。接受整数 exit-code 后，事件流中没有任何 `thread.started` 即 `resume_refused`，与 exitCode 数值、stderr 文本或最后消息无关。`attempt.failed` 写 `reason=resume_refused,evidence=exit_code,exitCode,settlement.kind=interrupted,failure={class:unknown,retryable:true,source:absent}`；照常保全并写 `attempt.preserved`，调用既有 `settleInterruptedAttempt({resumeRefused:true})`。同事务退款、转 READY、写 continuation；dueAt=now，chain 沿用 N−1 的 effect.chain，无该 effect 时为 1，以满足正整数 schema。拒绝不占连续三次、不等待阶梯；Scheduler 的其它 admission 门仍有效。下一 Attempt 的 session 为 `{strategy:fresh,reason:resume_refused}`，按原基线回溯继承可用快照，不在完整提示里增加“恢复曾被拒绝”的任务说明。

所有传播 eventAudit 的恢复运行退出审计（包括 `attempt.submitted`、`attempt.failed`、unchanged-Candidate 失败分支）增加 `sessionContinued` 与 `usageScope:session`。前者比较事件流首个 `thread.started` 的合法 id 与启动请求，未出现或不同则 false；后者说明 usage 为整个会话运行累计值，不计算每 Attempt 差额。再次 usage_limit 时，`sessionOriginStartedAt` 从 originSeq 对应的 worker dispatch.created_at 起查 rollout，跨天恢复也能找到原创建日记录。其它失败分类、保全、退款、常规阶梯和 baseline 规则保持原义。

原地续的限制：

- ref 已写入后接管失败会留下 launch_failed；没有现场回退，该 Task 的后续 Attempt 按普通 launch failure 从集成基线起步。旧快照仍保留为证据。
- 内核工作树记录可能暂时仍报告旧分支；分支身份必须取 binding 和真实 Git。旧 Worker 的 terminal resource 仍可能 owned，在复用目录中累积，本 Task 不释放它们。
- `resume` 与显式 `-m` 的组合尚未做真实 harness 探测；存在但不可读的 rollout 通过名称检查后，只在 harness 拒绝恢复时被发现。
- 当前版本没有 resume 证据时关闭恢复，除审计中的 capability_unproven 外不另提示；升级需补版本证据。Claude 不恢复（DEF-50），TUI、Planner、Windows / WSL 不在本层范围。
- 恢复用量是会话累计值，不能当成本 Attempt 增量；本层不新增 token 预算。已退出 harness 的后代进程可能仍写复用工作树，exit marker 不证明所有后代已退出，仍需先复核与最终独立验证。
- 证据读取不是整体 30 s deadline：事件最多 64 KiB，session 日期遍历检查 30 s 预算，新增 Git 调用使用保全的 30 s timeout；但共用 `withWorktreeSnapshot` 的首个 `assertAttemptBranch` 未传入该 timeout，仍使用内核只读默认 120 s。文件 IO、既有 Git admission 等待和多个命令也不受一个全程时限覆盖。

### Claude channels and invocation pins（M3-08b / M3-08f / M3-08h）

Channel A 的 Claude Worker 使用既有 executable resolver 或单 token `agentCmdOverrides.claude`，argv 为 `-p --output-format stream-json --verbose --permission-mode acceptEdits --permission-prompts none --setting-sources= --settings <attemptDir>/claude-settings.json --managed-settings '<inline JSON>' --strict-mcp-config --mcp-config <attemptDir>/claude-mcp.json --disallowedTools <external-tools> [--model ...] [--effort ...]`。prompt 走同一个 PTY wrapper 的 stdin，不传 max-turns。model/effort 使用 `CLAUDE_SESSION_OPTION_CATALOG`，policy-default 不传 model。协议要求先读 worktree 根 AGENTS.md/CLAUDE.md，且由宿主退出结算，不需要 Worker 调用 axiom CLI。

Attempt 的两个 Claude JSON 文件以 0600 写入。settings 允许文件工具与 Bash，拒绝 WebFetch/WebSearch、额外 Agent/Task、跨 Agent 消息、Computer、worktree 与定时任务等 external-effect 工具；启用 sandbox、failIfUnavailable、autoAllowBashIfSandboxed，关闭 allowUnsandboxedCommands；网络 `allowedDomains: []`、`strictAllowlist: true`、`allowLocalBinding: false`，filesystem.allowWrite 仅 worktree 与 Attempt scratch。`syncClaudeAiSkills`、`syncClaudeAiPlugins` 为 false，`enabledPlugins: {}`，不生成 hooks/env。MCP 文件默认 `{mcpServers:{}}`；非空 allowlist 只从账号 home 的 `.claude.json` 复制选中的 mcpServers，缺项记 `mcp_server_missing:<name>`。不读凭据。

子进程以 `CLAUDE_CONFIG_DIR` 指向账号 home，并将 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_AUTOUPDATER`、`DISABLE_TELEMETRY`、`DISABLE_ERROR_REPORTING`、`DISABLE_BUG_COMMAND`、`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` 固定为 1。requested combination 保存 model/effort、allowlist（skills=[]）、settingSources=[]、synced/bundled skills off、plugins off、MCP strict、policyTier=axiom、launchBaseline 与跨 provider 结果；effective 保存按 binary fingerprint 缓存的 version、账号路径、platform-derived credentials 种类（不读内容）、settings/MCP/managedSettings SHA-256 与 accountHome.surfaces（仅名字与类型）。版本未知和 MCP 缺项仍留 mismatch 证据。

Claude `system/init` 首次到达即幂等追加 `attempt.launch_observed {harnessVersion,model,permissionMode,skills,plugins,mcpServers,apiKeySource}`，不必等退出。按准备时记录的 `requested.launchBaseline` 比较：skills 只在 requested allowlist ∪ baseline skills 之外才记 `skill_unexpected:<name>`；plugins 只有 `path !== 'builtin'` 才记 `plugin_unexpected:<name>`。MCP、permission mode、model 与启动前版本偏差的既有规则保留（`mcp_server_unexpected`、`permission_mode_unexpected`、`model_unexpected`、`harness_version_changed`）。init 版本去掉 `(Claude Code)` 后缀后不同于基线时，追加信息性 `harness_baseline_stale:<version>`；旧组合没有基线时记 `harness_baseline_missing`。这些原因记入 `attempt.launch_mismatch`，不自动改基线，不改变 Task stage；升级须重新验证（D57、DEF-8）。不再扫描 home skills，也不再生成 `skill_missing` / `skill_unreadable`。Claude final report 只取有效 `result.result`，写入 last-message.md；Worker 自写该文件不能替代 result。error_* / is_error 即使退出 0 也失败；认证错误按 D68 interrupted。usage 保存 input_tokens、cache-read → cached_input_tokens、output_tokens，另保留 cache writes、modelUsage、total_cost_usd、num_turns 与去掉 tool_input 的 permission_denials。

Channel B 的 Claude Mission Planner 通过既有 createStructuredWorkerSession 路径运行。Control Plane 在 dispatch/session id 上注册 process-local pins：settingSources=[]、skills=[]、managedSettings 策略对象、0600 planner-settings.json、SDK default（Orca ask）permission mode，无 sandbox。`mcpServers` 只含 Axiom stdio 服务器，`strictMcpConfig: true`；命令为与 structured child 的 `ORCA_CLI_COMMAND` 相同的内核解析出的绝对 CLI launcher，参数 `['attempt', 'mcp', '--mission', missionId, '--attempt', dispatchId]`。解析不到 launcher 时记 `planner.launch_failed {reason:'cli_launcher_unavailable'}` 并拒绝启动。服务器的显式 env 仅携带 runtime 连接与注入的会话身份变量，证据只记键名，不记录值。saved model/effort/settings 不能覆写 Mission pins。

Planner settings 的权限规则固定为：

```json
{
  "allow": [
    "Read",
    "Grep",
    "Glob",
    "LS",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git show:*)",
    "mcp__axiom__plan_propose"
  ],
  "deny": ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"]
}
```

`axiom attempt mcp --mission <id> --attempt <id>` 使用与 Agent SDK 解析版本一致的 `@modelcontextprotocol/sdk` 1.32.1；服务器名为 `axiom`，版本为应用版本，stdio 上只输出 MCP 帧，stdin 关闭即结束。唯一工具 `plan_propose` 的 inputSchema 为 `{ proposal: PlanProposalSchema.omit({provenance:true}) }`，与既有 Planner RPC 相同：provenance 由宿主填写，不要求模型生成；处理器复用 `resolveOrchestrationTerminalHandle` 和 `callOrchestrationMutation`，只调用 `axiom.plan.propose {missionId,planRevision:proposal,attemptId,from}`，宿主仍负责身份、schema、policy 与持久化。成功工具结果是文本 JSON `{ok:true,planRevisionId,status,taskCount,edgeCount}`；失败为 `isError:true`、文本 JSON `{ok:false,error:{code,message,issues?}}`，保留 RPC 的 issues，供模型同回合修正。服务器没有自己的持久状态或第二套 Plan 校验权威。

2026-10-28 的 Claude Code 2.1.312 探测确认，旧 heredoc 的 JSON 花括号触发 Bash 安全分析的 expansion obfuscation 拒绝，发生在 allow 规则匹配前。文件加单行命令虽然可用，仍依赖 Bash 启发式与文件路径规则这两层私有行为；D84 因此采用两家 harness 共同支持的 MCP 与精确工具名权限（证据 `.axiom-work/logs/claude-planner-permission-probe-20261028-210127.txt`、`claude-planner-permission-probe2-20261028-210541.txt`）。

prompt registry 对该 session 的未放行请求返回 denySafeResult，并把 `registration.input` 交给 `denyPermission(toolName,input?)`。`attempt.permission_denied` 带 toolName、固定 summary 与 input 摘要：Bash 只取 command，含 `=` 时整段以固定脱敏标记替代，避免 shell 引号、转义或拼接泄漏环境变量值；文件工具只取 file_path，其余取输入 JSON 并隐藏嵌套环境字段，再经 `redactContext` 脱敏后截断至 200 字符。不记录完整输入、环境变量值或凭据。release/失败清除 pins；进程重启不 resume Mission session，故 registry 无须持久化。普通 Claude 会话不变，Codex Planner 的 permission mode 仍来自用户保存选择，其 MCP 接入在 M3-10。宿主明确不支持 structured create 时沿用内核 terminal fallback；SDK create 错误不会静默降级。M3-08h 的 stub 验证服务器和 pins，Claude 自己的权限匹配仍由合入后的真实 Planner smoke（record / enforce）验证，认证状态不在本任务改动。

M3-08f / D83（2026-10-28）启动 pins 与证据：

| Pin / evidence        | Worker（A）                                                                                                                                                                                                                                                                 | Planner（B）                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Axiom policy tier     | `--managed-settings` 单行内联 JSON，紧跟 `--settings <path>`                                                                                                                                                                                                                | SDK `managedSettings` 对象，由 SDK 序列化为内联 JSON                                             |
| 共同 managed settings | `strictPluginOnlyCustomization`、`disableAllHooks`、`disableSkillShellExecution`、`disableClaudeAiConnectors`、`disableRemoteControl`、`isolatePeerMachines` 均为 true；`permissions.disableBypassPermissionsMode: 'disable'`                                               | 同左；模型不能覆写                                                                               |
| managed sandbox       | `sandbox: { enabled: true }`；原 settings 的 failIfUnavailable / 网络 / 写范围约束保留                                                                                                                                                                                      | 不添加 sandbox                                                                                   |
| 账号 refresh          | 只读 `resolveClaudeHomeForWorkerLaunch`，不调 prepareLaunch                                                                                                                                                                                                                 | 有 Mission pins 时传 `{ refresh: false }`，跳过已准备目录的 refresh；pointer 与 first setup 保留 |
| skills                | `requested.allowlist.skills: []`                                                                                                                                                                                                                                            | `skills: []`，不读取共享 Codex skill allowlist                                                   |
| `launchBaseline`      | certified combo 的可选 `{ harnessVersion, skills, evidence }`，复制到 requested；缺失为 null。Claude 基线 = 2.1.312 / doctor、plugin-authoring / `.axiom-work/verifications/M3-08-smoke-real-claude.md`（隔离探测记录 `M3-08f-isolation-probe.md` 覆盖 2.1.309 与 2.1.312） | —；launchBaseline 是 Worker 组合审计字段                                                         |
| 策略证据              | `requested.policyTier: 'axiom'`、`effective.managedSettingsSha256`                                                                                                                                                                                                          | process-local pins 与宿主 e2e 的 argv / JSON ledger                                              |
| surfaces              | `effective.accountHome.surfaces`：skills、commands、agents、plugins、hooks、settings.json、.claude.json、.mcp.json 的 `{ name, kind }`；kind 为 dir / file / link / absent                                                                                                  | 账号目录原样使用                                                                                 |

surfaces 只用 `lstat`，不读内容、不跟随链接、不列子目录；不是已加载内容清单。Axiom 不布置 Claude 账号 home，不读、复制或移动凭据 / Keychain 项。文件路径形式的 managed settings 在探测版本会被静默忽略，禁止使用。策略层是 M3-08b 空 setting sources 等 pins 的补强；交互启动刷新不变，Claude 仍为 provisional，只有 verifier 真实 smoke 能认证。`--plugin-dir` 的 Axiom skills 交付另立 Task。

### Harness egress environment（M3-08g；D83 ⑥）

On macOS/Linux, headless Codex and Claude Workers and structured Mission Planners receive an Axiom-selected proxy overlay. `execution/harness-egress-env.ts` decides from the kernel's `resolveHostAgentBaseEnvironment(settings)`: the login-shell capture plus the user's shell-environment policy, read with current launch settings. The launcher accepts an injected resolver for tests; it does not use Axiom's raw `process.env` to decide whether the user has a proxy. The kernel never imports Axiom.

- `allowlist`: when none of `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `https_proxy`, `http_proxy`, `all_proxy` is non-empty, all six are set to `http://127.0.0.1:9`. Both `NO_PROXY` and `no_proxy` replace inherited bypass values with the exact comma-separated list below. Non-allowlisted requests that honor these variables hit the dead port and fail with connection refused; their diagnostics remain in the harness output. No proxy process is started.
- `inherited-proxy`: when any of the six variables is non-empty, the overlay is `{}`. Nothing is set or removed, including the user's bypass list. This mode records the decision but does not enforce an allowlist or block anything; upstream-proxy chaining and per-Attempt proxy evidence belong to DEF-46 (V2). Inherited proxy values are never copied into the egress audit.

| Harness | Exact default `NO_PROXY` / `no_proxy`                                     |
| ------- | ------------------------------------------------------------------------- |
| Codex   | `chatgpt.com,.chatgpt.com,openai.com,.openai.com,localhost,127.0.0.1,::1` |
| Claude  | `api.anthropic.com,platform.claude.com,localhost,127.0.0.1,::1`           |

The explicit loopback entries preserve local harness communication; Claude also bypasses loopback for its WebSocket connections. Claude uses the first set proxy in the order `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY`; it ignores `ALL_PROXY`. Setting both spellings avoids a competing inherited casing. `NO_PROXY` suffix matching varies by HTTP client, so these lists require the verifier's real-harness smoke; they are not a general network firewall.

Verifier hooks come only from Axiom's own process environment and apply in `allowlist` mode. `AXIOM_EGRESS_BLACKHOLE_URL` replaces the dead-port URL with a recording endpoint. It must start with `http://127.0.0.1:` or `http://localhost:` and parse as an HTTP URL with that loopback host and no userinfo; invalid values throw without echoing the value. `AXIOM_EGRESS_NO_PROXY`, when defined, replaces both bypass strings verbatim. An empty string sends all proxy-aware non-loopback requests to the recording endpoint, allowing a full egress recording; the default list is then used for a second run proving the non-allowlisted refusals. Used hook names are recorded in `overrides`.

Workers merge the overlay after `CLAUDE_LAUNCH_ENV` or `CODEX_HOME` into the existing `/usr/bin/env` headless wrapper. `attempt.headless_prepared.combination.requested.egress` records `{mode, blackhole, noProxy, overrides}`; `noProxy` is the parsed comma/whitespace-separated list. In inherited mode it is `[]`, `blackhole` is null and `overrides` is `[]`, describing no Axiom-applied pins rather than disclosing the inherited configuration. Structured Planners register frozen process-local session pins and append dispatch-scoped `attempt.egress_pinned` with those fields plus `provider`, `channel: 'structured'`, and actor `MissionController`. Pins are released through the existing session cleanup; a failed audit releases the registration and fails preparation.

Codex's terminal-channel Mission Planner has no per-launch env seam: the existing start-mode decision is unchanged and its dispatch records `attempt.egress_pinned` with `provider: 'codex'`, `channel: 'terminal'`, `mode: 'unpinned-terminal'`, empty lists and null blackhole. The audit uses the kernel's actual receipt mode, including a downgrade from a structured preference; older receipts without a mode fall back to the original decision. It receives no egress pins until M3-10. Ordinary chats are unchanged. Windows/WSL are outside this Task.

This overlay governs the harness process. The separate layer for commands run by Workers remains Claude's `sandbox.network` with an empty allowlist and `strictAllowlist`, and Codex's `sandbox_workspace_write.network_access=false`. E2E ledgers assert the default env and audit, redact inherited proxy URLs, and fail the no-proxy host prerequisite by variable name. Fake-provider tests do not certify real network behavior (D57); the verifier runs Electron and the two recording-proxy smoke passes on the host.

### Recovery（M2-08）

`RecoveryService.recover()` 保留同步 Mission report；独立的 `async reconcileAttempts({missionId?})` 处理 Attempt。每次重新读取 binding、Task stage、worker/dispatch 与执行宿主观测；重叠调用通过进行中的 Promise 等待前一轮后重读持久状态；非权威 cadence 采样见下节 Supervision rules。扫描非终态 Task 的 bindings，加上仍活跃的 kernel worker 对应 binding；CANCELED Task 的已结算资源也重查，补齐 kernel commit 与 release/audit 之间的崩溃窗口。旧 seq 不得结算最新 RUNNING admission。

启动时在 recover 后执行一次，每 60,000ms 执行一次（unref timer，stop 时清除）；消费者成功处理并 ack 含同 Mission bound dispatchId 的 kernel escalation 批次后再触发一轮。正常无变化的 tick 不写 audit。失败只记录身份到 console.warn，其他 Attempt 仍继续对账，报告 action=reconcile_failed，不能当作成功结算。

| 规则                                    | 读取与 kernel 操作                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 审计 / Axiom stage                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a                                       | starting/stopping 的 runtime_epoch 不同于当前 runtime：先 markWorkerStartUnknown / markWorkerStopUnknown，再 inspectWorkerTerminal                                                                                                                                                                                                                                                                                                                                                | 保持 Task；后续按实际宿主 liveness 处置                                                                                                                                                                                                                                                                                                                                  |
| b | RUNNING、worker failed/stopped/abandoned、无 Submission；headless stopped 在事务前保全。另仅对非 Planner headless、自己的 worker=abandoned / stage=terminal_missing、runtime_epoch 不同（含 null）、无可接受整数 exit-code：接受内核结论后在事务外保全 | lost-daemon 分支在 recovery_daemon_loss 中原子写 attempt.failed{reason: terminal_missing,lastError,failure:{class:unknown,retryable:true,source:absent},evidence:runtime_restarted,settlement:{kind:interrupted}}、捕获的 attempt.preserved、退款与等待 effect；action=interrupted，无 kernel 操作、release、attempt.abandoned 或 evidence 重关联。其余仍走 recovery_terminal：failed 补 kernel_failed；stopped 两通道补 kernel_stopped、headless 捕获并按 attempt_stopped 结算；其它 abandoned 按原规则重关联 evidence 并结算，不保全。重复 tick 不追加 |
| c | RUNNING、活跃 worker（stop_unknown 除外）、宿主明确 exited；headless 在事务前保全，然后 failDispatch(workerProcessExited=true, terminationReason=process_exited) | 同事务 attempt.failed{reason: process_exited}、可用捕获的 attempt.preserved 与结算。headless 同 runtime 新增 settlement:{kind: failed}，仍普通失败计数；旧 runtime 保留 evidence:runtime_restarted 与 settlement:{kind: interrupted}、退款和阶梯；TUI 原审计不变 |
| c′（D59；M2-12 attempt 2 修正证明来源） | 仅 terminal fallback / Planner：inspectWorkerTerminal.status=live、exact=true、terminal 非 null（PTY 通道）、worker.state=ready（preamble readiness 已结算），且 confirmTerminalShellForeground(terminal.handle) 返回 true：执行宿主的新鲜前台进程名是 shell（isShellProcess），经 controller.confirmForegroundProcess 读取，方法缺失时回退 getForegroundProcess。每 tick 一次新证明，不缓存、不计数；SSH 返回 null（访问器返回 false）、structured 无 terminal，均不适用         | 对账 entry.liveness 折叠为 exited，沿用 c 的 failDispatch 与重试，attempt.failed{reason: process_exited, evidence: shell_foreground}；last_error 为 Worker agent exited without a Submission。Planner 无提案时同样 fail/release，planner.attempt_failed{reason: no_proposal, evidence: shell_foreground}，沿用该次证明、不重探测，后续 tick 保留该审计                   |
| c″（D84；M3-08h）                       | 仅结构化 Claude Mission Planner：内核在 result 帧结束回合时调用可选 pins.onTurnSettled；缺 result 时由 session_state_changed: idle 后备，每回合一次。Control Plane 事务检查该 dispatch 尚无 planner.proposed 与 planner.attempt_failed，写入失败证据后调用 stopPlanner(..., 'no_proposal')；并发停止合并、相同停止审计去重。若证据持久化后停止前崩溃，60 s reconciliation 对仍 live 的失败 Planner 补 stop/release；若内核已停止但停止审计缺失，则补写去重的 planner.stopped 收据 | planner.attempt_failed{reason:no_proposal,evidence:turn_settled,outcome,isError,numTurns} 与 planner.stopped{reason:no_proposal}；outcome 为 success / failure / cancellation / unknown，numTurns 不可得时为 null。只结算 Attempt，Mission 保持 ANALYZING，原 Attempt 停止后允许再次 axiom.mission.plan                                                                  |
| d | live、未命中 c′、非 stop_unknown：先做下节 stall observe，再执行 timeout 规则；超过 Task spec.budget.maxRuntimeMinutes（无则 policy cap）时原样调用一次 stopLocalWorker(runtime, dispatchId)；headless 仅在 stopped 回执后、事务前保全。Planner 原 policy cap / 30 分钟兜底不变 | 同一 recovery_runtime_budget 事务先写 attempt.supervised{rule: timeout,mode: auto,thresholdMs,thresholdSource: task或policy,elapsedMs,action}；stopped：attempt.stopped{reason: timeout} + 可用捕获的 attempt.preserved + 原 settlement(timeout)；stop_unknown：attempt.stop_unknown{reason: timeout}，保持 RUNNING，不捕获，下 tick 走 e；Planner 为原 planner.stopped |
| e                                       | unverifiable 或 worker stop_unknown：写 liveness facet 的变化；stop_unknown 固定记 `{status: unverifiable, reason: stop_unknown}`；到 unverifiableToleranceMinutes 后先 put evidence，再 abandonWorkerDispatch                                                                                                                                                                                                                                                                    | attempt.unverifiable；超时 attempt.abandoned（含 evidenceArtifactId、disposition）+ settlement(unverifiable_tolerance_exceeded)；等待期间不重复 stop、不启动新 Attempt                                                                                                                                                                                                   |
| f                                       | RUNNING、最新 binding.dispatchId=null；M3-06 pending effect 等待执行，不 orphan；running effect 从 lease 的 updated_at 计时，其他状态 / 无 effect 从 binding.created_at 计时，超过两倍默认 readiness timeout（当前 120,000ms） | attempt.launch_pending_orphan + settlement；等待中的 durable effect 不消耗 Attempt，挂起的执行仍按超时结算 |
| g（D76）                                | 有持久 Submission，距 createdAt 至少 60 s，且 terminal resource.release_state 为 not_requested / retained / requested：先确认该 Submission 的 attempt.transcript_archived 或 attempt.transcript_archive_failed 审计；两者都无则补 transcript Artifact，再经 releaseSubmittedWorker → releaseLocalWorker 补释放。年轻 Submission、released / 无资源不动；E2E hold 时不释放                                                                                                         | attempt.transcript_archived / attempt.transcript_archive_failed；attempt.terminal_released / attempt.terminal_release_failed。Submission 优先于取消和 Mission 终态分支；不改变 Candidate、Task stage 或 VerificationRun                                                                                                                                                  |
| h                                       | Task CANCELED 或 Mission 终态：stop_unknown 无论宿主观测如何均 abandonWorkerDispatch；其他活跃且 live/exact 用 stopLocalWorker（start_unknown 仍可 stop），否则 abandonWorkerDispatch；结算后 releaseLocalWorker                                                                                                                                                                                                                                                                  | attempt.stopped / attempt.abandoned，reason=mission_canceled；从 stop_unknown 放弃时另记 priorStop=stop_unknown 与放弃时折叠的 liveness；after.release 保留 requested completion / retained / already_released 真实收据；stage 不再变；已提交 Attempt 走 g，Candidate/worktree 生命周期不变                                                                              |

M3-06-2b-3 只改变 b 中旧 runtime 的 headless abandoned / terminal_missing 且无可接受 exit marker 的结算。TUI / Planner、同 runtime 的 terminal_missing、有整数 exit marker 的 abandoned、b 的 failed / 其它 abandoned、e（包括 stop_unknown 后放弃与无 kernel verdict 的 deferral）、launch orphan、取消及已有退出声明 / unchanged-Candidate 均沿原路结算而不新增捕获。stopped / terminal_missing（停止请求在先）仍走 kernel_stopped 的保全与计数；重试阶梯、连续三次上限、cooldown 与 maxAttempts 规则本身不变。

基础 liveness 与 `axiom.attempt.show/list` 共用 `foldAttemptLiveness`：live/exited 原样，unattached/missing/identity_changed/unverifiable → unverifiable。c′ 只在 Recovery 折叠额外的执行宿主证明；不改 `inspectWorkerTerminal`、`foldAttemptLiveness`、show/list 或 fleet 投影，不以 title、hook、Agent activity 推断死亡。`starting / start_unknown / stopping / stop_unknown` 与终态 worker 不满足 c′ 的 ready 条件。访问器仅在主进程内读取 controller `confirmForegroundProcess`：daemon 请求经 `Session.confirmForegroundProcess()` 到 `foreground-process-tracker.confirmForegroundProcess`，用 `resolveAgentForegroundProcessWithAvailability(fresh)` 新鲜解析进程表，node-pty 的前台进程名作 fallback；controller 没有该方法时才用 `getForegroundProcess`。结果必须为非空字符串，去除首尾空白与 login-shell 名的前导 `-` 后由 `isShellProcess` 判为 shell；null、非 shell、无 live PTY、无 controller、异常或超过 `PTY_CONTROLLER_LIST_TIMEOUT_MS` 均返回 false，不用旧结果补证明。daemon 的 `confirmShellForeground` 回答 recovery barrier 的 settled owner（alternate-screen dead-TUI recovery），不是进程退出证明；M2-12 attempt 2 明确不再调用它。两次宿主 IO await 结束后重新读取 Task、Mission、worker 的持久权威，Submission / cancel / 新 Attempt 的栅栏仍优先。

agent 退出后到下一次成功 reconcile（≤ 一个 60 s 间隔），`attempt show` 仍可显示 RUNNING / liveness=live。reconciliation 是将其转为 FAILED 并触发 retry 的权威；show/list 的 liveness 仍表示 PTY，shell 未退出时即使 Attempt 已 FAILED 也可继续为 live。starting/stopping 的新 runtime 归一化不代替宿主 liveness。SQLite UTC 时间戳经内核 exposeUtcTimestamp 解析，避免本地时区改变 runtime/orphan deadline。

`attempt_observation_facts` 最新 liveness facet 的 homeReceivedAt 是持久的 unverifiable-since：进入 unverifiable 只写一条；连续 tick 不写；恢复 live 写一条 live，下一次失联重新计时。stop_unknown 的停止结果仍未确认，即使宿主再次 live，也不写 live fact 重置该时钟；runtime-budget stop 的下一 tick 开始按 e 计时。reconcile report 的 liveness 仍保留实际宿主折叠值，stop_unknown 的计时事实与证据明确记录 reason=stop_unknown。证据 JSON 含 taskId/attemptId/seq/branch/worktreeId、workerState/dispatchStatus、liveness/reason、since/abandonedAt/toleranceMinutes 与该 Attempt 的 observationFacts；Artifact kind=evidence、related=[Task,dispatch]。无宿主退出证据时不冷启动同一 Attempt/worktree。

`settleAttemptWithoutSubmission` 在一个 store transaction 中只处理最新且无 Submission 的 RUNNING binding：RUNNING → NEEDS_FIX（原 reason），再按权威 attemptCount < retryPolicy.maxAttempts 转 READY（retry）或 BLOCKED（retry_budget_exhausted，previousStage=NEEDS_FIX）。不增加 attemptCount。M3-04b 的声明结算改走上述 `settleDeclaredAttempt`，始终进入 BLOCKED；恢复不把它改回自动重试。launcher 的 launch_failed 与 Scheduler 的未绑定 launch_rejected 共用普通失败入口；Orca Task failed/blocked 时，launcher 传最新 dispatch 为 retryOf，包含 abandoned/circuit_broken 后的新 Attempt。首次 failDispatch 将 Orca Task 置 ready，kernel 不接受 retryOf，故该重试的 `dispatch_contexts.retry_of_dispatch_id` 为 null；Axiom 重试关系由 `attempt_bindings` 的 seq 顺序及 `attempt.failed → attempt.started{seq:2}` 审计证明。READY 触发既有 stage_change 调度，暂停 Mission 不 admission。

所有拥有 BEGIN IMMEDIATE 的 kernel 操作均在 Axiom transaction 外完成，再写 Axiom consequence；failDispatch 已用可嵌套 savepoint，可与 audit/两次 stage change 同事务。保留/释放遵守内核 disposition，不能强制清理 possibly-live 或 identity_unproven 资源。

`axiom.mission.cancel` 先同步持久化 CANCELED/Task CANCELED，再 await reconciliation；返回 `{mission, attempts?}`，entries 为 `{attemptId,taskId,seq,liveness,action}`。CLI 每 Attempt 输出 action；旧响应省略 attempts 仍兼容。pause 只停止 admission；RUNNING Attempt 继续，cancel/restart 的剩余清理由同一恢复路径处理。

**stop_unknown 的内核边界（M2-08 Attempt 2）**：beginWorkerStop 拒绝第二次 stop，受支持的退出路径是 abandon；这与 verifier 核对的上游 Orca `ce2d60834c` 一致，不需要改内核或增加生命周期边。取消时下一 tick 直接 abandon（无 evidence Artifact），记录 priorStop、放弃时的宿主 liveness 与 release 收据；RUNNING 时无论宿主观测如何，按 e 等待 tolerance 后带 evidence abandon。abandon 只结束执行权威，不宣称进程退出；possibly-live 资源仍由内核保留，通常 release 为 retained / identity_unproven。旧 runtime stranded stopping 归一化后遵守同一规则；同 runtime 正在 stopping 的调用仍拥有结果，恢复不抢占。后续 tick 不重复 attempt.stop_unknown，取消审计重放保留最初的 priorStop/liveness，不因宿主观测变化重复记录。`.axiom-work/reports/M2-08-1.md` 保留为历史证据，其 scope-gap 判断由本规则取代；修复与验证记录见 `.axiom-work/reports/M2-08-2.md`。

M3-01 的 VerificationService 在 Mission recovery 后、首次 kick 前尝试验证队列重驱，逐项失败不阻止启动（见 Verification 节）；既有 60 s reconcile 同时触发 verification.kick，重试未完成的清理。M3-02/04 接检查与失败证据；M4 扩展 Integration/Approval 恢复。D58 的新通道必须保持相同 liveness 语义。

### Supervision rules（M3-06-3 / M3-06-3-2；D88 9–10 及 2026-11-12 修订、D60 / D68 修订）

`attempt-reconciliation.ts` 仍选择分支；只有 live、current、非 Planner、非 stop_unknown 的分支调用 `attempt-supervision.ts`。顺序为 headless stall rule → timeout → headless Task token rule；observe / notify 后继续，任一规则选择 stop 后本轮不再评估后续规则。使用已有 60 秒 reconcile，无新增 timer、模型调用或 DecisionEngine。

- **timeout / auto**：人设的运行上限；仍取 Task `budget.maxRuntimeMinutes ?? policy.budget.maxRuntimeMinutes`，从 binding.createdAt 按同一 `ctx.now()` 时钟计算 elapsedMs，严格超过才停。未设上限则没有此规则或审计。复用原 kernel stop 回执、停止后的 worker 重读、headless 保全与 current fence；失去权威仍从 reconcile 顶部重读。`attempt.supervised` 与 `attempt.stopped` / `attempt.stop_unknown`、可用的 preservation 和 Task 结算同事务，失败全部回滚。`stopped` 仍经 NEEDS_FIX → READY / BLOCKED，消耗当前 Attempt；`stop_unknown` 只记一次规则与停止不确定审计，不保全、不结算，后续仍由原 tolerance 路径处理。TUI 仍执行 timeout，不保全。现有 kernel 接口不提供 wrap-up，直接停止；停止与结算之间崩溃仍由下一轮以 kernel_stopped 结算。
- **stalled / observe**：未设置档位时保持原行为。仅 headless 且 events.jsonl 存在且可取得 mtime 时采样；缺失表示 harness 尚未开始写，其他元数据读取错误也跳过本轮，不妨碍 timeout。`idleMs = max(0, now - mtime)` 严格超过阈值时，每 Attempt + mode 仅写一次 `attempt.supervised {rule: stalled, mode: observe, thresholdMs, thresholdSource, idleMs, lastEventAt, wouldActAt}`，后两者为 ISO 时间，wouldActAt=lastEventAt+thresholdMs。观察只追加审计：不停止、不改 stage / binding / worker / effect，不发消息；恢复输出后再次静默也不重复。

- **stalled / notify**：相同静默条件与 audit fields，仅 mode=notify；每 Attempt + mode 一次，先前 observe 不抑制 notify。不停止、不改 stage、binding、worker、message 或 effect。`axiom.supervision.show` 从该审计投影 `notifications: [{missionId, taskId, seq, attemptId, idleMs, thresholdMs, thresholdSource, lastEventAt, notifiedAt}]`，notifiedAt 为审计时间，按时间 / sequence 从旧到新；只列 Task 的最新、未提交 RUNNING Attempt。给定 missionId 时过滤到该 Mission。恢复输出仍保留，Attempt 不再 current 后项目消失，审计留下；M3-09 渲染该列表。
- **stalled / stop**：先前 observe / notify 不阻止停止。与 timeout 共用 `attempt-supervision-stop.ts` 的 kernel stop → 重读 worker → 仅 stopped 回执捕获 headless 保全 → current fence → settlement 顺序；fence 失败仍从 reconcile 顶部重读。`supervision-stop-settlement.ts` 在 `recovery_stall_stop` 事务写 `attempt.supervised {rule: stalled, mode: stop, thresholdMs, thresholdSource, idleMs, lastEventAt, action}`。stopped 再写 `attempt.stopped {reason: stalled}`、可用的 `attempt.preserved`，经 NEEDS_FIX(stalled) → READY(retry) / BLOCKED(retry_budget_exhausted)，计入 maxAttempts；stop_unknown 只再写 `attempt.stop_unknown {reason: stalled}`，既不保全也不结算，后续不再 stop。事务内任何错误回滚全部审计及 Task 结算。timeout 保留 `recovery_runtime_budget` 事务名与原语义。

**档位与修订**：`supervision_settings` 是每次 open 幂等建表的新 side table，不改 schema version / mission_policies。主键 `(rule, mission_id, revision)`，`mission_id=''` 是全局；每个 scope 只追加修订，最高 revision 是当前值。mode=null 只用于清除 Mission 覆盖，全局不可为空。每条包含 actor、provenance、audit_sequence（写入时全库 audit_events 的最高 sequence；空库 0）及 created_at；下一个 revision 与 watermark 在插入事务内计算。Mission 删除时独立 trigger 清理它的修订，保留全局。有效档位 = 最新 Mission 非空覆盖 → 最新全局 → built-in observe。每次需要 stall rule 的 pass 读取一次，不跨 pass 缓存；设置读取失败只跳过本轮 stall，timeout 照常。

**RPC**：`axiom.supervision.show {missionId?}` 是 read，返回 `{rules, notifications, evidence, proposals}`；唯一 rule=stalled，globalMode 与 globalSource=built_in / user / proposal 总是返回，给定 Mission 才有 missionMode（覆盖或 null）与 effectiveMode。`axiom.supervision.update {rule: stalled, missionId?, mode}` 是带 contract fence / receipt 的 desktop_only mutation，无 CLI 命令；CLI / Agent 不能更改。未知 Mission 报 mission_not_found；全局 null 报 invalid_argument，校验失败不写设置。Mission 更新在同事务追加修订和 `supervision.updated`（actor=user、objectKind=mission、objectId=missionId、payload `{rule,before,after}`）。全局没有 Mission 审计，只在修订记录 actor=user、provenance={kind:user}；直接改变全局档位在同一事务将该规则的 OPEN 提议标为 SUPERSEDED（resolver=user、resolved_at），Mission 覆盖改动不影响全局提议。当前 scope 值未变不写修订或审计（初始全局 observe、缺省 Mission null 也不写）；显式设置与继承相同的 Mission 模式仍建立覆盖。update 返回同 scope 的 show view。

每个 runtime 的 WeakMap 在 live/current headless 有文件时记录首末采样时间、样本数和最大静默。每次 `reconcileAttemptBindings` 结束后检查持久状态；不再是最新、未提交 RUNNING Attempt 或 binding 消失时写一条 `attempt.cadence {maxEventGapMs,samples,resolutionMs,partial}`（两类审计均由 auditAttempt 添加 taskId / seq）。resolutionMs=60_000；首采样距 binding.createdAt 超过两周期则 partial=true。在仍 current 时不写；写失败只记身份日志、保留测量供下轮重试，成功后删除内存项。进程重启丢失采样，不重建；60 秒分辨率会漏掉采样间发生并结束的静默，数据不是精确的逐事件间隔。能写 Attempt 目录的 Worker 可刷新文件伪装活动，runtime limit 仍是后备上限。

阈值由 `supervision-policy.ts` 按 pass 惰性计算至多一次，只有实际采到 live headless 文件时才需要。优先级：① getMainE2EConfig().enabled 时正整数 AXIOM_E2E_STALL_THRESHOLD_MS → source=e2e；② 跨 Mission 按 audit sequence 最新优先、查询结果最多 20 条 qualifying attempt.cadence：partial=false、samples≥2，且 Submission 的 Candidate 有 PASS VerificationRun；至少 5 条时取 max(300_000, 2 × 最大 maxEventGapMs)，source=measured；③ 否则 1_200_000，source=default。资格条件先于 SQL LIMIT，同一 Candidate 多个 PASS run 不重复计数。常量唯一词汇见 GLOSSARY §4.6 Supervision rules。

**budget_exhausted / auto（M3-06-3-3b）**：仅 headless Worker 且 Task 设置 budget.maxTokens。每 pass 先用现有 provider reader 读当前 Attempt，IO 后重查 current / 无 Submission / Codex successor window，再按 metering 的条件写非 final 账本，并取 Task 所有 Attempts 合计。读数状态不影响比较；缺失 rollout 增加零，但此前 Attempts 的已知用量仍计入。达到或超过 cap，经共用 stop → worker 重读 → stopped 才保全 → current fence，在 `recovery_token_stop` 事务内先检查当前未提交 Attempt 的结算权，再写 `attempt.supervised {rule:budget_exhausted,mode:auto,thresholdTokens,usedTokens,thresholdSource:task,action}`、`attempt.stopped {reason:budget_exhausted}`、可用的 `attempt.preserved`，以 actor=RecoveryService 执行 `RUNNING → NEEDS_FIX(budget_exhausted) → BLOCKED(token_budget_exhausted)`，不论还有几次。Attempt 仍计入 maxAttempts、投影 STOPPED，即 D88 的 FAILED budget_exhausted。stop_unknown 只写 supervised 与 stop_unknown，不保全或结算；后续 pass 不重复停止。timeout 保留 recovery_runtime_budget，stall 保留 recovery_stall_stop。

Planner 沿其独立 runtime_budget_exceeded 预算路径；TUI 无 stall、cadence 或 token enforcement。token 计量见下节。

**观察对账（M3-06-3-2b；D88 9(b)、2026-11-12 修订、DEF-35）**：每次 RecoveryService pass 在 flushAttemptCadences 之后调用 stall-reconciliation；按 audit sequence 从旧到新取至多 100 条尚未对账的 stalled observe / notify 观察，stop 与 timeout 观察不参与。每条单独事务重新查重，只有审计写入，没有 Attempt / Task / binding / worker / effect 变更；一条读取或写入失败只记录 observationSequence 并留到下一 pass，其他条目继续。结果按以下优先序判定：

| 事实 | 结果 | endedBy |
|---|---|---|
| 有 Submission，Candidate 任一 run 为 PASS（优先于 FAIL 和非终态） | false_positive | verification_pass |
| 有 Submission，无 PASS，仍有 QUEUED / RUNNING / INCONCLUSIVE / SPECIALIST_REVIEW / HUMAN_REVIEW | pending，不写 | — |
| 有 Submission，无 PASS 和非终态，有 FAIL | hit | verification_fail |
| Candidate 的 runs 全部 CANCELED | inconclusive | canceled_runs |
| Submission 尚无 run | inconclusive | unknown |
| 无 Submission，最新 binding 且 Task RUNNING | pending，不写 | — |
| 无 Submission，attempt.stopped reason=timeout | hit | timeout |
| 无 Submission，attempt.failed settlement.kind=failed / unchanged | hit | failed / unchanged |
| attempt.failed settlement.kind=interrupted | inconclusive | interrupted |
| attempt.failed settlement.kind=no_change / blocked | inconclusive | declared |
| 其它 attempt.stopped（含 stalled、kernel_stopped、mission_canceled） | inconclusive | stopped |
| attempt.abandoned | inconclusive | abandoned |
| 非当前 binding，无上述事实（含 stop_unknown、缺失 settlement） | inconclusive | unknown |

审计 `attempt.supervision_reconciled {rule:stalled, mode, observationSequence, outcome, endedBy, endedAt, savedMs?}` 经 auditAttempt 写在原 Attempt，补 taskId / seq。endedAt 用决定性 ending audit 的时间；验证结果（含 canceled_runs）用 Submission 时间；未知且无 ending audit 时用本 pass 的 now。SQLite UTC 经 exposeUtcTimestamp 转 ISO。仅 hit 写 savedMs=max(0, endedAt−wouldActAt)，展示分钟时除 60,000；不计算 token。已写的结果永久固定，即使之后验证重跑出现 PASS 也不重算。Mission 永不恢复时，其 pending 观察保持 pending。已删除或身份不匹配的 binding 不伪造身份，按单条读取失败保留。

**证据表与提议**：show 的 evidence 数组包含 `{rule:stalled, window, total}`；两者均含 hits / falsePositives / known / inconclusive / hitRate / savedMs / sinceSequence / throughSequence。known=hits+falsePositives，hitRate=hits/known（known=0 时 null），savedMs 只累加 hit。窗口起点是 max(最新全局修订 audit_sequence，最新已解决提议 through_sequence)，都没有时为 0，只计 sequence 严格更高的 reconciliation；total 从 0 起计全部。读取强制走已有 idx_audit_events_event_sequence(event,sequence)，throughSequence 是最高计入序号（空集为 0）。Mission 覆盖不重置窗口。

每 pass 对账结束后，globalMode 非 stop、无 OPEN 提议、window.known≥20 且 hitRate≥0.9 时，事务插入一条 `supervision_proposals`：fromMode 为当前全局档、toMode 是下一档 observe→notify→stop，evidence 为该窗口快照，since/through 为快照边界。数值集中在与 stall policy 相邻的 stall-proposal-policy.ts；唯一部分索引保证每 rule 至多一个 OPEN。提议是全局记录，不随 Mission 删除、不自动过期。show.proposals 返回 OPEN（如有），再按 resolved_at / rowid 降序取最近五条已解决记录，每条为 `{id,rule,fromMode,toMode,status,evidence,sinceSequence,throughSequence,resolver,createdAt,resolvedAt}`。

**人的回答**：`axiom.supervision.resolve {proposalId, resolution:accept|dismiss}` 是 desktop_only mutation，复用 contract fence / receipt，无 CLI 或 Approval 对象。未知 id→invalid_argument；非 OPEN→illegal_transition；accept 时全局 mode 不等于 fromMode→stale_state，三者均不写。accept 在同一事务追加全局 revision（mode=toMode、actor=user、provenance={kind:proposal,proposalId}）并标 ACCEPTED；dismiss 仅标 DISMISSED。两者 resolver=user、resolved_at=当前 UTC，返回 show view；最新修订来自提议时 globalSource=proposal。dismiss 的窗口从该提议快照的 through_sequence 重开，提议打开之后的新结果保留在窗口；accept / 直接全局变更还应用新修订 watermark，所以当时已存在的审计不再计入新窗口。

#### Attempt token metering and enforcement（M3-06-3-3 / M3-06-3-3b；D88 rule 10、2026-11-12 修订 ③）

headless Worker 的 **new tokens** 进入账本；Task `spec.budget.maxTokens` 约束该 Task 所有 Attempts 的合计，policy `budget.maxTokens` 约束 Mission 合计。M3-06-3-3b 的 supervision 执行 Task cap（停止、保全、计入失败并 BLOCKED），admission 执行 Task / Mission cap；桌面 task.adjust 提高 Task cap，启动提示给出剩余量。Planner 不计量，TUI 结束时记录 unavailable 零值且不执行 token 停止。

**Codex**：可信 `attempt.headless_prepared` 的 account home 和 continuation session（否则 events.jsonl 的首个 thread.started）定位当前 thread 的 rollout；搜索从 `sessionOriginStartedAt` 开始，结束 Attempt 的搜索终点为 dispatch.updated_at。每次最多从文件尾读 32 MiB，丢弃被截断的首行，保留刚好对齐的完整首行。只解析 token_count 的 timestamp 与 info.total_token_usage / last_token_usage 白名单；在文件顺序上复用纯函数 normalizeRawUsage / resolveCodexUsageDelta，按 buildCodexUsageEventKey 去重。此前记录只建立 baseline；计量窗口为当前 dispatch.created_at（含）至下一 binding 恢复相同 thread 的 dispatch.created_at（不含，无同 thread 后继则无此上界）。读取期间若 current 状态或后继窗口身份变化，本轮不落账，下轮重读。newTokens 为各增量 `max(0, input − cached_input) + output` 之和；cache writes 已包含在 input 中，另存 input / cached input / cache writes / output / reasoning。reasoning 已在 output 中，不再相加。

**Claude**：从本 Attempt 的 events.jsonl 开头最多读 64 MiB，只取 assistant.message.id / usage 的数字字段；同 message id 的每个字段取最大值，包括带 parent_tool_use_id 的子 Agent 消息。newTokens = input_tokens + cache_creation_input_tokens + output_tokens；cachedInputTokens = cache_read_input_tokens，cacheWriteTokens = cache_creation_input_tokens，reasoningTokens = 0。result.usage 不参与计量。退出审计的 usage 不改：它仍是 harness 自己的报告，Codex turn.completed.usage 为 thread 累计值，continuation 的 usageScope=session 也保留。

**完整性**：无 account / thread / rollout、缺失或不可读文件为 unavailable；Codex 截尾且窗口可能早于第一条读到的记录，或窗口内 token_count 的 info 非 null 但无可用 last_token_usage，为 partial；Claude 达到截断上限或 usage 行损坏为 partial；其它为 complete，完整的零值有效。读取器不抛出文件错误，不返回或记录原文、路径、thread id、账号 / 限额信息；仅白名单计数和状态进入账本。rate-limit-only info=null 直接跳过，即使位于窗口内也不使读数 partial。

**账本与 pass**：`attempt_token_usage` 主键 dispatch_id，保存 mission_id / task_id / seq / provider、六个 token 计数、status、final、measured_at。upsert 只允许插入或更新 final=0；final 行永久固定。覆盖时六个计数分别取 stored/read 的较大值；任一读数降低，或 reading unavailable 且旧行任一计数非零，status 改为 partial，避免丢失已记录用量。此规则在 store 的 upsert 执行，监督写入、pass 更新与 finalization 一致；final unavailable 不会把此前数字定稿成零。既有 60 秒 reconcile 在 reconcileStallObservations 后调用一次 metering，无新 timer。先处理最新、RUNNING、无 Submission 且有 dispatch id 的非 Planner binding：有 new tokens 才首次插入，已有非 final 行仅在计数或状态改变时更新。再按 dispatch 创建时间从旧到新处理最多 20 个非 current、未 final 的 Worker Attempts（current 不占配额），读一次后以 final=1 写入，包括 unavailable 零值。每条失败只记录 Mission / Task / Attempt ids 并留待下轮，扫描失败不阻断其它可处理项。该步只写账本，不写审计、Attempt / Task / binding / worker / effect。

**只读视图**：`axiom.mission.usage {missionId, taskId?}`（caller class=read，无 CLI、无 mutation receipt）返回 `{missionId, limit, used, tasks:[{taskId, limit, used, attempts:[{attemptId, seq, provider, newTokens, inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, status, final, measuredAt}]}]}`。Mission limit 取 policy，Task limit 只取本 Task，未设为 null。Task 顺序为 listTaskStages，Attempt 按 seq；used 包含 final 与非 final 行。taskId 仅缩小 tasks，Mission used 始终为全部 Task 之和。未知 Mission 报 mission_not_found，未知或其它 Mission 的 Task 报 task_not_found；读取不落账。

限制：每 pass 重读至上述上限，不保存 offset；Claude events.jsonl 在 worktree 外，但可写该位置的 Worker 仍能修改它；Codex 子 Agent thread 不计入。partial / unavailable 不伪装成零成本的完整证据；执行 cap 使用已知合计，不以 status 为豁免。60 秒 pass 分辨率允许一次 pass 用量的超支；设了 Task cap 的运行 Attempt 每 pass 读两遍（supervision + metering）。Mission 只阻止新准入，不停止正在跑的 Attempts。AgentSpec 未设 Task cap 时仍显示 policy cap 的 fallback（未改的缺口）；Planner 不计量。endingLine 保留原措辞，将 token-stopped 轨迹称为 suspect。

## 5. 合成 session party 与 Run 绑定（D14）

每个 Mission 铸造独立 `axiom-mission-<uuid v4>`，满足 `isOrcaSessionId`，不以 `term_` / `structworker_` 开头；持久化到 `missions.coordinator_orca_session_id`。`createRun` 参数为 `coordinatorHandle:null`、`coordinatorPaneKey:null`、该 session id。Mission 的 Run mailbox 为 `run:<runId>`。

这是进程内 Control Plane 身份，不是真实终端或 provider 会话；不能让终端声明该身份。重启复用持久绑定，绝不重新 `createRun`：同 session id 重建会解绑旧 Run、提升 `consumer_generation` 并驱逐旧消费者。`{kind:'system'}` 是 M2 dispatch creator 的内部权限，与合成 session party 的 Run 绑定是两个层次（Architecture §20 M1 行的 system principal 简写按 D14 理解）。

M1-01 契约证据见 `kernel-contract/*.test.ts` 与 [D14 spike](../review-evidence/axiom-m1/D14-session-party-spike.md)。M2-01 已在 `src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts` 增加 service-only `controlPlane?: ControlPlaneWorkerStart`（类型在同目录 `control-plane-worker-start.ts`），首个实际调用者为 M2-05 `execution/attempt-launcher.ts`：六个 seam 字段的用法为 `dispatchCreator: {kind:'system'}`、精确的预创建 `worktreeId`、`branchNameOverride` 在此 bag 中省略（只传给预创建 worktree service）、ContextPackage 的 `preambleBuilder`、`dispatchMaxDepth: 1` 与 `callerIdentity`。同时填 `params.from = caller.address`，把同一合成身份作为 `coordinator` 和 `callerSession`，并传 Mission Task 为 `existingTask`。预创建 worktree 仅允许省略 `params.worktree` 或设为 `current`；branch / 所有权校验由 launcher 负责；深度 cap 取 runtime 与服务入参的较小值，preamble 在 cap 1 时不提示 sub-workers；null terminal handle 不作终端 lineage。省略 bag 保持原行为，文本替换沿用原有投递、turn observation 和失败路径。字段不进入 RPC schema，`workers.ts` 不传 bag，M1-07 对 Mission Run 的直接 `orchestration.workerStart` 拒绝保持不变（D10）；不得通过 RPC 参数自报 `caller:'control_plane'`。

## 6. RPC、envelope 与错误

M2-09 增加 mutation `axiom.mission.plan {missionId}`，响应 `{attempt:{attemptId:string|null,seq,branch,worktreeId:string|null,provider}}`；CLI 成功文本为 `Planner started: attempt <id> on <branch>`。`axiom.plan.propose` 的两个互斥形式为 `{missionId,planRevision,provenance}`（既有人工作法）或 `{missionId,planRevision,attemptId,from?}`（Planner）。后者由 CLI 的 `--attempt` 指明 Attempt，调用方身份由宿主核实（D73），from 复用 Worker terminal/session 解析，仍使用既有契约版本与 mutation receipts。传入 attemptId 时不得自报 provenance。`plan_pending` / `illegal_transition` 继续由原 proposal settlement 返回。Planner 的 `planner_worktree_dirty` / `planner_worktree_missing` 与既有 `no_eligible_provider` 经共享 mapper 的 structured runtime passthrough 保留 code/data，不走 `invalid_argument` 的 computer-use recovery 分支。Attempt 1 的映射阻塞已在 Attempt 2 修复，验证见 `.axiom-work/reports/M2-09-2.md`；旧报告保留为历史记录。

M1 已注册 `axiom.mission.create/show/list/start/pause/resume/cancel`、`axiom.goal.propose/activate/show`、`axiom.plan.propose/approve/reject/list/show`、`axiom.task.list/show/cancel`；M2-02 已注册 `axiom.artifact.put/read/list`（put 参与 mutation fence/收据）；M2-05 已注册只读 `axiom.attempt.show {attemptId}` / `list {missionId, taskId?}`；返回 `attempt` / `attempts`（Glossary §4.6），未知 dispatch 返回 `attempt_not_found`，CLI 为 `axiom attempt show/list`。M0 的 `axiom.namespace.get` 保留。M2 的 policy、Worker verbs、message、task.create 与 mission.plan 已注册；M3-04b 增加桌面专用 mutation `axiom.task.adjust`（详见本节对应段）；未注册方法在映射 §4c 明确标为后续。

`AXIOM_MUTATION_METHODS` → `isOrchestrationMutation` 同时接入契约栅栏与 durable mutation 收据。mutation envelope 必须带 `orchestrationContractVersion:1`，缺失/不匹配会被 `orchestration_migration_required` 拒绝；不要把版本字段放进 params。调用方按约定必须带 `orchestrationRequestId`；内核收到该字段时，以 caller fingerprint + id 查 `mutation_receipts`：同 payload 回放，异 payload 拒绝 `request_mismatch`。当前内核无 request id 时直接执行，不提供去重，调用方不得依赖它自动补幂等。

CLI `src/cli/runtime/client.ts` 为 `axiom.*` 打版本戳，为 durable mutation 默认生成 request id，`--retry-request` 沿用原 id；`axiom-client.ts` 为 renderer mutation 生成 id，不确定重试复用 id 与原 payload。Worker 身份在 M2 接入（D73 之后由宿主核实，不再随 envelope 携带 capability），M1 CLI user commands 不冒充 Worker。runtime 公布 `axiom.control-plane.v1` capability。

CLI JSON 输出是 `{ ok, result, ... }` / `{ ok:false, error:{code,...}, ... }`；单对象 result 用 `mission` / `goalRevision` / `planRevision` / `task`，列表用 `missions` / `planRevisions` / `tasks`。M2-10 的唯一 `MissionSummary` 形状包含 `runId`；可选 `reason` 来自该 Mission 最新一条 `mission.status` 且 `after.status === mission.status` 的审计的 `after.reason`，缺失时省略。所有 Mission RPC（含 mutation 响应）共用 `missionSummary(mission, store)`。TaskListItem 的 `id` 是 Orca Task id，不是提案 id。

### Terminal fallback Worker channel（M2-06a/b，D9 / D11 / D16）

已注册五个 mutation：`axiom.attempt.inform` / `request` / `blocked` / `handoff` / `request-subtask`。参数为 `{attemptId, from, senderPaneKey?, summary, body?, artifactIds?, related?, subtask?, blocked?}`；只有 `request-subtask` 接受且必须带 `subtask`；只有 `blocked` 接受可选的严格 `blocked: {reason, paths}`，reason 为 `blocked_by_scope | candidate_already_correct | cannot_reproduce`，paths 默认 []、最多 50 条 trim 后非空字符串。严格 schema 不接受 `to`、自报 `type` 或 Mission/Task 身份，消息载荷也拒绝在其它 type 下带 blocked。summary 与可选 body 各 ≤ 2,000 字符；较长内容先 `axiom mission artifact put`，再引用 Artifact id。MessageRouter 在持久化前脱敏 summary、body、blocked.paths，以及报告项的 question.text / options 与 followUp.text。`artifactIds` / `related.artifactId` 必须属于同 Mission，显式 `related.taskIds` 必须属于同 Mission，否则 `invalid_argument`，不写消息或审计。

`execution/attempt-authority.ts` 在写入前按以下顺序校验（含 ask 的七动词共用）：

1. dispatch 不存在 → `unknown_dispatch`；没有 `attempt_bindings` → `unknown_dispatch`。
2. dispatch 非 `dispatched` → `inactive_dispatch`。
3. 同 Task 存在更高 seq（包括尚未绑定 dispatch 的 admission）→ `stale_dispatch`。
4. 调用方身份由宿主核实（D73，取代 dispatch capability，上游已删除）：由 runtime 与 `orchestrationCallerIdentity` 解析调用方；有宿主核实的会话调用方时按其 Orca session 对照 Dispatch 的 assignee，否则先过 lifecycle caller fence（另一编排方的终端被拒），再按上游 `workerReportRefusal` 校验 Dispatch 与进程代次（→ `dispatch_inactive` / `worker_identity_changed`）；Dispatch 未记录进程代次时调用方必须是该 Dispatch 的消息发送方。已结算 Attempt 只允许同一 pane、同一进程代次重放自己的 Submission。
5. 内核 `hasLifecycleAuthority` 失败 → `sender_not_assignee`。
6. binding、Task、Mission、Run 关联不一致 → `task_dispatch_mismatch`。

CLI `axiom attempt <verb> --attempt <id> --summary <text>` 支持 `--body` / `--body-file`（互斥）、可重复 `--artifact` / `--related-task`；子任务另需 `--title --objective --allowed-path` 及至少一个 criterion，risk 默认 low。可重复 `--acceptance <text>` 与 `--evidence <command>` 按各自出现顺序配对：第 i 个 command 证明第 i 个 text；多余 command 追加 `Command passes: …` criterion；无 command 的 text 为 human。可重复 `--acceptance-artifact <text>` 追加 artifact criterion。`--evidence` 只是 CLI 输入兼容标志，发送对象不含 requiredEvidence。可重复 `--depends-on` 对应 subtask.dependsOn。from 复用 `resolveOrchestrationTerminalHandle`（`--from` / `ORCA_TERMINAL_HANDLE`），pane metadata 来自 `ORCA_PANE_KEY`；runtime 自行解析 pane，不信任该参数授予权限。调用方身份由宿主核实（D73：终端 / 会话 → Dispatch → 进程代次，见 orca-mapping 的 Worker 身份一节），mutation 复用 `callOrchestrationMutation` 与 `--retry-request <原 UUID>`。失败的新请求不留收据；已完成请求沿用内核回放语义，同 id + 同 params 不重复写入，改变 params → `request_mismatch`。

M3-04b：`axiom attempt blocked --attempt <id> --summary <text> [--reason blocked_by_scope|candidate_already_correct|cannot_reproduce] [--path <path>]... [--json]` 将 reason / 可重复 path 映射到 blocked；只给 path、不带 reason 会拒绝。不带 reason/path 时保持旧的普通 BLOCKED 报告。terminal Worker 可能仍在运行，发信不转换 Task 或 Attempt；typed payload 仅增加 pending 投影，退出结算仍由宿主负责。

`axiom.attempt.check {attemptId, from, senderPaneKey?, wait?, timeoutMs?, type?}` 是 read，不进 mutation 集合；鉴权后调用 `checkWorkerMailbox` 读取 `dispatch:<attemptId>`。type 是内核路由类型（可逗号分隔），保留 delivery replay、generation fence 与长轮询。CLI 为等待显式加 10 秒 transport grace；不新增 ack 参数，返回内核 deliveryId 等证据。

`axiom.message.list {missionId, type?, taskId?, attemptId?, pendingOnly?}` 是 read，按 messages.sequence 从旧到新返回 `{messages:[{id,type,taskId,attemptId,summary,artifactIds,related,subtask?,blocked?,followUp?,createdAt,pending,question?,options?,answer?,status?}]}`。读取 Mission Run 的严格 Axiom 载荷（包括投递副本），跳过普通/非法载荷。`QUESTION` 可带严格 `question: {text, options}`（text ≤2,000，options 默认 []、最多 8 条且每条 ≤200），其它 type 不得带它；`REQUEST` 可带严格 `followUp: {text}`（≤2,000），其它 type 不得带它；无这些可选字段的旧 mail 照常加载。typed QUESTION 投影到既有 question / options / answer / status 字段，status 为 pending / answered，answer 仅从 `question.answered.after.answer` 读取。

pending 只从同 Mission、`objectKind: message`、`objectId: messageId` 的审计派生：REQUEST_SUBTASK → `subtask.resolved`，带 blocked 的 BLOCKED → `blocked.resolved`，带 question 的 QUESTION → `question.answered`，带 followUp 的 REQUEST → `followup.resolved`；尚无对应审计即 pending，不增表、列或生命周期。普通 BLOCKED / REQUEST / QUESTION 保持非 pending。内核 question_threads 仍由 `question-projection.ts` 读取 question / options / answer_body / status，仅 status=pending 时 pending；它不需要 payload.axiom。

CLI：`axiom message list --mission <id> [--type <T>] [--pending-only] [--json]`（`--pending` 兼容别名）。文本输出 typed question 为 `QUESTION pending|answered <text>`，已答追加 `→ <answer>`；follow-up 为 `REQUEST pending|resolved follow-up: <text>`，均保留消息 id；pending BLOCKED 仍列 reason 与 paths。人工 answer / resolve 的参数与 desktop_only 分类不变；处置卡片留给 M3-09。

M2 之后：M3 复用 typed channel 投递验证证据；D58 的执行通道不能绕过身份 / 进程代次栅栏（D73）。

### Submission settlement（M2-07 / M3-08，D2 / D4 / D11 / D16）

headless 的 submitted（含省略 outcome）宿主入口与下述 terminal fallback CLI 入口复用 caller-independent `settleSubmission` transaction；声明 no_change / blocked 走 §4 的独立声明结算。CLI 仍执行原调用方身份检查，host 使用当前 dispatch/binding 检查。下面的 CLI 命令与普通索引快照描述用于 terminal fallback。

`axiom.attempt.submit` 已注册为 mutation，参数 `{attemptId, from, senderPaneKey?, report}`，Task/Mission 从 binding 解析，不能由 Worker 自报；响应 `{submission, candidate, duplicate}`。报告严格要求 summary（≤4,000）、filesChanged、checksRun（command/result=pass|fail|skipped、可选 durationMs/note）、artifacts、limitations、risks；questions / followUps 缺省为 []，各最多 20 条、每条 2,000 字符，拒绝超限或多余字段。headless 继承相同上限，Worker preamble 的 JSON Schema 显示 maxItems / maxLength。每个 Artifact 必须属于同 Mission，且 related 包含 Task 或 Attempt；Artifact 内容先独立上传，本事务只保存引用，不复制内容。

```sh
axiom mission artifact put --attempt <attemptId> --mission <missionId> --kind worker_report --file REPORT.md --related <taskId> --json
axiom attempt submit --attempt <attemptId> --report <path.json> --json
```

实现位于 `execution/candidate-snapshot.ts` / `attempt-submission.ts` 与 `db/{candidates,submissions,verification-runs}-store.ts`，步骤对照映射 §5：

| 步骤                              | 当前实现与写入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · 栅栏/收据                     | 复用 AXIOM_MUTATION_METHODS、OrchestrationMutationExecutor；`--retry-request` 原载荷回放，变更载荷 request_mismatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2 · 鉴权/报告                     | resolveAttemptSender 校验 dispatch、binding、seq、宿主核实的身份与进程代次（D73）、assignee、Mission/Run；zod 与 Artifact 归属在 Git 前校验                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3 · 快照                          | 从 worker_dispatches.worktree_id 用 splitWorktreeIdForFilesystem 取路径；先验当前 branch，再 status --porcelain；dirty → add -A + Control Plane identity commit --no-verify（两次写操作均以临时空 core.hooksPath 禁用全部 hooks），clean → 采用 HEAD；读 commit/tree 后再验 branch                                                                                                                                                                                                                                                                                                                                   |
| 4 · 结算事务                      | runLifecycleWriteTransaction('axiom_submit')：Candidate ACTIVE、旧 ACTIVE SUPERSEDED、不可变 Submission、报告 QUESTION / follow-up items（见下）、artifact_git facet；settleWorkerReportInTransaction(succeeded)，rejected → 抛原 code 回滚；无 Axiom Submission 的内核 duplicate 也拒绝                                                                                                                                                                                                                                                                                                                                                                      |
| 5 · 同事务后续                    | actor=AttemptSettlement 推 RUNNING → SUBMITTED；VerificationRun QUEUED；candidate.superseded / attempt.submitted；事务内任何异常回滚整笔                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6 · 提交后存档、消息与释放（D76） | 同事务的 verification.enqueue effect 在提交后独立唤醒验证；提交函数继续 archiveAttemptTranscript → MessageRouter 的 SUBMISSION 邮件 / submit receipt → 2,000 ms unref release timer。存档用 Orca 只读 captureWorkerOutputArchive，逐字符串 redactContext，记录提交时进程名；Artifact 完成后才发信。MessageRouter 直接 db.insertMessage(type=worker_done, payload.axiom.type=SUBMISSION)，不经 send/reconcileLifecycleMessage；router 保存 receipt，再 notifyMessageArrived。计时器调用 releaseSubmittedWorker → releaseLocalWorker，内核重验身份、保留自身输出并关闭 agent 终端，daemon descendant sweep 结束进程树；不调用 stopLocalWorker，不改变已结算状态 |
| 7 · 重复                          | 同 dispatch 返回原 Submission/Candidate、duplicate=true，不再 Git/结算/入队/存档/安排释放；同 Attempt 的并发请求复用既有 keyed queue 串行化；重启后靠 DB UNIQUE 与收据，内存队列不保存权威状态                                                                                                                                                                                                                                                                                                                                                                                                                       |

结算之后，重复 submit 仅允许读取既有 Submission：只接受同一 pane、同一进程代次的调用方（D73），并校验最新 binding 与 hasLifecycleAuthority，不恢复任何权限；其他 pane 或进程代次 → `worker_identity_changed`。不同请求丢失了提交后的消息时，可用认证后的重复 submit 补写一条；已有消息不重复插入。Git 在事务外，事务失败可能留下快照 commit；重试采用 clean HEAD，禁止 reset/clean/checkout 撤销证据。

M3-04b-3：`execution/submission-items.ts` 在 `axiom_submit` 内紧随 insertSubmission，用 Submission 的宿主 sender 路由 questions 的前 10 条为 typed QUESTION、followUps 的前 10 条为带 followUp 的 REQUEST；summary 与 typed text 均脱敏，related=`{taskIds:[taskId],submissionId}`。任何一步失败整笔回滚；重复 Submission 不再产生 items。每类超过 10 的省略数合记一次 `submission.items_truncated.after={questions,followUps}`（objectKind=submission），完整有效报告仍保留。新输入执行 caps；历史 Submission 的持久化读取与 Attempt response 保留原先无 caps 的兼容 schema，不回填消息。空列表不路由；CLI 与 headless submitExit 共用该入口。消息只写给 Mission Run，延迟到提交后的 SUBMISSION publisher 统一唤醒，事务失败不发通知。headless 声明 no_change / blocked 不经过 settleSubmission，因此不生成这些 items，其问题保留在 BLOCKED 项引用的报告 Artifact。

Candidate id 为 `cand_` + sha256(taskId + ':' + commit)。M3-02 / DEF-21 ⑥ 在 `axiom_submit` 事务内、insertCandidate 之前比较该 Task 上一 Attempt 的 ACTIVE Candidate：treeSha 相同即 `invalid_argument: candidate_unchanged`（即使 commit 不同），不写 Candidate / Submission / VerificationRun，终端通道的 Attempt 保持 RUNNING，可以修改后再提交（DEF-21 ⑥ 由 D85 收窄到 live Worker）。headless 已退出时由 `attempt-exit-submission.ts` 同一 `headless_exit_unchanged` 事务重新核实宿主权限、failDispatch、写 `attempt.failed {reason: process_exited, evidence: exit_code, exitCode: 0, settlement: {kind: unchanged}, candidate, reportArtifactId, reportSummary, limitations}`，经原 retry policy 转 `NEEDS_FIX → READY(retry)` 或 `BLOCKED(retry_budget_exhausted)` 并安排释放；不重新提交相同 Candidate、不直接第二次启动 Worker，下一次 admission 仍归 Scheduler。首个 Candidate 不受此限制；新树正常接受并 supersede 旧候选。数据库的 Task/commit 唯一键仍拒绝其它重复身份（candidate_exists），不得把旧 Candidate 改绑。环境修复后的同一 Candidate 重跑使用 M3-05 的显式 rerun 路径（仍须满足其 Task / Candidate / run 前置条件）。候选快照只允许在绑定的 `axiom/attempt/<taskId>/<seq>` 分支，不前进集成基线/目标分支。通用 stage API 对非 AttemptSettlement 的 RUNNING → SUBMITTED 返回 illegal_transition（reason=submission_required）。

**Attempt 2 addendum（2026-10-19；D76 于 2026-10-24 取代 retention）**：终端资源维护仍在结算事务之外。提交后先存 redacted transcript Artifact，再持久化邮件 / receipt，约 2 秒后经 Orca 释放终端；不再 retain。存档或释放失败只记固定 reason 的审计，不回滚 Submission/Candidate/stage/VerificationRun、不阻止已结算提交回执。崩溃丢失计时器由 RecoveryService 对至少 60 秒的 Submission 补做（见 Recovery g），缺两种存档审计时先补存档；终端已消失时捕获可能失败，失败仍审计。重复 submit 不再执行这些副作用。

`execution/attempt-transcript.ts` 保存一个 `kind=log`、`mediaType=application/json`、`createdBy=AttemptSettlement` 的 Artifact，`related=[taskId,attemptId,submissionId]`。内容为 `{type:'attempt_transcript',version:1,missionId,taskId,attemptId,submissionId,capturedAt,source,status,processesAtSubmission,content}`；身份内嵌，避免内容去重误用另一个 Attempt 的关联。source 为 `structured_journal / transcript_pin / terminal_tail`，status 为 `captured / empty`；content 的对象/数组递归逐字符串脱敏，保留 JSON 结构。总字节数超过 MAX_ARTIFACT_BYTES 时仅将 content 改为 `{omitted:'too_large'}`。

进程证据为 `{count,names}`：只在本地 POSIX live foreground evidence 下从 PTY shellPid 遍历新鲜进程表后代，剔除 zombie，仅保留可执行文件 basename（不含参数）；names 排序、去重、最多 50 项，count 仍是后代进程总数。其它情况存固定原因的 `{unverifiable}`，包括远程/WSL host、Windows、无证据与读取失败；它不构成拒收或权限判断。capture 由 Orca 限界（structured journal、provider 最近消息或 terminal tail），不是完整历史；SSH provider transcript 不可读时回退终端尾部。

`axiom attempt show` 的可选 `submission.transcriptArtifactId` 引用该 Submission 最新的 AttemptSettlement log Artifact，文本输出显示 `Transcript: <id>`；旧响应不带该字段仍有效。终端释放后 `workspace: released`，它是终端资源投影，不代表删除 Candidate worktree。E2E 模式下才读取 `AXIOM_E2E_HOLD_WORKER_RELEASE=1`，同时禁止 timer 与恢复释放，初次提交的存档照常；withFixtureMission 默认设置，`releaseTerminals:true` 省略，专门的 `mission-worker-release.spec.ts` 打开释放。

Submission 的 summary 仍完整保存（≤4,000）；SUBMISSION 邮件沿用 MessageSummarySchema 的 2,000 字符上限，超长取前 1,999 字符加 `…`。共享 MessageRelatedSchema 增加可选 submissionId；publisher 在不可变 id 生成后写入 `related: {submissionId}`，Artifact ids 不混入 Submission id。消息丢失后的重复提交也使用原 Submission 的摘要、Artifact 和 id。Attempt 1 的例外请求与红测是历史证据；当前实现与回归结果见 `.axiom-work/reports/M2-07-2.md`，已有宿主结果见 `.axiom-work/verifications/M2-07-2.md`。

M2-07 宿主 spec 为 `tests/e2e/mission-attempt-submit.spec.ts`（需要 AXIOM_FIXTURE_REPO），D49 provider 解析既有 Artifact 配方取得 Mission/Task id；先记录 preamble ledger，再跑冻结 retry/attempt-1/succeed stub；在 REPORT.md 副本尾部追加 Mission/Task/Attempt 归属后上传、submit。冻结 stub 的报告内容原本完全相同，归属附记防止内容去重命中另一 Task 的 related 元数据；不改变 fixture patch 或场景。设置 ORCA_E2E_CLI_ENTRY 的 fixture helper 启用该后半段；旧 launch spec 不设置它，仍测试 RUNNING 与重启，原有断言不放宽。M2-11 仅对新 exit flow 设置一次性 crash marker；已有两条 spec 的宿主通过记录见 `.axiom-work/verifications/M2-10-1.md`，本次仍需回归。

M3-06 在结算事务内写 `verification.enqueue` effect，提交后执行器唤醒验证；拒绝/重复提交不新增 effect；M3-02 在同一 drain 执行检查、记录 verdict；M4 才集成/释放 Candidate worktree；D76 的 Worker 终端释放独立进行。D49 提交不构成真实 provider 认证。

### Verification（M3-01 / M3-02 / M3-03 / M3-03b）

`verification/verification-service.ts` 是确定性的独立消费者；不启动模型、不采信 Worker 的 checksRun。`kick(missionId?)` 在整个 Control Plane 内合并为一个串行 drain；Mission 参数是触发提示，队列从 DB 读取，直到没有可领取的 run。唤醒入口：`verification.enqueue` 执行器（Submission 与 rerun 同事务入 outbox）、启动恢复完成后、既有 60 s Attempt reconcile closure。`verification_runs(QUEUED)` 仍是唯一验证工作队列，outbox 只持久化唤醒请求。

`store.transaction('verification_claim', …)` 按 created_at/id 读取最老 QUEUED：Candidate ACTIVE 且 Task SUBMITTED 时，CAS `UPDATE … WHERE id=? AND status='QUEUED'` 的 changes 必须为 1，然后写 runtimeEpoch、claimCount+1、startedAt、`{phase:'claimed',claim}`；同事务由 MissionController 推 `SUBMITTED → VERIFYING`，写 `verification.claimed`。CAS 失败不写 stage/audit。SUPERSEDED Candidate、Candidate 行缺失或 stage 不符的 QUEUED run 变 CANCELED（reason=candidate_superseded/candidate_missing/task_stage_changed）并写 `verification.canceled`，继续领取后续 run；缺失 Candidate 不抛异常堵住队列。续跑例外：phase=requeued/reason=restart、claimCount>0 的重启 run，或 claimCount=0 且有匹配 run / Task / Candidate 的 `verification.rerun_requested` 审计的新 run，可以继续已 VERIFYING 的 Task，不回退或重复推进 Task stage。审计经 schema 校验，不接受仅由任意 QUEUED 行推断的重验授权。

准备在事务外执行：从 Candidate 的 Attempt binding.branch 创建 `axiom/verify/<runId>/<claimCount>`，name=`verify-<taskId>-<claimCount>`。只调用 runtime.createManagedWorktree，路径由 runtime 决定；runHooks=false、setupDecision=skip、awaitTerminalProvisioning=false、observeSetupCompletion=false、activate=false，lineage.noParent=true，orchestrationContext 记录 Mission 的 Orca runId 与 taskId（D64 2026-10-20 修订）。返回后立即持久化 worktree_id，再以 gitOptionsForWorktree/splitWorktreeIdForFilesystem 在该 worktree checkout --detach Candidate.commitSha、branch -f 同一验证分支到该 commit；校验 HEAD、HEAD^{tree}、分支 ref 与 detached 状态。checkout 禁用仓库 hooks。绝不修改 Attempt worktree，不 reset/clean。

成功保持 RUNNING，verdictDetail 为 `{phase:'prepared',claim,worktreeId,candidateCommitSha,candidateTreeSha,baseline:{branch},evidenceArtifactIds}`；内容寻址 Artifact kind=evidence、mediaType=application/json、createdBy=VerificationService、related=[runId,taskId,candidateId] 保存准备事实、runtimeEpoch 和时间戳，再事务写 `verification.prepared`。baseline.branch 是 Attempt 分支名，不能当作 M3-03 diff 的基线 commit。准备失败先回收已创建的 worktree，再 INCONCLUSIVE/finishedAt，`phase=prepare_failed`、reason=candidate_missing/candidate_mismatch/worktree_unavailable、脱敏 detail 与 `verification.inconclusive`，随后同事务进入 HUMAN_REVIEW 并写 `verification.escalated`（human）；Task 仍 VERIFYING。回收失败保留 worktree_id/cleanupPending，后续 kick 与下一启动重试，不能把删除失败伪装成已回收。

每个 plane 的 runtimeEpoch=`epoch_<UUID>`。`startAxiomControlPlane` 在同步 Mission recovery 后 await `verification.recoverAtBoot()`，之后才 kick；即使 recovery 拒绝也仅 console.warn，继续安装 reconcile timer、同步消费者并调度 resume，保留 bootGeneration 的停止/重启栅栏。旧 epoch 的 RUNNING run（新进程中的所有 RUNNING）先 removeManagedWorktree(`id:<recordedId>`,{force:true})，只容忍明确的 already-gone，再 CAS 为 QUEUED，清空 worktree_id/runtime_epoch，写 `{phase:'requeued',reason:'restart',previousClaim}` 与 `verification.requeued`；历史 Artifact/audit 保留。

恢复逐项隔离失败：worktree 删除失败的 run 保持原 status、runtimeEpoch 与 worktree_id，保留原 phase 数据并设 cleanupPending=true；同一 boot generation 每个 run 只写一次 `verification.recovery_failed {worktreeId,reason:'worktree_removal_failed'}`，不记录原始 Git/runtime 输出。只有审计去重集合在进程内，重试资格与 worktree 归属均由 DB 决定。每次 kick 在 drain QUEUED 前经带 status 索引的查询重试旧 epoch RUNNING，以及 cleanupPending 的 PASS / FAIL / INCONCLUSIVE / SPECIALIST_REVIEW / HUMAN_REVIEW / CANCELED；后者成功只清空 worktree_id/cleanupPending，不重排队或改变 verdict。既有 60 s tick 因而可修复临时删除失败，无需重启。`recoverVerifications` 返回 `{requeued,cleaned,failed}`（重排队 run 数、清理的已结算/orphan worktree 数、失败项数），有失败时记录计数警告，其他项继续。

仅启动时通过 runtime.listManagedWorktrees 回收 `axiom/verify/` 分支孤立条目（不用文件系统扫描，不强制删除未记录的 orphan）。创建到记录 id 之间的崩溃由该扫描覆盖；detached 之前已记录 id。单个 orphan 删除失败只警告并继续；关联已知 run 时写同一 recovery_failed 审计，不将旧 claim 的 orphan 标记为当前 worktree 的 cleanupPending。已在本轮按持久 id 处理的 worktree 不重复扫；本 epoch 正在运行的 worktree 不被回收。成功恢复后再次执行不写新审计。

读入口 `axiom.verification.show {runId}` / `list {missionId,taskId?,candidateId?,status?}` 返回全部 VerificationRun 字段加 Candidate commit/tree 与 `phase=verdictDetail.phase??null`，缺失 run 或 Candidate 返回 not_found，不伪造 hash。CLI 对应 `axiom verification show --run` / `list --mission [--task] [--candidate] [--status]`，均支持 --json。list 文本增加 reason；HUMAN_REVIEW 行另列原 escalation（specialist 表示策略要求，V1 实际仍交人）。

phase 词汇为 `claimed | prepared | checking | verdict | prepare_failed | requeued | canceled`，不是新的状态机。M3-02 消费 RUNNING/prepared 并运行/记录 deterministic checks 与 verdict、结束时回收 worktree；M3-05 将 INCONCLUSIVE 同事务升级为 HUMAN_REVIEW；M3-09 根据 lineage 过滤 renderer worktree 列表（本阶段仍可见）。

**M3-02：确定性检查与结算（D65 / D68 验证侧）**

`verification-rules.ts` 的严格 schema 用于 `axiom.policy.update.patch.verificationRules` 的写入校验，以及运行器读策略；未知键（含旧占位键 commands）或类型错误拒绝写入，RPC 返回 invalid_argument。patch 替换整份 verificationRules，不是深合并。PolicySchema 的存储契约仍为 JSON record，旧行仍可加载；运行器遇到不符合 schema 的旧值直接 INCONCLUSIVE(policy_invalid)、escalation=human，不执行命令。ContextBuilder 用 safeParse 读取同一存储值，非法时仍可构建 ContextPackage，并以固定行 `Verification rules are invalid (policy_invalid); the independent verifier will escalate to a human.` 代替命令列表。CLI 为 `axiom mission policy update --mission <id> --verification-rules-file <json>`，沿用 envelope、收据与 policy.updated 审计。

| 策略键                | 默认值 / 含义                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| repositoryGates       | `{}`；low / medium / high 的可选命令数组                                                                                                                                                            |
| timeBudgetMinutes     | 30，正整数；一次运行共用的 deadline                                                                                                                                                                 |
| inconclusiveRouting   | specialist；可选 human                                                                                                                                                                              |
| nonCodeTasks          | human_confirm；可选 artifact_only                                                                                                                                                                   |
| dangerousPathPatterns | M3-03 下列 27 个危险路径模式；policy 显式设置时整体替换默认列表                                                                                                                                     |
| testPathPatterns      | `**/*.test.*`、`**/*.spec.*`、`**/__tests__/**`、`**/test_*.py`、`**/*_test.py`、`**/*_test.go`；policy 显式设置时整体替换（包括空列表）                                                            |
| secretPatterns        | `[]`；非空 JavaScript 正则源码，无 flags；只追加，编译失败拒绝（invalid_argument）                                                                                                                  |
| evidenceCommands      | `{allowedPrograms: [pnpm, npm, npx, yarn, bun, node, pytest, python, python3, go, cargo, make, dotnet, mvn, gradle, ./gradlew]}`；用户 setup / gate 程序并入允许集；只约束模型命令形状与程序（D85） |
| planInvalidPatterns   | `ERR_PNPM_NO_SCRIPT`、`Missing script:`、`No test files found`、`error: unknown command`、`Unknown command`；非空 JavaScript regex、无 flags，非法 regex 拒绝；policy 可整体替换（D85）             |
| setupCommands         | `[]`                                                                                                                                                                                                |
| retryOnce             | 常见测试前缀：pnpm / npm / yarn / bun 的 test、run test；npx vitest、vitest、npx jest、jest、pytest、python -m pytest、go test、cargo test                                                          |
| knownFlaky            | `[]`；人工维护的失败名模式，只有 `*` 是通配符                                                                                                                                                       |

策略中的命令去首尾空白且不得为空。`resolveVerificationPlan(taskSpec, rules)` 同时供 ContextBuilder 和运行器使用：setupCommands 原顺序（不去重），接着 `resolveAcceptance` / `acceptanceCommands` 解析并去重后的 criterion commands，最后追加 task.risk 对应的 repositoryGates（去掉已经列出的命令）。每项为 `{source,command,criteria}`，source=setup/evidence/gate；evidence step 的 criteria 列出共用该命令的全部 criterion indexes，setup / gate 为 `[]`。legacy 命令仍去首尾空白、跳过空项并保留顺序，旧行的命令计划不变。Worker 的 `Required verification commands` 节继续列出同一计划。Worker 的 checksRun 从不参与验证判定；报告声称全绿也不能抵消实际失败。

运行后 `verification-acceptance.ts` 逐条生成 `verdictDetail.acceptance[]`：`{index,text,check,result,checkIndexes,artifactIds}`，result 为 pass / fail / inconclusive / skipped / human。command 采用关联 step 的结果，environmental / plan_invalid 为 inconclusive；artifact 要求至少一个符合种类且有效的提交引用，以 artifactIds 指向证明；human 永远记录 human。文本和命令在持久化验证证据前脱敏。没有 command check 的 Task 继续走 M3-03b 非代码路径；artifact criterion 的确定性通过不自动让该路径 PASS。

`verification-checks.ts` 在 prepare 成功后、同一全局串行 drain 中先写 phase=checking，再在 `splitWorktreeIdForFilesystem(worktreeId).worktreePath` 执行。只支持本地 repository；connectionId 非空或 executionHostId 非 local 的 repository 在建 worktree 之前交给运行器，得到 INCONCLUSIVE(environment)、detail=remote_repository_unsupported、escalation=human。进程选项沿用 automation precheck：shell=true、cwd、process.env、POSIX detached、windowsHide；超时和 shutdown 都复用其 killLocalPrecheckProcessTree，不新增 tree-kill。POSIX 停止时保留 helper 的延迟 SIGKILL，并等它执行后才允许回收。

deadline 从检查阶段开始（prepare 不计入），每条命令只得到剩余时间。退出 0=pass；ENOENT/EACCES、退出 127/9009=environmental(tool_missing)；deadline kill=environmental(timeout)；非本方发送的 signal=environmental(killed)；其它非零=fail；其它 spawn 错误=environmental(spawn_failed)。deadline 已过而尚未启动的命令=skipped(time_budget_exhausted)。setup 第一条非 pass 的已执行命令归 environmental(setup_failed)，余下 setup/evidence/gate 全部 skipped(setup_failed)。evidence/gate 的 fail 不短路后续检查。

retryOnce 对命令与前缀规范化空白，只允许相等、前缀后接空格或冒号；`pnpm run test:unit` 命中，fixture 的 `pnpm run verify:full` 不命中。匹配的 fail 在同一 worktree 最多重跑一次；两个 Attempt 的日志均保留，第二次 pass 使该 check 为 inconclusive(flaky)，第二次 fail 保持 fail。重试环境失败或预算耗尽不抹除第一次 deterministic fail。仍为 fail 且抽取出的失败名非空、全部匹配 knownFlaky（并无环境失败的重试）时变 inconclusive(known_flaky)，结算事务写一次 `verification.known_flaky {checkIndex, failures}`；系统不增加隔离名单。

| Gate / Check（按优先顺序）                                                                          | Verdict / reason                                                          | escalation / Task                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| diff 新增行含密钥                                                                                   | FAIL / secret_detected                                                    | VERIFYING → NEEDS_FIX → READY 或 BLOCKED                                   |
| diff 存在越界路径                                                                                   | FAIL / scope_violation                                                    | 同上；即使所有命令 pass                                                    |
| 任一 check fail 或 command criterion fail                                                           | FAIL / checks_failed                                                      | 同上；优先于 diff INCONCLUSIVE                                             |
| artifact criterion 无匹配引用 / 匹配引用均无效，或非代码 Task 无引用 / 引用为空、UTF-8 或 JSON 无效 | FAIL / artifact_missing 或 artifact_invalid                               | NEEDS_FIX → READY / BLOCKED；checks_failed 仍优先                          |
| diff 不可得，或非代码 Artifact 不可读                                                               | INCONCLUSIVE / environment，detail 为固定 diff 错因或 artifact_unreadable | human；保持 VERIFYING；两者同时出现时保留 diff 错因                        |
| patch 超过扫描上限                                                                                  | INCONCLUSIVE / diff_too_large                                             | human；保持 VERIFYING                                                      |
| 内容型篡改发现                                                                                      | INCONCLUSIVE / test_tampering                                             | human；保持 VERIFYING                                                      |
| 危险路径未被 scope 明确命名                                                                         | INCONCLUSIVE / dangerous_change                                           | human；保持 VERIFYING                                                      |
| 无以上，任一 environmental                                                                          | INCONCLUSIVE / environment                                                | human；保持 VERIFYING                                                      |
| 无以上，evidence check 为 inconclusive / plan_invalid                                               | INCONCLUSIVE / plan_invalid                                               | human；detail 为命令，保持 VERIFYING，不进入修复 Attempt（D85）            |
| 无以上，任一 inconclusive                                                                           | INCONCLUSIVE / flaky（有 flaky 时）或 known_flaky                         | inconclusiveRouting；保持 VERIFYING                                        |
| 无以上，check / criterion 仍有 skipped，或 criterion 缺检查结果                                     | INCONCLUSIVE / environment                                                | human；未执行不能算通过                                                    |
| 无以上，非代码 Task（不取决于仓库门禁是否通过或有无命令）                                           | INCONCLUSIVE / non_code                                                   | human_confirm → human，artifact_only → inconclusiveRouting；保持 VERIFYING |
| 无以上，代码 Task 的确定性 criteria 全 pass，仍有 human criterion                                   | INCONCLUSIVE / acceptance_human，detail 为 human criterion 数量           | human；保持 VERIFYING，不 admission 修复 Attempt                           |
| 无以上，全部确定性 criteria / checks pass，gate clear 且无 human criterion                          | PASS / checks_passed                                                      | VERIFYING → VERIFIED                                                       |

D85：retryOnce / knownFlaky 处理之后，仍为 fail 的 evidence step 的所有执行尝试 stdout + stderr（完整已捕获输出，不只摘录）若匹配任一 planInvalidPatterns，则改为 inconclusive / plan_invalid。setup / gate 不适用；其它确定性 fail 优先，plan_invalid 优先于 flaky / known_flaky。verdict Artifact、verdictDetail 和 verification.inconclusive 审计通过既有路径带 reason、escalation=human 与 detail=<command>；Task 留在 VERIFYING，等待人工处置。

每个 verdict 的事务都带 id、expectedStatus=RUNNING、expectedRuntimeEpoch、expectedClaimCount，且要求 Task 仍 VERIFYING、Candidate 仍是该 Task 的 ACTIVE Candidate。CAS 丢失不写 verdict / stage / audit，仍回收本次 worktree。PASS 的 stage actor=VerificationService、reason=verification_passed，审计 verification.passed。FAIL 经 execution/attempt-settlement.ts 的 settleVerificationFailure，同事务先 NEEDS_FIX(verification_failed)，再按 attemptCount < retryPolicy.maxAttempts 进入 READY(retry) 或 BLOCKED(retry_budget_exhausted)，审计 verification.failed {failures}。INCONCLUSIVE 先结算 run 与 verification.inconclusive {verdict,reason,escalation,detail,acceptance}，再以 expectedStatus=INCONCLUSIVE（不加 epoch / claim fence）推进 HUMAN_REVIEW，写 verification.escalated {to:HUMAN_REVIEW,reason,escalation,routing}；routing=human，或策略请求 specialist 时为 specialist_unavailable（DEF-40）。两步在同一 verification_verdict 事务，Task 保持 VERIFYING，原 verdictDetail 不变；V1 不进入 SPECIALIST_REVIEW。updateVerificationRun 根据术语表 §4.8 的完整转换表拒绝非法变化，FAIL/PASS/CANCELED 终态不可再改判；无 status 的元数据更新仍合法。

证据先写、后回收 worktree：每条执行（含重跑与版本探针）的 stdout/stderr 各为 text/plain、kind=log Artifact，先脱敏再持久化；每流上限 MAX_ARTIFACT_BYTES（8 MiB），超限保留最前 1 MiB 与最新尾部，中间一行 `[axiom: <n> bytes omitted]`，记录 truncated 与原始字节数。失败名支持 Vitest `FAIL <file> > <name>`（可带 project 列）、Jest `● <suite> › <name>`（使用前面的 FAIL 文件头）和 fixture 的 deterministic reporter `<test-file> > <test fullName>: <message>`（在首个 `>` 后的首个 `: ` 处截断），每项最多 20 个、每名最多 300 字符。未知格式不猜测。失败/环境/不确定 check 的摘录围绕 FAIL、×、✗、Error、AssertionError、ERR_、failed、not found；无标记取末尾，单项 ≤40 行 / 4 KiB，总计 ≤32 KiB；摘录脱敏。

verdict 文档为单个 application/json、kind=evidence Artifact，createdBy=VerificationService、related=[runId,taskId,candidateId]。包含 verdict/reason/escalation、acceptance[]、checks（index/source/command/criteria/result/reason、exitCode/signal/durationMs、attempts、failures/excerpt、stdoutArtifactId/stderrArtifactId、truncated、每流原始字节数与截断标记）、工具探针记录、toolVersions、deadline 与时间戳。版本命令 node/pnpm/git --version 在检查之后运行，每个最多 10 秒且仍在同一预算内；缺失或未能取得版本记 unavailable，不影响 verdict。resolved commands 与 toolVersions 写到既有列；verdictDetail 存 phase=verdict、verdict/reason/escalation、acceptance[]、verdictArtifactId、保留 prepare 证据的 evidenceArtifactIds，以及 check 的 index/source/command/criteria/result/reason/exitCode/durationMs/failures 摘要。`verification.passed/failed/inconclusive` 审计同样带逐条 acceptance 结果。日志和摘录不放 SQLite；verification show 因而能列出失败测试。重复内容沿用 ArtifactStore 的内容去重；verdict 文档的引用固定本次运行的关联。

回收失败保留 worktreeId 与 cleanupPending=true；周期恢复现覆盖 PASS、FAIL、INCONCLUSIVE、两类 review 与 CANCELED 的待清理行，清理只更新元数据，不改变 verdict；人工 resolve / rerun 若在异步删除期间完成，清理保留其 resolution / rerun 与当前终态，仍校验 epoch / claim。shutdown 中 VerificationService.stop 中止运行中的进程树、停止 drain；RUNNING 保留，下一 boot 回收并重新 QUEUED。同一 plane 的 stop/start 也先等待旧 drain 退出，再换 epoch 恢复。E2E 唯一 hold seam：getMainE2EConfig().enabled 且 AXIOM_E2E_HOLD_VERIFICATION=1 时停在 prepared；非 E2E 模式不读取此变量。withFixtureMission 默认设置 hold，runVerification=true 时省略；新的 mission-verification.spec.ts 用 per-Task scenario marker 驱动三个冻结场景，并在批准的测试计划设 maxAttempts=1，阻止后续 Attempt 抢跑断言。

### Task 页的验证记录读取（M3-09-2）

`src/shared/axiom-contract/verdict-record.ts` 提供 `VerdictRecordSchema` 与 `readVerdictRecord`，以同一个宽容读取器解析 run 的 `verdictDetail` 摘要及证据 Artifact 的 JSON：phase、原始 verdict/reason、逐条 checks（Artifact 中有 excerpt 时保留）、acceptance、diff、resolution/rerun 和证据引用。未知键忽略；缺失或畸形的字段省略、列表回退为空，单个坏条目不遮住其它条目，读取函数不抛异常。acceptance、resolution 与 rerun 复用已有共享 schema。它不改主进程写入器、存储行或 RPC；`verification/verdict-record.test.ts` 通过真实验证路径同时检查行与 Artifact，防止读写形状漂移。

Task 页将 run.status 作为状态及其颜色的权威，同时单独标出检查的原始 verdict/reason 与人工处置，绝不以人工 PASS 改写原始逐条结果。runs 与 Task usage 在选择或刷新时和其它详情一起读取，失败仅落在各自区块，仍受原 generation guard 约束。选中的 run 和展开的摘录仅为组件本地状态；每次展开都经 `axiomClient.readArtifact` 重新读取 verdict Artifact，用浏览器 API 解码后交同一读取器，原样作为文本展示，不打开 stdout/stderr log Artifact。Task 页的 VERIFIED/INTEGRATED 仅在已读的最新 run 为 PASS 时显示成功色，并一键选择该 run、聚焦验证区。集成树回归记录仍属 M4。

M3-09-2b-1：读取器返回已知的 `resolution.disposition`；遇到未知值只丢该字段，保留其余有效的 resolution。旧记录没有该字段仍可读取，严格写入 schema 不放宽。界面显示和操作属于 M3-09-2b-2。

### 人工验证处置与同候选重验（M3-05；D82 / D85 / DEF-21 ④）

所有 INCONCLUSIVE 都按上节进入 HUMAN_REVIEW，包括准备失败；不启动 Reviewer、Decision Engine 或自动答复。`axiom.verification.show / list` 保留原判定和 acceptance，status 表示当前处置状态。人可通过 `axiom verification list --mission <id> --status HUMAN_REVIEW` 查看待审项。

`axiom.verification.resolve` 是 desktop_only mutation，严格参数 `{runId,verdict:'PASS'|'FAIL',rationale,criteria?:number[],disposition?:VerificationDisposition}`；rationale trim 后非空、最多 4,000 字符，criteria 默认 []、最多 50 个非负整数，使用该 run `verdictDetail.acceptance[].index` 的零基索引。disposition 的四个值和适用规则以 `docs/GLOSSARY.md` §4.8 为准（D82、M3-09-2b-1）。`verification_resolve` 事务要求 run 为 HUMAN_REVIEW；PASS / FAIL 返回 `illegal_transition {runId,from,to,reason:'deterministic_verdict_final'}`，其它状态为 `run_not_pending`。Task 必须 VERIFYING，Candidate 必须 ACTIVE 且 Task / Mission 归属一致，否则 stale_state。`redactContext(rationale).redacted` 返回 `invalid_argument / secret_in_rationale`；不存在的 criterion 返回 invalid_argument；这些拒绝不写任何状态、审计或收据。

上述检查之后、首次写入之前，`resolveVerification` 调用共享的 `allowedVerificationDispositions(verdict, run.verdictDetail.reason)`，不另列原因清单。FAIL 省略 disposition 时规范化为 fixed；所给值不在允许清单中为 `invalid_argument / disposition_mismatch`。PASS 在清单非空时省略为 `invalid_argument / disposition_required`，清单为空却给了值为 `invalid_argument / disposition_not_applicable`。三种拒绝都在同一事务中、不写 run、stage、audit 或 receipt；原有检查顺序不变。

通过 `updateVerificationRun` 的合法转换和 expectedStatus=HUMAN_REVIEW 写入新 status，以及 `verdictDetail.resolution={verdict,rationale,criteria,disposition?,by:'user',at}`；原始 verdict / reason / acceptance 不变。PASS 由 `transitionTaskStage` 推 VERIFYING → VERIFIED（actor=user，reason=verification_resolved）；FAIL 由 `settleVerificationFailure(actor=user)` 推 NEEDS_FIX，再沿原规则 READY 或 BLOCKED(retry_budget_exhausted)。人判 FAIL 与确定性 FAIL 使用相同 maxAttempts 额度，不退款、不另计一个 Attempt。`auditVerification` 写 `verification.resolved.after={verdict,rationale,criteria,disposition?,taskId,candidateId,by:'user'}`；两处使用同一规范化的 disposition，不适用时均省略该键。收据 `{runId,status}` 不变，在同一事务提交，重复请求只回放。旧记录无需迁移；带 fixed 的 FAIL resolution 仍经严格 `VerificationResolutionSchema` 为下一 Attempt 生成原样的人工失败提示。

计划写错时，人先用 `axiom.task.adjust.acceptanceCriteria` 全量替换，再调用 desktop_only `axiom.verification.rerun {taskId,rationale}`。`verification_rerun` 只接受 Task VERIFYING 且其 ACTIVE Candidate 最新 run 为 HUMAN_REVIEW，或 Task BLOCKED 且有 ACTIVE Candidate（candidate_disputed / retry_budget_exhausted 等）；有 QUEUED / RUNNING 验证时拒绝并行重验。其它状态或无 ACTIVE Candidate 返回 `illegal_transition {taskId,from,reason:'task_not_rerunnable'}`；rationale 使用相同长度与 secret_in_rationale 检查。

若最新 run 为 HUMAN_REVIEW，以 expectedStatus 将其 CANCELED，并追加 `verdictDetail.rerun={rationale,by:'user',at}`；已有 PASS / FAIL 不作任何修改。为相同 Candidate 新建 `vrun_<uuid>` 的 QUEUED run，初始 verdictDetail / toolVersions 为 {}、commands 为 []、verifier=VerificationService；BLOCKED 由 stage 权威转 VERIFYING（actor=user，reason=rerun_requested）。`verification.rerun_requested {taskId,candidateId,previousRunId,newRunId,rationale}` 绑定新 run；收据 `{runId:newRunId,status:'QUEUED'}` 与 `verification.enqueue` effect 同事务持久化，提交后由执行器 kick，既有 claimNext 领取。没有新 Candidate、binding 或 Attempt；重验从不可变候选重新准备验证 worktree，执行完整 setup / criteria / repository gates，而非仅改过的 criterion。旧 run / verdict / evidence 留存。

CLI：`axiom verification resolve --run <id> --verdict PASS|FAIL --rationale <text> [--criterion <n>]...`；`axiom verification rerun --task <id> --rationale <text>`，均支持 `--retry-request <id>` 与 `--json`。D78 不变：真实人工 mutation 必须来自 desktop；CLI 参数入口不能替 Worker / local-cli 授予人类权限。人可在没有额外证明的 acceptance_human 上判 PASS，这是 V1 的人工处置；Task VERIFIED 仍不等于已集成或 Mission 完成。后续 Attempt 的引用上下文见 ContextPackage 节。

**M3-03：候选 diff 检查（G2）**

D64 的 2026-10-24 批准修订采用三点 diff。验证 worktree 检出不可变 Candidate 后、写 phase=checking 后、执行任何 setup / evidence / repository gate 命令前，先解析 `refs/heads/axiom/integration/<missionId>^{commit}` 为集成基线 SHA，再计算 `git merge-base <baseSha> <candidateCommitSha>`，比较 merge-base 到 Candidate。后续 Git 调用只用 SHA；修复 Attempt 合入新集成基线后，已集成的其他 Task 文件不再算该候选的 scope 改动。上一 Candidate 仅用于修复证据展示，不作 scope 基线。

所有 Git 调用经 git runner 与 `gitOptionsForWorktree`。两个 diff 共用 `--no-color --no-ext-diff --no-textconv --no-renames --ignore-submodules=none`：重命名视作删除加新增，因此越界源路径不能躲在新路径后面；即使仓库配置 `diff.ignoreSubmodules=all`，也必须列出 submodule 的 gitlink 改动。先用 `--name-status -z` 读取 status/path 对（包括删除、二进制、空文件和 mode 变更），再流式读取 `--submodule=short -U0` patch。patch 的 `diff --git ` sections 按次序绑定 name-status 条目：普通条目占一个 section，类型变更 `T`（例如文件替换为 symlink）占连续两个 section（删除后创建），两者都归该路径；预期 section 总数为条目数加 `T` 条目数，其余数量不符即 diff_unavailable。不解析可能被 Git 引号转义的 header 路径。每个 section 独立从首个 `@@` 开始扫描以 `+` 开头的新增行与以 `-` 开头的删除行（去掉一个前缀，同一路径的新增 / 删除行分别以换行连接为 addedText / removedText；hunk 前的 `---` / `+++` header 不作为内容）；二进制 section 无 hunk，只记录 binary。

patch 默认最多 32 MiB；超限停止子进程，保留路径清单，丢弃全部新增与删除文本（两个 Map 均为空），patchComplete=false，不以部分扫描证明安全。集成 ref 读取失败记 integration_base_unavailable，无公共祖先记 merge_base_unavailable，其余 Git / 解析失败记 diff_unavailable。失败证据保留已解析的分支、SHA、merge-base，不保存或记录原始 Git 输出。

`scope.allowedPaths`、dangerousPathPatterns 与 testPathPatterns 共用 path-patterns.ts：归一化前为空字符串的条目无效；其余条目将反斜杠转 `/`、合并重复 `/`、去前导 `./` 与尾 `/`，`./` 与 `.` 仍归一为 `.`。绝对路径（含 Windows drive）或任何 `..` 段也无效、不授权，无效 scope 原条目记 ignoredScopeEntries。条目覆盖匹配的完整路径及其所有后代；`*` / `?` 只匹配段内任意字符 / 单个 Unicode 码点，独立的 `**` 段可匹配零到多段；`.` 覆盖整个仓库。区分大小写、点文件不特殊，括号等其余字符都是字面量（例如 `app/[id]/page.tsx`）。实现对段索引做 memoisation 并合并连续 `**`；段内使用双索引通配匹配器，只重试最近一个 `*`，不编译正则表达式，避免多个星号的组合回溯。

“明确命名”的确定性规则：一个有效 allowedPaths 条目 e 同时覆盖改动路径，并且 e 自身作为字面路径也匹配该危险模式。对默认清单，`.`、`src/`、`**` 不够；`package.json`、`**/package.json`、`src/storage/AGENTS.md`、`.github/workflows/` 则明确覆盖对应路径。越界路径已属 scopeViolations，不重复记 dangerous；每个 in-scope 路径只记首个未被明确授权的危险模式。

默认 dangerousPathPatterns（policy 可整体替换）恰为：

```json
[
  ".github/workflows/**",
  ".github/actions/**",
  ".gitlab-ci.yml",
  ".circleci/**",
  ".husky/**",
  ".pre-commit-config.yaml",
  "**/lefthook.yml",
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/pnpm-workspace.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/.npmrc",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/jest.config.*",
  "**/playwright.config.*",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/.oxlintrc*",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.claude/**",
  "**/.codex/**",
  "**/.agents/**",
  "**/.mcp.json",
  ".axiom-work/**"
]
```

内置密钥模式 private_key（PRIVATE KEY 块）、provider_token（sk / ghp / gho / github_pat / xox[abp] 前缀）、aws_access_key_id（AKIA）始终启用，沿用 ContextBuilder 脱敏规则且不改变原 redactContext 输出。secretPatterns 只追加 JavaScript 正则源码（无 flags，非空且须可编译），命中名为 policy:<index>。检测无跨调用 lastIndex；证据只含 path + pattern 名，绝不含行号、摘录或匹配文本。规则有误报可能（例如带 sk- 前缀的长 kebab-case 标识符）；二进制文件不扫描。

生成文件只记录，不增加 verdict 条件：`**/out/**`、`**/dist/**`、`**/*.lock`、`**/pnpm-lock.yaml`、`**/package-lock.json`、`**/bun.lockb`。它们仍受 scope、secret 和危险路径规则约束。

gate 优先级为 diff 失败 → inconclusive/environment；否则 secret → fail/secret_detected；scope → fail/scope_violation；patch 不完整 → inconclusive/diff_too_large；内容型篡改 → inconclusive/test_tampering；危险改动 → inconclusive/dangerous_change；否则 clear。保留全部已取得的 findings，按路径排序。与命令组合时按上表：gate fail 优先于 check fail；check fail 优先于 gate inconclusive；其后沿用 M3-02 规则。**gate 从不跳过命令**，失败候选仍保留完整命令证据供修复；policy_invalid 与非本地 repository 路径不运行 gate。

verdictDetail.diff 包含 integrationBase={branch,sha}、mergeBase、changedPaths（数量）、scopeViolations、dangerous（path/pattern）、secrets（path/pattern）、tampering（path/rule/count）、generated、binary、ignoredScopeEntries、patchComplete；每个列表最多 50 项，counts 对上述七个列表保存完整数量。既有 verdict evidence Artifact 使用同一 diff 结构，每列表最多 1000 项。失败为 `{error:<reason>}` 加已解析的 integrationBase / mergeBase（ref 不可得时只含 branch）。INCONCLUSIVE 同样有摘要。gate 原因赢得 verdict 时，verification.failed / verification.inconclusive 审计分别附最多 50 项 scopeViolations / secrets / dangerous / tampering。结算事务和 claim fencing 不变；FAIL 仍走 settleVerificationFailure，INCONCLUSIVE 仍保持 VERIFYING。

Worker 的 Permissions, budget and submission contract 在运行时 write-scope 限制说明后追加：

```text
Every file left in this worktree becomes part of the Candidate. Write reports and other Artifact files outside the worktree (for example in a temporary directory) before running axiom mission artifact put.
Verification compares the Candidate with its merge-base on the integration branch: a changed path outside allowedPaths fails it (scope_violation), an added line that matches a secret pattern fails it (secret_detected), and changes to dependency manifests, lockfiles, CI, hooks, test or lint configuration or agent instruction files go to human review unless an allowedPaths entry names them.
Deleting or skipping tests, removing assertions from a test file, or adding lint, type-check or coverage suppressions sends the Candidate to human review (test_tampering). When the Task has no required evidence commands, reference at least one readable, non-empty Artifact in the submission (JSON must parse); a human or Reviewer confirms it.
```

Planner 的 PlanProposal contract 追加：

```text
scope.allowedPaths entries are repository-relative: an entry covers that path and everything below it; * and ? match within one path segment, ** matches any number of segments, and . is the whole repository. Verification fails any change outside allowedPaths.
Name dependency manifests, lockfiles, CI workflows, hooks, test or lint configuration and agent instruction files (AGENTS.md, CLAUDE.md, .claude/, .codex/, .agents/, .mcp.json) in allowedPaths when a Task must change them; otherwise such a change goes to human review.
Name a test file in allowedPaths when a Task must delete it, and give every Task required evidence commands unless its deliverable is an Artifact for human or Reviewer confirmation.
```

DEF-21 ⑦ 的依赖规则：依赖变更集中到一个先行 Task，scope 明确列出 package.json 和所用 lockfile，下游 Task 等其集成；两个并行 Task 同时触及这些文件的提案警告留给 M5 Planner v2。M3-03b 的内容型篡改与非代码路径见下文；按 Artifact kind 的内容 schema 等 TaskSpec 增加 requiredArtifacts（M5 Planner v2）再定义。harness 写入 worktree 的本地状态（如 `.claude/settings.local.json`）也会进 Candidate 并因越界失败；启动配置移出 worktree 或经 Decision 设快照排除清单属于 M3-08。

**M3-03b：内容型篡改、Worker Artifact 与非代码 Task（D65 修订 ⑦–⑨）**

`test-tampering.ts` 是纯函数，只检查完整 patch 的 addedText / removedText。测试文件为匹配任一 testPathPatterns 的路径；沿用上述路径语义。所有计数逐文件取新增次数减删除次数，同文件移动、重排、等价格式化不增加计数。结果只含 `{path, rule, count}`，按 path、rule 排序，不存匹配文本。

- `test_file_deleted`：测试路径 status=D，count=1；若有 status=A 的测试文件，其 addedText 等于源文件的 removedText（纯移动 / 改名），或某个有效 allowedPaths 条目归一后字面等于删除路径，则豁免。宽条目 `src/`、`.`、`**/*.test.*` 不豁免；移动同时编辑仍报告源文件删除。此豁免只作用于删除规则。
- `test_skip_added`：测试文件中 skip / focus / pending 标记净增，count=净增次数。
- `assertions_reduced`：未删除的测试文件中断言调用净减，count=减少次数。
- `suppression_added`：任意文件中 lint / 类型检查 / coverage 抑制标记净增，count=净增次数，不受 testPathPatterns 限制。

精确模式（JavaScript 正则，ASCII 源码）：

```ts
const SKIPS = [
  /\b(?:describe|it|test|suite|context|bench)\.(?:skip|only|todo|skipIf|runIf|fails)\b/g,
  /\b(?:xit|xtest|xdescribe|xcontext|xsuite|fit|fdescribe|ftest)\s*\(/g,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/g,
  /\bpytest\.skip\s*\(/g,
  /@unittest\.skip/g,
  /\bt\.Skip(?:f|Now)?\s*\(/g
]
const ASSERTIONS = [
  /\b(?:expect|assert)(?:\.\w+)*\s*\(/g,
  /\bassert[A-Z]\w*\s*\(/g,
  /^\s*assert\s/gm,
  /\.should\b/g,
  /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\s*\(/g
]
const SUPPRESSIONS = [
  /(?:eslint-disable|oxlint-disable|biome-ignore|@ts-ignore|@ts-nocheck|@ts-expect-error|#\s*noqa\b|#\s*type:\s*ignore|pylint:\s*disable|\bnolint\b|istanbul\s+ignore|c8\s+ignore|v8\s+ignore)/g
]
```

这是词法检查，不是语义审查：字符串、注释中的示例也可能命中；合法的删冗余断言、条件 skip、expected-failure 和抑制注释会交人。跨文件计数不抵消，改断言参数或等量替换断言不保证被发现。二进制内容不扫描，patch 被截断时不能据部分内容判安全。`checks_failed` 或 scope / secret 失败优先时，tampering 仍保留在 diff 证据中；下一修复 Attempt 的既有 Diff schema 解析该列表，在原有失败信息后追加 `Test tampering findings (path, rule, net count):`、最多 50 条 path/rule/count，以及恢复测试 / 断言、移除新增 skip / suppression 的指令。secret_detected 导致从干净集成基线重试时也通过同一渲染逻辑保留这些发现；原有摘录和失败名上限不变。

命令计划执行后，`worker-artifacts.ts` 通过 Candidate.attemptId 读取 Submission，逐个检查 report.artifacts 引用：`artifacts.read` 失败为 unreadable；零字节为 empty；text/_、application/json、application/_+json 使用 fatal UTF-8 decoder，解码失败为 invalid_utf8；JSON 再解析，失败为 invalid_json。媒体类型匹配忽略大小写和 `;` 后参数。其他媒体类型只检查可读、非空；纯空白文本仍非空，纯空白 JSON 无效。所有 kind 使用同一检查，不推测按 kind 的 schema，也不以 Worker 的 checksRun 作证据。

每个完成检查阶段的 run（含 policy_invalid / remote_repository_unsupported）在 verdictDetail 与完整证据 Artifact 中保存 `artifacts={required,checked:[{id,kind,mediaType,bytes,problem?}],counts:{checked,unreadable,empty,invalid_utf8,invalid_json}}`。required 表示非代码 Task 或存在显式 artifact criterion。内部检查全部引用，再按种类判定每个 criterion；持久摘要 checked 按引用顺序最多 50 条，counts 统计全部引用，因此第 51 条后的有效证明仍可满足 criterion，无效项仍参与非代码规则。可读时 bytes 是实际内容长度；不可读时保留可用元数据，未知字段为 null。只存元数据与固定问题名，不存内容或原始存储错误。

非代码 Task 定义为解析后 criteria 中没有 command check，setupCommands / repositoryGates 不改变分类且仍照常运行。保留 M3-03b 的隐式证明规则：无引用 Artifact → FAIL(artifact_missing)；任一 empty / invalid_utf8 / invalid_json → FAIL(artifact_invalid)；无上述失败但有 unreadable → INCONCLUSIVE(environment, artifact_unreadable)，交人。显式 artifact criterion 则按本 Task brief 的确定性证明要求：没有可读、非空的匹配引用就 fail；无匹配 kind 为 artifact_missing，有匹配但均无效（含 unreadable）为 artifact_invalid，优先于隐式非代码环境分支。其他优先级按上表；没有更高原因时，非代码 Task 始终 INCONCLUSIVE(non_code)，即使 Artifact criteria 与门禁全绿。human_confirm 交人，artifact_only 按 inconclusiveRouting（默认 specialist）；不自动 PASS。代码 Task 未被 artifact criterion 要求的 Artifact 问题只记证据。修复上下文对 required=true 的 Artifact 问题追加 `Artifact problems:` 与最多 50 条 `id (problem)`。

宿主 `mission-tamper-gate.spec.ts` 使用三个 provider-only 修改，分别为 date.test.ts 的 test.skip、guards.test.ts 删除一个 expect、clock.test.ts 增加 c8 ignore；provider 在预期文本缺失时抛错。三个候选的 setup 与 verify:full 必须全部 pass，但 run 均为 HUMAN_REVIEW，verdict 为 INCONCLUSIVE(test_tampering)、escalation=human，Task 保持 VERIFYING；diff 与审计中的单条发现必须精确一致，scopeViolations 为空。S4 的输入表修正仍无发现，修复循环的宿主回归继续由验证者运行。

### Questions 与 D50 待决项处置（M2-06b）

`axiom.attempt.ask {attemptId, from, senderPaneKey?, question?, options?, timeoutMs?, resume?}` 为 mutation；question 与 resume 至少一项。鉴权后调用内核 `createQuestion`，直接使用它创建并投递到 `run:<runId>` 的消息，不创建第二封 QUESTION。先持久化 acceptance receipt，再通知 Run、长轮询 `dispatch:<attemptId>`：answered 返回 answer / answerMessageId；deadline 返回 timedOut；断连 signal 返回 cancelled；内核结算将 pending thread 关闭，等待者返回 dispatch_inactive。timeout 使用内核 clamp（默认 600 秒、上限 1800 秒）。resume 只接受同一 dispatch 的 question id；`--retry-request` 回放收据，恢复等待使用新请求 + resume。CLI 支持可重复 `--option` 与 `--timeout-ms`，transport 比内层等待多 5 秒。

`axiom.message.answer {missionId, questionId, body}` 是唯一 Mission answer 路径；两种 Question 在写入之前共用 `redactContext(body).redacted` 扫描，命中返回 `invalid_argument: secret_in_answer`，不写答案、审计或收据。内核 Question 的其余路径不变：核对 Mission/Attempt 归属，以当前 `run.consumer_generation` 调用 `answerQuestion`，记录 question.answered / receipt、重算 readiness，再通知 `dispatch:<id>` 的 status waiter。同内容重答幂等，异内容 answer_conflict；closed → dispatch_inactive。ask / answer 的内核函数各自拥有 BEGIN IMMEDIATE，不能嵌入另一写事务；内核写入后同步保存 Axiom 审计及收据，再通知。CLI 为 `axiom message answer --mission <id> --question <messageId> --body <text>`。

M3-04b-3：questionId 若是本 Mission 的 typed QUESTION 消息，则在 `question_answer_receipt` 事务中要求 pending，扫描秘密、拒绝超过 4,000 字符的 body，记录 `question.answered`（actor=user，objectKind=message，objectId=消息 id，before=`{status:'pending'}`，after=`{status:'answered',taskId,attemptId,answer:body,by:'user'}`）。答案保留原空白，只存于 audit；响应及收据仅带 questionId / status。然后重算 readiness，并在提交后触发 Scheduler（Task 已是 READY 时也触发；外层回滚不触发）。新请求再次回答返回 invalid_argument；相同 mutation receipt 可回放。typed Question 不要求原 dispatch 仍活跃，也不向已结束的 Worker 发答案；下一次及后续 Attempt 通过强制 context 读取。

`axiom.message.resolve` 若指向本 Mission 的 pending follow-up REQUEST，则只记 `followup.resolved`（actor=user，objectKind=message，objectId=消息 id，after=`{decision:'accept'|'reject',rationale,taskId,attemptId}`）；rationale 经 redactContext 脱敏，审计与 receipt 同事务，再次处置拒绝。accept 不创建 Task、不变更 Task stage；人另用 `axiom task create` / `axiom.task.create` 完成 MINOR_ADJUSTMENT。REQUEST_SUBTASK 仍走以下原有 D50 检查与创建路径。

`axiom.task.create {missionId, task, dependsOn, provenance}` 经唯一的 `MissionController.createTask` 写入；task 为不带 id 的 TaskSpec，dependsOn 可为空。只允许 PLANNED / EXECUTING 且 active PlanRevision 为 APPROVED（否则 mission_not_executing / plan_pending）。事务内先执行与 plan.propose 相同的 criterion shape / retired evidence / command 边界检查，再检查重复、依赖、预算；物化 tasks（deps=[]）、task_stages（DEFINED）与 mission_task_edges，写 task.created / plan.minor_adjustment，再重算 readiness（执行中 root 可立即 READY）。提交后触发 Scheduler。原 PlanRevision proposal 保留，新增 Task 绑定该 revision，不创建新 revision。CLI `axiom task create --mission <id> --file <task.json> [--depends-on <taskId>]* --json`；JSON 为对象 criteria 的 TaskSpec（无 id），拒绝 retired requiredEvidence；user provenance 的 at 使用文件 mtime 保持重试稳定。D50 的 model provenance 只存本次 Task audit，不改变 PlanRevision provenance schema。

`REQUEST_SUBTASK.subtask` 为严格对象：`{title,objective,allowedPaths,acceptanceCriteria: AcceptanceCriterion[至少一项],risk?,dependsOn?}`；不接受字符串 criteria 或 requiredEvidence。命令边界与 Planner 共用 `resolveAcceptance` 和验证器，D50 失败项名为 `evidence`。既有持久消息的读取也通过唯一 resolver 兼容，不重写历史 payload；新 Worker RPC / MCP 仍严格拒绝旧形状。

| D50 检查 / 分支                               | 确定性行为                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope                                         | 分隔符与点路径规范化后，每个 allowedPath 等于或在请求者 scope 内，按目录边界判断                                                                                                   |
| depth                                         | 请求者的 task.created.after.origin 不得是 request_subtask（最多一层）                                                                                                              |
| duplicate                                     | Mission 内不得有规范化后相同路径集合或 trim + case-insensitive 相同标题                                                                                                            |
| dependency                                    | 所有 dependsOn 属于 Mission；追加原 Task → 新 Task 及请求依赖后 orderPlanTasks 无环                                                                                                |
| budget                                        | policy.budget.maxAttempts 若设置，须大于 Mission attemptCount 总和                                                                                                                 |
| evidence                                      | 每个 command criterion 满足 D85 命令边界，失败 reason=evidence                                                                                                                     |
| attempt                                       | 请求者 binding 匹配 Task/Mission，dispatch 仍为 dispatched                                                                                                                         |
| 全部通过，subtaskAutoCreate 严格 boolean true | 消费者在 subtask.requested 后经 createTask 创建；继承 retryPolicy、milestoneId，kind=task，risk 默认 low；边使用 Mission readinessThreshold；subtask.resolved.decision=auto_accept |
| 检查失败 / 自动创建未启用                     | 保持 pending；失败写 subtask.checks_failed（failed 数组），无 Task 创建                                                                                                            |
| 人工 accept                                   | `axiom.message.resolve {missionId,messageId,decision:'accept',rationale}` 重跑全部检查，再走相同 createTask；失败仍 pending                                                        |
| 人工 reject                                   | 同一 resolve，decision=reject；只写 subtask.resolved，不创建 Task                                                                                                                  |

所有成功处置写 `subtask.resolved.after = {decision,reason,taskId?}`；再次 resolve 返回 invalid_argument。CLI `axiom message resolve --mission <id> --message <id> --accept|--reject --rationale <text>` 要求恰好一个决定。用户 task.create 无请求 Attempt，执行验收合同检查及 duplicate / dependency / budget；来源请求的创建执行上表全部检查。answer、resolve、task.create 均进 AXIOM_MUTATION_METHODS，与 ask 一起使用既有 envelope 栅栏和收据。M4 接 Approval，M5 将请求量作为 replan 信号。

M3-04b-3 的报告项复用上述 message.list / answer / resolve 投影；M4 接 Approval，M5 使用 REQUEST_SUBTASK 作为 replan 输入。

### 人工 Task 调整（M3-04b；D70 ② / D78 / D85）

`axiom.task.adjust` 为 desktop_only mutation，严格参数 `{taskId, rationale, addAllowedPaths?: string[], maxAttempts?: positive integer, maxTokens?: positive integer, acceptanceCriteria?: AcceptanceCriterion[]}`；rationale 必填，addAllowedPaths 默认 []、最多 50 条 trim 后非空字符串，响应复用 `TaskResponseSchema`（`{task: TaskListItem}`）。Mission 必须为 PLANNED / EXECUTING，Task 必须属于该 Mission 当前 APPROVED 的 active PlanRevision，否则分别返回 `mission_not_executing` / `plan_pending`。接受 DEFINED、READY、NEEDS_FIX、BLOCKED；M3-05 另接受 ACTIVE Candidate 最新 run 为 HUMAN_REVIEW 的 VERIFYING。替换 criteria 时，最新 run 为 QUEUED / RUNNING 也拒绝；其它 stage 返回 `illegal_transition {taskId,from,reason:task_not_adjustable}`，防止改写已有 ContextPackage 或 VerificationRun 所依赖的执行合同。

`MissionController.adjustTask` 在 `write('adjust_task')` 内把旧 allowedPaths 与增量按原顺序取去重并集，maxAttempts 未给则不变；小于已消耗 attemptCount 返回 `invalid_argument`。`updateTaskSpec` 以 expectedStage 做 CAS，同时写既有 `task_stages.spec` 与 `retry_policy`，不建新表或 PlanRevision。BLOCKED 先按持久 previousStage 解锁；到 NEEDS_FIX 后仅在 `attemptCount < maxAttempts` 时继续 READY，两步 reason 均为 adjusted。预算仍耗尽则抛 `retry_budget_exhausted {taskId,attemptCount,maxAttempts}`，spec、审计、消息解决与 stage 全部回滚。DEFINED 保持原 stage，交 readiness 重算；READY 保持 READY。rationale-only 调整有效，可在人复核 candidate_disputed 后重开新 Attempt，不覆盖原 FAIL。仅替换 criteria、已有 ACTIVE Candidate、且没有 addAllowedPaths / maxAttempts / maxTokens 时保持 BLOCKED，让人随后显式 rerun，不意外 admission 新 Attempt；原预算与范围调整规则不变。VERIFYING+HUMAN_REVIEW 调整保持 VERIFYING。

`maxTokens` 可选且为正整数；提供时必须严格大于 `sumAttemptTokenUsage({taskId})`，否则 `invalid_argument`、data=`{taskId,used,maxTokens}`，不写 spec、audit 或 receipt。通过后仅替换 spec.budget.maxTokens，保留其它 budget 字段。task.adjusted 的 before.maxTokens 是旧 cap 或 null，after.maxTokens 是新 cap；plan.minor_adjustment.after.maxTokens 同样记录。只有调用明确设置 cap 才添加这些审计字段。token-blocked Task 沿原 previousStage 解锁，NEEDS_FIX 仍受次数检查；两个预算都耗尽时必须一次同时提高。省略 maxTokens 保留原 cap；仍达 cap 的 Task 会在下次 admission 再次阻塞。无 --max-tokens CLI 参数。

acceptanceCriteria 为 1–50 个严格对象的全量替换，经 `validateTaskAcceptance` 与 `validateAcceptanceCommands`（由 `validateTaskCommands` 使用 Mission verificationRules 调用）校验，错误为 `plan_invalid {errors}`；不接受新的字符串标准。无 acceptanceCriteria 的旧调用不受影响。rationale 命中 `redactContext` 返回 secret_in_rationale，不写审计。

同一事务写 `task.adjusted`：before=`{allowedPaths,maxAttempts}`，after=`{allowedPaths,maxAttempts,addedPaths,rationale,afterAttemptSeq:nextAttemptSeq(taskId)-1,origin:user,resolvedMessageIds}`；替换 criteria 时 before / after 另带各自 acceptanceCriteria（文本与命令先脱敏）；以及 `plan.minor_adjustment`：after=`{classification:MINOR_ADJUSTMENT,origin:task_adjust,taskId,addedPaths,maxAttempts,rationale}`。每个本 Task 的 pending typed BLOCKED 消息写 `blocked.resolved`（objectKind=message、objectId=messageId，after=`{decision:adjusted,taskId,rationale}`）；`cancelTask` 在取消事务内同样写 decision=canceled。Task stage 是权威，pending 只是上述审计的投影。

RPC 以 `task_adjust_receipt` 外层事务把调整和 mutation receipt 一起提交；`AXIOM_MUTATION_METHODS`、契约版本栅栏、同 request id 回放均复用 create 路径。成功提交后触发 `scheduleAfterWrite(missionId,'stage_change')`，嵌套事务回滚抑制通知，真正 admission 仍由 Scheduler 执行。V1 以桌面调用方作为人工范围 / Task 重试预算授权，M4 再接 Approval 对象；此方法不提高 Mission 总预算。

CLI 形状为 `axiom task adjust --task <id> --rationale <text> [--add-path <path>]... [--max-attempts <n>] [--acceptance <text> --evidence <command>]... [--acceptance-artifact <text>]... [--retry-request <id>] [--json]`；acceptance / evidence 按既有位置配对，无匹配命令的 acceptance 为 human，artifact 追加到替换列表；与其它人工 CLI 动作一样，非 desktop 传输仍收到 `caller_not_desktop`，Worker / Planner 不能用此命令自行扩权。桌面处置卡片留给 M3-09，当前 pending 项通过 message.list / CLI 读取。

### 调用方权限（D78）

`src/main/axiom/authority/caller-authority.ts` 的 `AXIOM_METHOD_CALLER_CLASS` 覆盖所有已注册的 `axiom.*`，测试与 `AXIOM_METHODS` 双向对照，包含 `axiom.namespace.get`。方法只占一行；`resolveAxiomCallerClass` 按解析后的 `attemptId` 区分两种提案 / 上传入口。

| 类别         | 方法（省略 axiom. 前缀）                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| desktop_only | mission.create / plan / start / pause / resume / cancel；goal.propose / activate；plan.approve / reject；policy.update；task.create / adjust / cancel；verification.resolve / rerun；message.answer / resolve；无 attemptId 的 plan.propose / artifact.put |
| attempt      | attempt.submit / ask / inform / request / blocked / handoff / request-subtask / check；带 attemptId 的 plan.propose / artifact.put                                                                                           |
| read         | namespace.get；artifact.read / list；attempt.show / list；goal.show；message.list；mission.show / list；plan.show / list；policy.show；task.list / show；verification.show / list                                            |

`RpcDispatcher.invokeUnary` 在 `assertAttemptRequestAuthority` 旁、mutation receipt replay 之前调用 `assertAxiomCallerAuthority(method, params, ctx, method.permission)`；普通和 streaming transport 的 unary 请求共用此点。desktop_only 只接受 transport 盖章的 `ctx.caller.kind=desktop`；local-cli、paired-device、缺失身份均抛 `OrchestrationError(caller_not_desktop)`，提示在 Axiom app 决定。params 中的身份字段无权改变传输盖章的 caller kind。现有人工 handler 的 user / resolver provenance 不改，也不新增 schema。

第二层只消费宿主已经核实的 `ctx.orchestrationCaller`：以现有 dispatch 身份查询找到 `attempt_bindings` 后，不论 Worker、Planner 或 Reviewer，非 workspace permission，以及 agentSession.respondToApproval / respondToQuestion、orchestration.runCreate / dispatch / workerStart / taskCreate 都抛 `caller_not_permitted_for_agent`。workspace 读取、普通非 Axiom 会话不受这一层影响。可归属的拒绝在抛错前写该 Mission / Task 的 `authority.refused`，after 为 `{method,callerKind,attemptId}`；找不到 binding 时不伪造审计。

拒绝已决定、但没有 `ctx.orchestrationCaller` 时，hook 使用 dispatcher 传入的 `orchestrationCompatibilityEvidence` 为 PTY Worker 补审计归属：沿用 `lifecycle-caller-fence` 的 pane-key → 当前 handle 映射（pane 优先，兼容 handle 重铸），要求宿主仍有 live pane；若 evidence 的 handle 仍有 live pane，先用同一栅栏拒绝另一编排方的矛盾证据。再查询 active dispatch 并复用 Attempt 动词的 `resolveAttemptIdentity`：核实 binding、dispatched 状态、最新 Attempt、process incarnation（旧行无 incarnation 则查消息发送方）、非 stopping、lifecycle authority 与 Mission / Task / Run 一致。任何身份检查失败都只返回原权限拒绝，不写审计；不从业务 params 的 from / attemptId 认领身份。此回退只补归属，不产生 ctx 会话，也不扩大第二层的拒绝范围。D73 的同用户环境冒充限制与 DEF-25 仍适用；launchToken 不新增为 Attempt 凭据。

实际覆盖由 `dispatcher-axiom-session-coverage.test.ts` 固定：请求携带注入的 agentSessionId 时，宿主按下表解析 ctx.orchestrationCaller。CLI 的 compatibility envelope 只为相同的方法集合附带身份依据；测试逐一对照全部 AXIOM_METHODS，保证新扩展恰好是 desktop_only 方法。CLI 复用 AXIOM_MUTATION_METHODS（当前除 Attempt mutation 外均为 desktop_only），不引入 main 模块或第二套身份机制。

| 方法 / 调用条件                                                                                             | 会话归属与第二层覆盖                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所有 orchestration. 方法（含未列在 ORCHESTRATION_CALLER_PARAM 的 runShow / reset）                          | 有注入的 agentSessionId 时解析 ctx；只有 ORCHESTRATION_CALLER_PARAM 列出的方法改写 caller params。非 workspace 与 Run / Worker 创建拒绝可归属的 Axiom 会话；普通非 Axiom 会话行为不变。                                                                    |
| AXIOM_ATTEMPT_CALLER_METHODS：八个 Worker 动词、plan.propose、artifact.put                                  | 解析 ctx 并绑定 from；两个条件方法无 attemptId 时仍为 desktop_only。                                                                                                                                                                                       |
| 其余 desktop_only Axiom 方法（含 plan.approve / policy.update / message.answer）                            | 解析 ctx 以关联 authority.refused，但不改写 params，也不授予权限。所有非 desktop 调用仍拒绝；清掉会话环境也不能绕过 desktop 边界。                                                                                                                         |
| Axiom read、agentSession.respondToApproval / respondToQuestion、settings / computer 等非 orchestration 方法 | 不解析 ctx；非 Axiom 方法的解析范围与原实现一致。respondTo* 等方法只有已有宿主归属时才受第二层拦截，当前真实入口不能归属，仍靠 D63 沙盒姿态。                                                                                                              |
| 无 agentSessionId，仅有 PTY terminal / pane 依据                                                            | 不产生 ctx.orchestrationCaller；已经拒绝的 desktop_only 调用经上述 D73 检查后写 authority.refused。无效 / 矛盾依据、非 live pane、过期 / stopping / 已结算 Attempt 不归属；第二层覆盖不变。显式 session address 可触发原有 caller 参数绑定，但不产生 ctx。 |

会话解析只提供归属，desktop 传输盖章才是人工动作边界。不能把第二层当成认证边界，也不能把读取仍可用误记为允许 Agent 作人工决定。

artifact.put 增加可选 attemptId / from；带 attemptId 时在回执前及 handler 内复用 resolveAttemptSender，核对 Mission，createdBy 固定为 `attempt:<id>`、related 固定为该 Task / Attempt，忽略调用方自报出处和关联。不带 attemptId 时仅桌面可上传。CLI 的 allowedFlags / usage / example 已注册 --attempt，handler、Worker 配方与测试 provider 使用同一 flag。

`errors.ts` 保留 caller_not_desktop / caller_not_permitted_for_agent 的 wire code；OrchestrationError 的结构化 data 原样返回（包括 invalid_argument 的 reason=threshold_not_supported），不会被 computer recovery nextSteps 替换。真正的 computer 错误仍使用原恢复提示。实现和验证记录见 `.axiom-work/reports/M3-04c-2.md`；Electron 场景由宿主 verifier 独立执行。

## 7. Admission 守卫（映射 §4b）

`mission-managed-run-guard.ts` 按 Run、Task、dispatch 查 Mission 归属，在对象解析后、首次写入前拒绝。非 Mission Run 保持原行为；未知对象保持原错误。以下路径在 M1-07 / M2-06a 落地：

| Orca 入口                                                        | 守卫 / RPC 文件（`src/main/runtime/rpc/methods/` 下）                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| taskUpdate 修改 status                                           | `assertNotMissionManaged`；`orchestration/messaging/message-methods.ts`                                                                 |
| taskCreate（有/无 deps 均拒绝）                                  | `assertTaskCreateAllowed`；同上，仅 Plan 批准物化 Mission Task                                                                          |
| reset all/tasks/messages                                         | `assertResetAllowed`；`orchestration/runs/reset-methods.ts`；数据库存在任一 Mission 即拒绝                                              |
| workerStart / dispatch                                           | `assertNotMissionManaged`；`orchestration/worker/workers.ts`、`orchestration/runs/dispatch-methods.ts`                                  |
| send worker_done / merge_ready / dispatch / decision_gate        | `assertWorkerMessageAllowed`；`orchestration/messaging/send-methods.ts`；同步结算前拦截                                                 |
| gateCreate / gateResolve                                         | `assertNotMissionManaged`；`orchestration/gates/gates.ts`                                                                               |
| runUse，包括 takeover-legacy                                     | `assertNotMissionManaged`；`orchestration/runs/runs.ts`；bindRun 前拒绝                                                                 |
| run / runStop / coordinator-start                                | 保持退役；契约 fence / CLI dispatch-handlers 拒绝                                                                                       |
| workerStop / workerAbandon（M2-06a）                             | `assertNotMissionManaged`；`orchestration/worker/worker-stop.ts` / `worker-control.ts`，首次 stop/abandon 前                            |
| workerRelease / workerRetain / workerTerminalUserInput（M2-06a） | `orchestration/worker/worker-release.ts`；输入先解析 pane（含 session/handle），守卫查资源的 dispatch，覆盖已结算保留资源与 pane remint |
| ask（M2-06a）                                                    | `orchestration/messaging/ask-methods.ts`；activeDispatch 解析后，createQuestion 前；Worker ask 已由 M2-06b 提供                         |
| reply（M2-06a）                                                  | `orchestration/messaging/message-methods.ts`；原消息 run_id 与发送者 Run 两侧检查，markAsRead / answerQuestion 前                       |
| send(group)，含 @all / @worktree（M2-06a）                       | `orchestration/messaging/send-methods.ts`；路由与发送者 Run 检查，sendGroupMessage 前                                                   |
| workerStart --on（M2-06a 测试）                                  | 沿用 `worker/workers.ts` 的 M1-07 守卫；测试证明 federation 前拒绝，无新增内核代码                                                      |

M2-06a 的 `admission-worker-control.test.ts` 与 `admission-rpc.test.ts` 覆盖上述入口的 Mission/非 Mission 对照。Control Plane 的 stop/abandon 调用已走 M2-08 service 边界；进程内 `caller: 'control_plane'` 不对 RPC params 开放。

完整测试为 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message,admission-worker-control}.test.ts`；逐入口证据见 [M2 出口矩阵](../review-evidence/axiom-m2/M2-exit-e2e.md)。task-update / worker-start 有三层拒绝：CLI 无终端身份时，`src/cli/handlers/orchestration/terminal-identity.ts` 的 `resolveCoordinatorTerminalHandle` 先抛 `no_active_sender_terminal`，尚未发送 mutation RPC；进入 runtime 后，Run 绑定解析可返回 `run_required` / `consumer_fenced`；到达 Mission 守卫后返回 `mission_managed`，由 M1-07 绑定 coordinator 的 RPC 测试覆盖。不能为取得某个错误码而给终端接管合成 Run。

M2 之后：M3 新增验证入口继续走 Control Plane；D58 如新增执行通道，必须保留本表的旁路拦截。

## 8. Mailbox 与恢复

M2-08 新审计：attempt.unverifiable（taskId/seq/reason/since）、attempt.abandoned（reason/disposition/evidenceArtifactId?）、attempt.failed、attempt.stopped、attempt.stop_unknown、attempt.launch_pending_orphan；取消的停止/放弃事件还含 release 收据。attempt 对象 id 为 dispatchId，未绑定 launch 用 taskId/seq；无变化不追加相同结果。mailbox.retry_exhausted 为 Mission 对象事件，含 runId/consumerGeneration/reason；message 去重和 Attempt 结果审计使用 idx_audit_events_object，索引为 CREATE INDEX IF NOT EXISTS，无 schema version 变化。

M2-12 / D59：`attempt.failed.after.reason` 为 `process_exited | kernel_failed | terminal_missing`（最后一项由 M3-06-2b-3 / D88 修订 ③ 增加，字段与条件见 §4 Recovery b）；`process_exited` 来自 Recovery 的宿主退出证明，c′ 另带可选 `after.evidence = shell_foreground`，PTY 退出不加该字段；`kernel_failed` 补齐内核先失败的事件，另带 `after.lastError`（string 或 null）。kernel_failed 补审计与 Task settlement 同事务，既有 attempt.failed 不重写。`planner.attempt_failed` 在 c′ 无提案失败时保留 `reason = no_proposal`，同样带 `evidence = shell_foreground`；没有增加生命周期枚举。

M2-07 提交审计：`attempt.submitted` 的 objectKind=attempt、objectId=dispatchId，after 含 stage=SUBMITTED、taskId、submissionId、candidateId、verificationRunId。`candidate.superseded` 的 objectKind=candidate、objectId=旧 Candidate id，after 含 SUPERSEDED 与 supersededBy；二者与结算同事务。D76 提交后的 `attempt.transcript_archived`（objectKind=attempt、objectId=attemptId）含 `{submissionId,artifactId,source,status,processCount?}`；`attempt.transcript_archive_failed` 含 `{submissionId,reason:capture_failed|store_failed}`。回执后的 `attempt.terminal_released` 含 `{submissionId,state,processAction,archive}`，直接记录内核 receipt（包括 retained / release_pending 等结果，不伪装为实际关闭）；throw 则 `attempt.terminal_release_failed {submissionId,reason:release_failed}`。不持久化原始错误。恢复使用同一两个 effect，首次存档审计按 Submission id 判断，已 released 的资源不重复释放。消费者已有 `message.received` 路径覆盖 SUBMISSION，只记收件审计，不二次结算或验证。

M3-08e / D83 ③④（Codex；Claude 见 §4「Claude channels and invocation pins」）：`attempt.headless_prepared` 与 `attempt.started` 的 `combination` 记录 requested（harness/channel/model/effort、selected-account、启动时的 skills/MCP 允许名单、hooks=off）和 effective（harnessVersion、home kind/path、configSha256、MCP hash、用户 skill digest、禁用 skill 与 hook approval 数、token 状态）。缺少允许的 MCP/skill、版本未知或 token 刷新失败时，同一 Attempt 只追加一条 `attempt.launch_mismatch {reasons}`，启动继续；unmanaged 不算 mismatch。TUI 记录 requested、effective=null、adapter=none（DEF-42）。令牌距上次刷新至少 7 天时，在既有 home lock 内复查并请求 `account/read {refreshToken:true}`，只记录状态，不记录凭据或错误文本。失败 headless Attempt 的 `attempt.terminal_released` / `attempt.terminal_release_failed` 用 `reason=attempt_failed` 代替 submissionId，仍只记安全的 release 收据。`buildWorkerContracts` 先调用只读 `selectWorkerProvider` 选通道，每次 admission 只建一份 ContextPackage 与 AgentSpec，保留 provider 变化守卫。

M2-05 启动审计：`attempt.started` / `attempt.launch_failed` / `attempt.start_unknown` 的 objectKind 为 attempt，绑定后 objectId = dispatchId，after 含 taskId/seq/branch/worktreeId/provider；绑定前失败的 objectId = taskId/seq，after 含脱敏 message。`integration.base_created` / `integration.base_reused` 的 objectKind 为 mission，after 含 sha。这些事件不代表 Submission、验证或完成。

M2-04：MissionController 在 startExecution 提交后触发 mission_start；resumeMission/unblockMission 提交后触发 resume；transitionTaskStage/cancelTask/recomputeReadiness 实际移动 stage 后触发 stage_change。recomputeReadiness 无变化不触发；M3-04b 的 adjustTask 成功写入即触发 stage_change（包括只改 spec / rationale），由 Scheduler 重算 readiness。嵌套事务（mailbox、RPC、admission）延至当前同步调用栈提交后才触发，并核对持久审计以抑制回滚事务的通知。control-plane.ts 以 fire-and-forget 调用 scheduleRound，拒绝仅 console.warn，不抛回生命周期调用者；manual 可由服务调用者显式请求。现有 RunMailboxConsumer 的 readiness 调用沿用此入口，无新增轮询。

`RunMailboxConsumer` 先注册 exclusive waiter 再 drain backlog，避免读空到订阅之间丢唤醒；waiter 的独占仅限进程。`getOrCreateRunDelivery` 与 `acknowledgeRunDelivery` 用启动时捕获的 generation 栅栏，不能重读并采用别人的新 generation。

一批消息在 store 事务内按 message id 查 `audit_events` 去重：普通载荷写 `mailbox.message`，合法同 Mission 的 `payload.axiom` 改写 `message.received`；两种事件共同作为去重依据。重算 readiness，成功后才 ack。语义是 at-least-once delivery + 幂等效果，不能先 ack 再处理。处理失败留下批次以供重放；M2-08 使用 250ms × 2^(n−1)、上限 30s 的 waitForMessage(typeFilter=[]) 退避，通知不能绕过等待；成功 drain 后清零，连续 8 次失败则 blockMission(consumer_retry_exhausted)、写 mailbox.retry_exhausted 并停止。hasMessageAudit 使用 mission_id/object_kind/message object_id 与两种去重事件的 SELECT 1 LIMIT 1；idx_audit_events_object(mission_id, object_kind, object_id) 在每次打开 DB 时幂等创建，不再逐批扫描 Mission audit。`consumer_fenced` 写 `mailbox.consumer_fenced`，将 Mission BLOCKED 并停止消费者。

M2-06a `MessageRouter` 在 `store.transaction('message_route', …)` 内写 Control Plane 副本、下游副本与 `message.sent`（含 type/taskId/attemptId/recipients），并保存 mutation receipt；提交后向每个收件地址 `notifyMessageArrived`。Control Plane 地址必须为 `run:<runId>`：M1-08 的 `getOrCreateRunDelivery` 不消费 coordinator 的 `session:<id>` 直邮。INFORM/HANDOFF 默认只投 sender Task 的直接下游最新且 dispatched 的 Attempt；非空 `related.taskIds` 替换默认受众。REQUEST/BLOCKED/REQUEST_SUBTASK 只投 Control Plane；所有副本以 Control Plane 消息 id 为 threadId，从不使用群组地址。DEF-21 ④（V1，M3-05 钉死）：QUESTION 只交人，不能问另一个运行中的 Worker——报告里的 QUESTION 与其它 Control Plane 专属类型只投 `run:<runId>`；严格 Attempt 参数拒绝 `to`，Worker 不能自选收件 Worker。

`message.received.after = {type, taskId, attemptId, messageId}`；REQUEST_SUBTASK 在同事务另写 `subtask.requested.after = {...ids, subtask}`，作为 D50 step 1 的可查询待决项；BLOCKED 另写 `attempt.blocked_reported`。这三个事件的 objectKind 都是 message，objectId 是收到的消息 id，重放不重复记录。消费者不因 BLOCKED 邮件转换 Task 或 Attempt：terminal Worker 仍可能运行；headless 声明的 stage 变化由退出结算事务负责，消费者只保留相同的收到报告审计。带 blocked 的待处理投影与 blocked.resolved 见 §6。

`startAxiomControlPlane` 在桌面 `src/main/startup/main-process-runtime-service.ts` 与 daemon `src/main/orcad/orcad-entry.ts` 接入。每次启动先 `RecoveryService.recover()`，再为 ANALYZING / PLAN_REVIEW / PLANNED / EXECUTING 启消费者；全部消费者同步后，对 report.missions 中每个 EXECUTING 且不在 report.blocked 的 Mission 触发 `scheduleRound(missionId, 'resume')`（M2-12 / D59）。因此即使 Task 已 READY、readiness 没有移动，也会重新调度；按 Mission 合并，空轮不写 scheduler.round，PAUSED / BLOCKED / 终态不请求轮次。调用失败沿用 control-plane.ts 的 catch + console.warn，不抛回 boot。boot 幂等，quit 停止全部消费者。create/start/resume/unblock 同步启动，pause/block/cancel 停止；持久状态不依赖这些内存句柄。

恢复逐个检查非终态 Mission：Run 必须存在，合成 session id 必须有效且 `runBoundToCoordinator` 成立；否则 BLOCKED，记录一次 `recovery.run_binding_lost`，不悄悄重建 Run。正常恢复重算 readiness，**不会写 recovery 成功事件**；若 readiness 实际移动，仍按正常 Task 转换审计。

`reconcileAttempts()` 的 Attempt 子集由 M2-08 接入启动、周期与退出消息触发（§4 Recovery）。M3-01 的 VerificationService 负责 Verification 队列重驱；Integration 队列重驱与 Approval 过期由 M4 接入。`docs/plans/M1.md` 的早期 M1-01 笔记写过先 drain 后注册，实际 M1-08 实现与测试为先注册再 drain，以实现为本节事实来源。

M2-06b 审计：question.created / question.answered 的 objectKind=message、objectId=question message id；前者带 Task/Attempt，后者带 answerMessageId 与 status，不复制回答正文。消费者按 question_threads 识别无 Axiom payload 的 QUESTION，写 message.received。REQUEST_SUBTASK 的 subtask.requested、checks_failed、resolved 与 Task 创建在同批事务内；重放不重复创建。task.created 带 origin/provenance/messageId?；其 plan.minor_adjustment 带 classification=MINOR_ADJUSTMENT、origin=user|request_subtask、Task 与边。M3-04b 调整的 origin=task_adjust，字段和 task.adjusted / blocked.resolved 的事务关系见 §6。人工接受失败在返回 invalid_argument 前保留 checks_failed 审计，仍可修复后重试或拒绝。

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

D78 之后，创建 Mission、启动 Planner、人工提案、批准计划、开始执行与 task.adjust 都经桌面 IPC；CLI 保留读取、Worker / Planner Attempt 命令与 Orca 仓库注册。人工 CLI 子命令即使参数合法也被调用方守卫拒绝。fixture decomposition 仍须转换为 PlanProposal JSON，由 e2e 的 desktopCall 传给相同 RPC。UI 从 Mission list 选择，Refresh 或 mutation 后重读；选择的 Mission id 不跨重启持久化。

M2-10：Mission Home 的 Attempt 计数仅包含 `role=worker` 的 RUNNING / SUBMITTED；Planner 为 STARTING / RUNNING 时显示进行中。ANALYZING 可 Start Planner；进行中的 mutation、活跃 Planner 或 PROPOSED plan 禁用重复启动。Planner readiness 的长等待期间保留 busy。Pending items 用 `message.list({missionId,pendingOnly:true})` 列出 QUESTION / REQUEST_SUBTASK，点击跳到所属 Task Detail。Task Detail 读取 Task 范围的 Attempt / message 列表，展示最新提交的 Attempt 的 Candidate 证据与按时间升序的单列消息；pending QUESTION 可回答，pending REQUEST_SUBTASK 可附理由接受/拒绝。answer/resolve/plan 均走统一 request-id envelope，不确定重试复用同一载荷的 id；成功或失败都重读 RPC，不用 mutation 响应推断权威状态。Task 选择只在当前 Mission 会话内保留，切换 Mission 时清空。worktreeId 经既有 `activateWorktreeFromSidebar` 导航，不新增执行面板。

| 错误/诊断                                               | 含义与操作                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_active_sender_terminal`                             | CLI 没有终端身份，命令未到达 runtime；不是 Mission 损坏                                                                                                 |
| `mission_managed`                                       | Orca 入口试图越过权威；改用相应 `axiom mission/plan/task` 动作。reset 不是取消；破坏性恢复需后续 Approval 路径                                          |
| `consumer_fenced`                                       | caller/consumer 的绑定或 generation 已失效；CLI 拒绝不等于 Mission 损坏。若 Mission BLOCKED，检查 `mailbox.consumer_fenced` 及绑定证据，不抢占/重建 Run |
| `run_required`                                          | Orca caller 没有可用 coordinator Run；仅传 `--run` 不能获得权限                                                                                         |
| `run_binding_lost`                                      | RecoveryService 诊断；关联审计 `recovery.run_binding_lost`，Mission BLOCKED，需保留证据后处理绑定，不把失联当成功恢复                                   |
| `plan_pending`                                          | 已有 PROPOSED 计划；先查看并 approve/reject，不重发新计划                                                                                               |
| `stale_state`                                           | 预期源状态与数据库不符；重读当前对象再决定动作；不盲目覆盖                                                                                              |
| `retry_budget_exhausted`（task.adjust）                 | 调整后仍没有下一次 Attempt 额度；整笔调整已回滚，pending 项保留，需经桌面明确提高 Task maxAttempts 或取消                                               |
| `plan_invalid` / `illegal_transition`                   | 提案结构/DAG/Goal 关联无效，或转换不合法；看错误 data，修正输入                                                                                         |
| `replan_not_supported`                                  | M2 仍不能批准替代计划；Goal 在 EXECUTING 激活虽可进入 REPLANNING，完整替代闭环留给 M5                                                                   |
| `orchestration_migration_required` / `request_mismatch` | 契约 envelope 缺失/不兼容，或同幂等 id 换了载荷；升级兼容客户端或为新意图使用新 id                                                                      |

M2 出口证据以 [M2-exit-e2e.md](../review-evidence/axiom-m2/M2-exit-e2e.md) 的六条矩阵与 verifier 的宿主记录为准。新 exit spec 要求在同一 profile 完成 Planner → approve → start → 三根并行 → 一根 crash/retry → 三个 SUBMITTED，并比较四类提交前后持久行及 refs。shell 存活时的退出证明、kernel-first 失败审计与 boot resume 已由 M2-12 / D59 修复，历史诊断分支的宿主结果见 [M2-12 验证](../../.axiom-work/verifications/M2-12-1.md)；本候选仍须复验。`mission-attempt-launch.spec.ts` 保留重启身份/无重复启动的独立证据；M2-10 的五个既有宿主 spec 仍须回归。不得把未运行、skip、QUEUED 或 Worker 自报检查解释为独立验证 PASS。

| 后续责任                   | M2 出口边界                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2 出口复验                | M2-12 已合入；verifier 运行本候选的出口与五个既有宿主 spec，填写证据并决定验收；不再保留已修复的审计/boot 缺口为待办                                                               |
| D58（ACCEPTED）/ D57 / D82 | Worker channel A headless、Claude Planner channel B structured 已接入；Codex 已有认证宿主证据，Claude provisional 仍待 verifier smoke。V1 真实 provider 范围为 Codex + Claude Code |
| M3                         | 独立 VerificationService、Candidate worktree、deterministic verdict、Reviewer advisory、失败证据与 NEEDS_FIX 重试；复审 DEF-4/5/6/9/10 对应项                                      |
| M4                         | 串行 Integration、Approval、Delivery、完成门与全对象恢复；集成基线在此之前不前进                                                                                                   |
| M5 / M6                    | 替代 PlanRevision、完整 replanning / 决策模型；远端扩展与 mixed-version 验证                                                                                                       |

选择 Mission/Task 仍只保留在会话内，未交付跨重启 UI 选择持久化；不是权威对象丢失。本 Task 不扩展这项产品范围。verifier 核验宿主结果与已知缺口；M2 退出决定由 Henry 在证据与 D58 处置齐备后记录。

M2 之后：先处理 D58 的真实执行阻塞与 M3 验证责任；本参考文档的闭合不代表里程碑已获退出批准。
