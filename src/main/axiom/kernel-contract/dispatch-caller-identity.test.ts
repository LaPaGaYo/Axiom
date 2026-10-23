import { formatOrcaSessionAddress } from '../../../shared/orca-session-address'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { WorkerStartParams } from '../../../shared/rpc-contract/orchestration-worker-start-params'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/orchestration-caller-identity'
import { buildDispatchPreamble } from '../../runtime/orchestration/preamble'
import { resolveDispatchCallerWorktreeId } from '../../runtime/rpc/methods/orchestration-caller-workspace'
import { resolveDispatchCreator } from '../../runtime/rpc/methods/orchestration/runs/dispatch-creator'
import { assertExplicitWorkerTerminalUsable } from '../../runtime/rpc/methods/orchestration/worker/explicit-worker-terminal-validation'
import { resolveOrchestrationSessionCaller } from '../../runtime/rpc/orchestration-session-caller'

vi.mock('../../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({
    deps: { store: { getRecord: () => null, listRecords: () => [] } }
  })
}))

describe('D14 in-process dispatch caller identity', () => {
  let db: OrchestrationDb
  const sessionId = testOrcaSessionId('axiom-mission-dispatch-contract')
  const caller: OrchestrationSessionCaller = {
    address: formatOrcaSessionAddress(sessionId),
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: sessionId,
    sessionId,
    workspaceId: 'repo::mission'
  }
  // Same small runtime-stub pattern as orchestration-structured-worker-start-failure.test.ts.
  const runtimeStub = {
    showTerminal: vi.fn(() => {
      throw new Error('Synthetic caller has no terminal')
    }),
    getTerminalPaneKey: vi.fn(() => null),
    getOrchestrationDispatchAuthority: vi.fn(() => undefined),
    ensureStructuredAgentSessionHost: vi.fn(async () => {}),
    getOrchestrationDb: () => db
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only no-caller/session branches are exercised; terminal access fails loudly and no runtime is started.
  const runtime = runtimeStub as unknown as OrcaRuntimeService

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    vi.clearAllMocks()
  })

  afterEach(() => db.close())

  it('selects system only when no from address is supplied', () => {
    expect(resolveDispatchCreator(runtime, undefined, undefined)).toEqual({ kind: 'system' })
    expect(resolveDispatchCreator(runtime, undefined, caller)).toEqual({ kind: 'system' })
    expect(resolveDispatchCreator(runtime, caller.address, caller)).toEqual({
      kind: 'session',
      orcaSessionId: sessionId
    })
    expect(runtimeStub.getOrchestrationDispatchAuthority).not.toHaveBeenCalled()
  })

  it('uses the synthetic caller workspace without looking up a terminal', async () => {
    expect(await resolveDispatchCallerWorktreeId(runtime, caller.address, caller)).toBe(
      caller.workspaceId
    )
    expect(runtimeStub.showTerminal).not.toHaveBeenCalled()
    expect(runtimeStub.getOrchestrationDispatchAuthority).not.toHaveBeenCalled()
  })

  it.each(['system', 'session'] as const)(
    'persists a depth-one %s creator on a Mission Run',
    (kind) => {
      const run = db.createRun({
        objective: 'Scheduler root Attempt',
        coordinatorHandle: null,
        coordinatorPaneKey: null,
        coordinatorOrcaSessionId: sessionId
      })
      const started = db.createStartingWorkerDispatch({
        creator: kind === 'system' ? { kind } : { kind, orcaSessionId: sessionId },
        maxDepth: 1,
        taskSpec: 'Execute a Mission Task',
        taskRunId: run.id,
        startOptions: {}
      })
      expect(db.getDispatchContextById(started.dispatch.id)).toMatchObject({
        run_id: run.id,
        task_id: started.task.id,
        depth: 1,
        creator_dispatch_id: null,
        creator_handle: null,
        creator_pane_key: null,
        creator_orca_session_id: kind === 'system' ? null : sessionId
      })
      expect(db.getWorkerDispatch(started.dispatch.id)?.state).toBe('starting')
      expect(started.task).toMatchObject({
        run_id: run.id,
        status: 'dispatched',
        created_by_terminal_handle: null,
        created_by_pane_key: null,
        created_by_process_incarnation: null
      })
    }
  )

  it('requires from in the shared schema but accepts a session address in-process', () => {
    const missing = WorkerStartParams.safeParse({ spec: 'Mission Task' })
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['from'], message: 'Missing --from' })
        ])
      )
    }
    expect(WorkerStartParams.parse({ from: caller.address, spec: 'Mission Task' })).toEqual({
      from: caller.address,
      spec: 'Mission Task'
    })
  })

  it('refuses the synthetic id at the RPC session-record boundary', async () => {
    await expect(
      resolveOrchestrationSessionCaller(
        runtime,
        {
          id: 'synthetic-claim',
          authToken: 'test-only',
          method: 'orchestration.workerStart',
          params: { spec: 'Mission Task' },
          orchestrationCompatibilityEvidence: { agentSessionId: sessionId }
        },
        undefined
      )
    ).rejects.toMatchObject({
      code: 'session_caller_unknown',
      data: { effectsApplied: false }
    })
  })

  it('validates an explicit worker terminal without showing the synthetic coordinator', async () => {
    const terminalRuntime = {
      showTerminal: vi.fn(async (handle: string) => {
        if (handle !== 'term_worker') {
          throw new Error('Only the worker has a terminal')
        }
        return { handle, worktreeId: 'repo::attempt' }
      }),
      getTerminalPaneKey: vi.fn((handle: string) =>
        handle === 'term_worker' ? 'pane_worker' : null
      ),
      isTerminalRunningAgent: vi.fn(async () => true)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the validator reads only these three runtime methods and the supplied handle/worktree fields; no terminal is created.
    const validationRuntime = terminalRuntime as unknown as OrcaRuntimeService
    await expect(
      assertExplicitWorkerTerminalUsable({
        runtime: validationRuntime,
        terminal: 'term_worker',
        from: caller.address,
        coordinator: caller,
        resolvedWorktreeId: 'repo::attempt'
      })
    ).resolves.toBeUndefined()
    expect(terminalRuntime.showTerminal).toHaveBeenCalledExactlyOnceWith('term_worker')
    expect(terminalRuntime.getTerminalPaneKey).toHaveBeenCalledWith(caller.address)
  })

  it('exposes session wording and legacy worker verbs even with the axiom CLI name', () => {
    const prompt = buildDispatchPreamble({
      taskId: 'task_contract',
      dispatchId: 'dispatch_contract',
      taskSpec: 'Mission Task',
      coordinatorHandle: caller.address,
      workerHandle: 'term_worker',
      cliCommand: 'axiom'
    })
    expect(prompt).toContain(`Your coordinator's Axiom session ID is: ${caller.address}`)
    expect(prompt).toContain('axiom orchestration send')
    expect(prompt).not.toContain('axiom attempt submit')
  })
})
