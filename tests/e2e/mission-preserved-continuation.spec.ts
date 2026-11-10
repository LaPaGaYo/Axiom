import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AttemptPreservedAuditSchema } from '../../src/main/axiom/execution/preserved-snapshot-contract'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')
const Started = z.object({
  seq: z.number(),
  baseline: z.object({
    kind: z.string(),
    strategy: z.string(),
    reason: z.string(),
    previousSeq: z.number().optional(),
    attemptId: z.string().optional(),
    commitSha: z.string().optional(),
    notContinued: z
      .array(
        z.object({
          seq: z.number(),
          attemptId: z.string(),
          reason: z.string(),
          paths: z.array(z.string()).optional()
        })
      )
      .optional()
  })
})
function preserved(state: ReturnType<typeof inspectFixtureMission>) {
  const row = state.audits.find(({ event }) => event === 'attempt.preserved')
  if (!row) {
    throw new Error('Missing preservation audit')
  }
  return {
    attemptId: row.object_id,
    ...AttemptPreservedAuditSchema.parse(JSON.parse(row.after ?? '{}'))
  }
}
function submitted(state: ReturnType<typeof inspectFixtureMission>) {
  const submission = state.submissions[0]
  const candidate = state.candidates.find(({ id }) => id === submission?.candidateId)
  if (!submission || !candidate) {
    throw new Error('Missing successor Submission or Candidate')
  }
  const row = state.audits.find(
    ({ event, object_id }) => event === 'attempt.started' && object_id === submission.attemptId
  )
  if (!row) {
    throw new Error('Missing successor launch audit')
  }
  return { submission, candidate, launch: Started.parse(JSON.parse(row.after ?? '{}')) }
}

test('M3-06-2b: interrupted in-scope work continues automatically from its preserved commit', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  if (!source) {
    throw new Error('Missing fixture repository')
  }
  test.setTimeout(300_000)
  const partial = 'src/services/interrupted-partial.ts'
  await withFixtureMission(
    testInfo,
    source,
    async ({ userData, mission, ledgerPath, clone, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().tasks[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      writeFileSync(`${ledgerPath}.interrupt-${taskId}`, '1')
      writeFileSync(`${ledgerPath}.partial-${taskId}`, partial)
      releaseWorkers()
      // Only durable read-only inspection follows release; no Scheduler/continue RPC is called.
      await expect
        .poll(() => inspect().audits.some(({ event }) => event === 'attempt.preserved'), {
          timeout: 60_000
        })
        .toBe(true)
      const first = inspect()
      const evidence = preserved(first)
      expect(evidence.taskId).toBe(taskId)
      expect(evidence.result).toMatchObject({
        status: 'preserved',
        scopePaths: [partial],
        secrets: []
      })
      if (evidence.result.status !== 'preserved') {
        throw new Error('Snapshot was not preserved')
      }
      const snapshot = evidence.result.snapshot
      expect(git(['-C', clone, 'rev-parse', snapshot.ref])).toBe(snapshot.commitSha)
      const firstBranch = z.string().parse(first.bindings.find(({ seq }) => seq === 1)?.branch)
      expect(git(['-C', clone, 'rev-parse', firstBranch])).not.toBe(snapshot.commitSha)
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      const { submission, candidate, launch } = submitted(inspect())
      expect(submission.taskId).toBe(taskId)
      expect(candidate.attemptId).toBe(submission.attemptId)
      expect(launch).toMatchObject({
        seq: 2,
        baseline: {
          kind: 'snapshot',
          strategy: 'continued',
          reason: 'preserved_snapshot',
          previousSeq: 1,
          attemptId: evidence.attemptId,
          commitSha: snapshot.commitSha
        }
      })
      const prompt = readFileSync(
        path.join(userData, 'axiom', 'attempts', submission.attemptId, 'prompt.md'),
        'utf8'
      )
      for (const text of [
        snapshot.commitSha,
        partial,
        'I left partial work for the next Attempt to review.',
        'git status --short --'
      ]) {
        expect(prompt).toContain(text)
      }
      expect(
        git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha]).split('\n')
      ).toContain(partial)
    },
    {
      provider: 'codex',
      taskIds: ['T01'],
      holdWorkers: true,
      maxAttempts: 1,
      interruptionBackoffMs: [100, 200, 300],
      extraAllowedPaths: [partial]
    }
  )
})

test('M3-06-2b: failed out-of-scope work is preserved but not continued', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  if (!source) {
    throw new Error('Missing fixture repository')
  }
  test.setTimeout(300_000)
  const partial = 'src/services/half-written.ts'
  await withFixtureMission(
    testInfo,
    source,
    async ({ userData, mission, ledgerPath, clone, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().tasks[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      writeFileSync(`${ledgerPath}.crash-${taskId}`, '1')
      releaseWorkers()
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      const state = inspect()
      const evidence = preserved(state)
      expect(evidence.result).toMatchObject({ status: 'preserved', scopePaths: [partial] })
      const { submission, candidate, launch } = submitted(state)
      expect(submission.taskId).toBe(taskId)
      expect(candidate.attemptId).toBe(submission.attemptId)
      expect(launch).toMatchObject({
        seq: 2,
        baseline: {
          kind: 'integration',
          strategy: 'not_continued',
          reason: 'previous_attempt_not_submitted',
          notContinued: [
            { seq: 1, attemptId: evidence.attemptId, reason: 'out_of_scope', paths: [partial] }
          ]
        }
      })
      const prompt = readFileSync(
        path.join(userData, 'axiom', 'attempts', submission.attemptId, 'prompt.md'),
        'utf8'
      )
      expect(prompt).toContain(`not carried over: out of scope: "${partial}"`)
      expect(
        git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha]).split('\n')
      ).not.toContain(partial)
    },
    { provider: 'codex', taskIds: ['T01'], holdWorkers: true, maxAttempts: 2 }
  )
})
