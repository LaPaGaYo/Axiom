import { describe, expect, it } from 'vitest'
import {
  EFFECT_KINDS,
  EffectSchema,
  EffectStatusSchema,
  EffectListParams,
  EffectListResponseSchema,
  EnqueueEffectSchema
} from './effects'

const base = {
  id: 'effect',
  missionId: 'mission',
  key: 'task/1',
  status: 'pending',
  dueAt: '2026-11-09T00:00:00.000Z',
  attempts: 0,
  leaseEpoch: null,
  lastError: null,
  createdAt: '2026-11-09T00:00:00.000Z',
  updatedAt: '2026-11-09T00:00:00.000Z'
}
const dispatch = {
  taskId: 'task',
  seq: 1,
  branch: 'axiom/attempt/task/1',
  agentSpecId: 'spec',
  contextPackageId: 'context'
}

describe('effect contract', () => {
  it('pins the two kinds and five lifecycle states', () => {
    expect(EFFECT_KINDS).toEqual(['attempt.dispatch', 'verification.enqueue'])
    expect(EffectStatusSchema.options).toEqual(['pending', 'running', 'done', 'failed', 'retired'])
  })
  it('validates each strict payload according to kind', () => {
    for (const effect of [
      { ...base, kind: 'attempt.dispatch', payload: dispatch },
      { ...base, kind: 'verification.enqueue', payload: { runId: 'run' } }
    ]) {
      expect(EffectSchema.parse(effect)).toEqual(effect)
      expect(
        EffectSchema.safeParse({ ...effect, payload: { ...effect.payload, extra: true } }).success
      ).toBe(false)
    }
    expect(
      EffectSchema.safeParse({ ...base, kind: 'attempt.dispatch', payload: { runId: 'run' } })
        .success
    ).toBe(false)
    expect(
      EffectSchema.safeParse({ ...base, kind: 'verification.enqueue', payload: dispatch }).success
    ).toBe(false)
    expect(
      EffectSchema.safeParse({
        ...base,
        kind: 'attempt.dispatch',
        payload: { ...dispatch, seq: 0 }
      }).success
    ).toBe(false)
    expect(
      EffectSchema.safeParse({
        ...base,
        kind: 'verification.enqueue',
        payload: { runId: 'run' },
        attempts: -1
      }).success
    ).toBe(false)
  })
  it('keeps enqueue and list requests strict and validates response rows', () => {
    const input = {
      missionId: 'mission',
      kind: 'attempt.dispatch',
      key: 'task/1',
      payload: dispatch
    }
    expect(EnqueueEffectSchema.parse(input)).toEqual(input)
    expect(EnqueueEffectSchema.safeParse({ ...input, status: 'done' }).success).toBe(false)
    expect(EffectListParams.parse({ missionId: 'mission', status: 'failed' })).toEqual({
      missionId: 'mission',
      status: 'failed'
    })
    expect(
      EffectListParams.safeParse({ missionId: 'mission', kind: 'attempt.dispatch' }).success
    ).toBe(false)
    expect(
      EffectListResponseSchema.safeParse({
        effects: [{ ...base, kind: 'verification.enqueue', payload: dispatch }]
      }).success
    ).toBe(false)
  })
})
