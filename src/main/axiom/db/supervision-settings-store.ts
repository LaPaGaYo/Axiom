import type { z } from 'zod'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import {
  AppendSupervisionSettingSchema,
  SupervisionSettingScopeSchema,
  SupervisionSettingRowCodec,
  SupervisionSettingRowSchema
} from './supervision-setting-rows'
import { readRow } from './row-codec'

const columns = Object.keys(SupervisionSettingRowSchema.shape).join(', ')

export function supervisionSettingsStore(db: OrchestrationDb) {
  return {
    getSupervisionSetting(input: z.input<typeof SupervisionSettingScopeSchema>) {
      const p = SupervisionSettingScopeSchema.parse(input)
      return readRow(
        SupervisionSettingRowCodec,
        db.db
          .prepare(`SELECT ${columns}
        FROM supervision_settings WHERE rule = ? AND mission_id = ?
        ORDER BY revision DESC LIMIT 1`)
          .get(p.rule, p.missionId ?? '')
      )
    },
    appendSupervisionSetting(input: z.input<typeof AppendSupervisionSettingSchema>) {
      const p = AppendSupervisionSettingSchema.parse(input)
      return runLifecycleWriteTransaction(db.db, 'axiom_supervision_setting', () =>
        SupervisionSettingRowCodec.parse(
          db.db
            .prepare(`INSERT INTO supervision_settings
          (rule, mission_id, revision, mode, actor, provenance, audit_sequence)
          VALUES (?, ?, (SELECT COALESCE(MAX(revision), 0) + 1 FROM supervision_settings
            WHERE rule = ? AND mission_id = ?), ?, ?, ?,
            (SELECT COALESCE(MAX(sequence), 0) FROM audit_events))
          RETURNING ${columns}`)
            .get(
              p.rule,
              p.missionId ?? '',
              p.rule,
              p.missionId ?? '',
              p.mode,
              p.actor,
              JSON.stringify(p.provenance)
            )
        )
      )
    }
  }
}
