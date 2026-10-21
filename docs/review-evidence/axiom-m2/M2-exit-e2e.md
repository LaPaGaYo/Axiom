# M2 出口：fixture-v1 的 Planner、Attempt、Submission 与恢复证据

记录日期：2026-10-20 · Task M2-11 / attempt 2（基于已合入的 M2-12 / D59）。本文是出口证据索引，不是 M2 关闭决定。Worker 仅改测试、测试 helper、文档与证据目录的 Git 跟踪规则；本次宿主实跑和最终 VerificationRun 由 verifier 填写，里程碑退出由 Henry 决定。

Attempt 1 发现的 shell 存活时 agent 退出不可见、kernel-first 退出缺少 `attempt.failed`、启动时已有 READY Task 未调度，均由 M2-12 / D59 修复，独立记录见 [M2-12 验证](../../../.axiom-work/verifications/M2-12-1.md)。本次保留出口断言，并按该记录修正查询与重试关系；历史诊断分支的宿主 PASS 不代替本候选的六 spec 宿主复验。真实 provider 仍 blocked on D58 的通道实施与认证证据。

## 运行与证据边界

```sh
AXIOM_FIXTURE_REPO=$HOME/Documents/flowtask-fixture ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e tests/e2e/mission-exit-m2.spec.ts tests/e2e/mission-attempt-submit.spec.ts tests/e2e/mission-attempt-launch.spec.ts tests/e2e/mission-plan.spec.ts tests/e2e/mission-task-detail.spec.ts tests/e2e/mission-home-task-list.spec.ts
```

使用宿主已配置的 Node 24 / pnpm 12，global setup 构建 e2e mode 应用与 `out/cli/index.js`，运行 electron-headless；不显示窗口。共享 `axiom-fixture-mission.ts` 只从本地 clone（Git file protocol）复制 fixture，要求 HEAD 与 `fixture-v1^{commit}` 都等于 `a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642`（D42）。仅未设置 `AXIOM_FIXTURE_REPO` 时 skip；skip 不计 PASS。

新 spec 的 `{ planner: true, holdWorkers: true }` 经真实 `axiom mission plan` 获取提案，helper 断言 PLAN_REVIEW、provenance、12 Tasks / 20 edges / T01–T03 三根后 approve/start。放行点只暂缓 D49 provider 已有的 `attempt show` 绑定轮询，preamble ACK 和三个 Worker 的真实启动照常完成；同一次 `attempt list` 必须有三个 `RUNNING` 且 `live`。随后为 T01 写一次性 crash marker，再放行：marker 在 stub 前删除，`agent-crash --mode crash` 非零退出，不上传/提交；seq 2 按原 retry/succeed 路径提交。恢复轮询上限 120 秒，不假定 mailbox 或 60 秒 reconciliation 谁先触发。

数据库访问仅只读 SELECT；拒绝快照按固定顺序序列化完整 `attempt_bindings`、`task_stages`、`candidates`、`submissions`、`verification_runs`、`dispatch_contexts`、`worker_dispatches` 行，并包含 fixture 所有 refs 的名字与 object id。每种请求各自取前后快照并逐字节比较，不去掉状态/时间字段。`audit_events` 与 `mutation_receipts` 不在比较内；测试不通过 SQL 注入重试或伪造 dispatch。

## 六条出口标准

