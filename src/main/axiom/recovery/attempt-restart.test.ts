import * as generated from '../../runtime/orchestration/db/generated-id'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { startAxiomControlPlane, stopAxiomControlPlane } from '../control-plane-boot'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { createAttemptLauncher } from '../execution/attempt-launcher'
import { Scheduler } from '../scheduler/scheduler'
import { projectAttempt } from '../execution/attempt-projection'
import {
  inspectWorkerTerminal,
  projectFleetWorker
} from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { ATTEMPT_RECONCILE_INTERVAL_MS } from './recovery-service'

let directory: string
let db: OrchestrationDb
let runtime: OrcaRuntimeService
afterEach(() => {
  stopAxiomControlPlane(runtime)
  db.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

it('reopens a RUNNING file-DB Attempt without duplicate start, then retries only after durable abandonment', async () => {
  vi.useFakeTimers()
  let nextId = 0
  vi.spyOn(generated, 'generateId').mockImplementation(
    (prefix) => `${prefix}_${String(++nextId).padStart(12, '0')}`
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  directory = mkdtempSync(join(tmpdir(), 'axiom-attempt-restart-'))
  const dbPath = join(directory, 'orchestration.db')
  const f = channelFixture(dbPath)
  db = f.db
  runtime = f.runtime
  let plane = getAxiomControlPlane(runtime)
  const created = f.store.getAttemptBinding(f.t01.taskId, 1)!
  const missionId = f.mission.id
  const taskId = f.t01.taskId
  vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({ admitted: [], skipped: [] })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inspectWorkerTerminal reads only terminal presence and agentWait, with independent identity/liveness spies.
  vi.spyOn(runtime, 'showTerminal').mockResolvedValue({ agentWait: null } as Awaited<
    ReturnType<typeof runtime.showTerminal>
  >)
  vi.spyOn(runtime, 'getTerminalLivenessVerdict').mockReturnValue({ status: 'live', ptyIds: [] })
  plane.store.updateMissionStatus({
    id: missionId,
    from: 'PLANNED',
    to: 'EXECUTING',
    previousStatus: null
  })
  plane.store.upsertPolicy(missionId, { ...plane.store.getPolicy(missionId)!, concurrencyLimit: 1 })
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(plane.store.getTaskStage(taskId)?.stage).toBe('RUNNING')
  stopAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(plane.attemptReconcileTimer).toBeUndefined()
  db.close()

  db = new OrchestrationDb(dbPath)
  runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  vi.spyOn(runtime, 'listManagedWorktrees').mockResolvedValue({
    worktrees: [],
    totalCount: 0,
    truncated: false
  })
  vi.spyOn(runtime, 'showTerminal').mockRejectedValue(new Error('terminal missing after restart'))
  plane = getAxiomControlPlane(runtime)
  const schedule = vi
    .spyOn(plane.scheduler, 'scheduleRound')
    .mockResolvedValue({ admitted: [], skipped: [] })
  const artifacts = new ArtifactStore(plane.store, join(directory, 'artifacts'))
  vi.spyOn(plane.artifacts, 'put').mockImplementation(artifacts.put.bind(artifacts))
  const insert = vi.spyOn(plane.store, 'insertAttemptBinding')
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(plane.store.listAttemptBindings({ missionId, taskId })).toEqual([created])
  expect(
    db.db.prepare('SELECT id FROM dispatch_contexts WHERE task_id = ?').all(taskId)
  ).toHaveLength(1)
  expect(insert).not.toHaveBeenCalled()
  expect(plane.store.getTaskStage(taskId)?.stage).toBe('RUNNING')
  expect(
    await projectAttempt(
      plane.store,
      created,
      (id) => projectFleetWorker(runtime, db, id),
      (id) => inspectWorkerTerminal(runtime, db, id)
    )
  ).toMatchObject({ liveness: 'unverifiable' })
  await vi.advanceTimersByTimeAsync(29 * ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(insert).not.toHaveBeenCalled()
  // Stop the timer before advancing to the boundary; await the complete evidence write explicitly.
  stopAxiomControlPlane(runtime)
  vi.setSystemTime(Date.now() + ATTEMPT_RECONCILE_INTERVAL_MS)
  await plane.recovery.reconcileAttempts()
  expect(db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('abandoned')
  expect(plane.store.getTaskStage(taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(schedule).toHaveBeenCalledWith(missionId, 'stage_change')

  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Frozen fixture rules')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: launcher only consumes the precreated worktree id; the test uses a real kernel dispatch without a host worktree.
  vi.spyOn(runtime, 'createManagedWorktree').mockResolvedValue({
    worktree: { id: 'repo::retry' }
  } as CreateWorktreeResult)
  const launcher = createAttemptLauncher({
    runtime,
    db,
    store: plane.store,
    missions: plane.missions,
    artifacts,
    startWorker: async (args) => {
      const { dispatch } = db.createStartingWorkerDispatch({
        taskId: args.params.task!,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {},
        retryOf: args.params.retryOf
      })
      db.prepareStartingWorkerAuthority({
        dispatchId: dispatch.id,
        handle: 'term_retry',
        paneKey: 'pane_retry',
        processIncarnation: 'retry_process',
        worktreeId: 'repo::retry',
        terminalOwnership: 'created',
        setupState: 'not_applicable',
        effects: []
      })
      db.markWorkerDispatchReady(dispatch.id)
      return { taskId: args.params.task, dispatchId: dispatch.id, state: 'ready' }
    }
  })
  const scheduler = new Scheduler(
    db,
    plane.store,
    plane.missions,
    new ContextBuilder(plane.store, artifacts),
    new AgentFactory(plane.store, plane.decisionEngine, async () => ['codex']),
    { launch: launcher }
  )
  const retry = await scheduler.scheduleRound(missionId, 'manual')
  expect(retry.admitted).toMatchObject([{ taskId, seq: 2 }])
  const next = plane.store.getAttemptBinding(taskId, 2)!
  expect(db.getDispatchContextById(next.dispatchId!)?.retry_of_dispatch_id).toBe(f.t01.attemptId)
  expect(plane.store.getTaskStage(taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 2 })
  console.log(
    '[M2-08 restart rows]',
    JSON.stringify({
      before: { seq: 1, stage: 'RUNNING', worker: 'ready', bindings: 1 },
      reopened: { seq: 1, stage: 'RUNNING', liveness: 'unverifiable', bindings: 1 },
      expired: { seq: 1, stage: 'READY', worker: 'abandoned', bindings: 1 },
      retried: { seq: next.seq, stage: 'RUNNING', bindings: 2, retryLinked: true }
    })
  )
})
