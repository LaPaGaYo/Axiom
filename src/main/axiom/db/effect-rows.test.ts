import { expect, it } from 'vitest'
import { EffectRowCodec } from './effect-rows'

const row = {
  id: 'effect',
  mission_id: 'mission',
  kind: 'verification.enqueue',
  effect_key: 'run',
  payload: '{"runId":"run"}',
  status: 'pending',
  due_at: '2026-11-09T00:00:00.000Z',
  attempts: 0,
  lease_epoch: null,
  last_error: null,
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-09T00:00:00.000Z'
}

it('decodes persisted fields and validates the selected payload kind', () => {
  expect(EffectRowCodec.parse(row)).toEqual({
    id: 'effect',
    missionId: 'mission',
    kind: 'verification.enqueue',
    key: 'run',
    payload: { runId: 'run' },
    status: 'pending',
    dueAt: row.due_at,
    attempts: 0,
    leaseEpoch: null,
    lastError: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
  expect(() => EffectRowCodec.parse({ ...row, kind: 'attempt.dispatch' })).toThrow(
    'Invalid stored JSON in axiom_effects row effect column payload'
  )
})

it('reports corrupt JSON without exposing its contents', () => {
  const payload = '{"secret":"hidden"'
  expect(() => EffectRowCodec.parse({ ...row, payload })).toThrow(
    'Invalid stored JSON in axiom_effects row effect column payload'
  )
  try {
    EffectRowCodec.parse({ ...row, payload })
  } catch (error) {
    expect(String(error)).not.toContain('hidden')
  }
})
