# AGENTS.md

Axiom is a product fork of the open-source Orca desktop app (`stablyai/orca`; audited at `646e9a5`, v1.4.197; fork baseline frozen at upstream `3eb1adec2`, tag `axiom-base`, per D19). These instructions govern every human and AI contributor working in this repository. `CLAUDE.md` imports this file; `src/main/daemon/AGENTS.md`, `tests/AGENTS.md`, and `tests/e2e/AGENTS.md` add subsystem rules that may narrow, never weaken, this file.

- The upstream MIT license and third-party notices are preserved. Keep `LICENSE` and upstream attribution intact; add a `license` field to `package.json` rather than removing notices.
- Vocabulary follows `docs/GLOSSARY.md`. The top-level domain object is the **Mission** (D1). The user's code repository is a **repository**; never call it a "Project" — in Orca, `Project` is a repository/provider identity type.
- The twelve architecture invariants, the Domain Authority Map, the Prohibited Patterns, the Mission Completion Rule, and Conflict Handling live in `docs/PROJECT_CONSTITUTION.md`. This file does not restate them; it explains how to work within them. One-line reminder: LLMs propose, the Control Plane decides and persists; Task lifetime outlives Agents; a Worker report is a submission; verification is independent; integration is serial; completion needs evidence.
- Do not add new calls to upstream vendor endpoints (`onorca.dev`, `stablyai`); fork isolation (M0) owns the network-egress inventory.

## Product Mission

This repository builds a goal-driven autonomous software engineering control plane. Axiom turns a user's Mission goal into a versioned plan and dependency-aware Task graph, dynamically assigns specialized AI Agents, executes work in isolated worktrees, independently verifies submissions, integrates approved results, and preserves enough evidence to explain why a Mission is complete. It is not primarily an AI IDE, a multi-agent chat room, or a terminal launcher; its core value is reliable Mission-level planning, control, verification, integration, recovery, and governance.

## Required Reading

Before making product or architecture changes, read:

- `docs/PROJECT_CHARTER.md`;
- `docs/ARCHITECTURE.md`;
- `docs/PROJECT_CONSTITUTION.md`;
- `docs/GLOSSARY.md`;
- `docs/reference/orca-mapping.md` for anything touching orchestration, the runtime, or the Execution Kernel;
- `docs/STYLEGUIDE.md` for UI work;
- `docs/decisions/DECISION_LOG.md` (path per D13, proposed);
- the relevant document under `docs/reference/` for any subsystem being changed (for example `docs/reference/ssh-execution-boundary.md`, `docs/reference/git-compatibility.md`).

Upstream orchestration documentation lives in `skill-guides/orchestration.md`, `skill-guides/orchestration/references/`, and `docs/site/content/docs/cli/orchestration.mdx`. Treat it as Execution Kernel reference: it describes the retired LLM-coordinator workflow, which Axiom does not use.

If these documents disagree, do not silently choose one. Report the conflict and follow the Authority Order.

## Authority Order

The normative Authority Order is `docs/PROJECT_CONSTITUTION.md` §1. This file ranks fourth: below explicit user requirements and ACCEPTED Decisions, the safety/permission/human-approval policies, and the Constitution; above the APPROVED `PlanRevision` and `Task` acceptance criteria, subsystem reference documentation, and existing implementation conventions. A lower-level instruction may narrow a higher-level rule but may not weaken or contradict it.

## Execution Kernel Boundary

Reuse the Orca-derived Execution Kernel for:

