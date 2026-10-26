import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { stopHeadlessAttemptWatchers, submitExitedAttempt } from './attempt-exit-submission'
import { getAxiomControlPlane } from '../control-plane'
import { RecoveryService } from '../recovery/recovery-service'
import * as files from './headless-attempt-files'
import * as git from '../../git/runner'
import * as e2e from '../../e2e-config'

let f: ReturnType<typeof submissionFixture>
let root: string
beforeEach(async () => {
  f = submissionFixture()
  root = await mkdtemp(path.join(tmpdir(), 'axiom-exit-'))
  vi.spyOn(files, 'headlessAttemptDirectory').mockReturnValue(root)
  f.db.db
    .prepare(
      'UPDATE worker_dispatches SET start_options = ?, worktree_id = ? WHERE dispatch_id = ?'
    )
    .run(JSON.stringify({ channel: 'headless' }), `repo::${root}`, f.t01.attemptId)
  await writeFile(
    path.join(root, 'launch.json'),
    JSON.stringify({
      baselineSha: 'c'.repeat(40),
      worktreeId: `repo::${root}`,
      branch: f.store.getAttemptBindingByDispatch(f.t01.attemptId)!.branch
    })
  )
  await writeFile(path.join(root, 'exit-code'), '0\n')
  await writeFile(
    path.join(root, 'events.jsonl'),
    [
      { type: 'thread.started', thread_id: 'provider-thread' },
      {
        type: 'turn.completed',
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 12 }
      }
    ]
      .map((e) => JSON.stringify(e))
      .join('\n')
  )
  const { filesChanged: _files, ...headlessReport } = report
  await writeFile(
    path.join(root, 'last-message.md'),
    `Done\n\`\`\`json\n${JSON.stringify(headlessReport)}\n\`\`\``
  )
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: 'actual.ts\u0000', stderr: '' })
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
it('submits exactly once, with computed paths, attributed report, usage and session id', async () => {
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('submitted')
  const submission = f.store.getSubmissionByDispatch(f.t01.attemptId)!
  expect(submission.report.filesChanged).toEqual(['actual.ts'])
  expect(f.store.getArtifact(submission.report.artifacts[0])).toMatchObject({
    kind: 'worker_report',
    createdBy: `attempt:${f.t01.attemptId}`,
    related: [f.t01.taskId, f.t01.attemptId]
  })
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.submitted',
      after: expect.objectContaining({
        providerSessionId: 'provider-thread',
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 12 }
      })
    })
  )
  const before = f.snapshot()
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('unchanged')
  expect(f.snapshot()).toEqual(before)
  expect(f.snapshotGit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ headless: true }))
})
it('ingests Worker artifacts confined to .axiom/artifacts with Attempt attribution', async () => {
  await mkdir(path.join(root, '.axiom', 'artifacts'), { recursive: true })
  await writeFile(path.join(root, '.axiom', 'artifacts', 'proof.txt'), 'evidence')
  const { filesChanged: _files, ...headlessReport } = report
  await writeFile(
    path.join(root, 'last-message.md'),
    `\`\`\`json\n${JSON.stringify({ ...headlessReport, artifacts: [{ path: '.axiom/artifacts/proof.txt', kind: 'evidence', mediaType: 'text/plain' }] })}\n\`\`\``
  )
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(f.store.listArtifacts({ missionId: f.mission.id, kind: 'evidence' })).toEqual([
    expect.objectContaining({
      createdBy: `attempt:${f.t01.attemptId}`,
      related: [f.t01.taskId, f.t01.attemptId]
    })
  ])
})
it.each([
  ['7\n', 'failed'],
  ['0\n', 'invalid_report']
] as const)('settles %s without a submission', async (code, reason) => {
  await writeFile(path.join(root, 'exit-code'), code)
  if (reason === 'invalid_report') {
    await writeFile(path.join(root, 'last-message.md'), 'not a report')
  }
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
  const event = f.store
    .listAuditEvents({ missionId: f.mission.id })
    .find((e) => e.event === 'attempt.failed')
  expect(event?.after).toMatchObject({
    exitCode: Number(code),
    settlement: { kind: 'failed' },
    ...(reason === 'invalid_report' ? { reportError: expect.stringContaining('report') } : {})
  })
  const before = f.snapshot()
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(f.snapshot()).toEqual(before)
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)).toMatchObject({
    event: 'attempt.terminal_released',
    objectId: f.t01.attemptId,
    after: { reason: 'attempt_failed' }
  })
})
it('classifies an exit before any event as interrupted', async () => {
  await writeFile(path.join(root, 'events.jsonl'), '')
  await writeFile(path.join(root, 'exit-code'), '1')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
})
it('records the error event and redacts failure evidence before persistence', async () => {
  const token = `${'gh' + 'p_'}${'X'.repeat(36)}`
  await writeFile(path.join(root, 'exit-code'), '1')
  await writeFile(
    path.join(root, 'events.jsonl'),
    JSON.stringify({ type: 'turn.failed', error: { message: `Authentication failed ${token}` } })
  )
  await writeFile(path.join(root, 'last-message.md'), `Failure ${token}`)
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  const event = f.store
    .listAuditEvents({ missionId: f.mission.id })
    .find((row) => row.event === 'attempt.failed')
  expect(event?.after).toMatchObject({
    lastErrorEvent: { type: 'turn.failed', message: 'Authentication failed [REDACTED]' },
    lastMessageExcerpt: 'Failure [REDACTED]'
  })
  expect(JSON.stringify(event)).not.toContain(token)
})
it('serializes concurrent watcher and reconciliation submissions', async () => {
  expect(
    await Promise.all([
      submitExitedAttempt(f.runtime, f.t01.attemptId),
      submitExitedAttempt(f.runtime, f.t01.attemptId)
    ])
  ).toEqual(['submitted', 'unchanged'])
  expect(f.snapshotGit).toHaveBeenCalledOnce()
  await vi.runAllTimersAsync()
  expect(f.releaseWorker).toHaveBeenCalledOnce()
})
it('recovers a durable exit file after restart exactly once without shell-foreground evidence', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
    .run('previous-runtime', f.t01.attemptId)
  const probe = vi.spyOn(f.runtime, 'confirmTerminalShellForeground')
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: getAxiomControlPlane(f.runtime).artifacts,
    now: () => Date.parse('2026-10-25T12:00:00.000Z')
  })
  expect(await recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'submitted', liveness: 'exited' }]
  })
  await recovery.reconcileAttempts()
  expect(f.snapshotGit).toHaveBeenCalledOnce()
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((row) => row.event === 'attempt.submitted')
  ).toHaveLength(1)
  expect(probe).not.toHaveBeenCalled()
})
it('keeps headless Workers running without an exit file even if the shell is foreground', async () => {
  await rm(path.join(root, 'exit-code'))
  vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(true)
  vi.spyOn(f.runtime, 'getTerminalLivenessVerdict').mockReturnValue({ status: 'live', ptyIds: [] })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: getAxiomControlPlane(f.runtime).artifacts
  })
  await recovery.reconcileAttempts()
  expect(f.runtime.confirmTerminalShellForeground).not.toHaveBeenCalled()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
})
it('records a missing report without submitting a candidate', async () => {
  await rm(path.join(root, 'last-message.md'))
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.failed',
      after: expect.objectContaining({ reportError: expect.stringContaining('report') })
    })
  )
})
it('rejects artifact symlinks outside .axiom/artifacts without reading their contents', async () => {
  await mkdir(path.join(root, '.axiom', 'artifacts'), { recursive: true })
  await writeFile(path.join(root, 'outside.txt'), 'outside evidence')
  await symlink(path.join(root, 'outside.txt'), path.join(root, '.axiom', 'artifacts', 'proof.txt'))
  const { filesChanged: _files, ...headlessReport } = report
  await writeFile(
    path.join(root, 'last-message.md'),
    `\`\`\`json\n${JSON.stringify({ ...headlessReport, artifacts: [{ path: '.axiom/artifacts/proof.txt', kind: 'evidence', mediaType: 'text/plain' }] })}\n\`\`\``
  )
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
  expect(f.store.listArtifacts({ missionId: f.mission.id, kind: 'evidence' })).toEqual([])
})
it('refuses stale binding ownership without making a candidate or changing state', async () => {
  f.store.insertAttemptBinding({
    ...f.store.getAttemptBindingByDispatch(f.t01.attemptId)!,
    seq: 2,
    dispatchId: null,
    branch: `axiom/attempt/${f.t01.taskId}/2`
  })
  const before = f.snapshot()
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('unchanged')
  expect(f.snapshot()).toEqual(before)
  expect(f.snapshotGit).not.toHaveBeenCalled()
})
it('accepts a valid completion after a transient reconnect error', async () => {
  await writeFile(
    path.join(root, 'events.jsonl'),
    [
      { type: 'thread.started', thread_id: 'reconnected' },
      { type: 'error', message: 'Reconnecting 1/5' },
      {
        type: 'turn.completed',
        usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 4 }
      }
    ]
      .map((e) => JSON.stringify(e))
      .join('\n')
  )
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('submitted')
})

