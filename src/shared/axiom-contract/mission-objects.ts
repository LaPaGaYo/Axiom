import { z } from 'zod'
import { isTuiAgent } from '../tui-agent-config'
import { requiredString } from '../rpc-contract/rpc-param-primitives'
import {
  GoalRevisionStatusSchema,
  MissionStatusSchema,
  PlanRevisionStatusSchema,
  ReadinessThresholdSchema,
  RiskLevelSchema,
  TaskStageSchema
} from './lifecycle'

export const AxiomIdSchema = z.string().min(1).max(128)
const Text = requiredString('Expected non-empty text')

export const ProvenanceSchema = z.object({
  kind: z.enum(['user', 'planner', 'control_plane']),
  actor: Text,
  model: Text.optional(),
  at: z.iso.datetime({ offset: true })
})

export const MissionSchema = z.object({
  id: AxiomIdSchema,
  runId: AxiomIdSchema,
  repoId: AxiomIdSchema,
  repoPath: Text,
  targetBranch: Text,
  status: MissionStatusSchema,
  activeGoalRevisionId: AxiomIdSchema.nullable(),
  activePlanRevisionId: AxiomIdSchema.nullable(),
  coordinatorOrcaSessionId: AxiomIdSchema
})

export const GoalBodySchema = z.object({
  objective: Text,
  constraints: z.array(Text),
  acceptanceCriteria: z.array(Text),
  provenance: ProvenanceSchema
})

export const GoalRevisionSchema = GoalBodySchema.extend({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  revision: z.number().int().positive(),
  status: GoalRevisionStatusSchema
})

export const MilestoneSchema = z.object({
  id: AxiomIdSchema,
  title: Text,
  exitCriteria: z.array(Text)
})

export const PlanRiskSchema = z.object({
  id: AxiomIdSchema,
  description: Text,
  mitigation: Text.optional()
})

// Limits are data only; admission and approved-budget comparisons belong to the Control Plane.
export const BudgetSchema = z.strictObject({
  maxRuntimeMinutes: z.number().positive().optional(),
  maxWallClockMinutes: z.number().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  maxTokens: z.number().int().nonnegative().optional(),
  maxCostUsd: z.number().nonnegative().optional(),
  contextTokens: z.number().int().positive().optional()
})

export const TaskSpecSchema = z.object({
  id: AxiomIdSchema,
  title: Text,
  objective: Text,
  scope: z.object({ allowedPaths: z.array(Text) }),
  role: Text.optional(),
  acceptanceCriteria: z.array(Text),
  requiredEvidence: z.array(Text),
  risk: RiskLevelSchema,
  retryPolicy: z.object({ maxAttempts: z.number().int().positive() }),
  budget: BudgetSchema.omit({ maxAttempts: true }).optional(),
  milestoneId: AxiomIdSchema.optional(),
  kind: z.enum(['task', 'fix'])
})

export const TaskEdgeSchema = z.object({
  fromTaskId: AxiomIdSchema,
  toTaskId: AxiomIdSchema,
  readinessThreshold: ReadinessThresholdSchema.default('INTEGRATED')
})

export const PlanRevisionSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  revision: z.number().int().positive(),
  status: PlanRevisionStatusSchema,
  goalRevisionId: AxiomIdSchema,
  milestones: z.array(MilestoneSchema),
  risks: z.array(PlanRiskSchema),
  tasks: z.array(TaskSpecSchema),
  edges: z.array(TaskEdgeSchema),
  provenance: ProvenanceSchema,
  supersedesId: AxiomIdSchema.optional(),
  rejectedReason: Text.optional()
})

export const TaskStageRecordSchema = z.object({
  taskId: AxiomIdSchema,
  missionId: AxiomIdSchema,
  planRevisionId: AxiomIdSchema,
  stage: TaskStageSchema,
  previousStage: TaskStageSchema.nullable(),
  spec: TaskSpecSchema,
  retryPolicy: TaskSpecSchema.shape.retryPolicy,
  attemptCount: z.number().int().nonnegative(),
  updatedAt: Text
})

export const AuditEventSchema = z.object({
  sequence: z.number().int().positive(),
  missionId: AxiomIdSchema,
  actor: Text,
  objectKind: Text,
  objectId: AxiomIdSchema,
  event: Text,
  before: z.json(),
  after: z.json(),
  createdAt: Text
})

export const TuiAgentIdSchema = z.string().refine(isTuiAgent, 'unknown provider')
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
export const RoleRoutingSchema = z.strictObject({
  provider: TuiAgentIdSchema.optional(),
  model: z.string().optional(),
  effort: EffortSchema.optional()
})
export type Effort = z.infer<typeof EffortSchema>
export type RoleRouting = z.infer<typeof RoleRoutingSchema>

export const RoutingPolicySchema = z.strictObject({
  preferredProviders: z.array(TuiAgentIdSchema).default([]),
  disallowedProviders: z.array(TuiAgentIdSchema).default([]),
  highRiskTier: z.enum(['A']).default('A'),
  providerConcurrency: z.record(z.string(), z.number().int().positive()).default({}),
  models: z.record(z.string(), z.string()).default({}),
  roles: z
    .strictObject({ planner: RoleRoutingSchema.optional(), worker: RoleRoutingSchema.optional() })
    .default({}),
  crossProvider: z.boolean().default(true),
  requireCertified: z.boolean().default(false)
})
export const DEFAULT_ROUTING_POLICY = RoutingPolicySchema.parse({})

export const PolicySchema = z.object({
  routing: RoutingPolicySchema.default(DEFAULT_ROUTING_POLICY),
  concurrencyLimit: z.number().int().positive(),
  budget: BudgetSchema,
  readinessThreshold: ReadinessThresholdSchema.default('INTEGRATED'),
  // §6 defines these payloads as JSON without a rule language. Preserve them;
  // the policy-owning service must validate supported rule semantics before use.
  approvalRules: z.record(z.string(), z.json()),
  verificationRules: z.record(z.string(), z.json()),
  nestedWorkerMaxDepth: z.literal(1),
  unverifiableToleranceMinutes: z.number().nonnegative().default(30)
})

export type GoalBody = z.infer<typeof GoalBodySchema>
export type Provenance = z.infer<typeof ProvenanceSchema>
export type Mission = z.infer<typeof MissionSchema>
export type GoalRevision = z.infer<typeof GoalRevisionSchema>
export type PlanRevision = z.infer<typeof PlanRevisionSchema>
export type TaskSpec = z.infer<typeof TaskSpecSchema>
export type TaskEdge = z.infer<typeof TaskEdgeSchema>
export type TaskStageRecord = z.infer<typeof TaskStageRecordSchema>
export type AuditEvent = z.infer<typeof AuditEventSchema>
export type Policy = z.infer<typeof PolicySchema>

// Shared M1 defaults; budgets other than maxAttempts are enforced by M2 admission.
export const DEFAULT_MISSION_POLICY: Policy = {
  routing: DEFAULT_ROUTING_POLICY,
  concurrencyLimit: 3,
  budget: {},
  readinessThreshold: 'INTEGRATED',
  approvalRules: {},
  verificationRules: {},
  nestedWorkerMaxDepth: 1,
  unverifiableToleranceMinutes: 30
}
