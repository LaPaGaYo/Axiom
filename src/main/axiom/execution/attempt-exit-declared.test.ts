import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { settleDeclaredAttempt } from './attempt-settlement'
import { RecoveryService } from '../recovery/recovery-service'
import { getAxiomControlPlane } from '../control-plane'
import * as files from './headless-attempt-files'
import * as git from '../../git/runner'

let f: ReturnType<typeof submissionFixture>
let root: string
const declarations = [
  { outcome: 'blocked', reason: 'blocked_by_scope', paths: ['src/legacy.test.ts'] },
  { outcome: 'no_change', reason: 'candidate_already_correct' },
  { outcome: 'no_change', reason: 'cannot_reproduce' }
] as const
async function declare(outcome: unknown, fields: Record<string, unknown> = {}) {
  const { filesChanged: _files, ...headlessReport } = report
  await writeFile(
    path.join(root, 'last-message.md'),
    `\`\`\`json\n${JSON.stringify({ ...headlessReport, outcome, ...fields })}\n\`\`\``
  )
}
beforeEach(async () => {
  f = submissionFixture()
  root = await mkdtemp(path.join(tmpdir(), 'axiom-declared-'))
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
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: '', stderr: '' })
})
afterEach(async () => {
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it.each(declarations)(
  'settles $reason once with a pending message and no snapshot or retry',
  async (outcome) => {
    const candidate = f.store.insertCandidate({
      id: 'previous-candidate',
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      attemptId: 'previous-attempt',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      status: 'ACTIVE',
      supersededBy: null
    })
    await declare(outcome, {
      questions: ['May I edit the missing path?'],
      followUps: ['Add coverage']
    })
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('declared')
    const failures = f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'attempt.failed')
    expect(failures).toHaveLength(1)
    const artifact = f.store.listArtifacts({ missionId: f.mission.id, kind: 'worker_report' })[0]
    const reportArtifact = f.put.mock.calls.find(([input]) => input.kind === 'worker_report')?.[0]
    expect(reportArtifact?.content.toString()).toContain('May I edit the missing path?')
    expect(reportArtifact?.content.toString()).toContain('Add coverage')
    const paths = 'paths' in outcome ? [...outcome.paths] : []
    expect(failures[0]).toMatchObject({
      actor: 'AttemptSettlement',
      objectKind: 'attempt',
      objectId: f.t01.attemptId,
      after: {
        taskId: f.t01.taskId,
        reason: 'process_exited',
        evidence: 'exit_code',
        exitCode: 0,
        settlement: {
          kind: outcome.outcome,
          reason: outcome.reason,
          ...('paths' in outcome ? { paths } : {})
        },
        candidate: { id: candidate.id, commitSha: candidate.commitSha, treeSha: candidate.treeSha },
        worktreeChanged: 0,
        reportArtifactId: artifact.id,
        artifactIds: [],
        reportSummary: report.summary,
        limitations: report.limitations,
        lastMessageExcerpt: expect.stringContaining(outcome.reason),
        providerSessionId: 'provider-thread',
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 12 }
      }
    })
    const messages = f.store.listMessages({
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      pendingOnly: true
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'BLOCKED',
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      summary: expect.stringContaining(`Attempt 1 declared ${outcome.reason}`),
      blocked: { reason: outcome.reason, paths },
      pending: true,
      artifactIds: [artifact.id],
      related: { taskIds: [f.t01.taskId] }
    })
    expect(
      f.db.getUnreadRunMailbox(f.mission.runId).find((message) => message.id === messages[0].id)
    ).toMatchObject({
      from_handle: `dispatch:${f.t01.attemptId}`,
      to_handle: `run:${f.mission.runId}`,
      body: report.summary
    })
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((e) => e.event === 'task.stage' && e.objectId === f.t01.taskId)
        .slice(-2)
        .map((e) => e.after)
    ).toMatchObject([
      {
        stage: 'NEEDS_FIX',
        reason: outcome.outcome === 'blocked' ? 'attempt_blocked' : 'attempt_no_change'
      },
      { stage: 'BLOCKED', reason: outcome.outcome === 'blocked' ? 'scope' : 'candidate_disputed' }
    ])
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('BLOCKED')
    expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('failed')
    expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('failed')
    expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
    expect(f.store.listCandidates(f.mission.id)).toEqual([candidate])
    expect(f.snapshotGit).not.toHaveBeenCalled()
    const before = f.snapshot()
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('unchanged')
    expect(f.snapshot()).toEqual(before)
    if (outcome.outcome === 'blocked') {
      console.info('M3-04b observed:', JSON.stringify({ audit: failures[0], message: messages[0] }))
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  }
)

