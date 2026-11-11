# 上游同步登记（Upstream Intake Register）

依据 D56：V1 期间只从 stablyai/orca 摘取**安全**、**平台**（Electron / Node 升级、原生模块、OS 兼容）与 **provider 适配**修复。每批记录上游范围、已应用 / 跳过的提交、冲突与移植、验证证据，并推进同步点。upstream 只 `git fetch --no-tags upstream main`，从不 push。

## 同步点

| 日期 | upstream 提交 | 说明 |
|---|---|---|
| 2026-09-26 | `3eb1adec2` | fork 点（Axiom main 与 upstream/main 的 merge-base） |
| 2026-10-19 | `ce2d60834c` | 初筛点（已逐条分诊到此；按 D56 只摘取，不整体合并，merge-base 仍为 fork 点） |
| 2026-10-23 | `41661e3312` | UPSTREAM-3 全量合并（D72；合并提交 `ccfc02a65c`，tag `axiom-base-2`），新的 merge-base；之后回到 D56 只摘取 |
| 2026-11-11 | `f6b86ecf62` | 初筛点（D56 的每周初筛恢复；分诊见下方 2026-11-11 节；merge-base 仍为 `41661e3312`） |

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
| `cfa43e7eab`（82 文件） | ① 真实 home 的 hooks.json / config.toml 恢复前先比较（别人改过就不回滚）；② 跨 Orca 实例用 `~/.orca/managed-hook-install.lock` 串行真实 home 写入；③ legacy sweep 只删枚举的退休命令形态，`ensureRealHomeCodexHookState` 在 hooks 关闭时不写；只有显式 opt-out 才删当前条目 | Axiom 的桌面 app 在**每次 Codex pane 启动**时跑 launch prep；fork 点代码（`codex-hook-legacy-cleanup.ts` 的 `sweepLegacySystemManagedHooks`）仍按脚本文件名匹配并删除真实 `~/.codex/hooks.json` 里**所有 Orca 管理的条目**（含另一个 Orca 实例当前在用的那条）及其 trust 块——用户自己写的 hook 不受影响，但同机的 Orca 正式版 / 另一个 dev 实例会丢状态 hook（上游实测 4139 → 18 字节）。M2-09 真 Codex Planner smoke 会在 Henry 的 Mac 上触发这条路径 | **语义移植 ③ + ①**到 Axiom 现有结构；按 UPSTREAM-2 brief，② 跨实例锁明确不在本批范围（V1 单实例），不搬上游隔离 home 架构 |
| `9f4311598f`（10 文件） | Codex 的 trust 键改为 worktree 自身 realpath（`[projects."<worktree>"]`），不再猜主 checkout | Codex 优先查 cwd 自己的条目；对 linked worktree、bare、`--separate-git-dir` 统一使用 workspace realpath，避免信任扩大到主 checkout | **语义移植**：只写 workspace 键，已有的主 checkout 条目原样保留，不新增或更新它；同时保留 system / managed runtime 两份 config 写入；不搬 `execution-host-workspace-trust.ts` |
| `21d4ae9448`（127 文件） | Claude Code 的"Do you trust this folder?"预信任：Orca 创建的 worktree 启动 Claude 前写 Claude 自己的 folder-trust 条目（设置项、i18n、relay、WSL） | 只影响 **Claude harness** 的无人值守启动；M2-09 Planner smoke 用 Codex。Claude 组合的 D57 认证证据会撞上它 | **推迟**到 `claude` 组合认证（D57 证据步骤）前，作为该组合的已知阻塞登记；届时按 Axiom 的 worktree 创建路径（`createManagedWorktree`，`lineage.orchestrationContext`）移植最小子集 |
| `5b3366f78e` (a) | trust 写入器取启动 env 的 home 而不是 `os.homedir()` | 与 ① 同一条用户配置完整性线；当前 trust 调用方不携带 launch env | **继续推迟**，本批不扩展调用方签名；UPSTREAM-1 已移植的真实 home 写入守卫保持不变 |
| `e8d8f2f0b3`、`25908865b0` | Electron 43.7.0 → 43.7.8 | 平台 | 验证者宿主执行（`pnpm` 依赖变更不进 Codex 沙盒） |
| `88e9517eb1`、`990b0ed5cd` | OpenCode worker 就绪 / 可提交后才下发 | OpenCode 组合（D57，low risk worker）；依赖本树尚无的 readiness-census 系列 | **推迟**到 OpenCode 认证时重新评估，不在 UPSTREAM-2 内移植 |
| `761d63a4e5` 系列 | agent-launch 长 prompt 就绪后粘贴 | Axiom preamble 3–4 KB 走启动行 | 评估：若 M2-09 真 Codex smoke 的 preamble 投递正常，则不摘 |

