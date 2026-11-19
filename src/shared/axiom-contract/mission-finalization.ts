import { z } from 'zod'
import { GitObjectIdSchema } from './submission-params'
import { Sha256Schema } from './artifact-params'
import { AxiomIdSchema } from './mission-objects'

export const MISSION_FINALIZATION_EVENT = 'mission.finalization'
export const FINALIZATION_GATE_IDS = [
  'tasks_settled',
  'candidates_verified',
  'batches_promoted',
  'integration_head_recorded',
  'target_branch_contained',
  'no_open_questions',
  'goal_criteria_covered',
  'limitations_recorded'
] as const
export const FinalizationGateItemSchema = z.strictObject({
  id: z.enum(FINALIZATION_GATE_IDS),
  pass: z.boolean(),
  evidence: z.array(z.string().min(1)).max(200),
  detail: z.string().optional()
})
export const FinalizationGateSchema = z
  .array(FinalizationGateItemSchema)
  .min(FINALIZATION_GATE_IDS.length - 1)
  .max(FINALIZATION_GATE_IDS.length)
  .refine((items) => items.every((item, index) => item.id === FINALIZATION_GATE_IDS[index]))
export const FinalizationStopReasonSchema = z.enum([
  'target_branch_moved',
  'target_branch_not_found',
  'integration_head_unexpected',
  'completion_gate_failed',
  'finalization_unavailable'
])
const facts = {
  targetBranch: z.string().min(1),
  targetHead: GitObjectIdSchema.optional(),
  integrationHead: GitObjectIdSchema.optional(),
  gate: FinalizationGateSchema.optional()
}
const ready = z.strictObject({
  ...facts,
  outcome: z.literal('ready'),
  reportArtifactId: AxiomIdSchema.optional(),
  reportSha256: Sha256Schema.optional()
})
const stopped = z.strictObject({
  ...facts,
  outcome: z.literal('stopped'),
  reason: FinalizationStopReasonSchema
})
const reportPair = (value: z.infer<typeof ready> | z.infer<typeof stopped>) =>
  value.outcome !== 'ready' ||
  (value.reportArtifactId === undefined) === (value.reportSha256 === undefined)
export const FinalizationOutcomeSchema = z
  .discriminatedUnion('outcome', [ready, stopped])
  .refine(reportPair, 'Report id and hash must appear together')
const time = { at: z.iso.datetime() }
export const MissionFinalizationSchema = z
  .discriminatedUnion('outcome', [ready.extend(time), stopped.extend(time)])
  .refine(reportPair, 'Report id and hash must appear together')
export type FinalizationGateItem = z.infer<typeof FinalizationGateItemSchema>
export type FinalizationOutcome = z.infer<typeof FinalizationOutcomeSchema>
export type MissionFinalization = z.infer<typeof MissionFinalizationSchema>
