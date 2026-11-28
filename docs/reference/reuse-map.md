# 复用清单：还要做的东西，Orca 内核与 T3 Code 里哪些已经有（reuse-map）V1

更新日期：2026-11-21；2026-11-28 复查了 0.1 剩余的任务，见第 10 节 · 内核：本仓库主线 `71ea7a9d96`（Orca 基线见 [orca-mapping.md](orca-mapping.md) 第 10 节）· T3 Code：`pingdotgg/t3code@9f9ebf61`（MIT，2026-11-21）。
来源：验证者 2026-11-21 的两次只读读码，记录在 `claude/reuse-map-orca-t3-v1.md`；界面组件的逐条清单在 `claude/ui-reuse-map-v1.md`（DEF-22 ⑭），T3 的可借机制在 `claude/t3code-review-v1.md`。

## 1. 用途与读法

写任何一份 brief、复审任何一条延后项之前，先在这里找到对应的行，把“内核里现成的”那一列写进 brief 的“先看这里”一节；找不到才新写。依据是 D82 的修订行（2026-11-11）：护城河认真自己做；新建的东西先找现成的；已经跑通的，不为换成更好的而重做。

- **Orca 内核**就在本仓库里：标“直接调用”或只给出位置的可以直接 import；标“要抽”的是逻辑写在界面组件或 IPC 处理函数里，得先搬出来。调用仍要遵守 `AGENTS.md` 的内核边界（经现有的 service 与 RPC 边界扩展，不另起一套）。
- **T3 Code** 自己的 TypeScript 文件约一半建在 Effect 之上（2026-11-28 重数：49%，server 85%），数据模型是“线程”，本仓库没有 Effect。纯 TypeScript 的小件可以带着出处与许可移植（D95：固定到一个提交，文件头写出处与原版权行，`NOTICE.md` 有 T3 Code 的 MIT 声明，产品里不出现它的名称与素材）；绑在 Effect 上的大件仍然只借设计、规则与测试方法。
- **【核】** = 验证者读过那段代码；没有标的 = 文件、行号与符号名经脚本逐条核对过存在（内核 249 处全部对上；T3 272 处对上），“它怎么工作”来自只读子代理的读码报告，用之前要读。
- 路径的省略：界面组件省掉了前缀 `src/renderer/src/components/`；`orchestration/…` 省掉了 `src/main/runtime/`；同一格里只写文件名的，目录与前一个相同。行号是写这份文档时的，会漂移，以符号名为准。
- 这份文档只记“哪里有现成的”，不排任务、不登记延后项：任务在 `docs/plans/`，延后项在 `docs/decisions/DEFERRED.md`。

## 2. 0.1 剩下的任务

