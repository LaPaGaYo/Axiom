# M1 出口：冻结 fixture 的 CLI / UI / restart / Orca refusal 证据

记录日期：2026-10-17 · Task M1-10 / attempt 1。Worker 只提交测试与文档；最终 VerificationRun、M1 出口决定和 DEF-1 决定属于 verifier / Henry。

## 宿主运行

```sh
AXIOM_FIXTURE_REPO=$HOME/Documents/flowtask-fixture ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e tests/e2e/mission-exit-m1.spec.ts
```

使用 Axiom 仓库的 Node 24 / pnpm 12 与已配置依赖。`test:e2e` 的 global setup 以 e2e mode 构建应用及 `out/cli/index.js`，运行 `electron-headless`。这是 Axiom 的工具链；fixture 自身 Node 22 / pnpm 10.34.7 的验收命令在 M1 不执行。

fixture 不在 Axiom 仓库内。`AXIOM_FIXTURE_REPO` 必须指向已有本地 clone；测试只以 `git clone --no-hardlinks --branch main <local-path> <temp>` 复制，限定 Git file protocol，无 fetch/网络 clone。目标 HEAD 同时等于 `fixture-v1^{commit}` 与 D42 固定值 `a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642`；缺路径、缺 tag、main 漂移一律失败。唯一 skip 是变量未设置，不能将 skip 当出口 PASS。

本 Worker 沙箱不能启动 Electron，因此未尝试实际 launch；下表明确保留 `pending host run`。已用 Playwright `--list` 证明一个 `electron-headless` 测试被发现，不能据此声称 e2e 通过。测试不 reveal 窗口，两次 launch 都显式 `ORCA_BACKGROUND_LAUNCH=1`。

## 三条出口合同的覆盖

| 合同 | 自动断言与证据边界 |
|---|---|
| 1. 重启不丢 Mission / GoalRevision / PlanRevision / Task / stage | 编译 CLI 注册 clone、读 `GOAL.md` 创建 Mission、读取 active Goal id、转换并共享校验 decomposition、propose/approve/start。保存完整 Mission/Goal/Plan/Task result JSON，关闭并在同一 userData 重启后逐字节比较；Goal 正文/ACTIVE、Plan APPROVED、Mission EXECUTING、Task ids/stages/orcaStatus 均保留。只读 DB 检查 Run id/status 不变且没有 `recovery.run_binding_lost`。成功恢复本身不写 audit event |
| 2. 直接 taskUpdate / workerStart / reset 被拒 | 对同一 Mission Run/Task 运行三条 Orca CLI，每条必须非零退出且 `ok:false`。reset 仅接受 `mission_managed`；task-update/worker-start 仅接受三层拒绝码：CLI 无终端身份 `no_active_sender_terminal`（尚未发送 mutation RPC），runtime Run 绑定 `run_required` / `consumer_fenced`，Mission 守卫 `mission_managed`（M1-07 绑定 coordinator 的 RPC 测试覆盖）。前后完整 result 快照和 DB Mission 状态不变；任何成功、其他错误码、信号退出或超时均不能通过 |
| 3. §4b 所有拦截点有测试 | 复用 M1-07 的 `src/main/axiom/admission/{mission-managed-run-guard,admission-rpc,admission-run,admission-message}.test.ts`，不重复实现；独立验收记录 `.axiom-work/verifications/M1-07-1.md`。包括已绑定 coordinator 的 `mission_managed` 路径、非 Mission 正向对照和无状态变化断言 |

CLI 成功输出从 `{ok:true,result:...}` 读取；比较的是整个 result payload（不删领域字段），RPC envelope 的随机 request id / runtime metadata 不参与持久对象比较。SQLite 只读连接只执行 missions / audit_events SELECT；不写 `orchestration.db`，不注入计划到 renderer/store。

UI 两次都从 `openMissionsPage()` 进入，通过 Mission list 中包含 Mission id 的按钮选择（选择 id 本身不跨重启持久化），然后断言 Missions / Mission Home、Executing、Goal 正文、12 行、3 Ready / 9 DEFINED、12 个 `Execution projection: ready`、`0 / 12 Tasks integrated`；Task 表无 done/completed 文案。重启前后 Home 可见文本与表格行文本完全一致。

