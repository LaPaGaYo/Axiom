import { formatOrcaSessionAddress } from '../../../shared/orca-session-address'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration-worker-start-params'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { recordedCreatorIdentity } from '../../runtime/orchestration/db/dispatch-depth'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/orchestration-caller-identity'
import {
  buildDispatchPreamble,
  dispatchPreambleSendOptions
} from '../../runtime/orchestration/preamble'
import type { RunRow, TaskRow } from '../../runtime/orchestration/types'
import type { RuntimeManagedWorktreeCreateArgs } from '../../runtime/runtime-managed-worktree-create-types'
import { resolveDispatchCreator } from '../../runtime/rpc/methods/orchestration/runs/dispatch-creator'
import { startLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-start'
import { observeWorkerTurnStart } from '../../runtime/rpc/methods/orchestration/worker/worker-start-turn-observation'
import { sendStructuredWorkerPreamble } from '../../runtime/rpc/methods/orchestration-structured-worker-session'

// Failure-harness pattern: mock host I/O, validation and setup; keep dispatch DB,
// placement, worktree creation, preamble building, delivery and readiness settlement real.
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-start-validation', () => ({
  prepareLocalWorkerStart: () => ({
    agent: 'claude',
    launch: { receipt: { requested: null, effective: null }, preferences: undefined }
  })
}))
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-setup-gate', () => ({
  persistGatedSetupSpawnFailure: () => false,
  persistWorkerReadinessStage: () => {},
  persistWorkerSetupWaitOutcome: () => {}
}))
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-start-receipt', () => ({
  failWorkerStartWithReceipt: (args: { failedStage: string; error: unknown }) => ({
    state: 'failed',
    stage: args.failedStage,
    error: args.error
  })
}))
vi.mock('../../runtime/rpc/methods/orchestration/worker/worker-start-turn-observation', () => ({
  observeWorkerTurnStart: vi.fn(async () => ({ verdict: 'observed' })),
  describeUnobservedWorkerTurnStart: () => 'No turn observed'
}))
vi.mock('../../runtime/rpc/methods/orchestration-structured-worker-session', () => ({
  createStructuredWorkerSession: vi.fn(async () => ({
    identity: { handle: 'term_worker', sessionId: 'session_worker' },
    host: {}
  })),
  sendStructuredWorkerPreamble: vi.fn(async () => 'accepted'),
  releaseStructuredWorkerSession: vi.fn(),
  discardStructuredWorkerSession: vi.fn(async () => {})
}))

const sessionId = testOrcaSessionId('axiom-mission-worker-start-contract')
const caller: OrchestrationSessionCaller = {
  address: formatOrcaSessionAddress(sessionId),
  terminalHandle: null,
  paneKey: null,
  orcaSessionId: sessionId,
  sessionId,
  workspaceId: 'repo::mission'
}
const terminalMode = {
  mode: 'terminal',
  preferred: 'terminal',
  reason: 'user_default',
  detail: 'terminal by default'
} as const
const structuredMode = {
  mode: 'structured',
  preferred: 'structured',
  reason: 'user_default',
  detail: 'structured by default'
} as const

