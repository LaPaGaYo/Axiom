import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import type { AcceptanceCriterion } from '../../src/shared/axiom-contract/mission-objects'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { MissionPendingResponseSchema } from '../../src/shared/axiom-contract/mission-pending'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'

const source = process.env.AXIOM_FIXTURE_REPO
const passing: AcceptanceCriterion = {
  text: 'The date-range examples include entityId',
  check: {
    kind: 'command',
    command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
  }
}
const human: AcceptanceCriterion = {
  text: 'A person confirms the example is clear',
  check: { kind: 'human' }
}

test('M3-09-1: waits and pending items follow the human review flow', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(295_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const tasks = async () =>
        TaskListResponseSchema.parse(
          await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
        ).tasks
      const pending = async () =>
        MissionPendingResponseSchema.parse(
          await desktopCall(page, 'axiom.mission.pending', { missionId: mission.id })
        )
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
      await expect
        .poll(async () => (await tasks()).find((task) => task.id === taskId)?.waitingOn)
        .toMatchObject({
          on: 'running',
          reason: 'attempt_running',
          person: false,
          seq: 1
        })
      const before = await tasks()
      expect(before).toHaveLength(2)
      const dependentId = z.string().parse(before.find((task) => task.id !== taskId)?.id)
      const dependencyWait = {
        on: 'dependency',
        reason: 'upstream_not_integrated',
        person: false,
        taskIds: [taskId]
      }
      expect(before.find((task) => task.id === dependentId)?.waitingOn).toEqual(dependencyWait)
      const initiallyPending = await pending()
      expect(initiallyPending.missionId).toBe(mission.id)
      expect(initiallyPending.items.filter((item) => item.blocking)).toEqual([])
      releaseWorkers()
      const reviews = async () =>
        VerificationListResponseSchema.parse(
          await desktopCall(page, 'axiom.verification.list', {
            missionId: mission.id,
            taskId,
            status: 'HUMAN_REVIEW'
          })
        ).runs
      await expect.poll(async () => (await reviews()).length, { timeout: 90_000 }).toBe(1)
      const runId = z.string().parse((await reviews())[0]?.id)
      const humanWait = { on: 'human', reason: 'acceptance_human', person: true, runId }
      expect((await tasks()).find((task) => task.id === taskId)?.waitingOn).toEqual(humanWait)
      const review = (await pending()).items[0]
      expect(review).toMatchObject({
        id: `human_review:${runId}`,
        kind: 'human_review',
        objectId: runId,
        taskId,
        reason: 'acceptance_human',
        blocking: true,
        blocks: 2,
        waitingOn: humanWait
      })
      expect(review.actions[0]).toBe('axiom.verification.resolve')
      expect(review.since).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      await desktopCall(page, 'axiom.verification.resolve', {
        runId,
        verdict: 'PASS',
        rationale: 'The example is clear and includes entityId.',
        criteria: [1]
      })
      const after = await tasks()
      expect(after.find((task) => task.id === taskId)?.waitingOn).toEqual({
        on: 'integration',
        reason: 'integration_queue',
        person: false
      })
      expect((await pending()).items.filter((item) => item.kind === 'human_review')).toEqual([])
      expect(after.find((task) => task.id === dependentId)?.waitingOn).toEqual(dependencyWait)
    },
    {
      taskIds: ['T01', 'T04'],
      acceptanceCriteria: [passing, human],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 3
    }
  )
})