初始 READY 集精确对应 T01 `Sprint entity and validation`、T02 `Tabular CSV interchange`、T03 `Ready work planning report`；另外九个 DEFINED。12 个 Orca `ready` 不是 12 个 Axiom READY。共享转换单测的标题来自契约 fixture，真正 e2e 的标题/Goal/依赖来自冻结 clone。

## 宿主实跑结果（由 verifier 填写）

从宿主日志的 `[M1-exit] ` JSON 行复制 counts、refusals、durationsMs（与 `testInfo.attach('M1-exit-measurements', ...)` 使用同一个 measurements 对象；成功测试的附件可能不保留），并补宿主日志/版本/候选身份。下列任何 pending 均不表示 PASS。

| 项目 | 预期 | 实测 |
|---|---|---|
| 候选 commit / 宿主版本 / 日志位置 | verifier 记录 | pending host run |
| fixture HEAD / tag / D42 | 三者相同 | pending host run |
| Task / edge / READY / DEFINED / Orca ready | 12 / 20 / 3 / 9 / 12 | pending host run |
| reset 实际拒绝码 | mission_managed | pending host run |
| task-update 实际拒绝码 | CLI 身份 no_active_sender_terminal；runtime 绑定 run_required / consumer_fenced；Mission 守卫 mission_managed（三层之一） | pending host run |
| worker-start 实际拒绝码 | CLI 身份 no_active_sender_terminal；runtime 绑定 run_required / consumer_fenced；Mission 守卫 mission_managed（三层之一） | pending host run |
| 拒绝前后 CLI / Mission status | 字节不变 / EXECUTING | pending host run |
| 重启后 Mission/Goal/Plan/Task CLI 快照 | 字节相同 / EXECUTING | pending host run |
| 两次 UI / recovery.run_binding_lost 数 | 相同 / 0 | pending host run |
| clone、CLI setup、拒绝、重启断言、总时长（ms） | attach 测量 | pending host run |
| e2e verdict | 必须实际通过，skip 不算通过 | pending host run |

## 沙箱验证

- `pnpm test tests/e2e/helpers/fixture-plan-proposal.unit.test.ts src/main/axiom src/shared/axiom-contract`：34 文件、281 测试 PASS（7.68s 墙钟）。覆盖 M1-07 的 §4b tests。
- 负向对照：仅将 helper 单测预期根集合从 `T01 T02 T03` 改为 `T01 T02`，同一单测命令 rc=1，1 failed / 2 passed（0.81s）；收到集合多出 T03。已恢复，再跑上述 281 测试全绿。
- `pnpm tc:node` / `pnpm tc:cli` / `pnpm tc:web` PASS。`pnpm run typecheck:e2e`：基线与本次各 214 条诊断，输出逐字节一致，新增/移除诊断均 0；没有本 Task 三个 TS 文件的诊断。详情与其余门禁结果见 `.axiom-work/reports/M1-10-1.md`。
- `pnpm run check:code-quality:changed` PASS（7.26s，七组扫描 0 新发现）；完整 `pnpm lint` PASS（84.85s，含 RPC catalog）；Playwright 最终 `--list` PASS（5.17s，1 test）。
- Electron 未运行；最终出口结果留待独立 verifier 的宿主实跑。

<a id="local-gate-timings"></a>
## DEF-1 本地门禁计时

仅提取 `.axiom-work/logs/verify-M1-*.log` 与 `verify-M0-*.log` 的 `---- RESULT <check> rc=<n> duration=<s>s` 和 `== verify <ID> seq=<n> start/end … OVERALL=` 行；未查看这些日志的其它内容。提取命令：

```sh
rg --no-heading '^---- RESULT |^== verify .* (start|end) ' .axiom-work/logs/verify-M1-*.log .axiom-work/logs/verify-M0-*.log
```

