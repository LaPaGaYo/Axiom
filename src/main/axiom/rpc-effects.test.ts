import { afterEach, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { resolveAxiomCallerClass } from './authority/caller-authority'
import { EffectListResponseSchema } from '../../shared/axiom-contract/effects'

afterEach(() => vi.restoreAllMocks())

it('exposes effect listing to local CLI callers without a mutation envelope', async () => {
  const f = rpcFixture()
  try {
    await f.call('axiom.mission.create', createParams)
    const mission = f.store.listMissions({})[0]
    if (!mission) {
      throw new Error('Missing test Mission')
    }
    expect(resolveAxiomCallerClass('axiom.effect.list', {})).toBe('read')
    expect(
      await f.dispatcher.dispatch(
        {
          id: 'effects',
          authToken: 'test-caller',
          method: 'axiom.effect.list',
          params: { missionId: mission.id }
        },
        { caller: { kind: 'local-cli' } }
      )
    ).toMatchObject({ ok: true, result: { effects: [] } })
    expect(await f.call('axiom.effect.list', { missionId: 'absent' })).toMatchObject({
      ok: false,
      error: { code: 'mission_not_found' }
    })
    for (const params of [
      { missionId: mission.id, status: 'unknown' },
      { missionId: mission.id, unexpected: true }
    ]) {
      expect(await f.call('axiom.effect.list', params)).toMatchObject({
        ok: false,
        error: { code: 'invalid_argument' }
      })
    }
  } finally {
    f.db.close()
  }
})

it('filters by Mission and status and retains insertion order for tied creation times', async () => {
  const f = rpcFixture()
  try {
    await f.call('axiom.mission.create', createParams)
    await f.call('axiom.mission.create', createParams)
    const [mission, other] = f.store.listMissions({})
    if (!mission || !other) {
      throw new Error('Missing test Missions')
    }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T00:00:00.000Z'))
    const enqueue = (missionId: string, key: string, dueAt: string) =>
      f.store.enqueueEffect({
        missionId,
        kind: 'verification.enqueue',
        key,
        payload: { runId: key },
        dueAt
      })
    const first = f.store.transaction('effects_read_fixture', () => {
      const row = enqueue(mission.id, 'z-first', '2026-11-08T00:00:00.000Z')
      enqueue(mission.id, 'a-second', '2026-11-07T00:00:00.000Z')
      enqueue(other.id, 'other', '2026-11-06T00:00:00.000Z')
      return row
    })
    f.store.failEffectAttempt({
      id: first.id,
      expectedStatus: 'pending',
      expectedLeaseEpoch: null,
      lastError: 'unavailable',
      nextDueAt: null
    })
    for (const [status, keys] of [
      [undefined, ['z-first', 'a-second']],
      ['failed', ['z-first']],
      ['pending', ['a-second']]
    ] as const) {
      const response = await f.call('axiom.effect.list', { missionId: mission.id, status })
      expect(response.ok).toBe(true)
      if (!response.ok) {
        throw new Error(response.error.code)
      }
      expect(
        EffectListResponseSchema.parse(response.result).effects.map((effect) => effect.key)
      ).toEqual(keys)
    }
  } finally {
    vi.useRealTimers()
    f.db.close()
  }
})
