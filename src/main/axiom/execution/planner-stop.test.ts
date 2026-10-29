import { afterEach, expect, it, vi } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { stopPlanner } from './planner-stop'
import * as stop from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import * as release from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
afterEach(() => vi.restoreAllMocks())
it('coalesces overlapping stops and retains one identical stop receipt', async () => {
  const f = await plannerFixture()
  try {
    const dispatchId = (await createPlannerLauncher(f.deps).start(f.mission.id)).attempt.attemptId!
    const stopping = vi.spyOn(stop, 'stopLocalWorker').mockResolvedValue({ state: 'stopped' })
    vi.spyOn(release, 'releaseLocalWorker').mockResolvedValue({
      dispatchId,
      state: 'released',
      processAction: 'none',
      archive: null
    })
    const binding = { missionId: f.mission.id, dispatchId }
    await Promise.all([
      stopPlanner(f.runtime, f.store, binding, 'no_proposal'),
      stopPlanner(f.runtime, f.store, binding, 'no_proposal')
    ])
    expect(stopping).toHaveBeenCalledOnce()
    await stopPlanner(f.runtime, f.store, binding, 'no_proposal')
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((e) => e.event === 'planner.stopped')
    ).toHaveLength(1)
  } finally {
    await f.close()
  }
})
