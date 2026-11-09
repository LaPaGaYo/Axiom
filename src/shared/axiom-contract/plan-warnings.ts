import { z } from 'zod'

const TaskId = z.string().min(1).max(128)
const Index = z.number().int().nonnegative()
const Message = z.string().min(1)

export const PlanWarningSchema = z.discriminatedUnion('code', [
  z.strictObject({
    code: z.literal('incomplete_coverage'),
    message: Message,
    taskIds: z.tuple([]),
    uncovered: z.array(z.strictObject({ index: Index, text: z.string().min(1) }))
  }),
  z.strictObject({
    code: z.literal('scope_overlap'),
    message: Message,
    taskIds: z.tuple([TaskId, TaskId]),
    paths: z.array(z.strictObject({ a: z.string().min(1), b: z.string().min(1) }))
  }),
  z.strictObject({
    code: z.literal('insufficient_parallel_roots'),
    message: Message,
    taskIds: z.array(TaskId),
    expected: Index,
    found: Index
  })
])
export type PlanWarning = z.infer<typeof PlanWarningSchema>
