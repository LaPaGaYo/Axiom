# M3 host smoke: one real Mission end to end — Claude plans over MCP, the plan is approved, Codex Workers run the root Tasks, verification settles them

Verifier, 2026-11-02 (03:46–04:00 MST), main `0239264fbb` (M3-08h + the claude certification pushed). Henry: "同意用fixture连起来跑一次". Until now every real-harness run exercised one role in isolation (Codex Worker/Planner on 2026-10-26/28, Claude Worker on 10-28, Claude Planner on 10-29); this run connects them on the fixture Mission with the product's own Scheduler, Verification and policy in between. Result: **the chain works first time** — the real Planner's 12-Task DAG was approved, its three root Tasks ran as three concurrent real Codex Workers, every candidate passed independent verification on the first Attempt, and the proxy saw zero refused egress. The nine dependent Tasks stay `DEFINED` by design (INTEGRATED-threshold edges; integration is M4).

Spec: the "full chain" test of `tests/e2e/mission-real-claude.smoke.spec.ts` (verifier-local, git-excluded); launcher `launchers/smoke-real-chain.command`; settings `.axiom-work/smoke/real-chain.env` (`AXIOM_SMOKE_CHAIN_WORKER=codex`). Evidence `.axiom-work/smoke/real-chain-enforce-20261102-034554/chain/` (plan, roots, audits, tasks, submissions, verification, candidates, workers, progress, chain-summary, egress, mcp-journal, keychain-bridge, codex-auth-refresh, account-home-at-start/end, phases). Log `.axiom-work/logs/smoke-real-chain-20261102-034554.log`.

## Setup

- Harnesses unchanged since the certifications: `claude` 2.1.312 (`/Users/henry/.local/bin/claude`), `codex-cli` 0.163.0 (`/opt/homebrew/bin/codex`); node 24.21.0, pnpm 12.14.0.
- Accounts: the fixed Claude smoke userData (`~/.config/axiom/smoke/claude-userdata`, account `smoke-claude`, Keychain item found through the isolated-HOME bridge) plus the Codex smoke login (`~/.config/axiom/smoke/codex-home/auth.json`, `auth_mode: chatgpt`) copied into a temporary managed account home `<userData>/codex-accounts/smoke/home` and removed afterwards (`last_refresh` unchanged → nothing copied back).
- Mission policy at creation (no later policy patch — `axiom.policy.update` refuses a budget change without an Approval): routing `preferredProviders [claude, codex]`, `disallowedProviders [opencode, antigravity]`, `roles.planner claude`, `roles.worker codex`; `concurrencyLimit 3`; `budget.maxRuntimeMinutes 20` (rule d cap per Attempt); `verificationRules.setupCommands ['pnpm install --frozen-lockfile --prefer-offline']`, `repositoryGates {low|medium|high: ['pnpm run verify:full']}` (D65). Everything else `DEFAULT_MISSION_POLICY`.
- Egress pass `enforce` (production posture, M3-08g allowlist): every harness got the six proxy variables → blackhole (= the recording proxy) and `NO_PROXY` with only its own domains + loopback; the proxy therefore records only refused attempts. Fixture clone at `a6a8413ecdcb` (`fixture-v1`).

## Timeline (`phases.json`, from launch)

| t | phase |
|---|---|
| 0:01 | accounts seeded (Claude managed account + Codex managed account) |
| 3:29 | `PLAN_REVIEW` — real Claude Planner (structured channel, `egress_pinned {allowlist, noProxy: [api.anthropic.com, platform.claude.com, loopback]}`) proposed `planrev_73daa77846a5` through `mcp__axiom__plan_propose` in 206 s: 12 Tasks / 17 edges / 3 roots; journal rows carry the tool call and the server result `{"ok":true,…,"taskCount":12,"edgeCount":17}`; no `attempt.permission_denied` at all this time; `planner.stopped {plan_proposed}` |
| 3:30 | `axiom.plan.approve` (resolver `smoke`, provenance `user`) → `plan.materialized` (12 `task.created`, edges `INTEGRATED`) → `axiom.mission.start` → `EXECUTING`, `integration.base_created` (`axiom/integration/mission_e63bbeea242d` at the fixture commit) |
| 3:30 | `scheduler.round {trigger: mission_start}` admits the three roots in one round (`attempt.admitted ×3`, AgentSpec + ContextPackage ids each): T01 → `task_fd3cffc0e225`, T02 → `task_56306ec5ec02`, T03 → `task_5dad4655b985`; three real `codex exec --json -s workspace-write -c sandbox_workspace_write.network_access=false -c approval_policy="never" -c features.hooks=false` + the four D83 pins, each in its own attempt worktree, `requested.egress.mode allowlist`, `launch_mismatch` empty |
| 5:27 | T01 `attempt.submitted` → `verification.claimed/prepared` → **PASS** (setup 2.0 s + `verify:full` 6.2 s) → `VERIFIED`; terminal released |
| 7:14 | T03 submitted → **PASS** (0.4 s + 6.4 s) → `VERIFIED` |
| 12:46 | T02 submitted → **PASS** (0.4 s + 6.4 s) → `VERIFIED` |
| 13:40 | no active Task for 60 s → chain settled; Mission still `EXECUTING` (dependents `DEFINED`); app closed, proxy report, Codex auth returned |

Wall clock 835 s for the whole run (Electron + Planner + three Workers + three verifications).

## The three root Tasks (`chain-summary.json`, `submissions.json`, `verification.json`)

