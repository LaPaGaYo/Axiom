import { expect, it } from 'vitest'
import { EffectRowCodec } from './effect-rows'

it('the effect codec decodes mission.finalize and refuses a payload with keys', () => {
  const row = {
    id: 'effect-finalize',
    mission_id: 'mission-1',
    kind: 'mission.finalize',
    effect_key: 'mission-1',
    payload: '{}',
    status: 'pending',
    due_at: '2026-11-18T12:00:00Z',
    attempts: 0,
    lease_epoch: null,
    last_error: null,
    created_at: '2026-11-18T12:00:00Z',
    updated_at: '2026-11-18T12:00:00Z'
  }
  expect(EffectRowCodec.parse(row)).toMatchObject({ kind: 'mission.finalize', payload: {} })
  expect(() => EffectRowCodec.parse({ ...row, payload: '{"extra":true}' })).toThrow()
})