**缓解（不依赖移植）**：M2-09 的真 Codex smoke 之前，给宿主 e2e / smoke 的 app 进程设置隔离的 `CODEX_HOME`（复制 `auth.json`），避免 launch prep 碰 Henry 的真实 `~/.codex`；这只是测试期保护，产品侧仍需 ① ③ 的移植。

### 已应用（UPSTREAM-2）

以下为 Worker 工作树中的语义移植，尚未提交或集成；候选提交、独立验证与宿主 smoke 由 launcher / 验证者记录。证据和差异见 `.axiom-work/reports/UPSTREAM-2-1.md`。本批不推进初筛点（仍为 `ce2d60834c`）。

| upstream | Axiom 文件 | 取用 / 跳过 |
|---|---|---|
| `cfa43e7eab` ③：退休命令 sweep | `src/main/codex/codex-hook-retired-commands.ts`、`.test.ts`；`codex-hook-legacy-cleanup.ts`、`.test.ts`；`hook-service-legacy-cleanup.test.ts` | matcher 原样移入，保留 issue 注释；只删退休形态及其 hash-proven trust，绝不动 grant ledger。保留现有 suppression gate；上游测试中缺失的 `buildCodexHookCommand` 两个输入冻结成原输出字面量，不引入新命令架构；新增当前 POSIX / Windows / WSL 形态保护测试。 |
| `cfa43e7eab` ③：hooks-off / opt-out | `src/main/codex/codex-real-home-hook-install.ts`、`.test.ts`；`codex-hook-service-implementation.ts`；`codex-hook-legacy-cleanup.test.ts`、`hook-service-trust-grant.test.ts` | disabled ensure 不打开 real-home 文件、不改变 lane；显式 service `remove()` 才排队执行 real-home sweep 并清理 ledger-recorded trust。启动 / resume 调用签名不变。 |
| `cfa43e7eab` ①：恢复前比较 | `src/main/codex/codex-real-home-hooks-json.ts`、`.test.ts`；`codex-trust-config-rollback.ts`、`.test.ts`；`codex-user-hook-trust-rebase.ts`、`.test.ts`；上述 installer / legacy sweep | hooks.json 比较精确写入 generation；config snapshot 增加 generation，成功 rebase 后固定它；未知 Codex session 写入按 settled bytes 比较。变化时只记路径并保留文件。② 跨实例锁、上游后续架构替换不移植。 |
| `9f4311598f` | `src/main/agent-trust-presets.ts`、`.test.ts` | 删除 Git 布局推断，只信任 `canonicalize(workspacePath)`；保留旧主 checkout 条目及双 home 写入。实二进制 contract test 不移植；`5b3366f78e` (a) launch-env HOME 继续推迟。 |

`orca-mapping.md` 不变：本批没有改变 Control Plane / Execution Kernel seam、RPC、持久化 schema 或权威归属。

## 2026-10-20 · UPSTREAM-2 已合入（merge `5e1df6f29d`，候选 `c2acb4b145`，记录 `.axiom-work/verifications/UPSTREAM-2-2.md`）+ UPSTREAM-2b 宿主步骤