| 任务 | 内核里现成的（位置）与用法 | T3 的参照 |
|---|---|---|
| M4-11：批准卡、交付、报告的 Markdown 视图 | Markdown：`components/sidebar/CommentMarkdown.tsx:275`【核】，只靠 props、不碰 store，链接由 `onLinkClick` 接管、图片由 `expandImages` 控制；确认框 `confirmation-dialog-context.ts:47`（已在用；批准的确认不许带“不再提示”，UI 复用图第 1 节第 9 行）；外链 `window.api.shell.openUrl`（主进程只放行 http / https，`src/main/ipc/shell.ts:153`【核】）；对比页地址 `right-sidebar/source-control/review/manual-review-url.ts:112`【核】；提交页地址 `src/main/git/hosted-remote-url.ts:130`；行内 diff `native-chat/NativeChatDiffView.tsx:7`【核】 | 批准决定的词表 `packages/contracts/src/providerPolicy.ts:58`，只作对照 |
| 从远端的最新提交起步（M4-8b 的前置；是否排入 0.1 待定） | **取回不用自己写**：`src/main/runtime/runtime-remote-fetch-controller.ts:31`【核】——`resolveRemoteTrackingBase`（:271）、`getOrStartRemoteTrackingBaseRefresh`（:149）、`hasRemoteTrackingRef`（:315），只刷新一条分支、带去重与超时；具名分支的上游 `src/main/git/status-upstream-ref.ts:17`【核】；默认分支 `src/main/source-control/repo-default-branch.ts:83`；领先与落后 `src/main/git/upstream.ts:96` | “从 origin 起步”与取不到时的退路 `apps/server/src/vcs/GitVcsDriverCore.ts:6139`；默认分支用 `rev-parse refs/remotes/<远端>/HEAD`，远端删了分支时会如实失败 |
| M4-8b 推分支、开 PR | 执行器 `src/main/git/runner.ts`（已在用）与报错归一 `src/shared/git-remote-error.ts`；推送目标校验 `src/main/git/push-target-validation.ts:8`；平台适配 `src/main/source-control/forge-provider.ts:329`【核】的 `createReview`；PR 模板 `src/main/source-control/pull-request-template.ts:39`；`gh` 登录诊断 `src/main/github/auth-diagnose.ts:93`。内核的 `gitPush` 只推工作目录的 HEAD、`createHostedReview` 要求头分支已检出，这两处要各补一层薄的 | 已有打开的 PR 就复用、头不能等于基线（`apps/server/src/git/GitManager.ts`）；去掉 agent 署名 `packages/source-control-core/src/server/mergeMessage.ts`（纯 TS，可移植）；PR 正文的注入评测 `evals/pr-content/` |
| M4-9 PR 状态回读与完成 | `getReviewByNumber`（同上）；CI 列表 `src/main/github/client/check/get-pr-checks.ts:239`，明细 `get-pr-check-details.ts:26`，日志下载 `check-job-log-download.ts:117`——可以直接当证据存；评论 `get-pr-comments.ts:14`；squash 之后认合并 `src/main/github/merged-pr-commit-membership.ts`；轮询节奏 `src/main/source-control/hosted-review-refresh-pacing.ts` | 监视的上限 `apps/server/src/orchestration-v2/pullRequestWatch.ts:11`【核】（连续 10 次只有评论就停、15 分钟没有 CI 就报）；合并的证明规则 `apps/server/src/storageCleanup.ts:290`；CI 汇总规则 `packages/source-control-core/src/server/pullRequestChecks.ts:43` |
| 在应用里合并 PR（未排入计划） | `src/main/github/client/merge/merge-pr.ts:16`【核】与阻塞原因 `:110`；界面参照 `github-item-dialog/land-pull-request/pr-actions-panel.tsx`；自动合并 `pr-auto-merge.ts:148`（0.1 不用，留给 DEF-35） | 合并必须带预期的头提交 `apps/server/src/mcp/toolkits/pullRequests/tools.ts:776`【核】 |
| M4-6b 收尾时对齐 | **冲突预判不用建工作树**：`src/main/github/conflict-summary.ts:48`【核】，在隔离的对象目录里做 `merge-tree`，返回冲突文件与落后多少；中止 `src/main/git/source-control/git-conflict-operation.ts:51`。真正的合并用我们自己的执行器（内核没有“在临时工作树里合并”） | 没有（它不做本地合并） |
| M3-09-4c-2 policy 编辑 | 模型与力度目录 `src/shared/agent-session-option-catalog.ts:47`（已用了一部分）、`agent-session-effort-levels.ts:4`；选择器 `native-chat/NativeChatModelCombobox.tsx`【核】，只靠 props；仓库自带的 setup：`orca.yaml` 的 `scripts.setup`（`src/main/hooks.ts:119`、`src/shared/orca-yaml.ts:200`）【核】，以及把 `.env` 之类带进新工作树的 `.worktreeinclude`（`src/main/git/worktree-include-file.ts`）【核】。**Worker 的工作树已经在用它**（`src/main/axiom/execution/attempt-launcher.ts:128`，`setupDecision: 'run'`）【核】；验证与合并的工作树特意跳过它，只跑 policy 的 `setupCommands`。要不要让它当 `setupCommands` 的默认值是产品问题（脚本得从集成基线读，不能从候选读，否则 Worker 能改验证要跑的东西），做的时候由 Henry 定 | 仓库级文件与分阶段的状态 `packages/contracts/src/t3ProjectFile.ts:26`、`worktreeSetup.ts:10`；模型清单的格式（带各 CLI 的最低版本）`apps/server/src/provider/model-manifest.json` |
| VER-2 / VER-3 | 版本比较 `src/shared/app-version.ts:60`；发布脚本 `config/scripts/create-draft-release.mjs`、`release-policy.mjs`（面向上游的渠道，用之前要读）；更新器还在，按出口策略关着（`src/shared/product-egress-policy.ts:47`） | 发布纪律 `docs/operations/release.md`；打包产物冒烟 `scripts/smoke-desktop-app.ts` |

## 3. 0.1 之后到 V1

