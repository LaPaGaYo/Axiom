# REVIEW.md — 审查这个仓库的变更时看什么

给审查 Axiom 变更的人和 agent：A-lite 流水线里的验证者（现在）、M3-04b 之后在提交前自查的 Worker、以及 V1.5 的 Reviewer 角色（DEF-40）。目的是抓真问题、少吵架：确定性门禁已经覆盖的不要再手审一遍；每条意见都要有文件 + 行号和依据；总览先给数量，没问题就明说"没有发现"。规则本身在 `AGENTS.md` 和 `docs/PROJECT_CONSTITUTION.md`，这里只说审查时怎么用它们。

## 1. 什么算这个项目的失败（优先抓，阻塞）

1. **绕过权威状态**：renderer、Worker 或模型适配器直写 orchestration SQLite；UI 推断执行真相；第二套 Task / Worker / Approval / Integration 状态存储；并行的 worktree、终端或 worker 生命周期（不变量 1、3、5、6）。
2. **把 Worker 的说法当证据**：`checksRun`、报告里的"全绿"或 Worker 摘要进了 verdict；模型或人的 `resolve` 推翻确定性 FAIL；Reviewer / DecisionEngine 越过依赖就绪、授权范围、必需测试、Approval、合入顺序（不变量 4、7、10）。
3. **失联当成退出**：RPC / SSH / relay 断开被写成 exited、failed 或 completed（必须是 `unverifiable`）；同一 worktree 上冷启动第二个 Agent（不变量 9）。
4. **不可恢复**：durable 行为依赖一段对话或内存里的调度器；状态转换不是事务、不幂等；schema 变更没有 migration（`SCHEMA_VERSION` + skew 表）；Approval 可复用或不绑定精确动作。
5. **打破混合版本**：RPC 参数、流帧或宿主发布数据改了非 additive 的字段，没有能力协商。
6. **泄密与越权**：secret 进日志、提示词、Artifact、测试输出或 evidence 文件；权限、凭据或网络范围未经 Approval 扩大；Worker 直接 spawn Worker；读写用户真实的 `~/.codex` / `~/.claude`。
7. **破坏用户工作**：`git reset --hard`、`checkout -- .`、`git clean`、宽泛路径的删除；改了 Task scope 之外的文件；格式化了没改的文件；动了 `config/patches/**`、`package.json`、lockfile；在沙盒里跑 `pnpm install / add / remove / rebuild`。

## 2. 确定性门禁已经覆盖的（看结果，不手审）

typecheck（node / cli / web；`typecheck:e2e` 基线只降不升）、单元与 e2e 目标、changed-code quality、全量 lint、`format`、design-system 报告、vendor-egress ratchet、`rpc-params-catalog`、process-host 直接 import 基线（不长、不开第二个 spawn 点）、`@ts-nocheck` 禁入、diff 里的凭据模式、测试篡改门（删测试 / skip / 断言减少 / 抑制）、硬编码的未来日期、报告里的 "work in progress"、sidecar 里的文件与文本断言。门禁红了就是红了，审查意见不讨论"其实没关系"；要改门禁本身，走 Decision。

## 3. 审查时看什么（按价值排序）

- 变更是否真的解决了 Task 说的问题；是否落在 `allowedPaths` 内；有没有顺手扩范围——新工作应成为 Question、Decision 提案、后续 Task 或 `REQUEST_SUBTASK`，不是 diff 里的"顺便"。
- 是否复用了已有实现（先搜 service、RPC、schema、测试），还是又造了一套（`utils` / `helpers` / 第二个 manager / 平行的生命周期）。
- 生命周期：每个新状态转换的前置条件、事务边界、重试幂等、重启后的恢复路径；失败路径有没有被记录而不是吞掉；成功路径和失败路径是否对称（例如释放终端）。
- "读不到就失败"和"读不到就记不一致"要分清：安全相关 fail-closed，观测类记 mismatch 并继续。
- 测试覆盖的是改动的行为而不是实现细节；fixture 与 brief 里的"事实"是否正确——Worker 可以纠正 brief 的事实，但必须写进报告。
- 文档：公共行为、边界、生命周期、RPC / schema、权限、恢复流程、构建部署变了，对应文档和 Decision 是否同步；同一规则不要复制到第二份文档，引用它。

## 4. 不要挑的（nit 不阻塞）

命名风格、注释措辞、import 顺序、等价写法、测试文件的组织——除非违反 `AGENTS.md` 的明文规则。格式交给 `pnpm format`。

## 5. 忽略的路径

`docs/archive/**`、`docs/review-evidence/**`（证据归档）、`.axiom-work/**`（流水线工作区，不是产品代码）、`tests/e2e/.cross-version-checkouts/**`、生成文件 `src/shared/rpc-contract/rpc-params-catalog.generated.ts`（审生成脚本，不审产物）、上游 Orca 原样同步的文件（看 `docs/decisions/UPSTREAM_SYNC.md`）。

## 6. 意见的格式

每条意见：严重级别（important / nit / pre-existing）、文件 + 行号（不猜文件名）、违反的规则或不变量（`AGENTS.md` 条目、Decision 编号）、怎么证明（能跑的命令或测试优先）。顶部一行总览：发现数量；没有就写"没有发现"。pre-existing 的问题不算在作者头上，但要列出。

同一条意见不要在后续轮次重复；修复后的审查只看新的 diff；三轮还收不住，先重估方案，不再来一轮。

## 7. 反复出现过的问题（来自 `.axiom-work/verifications/`，持续补充）

- 启动环境多带了一份变量（PTY 的 spawn env 里又有 `CODEX_HOME`）：无害，但报告要写明谁说了算（M3-08e 发现 1）。
- 终止路径不对称：成功路径释放终端、失败路径不释放（M3-08e 发现 2）。
- 把安全相关的读取失败记成 mismatch，或把观测类读取失败写成启动失败（M3-08e 发现 3）。
- 第一轮把 brief 里的事实当真：brief 可能错（M3-04 的 fixture 补丁），纠正要写进报告。
- 宿主 e2e 里用 `vi.waitFor` 假设时序（M2-11 hygiene a）。
- 验证器的运行器对合法但未 trim 的 Task 数据抛错，把 run 留在 RUNNING（M3-02 发现 3）。
- 把验证者的 sidecar 当成规格的替代：extras 是下限，不是验收标准。
- 沙盒 Worker 以为能 `pnpm install`：沙盒无网络、HOME 隔离，验证会替它跑 `setupCommands`（M3-08 真实冒烟）。
