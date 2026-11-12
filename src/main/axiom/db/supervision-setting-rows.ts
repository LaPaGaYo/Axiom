import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { StallModeSchema } from '../../../shared/axiom-contract/supervision'
import { readJson } from './row-codec'

export const SupervisionSettingScopeSchema = z.strictObject({
  rule: z.literal('stalled'),
  missionId: AxiomIdSchema.optional()
})
const Provenance = z.record(z.string(), z.json())
export const AppendSupervisionSettingSchema = SupervisionSettingScopeSchema.extend({
  mode: StallModeSchema.nullable(),
  actor: z.string().min(1),
  provenance: Provenance.default({})
}).refine((value) => value.missionId !== undefined || value.mode !== null, {
  message: 'The global stall mode cannot be cleared'
})

export const SupervisionSettingRowSchema = z.object({
  rule: z.literal('stalled'),
  mission_id: z.union([AxiomIdSchema, z.literal('')]),
  revision: z.number().int().positive(),
  mode: StallModeSchema.nullable(),
  actor: z.string().min(1),
  provenance: z.string(),
  audit_sequence: z.number().int().nonnegative(),
  created_at: z.string().min(1)
})
export const SupervisionSettingRowCodec = SupervisionSettingRowSchema.refine(
  (row) => row.mission_id !== '' || row.mode !== null
).transform((row) => ({
  rule: row.rule,
  missionId: row.mission_id,
  revision: row.revision,
  mode: row.mode,
  actor: row.actor,
  provenance: readJson(
    Provenance,
    row.provenance,
    'supervision_settings',
    row.revision,
    'provenance'
  ),
  auditSequence: row.audit_sequence,
  createdAt: row.created_at
}))
