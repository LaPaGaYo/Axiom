import { afterEach, beforeEach, expect, it } from 'vitest'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
})

it('dates a provider wait from the first refusal of its current stage', async () => {
  const firstId = f.task('T01').taskId
  const secondId = f.task('T02').taskId
  const refusal = { installed: [], filtered: [] }
  const firstAt = '2026-11-01T13:00:00.000Z'
  const secondAt = '2026-11-01T13:01:00.000Z'
  f.stage('T01', 'BLOCKED')
  const previous = f.audit(
    'task',
    firstId,
    'task.admission_refused',
    refusal,
    '2026-11-01T11:00:00.000Z'
  )
  f.stage('T01', 'READY')
  const first = f.audit('task', firstId, 'task.admission_refused', refusal, firstAt)
  f.audit('task', secondId, 'task.admission_refused', refusal, secondAt)
  f.audit('task', firstId, 'task.admission_refused', refusal, '2026-11-01T13:02:00.000Z')
  const boundary = f.store.getLatestReadModelAudit({
    missionId: f.missionId,
    objectKind: 'task',
    objectId: firstId,
    events: ['task.stage']
  })!
  expect(previous).toBeLessThan(boundary.sequence)
  expect(first).toBeGreaterThan(boundary.sequence)
  const waitingOn = { on: 'admission', reason: 'no_eligible_provider', person: true }
  const expected = [
    { taskId: firstId, since: firstAt },
    { taskId: secondId, since: secondAt }
  ].map(({ taskId, since }) => ({
    id: `task_blocked:${taskId}`,
    kind: 'task_blocked',
    objectId: taskId,
    taskId,
    reason: 'no_eligible_provider',
    blocking: true,
    blocks: 10,
    actions: ['axiom.policy.update', 'axiom.task.cancel'],
    since,
    waitingOn
  }))
  expect((await f.pending()).items).toEqual(expected)
  expect((await f.show('T01')).waitingOn).toEqual(waitingOn)
  expect((await f.show('T02')).waitingOn).toEqual(waitingOn)

  f.audit('task', firstId, 'task.admission_refused', refusal, '2026-11-01T13:03:00.000Z')
  expect((await f.pending()).items).toEqual(expected)
  expect(
    (await f.list())
      .filter((task) => [firstId, secondId].includes(task.id))
      .map((task) => task.waitingOn)
  ).toEqual([waitingOn, waitingOn])

  f.stage('T01', 'BLOCKED')
  f.stage('T01', 'READY')
  expect((await f.pending()).items).toEqual([expected[1]])
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'admission',
    reason: 'next_round',
    person: false
  })
  const restartedAt = '2026-11-01T14:00:00.000Z'
  f.audit('task', firstId, 'task.admission_refused', refusal, restartedAt)
  f.audit('task', firstId, 'task.admission_refused', refusal, '2026-11-01T14:01:00.000Z')
  expect((await f.pending()).items).toEqual([expected[1], { ...expected[0], since: restartedAt }])
  expect((await f.show('T01')).waitingOn).toEqual(waitingOn)
})
