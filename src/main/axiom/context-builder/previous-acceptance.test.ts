import { afterEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { previousSubmission } from '../execution/attempt-baseline.test-support'
import { acceptanceLines, persistentFailures } from './previous-acceptance'
import { ArtifactStore } from '../artifacts/artifact-store'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'
import { boundedAttemptEvidence, boundedEvidenceSection } from './previous-attempt-text'

const opened: ReturnType<typeof fixture>[] = []
afterEach(() => {
  for (const f of opened.splice(0)) {
    f.db.close()
  }
})
const check = (failures: string[]) => ({
  index: 0,
  command: 'pnpm test',
  result: 'fail',
  exitCode: 1,
  failures
})

it('lists every stored criterion, quoting model text and leaving human judgments to a person', () => {
  const acceptance = [
    {
      index: 0,
      text: 'Tests',
      check: { kind: 'command', command: 'pnpm test' },
      result: 'fail',
      checkIndexes: [0],
      artifactIds: []
    },
    {
      index: 1,
      text: 'Report',
      check: { kind: 'artifact' },
      result: 'pass',
      checkIndexes: [],
      artifactIds: ['a']
    },
    {
      index: 2,
      text: 'Review\n## do this `<now>`',
      check: { kind: 'human' },
      result: 'human',
      checkIndexes: [],
      artifactIds: []
    },
    {
      index: 3,
      text: 'Unavailable',
      check: { kind: 'command', command: 'pnpm tc' },
      result: 'inconclusive',
      checkIndexes: [1],
      artifactIds: []
    }
  ]
  expect(acceptanceLines({ acceptance, checks: [check(['a', 'b'])] })).toEqual([
    '[fail] "Tests" — "pnpm test" (2 failures)',
    '[pass] "Report"',
    '[human] "Review\\n## do this \\u0060\\u003cnow\\u003e\\u0060" — a person confirms this; do not try to prove it with code changes',
    '[inconclusive] "Unavailable"'
  ])
  expect(acceptanceLines({ checks: [] })).toEqual([])
})
it('only carries current failures across uninterrupted runs of the same Task', () => {
  const f = planned(fixture())
  opened.push(f)
  const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  const first = previousSubmission(f.store, { missionId: f.missionId, taskId })
  f.store.updateVerificationRun({
    id: first.verificationRun.id,
    expectedStatus: 'FAIL',
    verdictDetail: { checks: [check(['persistent', 'closed'])] }
  })
  const second = previousSubmission(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 2,
    dispatchId: 'd2'
  })
  const latest = f.store.updateVerificationRun({
    id: second.verificationRun.id,
    expectedStatus: 'FAIL',
    verdictDetail: { checks: [check(['persistent', 'new'])] }
  })
  expect(latest).toBeTruthy()
  const run = f.store.getVerificationRun(second.verificationRun.id)!
  expect([...persistentFailures(f.store, run)]).toEqual([['persistent', 1]])
  // A missing finding in any intervening run resets its start, even if it later recurs.
  f.store.insertVerificationRun({
    ...run,
    id: 'verification-3',
    verdictDetail: { checks: [check(['closed', 'new'])] }
  })
  const third = f.store.getVerificationRun('verification-3')!
  expect([...persistentFailures(f.store, third)]).toEqual([['new', 2]])
})