- 语义移植四项（上表"已应用（UPSTREAM-2）"）经两次 attempt（21 + 6 min）合入；attempt 2 只补了 `config/tsconfig.cli.json` 的三条登记（CLI 项目用显式文件列表，上游同一提交也加了这三条）。合入后 verify-main 只剩已知环境项；宿主 e2e（submit / launch）通过。
- **UPSTREAM-2b（验证者宿主执行，`launchers/electron-bump.command`，`044491d60d`）**：Electron 43.7.0 → 43.7.8（`pnpm add -D electron@43.7.8`，13 s；native runtime 检查通过；floor 测试常量 43.7.8；去掉 `pnpm-workspace.yaml` 里对 `electron@43.7.0` 的 minimumReleaseAge 豁免）。上游随同的 `browser-find-frame-traversal` Electron 测试与 `src/shared/node-runtime-pin.ts` 在本树不存在，不移植。新 Electron 下宿主 e2e（submit / launch）各 27 s 通过。
- 同步点不变（`ce2d60834c` 初筛点）。未摘取项的触发点：Claude 预信任 → `claude` 组合 D57 认证前；OpenCode 两条 → OpenCode 认证前；agent-launch 系列 → M2-09 真 Codex smoke 后评估 preamble 投递；`5b3366f78e` (a) 与跨实例锁 → 下一次 trust 批次。

## 2026-10-22 · 基线重置决定（D72）与全量合并模拟刷新（只读）

- 上游头 `66e50e22cc`（2026-10-22），fork 点 `3eb1adec2` 以来 3,835 个提交。起因：D71 让 V1 UI 建在 Orca 的侧边栏、新建工作区卡片与 native chat 上，而上游改得最多的正是这些目录（native chat 418 → 821 个文件；侧边栏新增 205 / 修改 428 / 删除 50；新建工作区 60；状态栏 146），Axiom 在这些目录只有很小的改动。
- 模拟：`git merge-tree 3eb1adec2 main upstream/main`（legacy 模式，不跟踪改名）。changed in both 860 个文件、added in both 7、上游删除 3,062、上游新增 12,163（两者都含改名）、本地删除 101。**303 个文件文本冲突、999 个冲突块**：6 个 i18n locale JSON 470 块（机械合并）；renderer 82 个文件 / 118 块、`src/cli` 32 / 93、`src/main/runtime` 29 / 41、`config` 21 / 39、`src/shared` 19 / 28、`src/main/startup` 11 / 12、`.github` 10 / 18、`src/main/codex` 9 / 29、`docs` 8 / 12、`src/main/ipc` 7 / 11，其余每处不超过 5 个文件。2026-10-20 同口径是 254 个文件 / 868 块。
- 改名感知的补充（`git diff -M50%`）：Axiom 改过、上游删除的文件 91 个（`src/main/ssh` 20、renderer 16、`config` 15、`src/main/providers` 8、`src/main/codex` 5、`src/main/runtime` 4、`src/main/ipc` 3、`src/main/claude-accounts` 3、`src/cli/specs` 3、`src/main/native-chat` 2）；Axiom 改过、上游改名的 13 个。
- 语义接缝：上游 `migrate-v43.ts`（`e42c0b3630`，#24230，2026-10-01）把存储的 `session:<id>` 地址改写为 `orca_session_id:<id>`，与 Axiom 的 v43–v45 编号冲突（上游 `SCHEMA_VERSION = 43`，Axiom 45）；`src/main/axiom/execution/mission-caller.ts` 硬编码 `session:` 前缀（D14）。
- 计划：UPSTREAM-3 = 全量合并，Henry 说"继续"后第一件事、M3-02 之前（D72 第 1–7 条）；完成后在同步点表加一行（新的 merge-base 与 tag `axiom-base-2`），之后回到 D56 的只摘取。

## 2026-10-23 · UPSTREAM-3 已合入（合并提交 `ccfc02a65c` + attempt 6 修补；tag `axiom-base-2` = `41661e3312`）

