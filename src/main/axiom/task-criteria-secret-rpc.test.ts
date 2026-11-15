import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanReviewFixture } from './verification/human-review-fixture.test-support'

let f: ReturnType<typeof humanReviewFixture>
beforeEach(() => {
  f = humanReviewFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it('answers a refused adjustment over RPC with the path of the issue and without the secret', async () => {
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  const before = f.snapshot()
  const reply = await f.call('axiom.task.adjust', {
    taskId: f.task.taskId,
    rationale: 'Correct the criteria.',
    acceptanceCriteria: [
      { text: 'Checks pass', check: { kind: 'command', command: `node check.js ${secret}` } }
    ]
  })
  expect(reply).toMatchObject({
    ok: false,
    error: {
      code: 'plan_invalid',
      message: 'plan_invalid',
      data: {
        errors: [
          {
            code: 'secret_in_criterion',
            severity: 'error',
            message:
              'Acceptance criterion command matches a secret pattern (provider_token). Remove the secret.',
            taskIds: [f.task.spec.id],
            path: ['task', 'acceptanceCriteria', 0, 'check', 'command']
          }
        ]
      }
    }
  })
  expect(JSON.stringify(reply)).not.toContain(secret)
  expect(f.snapshot()).toEqual(before)
  expect(JSON.stringify(f.store.listAuditEvents({ missionId: f.missionId }))).not.toContain(secret)
})

it('refuses an adjustment whose rationale looks like a secret', async () => {
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  const before = f.snapshot()
  const reply = await f.call('axiom.task.adjust', {
    taskId: f.task.taskId,
    rationale: `Remove ${secret}`,
    acceptanceCriteria: [{ text: 'Checks pass', check: { kind: 'artifact' } }]
  })
  expect(reply).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument', message: 'secret_in_rationale' }
  })
  expect(JSON.stringify(reply)).not.toContain(secret)
  expect(f.snapshot()).toEqual(before)
  expect(JSON.stringify(f.store.listAuditEvents({ missionId: f.missionId }))).not.toContain(secret)
})
