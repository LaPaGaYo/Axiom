# 上游同步登记（Upstream Intake Register）

依据 D56：V1 期间只从 stablyai/orca 摘取**安全**、**平台**（Electron / Node 升级、原生模块、OS 兼容）与 **provider 适配**修复。每批记录上游范围、已应用 / 跳过的提交、冲突与移植、验证证据，并推进同步点。upstream 只 `git fetch --no-tags upstream main`，从不 push。

## 同步点

| 日期 | upstream 提交 | 说明 |
|---|---|---|
| 2026-09-26 | `3eb1adec2` | fork 点（Axiom main 与 upstream/main 的 merge-base） |

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
