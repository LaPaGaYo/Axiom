import { z } from 'zod'
import {
  AxiomIdSchema,
  GoalRevisionSchema,
  MissionSchema,
  PlanRevisionSchema,
  PolicySchema,
  TaskEdgeSchema,
  TaskStageRecordSchema
} from '../../../shared/axiom-contract/mission-objects'
import { MissionStatusSchema, TaskStageSchema } from '../../../shared/axiom-contract/lifecycle'
import { readJson } from './row-codec'
import { AuditRowSchema } from './audit-rows'
import { AgentSpecRowSchema } from './agent-spec-rows'
import { ArtifactRowSchema, ContextPackageRowSchema, DecisionRowSchema } from './artifact-rows'
export { AuditRowCodec } from './audit-rows'
export { ArtifactRowCodec, ContextPackageRowCodec, DecisionRowCodec } from './artifact-rows'

const timestamps = { created_at: z.string().min(1), updated_at: z.string().min(1) }
export const MissionRowSchema = z.object({
  id: AxiomIdSchema,
  run_id: AxiomIdSchema,
  coordinator_orca_session_id: AxiomIdSchema,
  repo_id: AxiomIdSchema,
  repo_path: z.string(),
  target_branch: z.string(),
  status: MissionStatusSchema,
  active_goal_revision_id: AxiomIdSchema.nullable(),
  active_plan_revision_id: AxiomIdSchema.nullable(),
  previous_status: MissionStatusSchema.nullable(),
  ...timestamps
})
export const MissionRowCodec = MissionRowSchema.transform((row) => ({
  ...MissionSchema.parse({
    id: row.id,
    runId: row.run_id,
    coordinatorOrcaSessionId: row.coordinator_orca_session_id,
    repoId: row.repo_id,
    repoPath: row.repo_path,
    targetBranch: row.target_branch,
    status: row.status,
    activeGoalRevisionId: row.active_goal_revision_id,
    activePlanRevisionId: row.active_plan_revision_id
  }),
  previousStatus: row.previous_status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}))

export const GoalRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  revision: GoalRevisionSchema.shape.revision,
  status: GoalRevisionSchema.shape.status,
  objective: z.string(),
  constraints: z.string(),
  acceptance_criteria: z.string(),
  provenance: z.string(),
  ...timestamps
})
export const GoalRowCodec = GoalRowSchema.transform((row) =>
  GoalRevisionSchema.parse({
    id: row.id,
    missionId: row.mission_id,
    revision: row.revision,
    status: row.status,
    objective: row.objective,
    constraints: readJson(
      GoalRevisionSchema.shape.constraints,
      row.constraints,
      'goal_revisions',
      row.id,
      'constraints'
    ),
    acceptanceCriteria: readJson(
      GoalRevisionSchema.shape.acceptanceCriteria,
      row.acceptance_criteria,
      'goal_revisions',
      row.id,
      'acceptance_criteria'
    ),
    provenance: readJson(
      GoalRevisionSchema.shape.provenance,
      row.provenance,
      'goal_revisions',
      row.id,
      'provenance'
    )
  })
)

export const PlanRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  revision: PlanRevisionSchema.shape.revision,
  status: PlanRevisionSchema.shape.status,
  goal_revision_id: AxiomIdSchema,
  milestones: z.string(),
  risks: z.string(),
  proposal: z.string(),
  supersedes_id: AxiomIdSchema.nullable(),
  rejected_reason: z.string().nullable(),
  provenance: z.string(),
  ...timestamps
})
export const PlanRowCodec = PlanRowSchema.transform((row) =>
  PlanRevisionSchema.parse({
    id: row.id,
    missionId: row.mission_id,
    revision: row.revision,
    status: row.status,
    goalRevisionId: row.goal_revision_id,
    ...readJson(
      PlanRevisionSchema.pick({ tasks: true, edges: true }),
      row.proposal,
      'plan_revisions',
      row.id,
      'proposal'
    ),
    supersedesId: row.supersedes_id ?? undefined,
    rejectedReason: row.rejected_reason ?? undefined,
    milestones: readJson(
      PlanRevisionSchema.shape.milestones,
      row.milestones,
      'plan_revisions',
      row.id,
      'milestones'
    ),
    risks: readJson(PlanRevisionSchema.shape.risks, row.risks, 'plan_revisions', row.id, 'risks'),
    provenance: readJson(
      PlanRevisionSchema.shape.provenance,
      row.provenance,
      'plan_revisions',
      row.id,
      'provenance'
    )
  })
)

