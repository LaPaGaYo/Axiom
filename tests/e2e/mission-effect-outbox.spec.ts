import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { cli, withFixtureMission } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { EffectListResponseSchema } from '../../src/shared/axiom-contract/effects'

test('M3-06: resumes a pending dispatch after restart without consuming another Attempt', async (// oxlint-disable-next-line no-empty-pattern -- The restart fixture owns both app launches.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Controlled fixture requires AXIOM_FIXTURE_REPO and a POSIX host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, mission, userData, ledgerPath, restart }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const list = (status?: string) =>
        EffectListResponseSchema.parse(
          cli(userData, [
            'mission',
            'effect',
            'list',
            '--mission',
            mission.id,
            ...(status ? ['--status', status] : [])
          ])
        ).effects
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      await expect
        .poll(() => list('pending').filter((effect) => effect.kind === 'attempt.dispatch').length)
        .toBe(1)
      const before = inspect()
      const binding = before.bindings[0]
      if (!binding || !restart) {
        throw new Error('Expected one admitted Attempt and a restart fixture')
      }
      expect(binding).toMatchObject({ seq: 1, dispatch_id: null })
      expect(before.tasks).toMatchObject([{ stage: 'RUNNING', attempt_count: 1 }])
      expect(list('pending')[0]).toMatchObject({
        kind: 'attempt.dispatch',
        key: `${binding.task_id}/1`,
        payload: { taskId: binding.task_id, seq: 1, branch: binding.branch },
        attempts: 0
      })
      // Use the frozen agent-crash scenario's successful continuation, as the human-review spec does.
      writeFileSync(`${ledgerPath}.scenario-${binding.task_id}`, 'agent-crash')
      const heldAt = performance.now()
      do {
        await page.waitForTimeout(250)
        const held = inspect()
        expect(held.bindings).toEqual(before.bindings)
        expect(held.audits.filter((audit) => audit.event === 'attempt.started')).toEqual([])
        expect(fixtureLedger(ledgerPath)).toEqual([])
      } while (performance.now() - heldAt < 5_000)
      await restart()
      await expect
        .poll(() => list().find((effect) => effect.kind === 'attempt.dispatch')?.status, {
          timeout: 90_000
        })
        .toBe('done')
      await expect.poll(() => inspect().tasks[0]?.stage, { timeout: 120_000 }).toBe('VERIFIED')
      const after = inspect()
      expect(after.bindings.map((row) => row.seq)).toEqual([1])
      expect(after.bindings[0]).toMatchObject({ branch: binding.branch })
      expect(after.bindings[0]?.dispatch_id).toBeTruthy()
      expect(after.tasks[0]?.attempt_count).toBe(1)
      const starts = after.audits.filter((audit) => audit.event === 'attempt.started')
      expect(starts).toHaveLength(1)
      expect(starts[0]?.object_id).toBe(after.bindings[0]?.dispatch_id)
      expect(JSON.parse(starts[0]?.after ?? '{}')).toMatchObject({ seq: 1 })
      expect(after.submissions).toHaveLength(1)
      expect(
        after.audits.filter((audit) =>
          ['attempt.launch_pending_orphan', 'attempt.launch_failed'].includes(audit.event)
        )
      ).toEqual([])
      const verificationEffects = after.effects.filter(
        (effect) => effect.kind === 'verification.enqueue'
      )
      expect(verificationEffects).toHaveLength(1)
      expect(verificationEffects).toMatchObject([
        {
          key: after.verification[0]?.id,
          status: 'done',
          payload: { runId: after.verification[0]?.id }
        }
      ])
    },
    {
      holdAttemptDispatch: true,
      restart: true,
      runVerification: true,
      taskIds: ['T01'],
      extraAllowedPaths: ['src/services/date-range.ts', 'src/services/date-range.test.ts'],
      acceptanceCriteria: [
        {
          text: 'The date-range examples include entityId',
          check: {
            kind: 'command',
            command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
          }
        }
      ]
    }
  )
})
