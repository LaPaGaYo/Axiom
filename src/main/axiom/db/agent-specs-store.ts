import { AgentSpecSchema, canonicalAgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { sha256 } from '../artifacts/artifact-store'
import { AgentSpecRowCodec } from './agent-spec-rows'
import { AXIOM_COLUMNS } from './axiom-rows'
import { readRow, readRows } from './row-codec'

export function agentSpecsStore(db: OrchestrationDb) {
  return {
    insertAgentSpec(input: unknown) {
      const spec = AgentSpecSchema.parse(input)
      const canonical = canonicalAgentSpec(spec)
      const id = `spec_${sha256(canonical)}`
      const result = db.db
        .prepare(`INSERT OR IGNORE INTO agent_specs
        (id, mission_id, role, provider, model, reasoning, permissions, budget, workspace_strategy, spec)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          spec.missionId,
          spec.role,
          spec.provider,
          spec.model,
          JSON.stringify(spec.reasoning),
          JSON.stringify(spec.permissions),
          JSON.stringify(spec.budget),
          spec.workspace.strategy,
          canonical
        )
      return { id, inserted: result.changes === 1 }
    },
    getAgentSpec(id: string) {
      return readRow(
        AgentSpecRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.agent_specs} FROM agent_specs WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    listAgentSpecs(missionId: string) {
      return readRows(
        AgentSpecRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.agent_specs} FROM agent_specs WHERE mission_id = ? ORDER BY created_at, id`
          )
          .all(AxiomIdSchema.parse(missionId))
      )
    }
  }
}