| # | 标准与当前证据 | 结论边界 / Decision |
|---|---|---|
| 1 | `mission-exit-m2.spec.ts` + `axiom-fixture-mission.ts`：Goal → Planner → PLAN_REVIEW → approve/start；12/20/3、同一 poll 的三 RUNNING/live、9 DEFINED；最终三个 SUBMITTED、三个 ACTIVE Candidate、commit/tree 均不同于基线且匹配实际 Git 对象、Submission 绑定、每 Candidate 一个 QUEUED VerificationRun。逐项保留 `mission-attempt-submit.spec.ts` 的 Candidate 断言。已有分别验证见 [M2-09](../../../.axiom-work/verifications/M2-09-2.md)、[M2-07](../../../.axiom-work/verifications/M2-07-2.md)、[M2-10 宿主五 spec](../../../.axiom-work/verifications/M2-10-1.md) | 组合出口本次待实跑。实际 provenance 是 `{kind:'planner',actor:'codex'}`，遵循 M2-09 合同；D48 / M2 计划的旧 `kind='model'` 文案不作为断言或新枚举。D49 / D51 / D52 |
| 2 | 新 spec 的 `reject()` 每次断言精确 code、正常非零退出、无 signal/transport error 与 snapshot 字节相同；认证重复返回完整原 Submission/Candidate + `duplicate:true`，同样比较快照。细分见下表；`rpc-attempt-channel.test.ts` 另有九种拒绝及收据回放/异载荷测试 | 组合宿主待实跑；重复是幂等成功，不是错误。D4 / D15 / D16；已有 [M2-07 验证](../../../.axiom-work/verifications/M2-07-2.md) |
| 3 | D49 ✓：`mission-attempt-submit.spec.ts` 已宿主通过三 Worker 提交，[M2-10 验证](../../../.axiom-work/verifications/M2-10-1.md) 重跑确认；新 exit spec 本候选待实跑。真实 provider **blocked on D58**：[M2-09-smoke-codex.md](../../../.axiom-work/verifications/M2-09-smoke-codex.md) 十一次真实 Planner smoke 未获得提案 | D57 的 **2026-10-20 修订行**保留 codex provisional；[D58](../../decisions/DECISION_LOG.md) 已 ACCEPTED：B structured/app-server 首选、A exec 后备，通道实施与 AgentSpec 权限映射、认证证据待补。D49 不等于真实 Codex 认证，不能声称“三 provider”通过 |
| 4 | 新 spec 断言：单次 crash；Attempt 1 FAILED、seq 2 SUBMITTED、branch `/2`、`dispatch_contexts.retry_of_dispatch_id` 为 null、该 Task 仅一个 Candidate；完整 stage 审计 READY → RUNNING → NEEDS_FIX → READY → RUNNING → SUBMITTED；`attempt.failed.after` 必须为 `reason: process_exited, evidence: shell_foreground`，且早于 seq 2 `attempt.started`。D59 / M2-12 规则 c′ 使用执行宿主的新鲜前台进程名证明（`confirmForegroundProcess`，方法缺失时 `getForegroundProcess`，经 `isShellProcess` 判定），不是 recovery barrier owner；规则 b 补幂等 `attempt.failed{kernel_failed}`；boot 对绑定完好的 EXECUTING Mission 请求 resume。证据：`src/main/axiom/recovery/attempt-reconciliation.test.ts` 的 live-shell exit、无证明/starting 不结算、Submission race、kernel-failed 审计顺序与幂等；`src/main/axiom/control-plane-boot.test.ts` 的已有 READY / 丢失绑定 / 空轮；`src/main/runtime/orca-runtime-tests/terminal-shell-foreground-confirmation.spec.ts` 的 shell/非 shell、fallback、barrier、超时/异常测试；[M2-12 验证](../../../.axiom-work/verifications/M2-12-1.md) | 检测延迟 = reconcile 间隔（60 s）；agent 退出后 ≤ 一个间隔内 `attempt show` 仍可报 RUNNING/live。首次 failDispatch 将 Orca Task 置 ready，kernel retryOf 只接受 failed/blocked（circuit-break / abandon），故此处 lineage 列为 null；Axiom 重试关系 = `attempt_bindings` seq 顺序 + failed → started{seq:2} 审计。重启半条复用 `mission-attempt-launch.spec.ts` 的启动前 live、重启后绑定/Task/ledger/Attempt ids 不变断言（重启后允许 live/exited/unverifiable）；[M2-05](../../../.axiom-work/verifications/M2-05-6.md)、[M2-10](../../../.axiom-work/verifications/M2-10-1.md) 已宿主通过；其他恢复证据见 `attempt-restart.test.ts` / [M2-08 验证](../../../.axiom-work/verifications/M2-08-2.md)。本候选宿主结果待填。D49 / D52 / D59 |
| 5 | 映射 §4b 逐入口测试与每 verb capability 测试见下两表；独立记录 [M1-07](../../../.axiom-work/verifications/M1-07-1.md)、[M2-06a](../../../.axiom-work/verifications/M2-06a-3.md)、[M2-06b](../../../.axiom-work/verifications/M2-06b-1.md)、[M2-07](../../../.axiom-work/verifications/M2-07-2.md) | 这些是 RPC/单元证据，不能称为新出口宿主已经通过。D10 / D11 / D16 / D50 |
| 6 | 逐行核对 [DEFERRED.md](../../decisions/DEFERRED.md)，触发状态见下表；保留所有 OPEN 项，不修改登记 | D45、D54–D57；本次不代替 Henry 作延期/范围决定 |

## 四类提交的精确合同

