import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { Sha256Schema } from './artifact-params'

export const ContextManifestSchema = z.object({
  version: z.literal(1),
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  planRevisionId: AxiomIdSchema,
  tokenBudget: z.number().int().nonnegative(),
  mandatory: z.array(
    z.object({
      section: z.string().min(1),
      source: z.string().min(1),
      sha256: Sha256Schema,
      tokens: z.number().int().nonnegative()
    })
  ),
  ranked: z.array(
    z.object({
      section: z.string().min(1),
      artifactId: AxiomIdSchema,
      sha256: Sha256Schema,
      tokens: z.number().int().nonnegative()
    })
  ),
  omitted: z.array(z.object({ artifactId: AxiomIdSchema, reason: z.enum(['budget', 'redacted']) })),
  budgetExceededByMandatory: z.literal(true).optional()
})
export type ContextManifest = z.infer<typeof ContextManifestSchema>

export function canonicalContextManifest(manifest: ContextManifest): string {
  // Parsing reconstructs every object in schema key order, including nested entries.
  return JSON.stringify(ContextManifestSchema.parse(manifest))
}
