import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'

let f: ReturnType<typeof rpcFixture>
let plane: ReturnType<typeof getAxiomControlPlane>
beforeEach(() => {
  f = rpcFixture()
  plane = getAxiomControlPlane(f.runtime)
})
afterEach(async () => {
  await plane.effects.stop()
  f.db.close()
  vi.restoreAllMocks()
})

it('registers the integration executor in the Control Plane', async () => {
  plane.store.transaction('test_integration', () =>
    plane.effects.enqueue({
      kind: 'integration.apply',
      missionId: 'missing-mission',
      key: 'missing-candidate',
      payload: { taskId: 'missing-task', candidateId: 'missing-candidate' }
    })
  )
  await plane.effects.recoverAtBoot()
  plane.effects.start()
  await plane.effects.kick()
  expect(plane.store.getEffect('integration.apply', 'missing-candidate')?.status).toBe('done')
})