| 任务 | 内核里现成的 | T3 的参照 |
|---|---|---|
| M4-3 冲突后的修复 | `getPRConflictSummary`（给修复 Task 的上下文列出冲突文件）；冲突界面 `editor/EditorConflictReviewSurface.tsx`（绑着 store，要抽） | 没有 |
| M4-4 重启恢复的完整版 | 删工作树 `src/main/git/worktree-removal.ts:26`、删之前的检查 `worktree-removal-preflight.ts:11`、删分支 `worktree-branch-removal.ts:17`、“分支已合并”的证明 `src/shared/git-branch-cleanup.ts:256`、操作锁 `worktree-preparation-lock.ts:71`、杀进程树 `src/main/automations/precheck-runner.ts:79` | 哪些副作用重启后可以重放、哪些不可以的分类 `apps/server/src/orchestration-v2/EffectOutbox.ts:144`；孤儿工作树一小时宽限 `storageCleanup.ts:105` |
| M4-12 出口端到端 | e2e 桩 `tests/e2e/helpers/`（已在用）；`.github/workflows/e2e.yml`（含 Windows，现在只能手动触发） | “同一条场景在基线上失败、在候选上通过才算证据”`scripts/prove-scenario.ts`——和我们主机检查的红标题是同一个思路 |
| M5 重新规划、DecisionEngine | 没有可直接用的。递归深度 `orchestration/db/dispatch-depth.ts:208`、熔断 `dispatch-circuit-breaker.ts` 只作参照；内核自己的任务就绪（`task-store.ts:211`）不用，Task 图的权威是我们的 | 没有（它没有任务图） |
| M3-09-5a Attempt 的 transcript | 读会话日志 `src/main/ai-vault/session-transcript-reader.ts:167`、Codex 解析 `session-scanner-codex-parser.ts:44`；终端输出归档（已在用）；显示 `native-chat/NativeChatView.tsx:14` | `apps/server/src/project/AgentSessionScanner.ts:496`（含压缩过的日志） |
| M3-09-6 对话外壳 | `NativeChatView`，卡片 `NativeChatInteractiveCard.tsx:19`、`NativeChatQuestionCard.tsx:48`、`NativeChatApprovalCard.tsx:39`【核】都不依赖 store，可以直接放 Control Plane 的卡片；新建工作区卡 `NewWorkspaceComposerCard.tsx:57` 绑着 store，要抽 | 计划卡 `apps/web/src/components/chat/ProposedPlanCard.tsx:42`；多问题回答面板 `ComposerPendingUserInputPanel.tsx:31` |
| M3-09-7 记分卡 | 计价 `src/main/claude-usage/claude-model-pricing.ts:198`、`src/main/codex-usage/codex-model-pricing.ts`；用量增量（已在用）；统计 `src/main/stats/collector.ts:34` | `apps/server/src/usage/usagePricing.ts:363`、`usageAggregation.ts:216` |
| M3-10 doctor | `src/main/preflight/agent-detection.ts:200`【核】、登录探测 `provider-authentication.ts:26`（受 provider 激活名单约束，不会乱发请求）、CLI 版本 `src/main/agent-cli-version-probe.ts:25`、`gh` 诊断 `src/main/github/auth-diagnose.ts:93`、git 可用性 `src/main/git/git-availability.ts:13`、登录 shell 环境 `src/main/startup/login-shell-environment.ts:246`；已有接口 `preflight.check` | 探测超时 4 秒、认证 10 秒 `packages/provider-core/src/server/snapshotProbe.ts:45` |
| M3-10 的工程纪律（DEF-48） | 棘轮脚本 `config/scripts/run-ratchets.mjs`、`check-import-boundaries.mjs`（是否已覆盖 `src/main/axiom` 没有核实） | 约 27 条自定义 lint 规则 `oxlint-plugin-t3code/rules/`（纯 TS，可移植）：测试里不许真等时间、不许无理由跳过、RPC 不许绕权限等；上下文预算棘轮 `apps/server/src/provider/agentContextBudget.json`；录下的 provider 帧回放 `packages/provider-testing/src/replayTranscript.ts:116`；工具面评测 `evals/mcp-tool-use/` |
| 验证可复现 | 没有 | 只有 `prove-scenario` 的思路 |
| Decision 对象 | `decision_gates`（`orchestration/db/decision-gates/decision-gate-store.ts:10`）——Mission 管的 run 是特意拦掉的，只作参照 | 没有 |
| 知识 K1 / K2（找得到） | 会话全文检索 `src/main/ai-vault-search/session-search-in-process-service.ts:25`；文件检索 `src/main/ripgrep/bundled-ripgrep-text-search.ts:33`（接口 `files.search`）；`QuickOpen.tsx` | SQLite FTS5 trigram 加触发器 `apps/server/src/orchestration-v2/messageSearchIndex.ts:101`；排序函数在 `packages/shared/src/searchRanking.ts`（可移植） |
| 待处理项的提醒（现在没有任务） | 通知 `src/main/notifications/notification-delivery-service.ts:49`、Dock 角标 `src/main/dock/unread-badge.ts:14`、接口 `notifications.subscribe` | `apps/web/src/threadNotifications.ts:42` |
| 执行期间不让电脑睡（现在没有任务；UI 复用图第 1 节第 8 行） | `src/main/agent-awake-service.ts`、`src/shared/computer-awake-mode.ts`（开、关、自动三档）【核：文件与导出在】。休眠会带走子进程，是 Attempt 被打断的来源之一 | — |
| Linux 证据 | `.github/workflows/axiom-ci.yml`（ubuntu，已在跑）；`e2e.yml`（手动） | — |

## 4. V1.5、V2、V3 与延后清单