function runtimeFixture() {
  return {
    showTerminal: vi.fn(async () => {
      throw new Error('Synthetic caller has no terminal')
    }),
    showManagedTerminalWorkspace: vi.fn(async (selector: string) => ({
      id: selector.slice(3),
      repoId: 'repo'
    })),
    showManagedWorktree: vi.fn(async () => ({ id: caller.workspaceId, repoId: 'repo' })),
    showRepo: vi.fn(async () => ({ id: 'repo', kind: 'git' })),
    createManagedWorktree: vi.fn(async (_args: RuntimeManagedWorktreeCreateArgs) => ({
      worktree: { id: 'repo::created', repoId: 'repo' },
      startupTerminal: { handle: 'term_worker' }
    })),
    listTerminals: vi.fn(async () => ({ terminals: [] })),
    createTerminal: vi.fn(async () => ({ handle: 'term_worker' })),
    getNestedWorkerMaxDepth: vi.fn(() => 3),
    getRuntimeId: () => 'epoch-contract',
    getTerminalOrchestrationCliCommand: () => 'axiom',
    getStructuredAgentSessionCreateSupport: vi.fn(async () => ({ supported: true })),
    getOrchestrationDispatchAuthority: vi.fn(() => ({
      paneKey: 'pane_worker',
      processIncarnation: 'inc_worker',
      hostScope: { kind: 'local', hostId: 'local' }
    })),
    getTerminalProcessIncarnation: vi.fn(() => 'inc_worker'),
    getTerminalPaneKey: vi.fn(() => 'pane_worker'),
    waitForTerminal: vi.fn(async () => ({ satisfied: true, status: 'idle' })),
    sendTerminalAgentPrompt: vi.fn(
      async (_handle: string, _text: string, _options: unknown) => ({})
    )
  }
}