- **合并方式（D72）**：工作分支从 `cda0d49f15`（父 `393c083ebd` + `41661e3312`，带冲突标记提交）起，attempt 1–5 叠在 `axiom/attempt/UPSTREAM-3/1..5`；`git commit-tree <候选树> -p 393c083ebd -p 41661e3312` 生成一个合并提交，main 快进到它，中间带标记的提交不进 main 的历史（attempt 分支保留步骤历史）。之后 verify-main 与第一次完整全量查出的问题由 attempt 6（`--base main`）修补，以 `--no-ff` 合入。
- **六次 attempt**（记录 `.axiom-work/verifications/UPSTREAM-3-{1,2,3,4,5,6}.md`、`UPSTREAM-3-full.md`）：1 = 301 个冲突文件 + 91 个 UD 路径 + 内核接缝（46 min）；2 = 给无冲突合入的上游代码补施加 M0（62 min）；3 = B1 按 D73（35 min）；4 = 两处测试（10 min）；5 = 宿主验证查出的 162 个合并引起测试、`opencode.json` 出包、两处冷启动外联（53 min）；6 = 第一次完整全量查出的 49 个测试、一个启动测试替身引起的未处理 rejection、7 处测试类型断言、smoke spec 读取上游 #22933 删掉的设置（18 min）。验证者另做的修改：两个 CLI 测试字符串；删掉 cherry-pick 残留的 `tests/e2e/agent-trust-completion.unit.test.ts`（上游 #23744 已删）；9 个旧 sidecar 里被本次合并有意推翻的检查项（改指向或撤掉，e2e typecheck 计数上限 214 / 215 → 226）。
- **内核接缝**：上游 v43 逐字节保留，Axiom 的 v43–v45 改为 v44–v46（`SCHEMA_VERSION = 46`，存量 43–45 的库补跑一次幂等的地址改写）；`mission-caller` 用 `formatOrcaSessionAddress`；17 处 §4b 拦截点、M2-01 seam、Control Plane 接线保留；Attempt 身份按 D73；vendor-egress 按 D74（发版代码 0 对；合入后 468 → 459）；D75（V1 只做桌面，手机端休眠）；D37 冷启动零外联（agent-state-rules 实时更新改为显式开启、去掉 Google favicon；顺带修了上游新 Codex hook 启动对账绕过 provider 激活门的问题）。
- **证据**：完整全量（`ORCA_BALANCE_UNIT_SHARDS=1`，约 13.5k 个文件；本地不带它时 cross-version 测试会让 vitest 提前结束）与同一台机器上的纯上游检出逐测试做差——剩下的失败要么在纯上游上同样失败（真实 zsh / bash PTY、macOS bash 3.2、`/var` vs `/private/var`、process-host dev rebuild、orcad forked child paths），要么是 D75 的 3 个 `MobilePage` Relay 用例；mobile-web-app 渲染套件缺新版 Playwright 浏览器；cross-version-wire 需要上游 release tag（本仓库按 `--no-tags` 抓取）。M1 / M2 出口 e2e、五个 fixture e2e、三种栈的冷启动出口 `{}`、真实 Codex Planner、打包（asar 契约 OK）、打包产物前台 75 s 出口 `{}`、verify-main（所有 sidecar 的并集；changed-code 门以 `41661e3312` 为基线）。
- **之后**：同步点推进到 `41661e3312`；回到 D56 的只摘取（安全 / 平台 / provider 修复），下一次初筛从 `41661e3312..upstream/main` 开始。未签名本地包的终端宿主 helper 读不到代码签名、daemon 走 fork 回退——上游新代码，Axiom 签名之后再看。

## 2026-11-11 · 初筛与 UPSTREAM-4 分诊（只读）

