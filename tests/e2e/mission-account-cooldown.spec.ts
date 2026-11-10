import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { ProviderFilterReasonSchema } from '../../src/shared/axiom-contract/agent-spec'
import { EffectTimestampSchema } from '../../src/shared/axiom-contract/effects'
import { TuiAgentIdSchema } from '../../src/shared/axiom-contract/mission-objects'

const source = process.env.AXIOM_FIXTURE_REPO
test.skip(!source || process.platform === 'win32', 'Requires POSIX host and AXIOM_FIXTURE_REPO')
const Refusal = z.object({
  filtered: z.array(
    z.strictObject({ provider: TuiAgentIdSchema, reason: ProviderFilterReasonSchema })
  ),
  accountCooldown: z.array(
    z.strictObject({ provider: TuiAgentIdSchema, until: EffectTimestampSchema })
  )
})

test('M3-06-2a-2: a waiting account holds new work until its continuation comes due', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  if (!source) {
    throw new Error('Missing AXIOM_FIXTURE_REPO')
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const started = inspect()
      expect(started.tasks).toHaveLength(2)
      const x = z.string().parse(started.bindings[0]?.task_id)
      const y = z.string().parse(started.tasks.find((task) => task.task_id !== x)?.task_id)
      writeFileSync(`${ledgerPath}.interrupt-${x}`, '1')
      // Existing mission-verification.spec.ts exercises this frozen success patch at seq 1;
      // mission-interrupted-continuation.spec.ts exercises it after interruptions (seq >= 2).
      for (const id of [x, y]) {
        writeFileSync(`${ledgerPath}.scenario-${id}`, 'agent-crash')
      }
      releaseWorkers()
      let waiting = inspect()
      let observedAt = Date.now()
      await expect
        .poll(
          () => {
            waiting = inspect()
            observedAt = Date.now()
            return (
              waiting.effects.some(
                (effect) =>
                  effect.kind === 'attempt.continue' &&
                  effect.payload.taskId === x &&
                  effect.status === 'pending' &&
                  Date.parse(effect.dueAt) > observedAt
              ) &&
              waiting.audits.some(
                (audit) =>
                  audit.event === 'task.admission_refused' &&
                  audit.object_id === y &&
                  Refusal.safeParse(JSON.parse(audit.after ?? '{}')).success
              )
            )
          },
          { timeout: 60_000, intervals: [100] }
        )
        .toBe(true)
      const continuation = waiting.effects.find(
        (effect) => effect.kind === 'attempt.continue' && effect.payload.taskId === x
      )
      if (!continuation || continuation.kind !== 'attempt.continue') {
        throw new Error('Missing continuation')
      }
      expect(continuation.status).toBe('pending')
      expect(Date.parse(continuation.dueAt)).toBeGreaterThan(observedAt)
      expect(continuation.payload).toMatchObject({
        taskId: x,
        seq: 1,
        chain: 1,
        failureClass: 'usage_limit',
        account: { provider: 'codex', key: expect.stringMatching(/^[a-f0-9]{64}$/) }
      })
      expect(waiting.tasks.find((task) => task.task_id === y)?.stage).toBe('READY')
      expect(waiting.bindings.filter((binding) => binding.task_id === y)).toEqual([])
      expect(
        waiting.bindings.filter((binding) => binding.task_id === x).map((binding) => binding.seq)
      ).toEqual([1])
      const refused = waiting.audits.find(
        (audit) =>
          audit.event === 'task.admission_refused' &&
          audit.object_id === y &&
          Refusal.safeParse(JSON.parse(audit.after ?? '{}')).success
      )
      const evidence = Refusal.parse(JSON.parse(refused?.after ?? '{}'))
      expect(evidence.filtered).toContainEqual({ provider: 'codex', reason: 'account_cooldown' })
      expect(evidence.accountCooldown).toEqual([{ provider: 'codex', until: continuation.dueAt }])
      // From releaseWorkers onward the test only observes; the outbox supplies the wakeup.
      await expect.poll(() => inspect().submissions.length, { timeout: 120_000 }).toBe(2)
      const completed = inspect()
      expect(completed.submissions.map((submission) => submission.taskId).sort()).toEqual(
        [x, y].sort()
      )
      expect(
        completed.bindings.filter((binding) => binding.task_id === y).map((binding) => binding.seq)
      ).toEqual([1])
      expect(
        completed.bindings.filter((binding) => binding.task_id === x).map((binding) => binding.seq)
      ).toEqual([1, 2])
      const admitted = completed.audits.find(
        (audit) => audit.event === 'attempt.admitted' && audit.object_id === `${y}/1`
      )
      expect(Date.parse(z.string().parse(admitted?.created_at))).toBeGreaterThanOrEqual(
        Date.parse(continuation.dueAt)
      )
    },
    {
      provider: 'codex',
      taskIds: ['T01', 'T02'],
      concurrencyLimit: 1,
      holdWorkers: true,
      releaseTerminals: true,
      maxAttempts: 1,
      interruptionBackoffMs: [10_000, 20_000, 30_000],
      extraAllowedPaths: ['src/services/date-range.ts', 'src/services/date-range.test.ts']
    }
  )
})
