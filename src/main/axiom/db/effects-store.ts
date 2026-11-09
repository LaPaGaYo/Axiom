import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import {
  EffectKindSchema,
  EffectStatusSchema,
  EffectTimestampSchema,
  EnqueueEffectSchema,
  type EffectKind
} from '../../../shared/axiom-contract/effects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { EffectRowCodec, EffectRowSchema } from './effect-rows'
import { readRow, readRows } from './row-codec'

const columns = Object.keys(EffectRowSchema.shape).join(', ')
const Fence = z.strictObject({
  id: AxiomIdSchema,
  expectedStatus: EffectStatusSchema,
  expectedLeaseEpoch: z.string().min(1).nullable()
})
const Lease = z.strictObject({
  kind: EffectKindSchema,
  missionId: AxiomIdSchema,
  now: EffectTimestampSchema,
  epoch: z.string().min(1)
})
const Defer = Fence.extend({ dueAt: EffectTimestampSchema })
const Fail = Fence.extend({ lastError: z.string(), nextDueAt: EffectTimestampSchema.nullable() })
const Retire = Fence.extend({ reason: z.string().min(1) })
const List = z.strictObject({
  missionId: AxiomIdSchema.optional(),
  status: EffectStatusSchema.optional()
})

export function effectsStore(db: OrchestrationDb) {
  function transition(
    input: z.input<typeof Fence>,
    assignments: string,
    values: (string | null)[]
  ) {
    const p = Fence.parse(input)
    return readRow(
      EffectRowCodec,
      db.db
        .prepare(`UPDATE axiom_effects
      SET ${assignments}, lease_epoch = NULL, updated_at = ?
      WHERE id = ? AND status = ? AND lease_epoch IS ? RETURNING ${columns}`)
        .get(...values, new Date().toISOString(), p.id, p.expectedStatus, p.expectedLeaseEpoch)
    )
  }
  return {
    enqueueEffect(input: z.input<typeof EnqueueEffectSchema>) {
      if (!db.db.isTransaction) {
        throw new Error('Effect enqueue requires a caller transaction')
      }
      const p = EnqueueEffectSchema.parse(input)
      const now = new Date().toISOString()
      db.db
        .prepare(`INSERT INTO axiom_effects
        (id, mission_id, kind, effect_key, payload, status, due_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        ON CONFLICT(kind, effect_key) DO UPDATE SET payload = excluded.payload,
        attempts = 0, status = 'pending', due_at = excluded.due_at, lease_epoch = NULL,
        last_error = NULL, updated_at = excluded.updated_at
        WHERE axiom_effects.status IN ('pending', 'failed', 'retired', 'done')`)
        .run(
          randomUUID(),
          p.missionId,
          p.kind,
          p.key,
          JSON.stringify(p.payload),
          new Date(p.dueAt ?? now).toISOString(),
          now,
          now
        )
      return EffectRowCodec.parse(
        db.db
          .prepare(`SELECT ${columns} FROM axiom_effects WHERE kind = ? AND effect_key = ?`)
          .get(p.kind, p.key)
      )
    },
    leaseDueEffect(input: z.input<typeof Lease>) {
      const p = Lease.parse(input)
      const now = new Date(p.now).toISOString()
      return readRow(
        EffectRowCodec,
        db.db
          .prepare(`UPDATE axiom_effects
        SET status = 'running', lease_epoch = ?, updated_at = ?
        WHERE id = (SELECT id FROM axiom_effects WHERE kind = ? AND mission_id = ?
          AND status = 'pending' AND due_at <= ? ORDER BY due_at, rowid LIMIT 1)
        AND status = 'pending' AND NOT EXISTS
          (SELECT 1 FROM axiom_effects WHERE kind = ? AND mission_id = ? AND status = 'running')
        RETURNING ${columns}`)
          .get(p.epoch, now, p.kind, p.missionId, now, p.kind, p.missionId)
      )
    },
    completeEffect(input: z.input<typeof Fence>) {
      return transition(input, "status = 'done'", [])
    },
    deferEffect(input: z.input<typeof Defer>) {
      const { dueAt, ...fence } = Defer.parse(input)
      return transition(fence, "status = 'pending', due_at = ?", [new Date(dueAt).toISOString()])
    },
    failEffectAttempt(input: z.input<typeof Fail>) {
      const { lastError, nextDueAt, ...fence } = Fail.parse(input)
      return transition(
        fence,
        'status = ?, attempts = attempts + 1, last_error = ?, due_at = COALESCE(?, due_at)',
        [
          nextDueAt === null ? 'failed' : 'pending',
          lastError,
          nextDueAt === null ? null : new Date(nextDueAt).toISOString()
        ]
      )
    },
    retireEffect(input: z.input<typeof Retire>) {
      const { reason, ...fence } = Retire.parse(input)
      return transition(fence, "status = 'retired', last_error = ?", [reason])
    },
    getEffect(kind: EffectKind, key: string) {
      return readRow(
        EffectRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM axiom_effects WHERE kind = ? AND effect_key = ?`)
          .get(EffectKindSchema.parse(kind), z.string().min(1).parse(key))
      )
    },
    listEffects(input: z.input<typeof List>) {
      const p = List.parse(input)
      return readRows(
        EffectRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM axiom_effects
        WHERE (? IS NULL OR mission_id = ?) AND (? IS NULL OR status = ?) ORDER BY created_at, rowid`)
          .all(p.missionId ?? null, p.missionId ?? null, p.status ?? null, p.status ?? null)
      )
    },
    listOrphanedEffects(epoch: string) {
      return readRows(
        EffectRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM axiom_effects
        WHERE status = 'running' AND lease_epoch IS NOT ? ORDER BY created_at, rowid`)
          .all(z.string().min(1).parse(epoch))
      )
    }
  }
}
