# 上游同步登记（Upstream Intake Register）

依据 D56：V1 期间只从 stablyai/orca 摘取**安全**、**平台**（Electron / Node 升级、原生模块、OS 兼容）与 **provider 适配**修复。每批记录上游范围、已应用 / 跳过的提交、冲突与移植、验证证据，并推进同步点。upstream 只 `git fetch --no-tags upstream main`，从不 push。

## 同步点

| 日期 | upstream 提交 | 说明 |
|---|---|---|
| 2026-09-26 | `3eb1adec2` | fork 点（Axiom main 与 upstream/main 的 merge-base） |
| 2026-10-19 | `ce2d60834c` | 初筛点（已逐条分诊到此；按 D56 只摘取，不整体合并，merge-base 仍为 fork 点） |

## 2026-10-17 · 首次初筛（只读，未应用）

- 范围 `3eb1adec2..ce2d60834c`（upstream 2026-10-17 16:54 PDT）：2,965 个提交，无 merge 提交；按 conventional 前缀：fix 1,229 / test 323 / feat 322 / refactor 195 / perf 110 / ci 77 / chore 38 / docs 14；双方都改过的文件 1,017 个。Electron 43.7.0 → 43.7.8；Node engines 仍为 24。
- 首批候选（验证者逐条确认后排 `UPSTREAM-1`；开发恢复后排期）：

| 类别 | upstream 提交 | 标题 | 备注 |
|---|---|---|---|
| 平台 | `e8d8f2f0b3`、`25908865b0` | Electron 43.7.0 → 43.7.5 → 43.7.8（detached webview 白屏、find-in-page 循环） | 依赖变更，宿主安装 |
| 用户配置完整性 | `cfa43e7eab` | fix(codex): opening a terminal no longer strips Codex hooks from the real ~/.codex | Axiom 流水线的 Worker 就是 Henry 机器上的 Codex，优先核实影响 |
| 安全 | `2576783d4d` | fix(agents): keep ~/.copilot/config.json owner-only when Orca trusts a folder | 权限 |
| 安全（测试隔离） | `5b3366f78e` | test: unit tests can no longer write a developer's real agent or Orca settings | 全量 suite 跑在 Henry 的 Mac 上 |
| provider（Codex） | `9f4311598f`、`983250a12e` | trust the worktree Codex starts in, not a guessed repo root / await queued Codex trust preflight completion | Attempt worktree 启动 |
| provider（全部） | `21d4ae9448` | pre-trust the folder wherever Orca starts an agent | 同上；属于 trust 预置改动链，可能需要移植 |
| provider（OpenCode） | `990b0ed5cd`、`88e9517eb1` | OpenCode worker 可提交后才下发任务 / 首次派发前等待输入就绪 | OpenCode 已安装（tier B） |
| 安全（凭据，Linux） | `23a874a2a1` | fix(secrets): seal credentials on Linux desktops Chromium cannot detect | |
| 待评估 | `761d63a4e5` 起的 7 步系列 | agent-launch：长 prompt 不放启动行，就绪后粘贴 | 与 Axiom preamble（3–4 KB）投递直接相关；系列提交，可能整体移植 |

- 明确不摘：新增 provider（Qoder、Qwen Code、CodeBuddy、Jcode、DeepSeek dsh、Freebuff）、未安装 provider 的适配（Rovo via acli 等）、mobile pairing、`@orca/process-host` 抽取等重构、上游 CI 与打包流水线。

## 2026-10-19 · UPSTREAM-1（已应用；merge `8fb8d6d24f`，候选 `720851248f`，记录 `.axiom-work/verifications/UPSTREAM-1-2.md`）

初筛范围不变（`3eb1adec2..ce2d60834c`）。用 `git merge-tree` 只读模拟逐条 cherry-pick 后，首批候选中只有两条能干净应用；其余依赖上游在 fork 之后的重构链（`src/main/codex` 自 fork 起 163 个上游提交，Codex hooks 修复之前就有 42 个），单独摘取冲突 7–25 处且缺少前置文件，改为按子系统整批处理。

