import { vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IntegrationFixture } from './integration-fixture.test-support'

export function refusePromotions(f: IntegrationFixture, count = 1) {
  const transition = f.store.transitionIntegrationBatch
  vi.spyOn(f.store, 'transitionIntegrationBatch').mockImplementation((input) => {
    if (input.status === 'PROMOTED' && count-- > 0) {
      return false
    }
    return transition(input)
  })
}

export function blockTask(f: IntegrationFixture) {
  f.controller.transitionTaskStage({
    taskId: f.task.taskId,
    to: 'BLOCKED',
    actor: 'henry',
    reason: 'human block'
  })
}

export function unblockTask(f: IntegrationFixture) {
  f.controller.transitionTaskStage({
    taskId: f.task.taskId,
    to: 'INTEGRATION_READY',
    actor: 'henry',
    reason: 'human unblock'
  })
}

export const promotionEvents = (f: IntegrationFixture) =>
  f.audits().filter((e) => e.event === 'integration.batch_promoted')

export async function anotherCandidate(f: IntegrationFixture) {
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  await f.git('checkout', '--detach', f.baseSha)
  const file = task.spec.scope.allowedPaths[0]
  await mkdir(path.dirname(path.join(f.repo, file)), { recursive: true })
  await writeFile(path.join(f.repo, file), 'second candidate')
  await f.git('add', file)
  await f.git('commit', '--no-gpg-sign', '-qm', 'second candidate')
  const candidate = f.store.insertCandidate({
    ...f.candidate,
    id: 'candidate-2',
    taskId: task.taskId,
    attemptId: 'dispatch-2',
    commitSha: await f.git('rev-parse', 'HEAD'),
    treeSha: await f.git('rev-parse', 'HEAD^{tree}')
  })
  f.store.updateTaskStage({ taskId: task.taskId, from: task.stage, to: 'INTEGRATION_READY' })
  f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
    JSON.stringify({
      ...task.spec,
      requiredEvidence: undefined,
      acceptanceCriteria: [
        { text: 'Offline check', check: { kind: 'command', command: 'node -e ""' } }
      ]
    }),
    task.taskId
  )
  return {
    task,
    candidate,
    file,
    enqueue: () =>
      f.store.transaction('test_integration', () =>
        f.effects.enqueue({
          kind: 'integration.apply',
          missionId: f.missionId,
          key: candidate.id,
          payload: { taskId: task.taskId, candidateId: candidate.id }
        })
      ),
    batch: () =>
      f.store.listIntegrationBatches({ missionId: f.missionId, candidateId: candidate.id })[0]
  }
}
