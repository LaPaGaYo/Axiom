import { afterEach, describe, expect, it, vi } from 'vitest'
import * as federation from '../../runtime/rpc/methods/orchestration/federation/federated-worker-start'
import { admissionFixture } from './admission-fixture.test-support'

describe('§4b Mission admission through real RPC envelopes', () => {
  let f: ReturnType<typeof admissionFixture>
  afterEach(() => f?.cleanup())

  for (const managed of [true, false]) {
    const outcome = managed ? 'refuses Mission' : 'allows plain Run'
    it(`${outcome} workerStart --on before federation`, async () => {
      f = admissionFixture(managed)
      const start = vi
        .spyOn(federation, 'startFederatedWorker')
        .mockRejectedValue(new Error('federation boundary'))
      const before = f.snapshot()
      const result = await f.call('workerStart', {
        from: 'term_coord',
        task: f.task.id,
        run: f.runId,
        on: 'remote',
        agent: 'codex'
      })
      if (managed) {
        f.refusal(result, 'workerStart')
        expect(start).not.toHaveBeenCalled()
      } else {
        expect(result).toMatchObject({ ok: false, error: { message: 'federation boundary' } })
        expect(start).toHaveBeenCalledTimes(1)
      }
      expect(f.snapshot()).toEqual(before)
    })
    it(`${outcome} ask with a live dispatch`, async () => {
      f = admissionFixture(managed)
      f.db.createDispatchContext({
        taskId: f.task.id,
        assigneeHandle: 'term_worker',
        assigneePaneKey: f.workerPaneKey,
        creator: { kind: 'system' },
        maxDepth: 1
      })
      const before = f.snapshot()
      const result = await f.call('ask', {
        from: 'term_worker',
        question: 'Continue?',
        timeoutMs: 1
      })
      if (managed) {
        f.refusal(result, 'ask')
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result).toMatchObject({ ok: true, result: { timedOut: true } })
      }
    })
    it.each(['plain', 'question'])(`${outcome} reply to %s message`, async (kind) => {
      f = admissionFixture(managed)
      const dispatch = f.db.createDispatchContext({
        taskId: f.task.id,
        assigneeHandle: 'term_worker',
        assigneePaneKey: f.workerPaneKey,
        creator: { kind: 'system' },
        maxDepth: 1
      })
      const message =
        kind === 'question'
          ? f.db.createQuestion({
              runId: f.runId,
              dispatchId: dispatch.id,
              askerHandle: 'term_worker',
              question: 'Continue?',
              options: []
            }).message
          : f.db.insertMessage({
              from: 'term_worker',
              to: `run:${f.runId}`,
              runId: f.runId,
              subject: 'Update'
            })
      const before = f.snapshot()
      const result = await f.call('reply', {
        from: 'term_coord',
        id: message.id,
        body: 'Yes',
        run: f.runId
      })
      if (managed) {
        f.refusal(result, 'reply')
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result.ok).toBe(true)
      }
    })
    it.each(['@all', '@worktree:repo::worktree'])(`${outcome} group send %s`, async (to) => {
      f = admissionFixture(managed)
      f.db.createDispatchContext({
        taskId: f.task.id,
        assigneeHandle: 'term_worker',
        assigneePaneKey: f.workerPaneKey,
        creator: { kind: 'system' },
        maxDepth: 1
      })
      vi.spyOn(f.runtime, 'listTerminals').mockResolvedValue({
        terminals: [],
        totalCount: 0,
        truncated: false
      })
      const before = f.snapshot()
      const result = await f.call('send', {
        from: 'term_coord',
        to,
        subject: 'Broadcast',
        type: 'status'
      })
      if (managed) {
        f.refusal(result, 'send(group)')
        expect(f.snapshot()).toEqual(before)
      } else if (to.startsWith('@worktree:')) {
        expect(result).toMatchObject({ ok: false, error: { code: 'terminal_not_found' } })
      } else {
        expect(result.ok).toBe(true)
      }
    })
    it(`${outcome} taskUpdate completed (M1 exit criterion 2)`, async () => {
      f = admissionFixture(managed)
      const before = f.snapshot()
      const result = await f.call('taskUpdate', {
        id: f.task.id,
        status: 'completed',
        run: f.runId,
        callerTerminalHandle: 'term_coord'
      })
      if (managed) {
        f.refusal(result, 'taskUpdate', { taskId: f.task.id })
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result.ok).toBe(true)
        expect(f.db.getTask(f.task.id)?.status).toBe('completed')
      }
    })

    it.each([true, false])(`${outcome} taskCreate with deps=%s`, async (withDeps) => {
      f = admissionFixture(managed)
      const before = f.snapshot()
      const result = await f.call('taskCreate', {
        spec: 'Unauthorized task',
        run: f.runId,
        callerTerminalHandle: 'term_coord',
        ...(withDeps ? { deps: JSON.stringify([f.task.id]) } : {})
      })
      if (managed) {
        f.refusal(result, 'taskCreate')
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result).toMatchObject({
          ok: true,
          result: { task: { status: withDeps ? 'pending' : 'ready' } }
        })
        expect(f.db.listTasks({ runId: f.runId })).toHaveLength(2)
      }
    })

    it.each(['workerStart', 'dispatch'])(`${outcome} %s (M1 exit criterion 2)`, async (verb) => {
      f = admissionFixture(managed)
      const before = f.snapshot()
      const result = await f.call(verb, {
        task: f.task.id,
        run: f.runId,
        from: 'term_coord',
        ...(verb === 'workerStart' ? { terminal: 'term_worker' } : { to: 'term_worker' })
      })
      if (managed) {
        f.refusal(result, verb, { taskId: f.task.id })
        expect(f.snapshot()).toEqual(before)
        expect(f.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
      } else {
        expect(result.ok).toBe(true)
        expect(f.db.getDispatchContext(f.task.id)?.status).toBe('dispatched')
        expect(f.db.getTask(f.task.id)?.status).toBe('dispatched')
      }
    })

    it.each(['gateCreate', 'gateResolve'])(`${outcome} %s`, async (verb) => {
      f = admissionFixture(managed)
      const gate =
        verb === 'gateResolve'
          ? f.db.createGate({ taskId: f.task.id, question: 'Continue?' })
          : undefined
      const before = f.snapshot()
      const result = await f.call(verb, {
        from: 'term_coord',
        run: f.runId,
        ...(gate ? { id: gate.id, resolution: 'Yes' } : { task: f.task.id, question: 'Continue?' })
      })
      if (managed) {
        f.refusal(result, verb, { taskId: f.task.id })
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result.ok).toBe(true)
        expect(f.db.getTask(f.task.id)?.status).toBe(gate ? 'ready' : 'blocked')
        expect(f.db.listGates({ taskId: f.task.id })[0]?.status).toBe(gate ? 'resolved' : 'pending')
      }
    })

    it.each(['all', 'tasks', 'messages'])(
      `${outcome} reset --%s (M1 exit criterion 2)`,
      async (scope) => {
        f = admissionFixture(managed)
        f.db.insertMessage({
          from: 'term_coord',
          to: `run:${f.runId}`,
          subject: 'Keep',
          body: 'Evidence',
          runId: f.runId
        })
        const before = f.snapshot()
        const result = await f.call('reset', { [scope]: true })
        if (managed) {
          f.refusal(result, 'reset')
          expect(result).toMatchObject({
            error: { message: expect.stringContaining('axiom mission cancel') }
          })
          expect(result).toMatchObject({ error: { message: expect.stringContaining('Approval') } })
          expect(f.snapshot()).toEqual(before)
          expect(f.runtime.stopOrchestrationFederationRelay).not.toHaveBeenCalled()
        } else {
          expect(result).toMatchObject({ ok: true, result: { reset: scope } })
          expect(f.db.getInbox(100)).toHaveLength(scope === 'tasks' ? 1 : 0)
          expect(f.db.listTasks({ runId: f.runId })).toHaveLength(scope === 'messages' ? 1 : 0)
        }
      }
    )

    it(`${outcome} runUse plain rebind`, async () => {
      f = admissionFixture(managed, false)
      const before = f.snapshot()
      const generation = f.db.getRun(f.runId)!.consumer_generation
      const result = await f.call('runUse', { id: f.runId, from: 'term_worker' })
      if (managed) {
        f.refusal(result, 'runUse')
        expect(f.snapshot()).toEqual(before)
        expect(f.runtime.cancelMessageWaiters).not.toHaveBeenCalled()
      } else {
        expect(result.ok).toBe(true)
        expect(f.db.getRun(f.runId)?.consumer_generation).toBe(generation + 1)
      }
    })
  }

  it.each(['taskUpdate', 'workerStart', 'dispatch'])(
    'preserves unknown Task error for %s',
    async (verb) => {
      f = admissionFixture()
      const before = f.snapshot()
      expect(
        await f.call(verb, {
          id: 'missing',
          task: 'missing',
          status: 'completed',
          from: 'term_coord',
          callerTerminalHandle: 'term_coord',
          run: f.runId,
          terminal: 'term_worker',
          to: 'term_worker'
        })
      ).toMatchObject({ ok: false, error: { code: 'task_not_found' } })
      expect(f.snapshot()).toEqual(before)
    }
  )

  it('cannot claim control_plane authority in RPC params', async () => {
    f = admissionFixture()
    const before = f.snapshot()
    f.refusal(
      await f.call('taskUpdate', {
        id: f.task.id,
        status: 'completed',
        run: f.runId,
        callerTerminalHandle: 'term_coord',
        caller: 'control_plane'
      }),
      'taskUpdate',
      { taskId: f.task.id }
    )
    expect(f.snapshot()).toEqual(before)
  })

  it('refuses reply from a Mission worker into a plain Run', async () => {
    f = admissionFixture()
    f.db.createDispatchContext({
      taskId: f.task.id,
      assigneeHandle: 'term_worker',
      assigneePaneKey: f.workerPaneKey,
      creator: { kind: 'system' },
      maxDepth: 1
    })
    const message = f.db.insertMessage({
      from: 'external',
      to: 'term_worker',
      runId: f.activeRunId,
      subject: 'Cross-Run reply'
    })
    const before = f.snapshot()
    f.refusal(
      await f.call('reply', { from: 'term_worker', id: message.id, body: 'No bypass' }),
      'reply'
    )
    expect(f.snapshot()).toEqual(before)
  })

  it.each([true, false])('keeps retired run/runStop fenced, managed=%s', async (managed) => {
    f = admissionFixture(managed)
    const before = f.snapshot()
    for (const verb of ['run', 'runStop']) {
      expect(await f.call(verb, { spec: 'Retired', from: 'term_coord' })).toMatchObject({
        ok: false,
        error: { code: 'orchestration_migration_required', data: { reason: 'command_retired' } }
      })
    }
    expect(f.snapshot()).toEqual(before)
  })
})
