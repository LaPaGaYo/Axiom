import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { MessageListResponseSchema } from '../../src/shared/axiom-contract/message-params'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(
  !source || process.platform === 'win32',
  'Headless Workers require a POSIX host and AXIOM_FIXTURE_REPO'
)

test('M3-06-2a: a Claude usage limit waits for its reset and continues automatically', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  await withFixtureMission(
    testInfo,
    source!,
    async ({ userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.interrupt-${taskId}`, '1')
      releaseWorkers()
      let waiting = inspect()
      let observedAt = Date.now()
      await expect
        .poll(
          () => {
            waiting = inspect()
            observedAt = Date.now()
            return (
              waiting.tasks[0]?.stage === 'READY' &&
              waiting.effects.some(
                (effect) =>
                  effect.kind === 'attempt.continue' &&
                  effect.status === 'pending' &&
                  Date.parse(effect.dueAt) > observedAt
              )
            )
          },
          { timeout: 60_000, intervals: [100] }
        )
        .toBe(true)
      expect(waiting.tasks).toMatchObject([{ stage: 'READY', attempt_count: 0 }])
      expect(waiting.bindings.map((row) => row.seq)).toEqual([1])
      expect(waiting.submissions).toEqual([])
      const effect = waiting.effects.find((row) => row.kind === 'attempt.continue')
      if (!effect || effect.kind !== 'attempt.continue') {
        throw new Error('Missing pending continuation')
      }
      expect(effect).toMatchObject({
        status: 'pending',
        key: `${taskId}/1`,
        payload: { taskId, seq: 1, chain: 1, failureClass: 'usage_limit' }
      })
      expect(effect.dueAt).toBe(effect.payload.resetsAt)
      expect(Date.parse(effect.dueAt)).toBeGreaterThan(observedAt)
      const failed = waiting.audits.filter((row) => row.event === 'attempt.failed')
      expect(failed).toHaveLength(1)
      expect(failed[0]?.object_id).toBe(waiting.bindings[0]?.dispatch_id)
      expect(JSON.parse(failed[0]?.after ?? '{}')).toMatchObject({
        reason: 'process_exited',
        evidence: 'exit_code',
        exitCode: 75,
        settlement: { kind: 'interrupted' },
        failure: {
          class: 'usage_limit',
          retryable: true,
          source: 'structured',
          window: 'session',
          resetsAt: effect.dueAt
        }
      })
      // Only observe from here: the durable effect must request the next Scheduler round.
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 120_000 }).toBe('VERIFIED')
      const completed = inspect()
      expect(completed.bindings.map((row) => row.seq)).toEqual([1, 2])
      expect(completed.tasks[0]?.attempt_count).toBe(1)
      expect(completed.effects.find((row) => row.id === effect.id)?.status).toBe('done')
      const admitted = completed.audits.find(
        (row) => row.event === 'attempt.admitted' && row.object_id === `${taskId}/2`
      )
      expect(Date.parse(z.string().parse(admitted?.created_at))).toBeGreaterThanOrEqual(
        Date.parse(effect.dueAt)
      )
      expect(completed.submissions).toHaveLength(1)
      expect(completed.submissions[0]?.attemptId).toBe(completed.bindings[1]?.dispatch_id)
      expect(completed.verification.map((run) => run.status)).toEqual(['PASS'])
    },
    {
      provider: 'claude',
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      releaseTerminals: true,
      maxAttempts: 1,
      interruptionBackoffMs: [100, 200, 300],
      acceptanceCriteria: [
        {
          text: 'The frozen Sprint entity is present',
          check: {
            kind: 'command',
            command: `node -e "process.exit(require('node:fs').readFileSync('src/domain/sprint.ts','utf8').includes('export interface Sprint') ? 0 : 1)"`
          }
        }
      ]
    }
  )
})

test('M3-06-2a: three Codex interruptions block the environment until a desktop adjustment', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  await withFixtureMission(
    testInfo,
    source!,
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const pending = async () =>
        MessageListResponseSchema.parse(
          await desktopCall(page, 'axiom.message.list', {
            missionId: mission.id,
            pendingOnly: true
          })
        ).messages
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.interrupt-${taskId}`, '3')
      // The frozen crash scenario's success patch applies directly to a fresh integration base.
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      releaseWorkers()
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 120_000 }).toBe('BLOCKED')
      const blocked = inspect()
      expect(blocked.tasks).toMatchObject([{ stage: 'BLOCKED', attempt_count: 0 }])
      expect(blocked.bindings.map((row) => row.seq)).toEqual([1, 2, 3])
      expect(blocked.submissions).toEqual([])
      expect(blocked.verification).toEqual([])
      const failures = blocked.audits.filter((row) => row.event === 'attempt.failed')
      expect(failures).toHaveLength(3)
      for (const failure of failures) {
        expect(JSON.parse(failure.after ?? '{}')).toMatchObject({
          exitCode: 75,
          settlement: { kind: 'interrupted' },
          failure: { class: 'usage_limit', retryable: true, source: 'text' }
        })
      }
      expect(blocked.effects.filter((row) => row.kind === 'attempt.continue')).toMatchObject([
        { key: `${taskId}/1`, status: 'done', payload: { seq: 1, chain: 1 } },
        { key: `${taskId}/2`, status: 'done', payload: { seq: 2, chain: 2 } }
      ])
      const stages = blocked.audits
        .filter((row) => row.event === 'task.stage' && row.object_id === taskId)
        .map((row) => JSON.parse(row.after ?? '{}'))
      expect(stages.at(-1)).toMatchObject({ stage: 'BLOCKED', reason: 'environment' })
      expect(stages).not.toContainEqual(
        expect.objectContaining({ reason: 'retry_budget_exhausted' })
      )
      const messages = await pending()
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        type: 'BLOCKED',
        taskId,
        attemptId: blocked.bindings[2]?.dispatch_id,
        pending: true,
        blocked: { reason: 'environment', paths: [] }
      })
      const adjusted = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.adjust', {
          taskId,
          rationale: 'The fixture usage limit has cleared; continue the Task.'
        })
      ).task
      // The desktop Task projection has no Attempt count; the task rows before and after prove it.
      expect(adjusted).toMatchObject({ stage: 'READY' })
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 120_000 }).toBe('VERIFIED')
      const completed = inspect()
      expect(completed.bindings.map((row) => row.seq)).toEqual([1, 2, 3, 4])
      expect(completed.tasks[0]?.attempt_count).toBe(1)
      expect(completed.submissions).toHaveLength(1)
      expect(completed.submissions[0]?.attemptId).toBe(completed.bindings[3]?.dispatch_id)
      expect(completed.verification.map((run) => run.status)).toEqual(['PASS'])
      expect(await pending()).toEqual([])
      expect(completed.audits.filter((row) => row.event === 'blocked.resolved')).toMatchObject([
        { object_id: messages[0]?.id }
      ])
    },
    {
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      releaseTerminals: true,
      maxAttempts: 1,
      interruptionBackoffMs: [100, 200, 300],
      extraAllowedPaths: ['src/services/date-range.ts', 'src/services/date-range.test.ts'],
      acceptanceCriteria: [
        {
          text: 'The frozen date-range examples include entityId',
          check: {
            kind: 'command',
            command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
          }
        }
      ]
    }
  )
})
