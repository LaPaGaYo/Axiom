import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
export const ArtifactKind = z.enum([
  'context_package_manifest',
  'context_package_render',
  'worker_report',
  'handoff',
  'evidence',
  'log',
  'other'
])
export type ArtifactKind = z.infer<typeof ArtifactKind>

export const ArtifactMetaSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  kind: ArtifactKind,
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  related: z.array(AxiomIdSchema),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1)
})
export type ArtifactMeta = z.infer<typeof ArtifactMetaSchema>

// Validate the decoded size without importing Node into the shared web graph.
const ContentBase64 = z
  .string()
  .max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4)
  .refine(
    (value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    'Invalid base64'
  )
  .refine(
    (value) =>
      (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) <=
      MAX_ARTIFACT_BYTES,
    'Artifact exceeds 8 MiB'
  )

export const ArtifactPutParams = ArtifactMetaSchema.pick({
  missionId: true,
  kind: true,
  mediaType: true,
  related: true,
  createdBy: true
}).extend({
  contentBase64: ContentBase64,
  attemptId: AxiomIdSchema.optional(),
  from: z.string().min(1).optional()
})
export const ArtifactReadParams = z.object({ id: AxiomIdSchema })
export const ArtifactListParams = z.object({
  missionId: AxiomIdSchema,
  kind: ArtifactKind.optional(),
  relatedTo: AxiomIdSchema.optional()
})
export const ArtifactPutResponseSchema = z.object({ artifact: ArtifactMetaSchema })
export const ArtifactReadResponseSchema = z.object({
  meta: ArtifactMetaSchema,
  contentBase64: ContentBase64
})
export const ArtifactListResponseSchema = z.object({ artifacts: z.array(ArtifactMetaSchema) })
