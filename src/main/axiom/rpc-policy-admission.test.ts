import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { getAxiomControlPlane } from './control-plane'

let f: ReturnType<typeof rpcFixture>
let missionId: string
beforeEach(async () => {
  f = rpcFixture()
  const created = await f.call('axiom.mission.create', createParams)
  if (!created.ok) {
    throw new Error(created.error.code)
  }
  missionId = f.store.listMissions({})[0].id
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})
const updates = () =>
  f.store.listAuditEvents({ missionId }).filter((event) => event.event === 'policy.updated')

it('requests one admission round after a policy update commits', async () => {
  const status = f.store.getMission(missionId)?.status
  const plane = getAxiomControlPlane(f.runtime)
  const schedule = vi.spyOn(plane.scheduler, 'scheduleRound').mockImplementation(() => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(updates().at(-1)?.after).toEqual(f.store.getPolicy(missionId))
    return Promise.resolve({ admitted: [], skipped: [] })
  })
  const routing = { preferredProviders: ['codex'], disallowedProviders: ['claude'] }
  for (const [index, patch] of [{ concurrencyLimit: 2 }, { routing }, { routing }].entries()) {
    schedule.mockClear()
    const envelope = { orchestrationRequestId: `policy-admission-${index}` }
    const response = await f.call('axiom.policy.update', { missionId, patch }, envelope)
    expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'policy')
    expect(response).toMatchObject({ ok: true, result: { policy: patch } })
    expect(updates()).toHaveLength(index + 1)
    expect(await f.call('axiom.policy.update', { missionId, patch }, envelope)).toMatchObject({
      ok: true,
      result: { mutation: { replayed: true } }
    })
    expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'policy')
    expect(updates()).toHaveLength(index + 1)
  }
  expect(status).not.toBe('EXECUTING')
  expect(f.store.getMission(missionId)?.status).toBe(status)
})

it('requests no admission round when a policy update is refused or rolled back', async () => {
  const plane = getAxiomControlPlane(f.runtime)
  const schedule = vi
    .spyOn(plane.scheduler, 'scheduleRound')
    .mockResolvedValue({ admitted: [], skipped: [] })
  const before = f.store.getPolicy(missionId)
  for (const [patch, code] of [
    [{ readinessThreshold: 'VERIFIED' }, 'invalid_argument'],
    [{ budget: {}, concurrencyLimit: 2 }, 'approval_required'],
    [{ unknown: true }, 'invalid_argument']
  ] as const) {
    expect(await f.call('axiom.policy.update', { missionId, patch })).toMatchObject({
      ok: false,
      error: { code }
    })
    expect(schedule).not.toHaveBeenCalled()
    expect(f.store.getPolicy(missionId)).toEqual(before)
  }
  const missingId = 'mission_missing_policy_admission'
  expect(
    await f.call('axiom.policy.update', {
      missionId: missingId,
      patch: { concurrencyLimit: 2 }
    })
  ).toMatchObject({ ok: false, error: { code: 'mission_not_found' } })
  expect(f.store.getPolicy(missingId)).toBeUndefined()
  expect(schedule).not.toHaveBeenCalled()
  expect(f.store.getPolicy(missionId)).toEqual(before)
  expect(
    await f.dispatcher.dispatch(
      {
        id: 'local-policy-update',
        authToken: 'test-caller',
        method: 'axiom.policy.update',
        params: { missionId, patch: { concurrencyLimit: 2 } },
        orchestrationContractVersion: 1,
        orchestrationRequestId: 'local-policy-update'
      },
      { caller: { kind: 'local-cli' } }
    )
  ).toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
  expect(schedule).not.toHaveBeenCalled()
  expect(f.store.getPolicy(missionId)).toEqual(before)
  vi.spyOn(plane.store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  expect(
    await f.call('axiom.policy.update', { missionId, patch: { concurrencyLimit: 2 } })
  ).toMatchObject({ ok: false })
  expect(schedule).not.toHaveBeenCalled()
  expect(f.store.getPolicy(missionId)).toEqual(before)
  expect(updates()).toEqual([])
})