it('records a changed worktree as evidence and still creates no Candidate', async () => {
  vi.mocked(git.gitExecFileAsync).mockResolvedValue({
    stdout: ' M src/a.ts\n?? src/b.ts\n',
    stderr: ''
  })
  await declare(declarations[0])
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('declared')
  expect(
    f.store.listAuditEvents({ missionId: f.mission.id }).find((e) => e.event === 'attempt.failed')
      ?.after
  ).toMatchObject({ worktreeChanged: 2 })
  expect(f.store.listCandidates(f.mission.id)).toEqual([])
  expect(f.snapshotGit).not.toHaveBeenCalled()
  expect(git.gitExecFileAsync).toHaveBeenCalledWith(['status', '--porcelain'], { cwd: root })
})
it('ingests declared artifacts and links them from both the audit and pending message', async () => {
  await mkdir(path.join(root, '.axiom', 'artifacts'), { recursive: true })
  await writeFile(path.join(root, '.axiom', 'artifacts', 'proof.txt'), 'failure evidence')
  await declare(declarations[0], {
    artifacts: [{ path: '.axiom/artifacts/proof.txt', kind: 'evidence', mediaType: 'text/plain' }]
  })
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('declared')
  const evidence = f.store.listArtifacts({ missionId: f.mission.id, kind: 'evidence' })[0]
  expect(evidence).toMatchObject({
    createdBy: `attempt:${f.t01.attemptId}`,
    related: [f.t01.taskId, f.t01.attemptId]
  })
  expect(
    f.store.listAuditEvents({ missionId: f.mission.id }).find((e) => e.event === 'attempt.failed')
      ?.after
  ).toMatchObject({ artifactIds: [evidence.id] })
  expect(
    f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })[0].artifactIds
  ).toContain(evidence.id)
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
})
it('keeps an explicit submitted outcome on the normal Submission path', async () => {
  await declare({ outcome: 'submitted' })
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('submitted')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toEqual([])
})
it('reconciles declared outcomes as failed/exited and redacts bounded evidence', async () => {
  const token = `gh${'p_'}${'Z'.repeat(36)}`
  await declare(
    { ...declarations[0], paths: [token] },
    {
      summary: `${token} ${'x'.repeat(2100)}`,
      limitations: Array.from({ length: 25 }, () => `${token} ${'y'.repeat(600)}`)
    }
  )
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: getAxiomControlPlane(f.runtime).artifacts
  })
  expect(await recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'failed', liveness: 'exited' }]
  })
  const audits = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(audits.find((e) => e.event === 'attempt.failed')?.after).toMatchObject({
    settlement: { paths: ['[REDACTED]'] },
    reportSummary: `[REDACTED] ${'x'.repeat(1989)}`,
    limitations: Array.from({ length: 20 }, () => `[REDACTED] ${'y'.repeat(489)}`)
  })
  expect(JSON.stringify(audits)).not.toContain(token)
  expect(JSON.stringify(f.store.listMessages({ missionId: f.mission.id }))).not.toContain(token)
})
it.each([undefined, { message: 'Turn crashed' }])(
  'keeps a failed turn on the failure path with exit zero (%s)',
  async (error) => {
    await declare(declarations[0])
    await writeFile(
      path.join(root, 'events.jsonl'),
      JSON.stringify({ type: 'turn.failed', ...(error ? { error } : {}) })
    )
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
    expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toEqual([])
  }
)
it.each(['stale', 'submitted'])('fences declared settlement with a %s binding', (mode) => {
  const binding = f.store.getAttemptBindingByDispatch(f.t01.attemptId)!
  if (mode === 'stale') {
    f.store.insertAttemptBinding({ ...binding, seq: 2, dispatchId: null })
  } else {
    f.store.insertSubmission({
      id: 'existing',
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      candidateId: 'candidate',
      report
    })
  }
  const before = f.snapshot()
  expect(
    settleDeclaredAttempt(f, {
      ...binding,
      dispatchId: f.t01.attemptId,
      outcome: { ...declarations[0], paths: [...declarations[0].paths] },
      actor: 'AttemptSettlement'
    })
  ).toEqual({ settled: false })
  expect(f.snapshot()).toEqual(before)
})

it('redacts provider event strings before persisting declared audit evidence', async () => {
  const token = `gh${'p_'}${'Z'.repeat(36)}`
  await declare(declarations[0])
  await writeFile(
    path.join(root, 'events.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: token })
  )
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('declared')
  const audits = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(audits.find((e) => e.event === 'attempt.failed')?.after).toMatchObject({
    providerSessionId: '[REDACTED]'
  })
  expect(JSON.stringify(audits)).not.toContain(token)
})
