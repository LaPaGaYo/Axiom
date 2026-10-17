import { afterEach, describe, expect, it, vi } from 'vitest'
import { admissionFixture } from './admission-fixture.test-support'

describe('M2-06a worker control admission', () => {
  let f: ReturnType<typeof admissionFixture>
  afterEach(() => f?.cleanup())
  for (const managed of [true, false]) {
    it.each([
      'workerStop',
      'workerAbandon',
      'workerRelease',
      'workerRetain',
      'workerTerminalUserInput'
    ])(`managed=${managed} %s cannot bypass Mission authority`, async (verb) => {
      f = admissionFixture(managed)
      const { dispatch } = f.db.createStartingWorkerDispatch({
        taskId: f.task.id,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {}
      })
      f.db.prepareStartingWorkerAuthority({
        dispatchId: dispatch.id,
        handle: 'term_worker',
        paneKey: f.workerPaneKey,
        processIncarnation: 'runtime_test:term_worker:1',
        worktreeId: 'repo::worktree',
        effects: [],
        setupState: 'not_applicable',
        terminalOwnership: 'created'
      })
      f.db.markWorkerDispatchReady(dispatch.id)
      const before = f.snapshot()
      const resources = f.db.listWorkerTerminalResources()
      const result = await f.call(
        verb,
        verb === 'workerTerminalUserInput' ? { terminal: 'term_worker' } : { dispatch: dispatch.id }
      )
      if (managed) {
        f.refusal(result, verb)
        expect(f.snapshot()).toEqual(before)
        expect(f.db.listWorkerTerminalResources()).toEqual(resources)
        expect(f.runtime.closeTerminal).not.toHaveBeenCalled()
        expect(f.runtime.notifyMessageArrived).not.toHaveBeenCalled()
      } else if (verb === 'workerRelease') {
        expect(result).toMatchObject({ ok: false, error: { code: 'dispatch_inactive' } })
        expect(f.snapshot()).toEqual(before)
      } else {
        expect(result.ok).toBe(true)
      }
    })
  }
  it.each(['workerStop', 'workerAbandon', 'workerRelease', 'workerRetain'])(
    '%s preserves the kernel unknown-dispatch error',
    async (verb) => {
      f = admissionFixture()
      expect(await f.call(verb, { dispatch: 'missing' })).toMatchObject({
        ok: false,
        error: { code: 'dispatch_not_found' }
      })
    }
  )
  it.each(['pane', 'session', 'reminted-pane'])(
    'guards terminal input resolved through %s, including settled resources',
    async (route) => {
      f = admissionFixture()
      const { dispatch } = f.db.createStartingWorkerDispatch({
        taskId: f.task.id,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {}
      })
      f.db.prepareStartingWorkerAuthority({
        dispatchId: dispatch.id,
        handle: 'term_worker',
        paneKey: f.workerPaneKey,
        processIncarnation: 'runtime_test:term_worker:1',
        worktreeId: 'repo::worktree',
        effects: [],
        setupState: 'not_applicable',
        terminalOwnership: 'created'
      })
      f.db.markWorkerDispatchReady(dispatch.id)
      f.db.settleWorkerReport({
        taskId: f.task.id,
        dispatchId: dispatch.id,
        outcome: 'succeeded',
        result: 'done'
      })
      vi.spyOn(f.runtime, 'getStructuredWorkerPaneKeyForSession').mockReturnValue(f.workerPaneKey)
      const before = f.db.listWorkerTerminalResources()
      f.refusal(
        await f.call(
          'workerTerminalUserInput',
          route === 'session'
            ? { sessionId: 'session-worker' }
            : {
                paneKey:
                  route === 'reminted-pane'
                    ? f.workerPaneKey.replace('tab_worker:', 'reminted:')
                    : f.workerPaneKey
              }
        ),
        'workerTerminalUserInput'
      )
      expect(f.db.listWorkerTerminalResources()).toEqual(before)
    }
  )
})
