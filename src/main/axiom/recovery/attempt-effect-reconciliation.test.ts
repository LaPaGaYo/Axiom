import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { RecoveryService } from './recovery-service'

let f: ReturnType<typeof channelFixture>
let recovery: RecoveryService
let now: number
beforeEach(() => {
  f = channelFixture()
  now = Date.now()
  f.db.db
    .prepare('UPDATE attempt_bindings SET dispatch_id = NULL WHERE task_id = ?')
    .run(f.t01.taskId)
  const plane = getAxiomControlPlane(f.runtime)
  recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: plane.artifacts,
    now: () => now
  })
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
function enqueue() {
  const binding = f.store.getAttemptBinding(f.t01.taskId, 1)
  if (!binding) {
    throw new Error('Expected an unbound Attempt')
  }
  return f.store.transaction('test_effect', () =>
    f.store.enqueueEffect({
      missionId: f.mission.id,
      kind: 'attempt.dispatch',
      key: `${binding.taskId}/1`,
      payload: {
        taskId: binding.taskId,
        seq: 1,
        branch: binding.branch,
        agentSpecId: binding.agentSpecId,
        contextPackageId: binding.contextPackageId
      }
    })
  )
}
function lease() {
  enqueue()
  const effect = f.store.leaseDueEffect({
    kind: 'attempt.dispatch',
    missionId: f.mission.id,
    now: new Date(Math.max(now, Date.now())).toISOString(),
    epoch: 'current'
  })
  if (!effect) {
    throw new Error('Expected a leased dispatch effect')
  }
  return effect
}
const stage = () => f.store.getTaskStage(f.t01.taskId)?.stage

it('retains a pending dispatch regardless of the binding age', async () => {
  enqueue()
  now += 3_600_000
  expect((await recovery.reconcileAttempts()).attempts).toMatchObject([{ action: 'unchanged' }])
  expect(stage()).toBe('RUNNING')
})
it('gives a newly leased dispatch two readiness windows and then settles a hanging launch', async () => {
  now += 3_600_000
  lease()
  expect((await recovery.reconcileAttempts()).attempts).toMatchObject([{ action: 'unchanged' }])
  now += 120_001
  expect((await recovery.reconcileAttempts()).attempts).toMatchObject([
    { action: 'launch_pending_orphan' }
  ])
  expect(stage()).toBe('READY')
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'attempt.launch_pending_orphan')
  ).toHaveLength(1)
  await recovery.reconcileAttempts()
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'attempt.launch_pending_orphan')
  ).toHaveLength(1)
})
it.each(['done', 'failed', 'retired', 'missing'] as const)(
  'uses the original binding age for %s dispatch work',
  async (status) => {
    if (status !== 'missing') {
      const effect = lease()
      const fence = {
        id: effect.id,
        expectedStatus: 'running' as const,
        expectedLeaseEpoch: 'current'
      }
      if (status === 'done') {
        f.store.completeEffect(fence)
      } else if (status === 'failed') {
        f.store.failEffectAttempt({ ...fence, lastError: 'launch failed', nextDueAt: null })
      } else {
        f.store.retireEffect({ ...fence, reason: 'dispatch_outcome_unknown' })
      }
    }
    await recovery.reconcileAttempts()
    expect(stage()).toBe('RUNNING')
    now += 120_001
    expect((await recovery.reconcileAttempts()).attempts).toMatchObject([
      { action: 'launch_pending_orphan' }
    ])
    expect(stage()).toBe('READY')
  }
)
