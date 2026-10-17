import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'

export const AttemptBindingSchema = z.object({
  taskId: AxiomIdSchema,
  missionId: AxiomIdSchema,
  seq: z.number().int().positive(),
  branch: z.string().min(1),
  dispatchId: AxiomIdSchema.nullable(),
  agentSpecId: AxiomIdSchema,
  contextPackageId: AxiomIdSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})

export const AttemptBindingRowCodec = z
  .object({
    task_id: AxiomIdSchema,
    mission_id: AxiomIdSchema,
    seq: AttemptBindingSchema.shape.seq,
    branch: AttemptBindingSchema.shape.branch,
    dispatch_id: AxiomIdSchema.nullable(),
    agent_spec_id: AxiomIdSchema,
    context_package_id: AxiomIdSchema,
    created_at: z.string().min(1),
    updated_at: z.string().min(1)
  })
  .transform((row) =>
    AttemptBindingSchema.parse({
      taskId: row.task_id,
      missionId: row.mission_id,
      seq: row.seq,
      branch: row.branch,
      dispatchId: row.dispatch_id,
      agentSpecId: row.agent_spec_id,
      contextPackageId: row.context_package_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  )