| 情形 | 固定预期 | 快照 / 证据 |
|---|---|---|
| forged：已提交 A + `dcap_wrong` | `dispatch_capability_invalid` | capability hash 在关联检查前失败；保持 M2-07 原 spec 不变并在本 flow 重复断言 |
| duplicate：A 原 capability、原 assignee pane/process、新请求 id | 成功，`duplicate:true`（无 error code） | 完整原 Submission/Candidate 相等；不新增 Candidate / Submission / VerificationRun；不是只回放同一个 request receipt |
| stale：crash seq 1 capability，Task 已完成 seq 2 | `inactive_dispatch` | `resolveAttemptIdentity` 先检查旧 dispatch 非 dispatched；此场景不达后面的 `stale_dispatch` seq 栅栏 |
| mismatched：`--attempt A` + B capability | `dispatch_capability_invalid` | hash 校验先于 Task/Mission 关联校验；真实 `task_dispatch_mismatch` 的防御分支由 `attempt-authority.test.ts` / RPC 单测覆盖 |

## §4b 拦截证据逐行索引

以下文件均位于 `src/main/axiom/admission/`。Mission 拒绝时检查状态不变，同时保留非 Mission 对照。

| 映射 §4b 入口 | 测试文件与断言 |
|---|---|
| taskUpdate(status) | `admission-rpc.test.ts`：refuses Mission taskUpdate completed |
| reset all/tasks/messages | `admission-rpc.test.ts`：三个 scope 均在副作用前 mission_managed；`mission-managed-run-guard.test.ts`：取消后仍阻止 reset |
| workerStart / dispatch | `admission-rpc.test.ts`：两 verb 拒绝，无 sendTerminalAgentPrompt |
| send worker_done / merge_ready / dispatch / decision_gate | `admission-message.test.ts`：四种类型在同步结算前拒绝 |
| gateCreate / gateResolve | `admission-rpc.test.ts`：两 verb 拒绝，gate/Task 不变 |
| runUse / takeover-legacy | `admission-run.test.ts` + `admission-rpc.test.ts`：takeover/plain rebind 不改绑定/generation |
| retired run / runStop / coordinator-start | `admission-rpc.test.ts` 固定 run/runStop 的 command_retired；CLI 的 `src/cli/handlers/orchestration-caller-identity-cli.test.ts` 固定 coordinator-start 退役 |
| taskCreate 有/无 deps | `admission-rpc.test.ts`：两种形状均拒绝 |
| workerStop / workerAbandon | `admission-worker-control.test.ts`：两 verb 不改变资源/状态、不 closeTerminal |
| workerRelease / workerRetain / workerTerminalUserInput | 同上：三 verb，含已结算资源与 pane/session/reminted-pane 输入 |
| orchestration.ask | `admission-rpc.test.ts`：live dispatch 在 createQuestion 前拒绝 |
| orchestration.reply | 同上：plain/question 原消息、Mission Worker 向普通 Run 回复均拒绝 |
| send(group) | 同上：`@all` / `@worktree` 在发送前拒绝 |
| workerStart --on | 同上：Mission 在 startFederatedWorker 前拒绝，普通 Run 到达 federation seam |

| `axiom attempt` verb | capability / 无状态变化证据（`src/main/axiom/`） |
|---|---|
| inform / request / blocked / handoff / request-subtask | `rpc-attempt-channel.test.ts` 的 workerVerbs 参数化矩阵：missing/wrong/stale/foreign/inactive；sender_not_assignee 防御测试 |
| check | `rpc-attempt-check.test.ts`：missing/wrong/stale/foreign/inactive，及长轮询后 generation 重验 |
| ask | `rpc-question.test.ts`：missing/wrong/stale/foreign/inactive，resume/timeout/answer；M2-06b |
| submit | `rpc-attempt-channel.test.ts`：九种拒绝、无领域/观测/资源/消息/审计/receipt 变化、Git 未调用；收据重放与 forged duplicate |
| 共享 authority / 只读投影 | `execution/attempt-authority.test.ts`：revoked/incarnation/pane、unknown、binding mismatch；`rpc-attempt.test.ts`：list/show 与宿主 liveness（用户读接口不属于 Worker capability verb） |

## DEFERRED 触发状态核对