| 项 | 内核里现成的 | T3 的参照 |
|---|---|---|
| DEF-37、DEF-16、DEF-27 第三种 provider 与 ACP | **ACP 客户端已经有**：`src/main/acp/acp-agent-connection.ts:37`，带 Antigravity、Grok、OpenCode、omp 的方言与启动规格（`acp-launch-specs.ts:342`、`acp-dialects/`）【核】；加一个 agent = `src/shared/tui-agent-config.ts:356` 一条加一份规格 | `packages/effect-acp`、`provider-acp-registry`（按 ACP Registry 接入，不逐个写适配）；`docs/internals/adding-a-provider.md` |
| DEF-39、DEF-47 干活中途的交互与审批桥 | 接口 `agentSession.respondToApproval`、`respondToQuestion`、`currentRequests`；`src/main/acp/acp-permission-requests.ts:44`；权限档 `src/shared/agent-chat-permission-mode.ts:10`；卡片 `NativeChatApprovalCard.tsx:39`。只对结构化的在线会话有效——我们的无界面 Worker 不走这条，要接就得先换 Worker 通道 | 权限档的排序与“子不能宽于父”`packages/contracts/src/providerPolicy.ts:34`、`apps/server/src/mcp/delegatedTaskModes.ts:37` |
| DEF-4 skills | 发现 `src/main/skills/discovery.ts:263`、安装 `skill-bundle-install-service.ts:146`；身份核对已在用 | 只有发现，没有安装 |
| DEF-40 LLM Reviewer | 只有外围：行内评论 `components/diff-comments/`、把评注发给 agent `editor/DiffNotesSendMenu.tsx`、接口 `github.addPRReviewComment`。审查 agent 本身没有 | “导览式”审查的提示词与输出格式 `packages/provider-core/src/server/textGenerationPrompts.ts:197`（1–8 站，明确不找 bug） |
| DEF-33 评测、DEF-10 ⑤ 模拟 Worker | 没有评测；测试桩在 `tests/e2e/helpers/` | `evals/`（真模型上回放、两次采样不一致再加一次）；假 CLI `packages/provider-testing/src/fakeCli.ts:16` |
| DEF-17 记忆、K3 | 没有记忆库（`src/main/memory` 是内存指标） | 没有记忆库；交接时每条压到 240 字符的预算做法 `apps/server/src/orchestration-v2/ContextHandoffService.ts:104` |
| DEF-5 代码图 | 没有 | 没有。仍是 CodeGraph 那条路 |
| DEF-49 外部触发、V3 事件触发的维护 | 定时 `src/main/automations/service.ts:48`、cron `src/shared/automation-cron-occurrence.ts`；没有 webhook | webhook 验签与过滤 `apps/server/src/scheduledTasks/webhookVerification.ts:24`、`webhookFilter.ts:52`（接近可移植） |
| DEF-45 harness 升级 | `src/main/node-runtime/managed-runtime-installation.ts:36`，只管经 ACP 启动的 agent；Claude 与 Codex 的 CLI 没有 | `apps/server/src/provider/providerInstallation.ts:34`、`packages/provider-core/src/server/ProviderLatestVersions.ts` |
| DEF-35 自主度阶梯、自动合并 | `src/main/github/client/merge/pr-auto-merge.ts:148` | 管理员给模式与 provider 设上限 `apps/server/src/policy/ManagedPolicy.ts:33` |
| DEF-34 CI 失败后的自动唤醒修复 | 没有 | PR 监视（见 M4-9 一行） |
| DEF-29 桌面与浏览器控制 | 接口 `browser.*`（`src/main/runtime/rpc/methods/browser-core.ts`）、`computer.*` | 预览自动化的 MCP 工具 `apps/server/src/mcp/toolkits/preview/tools.ts` |
| DEF-26 手机 | 配对与移动网页包还在（`src/main/runtime/mobile-pairing-qr.ts`）；原生 App 的目录不在这个仓库，推送与登录按出口策略关着 | `apps/mobile`（Expo）、配对与签名 `packages/shared/src/remote.ts:205` |
| DEF-43、V2 远程主机 | `src/main/ssh/connection/ssh-connection-manager.ts:17`、WSL、联邦启动 `orchestration/federation/federated-worker-start.ts`——走现有的 worker-start 路，不加新传输 | 环境的身份与连接路线分开 `docs/internals/remote.md` |
| V2 容器与虚拟机隔离 | `src/main/ephemeral-vm/runtime-service.ts:101`（供给、暂停、恢复、清理都有，17 个文件；用途还没有细读） | 没有 |
| DEF-46 出站策略 | `src/main/network/proxy-policy-resolution.ts`（没细读）加我们自己的 `harness-egress-env.ts` | 没有 |
| V3 Control Plane 无界面常驻 | `src/main/orcad/orcad-entry.ts`——**:15 已经引入并启动 `startAxiomControlPlane`**【核】 | 服务端优先、可装成用户级服务 `apps/server/src/cli/service.ts` |
| V3 多人 | 每个接口的权限档 `src/main/runtime/rpc/rpc-method-permission.ts:40`（已在用）；没有用户模型 | 每个方法一个 scope 加一条 lint 规则 `packages/contracts/src/clientRpcPermissions.ts:19` |
| DEF-23 best-of-N、DEF-41 辩论 | 没有 | 子任务委托：子线程只拿任务、不拿父历史（`apps/server/src/mcp/toolkits/orchestrator/tools.ts:89`） |
| DEF-50 Claude 原会话续上 | `src/main/ai-vault/session-transcript-reader.ts:59`、`src/main/claude/claude-rewind-fork.ts:67`（没细读） | — |

## 5. 横向的

| 事 | 内核里现成的 | T3 的参照 |
|---|---|---|
| 密钥脱敏 | `src/main/observability/redactor.ts:99`、`runtime/orchestration/worker-terminal-redaction.ts:111` | 正则 `packages/provider-core/src/server/failure.ts:274`（可移植，用来对一遍我们漏了什么） |
| 命令幂等 | `orchestration/db/mutation-receipts/mutation-receipt-store.ts:37`（参照） | `apps/server/src/orchestration-v2/CommandReceiptStore.ts:40` 加一条竞态测试 |
| 原子写文件、滚动备份 | `src/main/persistence/atomic-snapshot-writer.ts:21`、`src/main/rolling-file-backup.ts:5` | 升级时先拷贝再迁移、不原地改旧库 `docs/user/thread-migration.md` |
| 提交署名、说明生成 | 读用户的 git 身份 `src/main/git/git-username.ts:288`；接口 `git.generateCommitMessage`、`git.generatePullRequestFields` | 去掉 agent 署名 `mergeMessage.ts`（可移植） |
| 本地诊断日志 | `src/main/observability/local-file-sink.ts:66` | — |
| 停滞判断 | `src/main/automations/automation-run-agent-evidence.ts:62`（参照；我们的监工已经做了） | — |

## 6. 已经在用的内核能力（不用再找）

git 执行器与选项；内核管的工作树建与删；orchestration 的 run、dispatch、worker-start；存活三词汇与 Worker 报告准入；预检命令的执行器；模型目录；agent 探测；用量增量与限额；skills 的身份核对；i18n；确认框与 toast；接口权限档；e2e 桩；生命周期事务执行器。逐条的调用点在 `docs/reference/orca-mapping.md` 4a。

## 7. 已知的重复（如实记下，不为换而重做）

1. **脱敏有三处**：我们的 `src/main/axiom/redaction/`，内核的 `redactor.ts` 与终端输出脱敏。做 PR 正文脱敏（M4-8b）时把模式表合成一份，不再加第四处。
2. **Mission 页自己写展开收起**（5 处；M4-11a 照同目录的写法加了两处），内核有 `Collapsible`（`src/renderer/src/components/ui/collapsible.tsx`【核】，36 个文件在用）。行为一样；以后新写的用内核的；要加“复制”时用 `native-chat/NativeChatCopyButton.tsx:13`。
3. **“新工作树里先跑什么”有两个入口**：仓库里的 `orca.yaml`（Worker 的工作树，经内核，已在用），和我们的 policy `setupCommands`（验证与合并的工作树）。这是有意分开的——验证不能听候选的；只是用户要在两处各配一次。见第 2 节 policy 编辑一行。
4. **行内 diff**：`missions/VerificationDiff.tsx`（95 行）与内核的 `NativeChatDiffView`，没有细比。

