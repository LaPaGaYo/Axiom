# 延期复审登记（Deferred Decisions Register）

记录"现在不决定、到某个触发点必须重新决定"的事项。每条都有明确的触发条件与来源 Decision；到达触发点时由当时的里程碑出口检查逐条核对，结论以新 Decision 记入 `DECISION_LOG.md`，然后把这里的状态改为 `RESOLVED (Dnn)`。**里程碑出口检查必须读这个文件。**

| ID | 事项 | 触发条件（何时必须决定） | 来源 | 状态 |
|---|---|---|---|---|
| DEF-1 | 托管 CI 策略的后半部分：B（`pr.yml` 加 `push: branches: [main]`，让每次推送跑上游全套门禁；需把 changed-code 门的 `github.event.pull_request.base.sha` 改为 push 事件的 `github.event.before`）还是 C（删除上游工作流，只留 Axiom 自己的 `ci.yml`：lint + tc + 单测分片），或继续只靠本地门禁 | **M1 控制平面代码首次合入 main 之后、M1 出口之前**。复审时带上：Actions 页里 fork 的实际运行记录与分钟数、本地 `verify-merged` / 全量 suite 的时长数据、M1 新增测试的分片需求。M1-10 已整理 [本地 attempt 门禁计时与 M1 中位数](../review-evidence/axiom-m1/M1-exit-e2e.md#local-gate-timings)；其余证据与最终 Decision 由 verifier / Henry 复审 | D41（2026-10-16，Henry：先做 A） | OPEN → 待 D45（2026-10-17 复审完成，建议 A + C-lite；Henry 选定后改 RESOLVED (D45)） |
| DEF-2 | 老 profile 的 provider 重新激活：是否给已有 hook 的旧 profile 一个一次性"从已有 hook 激活"的提示（D38 风险项） | M1 的 Settings / Integrations UI 任务排期时 | D38 | OPEN |
| DEF-3 | `package.json.name`（仍为 `orca`）、`CFBundleShortVersionString` 版本线（仍沿用上游 1.4.x）、`orca-*` helper 可执行文件名与 NSIS 文案 | 首个 Axiom 发布版本的 Decision 之前 | D40 | OPEN |
