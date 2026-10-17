import { afterEach, describe, expect, it } from 'vitest'
import { admissionFixture } from './admission-fixture.test-support'

describe('§4b send admission before synchronous settlement', () => {
  let f: ReturnType<typeof admissionFixture>
  afterEach(() => f?.cleanup())

  for (const managed of [true, false]) {
    it.each(['worker_done', 'merge_ready', 'dispatch', 'decision_gate'])(
      `managed=${managed}: send %s`,
      async (type) => {
        f = admissionFixture(managed)
        const dispatch = f.db.createDispatchContext({
          taskId: f.task.id,
          assigneeHandle: 'term_worker',
          creator: { kind: 'system' },
          maxDepth: 1
        })
        const before = f.snapshot()
        const result = await f.call('send', {
          from: 'term_worker',
          to: `run:${f.runId}`,
          type,
          subject: 'Worker report',
          body: 'Done',
          payload: JSON.stringify({
            taskId: f.task.id,
            dispatchId: dispatch.id,
            outcome: 'succeeded'
          })
        })
        if (managed) {
          f.refusal(result, 'send')
          expect(f.snapshot()).toEqual(before)
          expect(f.runtime.notifyMessageArrived).not.toHaveBeenCalled()
        } else {
          expect(result).toMatchObject({ ok: true, result: { message: { type } } })
          expect(f.db.getInbox(100)).toHaveLength(1)
          expect(f.db.getTask(f.task.id)?.status).toBe(
            type === 'worker_done' ? 'completed' : 'dispatched'
          )
          if (type === 'worker_done') {
            expect(result).toMatchObject({ result: { lifecycle: { action: 'completed' } } })
          }
        }
      }
    )
  }

  it.each(['status', 'heartbeat'])('allows Mission %s', async (type) => {
    f = admissionFixture()
    const dispatch = f.db.createDispatchContext({
      taskId: f.task.id,
      assigneeHandle: 'term_worker',
      creator: { kind: 'system' },
      maxDepth: 1
    })
    const stages = f.store.listTaskStages({ missionId: f.missionId! })
    expect(
      await f.call('send', {
        from: 'term_worker',
        to: `run:${f.runId}`,
        type,
        subject: 'Alive',
        body: 'Working',
        payload: JSON.stringify({ taskId: f.task.id, dispatchId: dispatch.id })
      })
    ).toMatchObject({ ok: true, result: { message: { type } } })
    expect(f.db.getTask(f.task.id)?.status).toBe('dispatched')
    expect(f.store.listTaskStages({ missionId: f.missionId! })).toEqual(stages)
    expect(f.db.getInbox(100)).toHaveLength(1)
  })

  it.each(['dispatch', 'bare', 'implicit'])(
    'refuses a Mission target resolved via %s',
    async (route) => {
      f = admissionFixture()
      const dispatch = f.db.createDispatchContext({
        taskId: f.task.id,
        assigneeHandle: 'term_worker',
        assigneePaneKey: f.workerPaneKey,
        creator: { kind: 'system' },
        maxDepth: 1
      })
      const before = f.snapshot()
      f.refusal(
        await f.call('send', {
          from: route === 'bare' ? 'unbound-sender' : 'term_worker',
          ...(route === 'implicit'
            ? {}
            : { to: route === 'bare' ? 'term_worker' : `dispatch:${dispatch.id}` }),
          type: 'merge_ready',
          subject: 'Ready',
          body: 'Promote'
        }),
        'send'
      )
      expect(f.snapshot()).toEqual(before)
    }
  )
})