| 处置 | upstream | 说明 | Axiom 提交 |
|---|---|---|---|
| cherry-pick -x | `2576783d4d` | `~/.copilot/config.json` 写入改为 0600 | `d4cc697bce` |
| cherry-pick -x | `23a874a2a1` | Linux 桌面密钥环后端选择与凭据密封（8 个文件，纯新增） | `355bd8958d` |
| cherry-pick -x（2 处冲突手工合并） | `983250a12e` | 等待 Codex 信任预检完成（20 s 上限）；新 reliability gate 条目里的上游 URL 改为仓库内路径以守住 vendor-egress 棘轮 | `5e476506a4` |
| 语义移植（b、c 部分） | `5b3366f78e` | vitest 写入守卫 `config/scripts/vitest-real-agent-home-write-guard.ts`（+ `.axiom` / `.config/axiom`）+ 8 个测试改用临时 HOME / userData；(a) 部分（trust 写入器取启动 env 的 home）留给 trust 子系统批次 | `c9008cfa10` |
| 跳过（本批） | `cfa43e7eab`、`21d4ae9448`、`9f4311598f` | Codex real-home / trust 子系统链：下一批整批处理，必须在 M2-09 真 Codex Planner smoke 之前 | — |
| 跳过（本批） | `88e9517eb1`、`990b0ed5cd` | OpenCode 就绪：OpenCode 认证（D57）之前处理 | — |
| 待评估 | `761d63a4e5` 系列 | agent-launch 长 prompt 粘贴投递（7 步） | — |
| 验证者宿主执行（待做） | `e8d8f2f0b3`、`25908865b0` | Electron 43.7.0 → 43.7.8（依赖变更，不进 Codex 沙盒） | — |

**流水线事实**：Codex 沙盒不能写 `.git`（`index.lock` 无法创建），Worker 只能用 `git apply` 准备内容；带 `-x` 溯源的 cherry-pick 提交由验证者在 Worker 的树上重建（内容逐字节一致，`git diff` 为空）。后续 UPSTREAM brief 直接按此分工写。

## 2026-10-19 · UPSTREAM-2 分诊（只读；M2-08 之后、M2-09 之前执行）

**子系统漂移的量化**（`git diff --shortstat 3eb1adec2 upstream/main -- <path>`）：`src/main/codex` 359 个文件 +32,180/−11,093（Axiom 侧 337 个文件 vs 上游 447 个）；`src/main/agent-hooks` 182 个文件 +13,125/−4,137；`src/main/claude` 268 个文件 +24,129/−7,969；`src/main/ipc/pty` 118 个文件 +6,150/−2,884；`src/main/codex-accounts` 67 个文件。Axiom 自 fork 起改了 2,652 个文件（M0 删除 `cloud/` 529 个文件、精简 `.github`、renderer 588 个文件、`src/cli` 148 个），与上游两侧都改的文件 1,039 个（renderer 261、`src/main/runtime` 80、`cloud/*` 130 条 modify/delete）。结论：**Codex / trust 子系统既不能逐条 cherry-pick（重构链），也不能整目录快照（与 ipc/pty、startup、agent-hooks 的类型与调用方一起漂移）**。全量合并的只读模拟（`git merge-tree 3eb1adec2 main upstream/main`，2026-10-20）：两侧都改 760 个文件，其中 **254 个文件有文本冲突、868 个冲突块**——434 块集中在 6 个 i18n locale JSON（机械合并），其余 434 块分布在 renderer 61 个文件、`src/main/runtime` 27、`config/scripts` 14、`src/cli/specs` 12、`.github/workflows` 10、`src/main/startup` 10、`AGENTS.md` 10 块等；另有 180 个"本地已删除、上游仍在改"（`cloud/`、`.github`，按删除解决）与 2,588 个上游删除。规模是一次性的 1–2 天 Worker + 验证者工作（主要在 renderer 与 CLI spec 登记），之后才可能恢复逐条摘取；是否在 M2 出口后做这次基线重置（D56 修订）需要 Henry 决定。