describe('D14 service-only Control Plane worker start', () => {
  let db: OrchestrationDb
  let run: RunRow
  let task: TaskRow
  let stub: ReturnType<typeof runtimeFixture>
  let runtime: OrcaRuntimeService

  beforeEach(() => {
    vi.clearAllMocks()
    db = new OrchestrationDb(':memory:')
    run = db.createRun({
      objective: 'M2-01 adapter contract',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: sessionId
    })
    task = db.createTask({ spec: 'Execute the Mission Task', deps: [], runId: run.id })
    stub = runtimeFixture()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the listed host I/O methods are reached; all placement and dispatch lifecycle code uses the real in-memory DB, with no process launch.
    runtime = stub as unknown as OrcaRuntimeService
  })
  afterEach(() => db.close())

  function start(overrides: Partial<Parameters<typeof startLocalWorker>[0]> = {}) {
    return startLocalWorker({
      runtime,
      db,
      run,
      existingTask: task,
      coordinator: caller,
      callerSession: caller,
      params: { from: caller.address, task: task.id, agent: 'claude' },
      mode: terminalMode,
      ...overrides
    })
  }

  function rows() {
    return db.db.prepare('SELECT * FROM dispatch_contexts ORDER BY rowid').all()
  }

  it('preserves baseline creator, depth, lineage and preamble without controlPlane', async () => {
    const params = { from: caller.address, task: task.id, worktree: 'new-child', name: 'legacy' }
    const creator = resolveDispatchCreator(runtime, params.from, caller)
    const depth = db.resolveChildDispatchDepth(creator, runtime.getNestedWorkerMaxDepth())
    const create = vi.spyOn(db, 'createStartingWorkerDispatch')
    const authority = vi.spyOn(db, 'prepareStartingWorkerAuthority')
    expect(await start({ params })).toMatchObject({ state: 'ready' })
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      creator,
      maxDepth: runtime.getNestedWorkerMaxDepth()
    })
    expect(authority).toHaveReturnedWith(undefined)
    const started = create.mock.results[0]?.value
    const recorded = recordedCreatorIdentity(creator)
    expect(db.getDispatchContextById(started.dispatch.id)).toMatchObject({
      depth,
      creator_handle: recorded.creatorHandle,
      creator_pane_key: recorded.creatorPaneKey,
      creator_orca_session_id: recorded.creatorOrcaSessionId
    })
    expect(stub.createManagedWorktree.mock.calls[0]?.[0].lineage?.callerTerminalHandle).toBe(
      params.from
    )
    expect(stub.sendTerminalAgentPrompt).toHaveBeenCalledExactlyOnceWith(
      'term_worker',
      buildDispatchPreamble({
        canDispatchSubWorkers: depth < runtime.getNestedWorkerMaxDepth(),
        taskId: task.id,
        dispatchId: started.dispatch.id,
        taskSpec: task.spec,
        coordinatorHandle: params.from,
        workerHandle: 'term_worker',
        devMode: undefined,
        cliCommand: 'axiom'
      }),
      { ...dispatchPreambleSendOptions(started.dispatch.id), beforeWrite: expect.any(Function) }
    )
    expect(observeWorkerTurnStart).toHaveBeenCalledOnce()
  })

  it('persists a system creator and depth one despite a session caller and nonempty from', async () => {
    const create = vi.spyOn(db, 'createStartingWorkerDispatch')
    expect(
      await start({ controlPlane: { dispatchCreator: { kind: 'system' }, dispatchMaxDepth: 1 } })
    ).toMatchObject({ state: 'ready', taskId: task.id })
    expect(create.mock.calls[0]?.[0]).toMatchObject({ creator: { kind: 'system' }, maxDepth: 1 })
    expect(db.getDispatchContextById(create.mock.results[0]?.value.dispatch.id)).toMatchObject({
      task_id: task.id,
      run_id: run.id,
      depth: 1,
      creator_dispatch_id: null,
      creator_handle: null,
      creator_pane_key: null,
      creator_orca_session_id: null
    })
    expect(stub.showTerminal).not.toHaveBeenCalled()
    expect(stub.sendTerminalAgentPrompt.mock.calls[0]?.[1]).not.toContain('=== SUB-DISPATCH ===')
  })

  it.each([undefined, 'current'])(
    'reuses the exact precreated worktree with selector %s',
    async (worktree) => {
      const receipt = await start({
        params: { from: caller.address, task: task.id, worktree },
        controlPlane: { worktreeId: 'repo::attempt', branchNameOverride: 'unused' }
      })
      expect(stub.showManagedTerminalWorkspace).toHaveBeenCalledExactlyOnceWith('id:repo::attempt')
      expect(stub.createTerminal).toHaveBeenCalledWith('id:repo::attempt', expect.anything())
      expect(stub.showManagedWorktree).not.toHaveBeenCalled()
      expect(stub.createManagedWorktree).not.toHaveBeenCalled()
      expect(receipt).toMatchObject({
        state: 'ready',
        effects: expect.arrayContaining([
          { kind: 'worktree', action: 'reused', id: 'repo::attempt' }
        ])
      })
    }
  )

  it.each(['new-child', 'new-top-level', 'id:other'])(
    'refuses conflicting %s before any DB write',
    async (worktree) => {
      const before = db.db.prepare('SELECT total_changes() AS writes').get()
      await expect(
        start({
          params: { from: caller.address, task: task.id, worktree, name: 'conflict' },
          controlPlane: { worktreeId: 'repo::attempt' }
        })
      ).rejects.toMatchObject({ code: 'invalid_argument' })
      expect(rows()).toHaveLength(0)
      expect(db.db.prepare('SELECT total_changes() AS writes').get()).toEqual(before)
      expect(stub.createManagedWorktree).not.toHaveBeenCalled()
    }
  )

  it('surfaces the managed workspace error before dispatch creation', async () => {
    const error = new Error('managed workspace missing')
    stub.showManagedTerminalWorkspace.mockRejectedValueOnce(error)
    await expect(start({ controlPlane: { worktreeId: 'missing' } })).rejects.toBe(error)
    expect(stub.showManagedTerminalWorkspace).toHaveBeenCalledWith('id:missing')
    expect(rows()).toHaveLength(0)
  })

  it.each(['new-child', 'new-top-level'])(
    'forwards branch override and handle-less lineage for %s',
    async (worktree) => {
      expect(
        await start({
          params: { from: caller.address, task: task.id, worktree, name: 'attempt' },
          controlPlane: { branchNameOverride: `axiom/attempt/${task.id}/1`, callerIdentity: caller }
        })
      ).toMatchObject({ state: 'ready' })
      expect(stub.createManagedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          branchNameOverride: `axiom/attempt/${task.id}/1`,
          lineage: {
            parentWorktree: worktree === 'new-child' ? caller.workspaceId : undefined,
            noParent: worktree === 'new-top-level',
            callerTerminalHandle: undefined
          }
        })
      )
    }
  )

  it('uses a supplied terminal identity instead of the session address for lineage', async () => {
    await start({
      params: { from: caller.address, task: task.id, worktree: 'new-child', name: 'attempt' },
      controlPlane: { callerIdentity: { ...caller, terminalHandle: 'term_parent' } }
    })
    expect(stub.createManagedWorktree.mock.calls[0]?.[0].lineage?.callerTerminalHandle).toBe(
      'term_parent'
    )
  })

  it.each([terminalMode, structuredMode])(
    'delivers custom preamble over $mode with no sub-workers at depth one',
    async (mode) => {
      const preambleBuilder = vi.fn(() => 'Control Plane ContextPackage and attempt recipes')
      expect(
        await start({
          mode,
          controlPlane: {
            dispatchCreator: { kind: 'system' },
            dispatchMaxDepth: 1,
            preambleBuilder
          }
        })
      ).toMatchObject({ state: 'ready', turnStart: 'observed' })
      expect(preambleBuilder).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          canDispatchSubWorkers: false,
          taskId: task.id,
          taskSpec: task.spec,
          coordinatorHandle: caller.address,
          workerHandle:
            mode.mode === 'structured' ? 'orca_session_id:session_worker' : 'term_worker'
        })
      )
      if (mode.mode === 'structured') {
        expect(sendStructuredWorkerPreamble).toHaveBeenCalledWith(
          expect.objectContaining({
            preamble: preambleBuilder.mock.results[0]?.value
          })
        )
        expect(stub.sendTerminalAgentPrompt).not.toHaveBeenCalled()
      } else {
        expect(stub.sendTerminalAgentPrompt.mock.calls[0]?.[1]).toBe(
          preambleBuilder.mock.results[0]?.value
        )
        expect(observeWorkerTurnStart).toHaveBeenCalledOnce()
      }
    }
  )

  it.each([1, 3])('cannot widen the runtime depth cap %s', async (runtimeDepth) => {
    stub.getNestedWorkerMaxDepth.mockReturnValue(runtimeDepth)
    const create = vi.spyOn(db, 'createStartingWorkerDispatch')
    expect(await start({ controlPlane: { dispatchMaxDepth: 10 } })).toMatchObject({
      state: 'ready'
    })
    expect(create.mock.calls[0]?.[0].maxDepth).toBe(runtimeDepth)
    expect(stub.sendTerminalAgentPrompt.mock.calls[0]?.[1].includes('=== SUB-DISPATCH ===')).toBe(
      runtimeDepth > 1
    )
  })

  it('enforces a narrower depth cap before creating any dispatch', async () => {
    await expect(start({ controlPlane: { dispatchMaxDepth: 0 } })).rejects.toMatchObject({
      code: 'nested_worker_depth_exceeded'
    })
    expect(rows()).toHaveLength(0)
  })

  it('retains the dispatch-input failure path when custom preamble delivery fails', async () => {
    const error = new Error('dispatch_preamble_undelivered')
    vi.mocked(sendStructuredWorkerPreamble).mockRejectedValueOnce(error)
    expect(
      await start({ mode: structuredMode, controlPlane: { preambleBuilder: () => 'custom' } })
    ).toMatchObject({ state: 'failed', stage: 'dispatch_input', error })
    expect(observeWorkerTurnStart).not.toHaveBeenCalled()
  })

  it('keeps controlPlane out of WorkerStartParams and strips wire authority claims', () => {
    expect(WorkerStartParams.shape).not.toHaveProperty('controlPlane')
    expect(
      WorkerStartParams.parse({
        from: caller.address,
        task: task.id,
        controlPlane: { dispatchCreator: { kind: 'system' } }
      })
    ).toEqual({ from: caller.address, task: task.id })
  })
})