单位均为秒。check 列显示 `duration (rc=退出码)`；Wall 是同文件 start/end 时间戳之差，包含其它 gates / sidecar / 调度开销，不是列值求和。0 是日志的秒级分辨率，不是无需时间；`—` 表示该日志没有该检查结果。log timestamp 列的反引号值对应 `.axiom-work/logs/verify-<值>.log`。同 Task/seq 的不同时间文件各保留一行，不覆盖重跑；共 57 次（M0 44、M1 13），所有原始 FAIL 均保留，未用后续接受结果改写。

**M1 中位数（13 次 attempt 验证，包含原始失败，每列 n=13）：**

| unit-tests | typecheck-node | typecheck-cli | typecheck-web | code-quality-changed | full-lint | total wall |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 1 | 0 | 1 | 2 | 80 | 94 |

这组日志的 unit targets 不同，不能将 5s 解释为全量 suite 用时；typecheck 使用已有缓存，不能解释为冷启动 CI。M1-08/1、M1-09/1、M1-09/2 的原始 FAIL 原因/后续处置见相应 verification records，表中只保留原始结果。M1-03/2 在当前日志的文件名为 `20261017-013509`，优先以现存文件及 start/end 为本次计时来源。

DEF-1 仍 OPEN。这些数据只补齐本地 attempt 门禁观察；Actions 的实际运行分钟、`verify-merged` / 全量 suite 对照、分片需求和 B/C/继续本地的取舍仍由 verifier / Henry 汇总判断，本 Task 不访问 Actions、不作 CI Decision。

