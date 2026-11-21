import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { FIXTURE_COMMIT, git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { ArtifactListResponseSchema } from '../../src/shared/axiom-contract/artifact-params'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { MissionPendingResponseSchema } from '../../src/shared/axiom-contract/mission-pending'
import type { AcceptanceCriterion } from '../../src/shared/axiom-contract/mission-objects'

const passing: AcceptanceCriterion = {
  text: 'The date-range examples include entityId',
  check: {
    kind: 'command',
    command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
  }
}

test('M4-6a: a moved target branch stops finalization and the Mission says why', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test['skip'](true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ page, mission, clone, userData, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const show = async () =>
        MissionResponseSchema.parse(
          await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
        )
      await expect.poll(() => inspect().tasks.length, { timeout: 60_000 }).toBe(2)
      const dependentId = z
        .string()
        .parse(
          inspect().tasks.find(
            (row) => z.object({ id: z.string() }).parse(JSON.parse(row.spec)).id === 'T04'
          )?.task_id
        )
      writeFileSync(`${ledgerPath}.scenario-${dependentId}`, 'deterministic-failure')
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(FIXTURE_COMMIT)
      git([
        '-C',
        clone,
        '-c',
        'user.name=Finalization Fixture',
        '-c',
        'user.email=finalization@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'Advance the target during the Mission'
      ])
      const targetHead = git(['-C', clone, 'rev-parse', 'refs/heads/main'])
      expect(targetHead).not.toBe(FIXTURE_COMMIT)
      releaseWorkers()
      await expect
        .poll(() => inspect().tasks.map((task) => task.stage), { timeout: 300_000 })
        .toEqual(['INTEGRATED', 'INTEGRATED'])
      const integrationHead = git([
        '-C',
        clone,
        'rev-parse',
        `refs/heads/axiom/integration/${mission.id}`
      ])
      await expect
        .poll(
          async () => {
            const shown = await show()
            return {
              status: shown.mission.status,
              finalization: shown.finalization && {
                outcome: shown.finalization.outcome,
                reason:
                  shown.finalization.outcome === 'stopped' ? shown.finalization.reason : undefined,
                targetHead: shown.finalization.targetHead,
                integrationHead: shown.finalization.integrationHead
              }
            }
          },
          { timeout: 30_000 }
        )
        .toEqual({
          status: 'FINALIZING',
          finalization: {
            outcome: 'stopped',
            reason: 'target_branch_moved',
            targetHead,
            integrationHead
          }
        })
      await expect
        .poll(
          () =>
            inspect()
              .effects.filter((effect) => effect.kind === 'mission.finalize')
              .map((effect) => effect.status),
          { timeout: 30_000 }
        )
        .toEqual(['done'])
      const stopped = await show()
      expect(stopped.approval).toBeUndefined()
      expect(stopped.finalization).not.toHaveProperty('reportArtifactId')
      const reports = ArtifactListResponseSchema.parse(
        await desktopCall(page, 'axiom.artifact.list', {
          missionId: mission.id,
          kind: 'completion_report'
        })
      )
      expect(reports.artifacts).toEqual([])
      expect(stopped.mission.status).toBe('FINALIZING')
      expect(
        inspect().audits.some(
          (event) =>
            event.event === 'mission.status' &&
            z.object({ status: z.string() }).parse(JSON.parse(event.after ?? '{}')).status ===
              'READY_FOR_APPROVAL'
        )
      ).toBe(false)
      const pending = MissionPendingResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.pending', { missionId: mission.id })
      )
      expect(pending.items).toHaveLength(1)
      expect(pending.items[0]).toMatchObject({
        kind: 'mission',
        objectId: mission.id,
        reason: 'target_branch_moved',
        blocking: true,
        actions: ['axiom.mission.cancel'],
        since: stopped.finalization!.at
      })
      for (const text of ['main', targetHead.slice(0, 7), integrationHead.slice(0, 7)]) {
        expect(pending.items[0].summary).toContain(text)
      }
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(targetHead)
      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list', exact: true })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      const finalization = page.getByRole('region', { name: 'Finalization', exact: true })
      await expect(finalization.locator('[data-finalization-outcome="stopped"]')).toBeVisible({
        timeout: 30_000
      })
      for (const text of [
        'target_branch_moved',
        targetHead.slice(0, 7),
        integrationHead.slice(0, 7),
        'The completion gate was not evaluated.'
      ]) {
        await expect(finalization).toContainText(text, { timeout: 30_000 })
      }
      await expect(
        finalization.getByRole('button', { name: 'Show report', exact: true })
      ).toHaveCount(0, { timeout: 30_000 })
      const canceled = MissionResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.cancel', {
          missionId: mission.id,
          reason: 'Target alignment is deferred'
        })
      )
      expect(canceled.mission.status).toBe('CANCELED')
    },
    {
      taskIds: ['T01', 'T04'],
      acceptanceCriteria: [passing],
      holdWorkers: true,
      runVerification: true,
      runIntegration: true,
      extraAllowedPaths: ['src/services/date-range.ts', 'src/domain/recurrence.ts']
    }
  )
})
