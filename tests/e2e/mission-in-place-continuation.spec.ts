import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AttemptPreservedAuditSchema } from '../../src/main/axiom/execution/preserved-snapshot-contract'
import { HeadlessLaunchSchema } from '../../src/main/axiom/execution/headless-attempt-files'
import { TaskSpecSchema } from '../../src/shared/axiom-contract/mission-objects'
import { splitWorktreeIdForFilesystem } from '../../src/shared/worktree/id'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')
const Started = z.object({
  taskId: z.string(),
  seq: z.number(),
  branch: z.string(),
  worktreeId: z.string(),
  argv: z.array(z.string()),
  combination: z.object({ effective: z.object({ harnessVersion: z.string() }) }),
  baseline: z.object({
    kind: z.string(),
    strategy: z.string().optional(),
    reason: z.string(),
    previousSeq: z.number().optional(),
    attemptId: z.string().optional(),
    commitSha: z.string().optional()
  }),
  session: z
    .discriminatedUnion('strategy', [
      z.object({
        strategy: z.literal('resumed_in_place'),
        id: z.string(),
        originSeq: z.number(),
        fromSeq: z.number()
      }),
      z.object({ strategy: z.literal('fresh'), reason: z.string() })
    ])
    .optional()
})
const Failed = z.object({
  taskId: z.string(),
  reason: z.string(),
  evidence: z.string(),
  exitCode: z.number().int(),
  settlement: z.object({ kind: z.string() }),
  providerSessionId: z.string().optional()
})
const Submitted = z.object({ sessionContinued: z.boolean(), usageScope: z.string() })
const LedgerEntry = z.object({
  kind: z.string().optional(),
  attemptId: z.string(),
  taskId: z.string().optional(),
  threadId: z.string().optional(),
  marker: z.string().optional(),
  cwd: z.string().optional(),
  argv: z.array(z.string()).optional()
})
const LaunchLedger = z.object({ cwd: z.string(), argv: z.array(z.string()) })
type State = ReturnType<typeof inspectFixtureMission>

function audit(state: State, event: string, attemptId: string) {
  const row = state.audits.find((entry) => entry.event === event && entry.object_id === attemptId)
  if (!row) {
    throw new Error(`Missing ${event} audit for ${attemptId}`)
  }
  return JSON.parse(row.after ?? '{}')
}
function started(state: State, seq: number) {
  for (const row of state.audits.filter(({ event }) => event === 'attempt.started')) {
    const launch = Started.parse(JSON.parse(row.after ?? '{}'))
    if (launch.seq === seq) {
      return { attemptId: row.object_id, ...launch }
    }
  }
  throw new Error(`Missing Attempt ${seq} launch audit`)
}
function attemptFile(userData: string, attemptId: string, filename: string) {
  return path.join(userData, 'axiom', 'attempts', attemptId, filename)
}
function ledger(file: string) {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => LedgerEntry.parse(JSON.parse(line)))
}
function launchLedger(file: string, attemptId: string) {
  return LaunchLedger.parse(ledger(file).find((row) => row.attemptId === attemptId && !row.kind))
}