- **范围**：`41661e3312..f6b86ecf62`（upstream 头，2026-11-11），4,908 个非合并提交。10-23 之后的每周初筛停了三周（验证者的疏漏），本次补上。第一轮按 D56 的路径（`package.json` 的 Electron / Node 行、`src/shared/tui-agent-config.ts`、`agent-trust*`、`src/main/agent-hooks/`）与标题关键词（安全、凭据、泄漏、依赖）过滤；另按 Axiom 在 V1 路径上依赖的子系统（`native-chat`、`daemon`、`runtime/orchestration`、`codex`、`claude`、`rate-limits` 等，1,036 个提交，其中 fix / feat / perf 467 个）读标题与 PR 说明，逐条对照 main。学习笔记（含 T3 Code）在项目文档 `claude/upstream-learning-v1.md`。
- **分诊**：

| upstream | 实质 | 对 Axiom 的影响 | 类别 | 处置 |
|---|---|---|---|---|
| `f0e7eaa070`（#38358） | 编排库 `temp_store = MEMORY`；SQLite 已自己结束事务时，回滚不再掩盖真错误 | Axiom 的写事务都走 `runLifecycleWriteTransaction` 的 savepoint；临时目录满或不可写时所有结算失败，报错还误导人 | 内核可靠性（D56 三类之外，Henry 2026-11-11 同意，见 D56 修订行） | **UPSTREAM-4** 语义移植 |
| `220347cae0`（#39825） | 空的守护进程 pid 记录不再读成 pid 0；读不懂的记录只在端点确证已死后回收 | 发布 pid 文件时崩溃留下空文件 → 之后每次启动 `EEXIST`，起不了 Worker | 内核可靠性（同上） | **UPSTREAM-4** 语义移植（上游路径已重组） |
| `71404c99be`（#40992） | Codex 被拒时，最后一份报告 ≥ 90% 的窗口算用光，已重置的窗口不算 | Axiom 从 Worker 自己的 rollout 读重置时间（`codex-rollout-limit.ts`），报告落后一步时丢重置时间、退到阶梯 | provider 适配 | **UPSTREAM-4** 语义移植（上游路径已重组） |
| `0ded87821d`（#36205），`src/shared` 一半 | Git 远端错误先去掉 ANSI 转义再脱敏；凭据剥离改为线性时间 | 转义序列插在 URL 的 userinfo 里时，凭据留在错误文本里；V1 的 PR 交付要推分支 | 安全 | **UPSTREAM-4** 语义移植；renderer 一半不取（Worker 不改 `src/renderer/**`，只是显示侧），下次初筛复议；中间的 `6c38b40984`、`bbb563e83a`、`e182f1daa2`、`a4e600a663`（推送错误细节、i18n）不取 |
| `f586149b3d`（#36323）、`f3c65cd556`（#37916） | Electron 43.7.8 → 43.8.4 → 43.8.6（Chromium / V8 / ANGLE / PDFium / Skia / WebRTC 安全补丁）；`@hono/node-server` 2.1.5（只改锁文件） | Axiom 当前是 43.7.8 | 平台 / 安全 | **UPSTREAM-4b**：验证者经宿主 launcher 安装并提交锁文件；完整门禁、全量 suite、打包产物 egress 金丝雀、宿主 e2e；`minimumReleaseAge` 与 `config/dependency-security-exceptions.json` 的对应改动届时逐条核对；mobile 部分不取 |
| `9c7fe9793e`（#37981） | minimatch / glob / deepmerge 的安全补丁（`config/patches/`） | 依赖层 | 安全 | **UPSTREAM-4b** 候选：补丁版本与本树逐个核对 |
| `18d25591f9`（#32983）、`914b260fa6`（#32326） | body-parser、happy-dom 等依赖的安全通告 | 依赖层；含 mobile 与文档站点 | 安全 | **UPSTREAM-4b** 候选：只取桌面端 |
| `eb3379ff99`（#16870） | macOS 守护进程 PTY 的 kqueue 描述符泄漏（`node-pty` 补丁） | V1 跑在 macOS 上，守护进程长期运行 | 平台 | **UPSTREAM-4b** 候选：补丁文件与本树的 `node-pty` 版本核对 |
| 其余 | 新功能、UI、其他 provider、mobile、重构、测试清理 | — | — | 不取（D56） |

