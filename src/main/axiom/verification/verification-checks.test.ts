import { mkdtemp, rm, access, readFile, writeFile, mkdir } from 'node:fs/promises'
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
    expect(saved().verdictDetail.artifacts).toMatchObject({
      required: false,
      checked: [],
      counts: { checked: 0 }
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

async function changeCandidate(file: string, content: string) {
  await mkdir(path.dirname(path.join(f.repo, file)), { recursive: true })
  await writeFile(path.join(f.repo, file), content)
  await f.git('add', file)
  await f.git('commit', '--no-gpg-sign', '-qm', 'gate probe')
  f.candidate.commitSha = await f.git('rev-parse', 'HEAD')
  f.candidate.treeSha = await f.git('rev-parse', 'HEAD^{tree}')
  await f.git('branch', '-f', f.binding.branch, f.candidate.commitSha)
  f.db.db
    .prepare('UPDATE candidates SET commit_sha = ?, tree_sha = ? WHERE id = ?')
    .run(f.candidate.commitSha, f.candidate.treeSha, f.candidate.id)
}
function scope(allowedPaths: string[]) {
  const spec = f.store.getTaskStage(f.task.taskId)!.spec
  f.db.db
    .prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?')
    .run(JSON.stringify({ ...spec, scope: { ...spec.scope, allowedPaths } }), f.task.taskId)
}
it('fails an out-of-scope Candidate even when every command passes and retains complete evidence', async () => {
  commands([node('process.exit(0)'), node('console.log(2)')])
  await changeCandidate('outside.txt', 'out of scope')
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'FAIL',
    verdictDetail: {
      reason: 'scope_violation',
      diff: {
        integrationBase: { branch: `axiom/integration/${f.missionId}`, sha: f.baseSha },
        mergeBase: f.baseSha,
        scopeViolations: ['outside.txt'],
        patchComplete: true
      },
      checks: [{ result: 'pass' }, { result: 'pass' }]
    }
  })
  expect(events()).toContainEqual(
    expect.objectContaining({
      event: 'verification.failed',
      after: expect.objectContaining({ scopeViolations: ['outside.txt'] })
    })
  )
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('READY')
})
it('never persists a planted secret in the run, any Mission Artifact, or audit', async () => {
  commands([node('process.exit(0)')])
  const token = `gh` + `p_${'Z'.repeat(36)}`
  await changeCandidate(f.scopePath, token)
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'FAIL',
    verdictDetail: {
      reason: 'secret_detected',
      diff: { secrets: [{ path: f.scopePath, pattern: 'provider_token' }] },
      checks: [{ result: 'pass' }]
    }
  })
  expect(JSON.stringify(saved()).includes(token)).toBe(false)
  expect(JSON.stringify(events()).includes(token)).toBe(false)
  for (const artifact of f.artifacts.list({ missionId: f.missionId })) {
    expect((await f.artifacts.read(artifact.id)).content.toString().includes(token)).toBe(false)
  }
  expect(events()).toContainEqual(
    expect.objectContaining({
      event: 'verification.failed',
      after: expect.objectContaining({
        secrets: [{ path: f.scopePath, pattern: 'provider_token' }]
      })
    })
  )
})
it.each([false, true])(
  'dangerous changes require an explicit scope entry: %s',
  async (explicit) => {
    commands([node('process.exit(0)')])
    scope(explicit ? ['.', 'package.json'] : ['.'])
    await changeCandidate('package.json', '{}')
    await service.kick()
    expect(saved()).toMatchObject({
      status: explicit ? 'PASS' : 'INCONCLUSIVE',
      verdictDetail: {
        reason: explicit ? 'checks_passed' : 'dangerous_change',
        ...(explicit ? {} : { escalation: 'human' })
      }
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(explicit ? 'VERIFIED' : 'VERIFYING')
    if (!explicit) {
      expect(events()).toContainEqual(
        expect.objectContaining({
          event: 'verification.inconclusive',
          after: expect.objectContaining({
            dangerous: [{ path: 'package.json', pattern: '**/package.json' }]
          })
        })
      )
    }
  }
)
it.each([0, 1])('missing integration base still runs commands (exit %s)', async (exit) => {
  commands([node(`process.exit(${exit})`)])
  await f.git('branch', '-D', `axiom/integration/${f.missionId}`)
  await service.kick()
  expect(saved()).toMatchObject({
    status: exit ? 'FAIL' : 'INCONCLUSIVE',
    verdictDetail: {
      reason: exit ? 'checks_failed' : 'environment',
      ...(exit ? {} : { detail: 'integration_base_unavailable', escalation: 'human' }),
      diff: { error: 'integration_base_unavailable' },
      checks: [{ result: exit ? 'fail' : 'pass' }]
    }
  })
})

it.each([0, 1])('keeps tampering evidence even when checks exit %s', async (exit) => {
  commands([node(`process.exit(${exit})`)])
  scope(['.'])
  const tampering = [{ path: 'src/probe.test.ts', rule: 'test_skip_added', count: 1 }]
  await changeCandidate('src/probe.test.ts', 'test.skip("tamper")\n')
  await service.kick()
  expect(saved()).toMatchObject({
    status: exit ? 'FAIL' : 'INCONCLUSIVE',
    verdictDetail: {
      reason: exit ? 'checks_failed' : 'test_tampering',
      ...(exit ? {} : { escalation: 'human' }),
      diff: { tampering, counts: { tampering: 1 }, scopeViolations: [] },
      checks: [{ result: exit ? 'fail' : 'pass' }]
    }
  })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(exit ? 'READY' : 'VERIFYING')
  if (!exit) {
    expect(events()).toContainEqual(
      expect.objectContaining({
        event: 'verification.inconclusive',
        after: expect.objectContaining({ reason: 'test_tampering', escalation: 'human', tampering })
      })
    )
  }
  const id = saved().verdictDetail.verdictArtifactId
  if (typeof id !== 'string') {
    throw new Error('Missing verdict Artifact')
  }
  expect(JSON.parse((await f.artifacts.read(id)).content.toString())).toMatchObject({
    diff: { tampering }
  })
})

function submission(artifactIds: string[]) {
  f.store.insertSubmission({
    id: 'worker-report',
    missionId: f.missionId,
    taskId: f.task.taskId,
    attemptId: f.candidate.attemptId,
    candidateId: f.candidate.id,
    report: {
      summary: 'Worker deliverables',
      filesChanged: [],
      checksRun: [],
      artifacts: artifactIds,
      limitations: [],
      risks: [],
      questions: [],
      followUps: []
    }
  })
}

it.each([
  { mode: 'missing', reason: 'artifact_missing', status: 'FAIL', problem: null },
  { mode: 'empty', reason: 'artifact_invalid', status: 'FAIL', problem: 'empty' },
  { mode: 'utf8', reason: 'artifact_invalid', status: 'FAIL', problem: 'invalid_utf8' },
  { mode: 'json', reason: 'artifact_invalid', status: 'FAIL', problem: 'invalid_json' },
  { mode: 'unreadable', reason: 'environment', status: 'INCONCLUSIVE', problem: 'unreadable' }
])(
  'checks non-code Artifacts after passing repository gates: $mode',
  async ({ mode, reason, status, problem }) => {
    commands([' ', '\n\t'], { repositoryGates: { low: [node('process.exit(0)')] } })
    const ids: string[] = []
    if (mode !== 'missing') {
      const artifact = await f.artifacts.put({
        missionId: f.missionId,
        kind: 'worker_report',
        createdBy: 'Worker',
        related: [f.task.taskId],
        mediaType: mode === 'json' ? 'application/json' : 'text/plain',
        content:
          mode === 'empty'
            ? Buffer.alloc(0)
            : mode === 'utf8'
              ? Buffer.from([0xff])
              : Buffer.from('{')
      })
      ids.push(artifact.id)
      if (mode === 'unreadable') {
        await rm(f.artifacts.pathFor(artifact.sha256))
      }
    }
    submission(ids)
    await service.kick()
    expect(saved()).toMatchObject({
      status,
      verdictDetail: {
        reason,
        ...(mode === 'unreadable' ? { escalation: 'human', detail: 'artifact_unreadable' } : {}),
        artifacts: {
          required: true,
          checked: problem ? [{ id: ids[0], problem }] : [],
          counts: { checked: ids.length, ...(problem ? { [problem]: 1 } : {}) }
        },
        checks: [{ source: 'gate', result: 'pass' }]
      }
    })
  }
)

it.each([
  { nonCodeTasks: 'human_confirm', gates: true, escalation: 'human' },
  { nonCodeTasks: 'artifact_only', gates: true, escalation: 'specialist' },
  { nonCodeTasks: 'artifact_only', gates: false, escalation: 'specialist' }
])(
  'valid non-code Artifacts require confirmation: $nonCodeTasks / gates=$gates',
  async ({ nonCodeTasks, gates, escalation }) => {
    commands([], { nonCodeTasks, repositoryGates: gates ? { low: [node('process.exit(0)')] } : {} })
    const artifact = await f.artifacts.put({
      missionId: f.missionId,
      kind: 'other',
      createdBy: 'Worker',
      related: [f.task.taskId],
      mediaType: 'application/json',
      content: Buffer.from('{"ok":true}')
    })
    submission([artifact.id])
    await service.kick()
    expect(saved()).toMatchObject({
      status: 'INCONCLUSIVE',
      verdictDetail: {
        reason: 'non_code',
        escalation,
        artifacts: {
          required: true,
          checked: [{ id: artifact.id, kind: 'other', mediaType: 'application/json', bytes: 11 }],
          counts: { checked: 1 }
        }
      }
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
  }
)

it('records a bad Artifact for a code Task without changing its PASS', async () => {
  commands([node('process.exit(0)')])
  const artifact = await f.artifacts.put({
    missionId: f.missionId,
    kind: 'other',
    createdBy: 'Worker',
    related: [f.task.taskId],
    mediaType: 'application/json',
    content: Buffer.from('{')
  })
  submission([artifact.id])
  await service.kick()
  expect(saved()).toMatchObject({
    status: 'PASS',
    verdictDetail: {
      reason: 'checks_passed',
      artifacts: { required: false, checked: [{ id: artifact.id, problem: 'invalid_json' }] }
    }
  })
})
