import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanReviewFixture } from '../verification/human-review-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'

let f: ReturnType<typeof humanReviewFixture>
beforeEach(() => {
  f = humanReviewFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const acceptanceCriteria = [
  { text: 'The command passes', check: { kind: 'command', command: 'node -e "0"' } }
]
const adjust = (extra = {}) =>
  f.call('axiom.task.adjust', {
    taskId: f.task.taskId,
    acceptanceCriteria,
    rationale: 'Correct the plan.',
    ...extra
  })

it.each(
  [[], [{ text: 'Looks right', check: { kind: 'human' } }]].map((acceptanceCriteria) => ({
    acceptanceCriteria
  }))
)(
  'rejects uncheckable replacement without changing the Task or audits',
  async ({ acceptanceCriteria }) => {
    const before = f.snapshot()
    expect(await adjust({ acceptanceCriteria })).toMatchObject({
      ok: false,
      error: {
        code: 'plan_invalid',
        data: {
          errors: [
            {
              code: 'acceptance_uncheckable',
              path: ['task', 'acceptanceCriteria'],
              taskIds: [f.task.spec.id]
            }
          ]
        }
      }
    })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each(['NEEDS_FIX', 'BLOCKED', 'VERIFYING'] as const)(
  'replaces acceptance in %s and records both versions',
  async (stage) => {
    f.db.db
      .prepare('UPDATE task_stages SET stage = ?, previous_stage = ? WHERE task_id = ?')
      .run(stage, stage === 'BLOCKED' ? 'NEEDS_FIX' : null, f.task.taskId)
    const original = f.store.getTaskStage(f.task.taskId)?.spec.acceptanceCriteria
    expect(await adjust()).toMatchObject({ ok: true })
    expect(f.store.getTaskStage(f.task.taskId)?.spec.acceptanceCriteria).toEqual(acceptanceCriteria)
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(stage === 'NEEDS_FIX' ? 'READY' : stage)
    expect(
      f.store.listAuditEvents({ missionId: f.missionId }).find((e) => e.event === 'task.adjusted')
    ).toMatchObject({ before: { acceptanceCriteria: original }, after: { acceptanceCriteria } })
  }
)
it.each(['QUEUED', 'RUNNING'] as const)(
  'does not replace criteria while verification is %s',
  async (status) => {
    f.db.db.prepare('UPDATE verification_runs SET status = ? WHERE id = ?').run(status, f.run.id)
    const before = f.snapshot()
    expect(await adjust()).toMatchObject({
      ok: false,
      error: { code: 'illegal_transition', data: { reason: 'task_not_adjustable' } }
    })
    expect(f.snapshot()).toEqual(before)
  }
)
it('rejects invalid commands as plan_invalid, and uses the Mission policy allowlist', async () => {
  const replacement = [{ text: 'Check', check: { kind: 'command', command: 'unapproved check' } }]
  const before = f.snapshot()
  expect(await adjust({ acceptanceCriteria: replacement })).toMatchObject({
    ok: false,
    error: {
      code: 'plan_invalid',
      data: { errors: [expect.objectContaining({ code: 'evidence_command_invalid' })] }
    }
  })
  expect(f.snapshot()).toEqual(before)
  const policy = f.store.getPolicy(f.missionId)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.missionId, {
    ...policy,
    verificationRules: { evidenceCommands: { allowedPrograms: ['unapproved'] } }
  })
  expect(await adjust({ acceptanceCriteria: replacement })).toMatchObject({ ok: true })
})
it('keeps an exhausted blocked candidate available for adjust then rerun without another Attempt', async () => {
  f.db.db
    .prepare(
      'UPDATE task_stages SET stage = ?, previous_stage = ?, attempt_count = 2 WHERE task_id = ?'
    )
    .run('BLOCKED', 'NEEDS_FIX', f.task.taskId)
  f.store.updateVerificationRun({ id: f.run.id, expectedStatus: 'HUMAN_REVIEW', status: 'FAIL' })
  vi.spyOn(getAxiomControlPlane(f.runtime).verification, 'kick').mockResolvedValue(undefined)
  expect(await adjust()).toMatchObject({ ok: true, result: { task: { stage: 'BLOCKED' } } })
  expect(
    await f.call('axiom.verification.rerun', {
      taskId: f.task.taskId,
      rationale: 'Corrected criteria'
    })
  ).toMatchObject({ ok: true })
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
    stage: 'VERIFYING',
    attemptCount: 2,
    retryPolicy: { maxAttempts: 2 }
  })
})
it('redacts acceptance text and commands before writing adjustment audits', async () => {
  const secret = `ghp_${'x'.repeat(30)}`
  const replacement = [
    { text: `Remove ${secret}`, check: { kind: 'command', command: `node -e "${secret}"` } }
  ]
  expect(await adjust({ acceptanceCriteria: replacement })).toMatchObject({ ok: true })
  expect(await adjust()).toMatchObject({ ok: true })
  const audits = f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((event) => event.event === 'task.adjusted')
  expect(JSON.stringify(audits)).not.toContain(secret)
  const redacted = [
    { text: 'Remove [REDACTED]', check: { kind: 'command', command: 'node -e "[REDACTED]"' } }
  ]
  expect(audits[0]).toMatchObject({ after: { acceptanceCriteria: redacted } })
  expect(audits[1]).toMatchObject({ before: { acceptanceCriteria: redacted } })
})