- **另记**（不是 D56 的摘取，作为后续 brief 的输入）：#40967 / #40963（判定 worker 已退出后清掉派生的占用记录；启动时每种租约都对账到确定结论）与 #32341（同一个 id 换成新实例后清掉旧实例的退出证据）→ M3-06-2b-3；#33527 / #35003 / #39322 / #39349 / #40593（在原目录续、目录没了明确失败、续话写明"接着做原来的任务"、闲置 7 天以上的 rollout 会被压成 `.jsonl.zst`）→ M3-06-2c。
- **初筛点**推进到 `f6b86ecf62`；下次从 `f6b86ecf62..upstream/main` 接着筛（每周一次，D56）。

### 已应用（UPSTREAM-4）

按 D56 的 2026-11-11 修订行，在 Axiom 现有目录中做最小语义移植；Worker 留下未提交改动，由宿主 launcher 提交、验证者验收。记录见 `.axiom-work/reports/UPSTREAM-4-1.md`，本节不表示已集成或宿主验证通过。

| upstream | Axiom 落点 | 移植与差异 |
|---|---|---|
| `f0e7eaa070`（#38358） | `src/main/runtime/orchestration/db/orchestration-db.ts`、`lifecycle-transition.ts`、`lifecycle-transition.test.ts`；`src/main/axiom/db/axiom-store-rollback.test.ts` | `temp_store = MEMORY`；SQLite 已结束事务时不再回滚，保留原错误。增加顶层事务、嵌套 savepoint 与 AxiomStore 调用链的回归测试；runner 和 Axiom 生产代码不改。 |
| `220347cae0`（#39825） | `src/main/daemon/daemon-pid-file-parse.ts`、`daemon-stale-kill.ts`、`daemon-pid-file-parse.test.ts`、`daemon-health.test.ts`；`daemon-host-relocation.ts` 仅注释 | 旧式 pid 必须为安全正整数；仅端点确证已死才回收无法解析的记录，`connected` / `unknown` 保留记录并阻止替换。JSON 与有效记录的所有权栅栏不变；不取上游 `endpoint/identity/`、`launch/` 重组。 |
| `71404c99be`（#40992） | `src/main/codex/codex-usage-limits.ts` 及其测试；`src/main/axiom/execution/codex-rollout-limit.test.ts` | 仅 `usageLimitExceeded` 在没有 ≥100% 窗口时取尚未重置、最满且 ≥90% 的窗口。沿用本树的错误码读取变量与目录；rollout reader 只补测试，不刷新账号用量，不增加出站。 |
| `0ded87821d`（#36205），`src/shared` 部分 | `src/shared/git-remote-error.ts` 及其测试 | 先去 ANSI 再脱敏；固定 `://` 扫描与 sticky userinfo 匹配避免长 scheme 文本的二次方重试，保留 URL 的端口、路径、query、fragment。沿用本树 `formatSubmodulePushFailureDetail`，不引入上游新的分类 API。 |

未取：#36205 的 renderer 部分（Worker 禁改 `src/renderer/**`，按初筛记录留待复议）；`6c38b40984`、`bbb563e83a`、`e182f1daa2`、`a4e600a663`（推送错误细节、stale-lease 显示与 i18n 不属本批）；依赖、Electron 与原生补丁仍由 UPSTREAM-4b 经宿主处理。未 fetch、pull、push、cherry-pick 或 commit；同步点保持 `f6b86ecf62`。

**已合入（2026-11-11）**：merge `a30332227b`，候选 `1050260103`（attempt 1，16 min），记录 `.axiom-work/verifications/UPSTREAM-4-1.md`。launcher OVERALL=PASS；宿主上全部 Mission 规格与 exit m1 / m2 全绿，改动的测试文件在 Node 下全绿，新测试对 main 的产品代码先红。上面"本节不表示已集成"一句以本条为准。依赖类各项仍按 UPSTREAM-4b 由验证者在宿主上做。

