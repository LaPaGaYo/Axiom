import { afterEach, expect, it, vi } from 'vitest'
import { rpcFixture } from './rpc-fixture.test-support'
import { planned } from './mission-controller/controller-fixture.test-support'
import { MissionController } from './mission-controller/mission-controller'
import { TaskResponseSchema } from '../../shared/axiom-contract/task-params'
import { MessageListResponseSchema } from '../../shared/axiom-contract/message-params'

afterEach(() => vi.restoreAllMocks())

it('refuses a cancellation whose rationale looks like a secret', async () => {
  const rpc = rpcFixture()
  const f = planned({ ...rpc, controller: new MissionController(rpc.db, rpc.store) })
  try {
    const task = f.store.listTaskStages({ missionId: f.missionId })[0]!
    f.controller.transitionTaskStage({
      taskId: task.taskId,
      to: 'BLOCKED',
      reason: 'scope',
      actor: 'test'
    })
    const pending = f.db.insertMessage({
      from: 'worker',
      to: `run:${f.store.getMission(f.missionId)!.runId}`,
      runId: f.store.getMission(f.missionId)!.runId,
      subject: 'Blocked',
      type: 'escalation',
      payload: JSON.stringify({
        axiom: {
          version: 1,
          type: 'BLOCKED',
          missionId: f.missionId,
          taskId: task.taskId,
          attemptId: 'attempt-1',
          summary: 'Need the test path',
          artifactIds: [],
          related: {},
          blocked: { reason: 'blocked_by_scope', paths: ['src/test.ts'] }
        }
      })
    })
    async function read() {
      const shown = await rpc.call('axiom.task.show', { taskId: task.taskId })
      const messages = await rpc.call('axiom.message.list', {
        missionId: f.missionId,
        taskId: task.taskId,
        pendingOnly: true
      })
      if (!shown.ok || !messages.ok) {
        throw new Error('Fixture read failed')
      }
      return {
        task: TaskResponseSchema.parse(shown.result).task,
        audits: f.store.listAuditEvents({ missionId: f.missionId }),
        messages: MessageListResponseSchema.parse(messages.result).messages
      }
    }
    const before = await read()
    expect(before.messages.map((m) => m.id)).toEqual([pending.id])
    const params = { taskId: task.taskId, rationale: `ghp_${'a'.repeat(30)}` }
    expect(await rpc.call('axiom.task.cancel', params)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'secret_in_rationale' }
    })
    expect(await read()).toEqual(before)
    const rationale = 'This Task is no longer needed.'
    const result = await rpc.call('axiom.task.cancel', { ...params, rationale })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('Ordinary cancellation refused')
    }
    expect(TaskResponseSchema.parse(result.result).task.stage).toBe('CANCELED')
    const after = await read()
    expect(after.task.stage).toBe('CANCELED')
    expect(after.messages).toEqual([])
    expect(after.audits.findLast((a) => a.event === 'task.stage')).toMatchObject({
      after: { stage: 'CANCELED', reason: rationale }
    })
    expect(after.audits.filter((a) => a.event === 'blocked.resolved')).toMatchObject([
      { objectId: pending.id, after: { decision: 'canceled', rationale } }
    ])
  } finally {
    f.db.close()
  }
})
