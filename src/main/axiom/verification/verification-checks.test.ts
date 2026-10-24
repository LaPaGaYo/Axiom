import { mkdtemp, rm, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verificationGitFixture } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { runVerificationChecks } from './verification-checks'
import { prepareVerification } from './verification-prepare'
import { settleVerificationFailure } from '../execution/attempt-settlement'

let root: string
let f: Awaited<ReturnType<typeof verificationGitFixture>>
let service: VerificationService
const deps = () => ({
  store: f.store,
  missions: f.controller,
  artifacts: f.artifacts,
  runtime: f.runtime,
  runtimeEpoch: 'test-epoch'
})
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-verdict-'))
  f = await verificationGitFixture(root)
  service = new VerificationService(deps())
})
afterEach(async () => {
  await service.stop()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
function commands(requiredEvidence: string[], verificationRules = {}, maxAttempts = 2) {
  const spec = { ...f.task.spec, requiredEvidence }
  f.db.db
    .prepare('UPDATE task_stages SET spec = ?, retry_policy = ? WHERE task_id = ?')
    .run(JSON.stringify(spec), JSON.stringify({ maxAttempts }), f.task.taskId)
  f.store.upsertPolicy(f.missionId, { ...f.store.getPolicy(f.missionId)!, verificationRules })
}
const node = (script: string) => `node -e "${script}"`
const saved = () => f.store.getVerificationRun(f.run.id)!
const events = () => f.store.listAuditEvents({ missionId: f.missionId })

it.each([
  {
    command: node('console.log(1)'),
    status: 'PASS',
    stage: 'VERIFIED',
    reason: 'checks_passed',
    maxAttempts: 2
  },
  {
    command: node("console.error(' FAIL src/a.test.ts > broken');process.exit(1)"),
    status: 'FAIL',
    stage: 'READY',
    reason: 'checks_failed',
    maxAttempts: 2
  },
  {
    command: node('process.exit(1)'),
    status: 'FAIL',
    stage: 'BLOCKED',
    reason: 'checks_failed',
    maxAttempts: 1
  },
  {
    command: 'axiom_check_tool_missing_1243',
    status: 'INCONCLUSIVE',
    stage: 'VERIFYING',
    reason: 'environment',
    maxAttempts: 2
  }
])(
  'settles $status to $stage with evidence before removing the worktree',
  async ({ command, status, stage, reason, maxAttempts }) => {
    commands([command], {}, maxAttempts)
    f.store.insertSubmission({
      id: 'worker-report',
      missionId: f.missionId,
      taskId: f.task.taskId,
      attemptId: f.candidate.attemptId,
      candidateId: f.candidate.id,
      report: {
        summary: 'Everything passed',
        filesChanged: [],
        checksRun: [{ command, result: 'pass' }],
        artifacts: [],
        limitations: [],
        risks: [],
        questions: [],
        followUps: []
      }
    })
    const remove = f.runtime.removeManagedWorktree.getMockImplementation()!
    f.runtime.removeManagedWorktree.mockImplementation(async (selector) => {
      expect(saved().verdictDetail.verdictArtifactId).toEqual(expect.any(String))
      expect(f.artifacts.list({ missionId: f.missionId, kind: 'evidence' })).toHaveLength(2)
      return remove(selector)
    })
    await service.kick()
    expect(saved()).toMatchObject({
      status,
      worktreeId: null,
      commands: [command],
      toolVersions: { node: expect.stringMatching(/^v/) },
      finishedAt: expect.any(String),
      verdictDetail: { phase: 'verdict', verdict: status, reason }
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(stage)
    expect(saved().verdictDetail.evidenceArtifactIds).toHaveLength(2)
    await expect(access(path.join(root, `verify-${f.task.taskId}-1`))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    if (status === 'FAIL') {
      expect(events()).toContainEqual(
        expect.objectContaining({
          event: 'task.stage',
          after: expect.objectContaining({ stage: 'NEEDS_FIX' })
        })
      )
    }
    expect(
      events().filter(
        (event) =>
          event.event ===
          `verification.${status.toLowerCase() === 'pass' ? 'passed' : status.toLowerCase() === 'fail' ? 'failed' : 'inconclusive'}`
      )
    ).toHaveLength(1)
  }
)
it('routes invalid stored policy to human without executing anything', async () => {
  commands([node('process.exit(0)')], { commands: [] })
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'INCONCLUSIVE',
    verdictDetail: { reason: 'policy_invalid', escalation: 'human' }
  })
  expect(f.artifacts.list({ missionId: f.missionId, kind: 'log' })).toEqual([])
})
it('rejects remote repositories without creating or running a local worktree', async () => {
  commands([node('process.exit(0)')])
  f.runtime.showRepo.mockResolvedValue({
    id: 'repo',
    path: '/remote',
    displayName: 'remote',
    badgeColor: '',
    addedAt: 0,
    connectionId: 'ssh-one'
  })
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'INCONCLUSIVE',
    verdictDetail: {
      reason: 'environment',
      detail: 'remote_repository_unsupported',
      escalation: 'human'
    }
  })
  expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
})
it('audits known flaky once and leaves the Task VERIFYING', async () => {
  commands([node("console.error(' FAIL src/a.test.ts > known');process.exit(1)")], {
    knownFlaky: ['src/* > known']
  })
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'INCONCLUSIVE',
    verdictDetail: { reason: 'known_flaky', escalation: 'specialist' }
  })
  expect(events().filter((e) => e.event === 'verification.known_flaky')).toMatchObject([
    { after: { checkIndex: 0, failures: ['src/a.test.ts > known'] } }
  ])
})
it('keeps cleanupPending on a verdict and retries removal on the next kick', async () => {
  commands([node('process.exit(0)')])
  f.runtime.removeManagedWorktree.mockRejectedValueOnce(new Error('busy'))
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'PASS',
    worktreeId: expect.any(String),
    verdictDetail: { cleanupPending: true }
  })
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'PASS',
    worktreeId: null,
    verdictDetail: { cleanupPending: false }
  })
})
it.each(['epoch', 'status'] as const)(
  'a stale %s writes nothing and still removes its worktree',
  async (stale) => {
    commands([node('process.exit(0)')])
    const run = service.claimNext()!
    await prepareVerification(deps(), run)
    const prepared = saved()
    f.store.updateVerificationRun({
      id: run.id,
      expectedStatus: 'RUNNING',
      ...(stale === 'epoch' ? { runtimeEpoch: 'new-epoch' } : { status: 'CANCELED' as const })
    })
    const before = saved()
    const audit = events()
    const artifacts = f.artifacts.list({ missionId: f.missionId })
    await runVerificationChecks(deps(), prepared)
    expect(saved()).toEqual(before)
    expect(events()).toEqual(audit)
    expect(f.artifacts.list({ missionId: f.missionId })).toEqual(artifacts)
    expect(f.runtime.removeManagedWorktree).toHaveBeenCalledWith(`id:${prepared.worktreeId}`, {
      force: true
    })
  }
)
it('failure settlement refuses a changed stage or superseded Candidate without writes', () => {
  expect(
    settleVerificationFailure(deps(), { taskId: f.task.taskId, candidateId: f.candidate.id })
  ).toEqual({ settled: false })
  service.claimNext()
  f.store.supersedeActiveCandidates(f.task.taskId, 'replacement')
  const audit = events()
  expect(
    settleVerificationFailure(deps(), { taskId: f.task.taskId, candidateId: f.candidate.id })
  ).toEqual({ settled: false })
  expect(events()).toEqual(audit)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
})
it('shutdown stops a running check and preserves RUNNING for boot recovery', async () => {
  commands([
    node(
      "const fs=require('node:fs');fs.writeFileSync('writing','start');setInterval(() => fs.appendFileSync('writing','x'), 10)"
    )
  ])
  const flight = service.kick()
  const writing = path.join(root, `verify-${f.task.taskId}-1`, 'writing')
  await vi.waitFor(async () => expect(await readFile(writing, 'utf8')).toContain('start'))
  await service.stop()
  await flight
  const content = await readFile(writing, 'utf8')
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(await readFile(writing, 'utf8')).toBe(content)
  expect(saved().status).toBe('RUNNING')
  expect(saved().verdictDetail.phase).toBe('checking')
  expect(events().some((e) => e.event === 'verification.inconclusive')).toBe(false)
})
