import { z } from 'zod'
import {
  ArtifactListParams,
  ArtifactMetaSchema
} from '../../../shared/axiom-contract/artifact-params'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  AXIOM_COLUMNS,
  ArtifactRowCodec,
  ContextPackageRowCodec,
  DecisionRowCodec
} from './axiom-rows'
import { ContextPackageRecordSchema, DecisionStatusSchema } from './artifact-rows'
import { readRow, readRows } from './row-codec'
import { policyAuditStore } from './policy-audit-store'

const InsertArtifact = ArtifactMetaSchema.omit({ createdAt: true })
const InsertContext = ContextPackageRecordSchema.omit({ createdAt: true })
const ListDecisions = z.object({
  missionId: AxiomIdSchema,
  status: DecisionStatusSchema.optional()
})

export function artifactsStore(db: OrchestrationDb) {
  return {
    insertArtifact(input: z.input<typeof InsertArtifact>) {
      const p = InsertArtifact.parse(input)
      db.db
        .prepare(`INSERT INTO artifacts
        (id, mission_id, kind, sha256, size_bytes, media_type, related, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(
          p.id,
          p.missionId,
          p.kind,
          p.sha256,
          p.sizeBytes,
          p.mediaType,
          JSON.stringify(p.related),
          p.createdBy
        )
      return ArtifactRowCodec.parse(
        db.db.prepare(`SELECT ${AXIOM_COLUMNS.artifacts} FROM artifacts WHERE id = ?`).get(p.id)
      )
    },
    getArtifact(id: string) {
      return readRow(
        ArtifactRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.artifacts} FROM artifacts WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    listArtifacts(input: z.input<typeof ArtifactListParams>) {
      const p = ArtifactListParams.parse(input)
      return readRows(
        ArtifactRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.artifacts} FROM artifacts
        WHERE mission_id = ? AND (? IS NULL OR kind = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(artifacts.related) WHERE value = ?))
        ORDER BY created_at, id`)
          .all(
            p.missionId,
            p.kind ?? null,
            p.kind ?? null,
            p.relatedTo ?? null,
            p.relatedTo ?? null
          )
      )
    },
    insertContextPackage(input: z.input<typeof InsertContext>) {
      const p = InsertContext.parse(input)
      db.db
        .prepare(`INSERT INTO context_packages
        (id, mission_id, task_id, plan_revision_id, manifest, token_budget, mandatory_refs, ranked_refs)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .run(
          p.id,
          p.missionId,
          p.taskId,
          p.planRevisionId,
          JSON.stringify(p.manifest),
          p.tokenBudget,
          JSON.stringify(p.mandatoryRefs),
          JSON.stringify(p.rankedRefs)
        )
      return ContextPackageRowCodec.parse(
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.context_packages} FROM context_packages WHERE id = ?`)
          .get(p.id)
      )
    },
    getContextPackage(id: string) {
      return readRow(
        ContextPackageRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.context_packages} FROM context_packages WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    listDecisions(input: z.input<typeof ListDecisions>) {
      const p = ListDecisions.parse(input)
      return readRows(
        DecisionRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.decisions} FROM decisions
        WHERE mission_id = ? AND (? IS NULL OR status = ?) ORDER BY created_at, id`)
          .all(p.missionId, p.status ?? null, p.status ?? null)
      )
    },
    getContextTokenBudget(missionId: string) {
      return policyAuditStore(db).getPolicy(missionId)?.budget.contextTokens
    }
  }
}