| 项 | M2 出口状态与下一个触发点 |
|---|---|
| DEF-1 | RESOLVED（D45），本次不重开 |
| DEF-2 | OPEN，Settings/Integrations 激活 UI 排期未触发；M2-10 仅恢复快捷键文案 |
| DEF-3 | OPEN，首个 Axiom 发布 Decision 前；本次不发布 |
| DEF-4 | OPEN，2026-10-20 已复审；M2 仅可选 TaskSpec.role 标签；RoleProfile/skills/人工确认延到 M3 Reviewer 前 |
| DEF-5 | OPEN，2026-10-20 已复审；Planner v1 无 CodeGraph/ripgrep 仓库地图；M3 验证范围设计再审，真实提案质量观察目前被 D58 阻塞 |
| DEF-6 | OPEN，② 2026-10-20 已复审并由 M2-10 实现单列 typed timeline；完整多面板与③ Reviewer fix 契约在 M3；① 去抖在 M5 |
| DEF-7 | OPEN，V1 出口或首个内核替换提出时；M2 不触发 |
| DEF-8 | OPEN，V1 后或首次需要非订阅模型时；当前 subscription 不变 |
| DEF-9 | OPEN，M3 VerificationService brief 前定义只读记分卡指标；无评分驱动路由 |
| DEF-10 | OPEN，⑤ 2026-10-19 已复审为 M2-08 恢复/有界重试单测，chaos harness 延 M3 出口；①②③ 2026-10-20 已复审不进 M2，①③ 在 M5，② 随 DEF-5 在 M3，④ M4 CompletionReport 时 |

## 宿主实跑结果（由 verifier 填写）

下表由 verifier 于 2026-10-20 填写（宿主 chain 于 main `06a502151c`）。宿主 `[M2-exit]` JSON 与同名 Playwright 附件包含 counts、精确 codes、retry 身份、审计 sequence、Candidate commits；不输出 capability。

| 项目 | 预期 | 实测 |
|---|---|---|
| Candidate / 宿主版本 / 日志 / VerificationRun | verifier 记录 | 候选 `dbd01a9ec5`（M2-11/2）→ main `06a502151c`；宿主 macOS / Node v24.21.0 / pnpm 12.0.0 / Codex 0.163.0；`.axiom-work/logs/chain-20261020-181715.log`（出口 spec + 五个 spec）、`verify-merged-06a502151c-20261020-182109.log`；记录 `.axiom-work/verifications/M2-11-2.md`、`M2-12-1.md` |
| fixture HEAD/tag | a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642 | `fixtureCommit: a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642`（集成基线与 `refs/heads/main` 未变） |
| Planner provenance / Tasks / edges / 并行 RUNNING | planner/codex / 12 / 20 / 3 | planner/codex（helper 断言）/ 12 / 20 / `parallelRunning: 3` |
| SUBMITTED / ACTIVE Candidates / Submissions / QUEUED | 3 / 3 / 3 / 3 | 3 / 3 / 3 / 3（`candidateCommits` 三个互异） |
| forged / duplicate / stale / mismatched | dispatch_capability_invalid / duplicate:true / inactive_dispatch / dispatch_capability_invalid | `dispatch_capability_invalid` / `duplicate:true` / `inactive_dispatch` / `dispatch_capability_invalid` |
| 四次持久快照与 refs 比较 | 均逐字节相同 | `snapshotsIdentical: true` |
| crash / retry / kernel retryOf / 审计顺序 | 1 FAILED（process_exited + shell_foreground）/ seq 2 SUBMITTED / null（Axiom bindings + audits 关联）/ failed < started | crash `ctx_bc82f5ac8bc6` FAILED（`attempt.failed{process_exited, evidence: shell_foreground}` sequence 54）/ retry `ctx_fafa0de68c7c` SUBMITTED（`attempt.started{seq: 2}` sequence 60）/ `retry_of_dispatch_id` null / 54 < 60；stage 序列 READY → RUNNING → NEEDS_FIX → READY → RUNNING → SUBMITTED |
| 五个既有 fixture/UI specs | 各自 PASS，未 skip | 5 passed（30.7 s，5 workers）：home-task-list 6.8 s、plan 13.2 s、attempt-submit 17.6 s、task-detail 19.4 s、attempt-launch 19.4 s（`restartLiveness: live ×3`） |
| 新 exit spec | PASS，未 skip，headless | 1 passed（1.1 min，wall 82 s），electron-headless，`ORCA_BACKGROUND_LAUNCH=1` |
| 真实 provider | blocked on D58 通道实施与 D57 认证证据 | 未取得（D58 已由 Henry 接受：B 首选 / A 后备；证据在所选通道采集，M3 前置项） |

## Worker 检查与遗留

本次命令、结果、工具链限制、typecheck:e2e 诊断差值及 hygiene 结论见 [M2-11-2 报告](../../../.axiom-work/reports/M2-11-2.md)；[M2-11-1 报告](../../../.axiom-work/reports/M2-11-1.md) 保留历史发现，其退出审计与启动调度缺口已由 M2-12 修复。Worker 没有运行 Electron；不以静态检查代替宿主实跑。`verification_runs` 在本 flow 始终 QUEUED，独立验证属于 M3，集成/Approval/Delivery 属于 M4。选择 Mission 跨重启持久化与 D58 通道实施不在本次改动范围。