任务图、提问与批准、副作用 outbox、合并执行器、给 agent 的 MCP 服务这几样，内核要么没有、要么是特意不用的（一个对象只有一个权威生命周期），不算重复。

## 8. 两边都没有、只能自己做的

代码图与符号索引（DEF-5）；记忆库（DEF-17）；沙盒与出站的统一管理（内核只有虚拟机供给和代理策略两个零件）；LLM 审查 agent（DEF-40）；验证可复现；**Axiom 数据库的备份与导出**（内核只备份应用配置——做的时候用内核的滚动备份函数）；JSON 树形查看器；提交署名的 trailer 工具。以及任务图、独立验证、串行集成、完成证据。

## 9. 维护

每周上游初筛时顺带更新；T3 的游标是 `38aaacd480`（2026-11-28；第 2 至第 8 节写于 `9f9ebf61`）。本仓库基线之后上游 Orca 新加的功能没有看过。改这份文档只改“哪里有现成的”，不在这里做决定。

## 10. 0.1 剩余任务的取用清单（2026-11-28 复查）

Henry 2026-11-27 要的复查：0.1 还没做的任务里，Orca 内核和 T3 Code 有什么可以拿来即用。这一节补充并更正第 2 节；两处说法不一样时以这一节为准。

**来源与核对程度。** 两个 Opus 子代理各读一边（内核 8.4 分钟、T3 7.9 分钟）。内核这一份的 89 处“路径:行”验证者在 main `78ac73957d` 上逐条核对：87 处原样，2 处文件名更正（已改在下面）。T3 这一份的 13 处在 `23846b0c` 上核对，全部原样。带 ✓ 的行为是验证者读代码确认的；不带的是子代理的读法，写各任务 brief 时再核对。

**T3 的固定版本。** `pingdotgg/t3code` 的提交 `38aaacd480fe4dba82d71fa7fe565cce15a7858f`（Henry 本地的克隆，干净）。它比清查用的 `23846b0c` 多 1 个提交，只动了 `packages/client-runtime/src/work-log/commandLabel.ts` 和它的测试，与下面列的文件无关 ✓。

**四类。** 【直调】内核里现成，按原样调用。【薄层】内核有、形状差一点，包一层或抽一个函数。【移植】T3 的纯 TypeScript，交 Worker 改成我们的写法（oxfmt、Vitest、不用 Effect），带出处与 MIT 声明。【自写】两边都没有。

### 总的判断

- Axiom 完全没有 Effect（0 处 import，`package.json` 里也没有）✓。T3 自己的 7,869 个 `.ts/.tsx` 文件（不算它仓库里附带的那份 Effect 源码）里，3,884 个引 Effect，49% ✓：server 85%、contracts 98%，各 forge 与 provider 适配器都绑在上面；web 只有 25% 引 Effect ✓，但绑它自己的状态层、UI 套件和 gt-react。整块搬不动；能搬的是十来个纯函数文件，加规则和测试场景。
- 较新的上游 Orca（`60d912e153`）重构了 `remote.ts`、fetch 控制器、`hosted-review-creation.ts`、`merge-pr.ts`，但我们缺的三处接口形状（推一个没检出的分支、不要求当前分支的开 PR、合并时锁定 head）它也没有。
- 我们这一层今天没有从 `src/main/github`、`src/main/source-control`、`git/remote`、`git/upstream`、fetch 控制器 import 任何东西。`.oxlintrc.json:180-252` 禁止 `src/main/axiom/**` 的非测试文件 import `electron`：子代理追过的 import 闭包里没有 `electron`，但 `orca-runtime` 和少数 github client 模块没追，brief 里要核。
- 选 A（Henry 在 GitHub 上合并）时，照这份清单我们这一层不必新写任何一条 `gh` 调用。

### REMOTE-1：开始时取远端目标分支，从它的最新提交起步

