import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createOrchestrationWorkerReleaseHarness } from './worker-release.test-support'
import { startLocalWorker } from './local-worker-start'

const h = createOrchestrationWorkerReleaseHarness()
afterEach(() => h.cleanup())
it('starts a raw headless command with normal dispatch custody, without prompt waits or paste', async () => {
  h.setup()
  const task = h.db.createTask({ spec: 'headless task', runId: h.activeRunId })
  const prepare = vi.fn(async (_id: string) => ({ command: 'raw headless command', env: {} }))
  const preambleBuilder = vi.fn(() => 'must not paste')
  const receipt = z.object({ taskId: z.string(), dispatchId: z.string(), state: z.string() }).parse(
    await startLocalWorker({
      runtime: h.runtime,
      db: h.db,
      run: h.db.getRun(h.activeRunId)!,
      existingTask: task,
      coordinator: null,
      params: { from: 'term_coord', task: task.id, agent: 'codex', worktree: 'current' },
      mode: { mode: 'structured', preferred: 'structured', reason: 'user_default', detail: 'test' },
      controlPlane: {
        dispatchCreator: { kind: 'system' },
        worktreeId: 'repo::worktree',
        headless: { prepare },
        preambleBuilder
      }
    })
  )
  expect(receipt.state).toBe('ready')
  expect(receipt.taskId).toBe(task.id)
  expect(prepare).toHaveBeenCalledExactlyOnceWith(receipt.dispatchId)
  expect(h.runtime.createTerminal).toHaveBeenCalledWith(
    'id:repo::worktree',
    expect.objectContaining({ command: 'raw headless command', env: {} })
  )
  expect(vi.mocked(h.runtime.createTerminal).mock.calls[0][1]).not.toHaveProperty('startupAgent')
  expect(h.runtime.waitForTerminal).not.toHaveBeenCalled()
  expect(h.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  expect(preambleBuilder).not.toHaveBeenCalled()
  expect(h.db.getDispatchContextById(receipt.dispatchId)?.status).toBe('dispatched')
  expect(h.db.getWorkerDispatch(receipt.dispatchId)).toMatchObject({
    state: 'ready',
    worktree_id: 'repo::worktree'
  })
  expect(h.db.getWorkerTerminalResourceByOwner(receipt.dispatchId)?.ownership_state).toBe('owned')
})
