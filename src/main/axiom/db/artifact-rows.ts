import { z } from 'zod'
import { ArtifactMetaSchema } from '../../../shared/axiom-contract/artifact-params'
import { ContextManifestSchema } from '../../../shared/axiom-contract/context-package'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { readJson } from './row-codec'

export const ArtifactRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  kind: ArtifactMetaSchema.shape.kind,
  sha256: ArtifactMetaSchema.shape.sha256,
  size_bytes: ArtifactMetaSchema.shape.sizeBytes,
  media_type: z.string(),
  related: z.string(),
  created_by: z.string(),
  created_at: z.string()
})
export const ArtifactRowCodec = ArtifactRowSchema.transform((row) =>
  ArtifactMetaSchema.parse({
    id: row.id,
    missionId: row.mission_id,
    kind: row.kind,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    mediaType: row.media_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
    related: readJson(ArtifactMetaSchema.shape.related, row.related, 'artifacts', row.id, 'related')
  })
)

export const ContextPackageRecordSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  planRevisionId: AxiomIdSchema,
  manifest: ContextManifestSchema,
  tokenBudget: ContextManifestSchema.shape.tokenBudget,
  mandatoryRefs: z.array(AxiomIdSchema),
  rankedRefs: z.array(AxiomIdSchema),
  createdAt: z.string().min(1)
})
export const ContextPackageRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  task_id: AxiomIdSchema,
  plan_revision_id: AxiomIdSchema,
  manifest: z.string(),
  token_budget: z.number(),
  mandatory_refs: z.string(),
  ranked_refs: z.string(),
  created_at: z.string()
})
export const ContextPackageRowCodec = ContextPackageRowSchema.transform((row) =>
  ContextPackageRecordSchema.parse({
    id: row.id,
    missionId: row.mission_id,
    taskId: row.task_id,
    planRevisionId: row.plan_revision_id,
    manifest: readJson(ContextManifestSchema, row.manifest, 'context_packages', row.id, 'manifest'),
    tokenBudget: row.token_budget,
    createdAt: row.created_at,
    mandatoryRefs: readJson(
      ContextPackageRecordSchema.shape.mandatoryRefs,
      row.mandatory_refs,
      'context_packages',
      row.id,
      'mandatory_refs'
    ),
    rankedRefs: readJson(
      ContextPackageRecordSchema.shape.rankedRefs,
      row.ranked_refs,
      'context_packages',
      row.id,
      'ranked_refs'
    )
  })
)

export const DecisionStatusSchema = z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'])
export const DecisionRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  status: DecisionStatusSchema,
  title: z.string(),
  options: z.string(),
  resolution: z.string().nullable(),
  authority: z.string(),
  provenance: z.string(),
  supersedes_id: AxiomIdSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string()
})
export const DecisionRowCodec = DecisionRowSchema.transform((row) => ({
  id: row.id,
  missionId: row.mission_id,
  status: row.status,
  title: row.title,
  options: readJson(z.array(z.json()), row.options, 'decisions', row.id, 'options'),
  resolution: row.resolution,
  authority: row.authority,
  provenance: readJson(
    z.record(z.string(), z.json()),
    row.provenance,
    'decisions',
    row.id,
    'provenance'
  ),
  supersedesId: row.supersedes_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
}))