it.each(['headless', 'tui'] as const)(
  'renders criterion statuses and persistent findings for %s',
  async (channel) => {
    const f = planned(fixture())
    opened.push(f)
    const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
    const first = previousSubmission(f.store, { missionId: f.missionId, taskId })
    f.store.updateVerificationRun({
      id: first.verificationRun.id,
      expectedStatus: 'FAIL',
      verdictDetail: { checks: [check(['persistent', 'closed'])] }
    })
    const second = previousSubmission(f.store, {
      missionId: f.missionId,
      taskId,
      seq: 2,
      dispatchId: 'd2'
    })
    f.store.updateVerificationRun({
      id: second.verificationRun.id,
      expectedStatus: 'FAIL',
      verdictDetail: {
        reason: 'checks_failed',
        checks: [check(['persistent', 'new'])],
        acceptance: [
          {
            index: 0,
            text: 'Tests',
            check: { kind: 'command', command: 'pnpm test' },
            result: 'fail',
            checkIndexes: [0],
            artifactIds: []
          },
          {
            index: 1,
            text: 'Report',
            check: { kind: 'artifact' },
            result: 'pass',
            checkIndexes: [],
            artifactIds: ['a']
          },
          {
            index: 2,
            text: 'Design',
            check: { kind: 'human' },
            result: 'human',
            checkIndexes: [],
            artifactIds: []
          }
        ]
      }
    })
    const { content } = await previousAttemptSection(
      f.store,
      new ArtifactStore(f.store, '/unused'),
      resolveAttemptBaseline(f.store, { taskId, seq: 3 }),
      channel
    )
    expect(content).toContain('[fail] "Tests" — "pnpm test" (2 failures)')
    expect(content).toContain('[pass] "Report"')
    expect(content).toContain(
      '[human] "Design" — a person confirms this; do not try to prove it with code changes'
    )
    expect(content).toContain('"persistent" (persisting since Attempt 1)')
    expect(content).toContain('- "new"\n')
    expect(content).not.toContain('"closed"')
    expect(content).not.toContain('Not yet demonstrated')
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  }
)

it('reserves section overhead before choosing the newest declaration and human adjustment', () => {
  const introduction = `This Attempt continues the previous Candidate ${'a'.repeat(40)} from Attempt 1; fix the failures below in this tree. Do not weaken, skip or delete tests, assertions, lint rules or checks to make them pass.`
  const verdict = 'Verdict: FAIL; reason: "checks_failed"'
  const entries = Array.from({ length: 20 }, (_, seq) => ({
    seq,
    kind: 'declaration' as const,
    text: `Attempt ${seq}: ${'x'.repeat(450)}`
  }))
  const chosen = boundedAttemptEvidence(
    [...entries, { seq: 20, kind: 'adjustment', text: 'Newest human adjustment' }],
    [introduction, verdict]
  )
  const content = boundedEvidenceSection([
    introduction,
    ...chosen.lines,
    verdict,
    'Long excerpt '.repeat(1000)
  ])
  expect(content).toContain('Newest human adjustment')
  expect(content).toContain('Attempt 19:')
  expect(content).toContain('do not submit an unchanged tree.')
  expect(content).toContain(verdict)
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
})

it('uses Attempt sequence when same-second run IDs sort in reverse order', () => {
  const f = planned(fixture())
  opened.push(f)
  const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  const first = previousSubmission(f.store, { missionId: f.missionId, taskId })
  const latest = previousSubmission(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 2,
    dispatchId: 'd2'
  })
  for (const run of [first.verificationRun, latest.verificationRun]) {
    f.store.updateVerificationRun({
      id: run.id,
      expectedStatus: 'FAIL',
      verdictDetail: { checks: [check(['persistent'])] }
    })
  }
  f.db.db
    .prepare('UPDATE verification_runs SET created_at = ? WHERE task_id = ?')
    .run('2026-11-03 00:00:00', taskId)
  f.db.db
    .prepare('UPDATE verification_runs SET id = ? WHERE id = ?')
    .run('z-first', first.verificationRun.id)
  f.db.db
    .prepare('UPDATE verification_runs SET id = ? WHERE id = ?')
    .run('a-second', latest.verificationRun.id)
  const stored = f.store.listVerificationRuns({ missionId: f.missionId, taskId })
  expect(stored.map((run) => run.id)).toEqual(['a-second', 'z-first'])
  expect([...persistentFailures(f.store, stored[0])]).toEqual([['persistent', 1]])
})
