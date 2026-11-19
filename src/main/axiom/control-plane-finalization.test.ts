import { expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { rpcFixture } from './rpc-fixture.test-support'
import { finalizationFixture } from './finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from './finalization/finalization-runtime.test-support'
import { getAxiomControlPlane } from './control-plane'
import { missionFinalization } from './read-models/finalization-reads'

it('the Control Plane executes a queued mission.finalize effect', async () => {
  const rpc = rpcFixture()
  expect(rpc.db).toBeInstanceOf(OrchestrationDb)
  const f = finalizationFixture(rpc.db)
  mockFinalizationGit(rpc.runtime)
  const plane = getAxiomControlPlane(rpc.runtime)
  try {
    f.missions.startFinalization(f.missionId)
    plane.store.transaction('test_finalization', () =>
      plane.effects.enqueue({
        kind: 'mission.finalize',
        missionId: f.missionId,
        key: f.missionId,
        payload: {}
      })
    )
    plane.effects.start()
    await plane.effects.kick()
    await plane.effects.stop()
    expect(plane.store.getEffect('mission.finalize', f.missionId)?.status).toBe('done')
    expect(missionFinalization(plane.store, f.missionId)?.outcome).toBe('ready')
  } finally {
    await plane.effects.stop()
    rpc.db.close()
    vi.restoreAllMocks()
  }
})
