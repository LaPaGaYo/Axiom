import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { AgentSpecSchema, canonicalAgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { sha256 } from '../artifacts/artifact-store'
import { readJson } from './row-codec'

export const AgentSpecRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  role: z.string(),
  provider: z.string(),
  model: z.string(),
  reasoning: z.string(),
  permissions: z.string(),
  budget: z.string(),
  workspace_strategy: z.string(),
  created_at: z.string(),
  spec: z.string()
})
export const AgentSpecRowCodec = AgentSpecRowSchema.transform((row) => {
  const spec = readJson(AgentSpecSchema, row.spec, 'agent_specs', row.id, 'spec')
  const canonical = canonicalAgentSpec(spec)
  if (
    row.id !== `spec_${sha256(canonical)}` ||
    row.spec !== canonical ||
    row.mission_id !== spec.missionId ||
    row.role !== spec.role ||
    row.provider !== spec.provider ||
    row.model !== spec.model ||
    row.workspace_strategy !== spec.workspace.strategy ||
    row.reasoning !== JSON.stringify(spec.reasoning) ||
    row.permissions !== JSON.stringify(spec.permissions) ||
    row.budget !== JSON.stringify(spec.budget)
  ) {
    throw new Error(`Invalid stored AgentSpec row ${row.id}`)
  }
  return { id: row.id, spec, createdAt: row.created_at }
})
