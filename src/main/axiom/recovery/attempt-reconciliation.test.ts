import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactStore } from '../artifacts/artifact-store'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { RecoveryService } from './recovery-service'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { ORCHESTRATION_WORKER_STOP_METHODS } from '../../runtime/rpc/methods/orchestration/worker/worker-stop'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import { RunMailboxConsumer } from '../mission-controller/run-mailbox-consumer'
import { ORCHESTRATION_WORKER_LIST_METHOD } from '../../runtime/rpc/methods/orchestration/worker/worker-list-method'
import * as snapshots from '../execution/candidate-snapshot'
import { report } from '../execution/submission-fixture.test-support'

describe('Attempt recovery', () => {
  let f: ReturnType<typeof channelFixture>
  let root: string
  let recovery: RecoveryService
  let artifacts: ArtifactStore
  let now: number
  beforeEach(() => {
    f = channelFixture()
    root = mkdtempSync(join(tmpdir(), 'axiom-recovery-'))
    artifacts = new ArtifactStore(f.store, root)
    now = Date.now()
    recovery = new RecoveryService(f.db, f.store, f.missions, {
      runtime: f.runtime,
      artifacts,
      now: () => now
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: observation reads only terminal existence and agentWait; liveness and identity are separate spies.
    vi.spyOn(f.runtime, 'showTerminal').mockResolvedValue({ agentWait: null } as Awaited<
      ReturnType<typeof f.runtime.showTerminal>
    >)
    vi.spyOn(f.runtime, 'getTerminalLivenessVerdict').mockReturnValue({
      status: 'live',
      ptyIds: []
    })
    vi.spyOn(f.runtime, 'closeTerminal').mockResolvedValue({
      handle: f.t01.from,
      tabId: 'tab',
      ptyKilled: true
    })
    vi.spyOn(f.runtime, 'inspectTerminalProcessIncarnationLiveness').mockResolvedValue(
      'unverifiable'
    )
  })
  afterEach(() => {
    f.db.close()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })
  const stage = () => f.store.getTaskStage(f.t01.taskId)
  const worker = () => f.db.getWorkerDispatch(f.t01.attemptId)
  const audits = () => f.store.listAuditEvents({ missionId: f.mission.id })
  const facts = () =>
    f.db.getAttemptObservationFacts(f.t01.attemptId).filter((x) => x.facet === 'liveness')
  const unknown = () =>
    vi
      .mocked(f.runtime.getTerminalLivenessVerdict)
      .mockReturnValue({ status: 'unverifiable', reason: 'host disconnected' })

  it('leaves a live Attempt alone, without audit or observation churn', async () => {
    const before = audits()
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('RUNNING')
    expect(audits()).toEqual(before)
    expect(facts()).toEqual([])
  })
  it('settles a proven exit through NEEDS_FIX and READY without counting another Attempt', async () => {
    vi.mocked(f.runtime.getTerminalLivenessVerdict).mockReturnValue({ status: 'exited' })
    const before = audits().length
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('failed')
    expect(stage()).toMatchObject({ stage: 'READY', attemptCount: 1 })
    expect(
      audits()
        .slice(before)
        .map((e) => e.event)
    ).toEqual(['attempt.failed', 'task.stage', 'task.stage'])
    const after = audits()
    await recovery.reconcileAttempts()
    expect(audits()).toEqual(after)
  })
  it('persists one unverifiable clock across ticks and never admits a duplicate', async () => {
    unknown()
    const insert = vi.spyOn(f.store, 'insertAttemptBinding')
    for (let i = 0; i < 3; i++) {
      await recovery.reconcileAttempts()
    }
    expect(stage()?.stage).toBe('RUNNING')
    expect(facts()).toHaveLength(1)
    expect(audits().filter((e) => e.event === 'attempt.unverifiable')).toHaveLength(1)
    expect(insert).not.toHaveBeenCalled()
    expect(f.store.listAttemptBindings({ missionId: f.mission.id })).toHaveLength(1)
  })
  it('abandons at tolerance with content-addressed evidence and allows retry', async () => {
    unknown()
    await recovery.reconcileAttempts()
    now += 30 * 60_000
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('abandoned')
    expect(stage()).toMatchObject({ stage: 'READY', attemptCount: 1 })
    const event = audits().find((e) => e.event === 'attempt.abandoned')!
    expect(event.after).toMatchObject({
      disposition: 'abandoned',
      evidenceArtifactId: expect.any(String)
    })
    const evidence = artifacts.list({ missionId: f.mission.id, kind: 'evidence' })[0]
    expect(evidence.related).toEqual([f.t01.taskId, f.t01.attemptId])
    expect(JSON.parse((await artifacts.read(evidence.id)).content.toString())).toMatchObject({
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      toleranceMinutes: 30,
      since: now - 30 * 60_000,
      abandonedAt: now
    })
    const after = audits()
    await recovery.reconcileAttempts()
    expect(audits()).toEqual(after)
  })
  it('resets the durable tolerance clock only after liveness returns', async () => {
    unknown()
    await recovery.reconcileAttempts()
    now += 29 * 60_000
    vi.mocked(f.runtime.getTerminalLivenessVerdict).mockReturnValue({ status: 'live', ptyIds: [] })
    await recovery.reconcileAttempts()
    unknown()
    now += 2 * 60_000
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('RUNNING')
    expect(facts().map((x) => x.payload)).toEqual([
      { status: 'unverifiable', reason: 'host disconnected' },
      { status: 'live', ptyIds: [] },
      { status: 'unverifiable', reason: 'host disconnected' }
    ])
  })
  it('blocks exhausted retries with previousStage NEEDS_FIX', async () => {
    f.db.db
      .prepare('UPDATE task_stages SET retry_policy = ? WHERE task_id = ?')
      .run(JSON.stringify({ maxAttempts: 1 }), f.t01.taskId)
    vi.mocked(f.runtime.getTerminalLivenessVerdict).mockReturnValue({ status: 'exited' })
    await recovery.reconcileAttempts()
    expect(stage()).toMatchObject({ stage: 'BLOCKED', previousStage: 'NEEDS_FIX', attemptCount: 1 })
    expect(audits().at(-1)?.after).toMatchObject({ reason: 'retry_budget_exhausted' })
  })
  it('stops a live Attempt that exceeded its runtime budget', async () => {
    const task = stage()!
    f.db.db
      .prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?')
      .run(JSON.stringify({ ...task.spec, budget: { maxRuntimeMinutes: 1 } }), task.taskId)
    now += 61_000
    await recovery.reconcileAttempts()
    expect(f.runtime.closeTerminal).toHaveBeenCalledOnce()
    expect(worker()?.state).toBe('stopped')
    expect(stage()?.stage).toBe('READY')
    expect(
      audits()
        .filter((e) => e.event === 'task.stage')
        .at(-2)?.after
    ).toMatchObject({ reason: 'runtime_budget_exceeded' })
  })
  it('settles a kernel-failed Attempt left RUNNING across the crash window', async () => {
    f.db.failDispatch(f.t01.attemptId, 'exit', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('READY')
  })
  it('leaves a fresh pending launch alone and settles an orphan after two readiness windows', async () => {
    f.db.db
      .prepare('UPDATE attempt_bindings SET dispatch_id = NULL WHERE task_id = ?')
      .run(f.t01.taskId)
    const before = audits()
    await recovery.reconcileAttempts()
    expect(audits()).toEqual(before)
    now += 120_001
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('READY')
    expect(audits().filter((e) => e.event === 'attempt.launch_pending_orphan')).toHaveLength(1)
  })
  it('cancels live and unreachable workers through the kernel and records release dispositions', async () => {
    const second = f.bind('T02')
    vi.mocked(f.runtime.getTerminalLivenessVerdict).mockImplementation((handle) =>
      handle === second.from
        ? { status: 'unverifiable', reason: 'disconnected' }
        : { status: 'live', ptyIds: [] }
    )
    const response = await f.call('axiom.mission.cancel', {
      missionId: f.mission.id,
      reason: 'user request'
    })
    expect(response).toMatchObject({
      result: { mission: { status: 'CANCELED' }, attempts: expect.any(Array) }
    })
    expect(f.runtime.closeTerminal).toHaveBeenCalledOnce()
    expect(worker()?.state).toBe('stopped')
    expect(f.db.getWorkerDispatch(second.attemptId)?.state).toBe('abandoned')
    expect(stage()?.stage).toBe('CANCELED')
    expect(f.store.getTaskStage(second.taskId)?.stage).toBe('CANCELED')
    expect(f.db.listLegacyWorkerTerminalRecoveryRows()).toEqual([])
    const listing = new RpcDispatcher({
      runtime: f.runtime,
      methods: [ORCHESTRATION_WORKER_LIST_METHOD]
    })
    expect(
      await listing.dispatch({
        id: 'workers',
        authToken: 'test-caller',
        method: 'orchestration.workerList',
        params: { run: f.mission.runId, terminalState: 'active' }
      })
    ).toMatchObject({ ok: true, result: { workers: [] } })
    const events = audits().filter(
      (e) => e.event === 'attempt.stopped' || e.event === 'attempt.abandoned'
    )
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event.after).toMatchObject({ release: expect.any(Object) })
    }
    const after = audits()
    await recovery.reconcileAttempts()
    expect(audits()).toEqual(after)
  })
  it('allows the local service to stop a Mission worker while the RPC still rejects it', async () => {
    const dispatcher = new RpcDispatcher({
      runtime: f.runtime,
      methods: ORCHESTRATION_WORKER_STOP_METHODS
    })
    expect(
      await dispatcher.dispatch({
        id: 'stop',
        authToken: 'test-caller',
        method: 'orchestration.workerStop',
        params: { dispatch: f.t01.attemptId },
        orchestrationContractVersion: 1
      })
    ).toMatchObject({ ok: false, error: { code: 'mission_managed' } })
    expect(worker()?.state).toBe('ready')
    expect(await stopLocalWorker(f.runtime, f.t01.attemptId)).toMatchObject({ state: 'stopped' })
  })
  it('triggers reconciliation for a bound kernel exit escalation after the batch commits', () => {
    const onEscalation = vi.fn()
    const run = f.db.getRun(f.mission.runId)!
    const consumer = new RunMailboxConsumer(
      f.runtime,
      f.store,
      f.missions,
      { missionId: f.mission.id, runId: run.id, consumerGeneration: run.consumer_generation },
      { onEscalation }
    )
    f.db.insertMessage({
      from: 'system',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'escalation',
      subject: 'worker exit',
      payload: JSON.stringify({ dispatchId: 'unbound' })
    })
    consumer.drain()
    expect(onEscalation).not.toHaveBeenCalled()
    f.db.insertMessage({
      from: 'system',
      to: `run:${run.id}`,
      runId: run.id,
      type: 'escalation',
      subject: 'worker exit',
      payload: JSON.stringify({ dispatchId: f.t01.attemptId })
    })
    consumer.drain()
    expect(onEscalation).toHaveBeenCalledExactlyOnceWith(f.mission.id)
    expect(f.db.hasOutstandingRunDelivery(run.id)).toBe(false)
  })
  it('keeps an unconfirmed stop RUNNING until the unverifiable tolerance expires', async () => {
    f.store.upsertPolicy(f.mission.id, {
      ...f.store.getPolicy(f.mission.id)!,
      budget: { maxRuntimeMinutes: 1 }
    })
    now += 61_000
    vi.mocked(f.runtime.closeTerminal).mockResolvedValue({
      handle: f.t01.from,
      tabId: 'tab',
      ptyKilled: false
    })
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('stop_unknown')
    expect(stage()?.stage).toBe('RUNNING')
    unknown()
    await recovery.reconcileAttempts()
    now += 30 * 60_000
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('abandoned')
    expect(stage()?.stage).toBe('READY')
  })
  it('retains a SUBMITTED terminal left not_requested by a crash after settlement', async () => {
    vi.spyOn(snapshots, 'snapshotCandidate').mockResolvedValue({
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      snapshotCommitted: false
    })
    vi.spyOn(f.db, 'retainWorkerTerminalResource').mockImplementationOnce(() => {
      throw new Error('crash window')
    })
    expect(
      await f.call(
        'axiom.attempt.submit',
        { attemptId: f.t01.attemptId, from: f.t01.from, report },
        { orchestrationCapability: f.t01.capability }
      )
    ).toMatchObject({ ok: true })
    expect(f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)?.release_state).toBe(
      'not_requested'
    )
    await recovery.reconcileAttempts()
    expect(f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)?.release_state).toBe('retained')
    expect(audits().filter((e) => e.event === 'attempt.terminal_retained')).toMatchObject([
      {
        after: {
          taskId: f.t01.taskId,
          submissionId: expect.any(String),
          candidateId: expect.any(String),
          retainDisposition: 'retained'
        }
      }
    ])
    const before = audits()
    await recovery.reconcileAttempts()
    expect(audits()).toEqual(before)
  })
  it('converges after kernel abandonment commits but its Axiom consequence fails', async () => {
    unknown()
    await recovery.reconcileAttempts()
    now += 30 * 60_000
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const transaction = f.store.transaction.bind(f.store)
    const write = vi.spyOn(f.store, 'transaction').mockImplementation((name, operation) => {
      if (name === 'recovery_abandon') {
        throw new Error('interrupted consequence')
      }
      return transaction(name, operation)
    })
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('abandoned')
    expect(stage()?.stage).toBe('RUNNING')
    write.mockRestore()
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('READY')
    expect(audits().find((e) => e.event === 'attempt.abandoned')?.after).toMatchObject({
      evidenceArtifactId: expect.any(String)
    })
  })
  it('rechecks kernel settlement after asynchronous evidence IO instead of reporting a false abandonment', async () => {
    unknown()
    await recovery.reconcileAttempts()
    now += 30 * 60_000
    const put = artifacts.put.bind(artifacts)
    vi.spyOn(artifacts, 'put').mockImplementation(async (input) => {
      const artifact = await put(input)
      f.db.failDispatch(f.t01.attemptId, 'exit during evidence write', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
      return artifact
    })
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('failed')
    expect(stage()?.stage).toBe('READY')
    expect(audits().filter((e) => e.event === 'attempt.abandoned')).toEqual([])
  })
  it('does not let an old settled Attempt settle a newer RUNNING admission', async () => {
    f.db.failDispatch(f.t01.attemptId, 'exit', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    await recovery.reconcileAttempts()
    const old = f.store.getAttemptBinding(f.t01.taskId, 1)!
    f.store.insertAttemptBinding({ ...old, seq: 2, branch: `${old.branch}-2`, dispatchId: null })
    f.store.updateTaskStage({
      taskId: f.t01.taskId,
      from: 'READY',
      to: 'RUNNING',
      attemptCountDelta: 1
    })
    const before = audits()
    await recovery.reconcileAttempts()
    expect(stage()?.stage).toBe('RUNNING')
    expect(audits()).toEqual(before)
  })
  it.each([
    ['starting', 'start_unknown'],
    ['stopping', 'stop_unknown']
  ] as const)(
    'normalizes a %s row from a dead runtime before observing the host',
    async (state, expected) => {
      f.db.db
        .prepare('UPDATE worker_dispatches SET state = ?, runtime_epoch = ? WHERE dispatch_id = ?')
        .run(state, 'old-runtime', f.t01.attemptId)
      vi.mocked(f.runtime.showTerminal).mockRejectedValue(new Error('terminal absent'))
      await recovery.reconcileAttempts()
      expect(worker()?.state).toBe(expected)
      expect(stage()?.stage).toBe('RUNNING')
      expect(facts()).toMatchObject([{ payload: { status: 'unverifiable', reason: 'missing' } }])
    }
  )
  it('awaits an in-flight reconciliation before re-reading durable state', async () => {
    const terminal = await f.runtime.showTerminal(f.t01.from)
    const gate = Promise.withResolvers<typeof terminal>()
    vi.mocked(f.runtime.showTerminal).mockReturnValueOnce(gate.promise)
    const first = recovery.reconcileAttempts()
    const second = recovery.reconcileAttempts({ missionId: f.mission.id })
    expect(f.runtime.showTerminal).toHaveBeenCalledTimes(2) // fixture read plus one in-flight inspection
    gate.resolve(terminal)
    await Promise.all([first, second])
    expect(stage()?.stage).toBe('RUNNING')
    expect(facts()).toEqual([])
  })
  it('retries cancellation of a stop_unknown worker when the host is live again (kernel scope gap)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    f.missions.cancelMission(f.mission.id, 'user request')
    vi.mocked(f.runtime.closeTerminal).mockResolvedValueOnce({
      handle: f.t01.from,
      tabId: 'tab',
      ptyKilled: false
    })
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('stop_unknown')
    await recovery.reconcileAttempts()
    expect(worker()?.state).toBe('stopped')
    expect(f.db.listLegacyWorkerTerminalRecoveryRows()).toEqual([])
  })
})