it.each(['not_requested', 'retained', 'requested'])(
  'holds failed releases and recovers a lost timer once from %s after a later Task completes',
  async (releaseState) => {
    vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: true })
    vi.stubEnv('AXIOM_E2E_HOLD_WORKER_RELEASE', '1')
    await writeFile(path.join(root, 'exit-code'), '7')
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
    vi.clearAllTimers()
    f.db.db
      .prepare("UPDATE audit_events SET created_at = ? WHERE event = 'attempt.failed'")
      .run('2026-10-25T12:00:00.000Z')
    f.db.db
      .prepare("UPDATE task_stages SET stage = 'INTEGRATED' WHERE task_id = ?")
      .run(f.t01.taskId)
    f.db.db
      .prepare('UPDATE worker_terminal_resources SET release_state = ? WHERE owner_dispatch_id = ?')
      .run(releaseState, f.t01.attemptId)
    let now = Date.parse('2026-10-25T12:00:59.999Z')
    const recovery = new RecoveryService(f.db, f.store, f.missions, {
      runtime: f.runtime,
      artifacts: getAxiomControlPlane(f.runtime).artifacts,
      now: () => now
    })
    await recovery.reconcileAttempts()
    expect(f.releaseWorker).not.toHaveBeenCalled()
    vi.stubEnv('AXIOM_E2E_HOLD_WORKER_RELEASE', '')
    await recovery.reconcileAttempts()
    expect(f.releaseWorker).not.toHaveBeenCalled()
    now += 1
    f.releaseWorker.mockImplementationOnce(async (_runtime, dispatchId) => {
      f.db.db
        .prepare(
          "UPDATE worker_terminal_resources SET release_state = 'released' WHERE owner_dispatch_id = ?"
        )
        .run(dispatchId)
      return {
        dispatchId,
        state: 'released',
        processAction: 'closed_agent_terminal',
        archive: null
      }
    })
    await recovery.reconcileAttempts()
    await recovery.reconcileAttempts()
    expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
    expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)).toMatchObject({
      event: 'attempt.terminal_released',
      after: { reason: 'attempt_failed' }
    })
  }
)