| Attempt / log timestamp | Unit | Node | CLI | Web | Changed quality | Full lint | Wall | Raw overall |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| M0-01/1 · `M0-01-1-20260926-215420` | 1 (rc=0) | 1 (rc=0) | — | — | 7 (rc=0) | 87 (rc=0) | 101 | PASS |
| M0-02/2 · `M0-02-2-20260926-225237` | 14 (rc=1) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 8 (rc=0) | 36 (rc=1) | 65 | FAIL |
| M0-02/4 · `M0-02-4-20260926-231911` | 607 (rc=1) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 7 (rc=0) | 81 (rc=0) | 704 | FAIL |
| M0-02/5 · `M0-02-5-20260926-234834` | 642 (rc=1) | 1 (rc=0) | 1 (rc=0) | 11 (rc=0) | 8 (rc=0) | 80 (rc=0) | 749 | FAIL |
| M0-02/5 · `M0-02-5-20261016-010352` | 664 (rc=1) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 4 (rc=0) | 23 (rc=1) | 698 | FAIL |
| M0-03/1 · `M0-03-1-20261001-212819` | 9 (rc=0) | 2 (rc=0) | 0 (rc=0) | 1 (rc=0) | 5 (rc=0) | 7 (rc=1) | 28 | FAIL |
| M0-03/2 · `M0-03-2-20261001-213725` | 9 (rc=0) | 2 (rc=0) | 0 (rc=0) | 2 (rc=0) | 4 (rc=0) | 82 (rc=0) | 102 | PASS |
| M0-04/1 · `M0-04-1-20261001-221724` | 24 (rc=0) | 12 (rc=0) | 1 (rc=0) | 1 (rc=0) | 7 (rc=0) | 7 (rc=1) | 62 | FAIL |
| M0-04/2 · `M0-04-2-20261001-223423` | 22 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 3 (rc=0) | 46 (rc=1) | 77 | FAIL |
| M0-04/3 · `M0-04-3-20261001-224254` | 22 (rc=0) | 1 (rc=0) | 1 (rc=0) | 11 (rc=0) | 4 (rc=0) | 36 (rc=1) | 79 | FAIL |
| M0-04/4 · `M0-04-4-20261001-225640` | 22 (rc=0) | 1 (rc=0) | 1 (rc=0) | 12 (rc=0) | 3 (rc=0) | 79 (rc=0) | 121 | PASS |
| M0-05a/1 · `M0-05a-1-20261003-013255` | 43 (rc=0) | 2 (rc=0) | 0 (rc=0) | 2 (rc=0) | 3 (rc=0) | 7 (rc=1) | 61 | FAIL |
| M0-05a/2 · `M0-05a-2-20261003-014518` | 44 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 4 (rc=0) | 82 (rc=0) | 137 | PASS |
| M0-05b-1/1 · `M0-05b-1-1-20261003-123943` | 273 (rc=0) | 1 (rc=0) | 1 (rc=0) | 2 (rc=0) | 35 (rc=0) | 7 (rc=1) | 356 | FAIL |
| M0-05b-1/2 · `M0-05b-1-2-20261003-151231` | 276 (rc=1) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 32 (rc=0) | 80 (rc=0) | 429 | FAIL |
| M0-05b-1/3 · `M0-05b-1-3-20261004-085659` | 627 (rc=1) | 2 (rc=0) | 1 (rc=0) | 12 (rc=0) | 37 (rc=0) | 82 (rc=0) | 798 | FAIL |
| M0-05b-1/4 · `M0-05b-1-4-20261004-093812` | 630 (rc=1) | 11 (rc=0) | 1 (rc=0) | 12 (rc=0) | 34 (rc=0) | 80 (rc=0) | 805 | FAIL |
| M0-05b-2/1 · `M0-05b-2-1-20261003-163013` | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 80 (rc=0) | 88 | PASS |
| M0-05b-2/2 · `M0-05b-2-2-20261004-093033` | 2 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 1 (rc=0) | 80 (rc=0) | 89 | PASS |
| M0-05b-2/3 · `M0-05b-2-3-20261004-150016` | 637 (rc=1) | 10 (rc=0) | 1 (rc=0) | 11 (rc=0) | 2 (rc=0) | 81 (rc=0) | 746 | FAIL |
| M0-06a/1 · `M0-06a-1-20261001-234635` | 25 (rc=1) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 4 (rc=0) | 82 (rc=0) | 117 | FAIL |
| M0-06a/2 · `M0-06a-2-20261002-233535` | 25 (rc=1) | 2 (rc=0) | 0 (rc=0) | 1 (rc=0) | 4 (rc=0) | 81 (rc=0) | 116 | FAIL |
| M0-06b/1 · `M0-06b-1-20261003-001605` | 10 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 5 (rc=0) | 83 (rc=0) | 103 | PASS |
| M0-06b/2 · `M0-06b-2-20261003-004510` | 10 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 5 (rc=0) | 81 (rc=0) | 101 | PASS |
| M0-07/1 · `M0-07-1-20261003-161248` | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 12 (rc=0) | 1 (rc=0) | 80 (rc=0) | 99 | FAIL |
| M0-07/2 · `M0-07-2-20261004-092144` | 6 (rc=0) | 1 (rc=0) | 2 (rc=0) | 11 (rc=0) | 1 (rc=0) | 80 (rc=0) | 105 | FAIL |
| M0-07/3 · `M0-07-3-20261004-100434` | 6 (rc=0) | 1 (rc=0) | 1 (rc=0) | 12 (rc=0) | 7 (rc=0) | 30 (rc=1) | 62 | FAIL |
| M0-07/4 · `M0-07-4-20261004-140021` | 7 (rc=0) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 8 (rc=0) | 80 (rc=0) | 102 | FAIL |
| M0-08/1 · `M0-08-1-20261010-122759` | 1 (rc=0) | 2 (rc=0) | 0 (rc=1) | 2 (rc=0) | 1 (rc=0) | 80 (rc=0) | 144 | FAIL |
| M0-08/2 · `M0-08-2-20261010-124104` | 1 (rc=0) | 2 (rc=0) | 0 (rc=0) | 2 (rc=0) | 1 (rc=0) | 80 (rc=0) | 147 | FAIL |
| M0-09/1 · `M0-09-1-20261010-125348` | 5 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 151 | FAIL |
| M0-09/2 · `M0-09-2-20261010-154117` | 7 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 153 | FAIL |
| M0-09/3 · `M0-09-3-20261010-161407` | 82 (rc=1) | 1 (rc=0) | 1 (rc=1) | 1 (rc=0) | 4 (rc=0) | 80 (rc=0) | 231 | FAIL |
| M0-09/4 · `M0-09-4-20261010-183211` | 83 (rc=1) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 4 (rc=0) | 80 (rc=0) | 232 | FAIL |
| M0-09/5 · `M0-09-5-20261010-185349` | 83 (rc=1) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 5 (rc=0) | 80 (rc=0) | 231 | FAIL |
| M0-10/1 · `M0-10-1-20261015-231021` | 1714 (rc=1) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 3 (rc=0) | 81 (rc=0) | 1804 | FAIL |
| M0-11/1 · `M0-11-1-20261015-235212` | 55 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=1) | 7 (rc=1) | 71 | FAIL |
| M0-12/1 · `M0-12-1-20261016-000131` | 24 (rc=1) | 1 (rc=0) | 1 (rc=0) | 12 (rc=0) | 4 (rc=1) | 7 (rc=1) | 53 | FAIL |
| M0-12/2 · `M0-12-2-20261016-001716` | 25 (rc=1) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 4 (rc=1) | 7 (rc=1) | 43 | FAIL |
| M0-13/1 · `M0-13-1-20261016-005530` | 2 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 4 (rc=0) | 23 (rc=1) | 35 | FAIL |
| M0-13/2 · `M0-13-2-20261016-125912` | 2 (rc=0) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 4 (rc=0) | 82 (rc=0) | 95 | PASS |
| M0-14/1 · `M0-14-1-20261016-151326` | 2 (rc=1) | 2 (rc=0) | 0 (rc=0) | 1 (rc=0) | 1 (rc=0) | 82 (rc=0) | 93 | FAIL |
| M0-14/2 · `M0-14-2-20261016-151855` | 3 (rc=0) | 1 (rc=0) | 0 (rc=0) | 2 (rc=0) | 1 (rc=0) | 81 (rc=0) | 92 | PASS |
| M0-HYG/1 · `M0-HYG-1-20261003-114233` | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 82 (rc=0) | 91 | PASS |
| M1-01/1 · `M1-01-1-20261017-004041` | 3 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 92 | PASS |
| M1-02/1 · `M1-02-1-20261017-005912` | 3 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 93 | PASS |
| M1-02/2 · `M1-02-2-20261017-011002` | 4 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 92 | PASS |
| M1-03/1 · `M1-03-1-20261017-012517` | 4 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 80 (rc=0) | 92 | PASS |
| M1-03/2 · `M1-03-2-20261017-013509` | 5 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 79 (rc=0) | 92 | PASS |
| M1-04/1 · `M1-04-1-20261017-015043` | 4 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 2 (rc=0) | 81 (rc=0) | 94 | PASS |
| M1-05/1 · `M1-05-1-20261017-020925` | 5 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 3 (rc=0) | 80 (rc=0) | 94 | PASS |
| M1-06/1 · `M1-06-1-20261017-023513` | 58 (rc=0) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 4 (rc=0) | 80 (rc=0) | 149 | PASS |
| M1-07/1 · `M1-07-1-20261017-025329` | 51 (rc=0) | 2 (rc=0) | 0 (rc=0) | 1 (rc=0) | 3 (rc=0) | 81 (rc=0) | 141 | PASS |
| M1-08/1 · `M1-08-1-20261017-031423` | 12 (rc=1) | 1 (rc=0) | 1 (rc=0) | 1 (rc=0) | 2 (rc=0) | 82 (rc=0) | 103 | FAIL |
| M1-08/2 · `M1-08-2-20261017-032506` | 11 (rc=0) | 1 (rc=0) | 0 (rc=0) | 1 (rc=0) | 3 (rc=0) | 82 (rc=0) | 102 | PASS |
| M1-09/1 · `M1-09-1-20261017-034714` | 63 (rc=1) | 1 (rc=0) | 0 (rc=1) | 2 (rc=1) | 5 (rc=0) | 81 (rc=0) | 157 | FAIL |
| M1-09/2 · `M1-09-2-20261017-035612` | 87 (rc=1) | 8 (rc=0) | 0 (rc=0) | 1 (rc=0) | 5 (rc=0) | 82 (rc=0) | 188 | FAIL |

## M2 后续

在同一 fixture 上补 Attempt admission/启动、submission/Candidate、伪造/重复/过期提交拒绝、Attempt 重启恢复；CLI 若能合法到达已绑定 coordinator 路径，增加明确的 `mission_managed` 断言。独立验证 M3、集成/Approval/完成 M4、完整 replanning M5 不能从此 M1 证据外推。
