import { z } from 'zod'

export const FailureClassSchema = z.enum([
  'usage_limit',
  'provider_error',
  'transport_error',
  'permission_error',
  'validation_error',
  'unknown'
])

export const AttemptFailureSchema = z
  .strictObject({
    class: FailureClassSchema,
    retryable: z.boolean(),
    source: z.enum(['structured', 'text', 'absent']),
    resetsAt: z.iso.datetime({ offset: true }).optional(),
    window: z.enum(['session', 'weekly', 'weeklyModel', 'credits']).optional()
  })
  .refine((failure) => failure.resetsAt === undefined || failure.class === 'usage_limit', {
    message: 'Only a usage limit can carry a reset time',
    path: ['resetsAt']
  })

export type AttemptFailure = z.infer<typeof AttemptFailureSchema>
