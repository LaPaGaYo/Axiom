import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from './attempt-channel-fixture.test-support'
import { resolveAttemptSender } from './attempt-authority'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const resolve = (attemptId = f.t01.attemptId) =>
  resolveAttemptSender({
    ...f,
    from: f.t01.from,
    attemptId
  })
it('resolves the durable binding, Task, Mission, Run and kernel sender identity', () => {
  expect(resolve()).toMatchObject({
    mission: { id: f.mission.id },
    task: { taskId: f.t01.taskId },
    binding: { seq: 1 },
    dispatch: { id: f.t01.attemptId },
    run: { id: f.mission.runId },
    sender: { address: f.t01.from, paneKey: f.t01.paneKey }
  })
})
it('rejects an unknown dispatch before identity lookup', () => {
  const before = f.snapshot()
  expect(() => resolve('missing')).toThrow(expect.objectContaining({ code: 'unknown_dispatch' }))
  expect(f.snapshot()).toEqual(before)
})
it('rejects a kernel dispatch with no Axiom binding', () => {
  const task = f.db.createTask({ runId: f.mission.runId, spec: 'Unmanaged' })
  const dispatch = f.db.createDispatchContext({
    taskId: task.id,
    assigneeHandle: 'term_unmanaged',
    creator: { kind: 'system' },
    maxDepth: 1
  })
  const before = f.snapshot()
  expect(() => resolve(dispatch.id)).toThrow(expect.objectContaining({ code: 'unknown_dispatch' }))
  expect(f.snapshot()).toEqual(before)
})
it.each(['stopping', 'incarnation', 'pane'] as const)(
  'keeps the kernel %s fence and has no effects',
  (reason) => {
    if (reason === 'stopping') {
      f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
    }
    if (reason === 'incarnation') {
      f.processes.set(f.t01.from, 'new-process')
    }
    if (reason === 'pane') {
      f.panes.set(f.t01.from, 'foreign-pane')
    }
    const before = f.snapshot()
    expect(() => resolve()).toThrow(
      expect.objectContaining({ code: reason === 'stopping' ? 'dispatch_inactive' : 'worker_identity_changed' })
    )
    expect(f.snapshot()).toEqual(before)
  }
)
it('rejects mismatched binding ownership', () => {
  const other = f.store
    .listTaskStages({ missionId: f.mission.id })
    .find((t) => t.spec.id === 'T02')!
  vi.spyOn(f.store, 'getAttemptBindingByDispatch').mockReturnValue({
    ...f.store.getAttemptBinding(f.t01.taskId, 1)!,
    taskId: other.taskId
  })
  const before = f.snapshot()
  expect(() => resolve()).toThrow(expect.objectContaining({ code: 'task_dispatch_mismatch' }))
  expect(f.snapshot()).toEqual(before)
})

it('requires the message sender when a dispatch has no recorded process incarnation', () => {
  f.db.db.prepare('UPDATE dispatch_contexts SET process_incarnation = NULL WHERE id = ?').run(f.t01.attemptId)
  expect(resolve().sender.address).toBe(f.t01.from)
  f.panes.set(f.t01.from, 'foreign-pane')
  const before = f.snapshot()
  expect(() => resolve()).toThrow(expect.objectContaining({ code: 'sender_not_assignee' }))
  expect(f.snapshot()).toEqual(before)
})
it.each(['coordinator', 'worker'])('fences another %s terminal before looking up the Attempt', (party) => {
  const caller = party === 'worker' ? f.bind('T02') : { from: 'term_coordinator', paneKey: 'coordinator-pane' }
  f.panes.set(caller.from, caller.paneKey)
  if (party === 'coordinator') {
    f.db.createRun({ coordinatorHandle: caller.from, coordinatorPaneKey: caller.paneKey, objective: 'Other Run' })
  }
  const before = f.snapshot()
  expect(() => resolveAttemptSender({
    ...f, from: f.t01.from, attemptId: 'missing',
    orchestrationCompatibilityEvidence: { terminalHandle: caller.from, paneKey: caller.paneKey }
  })).toThrow(expect.objectContaining({ code: 'consumer_fenced' }))
  expect(f.snapshot()).toEqual(before)
})