- 【直调】git 执行器 `gitExecFileAsync`（`src/main/git/command-runner/git-exec-file.ts:178`），非交互环境在 `src/main/git/command-runner/git-process-env.ts:50-78`。
- 【直调】默认分支：`getRepoDefaultBranchName`、`getRemoteHeadBranchName`（`src/main/source-control/repo-default-branch.ts:83`、`:100`）。
- 【直调】ahead/behind：`parseGitRevListAheadBehindCounts`（`src/shared/git-rev-list-output.ts:13`），对两个明确的 ref 可用。
- 【直调，有条件】单分支 fetch：`getOrStartRemoteTrackingBaseRefresh(repoPath, {remote, branch, ref, base}, gitOptions?)`，经 `OrcaRuntimeService` 的公开包装（`src/main/runtime/workspaces/workspace-metadata.ts:39-68`）✓。它跑 `fetch --no-tags <remote> +refs/heads/<b>:<ref>`，60 秒超时、并发去重 ✓。
- **注意** ✓：`FETCH_FRESHNESS_MS = 30_000`（`src/main/runtime/runtime-remote-fetch-controller.ts:25`）——30 秒内再调直接回 ok、不真取，没法强制；失败只回 `{ok:false, errorKind:'git_error'}`，stderr 只进 console。所以开始时那一次可以用它；收尾对齐和交付前那两次要“一定真取、要拿到失败原因”，用执行器直接跑同一条 fetch。`getOrStartRemoteFetch` 取整个 remote 而且带 tags，不用。
- 【薄层】`resolveEffectiveGitUpstream`（`src/shared/git-effective-upstream.ts:186`：配置的上游，否则 `origin/<同名>`）绑在 HEAD 上，要抽出“给定分支名”的版本。`resolveGitStatusUpstreamRef`（`src/main/git/status-upstream-ref.ts:17`）只验证给定的上游名，不负责发现。
- 【自写】`ensureIntegrationBase`（`src/main/axiom/execution/integration-base.ts:7`）现在取本地 `refs/heads/<targetBranch>`（`:33`），并要求已有的集成分支是本地目标的祖先（`:40`）：两处都要改成以远端跟踪 ref 为准。Mission 开始前的远端预检（有没有 remote、目标分支在远端是否存在、本地有没有没推上去的提交）没有现成的。
- **约束**：M4-2a-3 / STRUCT-1 的检查不许 `integration-base.ts` 里出现带引号的 `'fetch'`、`'push'`、`'pull'` 参数，取与推的代码放新文件。
- 【移植】T3 `apps/server/src/vcs/GitVcsDriverCore.ts`（7,916 行的 Effect 文件）里的三个纯函数，合计 56 行：`fetchFailureDetail`（685-720）、`isRefLockFailure`（723-733）、`parseDefaultBranchFromRemoteHeadRef`（610-618）。测试场景照它的思路写：远端分支被删时不回落到陈旧的跟踪 ref；远端不可达时失败而不是回落；ref 锁竞争重试一次；不取 tags；remote 名长得像选项时要加 `--`。

### REMOTE-2：推送集成分支、开 PR（两个任务）

- 【直调】`validateGitPushTarget`（`src/main/git/push-target-validation.ts:8`）。
- 【直调】`getForgeProviderForRepository({repoPath, executionHostId})`（`src/main/source-control/forge-provider.ts:329`），provider 的 `createReview`、`getReviewForBranch`、`getReviewByNumber`（`:69-81`）。
- 【直调】类型 `CreateHostedReviewInput`（`src/shared/hosted-review.ts:84`：`{provider, base, head?, title, body?, draft?, worktreePath?, useTemplate?}`）；结果码有 `auth_required`、`unsupported_provider`、`already_exists`、`validation`、`timeout`、`unknown_completion`、`push_failed`、`unknown`，带 `existingReview?`。
- 【直调】`createGitHubPullRequest`（`src/main/github/client/create/create-github-pull-request.ts:28`）跑 `gh pr create --repo o/r --base … --title … --body-file <tmp> [--head h] [--draft]` ✓；同一分支已有 PR 时回 `already_exists` 加 `existingReview`（经 `findOpenPRByHeadBase`，`src/main/github/client/create/pull-request-template.ts:9`）✓，所以重试天然不会开第二个；head 等于 base 时拒绝。
- 【直调】`diagnoseGhAuth`（`src/main/github/auth-diagnose.ts:93`）；PR 模板读取；脱敏：我们的 `redactContext`、`detectSecretPatterns`（`src/main/axiom/redaction/redaction.ts:3`、`:12`），内核的 `redactString`、`redactValue`（`src/main/observability/redactor.ts:99`、`:195`）和 `stripCredentialsFromMessage`（`src/shared/git-remote-error.ts:22`）。
- **绕开**：`createHostedReview`（`src/main/source-control/hosted-review-creation.ts:248`）要求 head 是当前检出的分支。不经过它，直接调 provider 的 `createReview` 并给明确的 `head`。
- 【自写】一条 push：明确 refspec、不 force、不设上游。内核的 `gitPush`（`src/main/git/remote.ts:26`）只推 `HEAD` 或 `HEAD:<branch>`，而且总带 `--set-upstream` ✓；内核唯一一处明确 refspec 的 push 嵌在 `src/shared/git-fork-sync.ts:296` 里 ✓，不能单独调用。
- 【自写】停止原因的分类：`normalizeGitErrorMessage`（`src/shared/git-remote-error.ts:154`）给的是给用户看的文字；它的匹配模式（`:163-213`）可参照，分类码我们自己定。
- 【自写】新状态 `AWAITING_MERGE`：`MISSION_STATUSES`（`src/shared/axiom-contract/lifecycle.ts:3`）、`MissionStatusSchema`（`:94`）、终态集合（`:114`）、转移表（`:123`）。`missions.status` 是 `TEXT NOT NULL`、没有 CHECK，不用重建表；旧版本读到新值会解析失败，这是混版本问题，brief 里要交代。
- 【薄层】给人看的 compare 链接：主进程只有 `buildHostedRemoteCommitUrl`（`src/main/git/hosted-remote-url.ts:130`）；renderer 的 `buildSourceControlManualReviewUrl`（`src/renderer/src/components/right-sidebar/source-control/review/manual-review-url.ts:112`，纯函数，闭包 2 个文件）可以抽到 shared，或者只在 renderer 调。
- 【移植】T3 `packages/source-control-core/src/server/mergeMessage.ts`（68 行、零 import ✓，`removeAgentCredits`，测试 6 条）。
- 【移植，先比对】T3 的脱敏正则 `packages/provider-core/src/server/failure.ts:269-324`（Effect 文件里的纯函数 ✓，测试 17 条）：先看和我们已有的 `redaction.ts` 重不重，只补缺的模式。
- 只作参照：T3 `packages/client-runtime/src/state/gitActions.ts`（498 行，绑 gt-i18n ✓）里 push 的前置规则；`buildPrContentPrompt`（`packages/provider-core/src/server/textGenerationPrompts.ts:92-169`）——我们的 PR 正文由 completion report 确定地生成，不用模型写。

