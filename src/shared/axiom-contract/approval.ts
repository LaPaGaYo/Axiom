import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

export const APPROVAL_STATUSES = [
  'PENDING',
  'GRANTED',
  'DENIED',
  'EXPIRED',
  'REVOKED',
  'CONSUMED'
] as const
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES)
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const APPROVAL_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  PENDING: ['GRANTED', 'DENIED', 'EXPIRED', 'REVOKED'],
  GRANTED: ['CONSUMED'],
  DENIED: [],
  EXPIRED: [],
  REVOKED: [],
  CONSUMED: []
}

export function isLegalApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to)
}

export const APPROVAL_ACTION_KINDS = ['delivery', 'budget_increase'] as const
export const ApprovalActionKindSchema = z.enum(APPROVAL_ACTION_KINDS)

export const ApprovalSchema = z.strictObject({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  actionKind: ApprovalActionKindSchema,
  inputsHash: z.string().min(1),
  risk: z.string().min(1),
  status: ApprovalStatusSchema,
  expiresAt: z.string().min(1),
  requestedBy: z.string().min(1),
  resolver: z.string().nullable(),
  resolution: z.string().nullable(),
  outcome: z.string().min(1).optional(),
  executedAt: z.iso.datetime().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})
export type Approval = z.infer<typeof ApprovalSchema>