- terminal, PTY, daemon, and process lifecycle;
- Git, worktrees, source control, and diffs;
- provider adapters and Agent hooks;
- Agent sessions and terminal Agents;
- SSH, WSL, relay, and paired runtimes;
- browser and computer execution capabilities;
- Agent status (the hook server's store);
- orchestration primitives, within these limits:
  - Orca `Run` only as the Mission container and the `run:<runId>` mailbox. The `runs` table has no status column; Mission state lives in `missions`.
  - The automatic Coordinator/scheduler (`coordinator.ts`, `coordinator_runs`, `orchestration.run`/`runStop`, CLI `coordinator-start`) is retired upstream and MUST NOT be revived. `MissionController` is the deterministic consumer of the run mailbox; the Scheduler is database-driven and restartable.
  - Dispatch and worker lifecycle (`dispatch_contexts`, `worker_dispatches`, `transitionLifecycleWithDb`): an Attempt is an Orca dispatch, `attemptId ≡ dispatchId`.
  - Messages, deliveries, and wake-up (`check --wait` long-poll, PTY nudge, structured-session turns).
  - Dispatch capability (`dcap_…`) validation, `consumer_generation` fencing, and `mutation_receipts` idempotency.
  - Decision gates for `QUESTION` blocking only, never as Approvals (D7).
  - Federation (`worker-start --on <environment>`) for remote placement, post-V1 (D8).

Extend these primitives through their existing service and RPC boundaries. Do not:

- write directly to orchestration SQLite from the renderer, a Worker, or a model adapter;
- launch shell processes directly from UI code;
- create a second worktree manager, terminal manager, or worker lifecycle;
- infer remote process state in the client;
- bypass runtime capability or compatibility checks;
- duplicate an existing RPC method with a product-specific shortcut.

Before creating new infrastructure, search for an existing implementation that can be extended. Prefer a narrow adapter or a new validated RPC method over a parallel subsystem.

## Axiom Control Plane Code Placement and RPC Conventions

- Control Plane services live in `src/main/axiom/`; zod schemas and types shared by main, CLI, and renderer live in `src/shared/axiom-contract/`. Axiom code reaches the runtime only through RPC method registration and existing service boundaries (per D12, proposed).
- Never add logic to a `@ts-nocheck` file. 137 of the ~150 non-test `orca-runtime-*.ts` modules are listed in `config/ts-nocheck-baseline.txt`, including `orca-runtime-core.ts` and `orca-runtime-automation-operations.ts`; add a typed adapter beside them instead, and do not grow the baseline (per D12, proposed).
- The RPC namespace is `axiom.*` only: `axiom.mission.*`, `axiom.goal.*`, `axiom.plan.*`, `axiom.task.*`, `axiom.attempt.*`, `axiom.verification.*`, `axiom.integration.*`, `axiom.approval.*`, `axiom.decision.*`, `axiom.artifact.*`, `axiom.message.*`, `axiom.policy.*`. Never `project.*`: it collides with the existing `project.list` / `project.update`, `projectHostSetup.*`, `projectGroup.*`, `automation.*`, and CLI `orca project`, and `buildRegistry()` throws `duplicate_rpc_method` at startup (D1).
- Register a method in five steps: (1) zod params in `src/shared/axiom-contract/<ns>-params.ts`; (2) `defineMethod({ name: 'axiom.<ns>.<verb>', params, handler })` in `src/main/runtime/rpc/methods/axiom/<ns>.ts`, aggregated into `AXIOM_METHODS` (`src/main/runtime/rpc/methods/axiom.ts`); (3) spread `AXIOM_METHODS` into `ALL_RPC_METHODS` in `src/main/runtime/rpc/methods/index.ts`; (4) regenerate `src/shared/rpc-contract/rpc-params-catalog.generated.ts` with `config/scripts/generate-rpc-params-catalog.mjs` (`verify:rpc-params-catalog` runs inside `pnpm lint`); (5) for CLI exposure, add the spec in `src/cli/specs/`, the handler in `src/cli/handlers/`, and the command name in `src/main/startup/cli-command-names.ts`. The product CLI binary is `axiom`.
- Every orchestration mutation carries `orchestrationContractVersion: 1` in the request envelope (`ORCHESTRATION_MUTATION_METHODS` in `src/shared/orchestration-rpc-contract.ts`; the fence in `src/main/runtime/rpc/orchestration-contract-fence.ts` otherwise returns `orchestration_migration_required`). `axiom.*` mutations that touch orchestration tables follow the same fence and reuse `mutation_receipts` for idempotency.
- Schema changes are additive only. Axiom tables (`missions`, `goal_revisions`, `plan_revisions`, `task_stages`, `mission_task_edges`, `agent_specs`, `context_packages`, `submissions`, `candidates`, `artifacts`, `decisions`, `verification_runs`, `integration_batches`, `approvals`, `mission_policies`, `audit_events`, `attempt_bindings`) are side tables added from migration v43 onward in `src/main/runtime/orchestration/db/schema/` (`SCHEMA_VERSION` is 42 at the fork point). Never edit an existing CHECK enum (`tasks.status`, `messages.type`, `dispatch_contexts.status`, `worker_dispatches.state`, …): that rebuilds tables and breaks the downgrade handling in `src/main/runtime/orchestration/orchestration-schema-version-skew.ts`. Additive Attempt evidence goes into `attempt_observation_facts` facets (`artifact_git`, `outcome`).
- Authoritative state lives in Orca's `orchestration.db`. Artifact content is content-addressed under `<userData>/axiom/artifacts/<sha256>`; the database stores references and hashes only, and large logs never go into SQLite.
- Environment variable names inherited from Orca (`ORCA_TERMINAL_HANDLE`, `ORCA_PANE_KEY`, `ORCA_AGENT_*_TOKEN`, `ORCA_BACKGROUND_LAUNCH`, …) stay unchanged in V1. Renaming them is out of scope and would need a Decision.

## Control Plane Boundary

The Control Plane owns:

- Mission, GoalRevision, PlanRevision, and Milestone lifecycle;
- TaskEdge DAG validation and Task readiness;
- Scheduler admission and concurrency limits;
- AgentSpec and ContextPackage creation;
- typed message and Artifact routing;
- verification orchestration;
- the Integration Queue and promotion;
- Approval policies;
- budget and permission enforcement;
- retry, recovery, and replanning triggers;
- audit events and completion gates.

Its services are named as in `docs/GLOSSARY.md` §2: MissionController, Scheduler, AgentFactory, ContextBuilder, MessageRouter, VerificationService, IntegrationController, ApprovalGateway, RecoveryService, AuditLog. Do not introduce "Coordinator", "ProjectController", or "integration owner".

The Control Plane must be restartable. Durable behavior may not depend on one long-running Master Agent conversation or an in-memory-only scheduler: Scheduler state is derived entirely from the database, and RecoveryService reconciles every non-terminal Attempt against execution-host liveness at startup and periodically.

## Mission Intelligence Boundary

Planner, Architect, Reviewer, and Replanner models may:

- analyze requirements and code;
- propose PlanRevisions, Tasks, dependencies, and acceptance criteria;
- propose architecture Decisions;
- diagnose failures;
- recommend local adjustment or major replanning;
- perform semantic review.

They may not directly:

- mutate authoritative state;
- mark Tasks verified or integrated;
- bypass schema validation;
- grant permissions or approvals;
- merge or promote changes;
- create unbounded recursive work;
- reinterpret a failed deterministic check as passed.

Every model-produced proposal must be schema validated, policy checked, attributed, and persisted through a Control Plane command. Reviewer output is advisory: it can resolve an `INCONCLUSIVE` verification, never overturn a deterministic `FAIL`.

## Decision Engine Boundary

Use the `DecisionEngine` abstraction (`choose`, `score`, `classify`, `rank` over a closed candidate set) for bounded selection, classification, scoring, or ranking. Valid uses include provider routing, Context candidate ranking, event routing, risk classification, and replan triage.

Decision Engine output is advisory unless an explicit deterministic policy authorizes automatic action at the returned confidence and risk level.

Never use a Decision Engine to override:

- dependency readiness;
- authorization or filesystem scope;
- required tests;
- Approval requirements;
- Integration ordering;
- destructive-action policy.

`RulesEngine` is the mandatory baseline and ships in V1 (D8). Jev is an optional typed decision model; it, local classifiers, and frontier-model fallbacks must implement the same replaceable interface.

## Task and Attempt Rules

Before beginning implementation, confirm that the Task defines:

- objective and expected outcome;
- owning Mission and PlanRevision;
- dependencies (TaskEdges) and readiness;
- allowed scope;
- acceptance criteria;
- required evidence;
- risk and Approval requirements;
- `retryPolicy` (Task-level `maxAttempts`) and budget limits.

The authoritative Task stage is `task_stages.stage` (D2): `DEFINED → READY → RUNNING → SUBMITTED → VERIFYING → VERIFIED → INTEGRATION_READY → INTEGRATED`, with `NEEDS_FIX`, `BLOCKED`, and `CANCELED` as defined in the Glossary. `READY` means the upstream TaskEdges meet their readiness threshold (default `INTEGRATED`, relaxable per edge to `VERIFIED`), the PlanRevision is APPROVED, no blocking Question or Approval is open, and budget remains. MissionController computes readiness; Orca `promoteReadyTasks` does not (per D10, proposed).

An `Attempt` is one execution of a Task and is an Orca dispatch: `attemptId ≡ dispatchId`. Attempt state is a projection of `dispatch_contexts.status`, `worker_dispatches.state`, and the liveness verdict; do not add a parallel Attempt table or enum. Retrying creates a new Attempt (`retryOf` the prior dispatch); it must not erase the previous Attempt or silently reuse stale completion authority. When `maxAttempts` is exhausted the Task becomes `BLOCKED`, the change is classified for replanning, and Approval is requested per policy; the Control Plane count is authoritative and Orca's dispatch circuit breaker (`circuit_broken`) is only a floor.

Every Attempt must be attributable to its Task, AgentSpec, ContextPackage, workspace, session, provider, and immutable output Candidate.

Do not broaden Task scope while implementing. New work must become one of:

- a recorded clarification;
- a Decision proposal;
- a follow-up Task;
- a Control Plane `REQUEST_SUBTASK` request;
- a replanning trigger.

## Agent Factory and Worker Rules

An AgentSpec is an execution contract, not a persona, and is content-addressed in `agent_specs`. It defines:

- role and required capabilities;
- provider, model, and reasoning configuration;
- Task and acceptance criteria;
- ContextPackage identity;
- read/write/network/tool permissions;
- workspace strategy;
- budget and time limits for this single Attempt;
- required communication and submission format.

Workers may modify only their authorized scope. They must report discoveries that affect other Tasks through typed messages or Artifacts.

Workers talk to the Control Plane only through the `axiom` CLI — `axiom attempt submit | ask | blocked | handoff | inform | request | request-subtask | check` (all Worker verbs live under `axiom attempt`, because Orca's CLI already has a top-level `check` command — per D16, proposed) — which calls `axiom.attempt.*` RPC methods and carries the Orca dispatch capability (`--dispatch-capability dcap_…`). The RPC layer reuses Orca's `hasLifecycleAuthority` check, capability hash, `consumer_generation` fence, and `mutation_receipts`; Control Plane replies reach the Worker through its `dispatch:<dispatchId>` mailbox (`axiom attempt check`). No MCP server is introduced for this channel (per D11, proposed).

Workers must not directly spawn other Workers. `nestedWorkerMaxDepth` is pinned to 1 for Mission Workers by policy. A Worker may send `REQUEST_SUBTASK`; the Control Plane decides whether to create a Task after checking scope, depth, duplication, dependency, cost, and permissions.

Orca `tasks.deps` stays empty for Mission-managed Tasks (the Orca-side `ready` status means only "dispatchable"). The DAG lives in `mission_task_edges`, the Scheduler is the only dispatcher, and admission rejects direct `orchestration.workerStart` / `orchestration.dispatch` against Mission-managed Tasks (per D10, proposed).

Workers must not communicate Mission-changing decisions only through terminal text. Persist decisions and handoffs as typed objects.

## Context Package Rules

Provide the smallest sufficient, reproducible context for the Attempt:

- Task spec and acceptance criteria;
- relevant PlanRevision and Decisions;
- direct dependency Artifacts;
- selected source files and interfaces;
- repository and subsystem rules;
- required verification commands;
- permissions, budget, and submission contract.

Do not inject the full Mission history or every Agent transcript by default. ContextBuilder combines a mandatory include set (safety, contract, and permission context, chosen deterministically) with a ranked candidate set under a token budget.

Every ContextPackage is content-addressed in `context_packages` so an Attempt can be audited and reproduced.

## Typed Communication

Use typed messages rather than unbounded Agent-to-Agent chat. The eight product types, who may send them, and their Orca routing type (per D9, proposed):

| Axiom type | Meaning | Sender | Orca `messages.type` (routing only) |
|---|---|---|---|
| `INFORM` | relevant state or compatibility change | Worker, Control Plane | `status` |
| `REQUEST` | resource, permission, or Control Plane action | Worker | `escalation` |
| `QUESTION` | blocking question with a clear recipient | Worker, Control Plane | `question` (+ decision gate) |
| `DECISION` | choice, alternatives, rationale, and authority | Control Plane | `status` (body in `decisions`) |
| `BLOCKED` | reason execution cannot continue | Worker | `escalation` |
| `HANDOFF` | Artifact and responsibility transfer | Worker | `handoff` |
| `REQUEST_SUBTASK` | request for new scoped work | Worker | `escalation` |
| `SUBMISSION` | immutable candidate and Worker report | Worker | `worker_done` (settled by Axiom) |

- The product type is persisted in `payload.axiom.type`; `messages.type` is used for routing only and its CHECK enum is not extended (per D9, proposed).
- Every message carries `missionId` plus the related `taskId`, `attemptId`, `decisionId`, or `artifactId`.
- Workers must never send `merge_ready`, `dispatch`, or `decision_gate`; the Control Plane rejects them. `heartbeat` is an Execution Kernel liveness signal, not a product message type.
- Put summaries in messages and detailed content in Artifacts. MessageRouter routes to affected subscribers by object relationship; do not broadcast (`@all`) by default.

## Worker Submission Contract

A Worker submission (`axiom attempt submit`) must include:

- Task and Attempt identifiers;
- a concise implementation summary;
- files changed;
- tests and checks run with results;
- produced Artifacts;
- known limitations and risks;
- unresolved questions;
- suggested follow-up work.

The Control Plane, not the Worker, fixes the candidate identity: at submission it creates a snapshot commit on the Attempt worktree (or adopts `HEAD` when the tree is clean and `HEAD` already contains all changes) and records the commit and tree hash as the immutable `Candidate` referenced by the `Submission` (D4). After settlement the Attempt worktree is retained read-only until the Candidate is `SUPERSEDED` or `INTEGRATED`.

A Worker report may move the Task stage only to `SUBMITTED`. It must not directly produce `VERIFIED`, `INTEGRATION_READY`, `INTEGRATED`, or Mission `COMPLETED`. Orca `tasks.status = completed` after `worker_done` settlement means "current Attempt settled" and must never be displayed or treated as done (D2).

Reject stale, duplicate, mismatched, or unauthorized submissions without mutating the current Attempt, reusing Orca's rejection codes (`unknown_task`, `unknown_dispatch`, `task_dispatch_mismatch`, `inactive_dispatch`, `stale_dispatch`, `sender_not_assignee`, `dispatch_capability_invalid`). Extend the `worker_done` payload only with optional additive fields.

## Independent Verification

Verification must be independent of the implementation Worker and bound to an immutable Candidate. VerificationService runs it in a dedicated verification worktree checked out at the candidate commit, never in the Worker's worktree.

Use the smallest relevant checks first, then the required repository gates. Depending on scope, verification includes:

- unit and integration tests;
- type checking;
- lint and formatting checks;
- build or packaging checks;
- migration validation;
- security or permission checks;
- acceptance-criteria evaluation;
- diff and scope inspection;
- Artifact inspection;
- UI rendering and interaction validation;
- merged-tree regression tests.

Record in `verification_runs` (evidence as content-addressed Artifacts; `artifact_git` / `outcome` facets may be appended to `attempt_observation_facts`):

- candidate identity;
- commands and tool versions;
- per-check result `pass | fail | inconclusive | skipped` (`skipped` needs a policy basis) and the run verdict `PASS | FAIL | INCONCLUSIVE`;
- relevant output or evidence location;
- acceptance criteria covered;
- reviewer or verifier identity;
- unresolved risks.

Do not infer success from a Worker summary. A failed deterministic check cannot be overruled by an LLM statement. `INCONCLUSIVE` escalates to `SPECIALIST_REVIEW` or `HUMAN_REVIEW` per policy; review may only resolve `INCONCLUSIVE` to `PASS` or `FAIL` and can never overturn a deterministic `FAIL`. Non-code Tasks are verified on Artifact existence, schema validity, acceptance review, and optional human review.

Known limitation: write scope cannot be enforced at runtime for CLI agents. V1 enforcement is verification-time diff inspection (out-of-scope changes → `FAIL`) plus best-effort provider configuration. State this in the Task's risk when relevant.

For this repository, use the existing commands unless a Task changes them:

- Typecheck: `pnpm tc`, or the narrow `pnpm tc:node`, `pnpm tc:cli`, or `pnpm tc:web`;
- Tests: `pnpm test <relevant-test-path>`;
- Changed-code quality: `oxlint` or `pnpm run check:code-quality:changed`;
- Full lint when required: `pnpm lint` (includes `verify:rpc-params-catalog`);
- Formatting: `pnpm format`;
- Design-system report for renderer work: `pnpm run lint:design-system`.

Never claim checks passed if they were not run. State why a required check could not run and what risk remains.

## Fixtures

V1 validates against two fixture classes (D18):

- The **Controlled Acceptance Fixture** is a frozen, organization-controlled repository pinned to a commit, a Node version, and a package-manager version, with deterministic offline build, typecheck, lint, unit, and integration checks. Its baseline changes only through an explicit fixture-version Decision. Every demo scenario and its expected outcome lives in a versioned fixture manifest; do not improvise scenarios in tests or transcripts.
- The **Blind External Validation Fixture** is selected independently after M4 is substantially complete. Do not use it — its code, its tests, or its history — to tune planning prompts, routing rules, Task templates, or verification policies before the blind validation run. Record the blind run's outcome as evidence whether or not it passes.

## Integration and Promotion

Verified candidates enter a single Integration Queue. IntegrationController is the single integration authority and serializes application to the integration base.

Branch model (D6):

- integration base `axiom/integration/<missionId>`, written only by IntegrationController;
- Attempt branch `axiom/attempt/<taskId>/<seq>` (seq = the Task's Attempt sequence number assigned by the Control Plane; the dispatch id that is the attemptId is minted after the worktree exists, so it cannot be in the branch name — D6a, proposed; `attempt_bindings` maps `dispatch_id ↔ seq ↔ branch`), created from the current integration base in the Attempt's child worktree; integration scratch branches are `axiom/integrating/<batchId>`;
- promotion (`PROMOTED`) = advancing the integration base to the batch's merge commit; Delivery = merging the integration base into the user's target branch (default: the repository's default branch) via `axiom.mission.deliver`, with Approval when policy requires it;
- both the integration base and the target branch are protected: a Worker Attempt never merges into them directly.

In V1 each IntegrationBatch contains exactly one candidate, applied in queue order (D5). Each batch must record:

- base identity;
- ordered candidate identities;
- merge or application result;
- conflicts and resolutions;
- merged-tree verification evidence;
- required Approval;
- promotion result.

Passing checks in isolated worktrees does not prove that combined changes pass. Run required regression checks on the integrated tree (`APPLYING → TESTING → PROMOTABLE`, then `AWAITING_APPROVAL` when policy requires it, then `PROMOTED`).

Integration failure follows D3: a textual conflict (`CONFLICT`) returns the original Task to `NEEDS_FIX`, and the next Attempt's ContextPackage carries the conflict evidence; a merged tree that fails regression (`FAILED`) creates a `FIX_TASK` on which the affected Tasks depend while they stay `INTEGRATION_READY`. In both cases the original Candidate becomes `SUPERSEDED` and is never requeued. Do not silently resolve semantic conflicts; request a Decision when the correct resolution is not deterministic.

A Task is `INTEGRATED` only when its batch is `PROMOTED` (the integration base ref advanced to the merge commit). Only promoted results count toward Mission completion.

## Replanning

Do not replan the whole Mission after every Task. Classify changes as:

- `NO_REPLAN`: expected progress or local fix;
- `MINOR_ADJUSTMENT`: Task, dependency, AgentSpec, or Context change within the approved architecture;
- `MAJOR_REPLAN`: Goal change, invalidated architecture, unavailable critical dependency, repeated systemic failure, or broad integration conflict.

A major replan moves the Mission to `REPLANNING` and creates a new PlanRevision (`PROPOSED → APPROVED → SUPERSEDED`, or `REJECTED`). Exactly one PlanRevision is APPROVED per Mission at any time; when a new revision takes effect, each existing Task is inherited, canceled, or rebound, and the choice is recorded. Never overwrite the prior approved plan or erase the reason for revision. A Goal change creates a new GoalRevision and is always a `MAJOR_REPLAN`. Whether PlanRevisions are approved manually or automatically is a Mission Policy setting.

## Human Approval

Stop and request explicit Approval for policy-defined high-risk actions, including:

- destructive or difficult-to-recover operations (including `orchestration.reset`);
- permission, credential, or network-scope expansion;
- irreversible data migrations;
- security-sensitive policy changes;
- release, deployment, production promotion, high-risk batch promotion, or Delivery into the target branch when policy requires it;
- budget increases beyond the approved limit;
- decisions with material product ambiguity;
- repeated automated failure with no safe bounded recovery.

Approvals are stored in `approvals` (D7) with action kind, scoped inputs hash, risk, requester, expiry, resolver, resolution, outcome, and execution time. Lifecycle: `PENDING → GRANTED | DENIED | EXPIRED | REVOKED`, then `GRANTED → CONSUMED`; an Approval is single-use and is consumed by the exact action it authorizes. ApprovalGateway never reuses an expired, consumed, or differently scoped Approval, and a general conversation acknowledgment is not authorization. Risk `high` requires Approval by default. Orca decision gates carry `QUESTION` blocking only and are never used as Approvals.

Never expose secrets in logs, prompts, Artifacts, test output, or error messages. Use only task-authorized credentials through their normal configured mechanism.

## Destructive Actions

Before a destructive action:

1. confirm it is required by the active Task;
2. resolve exact targets with read-only checks;
3. verify authorization and Approval requirements;
4. prefer reversible operations;
5. avoid broad paths, unresolved variables, and unsafe globs;
6. record what changed and recovery options.

Never use destructive commands against a home directory, filesystem root, repository root, workspace root, or other broad target. Never use `git reset --hard` or discard user changes unless the exact operation is explicitly approved.

## Git and Worktree Safety

- Treat existing and untracked changes as user-owned unless proven otherwise.
- Work only in the worktree you were assigned: repository contributors in the primary worktree unless told otherwise, Mission Workers in their Attempt worktree. Do not follow absolute paths reported by subagents that point at the main repository checkout instead of your worktree.
- Do not edit another active Task's worktree.
- Do not merge directly from a Worker Attempt into the protected integration base or target branch; only IntegrationController writes `axiom/integration/<missionId>`.
- Do not force-push, rewrite shared history, or delete branches/worktrees without authorization.
- Use explicit paths and refs for Git operations.
- Prefer `rg` for checked-out source searches; keep history and ref scans bounded.
- Treat Git 2.25 as the core-workflow baseline (`docs/reference/git-compatibility.md`); gate newer features through `GitCapabilityCache` (`src/shared/git-capability-cache.ts`) unless a recorded Decision changes the baseline.
- Support GitLab and other providers alongside GitHub; be careful with `gh` rate limits.
- Support folder workspaces where the underlying feature is not inherently Git-specific.

## Remote Execution and Process State

The execution host owns execution truth. Preserve the verdict vocabulary of `PtyLivenessVerdict` (`src/shared/pty-liveness-verdict.ts`, `docs/reference/ssh-execution-boundary.md`):

- `live`;
- `unverifiable`;
- `exited`.

Loss of RPC, SSH, relay, or network contact is not proof of process exit. An Attempt whose liveness is `unverifiable` stays `RUNNING`; do not cold-start a duplicate Agent against the same worktree. After the policy time limit, RecoveryService moves it to `ABANDONED` with evidence. Host contact (`live/unverifiable/refused/retired`) and agent activity (`working/blocked/waiting/done`) are separate vocabularies; do not conflate them with liveness.

Over SSH the same rules apply: execution facts come from the execution host, never from client inference, and folder workspaces must keep working. Agent status has exactly one store, the hook server's (`src/main/agent-hooks/`); do not add another. Logic that reads an Agent's screen must work from a captured transcript or terminal archive, not from assumed terminal content.

Changes to RPC parameters, stream frames, or host-published data must follow mixed-version compatibility rules (the remote wire compatibility reference under `docs/reference/`): prefer optional additive fields, and gate new stream opcodes behind capability negotiation (`src/shared/protocol-version.ts`). Client and remote runtime versions update independently.

## Cross-Platform Requirements

The desktop and runtime target macOS, Linux, and Windows. Do not assume POSIX paths, shells, process behavior, keyboard shortcuts, filesystem semantics, or tool availability.

Preserve the repository's established abstractions:

- child processes only through `runProcess` / `spawnProcess` in `src/shared/child-process`;
- path construction with `path.join`, never string concatenation;
- Windows shell and command shims, and the Windows setup scripts;
- WSL execution through `buildWslExecArgs`;
- the bundled `rg` binary;
- native module packaging (`pnpm install:release` before cross-architecture packaging);
- SSH command routing;
- keyboard labels and accelerators through `CmdOrCtrl` and explicit platform checks;
- the Windows process-table, MSYS job, daemon-relocation, and EDR notes (see the Windows/WSL documents under `docs/reference/`);
- the Linux glibc 2.31 floor.

Platform-specific behavior must be behind explicit runtime checks and covered by relevant tests.

## UI and Product Experience

The product is Mission-first:

- primary views show Goal, Plan, DAG, progress, risk, evidence, and Approvals;
- terminal, editor, diff, browser, and logs are drill-down execution views;
- UI state is never authoritative Mission state;
- every optimistic transition must reconcile with the Control Plane;
- destructive and high-risk actions require clear confirmation and consequence text;
- verification evidence and unresolved risks must be visible, not hidden behind a generic success state;
- Task stage is rendered from `task_stages`; Orca `tasks.status = completed` is never shown as done;
- "Mission Control" is not used as a UI label (macOS collision).

Follow `docs/STYLEGUIDE.md`. Design tokens live in `src/renderer/src/assets/main.css`, and shared primitives are the shadcn components in `components/ui/`; both are lint-enforced (`pnpm run lint:design-system`). Do not create raw color systems, duplicate components, or local styling conventions when a repository primitive exists.

Run Electron tests and apps in the background with `ORCA_BACKGROUND_LAUNCH=1`; they must never steal focus or reveal windows on the user's desktop. Validate UI with the `$electron` skill and Playwright over CDP.

## Code Quality

- Reuse, extend, or generalize existing implementations before adding parallel logic.
- Keep modules focused and name them after concrete domain concepts. No vague file names such as `utils`, `helpers`, `common`, or `misc`.
- Prefer `.ts` over `.d.ts`.
- Prefer explicit types and zod schema validation at process and model boundaries.
- No type assertions except `as const`. An unavoidable cast needs a `SAFETY:` comment stating the assumption.
- Comments explain non-obvious reasons and invariants, not line-by-line mechanics.
- Never disable `max-lines` or any other quality gate merely to make a change pass.
- Add database migrations for durable schema changes; never edit persisted state ad hoc.
- Make lifecycle transitions transactional and idempotent where retries are possible.
- Record provenance for model proposals, Decisions, verification, and promotion.

## Change Workflow

### Before Editing

1. Read the active Task, acceptance criteria, and relevant Decisions.
2. Inspect the current worktree and preserve unrelated user changes.
3. Search for existing implementations, schemas, RPC methods, and tests.
4. Identify the owning authority and required migration/compatibility boundaries.
5. Select the narrowest safe implementation path.
6. Escalate scope or architecture conflicts before editing.

### While Editing

1. Stay within Task scope and authorized files.
2. Keep state transitions explicit and validated.
3. Preserve restart, retry, and mixed-version behavior.
4. Add or update focused tests with implementation changes.
5. Record new architectural choices as Decisions.
6. Publish cross-Task discoveries through typed messages or follow-up Tasks.

### Before Submission

1. Review the diff for scope, security, migrations, and compatibility.
2. Run relevant tests and changed-code quality gates.
3. Verify acceptance criteria against the immutable Candidate.
4. Record commands, results, Artifacts, limitations, and risks.
5. Submit the Candidate through the Task/Attempt protocol (`axiom attempt submit`); pull requests follow the repository template (before/after, mechanism, why).
6. Do not self-promote, self-verify, or merge around the Integration Queue.

## Documentation and Decisions

Update documentation when a change modifies:

- public behavior;
- architecture boundaries;
- lifecycle or state authority;
- RPC or persisted schema (also update `docs/reference/orca-mapping.md`);
- vocabulary or enumerations (update `docs/GLOSSARY.md` first);
- permissions and Approval policy;
- operator recovery procedures;
- build, packaging, or deployment requirements.

Record significant choices as Decisions with context, alternatives, rationale, consequences, and supersession rules. Append them to `docs/decisions/DECISION_LOG.md` (path per D13, proposed), continuing the D-numbering (D1–D16 and amendment D6a exist; the next is D17) with status `PROPOSED`, `ACCEPTED`, `REJECTED`, or `SUPERSEDED`; the `decisions` table in code is numbered from that log. Do not leave Mission-critical decisions only in a pull request, terminal transcript, or model conversation.

## Definition of Done for a Code Change

A code change is ready for independent verification only when:

- it stays within the approved Task scope;
- the implementation is complete for the stated acceptance criteria;
- focused tests cover changed behavior where practical;
- required type, lint, build, and test checks have been run or explicitly reported as blocked;
- durable state changes include safe, additive migrations;
- RPC and remote changes address mixed-version behavior;
- documentation, Glossary, and Decisions are updated where required;
- the submission references an immutable Candidate;
- known limitations and risks are recorded;
- unrelated user changes are preserved.

This is submission readiness, not final acceptance.

## Revision Notes (v1.1 vs. the draft)

- Split: invariants, Authority Order, Domain Authority Map, Prohibited Patterns, Completion Rule, and Conflict Handling moved to `docs/PROJECT_CONSTITUTION.md`, which the draft referenced but which did not exist (C11).
- Domain object Project → Mission; the user's repo is "repository"; `axiom.*` RPC and `axiom` CLI namespace (A6, C4, D1).
- Required Reading corrected to files that will exist, plus Glossary, `orca-mapping`, and the Decision Log; upstream skill guides marked as kernel reference (C11, D13).
- Execution Kernel reuse list corrected: Run = container + mailbox, Coordinator retired, MissionController consumes the run mailbox, decision gates for QUESTION only (C2, C3, A4, D7).
- New "Code Placement and RPC Conventions" section: `src/main/axiom/`, no `@ts-nocheck` logic, `axiom.*` only, five-step registration, contract fence, additive side tables from v43, content-addressed Artifacts, `ORCA_*` names kept (C10, D12, audit §8, C5, G4).
- Control Plane services named per Glossary; Reviewer advisory; RulesEngine baseline with Jev optional; restart reconciliation (A4, A11, A9, D8, G5).
- Task stage authority `task_stages`, readiness computed by MissionController, `tasks.deps` empty, `taskUpdate`/`workerStart` gated (B1, B2, C1, D2, D10); retry exhaustion → `BLOCKED` (B4); Attempt = dispatch projection (A5, B6).
- Worker channel = `axiom` CLI over `axiom.attempt.*` with the dispatch capability, no MCP (C6, D11); `nestedWorkerMaxDepth` pinned to 1 (C7).
- Typed Communication: eight types with the Orca routing map, `heartbeat` kernel-only, `merge_ready`/`dispatch`/`decision_gate` forbidden for Workers (A1, C5, D9).
- Submission persisted as an entity with a Control Plane candidate snapshot; Orca `completed` ≠ done; additive `worker_done` fields (B5, D4, C1).
- Verification: dedicated worktree (G1), review resolves only `INCONCLUSIVE` (B9), write-scope limitation stated (G2), facet reuse (C8), non-code Tasks (G7), `oxlint` added to the command list (audit §11).
- Integration: batch size 1 (D5), branch model (B11, D6), conflict rules (B3, D3), `AWAITING_APPROVAL` (B10).
- Replanning: PlanRevision and GoalRevision lifecycles (B8, A8), policy-driven plan approval (A10), `REPLANNING` state (B7).
- Approvals in `approvals`, single-use and scoped; gates never Approvals; `orchestration.reset` and target-branch promotion gated (C3, D7, C14, D6).
- Upstream Orca AGENTS.md rules merged (audit §11): STYLEGUIDE/tokens/shadcn, background launch, `$electron` + Playwright over CDP, `max-lines`, file naming, `.ts` over `.d.ts`, `SAFETY:` casts, PR template, primary worktree, cross-platform abstractions, glibc 2.31, `pnpm install:release`, SSH case, single agent-status store, transcript-based screen reading, additive wire changes with capability negotiation, Git 2.25 + `GitCapabilityCache`, GitLab, `gh` rate limits.
- Preamble: fork provenance, MIT license and notices preserved (C13), no new vendor endpoints (C9).
- Fixtures section: controlled acceptance fixture frozen behind a fixture-version Decision, blind validation fixture protected from tuning (G8, D18).
- Documentation rule: Decisions appended to `docs/decisions/DECISION_LOG.md` continuing the D-numbering; Glossary updated first for enum changes (D13).
