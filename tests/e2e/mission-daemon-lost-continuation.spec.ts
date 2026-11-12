import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AttemptPreservedAuditSchema } from '../../src/main/axiom/execution/preserved-snapshot-contract'
import { AttemptFailureSchema } from '../../src/shared/axiom-contract/attempt-failure'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')
const Started = z.object({ taskId: z.string(), seq: z.number(), branch: z.string() })
const Continued = Started.extend({
  baseline: z.object({
    kind: z.string(),
    strategy: z.string(),
    reason: z.string(),
    previousSeq: z.number(),
    attemptId: z.string(),
    commitSha: z.string()
  })
})
const Failed = z.object({
  taskId: z.string(),
  seq: z.number(),
  reason: z.string(),
  lastError: z.string().nullable(),
  failure: AttemptFailureSchema,
  evidence: z.string(),
  settlement: z.object({ kind: z.string() })
})
const Worker = z.object({
  dispatch_id: z.string(),
  state: z.string(),
  stage: z.string(),
  last_error: z.string().nullable()
})
const TaskStage = z.object({ stage: z.string(), reason: z.string() })
const CompletedCommand = z.object({
  type: z.literal('item.completed'),
  item: z.object({
    id: z.literal('partial-command'),
    type: z.literal('command_execution'),
    status: z.literal('completed'),
    exit_code: z.literal(0)
  })
})

function reachedStall(eventsFile: string) {
  if (!existsSync(eventsFile)) {
    return false
  }
  // A read may end in the middle of the last event; only complete JSON lines count.
  return readFileSync(eventsFile, 'utf8')
    .split('\n')
    .slice(0, -1)
    .some((line) => {
      try {
        return CompletedCommand.safeParse(JSON.parse(line)).success
      } catch {
        return false
      }
    })
}
function worktreeForBranch(clone: string, branch: string) {
  const worktree = git(['-C', clone, 'worktree', 'list', '--porcelain'])
    .split('\n\n')
    .map((record) => record.split('\n'))
    .find((fields) => fields.includes(`branch refs/heads/${branch}`))
    ?.find((field) => field.startsWith('worktree '))
    ?.slice('worktree '.length)
  if (!worktree) {
    throw new Error('Missing Attempt worktree')
  }
  return worktree
}