### REMOTE-3：读回 PR 状态，合并后落地

- 【直调】`HostedReviewInfo`（`src/shared/hosted-review.ts:30`）：`state` 为 `open`、`closed`、`merged`、`draft` 之一，另有 `mergeable`、`reviewDecision`、`mergeStateStatus`、`headSha`、`baseRefName`、`conflictSummary` 等 ✓。
- 【直调】`getPRChecks`（`src/main/github/client/check/get-pr-checks.ts:239`）、`getPRCheckDetails`（`src/main/github/client/check/get-pr-check-details.ts:26`）、`startCheckJobLogDownload`（`src/main/github/client/check/check-job-log-download.ts:117`）、`getPRComments`（`src/main/github/client/fetch/get-pr-comments.ts:14`）。
- 【直调】`isCommitPartOfMergedPR`（`src/main/github/merged-pr-commit-membership.ts:52`，回 `contained`、`not-contained` 或 `unknown`）；节奏常数 `src/main/source-control/hosted-review-refresh-pacing.ts:11-30`。
- 【我们已有，直接接】60 秒的那一个 `setInterval`（`src/main/axiom/control-plane-boot.ts:68-71`）→ `sweepExecutingMissions`（`src/main/axiom/scheduler/mission-sweep.ts:9`，现在列 EXECUTING 和 FINALIZING）；outbox 的 `register`、`enqueue`（`src/main/axiom/outbox/effect-outbox.ts:38`、`:46`），种类表 `src/shared/axiom-contract/effects.ts:5`；本地快进用 `advanceLocalBranch`、`advanceIntegrationHead`（`src/main/axiom/execution/integration-base.ts:83`、`:67`，compare-and-swap 的 `update-ref`，拒绝已检出的 ref）。
- 【自写】`HostedReviewInfo` 没有 merge commit，也没有 mergedAt ✓。读到“已合并”之后要取回目标分支，自己认定落地的提交并记下。sweep 加 `AWAITING_MERGE`。
- 【移植，先比对】T3 `packages/source-control-core/src/server/pullRequestChecks.ts`（104 行：汇总、排序、去重；两处 Effect import——`DateTime`、`Option`——要换掉 ✓；测试 10 条）：先比内核的 `getCheckCounts`、`getChecksSummaryLabel` 是否已经够用。
- 【移植，规则】“已合并”的证明：`storageCleanupPullRequestMerged`（T3 `apps/server/src/storageCleanup.ts:297-317` ✓——squash 或 rebase 合并时，要求 PR 记的 head 正是我们推的那个提交）和 `:1803-1826` 的 `merge-base --is-ancestor`。
- 【移植，只取规则】T3 `apps/server/src/orchestration-v2/pullRequestWatch.ts`（573 行的纯评估器，1 处 Effect import ✓，测试 43 条）：只取与读回有关的上限（2 分钟一轮、连续 8 次读失败、15 分钟仍没有检查）；其余是唤醒 Agent 用的（DEF-34，0.1 之后）。

### REMOTE-4：应用内合并（只在第 16 件第 2 条选 B 时）

- 【直调】`mergePR`（`src/main/github/client/merge/merge-pr.ts:16`：`gh pr merge <n> --<method> [--repo]`）、`getPRMergeBlocker`（`:110`）、`formatMergeConflictBlocker`（`:166`）；renderer 的 `PRActionsMergeMenu`（`src/renderer/src/components/github-item-dialog/land-pull-request/pr-actions-merge-menu.tsx:18`，只吃 props，另有一处 `window.api.shell.openUrl` ✓）。
- 【自写】合并时锁定 head：内核没有 `--match-head-commit`。T3 的做法可照：`apps/server/src/pullRequest/PullRequestService.ts:2418-2446`；按钮状态的规则 `resolvePullRequestPrimaryControl`（`apps/web/src/components/pullRequest/pullRequestDetail.logic.ts:101-125`）。

### REMOTE-5：收尾对齐时遇到冲突

- 【薄层】`getPRConflictSummary`（`src/main/github/conflict-summary.ts:48`）：不需要 worktree；remote 名写死 `origin`（`:170`）；10 秒预算。
- 【自写，改我们自己的】`mergeIntegrationCandidate`（`src/main/axiom/integration/integration-merge.ts:39`）和单个 Task 绑在一起：提交信息 `axiom: integrate <candidate.id>`、父提交检查（`:84`）、`createIntegrationScratch(runtime, mission, batch, taskId)`、`runIntegrationRegression`；`IntegrationBatchSchema` 的 `candidateIds` 长度固定为 1（`src/shared/axiom-contract/integration-batch.ts:50`、`:54`）。
- T3 没有可用的：它不做本地合并。

### M4-11b：交付的批准卡

