import { z } from 'zod'
import { VerificationAcceptanceSchema } from './verification-acceptance'
import { VerificationResolutionSchema, VerificationRerunDetailSchema } from './verification-params'

// Persisted records predate individual fields. Validate each entry independently.
function entries<S extends z.ZodType>(schema: S) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = schema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
    )
}
const text = z.string()
const count = z.number().int().nonnegative()
const optionalText = text.optional().catch(undefined)
const strings = entries(text)
const indexes = entries(count)
const outcome = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE'])

const CheckSchema = z.object({
  index: count,
  source: z.enum(['setup', 'evidence', 'gate']).optional().catch(undefined),
  command: text,
  result: z.enum(['pass', 'fail', 'inconclusive', 'environmental', 'skipped']),
  criteria: indexes,
  reason: optionalText,
  exitCode: z.number().int().nullable().optional().catch(undefined),
  durationMs: z.number().nonnegative().optional().catch(undefined),
  failures: strings,
  excerpt: optionalText
})
const pathPattern = z.object({ path: text, pattern: text })
const findingCounts = z.object({
  scopeViolations: count.optional().catch(undefined),
  dangerous: count.optional().catch(undefined),
  secrets: count.optional().catch(undefined),
  tampering: count.optional().catch(undefined),
  generated: count.optional().catch(undefined),
  binary: count.optional().catch(undefined),
  ignoredScopeEntries: count.optional().catch(undefined)
})
const DiffSchema = z.object({
  error: optionalText,
  changedPaths: count.optional().catch(undefined),
  scopeViolations: strings,
  dangerous: entries(pathPattern),
  secrets: entries(pathPattern),
  tampering: entries(z.object({ path: text, rule: text, count })),
  generated: strings,
  binary: strings,
  ignoredScopeEntries: strings,
  patchComplete: z.boolean().optional().catch(undefined),
  counts: findingCounts.optional().catch(undefined)
})
// Reuse the acceptance contract while dropping future keys, including inside check.
const AcceptanceSchema = VerificationAcceptanceSchema.strip().extend({
  check: z.discriminatedUnion('kind', [
    VerificationAcceptanceSchema.shape.check.options[0].strip(),
    VerificationAcceptanceSchema.shape.check.options[1].strip(),
    VerificationAcceptanceSchema.shape.check.options[2].strip()
  ])
})
export const VerdictRecordSchema = z
  .object({
    phase: optionalText,
    verdict: outcome.optional().catch(undefined),
    reason: optionalText,
    checks: entries(CheckSchema),
    acceptance: entries(AcceptanceSchema),
    diff: DiffSchema.optional().catch(undefined),
    resolution: VerificationResolutionSchema.strip().optional().catch(undefined),
    rerun: VerificationRerunDetailSchema.strip().optional().catch(undefined),
    verdictArtifactId: optionalText,
    evidenceArtifactIds: strings
  })
  .catch({ checks: [], acceptance: [], evidenceArtifactIds: [] })

export type VerdictRecord = z.infer<typeof VerdictRecordSchema>
export type VerdictCheck = VerdictRecord['checks'][number]
export type VerdictDiff = NonNullable<VerdictRecord['diff']>

/** A read-only, tolerant view of a row summary or a parsed evidence Artifact. */
export function readVerdictRecord(input: unknown): VerdictRecord {
  try {
    return VerdictRecordSchema.parse(input)
  } catch {
    return { checks: [], acceptance: [], evidenceArtifactIds: [] }
  }
}