test('M3-06-2b-3: an Attempt lost with its daemon continues from preserved work after restart', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  if (!source) {
    throw new Error('Missing fixture repository')
  }
  test.setTimeout(300_000)
  const partial = 'src/services/daemon-lost-partial.ts'
  await withFixtureMission(
    testInfo,
    source,
    async ({ userData, mission, ledgerPath, clone, releaseWorkers, restart }) => {
      if (!restart) {
        throw new Error('Missing restart fixture')
      }
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect
        .poll(() => inspect().audits.some(({ event }) => event === 'attempt.started'), {
          timeout: 60_000
        })
        .toBe(true)
      const firstStart = inspect().audits.find(({ event }) => event === 'attempt.started')
      if (!firstStart) {
        throw new Error('Missing first Attempt launch')
      }
      const firstId = firstStart.object_id
      const first = Started.parse(JSON.parse(firstStart.after ?? '{}'))
      expect(first.seq).toBe(1)
      const taskId = first.taskId
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      writeFileSync(`${ledgerPath}.stall-${taskId}`, '')
      writeFileSync(`${ledgerPath}.partial-${taskId}`, partial)
      releaseWorkers()
      await expect
        .poll(
          () => reachedStall(path.join(userData, 'axiom', 'attempts', firstId, 'events.jsonl')),
          {
            timeout: 60_000
          }
        )
        .toBe(true)
      await restart({ stopDaemons: true })
      // Only observe after restart; the first pass reading the kernel verdict may be 60 s later.
      await expect
        .poll(
          () =>
            inspect().audits.some(
              ({ event, object_id }) => event === 'attempt.failed' && object_id === firstId
            ),
          { timeout: 150_000 }
        )
        .toBe(true)
      const interrupted = inspect()
      const worker = z
        .array(Worker)
        .parse(interrupted.rows.workers)
        .find((row) => row.dispatch_id === firstId)
      expect(worker).toMatchObject({ state: 'abandoned', stage: 'terminal_missing' })
      const failure = interrupted.audits.find(
        ({ event, object_id }) => event === 'attempt.failed' && object_id === firstId
      )
      expect(Failed.parse(JSON.parse(failure?.after ?? '{}'))).toEqual({
        taskId,
        seq: 1,
        reason: 'terminal_missing',
        lastError: worker?.last_error,
        failure: { class: 'unknown', retryable: true, source: 'absent' },
        evidence: 'runtime_restarted',
        settlement: { kind: 'interrupted' }
      })
      const preservation = interrupted.audits.find(
        ({ event, object_id }) => event === 'attempt.preserved' && object_id === firstId
      )
      const evidence = AttemptPreservedAuditSchema.parse(JSON.parse(preservation?.after ?? '{}'))
      expect(evidence.taskId).toBe(taskId)
      expect(evidence.result).toMatchObject({
        status: 'preserved',
        scopePaths: [partial],
        secrets: []
      })
      if (evidence.result.status !== 'preserved') {
        throw new Error('Missing lost-daemon snapshot')
      }
      const { snapshot } = evidence.result
      expect(git(['-C', clone, 'rev-parse', snapshot.ref])).toBe(snapshot.commitSha)
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      await expect
        .poll(
          () =>
            inspect().effects.find(
              (row) => row.kind === 'attempt.continue' && row.key === `${taskId}/1`
            )?.status,
          {
            timeout: 30_000
          }
        )
        .toBe('done')
      const completed = inspect()
      expect(
        completed.audits.filter(
          ({ event, object_id }) => event === 'attempt.abandoned' && object_id === firstId
        )
      ).toEqual([])
      const stages = completed.audits
        .filter(({ event, object_id }) => event === 'task.stage' && object_id === taskId)
        .map((row) => TaskStage.parse(JSON.parse(row.after ?? '{}')))
      expect(stages).toContainEqual({ stage: 'NEEDS_FIX', reason: 'interrupted' })
      expect(stages).toContainEqual({ stage: 'READY', reason: 'retry_after_interruption' })
      expect(stages.some((row) => row.reason === 'attempt_abandoned')).toBe(false)
      expect(
        completed.effects.find(
          (row) => row.kind === 'attempt.continue' && row.key === `${taskId}/1`
        )
      ).toMatchObject({
        status: 'done',
        payload: { taskId, seq: 1, chain: 1, failureClass: 'unknown' }
      })
      const submission = completed.submissions[0]
      const candidate = completed.candidates.find(({ id }) => id === submission?.candidateId)
      if (!submission || !candidate) {
        throw new Error('Missing successor Submission or Candidate')
      }
      expect(submission.taskId).toBe(taskId)
      expect(submission.attemptId).not.toBe(firstId)
      expect(candidate.attemptId).toBe(submission.attemptId)
      const secondStart = completed.audits.find(
        ({ event, object_id }) => event === 'attempt.started' && object_id === submission.attemptId
      )
      const second = Continued.parse(JSON.parse(secondStart?.after ?? '{}'))
      expect(second).toMatchObject({
        taskId,
        seq: 2,
        baseline: {
          kind: 'snapshot',
          strategy: 'continued',
          reason: 'preserved_snapshot',
          previousSeq: 1,
          attemptId: firstId,
          commitSha: snapshot.commitSha
        }
      })
      const firstWorktree = worktreeForBranch(clone, first.branch)
      expect(worktreeForBranch(clone, second.branch)).not.toBe(firstWorktree)
      expect(readFileSync(path.join(firstWorktree, partial), 'utf8')).toContain(
        'partialWork = true'
      )
      const prompt = readFileSync(
        path.join(userData, 'axiom', 'attempts', submission.attemptId, 'prompt.md'),
        'utf8'
      )
      for (const text of [
        snapshot.commitSha,
        partial,
        'I left partial work for the next Attempt to review.',
        JSON.stringify(`git status --short -- "${partial}"`),
        'The runtime that started Attempt 1 restarted, and the Attempt process was gone afterwards.'
      ]) {
        expect(prompt).toContain(text)
      }
      expect(prompt).not.toContain('Attempt 1 was stopped')
      expect(prompt).not.toContain('Attempt 1 failed')
      expect(prompt).not.toContain('Attempt 1 was interrupted by unknown')
      expect(
        git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha]).split('\n')
      ).toContain(partial)
      expect(completed.tasks.find((row) => row.task_id === taskId)?.attempt_count).toBe(1)
    },
    {
      provider: 'codex',
      taskIds: ['T01'],
      holdWorkers: true,
      maxAttempts: 1,
      interruptionBackoffMs: [100, 200, 300],
      restart: true,
      extraAllowedPaths: [partial],
      runVerification: false
    }
  )
})