export const TaskStageRowSchema = z.object({
  task_id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  plan_revision_id: AxiomIdSchema,
  stage: TaskStageSchema,
  previous_stage: TaskStageSchema.nullable(),
  spec: z.string(),
  retry_policy: z.string(),
  attempt_count: TaskStageRecordSchema.shape.attemptCount,
  ...timestamps
})
export const TaskStageRowCodec = TaskStageRowSchema.transform((row) =>
  TaskStageRecordSchema.parse({
    taskId: row.task_id,
    missionId: row.mission_id,
    planRevisionId: row.plan_revision_id,
    stage: row.stage,
    previousStage: row.previous_stage,
    attemptCount: row.attempt_count,
    spec: readJson(TaskStageRecordSchema.shape.spec, row.spec, 'task_stages', row.task_id, 'spec'),
    retryPolicy: readJson(
      TaskStageRecordSchema.shape.retryPolicy,
      row.retry_policy,
      'task_stages',
      row.task_id,
      'retry_policy'
    ),
    updatedAt: row.updated_at
  })
)

export const EdgeRowSchema = z.object({
  mission_id: AxiomIdSchema,
  from_task_id: AxiomIdSchema,
  to_task_id: AxiomIdSchema,
  readiness_threshold: TaskEdgeSchema.shape.readinessThreshold,
  plan_revision_id: AxiomIdSchema,
  ...timestamps
})
export const EdgeRowCodec = EdgeRowSchema.transform((row) =>
  TaskEdgeSchema.parse({
    fromTaskId: row.from_task_id,
    toTaskId: row.to_task_id,
    readinessThreshold: row.readiness_threshold
  })
)

export const PolicyRowSchema = z.object({
  mission_id: AxiomIdSchema,
  concurrency_limit: PolicySchema.shape.concurrencyLimit,
  budget: z.string(),
  routing: z.string(),
  readiness_threshold: PolicySchema.shape.readinessThreshold,
  approval_rules: z.string(),
  verification_rules: z.string(),
  nested_worker_max_depth: PolicySchema.shape.nestedWorkerMaxDepth,
  unverifiable_tolerance_minutes: PolicySchema.shape.unverifiableToleranceMinutes,
  ...timestamps
})
export const PolicyRowCodec = PolicyRowSchema.transform((row) =>
  PolicySchema.parse({
    routing: readJson(
      PolicySchema.shape.routing,
      row.routing,
      'mission_policies',
      row.mission_id,
      'routing'
    ),
    concurrencyLimit: row.concurrency_limit,
    readinessThreshold: row.readiness_threshold,
    nestedWorkerMaxDepth: row.nested_worker_max_depth,
    unverifiableToleranceMinutes: row.unverifiable_tolerance_minutes,
    budget: readJson(
      PolicySchema.shape.budget,
      row.budget,
      'mission_policies',
      row.mission_id,
      'budget'
    ),
    approvalRules: readJson(
      PolicySchema.shape.approvalRules,
      row.approval_rules,
      'mission_policies',
      row.mission_id,
      'approval_rules'
    ),
    verificationRules: readJson(
      PolicySchema.shape.verificationRules,
      row.verification_rules,
      'mission_policies',
      row.mission_id,
      'verification_rules'
    )
  })
)

// Enumerate the validated row keys, never a wildcard; schema tests pin these to migrated DDL.
export const AXIOM_COLUMNS = {
  agent_specs: Object.keys(AgentSpecRowSchema.shape).join(', '),
  missions: Object.keys(MissionRowSchema.shape).join(', '),
  goal_revisions: Object.keys(GoalRowSchema.shape).join(', '),
  plan_revisions: Object.keys(PlanRowSchema.shape).join(', '),
  task_stages: Object.keys(TaskStageRowSchema.shape).join(', '),
  mission_task_edges: Object.keys(EdgeRowSchema.shape).join(', '),
  mission_policies: Object.keys(PolicyRowSchema.shape).join(', '),
  audit_events: Object.keys(AuditRowSchema.shape).join(', '),
  artifacts: Object.keys(ArtifactRowSchema.shape).join(', '),
  context_packages: Object.keys(ContextPackageRowSchema.shape).join(', '),
  decisions: Object.keys(DecisionRowSchema.shape).join(', ')
}
