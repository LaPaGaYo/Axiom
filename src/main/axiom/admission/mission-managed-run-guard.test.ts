import { afterEach, describe, expect, it } from 'vitest'
import { assertNotMissionManaged } from './mission-managed-run-guard'
import { admissionFixture } from './admission-fixture.test-support'

describe('Mission object lookup and in-process authority', () => {
  let f: ReturnType<typeof admissionFixture>
  afterEach(() => f?.cleanup())

  it.each(['run', 'task', 'dispatch'])('resolves the Mission from its %s', (kind) => {
    f = admissionFixture()
    const dispatch = f.db.createDispatchContext({
      taskId: f.task.id,
      assigneeHandle: 'term_worker',
      creator: { kind: 'system' },
      maxDepth: 1
    })
    const ids =
      kind === 'run'
        ? { runId: f.runId }
        : kind === 'task'
          ? { taskId: f.task.id }
          : { dispatchId: dispatch.id }
    const before = f.snapshot()
    expect(() => assertNotMissionManaged(f.runtime, { ...ids, verb: 'test' })).toThrowError(
      expect.objectContaining({
        code: 'mission_managed',
        data: {
          missionId: f.missionId,
          runId: f.runId,
          verb: 'test',
          ...(kind !== 'run' ? { taskId: f.task.id } : {}),
          ...(kind === 'dispatch' ? { dispatchId: dispatch.id } : {})
        }
      })
    )
    expect(f.snapshot()).toEqual(before)
  })

  it('allows explicit in-process control_plane authority without writes', () => {
    f = admissionFixture()
    const before = f.snapshot()
    expect(() =>
      assertNotMissionManaged(f.runtime, {
        runId: f.runId,
        taskId: f.task.id,
        verb: 'test',
        caller: 'control_plane'
      })
    ).not.toThrow()
    expect(f.snapshot()).toEqual(before)
    expect(() =>
      assertNotMissionManaged(f.runtime, {
        runId: f.runId,
        verb: 'test',
        caller: 'rpc'
      })
    ).toThrowError(expect.objectContaining({ code: 'mission_managed' }))
  })

  it('blocks reset even after the Mission is canceled', async () => {
    f = admissionFixture()
    f.missions.cancelMission(f.missionId!, 'test cancellation')
    const before = f.snapshot()
    f.refusal(await f.call('reset', { messages: true }), 'reset')
    expect(f.snapshot()).toEqual(before)
  })

  it('does not block a plain Run merely because a Mission also exists', async () => {
    f = admissionFixture(true, false)
    const task = f.db.createTask({ runId: f.activeRunId, spec: 'Unrelated task' })
    expect(
      await f.call('taskUpdate', {
        id: task.id,
        status: 'completed',
        run: f.activeRunId,
        callerTerminalHandle: 'term_coord'
      })
    ).toMatchObject({ ok: true })
    expect(f.db.getTask(task.id)?.status).toBe('completed')
  })
})