| Task (real Planner's spec) | Worker | Submission | Verification |
|---|---|---|---|
| T01 `Sprint entity type and validation` (low, maxAttempts 2, scope 4 domain files) | `ctx_c1f1ba96d99b`, 29 events, exit 0; usage in 199,322 (cached 187,136) / out 4,791 (reasoning 623) | 3 files; checksRun: `pnpm install` fail, `verify:full` fail, vitest fail, `tsc --ignoreConfig …` pass, inline node assertion pass, `git diff --check` pass; limitation "Full verification and Vitest tests remain unverified pending host dependency setup." | `vrun_bec7c92e…` PASS `checks_passed`; diff gate 3 paths, 0 scope / dangerous / secret / tampering findings |
| T02 `Tabular CSV interchange with legacy handling` (medium, maxAttempts 3, scope 9 entries incl. two docs and three test files) | `ctx_7fc3782196f7`, 67 events, exit 0; in 1,162,492 (cached 1,115,520) / out 22,364 (reasoning 6,299) | 15 files, all inside the Planner's scope; checksRun: install/verify fail, its own vitest config + csv smoke + `tsc` + `oxlint src tests` + `git diff --check` pass; risk "integration suite awaits verification in the locked dependency environment" | `vrun_616155bb…` PASS; 15 paths, 0 findings |
| T03 `plan report of ready tasks grouped by project` (low, maxAttempts 2) | `ctx_776d680e8fe9`, 50 events, exit 0; in 471,518 (cached 427,520) / out 10,066 (reasoning 1,260) | 9 files; checksRun: install/verify/tsc/vitest fail, oxlint pass, inline runtime smoke pass; limitation "require host dependency setup" | `vrun_867c8715…` PASS; 9 paths, 0 findings |

Every Worker said plainly that it could not run `pnpm install` / `pnpm run verify:full` inside the Codex sandbox (network off, isolated store) and that its own checks do not replace the required suite; the independent verification ran exactly those two commands in a fresh verification worktree from each candidate commit and they passed. Worker claims never entered the verdict (D65 / invariant 4). Audit shape per root: `attempt.admitted → attempt.headless_prepared → attempt.started → attempt.submitted (usage, providerSessionId) → message.sent/received (SUBMISSION) → verification.claimed → verification.prepared → attempt.transcript_archived → attempt.terminal_released → verification.passed → task.stage VERIFIED`.

## Egress and accounts

- `egress.json` (enforce): **zero hosts recorded** — no refused attempt from Claude, Codex, their children or the app in the whole run; `requested.egress.mode allowlist` on every Attempt and `attempt.egress_pinned {allowlist}` on the Planner. (The Claude Planner's Datadog attempt seen in record mode on 10-28/29 did not appear; under the allowlist it would have been recorded as refused.)
- Codex auth: `last_refresh` unchanged, temporary `auth.json` removed. Claude account home: no entry added during the run; `.claude.json` rewritten by the structured session as on 10-28/29 (key set unchanged, 59 keys). No `.credentials.json` anywhere.

## Findings and residuals

1. **The pipeline holds together with real agents**: Planner (claude, MCP) → human approval → materialization → integration base → Scheduler admission (3 concurrent) → three real Workers → submissions → independent verification → `VERIFIED`, with the Control Plane deciding every transition. Cross-provider routing by role worked (`crossProvider.applied false` in the combination because the explicit `roles.worker` decided, not the planner-actor rule).
2. **Nothing moves past `VERIFIED`**: dependents T04–T12 stay `DEFINED` because V1 edges require `INTEGRATED` upstream Tasks and nothing produces that stage before M4 (Integration Queue). Expected, and the first thing M4 unblocks. The Mission stays `EXECUTING` with three `VERIFIED` roots — correct for M3.
3. **A Worker borrowed tools from outside its worktree**: T03's Codex Worker ran `/Users/henry/Documents/Axiom/node_modules/.bin/vitest` and `…/oxlint` — binaries of an unrelated repository on the host — because the sandbox allows reads everywhere and its own `node_modules` was empty. Harmless here (read-only, same user, verification ignores Worker checks), but it is exactly the kind of implicit dependency the M3-04b preamble should forbid ("use only the worktree's own toolchain; if it is missing, say so — verification runs `setupCommands` for you") and that a stricter sandbox read scope would close (M3-10 / DEF-46 territory).
4. **Verifier bookkeeping bug, not product**: the first version of the chain test compared plan Task ids (`T01…`) with Control Plane Task ids (`task_<hash>`) when deciding which rows were roots, so its final "dependents stay DEFINED" assertion fired on a `VERIFIED` root and Playwright reported the run as failed although every product assertion had passed. Fixed in the spec (`planTaskId` from the stored spec); the evidence above is from the run itself.
5. Known noise unchanged: `planner.stopped ×2` (the reconciliation tick re-releases the stopped Planner, M3-10).
6. Not exercised this run: a `FAIL → NEEDS_FIX → fix Attempt` loop (all three candidates passed first time — the e2e exit spec covers the loop with the fake harness, and a real loop would need a Task whose first candidate fails), Claude Workers in the chain (`AXIOM_SMOKE_CHAIN_WORKER=claude` is wired but was not run), Questions/Approvals mid-run (headless Workers cannot ask; no budget Approval was needed).

## Verdict

The M3 product path from a real plan to independently verified candidates runs unattended on the fixture with real Claude Code and real Codex, under the launch isolation and the egress allowlist, in under 15 minutes. No product defect found; one Worker-behaviour observation (3) goes to M3-04b's preamble, and the stop at `VERIFIED` is M4's job.
