# Axiom Constitution

Status: normative, version 1.0 (2026-09-26). Repository path: `docs/PROJECT_CONSTITUTION.md`. Vocabulary: `docs/GLOSSARY.md`. Decisions cited as D<n> are recorded in `docs/decisions/DECISION_LOG.md` (path per D13, proposed).

## 1. Purpose and Authority

This Constitution fixes the rules that no Task, deadline, convenience, or model output may override. Within this repository it is the highest-authority document after explicit user requirements with their approved Decisions, and after the safety, permission, and human-approval policies.

Every contributor, human or AI, MUST apply instructions in this order (the Authority Order):

1. explicit user requirements and ACCEPTED `Decision`s;
2. safety, permission, and human-approval policies;
3. this Constitution;
4. `AGENTS.md`;
5. the current APPROVED `PlanRevision` and the active `Task`'s acceptance criteria;
6. subsystem reference documentation, including `docs/reference/orca-mapping.md`;
7. existing implementation conventions.

A lower-ranked instruction MAY narrow a higher-ranked rule. It MUST NOT weaken or contradict it. When two documents disagree, a contributor MUST NOT silently pick one; report the conflict and follow this order.

`docs/GLOSSARY.md` governs vocabulary for all documents and all code: terms, role names, domain objects, enumerations, state machines, RPC namespaces, and branch names. A term, state, or enum value that conflicts with the Glossary is a defect. An enumeration MUST be changed in the Glossary, under a recorded Decision, before it changes anywhere else.

## 2. Product Mission

This repository builds Axiom, a goal-driven autonomous software engineering control plane, as a product fork of the Orca desktop app. Axiom turns a user's Mission goal into a versioned plan and a dependency-aware Task graph, assigns specialized AI Agents, executes the work in isolated worktrees of the user's repository, independently verifies every submission, integrates approved results, and preserves enough evidence to explain why a Mission is complete. It is not primarily an AI IDE, a multi-agent chat room, or a terminal launcher; its core value is reliable Mission-level planning, control, verification, integration, recovery, and governance.

## 3. Non-Negotiable Architecture Invariants

Every design, change, and Task MUST uphold all twelve invariants.

1. **LLMs propose; the Control Plane validates, authorizes, and persists.** Model output MUST NOT become authoritative state except through a schema-validated, policy-checked, attributed Control Plane command.
2. **Task lifetime is independent of Agent, terminal, session, and Attempt lifetime.** A Task MUST survive the crash, stop, replacement, or disconnection of whatever executes it.
3. **The Task DAG is the authoritative Mission work structure.** Agent trees, dispatch parents, and terminal hierarchies are execution history only and MUST NOT be used to derive readiness or completion.
4. **Worker completion is a submission, not verification.** A Worker MUST NOT verify, accept, or integrate its own work, and its report MUST NOT move a Task beyond `SUBMITTED`.
5. **All authoritative mutations pass through validated Control Plane APIs.** The renderer, the CLI, a Worker, and a model adapter MUST NOT write authoritative state directly.
6. **There is one authoritative lifecycle for each domain object.** Parallel task, worker, approval, or integration state stores MUST NOT be created. The authoritative Task stage lives in `task_stages`; Orca `tasks.status` is an execution projection only (D2).
7. **Dependencies, permissions, budgets, and approvals are enforced deterministically.** Model confidence MUST NOT override policy.
8. **Parallel changes require independent verification and serialized integration.** Passing checks in isolated worktrees MUST NOT count as proof that the combined tree passes.
9. **Remote disconnection means `unverifiable`, not exited, failed, or completed.** Loss of RPC, SSH, relay, or network contact MUST NOT be treated as process exit, and a duplicate Agent MUST NOT be started against the same worktree while an Attempt is `unverifiable`.
10. **Decision engines remain replaceable.** Jev or any other scorer MUST NOT become a required dependency of the core state machine; a rules baseline MUST always be available.
11. **Mission completion requires evidence.** Stopped Agents, idle terminals, or completed Attempts MUST NOT be taken as proof of completion.
12. **Human approval is required for policy-defined high-risk actions.** A model, a Worker, or a Decision Engine MUST NOT grant, widen, or bypass an Approval.

A feature that violates an invariant MUST NOT be implemented even if it appears to simplify the current Task. Escalate the conflict under §7 instead.

## 4. Domain Authority Map