### 已应用（UPSTREAM-4b，验证者宿主步骤）

依赖与补丁类的一半。按 D56 第 2 条，依赖变更由验证者经宿主 launcher 安装并提交锁文件（`launchers/upstream-4b-host.command`），沙盒里不装任何东西。brief `.axiom-work/briefs/UPSTREAM-4b.md`，记录 `.axiom-work/verifications/UPSTREAM-4b-1.md`，候选 `86c0174eb9`。

| upstream | Axiom 落点 | 移植与差异 |
|---|---|---|
| `914b260fa6`、`f586149b3d`、`f3c65cd556`（Electron 43.7.8 → 43.8.1 → 43.8.4 → 43.8.6） | `package.json`、`pnpm-lock.yaml`、`src/shared/node-runtime-pin.ts`、`config/scripts/electron-runtime-floor.test.ts`、`src/main/browser/` 下四个弹窗 Electron 测试 | 直接到 43.8.6（发布已超过 `minimumReleaseAge`，不加豁免）。下限取 43.8.6：这批就是为了它的 Chromium 回补；上游停在 43.8.4，之后删了这个测试。注释写明 43.8.1 / 43.8.4 / 43.8.6 各修了什么，测试标题取上游的。弹窗测试照搬上游为 43.8.1 行为做的改动，版本期望改为 43.8.6。 |
| `d9dc87b2fb` 的 DOMPurify 一行与 `914b260fa6` 的覆盖 | `package.json`、`pnpm-workspace.yaml`、锁文件 | 3.4.16 → 3.4.17；`dompurify@<3.4.17: 3.4.17` 取代 `monaco-editor>dompurify: 3.4.16`，应用、Mermaid、Monaco 三处都是 3.4.17。渲染进程用它净化笔记本的 HTML 输出与 Mermaid SVG。 |
| `9c7fe9793e`（桌面端一半） | `config/patches/` 下四个补丁文件（逐字节取自上游）、`pnpm-workspace.yaml` 的 `patchedDependencies`、`config/scripts/dependency-security-patches.test.mjs`、`config/patches/dependency-security.md` | 只打桌面端（都是构建与 lint 工具链）；mobile、文档站与审计工具的副本、deepmerge 不动，文档里写明。 |

**不取**：`eb3379ff99`（`node-pty` 的 kqueue 描述符泄漏）——本树的 `node-pty` 补丁已与上游分叉（`07b437c9e9` 等六处），要对着我们的补丁重生成，再为 Electron、Node 与 orcad 预编译各重编一次原生模块；守护进程每起一个 PTY 漏一个描述符，V1 的用量离上限很远——等下次动 `node-pty` 或 DEF-7 一起做。body-parser 2.4.0（`18d25591f9`）与 `@hono/node-server` 2.1.5（`f3c65cd556`）——只由 `@modelcontextprotocol/sdk` 为 HTTP 传输引入，桌面端只用它的 stdio（`server/mcp.js`、`server/stdio.js`、`types.js`），随下次 MCP SDK 升级。happy-dom 20.14.6 / 21.0.4——测试环境，不发布。mobile、文档站、审计工具的部分（node-forge、deepmerge 及它们的 minimatch / glob 副本），`config/dependency-security-exceptions.json`（只有 pull_request 的依赖安全工作流读它）。另：D56 第 3 条写的 `verify:egress-allowlist` 早在 M0-08 被出口棘轮取代（`docs/reference/orca-mapping.md` §7）。

**UPSTREAM-4b 已合入（2026-11-11）**：merge `3e6832818c`，候选 `86c0174eb9`，记录 `.axiom-work/verifications/UPSTREAM-4b-1.md`。宿主：12 个 Electron 探针新旧两版全过，main 的弹窗测试在 43.8.6 上先红；门禁、全部 Mission 规格与三栈冷启动出口全过，打包产物出口检查（前台 75 秒）没有厂商端点、也没有任何非回环请求；全量测试与 main 的失败集合相同。上面"已应用"一节以本条为准。
