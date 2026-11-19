import { z } from 'zod'
import { Sha256Schema } from './artifact-params'
import {
  AxiomIdSchema,
  EffortSchema,
  GoalRevisionSchema,
  PlanRevisionSchema,
  TaskSpecSchema,
  TuiAgentIdSchema
} from './mission-objects'
import { TaskStageSchema, VerificationRunStatusSchema } from './lifecycle'
import { FinalizationGateSchema, FINALIZATION_GATE_IDS } from './mission-finalization'
import { GitObjectIdSchema } from './submission-params'

export const COMPLETION_REPORT_VERSION = 1
export const COMPLETION_REPORT_MEDIA_TYPE = 'application/json'
const id = AxiomIdSchema
const strings = z.array(z.string())
const AttemptSchema = z.strictObject({
  seq: z.number().int().positive(),
  branch: z.string(),
  agentSpecId: id,
  contextPackageId: id,
  provider: TuiAgentIdSchema,
  model: z.string(),
  effort: EffortSchema,
  channel: z.enum(['headless', 'tui']).optional(),
  posture: z.enum(['headless-sandboxed', 'tui-bypass']).optional(),
  candidateId: id.optional()
})
const VerificationSchema = z.strictObject({
  runId: id,
  status: VerificationRunStatusSchema,
  verifier: z.string(),
  toolVersions: z.record(z.string(), z.string()),
  checks: z.array(
    z.strictObject({
      command: z.string(),
      result: z.enum(['pass', 'fail', 'inconclusive', 'environmental', 'skipped']),
      criteria: z.array(z.number().int().nonnegative())
    })
  ),
  resolution: z
    .strictObject({
      verdict: z.enum(['PASS', 'FAIL']),
      rationale: z.string(),
      at: z.string()
    })
    .optional(),
  artifacts: z.array(z.strictObject({ id, sha256: Sha256Schema }))
})
const task = {
  taskId: id,
  planTaskId: id,
  planRevisionId: id,
  title: z.string(),
  kind: TaskSpecSchema.shape.kind,
  stage: TaskStageSchema,
  cancelRationale: z.string().optional(),
  attempts: z.array(AttemptSchema)
}
const history = {
  runs: z.array(
    z.strictObject({
      id,
      candidateId: id,
      status: VerificationRunStatusSchema,
      batchId: id.optional()
    })
  ),
  openQuestions: z.array(
    z.strictObject({
      source: z.enum(['message', 'gate']),
      id,
      text: z.string()
    })
  )
}
const ReportTaskSchema = z.discriminatedUnion('stage', [
  z.strictObject({
    ...task,
    stage: z.literal('INTEGRATED'),
    candidate: z.strictObject({ id, commitSha: GitObjectIdSchema, treeSha: GitObjectIdSchema }),
    summary: z.string(),
    limitations: strings,
    risks: strings,
    followUps: strings,
    verification: VerificationSchema,
    integration: z.strictObject({
      batchId: id,
      baseCommit: GitObjectIdSchema,
      mergeCommit: GitObjectIdSchema,
      regressionRunId: id,
      regressionStatus: VerificationRunStatusSchema
    }),
    ...history
  }),
  z.strictObject({ ...task, stage: TaskStageSchema.exclude(['INTEGRATED']), ...history })
])

export const CompletionReportSchema = z.strictObject({
  version: z.literal(COMPLETION_REPORT_VERSION),
  mission: z.strictObject({ id, repoId: id, targetBranch: z.string() }),
  goal: z.strictObject({
    id,
    revision: GoalRevisionSchema.shape.revision,
    objective: z.string(),
    constraints: strings,
    criteria: z.array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        text: z.string(),
        coveredBy: z.array(id)
      })
    ),
    revisions: z.array(
      z.strictObject({
        id,
        revision: GoalRevisionSchema.shape.revision,
        status: GoalRevisionSchema.shape.status
      })
    )
  }),
  plans: z.array(
    z.strictObject({
      id,
      revision: PlanRevisionSchema.shape.revision,
      status: PlanRevisionSchema.shape.status,
      goalRevisionId: id,
      supersedesId: id.optional(),
      provenance: z.strictObject({
        kind: PlanRevisionSchema.shape.provenance.shape.kind,
        actor: z.string(),
        model: z.string().optional()
      }),
      taskIds: z.array(id),
      risks: z.array(
        z.strictObject({ id, description: z.string(), mitigation: z.string().optional() })
      )
    })
  ),
  tasks: z.array(ReportTaskSchema),
  decisions: z.array(id),
  gate: FinalizationGateSchema.refine((gate) => gate.length === FINALIZATION_GATE_IDS.length),
  commits: z.strictObject({
    integrationHead: GitObjectIdSchema,
    targetHead: GitObjectIdSchema,
    promoted: z.array(GitObjectIdSchema)
  }),
  risks: z.array(
    z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('bypass_posture'),
        taskId: id,
        seq: z.number().int().positive()
      }),
      z.strictObject({ kind: z.literal('human_resolved_verification'), taskId: id, runId: id })
    ])
  )
})
export type CompletionReport = z.infer<typeof CompletionReportSchema>

export function completionReportText(report: unknown): string {
  return `${JSON.stringify(CompletionReportSchema.parse(report), null, 2)}\n`
}
