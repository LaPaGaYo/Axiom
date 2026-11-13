import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { MissionUsageResponseSchema } from '../../src/shared/axiom-contract/token-usage'
import { AttemptPreservedAuditSchema } from '../../src/main/axiom/execution/preserved-snapshot-contract'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires a POSIX host and AXIOM_FIXTURE_REPO')
const TokenStop = z.object({
  rule: z.literal('budget_exhausted'),
  mode: z.literal('auto'),
  action: z.literal('stopped'),
  thresholdTokens: z.number(),
  usedTokens: z.number(),
  thresholdSource: z.literal('task')
})
const StopReason = z.object({ reason: z.string() })
const ContinuedLaunch = z.object({
  seq: z.number(),
  baseline: z.object({
    kind: z.string(),
    strategy: z.string(),
    reason: z.string(),
    previousSeq: z.number(),
    attemptId: z.string(),
    commitSha: z.string()
  })
})

test('stops at the Task token cap and continues preserved work after a human raises it', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const partial = 'src/services/token-budget-partial.ts'
  await withFixtureMission(
    testInfo,
    z.string().parse(source),
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      // Task id exists at admission; the nullable dispatch id is read only once its stop exists.
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.usage-${taskId}`, '')
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      writeFileSync(`${ledgerPath}.stall-${taskId}`, '')
      writeFileSync(`${ledgerPath}.partial-${taskId}`, partial)
      releaseWorkers()
      await expect
        .poll(() => inspect().audits.some((a) => a.event === 'attempt.stopped'), {
          timeout: 150_000
        })
        .toBe(true)
      const stoppedState = inspect()
      const stopped = stoppedState.audits.find((a) => a.event === 'attempt.stopped')
      if (!stopped) {
        throw new Error('Missing stopped Attempt')
      }
      const firstAttemptId = stopped.object_id
      expect(StopReason.parse(JSON.parse(stopped.after ?? '{}'))).toEqual({
        reason: 'budget_exhausted'
      })
      const supervised = stoppedState.audits.filter(
        (a) => a.event === 'attempt.supervised' && a.object_id === firstAttemptId
      )
      expect(supervised).toHaveLength(1)
      expect(TokenStop.parse(JSON.parse(supervised[0]?.after ?? '{}'))).toEqual({
        rule: 'budget_exhausted',
        mode: 'auto',
        action: 'stopped',
        thresholdTokens: 1000,
        usedTokens: 1230,
        thresholdSource: 'task'
      })
      expect(supervised[0]?.sequence).toBeLessThan(stopped.sequence)
      const preservation = stoppedState.audits.find(
        (a) => a.event === 'attempt.preserved' && a.object_id === firstAttemptId
      )
      const preserved = AttemptPreservedAuditSchema.parse(JSON.parse(preservation?.after ?? '{}'))
      expect(preserved.taskId).toBe(taskId)
      expect(preserved.result).toMatchObject({
        status: 'preserved',
        scopePaths: [partial],
        secrets: []
      })
      if (preserved.result.status !== 'preserved') {
        throw new Error('Token stop did not preserve work')
      }
      const snapshot = preserved.result.snapshot
      const blocked = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.show', { taskId })
      ).task
      expect(blocked).toMatchObject({
        id: taskId,
        stage: 'BLOCKED',
        previousStage: 'NEEDS_FIX',
        spec: { budget: { maxTokens: 1000 } }
      })
      expect(inspect().bindings).toHaveLength(1)
      const adjusted = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.adjust', {
          taskId,
          rationale: 'Raise the token cap to finish the preserved work.',
          maxTokens: 5000
        })
      ).task
      expect(adjusted).toMatchObject({ id: taskId, missionId: mission.id, stage: 'READY' })
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(1)
      const successorState = inspect()
      const submission = successorState.submissions[0]
      if (!submission) {
        throw new Error('Missing successor Submission')
      }
      expect(submission.taskId).toBe(taskId)
      expect(submission.attemptId).not.toBe(firstAttemptId)
      expect(successorState.bindings).toHaveLength(2)
      const start = successorState.audits.find(
        (a) => a.event === 'attempt.started' && a.object_id === submission.attemptId
      )
      expect(ContinuedLaunch.parse(JSON.parse(start?.after ?? '{}'))).toEqual({
        seq: 2,
        baseline: {
          kind: 'snapshot',
          strategy: 'continued',
          reason: 'preserved_snapshot',
          previousSeq: 1,
          attemptId: firstAttemptId,
          commitSha: snapshot.commitSha
        }
      })
      const prompt = readFileSync(
        path.join(userData, 'axiom', 'attempts', submission.attemptId, 'prompt.md'),
        'utf8'
      )
      expect(prompt).toContain('## Token budget')
      expect(prompt).toContain('Task token budget: 5,000 cap; 1,230 used; 3,770 remaining.')
      expect(prompt).toContain(snapshot.commitSha)
      const usage = async () =>
        MissionUsageResponseSchema.parse(
          await desktopCall(page, 'axiom.mission.usage', { missionId: mission.id })
        )
      await expect
        .poll(
          async () => {
            const task = (await usage()).tasks.find((t) => t.taskId === taskId)
            return task?.attempts.length === 2 && task.attempts.every((a) => a.final)
          },
          { timeout: 120_000 }
        )
        .toBe(true)
      const view = await usage()
      const task = view.tasks.find((t) => t.taskId === taskId)
      if (!task) {
        throw new Error('Missing Task usage')
      }
      expect(view.missionId).toBe(mission.id)
      expect(task.limit).toBe(5000)
      expect(
        task.attempts.map((a) => ({ attemptId: a.attemptId, seq: a.seq, final: a.final }))
      ).toEqual([
        { attemptId: firstAttemptId, seq: 1, final: true },
        { attemptId: submission.attemptId, seq: 2, final: true }
      ])
      expect(task.used).toBe(task.attempts.reduce((sum, a) => sum + a.newTokens, 0))
      expect(task.used).toBe(2460)
      expect(view.used).toBe(task.used)
    },
    {
      provider: 'codex',
      taskIds: ['T01'],
      taskMaxTokens: 1000,
      maxAttempts: 2,
      holdWorkers: true,
      extraAllowedPaths: [partial],
      runVerification: false
    }
  )
})