- 【直调】`CommentMarkdown`（`src/renderer/src/components/sidebar/CommentMarkdown.tsx:275`，只吃 props）；`useConfirmationDialog`（`src/renderer/src/components/confirmation-dialog-context.ts:47`）；`window.api.shell.openUrl`（只放行 http 和 https，`src/main/ipc/shell.ts:153`、`:160`）。
- 【直调】CI 检查的行与汇总，都只吃 props 或是纯函数（这几个文件里没有 store 和 `window.api` 的引用 ✓）：`ChecksTabCheckRow`（`src/renderer/src/components/github-item-dialog/inspect-pull-request/checks-tab-check-row.tsx:40`）；`CHECK_ICON`、`CHECK_COLOR`、`prStateColor`（`src/renderer/src/components/right-sidebar/checks-panel/check-presentation.tsx:15`、`:27`、`:39`）；`getCheckCounts`、`getChecksSummaryLabel`（`src/renderer/src/components/pr-check-counts.ts:24`、`:99`）；`getCheckStatusLabel`（`src/renderer/src/components/github/pr-check-presentation.ts:8`）；`presentGitHubPRMergeState`（`src/renderer/src/components/github-pr-merge-state.ts:90`）。
- 【自写，小】`src/renderer/src/lib/axiom-client.ts` 里没有 `axiom.approval.grant`、`axiom.approval.deny`、`axiom.mission.deliver` 的客户端方法 ✓。主进程的处理器早就有（`src/main/runtime/rpc/methods/axiom/approval.ts:10`、`:20`，`mission.ts:29`），都是 `desktop_only` ✓。加三个方法；注意这个文件 300 行的 lint 上限。
- 【自写，小】评审结论的小徽章：内核没有只吃 props 的现成件（`PRReviewCell`、`HostedReviewActions` 都绑 store）。
- 【我们已有】待处理项 `delivery_approved`、`delivery_approval_pending` 出自 `src/main/axiom/read-models/mission-pending.ts:38-61`，由 `src/renderer/src/components/missions/MissionPendingList.tsx` 通用渲染。
- T3 只作参照：`ApprovalText.tsx`、`pullRequestPresentation.tsx`、`ChatMarkdown.tsx:433-447` 的 `safeUrl`。

### M3-09-4c-2d：角色的模型与力度

- 【直调】`getAgentSessionOptionCatalog`（`src/shared/agent-session-option-catalog.ts:47`）；`NativeChatModelCombobox`（`src/renderer/src/components/native-chat/NativeChatModelCombobox.tsx:37`，只吃 props）。
- 【薄层】`agentSessionEffortLevels`（`src/shared/agent-session-effort-levels.ts:4`）：入参是 wire 上的 model option。
- 【我们已有】`RoleRoutingSchema`（`src/shared/axiom-contract/mission-objects.ts:187`：`{provider?, model?, effort?}`）。第 26 件说的问题在 `src/main/axiom/agent-factory/agent-factory.ts:146-153` ✓：不管最后选中的是哪一家 provider，都先用角色上写的模型。
- T3 只作参照：`apps/server/src/provider/model-manifest.json` 的格式。

### VER-2、VER-3：版本与发布

- 【直调】`compareAppVersions`（`src/shared/app-version.ts:60`）；VER-1 做的 `src/shared/orca-baseline.ts`（`ORCA_BASELINE` `:4`、`isAxiomLineVersion` `:9`、`upstreamLineVersion` `:17`、`compareAppVersionsAcrossLines` `:22`）；`package.json:3` 现在是 `1.4.214`，经 `app.getVersion()` 读。
- 【直调，用之前先读】`config/scripts/create-draft-release.mjs`、`config/scripts/release-policy.mjs`。
- 【移植】T3 `scripts/smoke-desktop-app.ts`（141 行，只用 Node 内置模块加 playwright-core ✓）：打包后的应用冒烟。发布手册 `docs/operations/03_release.md` 只作参照。

### 0.1 之后才看的

D89 第 8 条：0.1 之前不从外部项目的清查往 DEFERRED 与任务行登记新条目，所以这里只记一笔。

- T3 的 lint 插件 `oxlint-plugin-t3code/rules`（36 条）里通用的几条：`require-suppression-reason`、`no-test-timeout-or-unreasoned-skip`、`no-wall-clock-in-tests`、`no-polling-loop-in-tests`、`no-test-in-loop`、`no-unreasoned-state-sync`、`no-em-dash-copy`、`namespace-node-imports`。
- `pullRequestWatch.ts` 里唤醒 Agent 的那一大半（DEF-34）。

### 对第 2 节的更正

- “只取一个分支、去重、超时”只对 `getOrStartRemoteTrackingBaseRefresh` 成立，而且它有 30 秒的新鲜期。
- `status-upstream-ref.ts:17` 不发现上游，只验证给定的名字。
- `getPRCheckDetails` 和 `startCheckJobLogDownload` 不在 `get-pr-checks.ts`，各在 `get-pr-check-details.ts` 和 `check-job-log-download.ts`。
- 第 2 节没写的：我们这层怎样够到 fetch 控制器（runtime 的公开包装）、`git-effective-upstream.ts`、已有 PR 时的 `already_exists`、只吃 props 的 CI 检查件、`axiom-client.ts` 缺的三个方法。
- 第 2 节引的其余内核路径与行号，在 main 上仍然对得上（子代理核对）。

### 许可与商标

T3 Code 是 MIT 许可，版权行属于 T3 Tools Inc.。它的 `TRADEMARK.md` 不许用 T3 Code、T3 Connect、T3 Tools 的名称、字标、logo、图标、`assets/` 和域名，只允许一句如实的出处说明。移植来的文件：文件头写出处（仓库、提交、原路径）和版权行；`NOTICE.md` 加一条 T3 Code 的 MIT 声明。Henry 2026-11-28 已同意把 T3 的代码放进产品（D95）；`NOTICE.md` 的条目随第一个移植 T3 文件的任务的规划提交加入。

### 怎么用这份清单

每个任务发出前：Opus 子代理按这里的条目出一份“适配单”（调哪个函数、签名、和我们要的差在哪）→ 验证者核对 → 写进 brief 开头的“先看这里”（路径加行号）→ 验证清单里加“必须调用现成的、不许另写一份”的检查。要移植的 T3 文件，按上面固定的提交把源文件和它的测试附给 Worker。
