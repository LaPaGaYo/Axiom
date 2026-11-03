import { z } from 'zod'
import { resolveAcceptance } from './acceptance'
import { TaskSpecSchema } from './mission-objects'

// Preserve every other field for the strict message parser to validate afterward.
const PersistedSubtaskMessageSchema = z.looseObject({
  axiom: z.looseObject({
    type: z.literal('REQUEST_SUBTASK'),
    subtask: z.looseObject({
      acceptanceCriteria: TaskSpecSchema.shape.acceptanceCriteria.min(1),
      requiredEvidence: TaskSpecSchema.shape.requiredEvidence
    })
  })
})

export function resolvePersistedMessageAcceptance(payload: unknown): unknown {
  const parsed = PersistedSubtaskMessageSchema.safeParse(payload)
  if (!parsed.success) {
    return payload
  }
  const { requiredEvidence: _legacy, ...subtask } = parsed.data.axiom.subtask
  return {
    ...parsed.data,
    axiom: {
      ...parsed.data.axiom,
      subtask: {
        ...subtask,
        acceptanceCriteria: resolveAcceptance(parsed.data.axiom.subtask)
      }
    }
  }
}
