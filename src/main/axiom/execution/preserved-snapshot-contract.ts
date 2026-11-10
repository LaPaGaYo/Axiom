import { z } from 'zod'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { PRESERVED_PATH_LIMIT } from './preservation-policy'

export const PreservedSnapshotSchema = z.object({
  ref: z.string().startsWith('refs/axiom/preserved/'),
  commitSha: GitObjectIdSchema,
  treeSha: GitObjectIdSchema
})
export const PreservedChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'deleted', 'renamed', 'copied', 'modified']),
  oldPath: z.string().optional(),
  added: z.number().int().nonnegative().optional(),
  removed: z.number().int().nonnegative().optional()
})
export const PreservationResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('preserved'),
    snapshot: PreservedSnapshotSchema,
    scopePaths: z.array(z.string()).max(PRESERVED_PATH_LIMIT),
    secrets: z.array(z.object({ path: z.string(), pattern: z.string() }))
  }),
  z.object({ status: z.literal('empty') }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'worktree_missing',
      'branch_mismatch',
      'ref_conflict',
      'git_failure',
      'git_timeout',
      'diff_unavailable',
      'diff_incomplete',
      'too_many_paths'
    ]),
    snapshot: PreservedSnapshotSchema.omit({ treeSha: true }).optional()
  })
])
export type PreservationResult = z.infer<typeof PreservationResultSchema>
export type PreservedSnapshot = z.infer<typeof PreservedSnapshotSchema>
export type PreservedChange = z.infer<typeof PreservedChangeSchema>
export type WorktreePreservation =
  | (Extract<PreservationResult, { status: 'preserved' }> & { changes: PreservedChange[] })
  | Exclude<PreservationResult, { status: 'preserved' }>
export const AttemptPreservedAuditSchema = z.object({
  taskId: z.string(),
  result: PreservationResultSchema,
  baselineSha: GitObjectIdSchema,
  artifactId: z.string().optional()
})
