import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { AttemptStateSchema, type AttemptState } from './lifecycle'

export const AttemptShowParams = z.object({ attemptId: AxiomIdSchema })
export const AttemptListParams = z.object({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema.optional()
})
export const AttemptSummarySchema = z.object({
  attemptId: AxiomIdSchema.nullable(),
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  branch: z.string().min(1),
  agentSpecId: AxiomIdSchema,
  contextPackageId: AxiomIdSchema,
  provider: z.string().nullable(),
  state: AttemptStateSchema,
  liveness: z.enum(['live', 'unverifiable', 'exited']).nullable(),
  livenessReason: z.string().nullable().optional(),
  workspace: z.enum(['retained', 'released', 'pending']).nullable(),
  worktreeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AttemptSummary = z.infer<typeof AttemptSummarySchema>
export const AttemptResponseSchema = z.object({ attempt: AttemptSummarySchema })
export const AttemptListResponseSchema = z.object({ attempts: z.array(AttemptSummarySchema) })
const workerStates: Readonly<Record<string, AttemptState>> = {
  starting: 'STARTING',
  ready: 'RUNNING',
  stopping: 'RUNNING',
  succeeded: 'SUBMITTED',
  failed: 'FAILED',
  stopped: 'STOPPED',
  abandoned: 'ABANDONED',
  start_unknown: 'START_UNKNOWN',
  stop_unknown: 'STOP_UNKNOWN'
}
export function projectAttemptState(stage: { worker: string; dispatch: string }): AttemptState {
  return stage.dispatch === 'circuit_broken'
    ? 'FAILED'
    : (workerStates[stage.worker] ?? 'START_UNKNOWN')
}