for (const refused of [false, true]) {
  test(
    refused
      ? 'M3-06-2c: a refused resume immediately continues from the snapshot in a fresh session'
      : 'M3-06-2c: an interrupted Codex Attempt resumes in its original worktree',
    async (
      // oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
      {},
      testInfo
    ) => {
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
          writeFileSync(`${ledgerPath}.rollout-${taskId}`, '1')
          if (refused) {
            writeFileSync(`${ledgerPath}.refuse-resume-${taskId}`, '')
          }
          releaseWorkers()
          // All observations after release are read-only; the Control Plane advances the chain.
          await expect
            .poll(() => inspect().audits.some(({ event }) => event === 'attempt.preserved'), {
              timeout: 60_000
            })
            .toBe(true)
          const firstState = inspect()
          const first = started(firstState, 1)
          const failure = Failed.parse(audit(firstState, 'attempt.failed', first.attemptId))
          expect(failure).toMatchObject({
            taskId,
            reason: 'process_exited',
            evidence: 'exit_code',
            exitCode: 75,
            settlement: { kind: 'interrupted' },
            providerSessionId: `fixture-${first.attemptId}`
          })
          const threadId = z.string().parse(failure.providerSessionId)
          const evidence = AttemptPreservedAuditSchema.parse(
            audit(firstState, 'attempt.preserved', first.attemptId)
          )
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
          const firstRecord = HeadlessLaunchSchema.parse(
            JSON.parse(readFileSync(attemptFile(userData, first.attemptId, 'launch.json'), 'utf8'))
          )
          expect(firstRecord.worktreeId).toBe(first.worktreeId)
          expect(firstRecord.branch).toBe(first.branch)
          expect(evidence.baselineSha).toBe(firstRecord.baselineSha)
          expect(first.session).toBeUndefined()
          expect(first.combination.effective.harnessVersion).toBe('codex-cli 0.163.0')
          await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
          const state = inspect()
          const second = started(state, 2)
          const continuedBaseline = {
            kind: 'snapshot',
            strategy: 'continued',
            reason: 'preserved_snapshot',
            previousSeq: 1,
            attemptId: first.attemptId,
            commitSha: snapshot.commitSha
          }
          expect(second).toMatchObject({
            taskId,
            seq: 2,
            worktreeId: first.worktreeId,
            baseline: continuedBaseline,
            session: { strategy: 'resumed_in_place', id: threadId, originSeq: 1, fromSeq: 1 }
          })
          expect(second.argv.slice(-3)).toEqual(['resume', threadId, '-'])
          const firstLedger = launchLedger(ledgerPath, first.attemptId)
          const secondLedger = launchLedger(ledgerPath, second.attemptId)
          expect(secondLedger.argv.slice(-3)).toEqual(['resume', threadId, '-'])
          expect(secondLedger.cwd).toBe(firstLedger.cwd)
          const worktree = z
            .string()
            .parse(splitWorktreeIdForFilesystem(second.worktreeId)?.worktreePath)
          expect(secondLedger.cwd).toBe(realpathSync(worktree))
          const prompt = readFileSync(attemptFile(userData, second.attemptId, 'prompt.md'), 'utf8')
          for (const text of [`Attempt: ${second.attemptId}`, worktree, snapshot.commitSha]) {
            expect(prompt).toContain(text)
          }
          expect(prompt).not.toContain('## Task spec')
          const fullPrompt = readFileSync(path.join(worktree, '.axiom', 'prompt.md'), 'utf8')
          expect(fullPrompt).toContain('## Task spec')
          expect(fullPrompt).toContain(`Attempt: ${second.attemptId}`)
          expect(git(['-C', worktree, 'symbolic-ref', '--short', 'HEAD'])).toBe(second.branch)
          expect(git(['-C', clone, 'rev-parse', first.branch])).toBe(firstRecord.baselineSha)
          expect(git(['-C', clone, 'rev-parse', snapshot.ref])).toBe(snapshot.commitSha)
          const secondEvents = readFileSync(
            attemptFile(userData, second.attemptId, 'events.jsonl'),
            'utf8'
          )
          const submission = state.submissions[0]
          if (!submission) {
            throw new Error('Missing successor Submission')
          }
          const candidate = state.candidates.find(({ id }) => id === submission.candidateId)
          if (!candidate) {
            throw new Error('Missing successor Candidate')
          }
          expect(submission.taskId).toBe(taskId)
          expect(candidate.attemptId).toBe(submission.attemptId)
          expect(
            git(['-C', clone, 'ls-tree', '-r', '--name-only', candidate.commitSha]).split('\n')
          ).toContain(partial)
          const task = state.tasks.find(({ task_id }) => task_id === taskId)
          if (!task) {
            throw new Error('Missing Task')
          }
          const spec = TaskSpecSchema.parse(JSON.parse(task.spec))
          expect(spec.retryPolicy.maxAttempts).toBe(1)
          expect(task.attempt_count).toBeLessThanOrEqual(spec.retryPolicy.maxAttempts)
          expect(state.bindings.map(({ seq }) => seq)).toEqual(refused ? [1, 2, 3] : [1, 2])
          if (refused) {
            expect(Failed.parse(audit(state, 'attempt.failed', second.attemptId))).toMatchObject({
              taskId,
              reason: 'resume_refused',
              evidence: 'exit_code',
              exitCode: 1,
              settlement: { kind: 'interrupted' }
            })
            expect(secondEvents).toBe('')
            expect(existsSync(attemptFile(userData, second.attemptId, 'last-message.md'))).toBe(
              false
            )
            expect(ledger(ledgerPath)).toContainEqual(
              expect.objectContaining({
                kind: 'resume_refused',
                attemptId: second.attemptId,
                taskId,
                threadId,
                marker: 'refuse-resume'
              })
            )
            const third = started(state, 3)
            expect(third).toMatchObject({
              taskId,
              baseline: continuedBaseline,
              session: { strategy: 'fresh', reason: 'resume_refused' }
            })
            expect(third.worktreeId).not.toBe(first.worktreeId)
            expect(third.argv).not.toContain('resume')
            const thirdLedger = launchLedger(ledgerPath, third.attemptId)
            expect(thirdLedger.argv).not.toContain('resume')
            expect(thirdLedger.cwd).not.toBe(firstLedger.cwd)
            const thirdPrompt = readFileSync(
              attemptFile(userData, third.attemptId, 'prompt.md'),
              'utf8'
            )
            expect(thirdPrompt).toContain('## Task spec')
            expect(thirdPrompt).toContain(`Attempt: ${third.attemptId}`)
            expect(submission.attemptId).toBe(third.attemptId)
          } else {
            expect(JSON.parse(secondEvents.split('\n')[0])).toEqual({
              type: 'thread.started',
              thread_id: threadId
            })
            expect(submission.attemptId).toBe(second.attemptId)
            expect(
              Submitted.parse(audit(state, 'attempt.submitted', submission.attemptId))
            ).toEqual({
              sessionContinued: true,
              usageScope: 'session'
            })
          }
        },
        {
          provider: 'codex',
          codexVersion: 'codex-cli 0.163.0',
          taskIds: ['T01'],
          holdWorkers: true,
          maxAttempts: 1,
          interruptionBackoffMs: [600_000, 600_000, 600_000],
          extraAllowedPaths: [partial]
        }
      )
    }
  )
}
