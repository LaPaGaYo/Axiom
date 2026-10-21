import { afterEach, expect, it, vi } from 'vitest'
import { rpcFixture, createParams } from './rpc-fixture.test-support'
import { startAxiomControlPlane, stopAxiomControlPlane } from './control-plane-boot'
import { insertMail } from './mailbox-runtime.test-support'

let f: ReturnType<typeof rpcFixture>
afterEach(() => {
  stopAxiomControlPlane(f.runtime)
  f.db.close()
  vi.useRealTimers()
})

it('starts consumers through the existing mission RPC path and stops them on cancellation', async () => {
  vi.useFakeTimers()
  f = rpcFixture()
  await startAxiomControlPlane(f.runtime)
  expect(await f.call('axiom.mission.create', createParams)).toMatchObject({ ok: true })
  const mission = f.store.listMissions({})[0]!
  const message = insertMail(f.db, mission.runId)
  f.runtime.notifyMessageArrived(`run:${mission.runId}`, 'status')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: 'mailbox.message', objectId: message.id })
    ])
  )
  expect(f.db.getUnreadRunMailbox(mission.runId)).toEqual([])
  expect(
    await f.call('axiom.mission.cancel', { missionId: mission.id, reason: 'stop test' })
  ).toMatchObject({ ok: true })
  insertMail(f.db, mission.runId)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(f.db.getUnreadRunMailbox(mission.runId)).toHaveLength(1)
})