三条目标提交的实际内容与对 Axiom 的影响：

| upstream | 实质 | 对 Axiom 的影响 | UPSTREAM-2 处置 |
|---|---|---|---|
| `cfa43e7eab`（82 文件） | ① 真实 home 的 hooks.json / config.toml 恢复前先比较（别人改过就不回滚）；② 跨 Orca 实例用 `~/.orca/managed-hook-install.lock` 串行真实 home 写入；③ legacy sweep 只删枚举的退休命令形态，`ensureRealHomeCodexHookState` 在 hooks 关闭时不写；只有显式 opt-out 才删当前条目 | Axiom 的桌面 app 在**每次 Codex pane 启动**时跑 launch prep；fork 点代码（`codex-hook-legacy-cleanup.ts` 的 `sweepLegacySystemManagedHooks`）仍按脚本文件名匹配并删除真实 `~/.codex/hooks.json` 里**所有 Orca 管理的条目**（含另一个 Orca 实例当前在用的那条）及其 trust 块——用户自己写的 hook 不受影响，但同机的 Orca 正式版 / 另一个 dev 实例会丢状态 hook（上游实测 4139 → 18 字节）。M2-09 真 Codex Planner smoke 会在 Henry 的 Mac 上触发这条路径 | **语义移植 ③ + ①**到 Axiom 现有 `src/main/codex` 结构（不搬上游的隔离 home 架构）；② 的跨实例锁可选 |
| `9f4311598f`（10 文件） | Codex 的 trust 键改为 worktree 自身 realpath（`[projects."<worktree>"]`），不再猜主 checkout | 只影响 bare repo / `--separate-git-dir` 布局；Axiom 的 Attempt worktree 是普通 linked worktree，主 checkout 键有效。M2-09 不阻塞 | **语义移植**：写 trust 时同时写 worktree 键（一条 config 条目），保留主 checkout 键；依赖 `execution-host-workspace-trust.ts` 的部分不搬 |
| `21d4ae9448`（127 文件） | Claude Code 的"Do you trust this folder?"预信任：Orca 创建的 worktree 启动 Claude 前写 Claude 自己的 folder-trust 条目（设置项、i18n、relay、WSL） | 只影响 **Claude harness** 的无人值守启动；M2-09 Planner smoke 用 Codex。Claude 组合的 D57 认证证据会撞上它 | **推迟**到 `claude` 组合认证（D57 证据步骤）前，作为该组合的已知阻塞登记；届时按 Axiom 的 worktree 创建路径（`createManagedWorktree`，`lineage.orchestrationContext`）移植最小子集 |
| `5b3366f78e` (a) | trust 写入器取启动 env 的 home 而不是 `os.homedir()` | 与 ① 同一条用户配置完整性线 | 与 `cfa43e7eab` 同批语义移植 |
| `e8d8f2f0b3`、`25908865b0` | Electron 43.7.0 → 43.7.8 | 平台 | 验证者宿主执行（`pnpm` 依赖变更不进 Codex 沙盒） |
| `88e9517eb1`、`990b0ed5cd` | OpenCode worker 就绪 / 可提交后才下发 | OpenCode 组合（D57，low risk worker） | 查看是否可干净 cherry-pick（fork 后 OpenCode 子系统漂移待量化）；否则随 OpenCode 认证一起语义移植 |
| `761d63a4e5` 系列 | agent-launch 长 prompt 就绪后粘贴 | Axiom preamble 3–4 KB 走启动行 | 评估：若 M2-09 真 Codex smoke 的 preamble 投递正常，则不摘 |

**缓解（不依赖移植）**：M2-09 的真 Codex smoke 之前，给宿主 e2e / smoke 的 app 进程设置隔离的 `CODEX_HOME`（复制 `auth.json`），避免 launch prep 碰 Henry 的真实 `~/.codex`；这只是测试期保护，产品侧仍需 ① ③ 的移植。
