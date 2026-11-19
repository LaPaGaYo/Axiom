import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { FIXTURE_COMMIT, git, withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import type { AcceptanceCriterion } from '../../src/shared/axiom-contract/mission-objects'
import { desktopCall } from './helpers/axiom-desktop-call'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { MissionPendingResponseSchema } from '../../src/shared/axiom-contract/mission-pending'
import { CompletionReportSchema } from '../../src/shared/axiom-contract/completion-report'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'

const passing: AcceptanceCriterion = {
  text: 'The date-range examples include entityId',
  check: {
    kind: 'command',
    command: `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId') ? 0 : 1)"`
  }
}

type Inspection = ReturnType<typeof inspectFixtureMission>
function after(event: Inspection['audits'][number]) {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(event.after ?? '{}'))
}
function activeCandidate(state: Inspection, taskId: string) {
  const candidate = state.candidates.find((c) => c.taskId === taskId && c.status === 'ACTIVE')
  if (!candidate) {
    throw new Error('Missing active Candidate')
  }
  return candidate
}
function batchId(state: Inspection, candidateId: string) {
  return z
    .string()
    .parse(
      state.audits.find(
        (e) => e.event === 'integration.batch_started' && after(e).candidateId === candidateId
      )?.object_id
    )
}

test('M4-2b: a verified Task is integrated and its dependent Task runs from the new head', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
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
      await expect.poll(() => inspect().tasks.length, { timeout: 60_000 }).toBe(2)
      const tasks = inspect().tasks
      const taskId = (id: string) =>
        z
          .string()
          .parse(
            tasks.find((row) => z.object({ id: z.string() }).parse(JSON.parse(row.spec)).id === id)
              ?.task_id
          )
      const firstId = taskId('T01')
      const dependentId = taskId('T04')
      writeFileSync(`${ledgerPath}.scenario-${dependentId}`, 'deterministic-failure')
      releaseWorkers()

      await expect
        .poll(() => inspect().tasks.find((t) => t.task_id === firstId)?.stage, { timeout: 120_000 })
        .toBe('INTEGRATED')
      const firstState = inspect()
      const first = activeCandidate(firstState, firstId)
      const firstBatch = batchId(firstState, first.id)
      const head1 = git(['-C', clone, 'rev-parse', `refs/axiom/batches/${firstBatch}/merged`])
      expect(git(['-C', clone, 'show', '-s', '--format=%P', head1])).toBe(
        `${FIXTURE_COMMIT} ${first.commitSha}`
      )
      await expect
        .poll(
          () =>
            inspect().audits.some(
              (e) => e.event === 'attempt.admitted' && e.object_id === `${dependentId}/1`
            ),
          { timeout: 60_000 }
        )
        .toBe(true)
      const admitted = inspect().audits.find(
        (e) => e.event === 'attempt.admitted' && e.object_id === `${dependentId}/1`
      )!
      const integrated = firstState.audits.find(
        (e) =>
          e.event === 'task.stage' && e.object_id === firstId && after(e).stage === 'INTEGRATED'
      )!
      expect(admitted.sequence).toBeGreaterThan(integrated.sequence)

      await expect
        .poll(() => inspect().tasks.find((t) => t.task_id === dependentId)?.stage, {
          timeout: 180_000
        })
        .toBe('INTEGRATED')
      const second = activeCandidate(inspect(), dependentId)
      const head2 = git(['-C', clone, 'rev-parse', `refs/heads/axiom/integration/${mission.id}`])
      expect(git(['-C', clone, 'show', '-s', '--format=%P', head2])).toBe(
        `${head1} ${second.commitSha}`
      )
      expect(git(['-C', clone, 'merge-base', head1, second.commitSha])).toBe(head1)
      expect(
        git(['-C', clone, 'diff', '--name-only', FIXTURE_COMMIT, head2]).split('\n').sort()
      ).toEqual(['src/domain/recurrence.ts', 'src/services/date-range.ts'])
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(FIXTURE_COMMIT)

      await expect
        .poll(
          () =>
            inspect()
              .effects.filter((e) => e.kind === 'integration.apply')
              .map((e) => e.status),
          { timeout: 30_000 }
        )
        .toEqual(['done', 'done'])
      const state = inspect()
      expect(state.effects.filter((e) => e.kind === 'integration.apply').map((e) => e.key)).toEqual(
        [first.id, second.id]
      )
      expect(
        state.audits
          .filter((e) => e.event === 'task.stage' && e.object_id === firstId)
          .map((e) => after(e).stage)
          .slice(-3)
      ).toEqual(['VERIFIED', 'INTEGRATION_READY', 'INTEGRATED'])
      const regressions = state.verification.filter((run) => run.batchId)
      expect(regressions).toHaveLength(2)
      expect(regressions.map((run) => run.status)).toEqual(['PASS', 'PASS'])
      const secondBatch = batchId(state, second.id)
      for (const [id, head, candidateId] of [
        [firstBatch, head1, first.id],
        [secondBatch, head2, second.id]
      ]) {
        expect(regressions.find((run) => run.batchId === id)?.candidateId).toBe(candidateId)
        expect(
          state.audits
            .filter(
              (e) =>
                e.object_id === id &&
                (e.event.startsWith('integration.batch_') ||
                  e.event.startsWith('integration.regression_'))
            )
            .map((e) => e.event)
        ).toEqual([
          'integration.batch_started',
          'integration.batch_merged',
          'integration.regression_started',
          'integration.batch_promotable',
          'integration.batch_promoted'
        ])
        expect(git(['-C', clone, 'rev-parse', `refs/axiom/batches/${id}/merged`])).toBe(head)
      }
      await expect
        .poll(
          () =>
            git([
              '-C',
              clone,
              'for-each-ref',
              '--format=%(refname)',
              'refs/heads/axiom/integrating/'
            ]),
          { timeout: 30_000 }
        )
        .toBe('')
      const taskList = TaskListResponseSchema.parse(
        await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
      )
      for (const [id, batch, candidateId, mergeCommit] of [
        [firstId, firstBatch, first.id, head1],
        [dependentId, secondBatch, second.id, head2]
      ]) {
        expect(taskList.tasks.find((task) => task.id === id)?.integration).toMatchObject({
          batchId: batch,
          candidateId,
          status: 'PROMOTED',
          mergeCommit,
          conflicts: []
        })
      }
      const missionShow = MissionResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
      )
      expect(missionShow.integration).toEqual({
        branch: `axiom/integration/${mission.id}`,
        recordedHead: head2
      })
      await expect
        .poll(
          async () => {
            const shown = MissionResponseSchema.parse(
              await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
            )
            return {
              status: shown.mission.status,
              outcome: shown.finalization?.outcome,
              integrationHead: shown.finalization?.integrationHead,
              targetHead: shown.finalization?.targetHead,
              gate: shown.finalization?.gate?.map((item) => item.pass)
            }
          },
          { timeout: 30_000 }
        )
        .toEqual({
          status: 'READY_FOR_APPROVAL',
          outcome: 'ready',
          integrationHead: head2,
          targetHead: FIXTURE_COMMIT,
          gate: Array(8).fill(true)
        })
      const ready = MissionResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
      ).finalization
      expect(ready).toHaveProperty('reportArtifactId', expect.any(String))
      if (ready?.outcome !== 'ready' || !ready.reportArtifactId) {
        throw new Error('Missing completion report')
      }
      const artifact = ArtifactReadResponseSchema.parse(
        await desktopCall(page, 'axiom.artifact.read', { id: ready.reportArtifactId })
      )
      const bytes = Buffer.from(artifact.contentBase64, 'base64')
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(ready.reportSha256)
      const report = CompletionReportSchema.parse(JSON.parse(bytes.toString('utf8')))
      expect(report.commits).toEqual({
        integrationHead: head2,
        targetHead: FIXTURE_COMMIT,
        promoted: [head1, head2]
      })
      expect(report.tasks).toHaveLength(2)
      for (const [taskId, mergeCommit] of [
        [firstId, head1],
        [dependentId, head2]
      ]) {
        expect(report.tasks.find((task) => task.taskId === taskId)).toMatchObject({
          stage: 'INTEGRATED',
          integration: { mergeCommit }
        })
      }
      await expect
        .poll(
          () =>
            inspect()
              .effects.filter((e) => e.kind === 'mission.finalize')
              .map((e) => e.status),
          { timeout: 30_000 }
        )
        .toEqual(['done'])
      expect(git(['-C', clone, 'rev-parse', 'refs/heads/main'])).toBe(FIXTURE_COMMIT)
      const approval = MissionResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
      ).approval
      expect(approval).toMatchObject({
        status: 'PENDING',
        actionKind: 'delivery',
        inputsHash: ready.reportSha256
      })
      const pending = MissionPendingResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.pending', { missionId: mission.id })
      )
      expect(pending.items.map((item) => item.reason)).toContain('delivery_approval_pending')
      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list', exact: true })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      const integration = page.getByRole('region', { name: 'Integration', exact: true })
      await expect(integration).toContainText(`axiom/integration/${mission.id}`, {
        timeout: 30_000
      })
      const recordedHead = integration.getByTestId('integration-recorded-head')
      await expect(recordedHead).toHaveText(head2.slice(0, 7), { timeout: 30_000 })
      await expect(recordedHead).toHaveAttribute('title', head2, { timeout: 30_000 })
      for (const [id, head] of [
        [firstId, head1],
        [dependentId, head2]
      ]) {
        const row = integration.locator(`[data-integration-task-id="${id}"]`)
        await expect(row).toHaveAttribute('data-integration-status', 'PROMOTED', {
          timeout: 30_000
        })
        await expect(row).toContainText(head.slice(0, 7), { timeout: 30_000 })
      }
      await integration.locator(`[data-integration-task-id="${firstId}"]`).click()
      const detail = page.getByRole('region', { name: 'Task detail', exact: true })
      await expect(detail).toBeVisible({ timeout: 30_000 })
      await detail.locator('[data-task-stage="INTEGRATED"]').click()
      const verification = detail.getByRole('region', { name: 'Verification', exact: true })
      await expect(verification).toBeFocused({ timeout: 30_000 })
      const regression = verification.getByRole('region', {
        name: 'Merged-tree regression',
        exact: true
      })
      await expect(regression).toContainText(head1.slice(0, 7), { timeout: 30_000 })
      const rows = regression
        .getByRole('table', { name: 'Regression runs', exact: true })
        .locator('tbody tr')
      await expect(rows).toHaveCount(1, { timeout: 30_000 })
      await expect(rows.first()).toContainText('PASS', { timeout: 30_000 })
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