| Concern | Authority |
|---|---|
| Mission state, bound repository, target branch, budget cap, policy | `missions` (Orca `runs` is only the container and the `run:<runId>` mailbox; it has no status column) |
| Mission goal and constraints | the active `GoalRevision` (`goal_revisions`) |
| Mission plan | the APPROVED `PlanRevision` (`plan_revisions`); exactly one is APPROVED per Mission at any time |
| Work dependencies | the `TaskEdge` DAG in the Control Plane (`mission_task_edges`; per D10, proposed) |
| Task stage | `task_stages.stage` (D2) |
| Task execution | the active `Attempt`, which is the Orca dispatch (`attemptId ≡ dispatchId`) |
| Agent process state | the execution host's liveness verdict: `live`, `unverifiable`, `exited` |
| Worker output | the immutable `Submission`, its `Candidate` (commit and tree hash, snapshotted by the Control Plane, D4), and the referenced `Artifact`s |
| Task acceptance | the `VerificationRun` verdict and its required evidence |
| Promotion readiness | the `IntegrationBatch` result |
| High-risk permission | an active `Approval` scoped to the exact action (`approvals`, D7) |
| Architectural choice | a recorded `Decision` with provenance |
| Mission completion | completion gate evaluation and the `CompletionReport` |

The renderer, the CLI, Agent conversations, Worker summaries, and Orca `tasks.status` are projections or inputs. None of them is an authoritative state store.

## 5. Prohibited Patterns

Contributors MUST NOT introduce:

- a second Task DAG or a shadow lifecycle database;
- a monolithic Master Agent that owns durable state;
- direct Agent-to-Agent spawning;
- Worker self-verification or self-promotion;
- direct renderer-to-database writes;
- UI-derived execution truth;
- implicit global message broadcast;
- unbounded transcript injection;
- unbounded recursive Agent creation;
- model-generated permission escalation;
- a hard dependency on one Decision Engine provider;
- duplicate Agent starts after an unverifiable remote disconnect;
- integration based only on per-worktree test success;
- Mission completion based only on all Agents being idle or stopped;
- silent replacement of an APPROVED PlanRevision;
- destructive cleanup of user-owned changes;
- Orca `promoteReadyTasks` or `tasks.deps` as dependency authority for Mission-managed Tasks (per D10, proposed);
- a Worker-issued `merge_ready` message (per D9, proposed);
- direct `orchestration.workerStart` or `orchestration.taskUpdate` against Mission-managed Tasks outside the Scheduler and Control Plane (D2; per D10, proposed);
- an LLM "coordinator" consuming the `run:<runId>` mailbox; the upstream Coordinator is retired and `MissionController` is the mailbox's deterministic consumer;
- `nestedWorkerMaxDepth` greater than 1 for Mission Workers;
- RPC methods registered under `project.*`, which collides with Orca's existing `project.list` / `project.update` (D1).

## 6. Mission Completion Rule

Mission completion follows the Glossary state machine `EXECUTING → FINALIZING → READY_FOR_APPROVAL → COMPLETED`, where Delivery is the action between `READY_FOR_APPROVAL` and `COMPLETED`.

A Mission MAY enter `FINALIZING` only when every required Task of the APPROVED PlanRevision is `INTEGRATED`, or `CANCELED` with an authorized, recorded rationale.

In `FINALIZING` the Control Plane MUST evaluate the completion gates. All of the following MUST hold:

- every required acceptance criterion of the active GoalRevision has linked evidence;
- every required VerificationRun has the verdict `PASS`;
- the final IntegrationBatch has passed merged-tree regression on the integration base;
- no blocking Question, Decision, or Approval remains open;
- known risks and limitations are recorded;
- a `CompletionReport` Artifact exists that links the GoalRevision, the PlanRevisions, Tasks, Attempts, Artifacts, Decisions, VerificationRuns, IntegrationBatches, and the promoted commits.

If policy requires a final delivery Approval, the Mission MUST enter `READY_FOR_APPROVAL` and wait for a GRANTED Approval scoped to that delivery.

Delivery merges the integration base (`axiom/integration/<missionId>`) into the user's target branch. The Mission MAY enter `COMPLETED` only after Delivery succeeds and the CompletionReport records the resulting commits.

Only promoted results count toward completion. Stopped Agents, idle terminals, settled Attempts, and Orca `tasks.status = completed` prove nothing. The system MUST be able to explain why a Mission is complete; if it cannot produce that evidence, the Mission is not complete.

## 7. Conflict Handling

When a Task, a user request, an existing implementation, or an upstream Orca rule conflicts with this Constitution or with `AGENTS.md`, the contributor MUST:

1. stop the conflicting change;
2. identify the exact rules and affected objects;
3. preserve current state and user work;
4. propose the smallest safe resolution;
5. request a Decision or Approval from the correct authority;
6. resume only after the conflict is resolved and recorded.

Architecture invariants MUST NOT be reinterpreted to make a local implementation easier.

## 8. Amendment

This Constitution changes only through a recorded Decision in `docs/decisions/DECISION_LOG.md` (path per D13, proposed) that states context, alternatives, rationale, consequences, and supersession. The Decision MUST be ACCEPTED before the change is merged, and the changed text MUST cite it. There are no emergency edits: an urgent conflict is handled under §7, and the Constitution is amended afterwards.
