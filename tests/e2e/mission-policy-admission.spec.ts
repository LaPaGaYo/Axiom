import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { axiomFixtureRouting } from './helpers/axiom-fixture-provider'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { MissionPendingResponseSchema } from '../../src/shared/axiom-contract/mission-pending'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires POSIX host and AXIOM_FIXTURE_REPO')
const Round = z.object({
  trigger: z.string(),
  admitted: z.array(z.object({ taskId: z.string(), seq: z.number() }))
})

test('M3-09-4c-1: a policy update admits the Task it unblocks without another event', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  if (!source) {
    throw new Error('Missing AXIOM_FIXTURE_REPO')
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, userData, mission }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const started = inspect()
      expect(started.tasks).toHaveLength(2)
      const x = z.string().parse(started.bindings[0]?.task_id)
      const y = z.string().parse(started.tasks.find((task) => task.task_id !== x)?.task_id)
      expect(started.tasks.find((task) => task.task_id === x)?.stage).toBe('RUNNING')
      expect(started.tasks.find((task) => task.task_id === y)?.stage).toBe('READY')
      expect(started.effects.filter((effect) => effect.kind === 'attempt.continue')).toEqual([])
      const waiting = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.show', { taskId: y })
      ).task
      expect(waiting.waitingOn).toMatchObject({ on: 'admission', reason: 'concurrency' })

      // Both workers stay held; only the two policy updates below can unblock Y.
      const disallowedProviders = ['codex', 'claude', 'opencode', 'antigravity']
      expect(
        await desktopCall(page, 'axiom.policy.update', {
          missionId: mission.id,
          patch: { concurrencyLimit: 2, routing: { disallowedProviders } }
        })
      ).toMatchObject({ policy: { concurrencyLimit: 2, routing: { disallowedProviders } } })
      const firstUpdate = inspect().audits.find(
        (audit) =>
          audit.event === 'policy.updated' &&
          audit.sequence > (started.audits.at(-1)?.sequence ?? 0)
      )
      expect(firstUpdate?.object_id).toBe(mission.id)
      const firstSequence = z.number().parse(firstUpdate?.sequence)
      await expect
        .poll(
          () =>
            inspect().audits.some(
              (audit) =>
                audit.event === 'task.admission_refused' &&
                audit.object_id === y &&
                audit.sequence > firstSequence
            ),
          { timeout: 30_000 }
        )
        .toBe(true)
      const pending = MissionPendingResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.pending', { missionId: mission.id })
      )
      expect(pending.items).toContainEqual(
        expect.objectContaining({
          kind: 'task_blocked',
          taskId: y,
          objectId: y,
          reason: 'no_eligible_provider',
          actions: expect.arrayContaining(['axiom.policy.update'])
        })
      )

      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: { routing: axiomFixtureRouting('codex') }
      })
      const secondUpdate = inspect().audits.find(
        (audit) => audit.event === 'policy.updated' && audit.sequence > firstSequence
      )
      expect(secondUpdate?.object_id).toBe(mission.id)
      const secondSequence = z.number().parse(secondUpdate?.sequence)
      const admitsY = (audit: ReturnType<typeof inspect>['audits'][number]) => {
        if (audit.event !== 'scheduler.round' || audit.sequence <= secondSequence) {
          return false
        }
        const round = Round.safeParse(JSON.parse(audit.after ?? '{}'))
        return round.success && round.data.admitted.some((attempt) => attempt.taskId === y)
      }
      let admitted = inspect()
      await expect
        .poll(
          () => {
            admitted = inspect()
            return (
              admitted.bindings.some((binding) => binding.task_id === y && binding.seq === 1) &&
              admitted.tasks.some((task) => task.task_id === y && task.stage === 'RUNNING') &&
              admitted.audits.some(admitsY)
            )
          },
          { timeout: 60_000 }
        )
        .toBe(true)
      expect(
        admitted.bindings.filter((binding) => binding.task_id === y).map((b) => b.seq)
      ).toEqual([1])
      expect(admitted.tasks.find((task) => task.task_id === y)?.stage).toBe('RUNNING')
      const roundAudit = admitted.audits.find(admitsY)
      expect(roundAudit?.object_id).toBe(mission.id)
      const roundSequence = z.number().parse(roundAudit?.sequence)
      expect(roundSequence).toBeGreaterThan(secondSequence)
      expect(Round.parse(JSON.parse(roundAudit?.after ?? '{}'))).toMatchObject({
        trigger: 'policy',
        admitted: [{ taskId: y, seq: 1 }]
      })
      expect(
        admitted.audits.filter(
          (audit) =>
            audit.sequence > firstSequence &&
            audit.sequence < roundSequence &&
            (audit.event === 'mission.status' ||
              (audit.event === 'task.stage' && audit.object_id === x))
        )
      ).toEqual([])
      expect(admitted.effects.filter((effect) => effect.kind === 'attempt.continue')).toEqual([])
    },
    {
      provider: 'codex',
      taskIds: ['T01', 'T02'],
      concurrencyLimit: 1,
      holdWorkers: true
    }
  )
})
