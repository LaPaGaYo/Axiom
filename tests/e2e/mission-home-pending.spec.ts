import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { desktopCall } from './helpers/axiom-desktop-call'
import { captureDetail } from './helpers/axiom-task-detail-capture'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { makeProposal, goal } from '../../src/shared/axiom-contract/contract-fixtures.test-support'
import {
  AxiomIdSchema,
  type AcceptanceCriterion
} from '../../src/shared/axiom-contract/mission-objects'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import {
  MissionPendingResponseSchema,
  type MissionPendingItem,
  type PendingAction
} from '../../src/shared/axiom-contract/mission-pending'
import {
  TaskListResponseSchema,
  TaskResponseSchema
} from '../../src/shared/axiom-contract/task-params'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'

test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' } })
const kinds: Record<MissionPendingItem['kind'], string> = {
  mission: 'Mission',
  plan_review: 'Plan review',
  question: 'Question',
  human_review: 'Review',
  task_blocked: 'Blocked Task',
  subtask_request: 'Subtask request',
  follow_up: 'Follow-up',
  stall_notice: 'Stall notice',
  supervision_proposal: 'Supervision proposal'
}
const labels: Record<PendingAction, string> = {
  'axiom.mission.start': 'Start Mission',
  'axiom.mission.resume': 'Resume Mission',
  'axiom.mission.plan': 'Start Planner',
  'axiom.mission.cancel': 'Cancel Mission',
  'axiom.plan.approve': 'Approve plan',
  'axiom.plan.reject': 'Reject plan',
  'axiom.message.answer': 'Answer',
  'axiom.message.resolve': 'Accept or reject',
  'axiom.verification.resolve': 'Resolve review',
  'axiom.verification.rerun': 'Rerun verification',
  'axiom.task.adjust': 'Adjust Task',
  'axiom.task.cancel': 'Cancel Task',
  'axiom.policy.update': 'Update policy',
  'axiom.supervision.resolve': 'Resolve proposal'
}
async function assertPending(page: Page, missionId: string) {
  const { items } = MissionPendingResponseSchema.parse(
    await desktopCall(page, 'axiom.mission.pending', { missionId })
  )
  const home = page.getByRole('region', { name: 'Mission Home', exact: true })
  await expect(home.getByText(`${items.length} pending item(s)`, { exact: true })).toBeVisible()
  const list = home.getByRole('list', { name: 'Pending items', exact: true })
  await expect(list).toHaveCount(items.length ? 1 : 0)
  if (!items.length) {
    return items
  }
  const rows = list.getByRole('listitem')
  await expect(rows).toHaveCount(items.length)
  for (const [i, item] of items.entries()) {
    const row = rows.nth(i)
    await expect(row.getByText(kinds[item.kind], { exact: true })).toBeVisible()
    await expect(row.getByText(item.reason, { exact: true })).toHaveClass(/font-mono/)
    await expect(row.getByText(/^Blocks \d+ Task\(s\)$/)).toHaveText(
      item.blocking && item.blocks > 0 ? [`Blocks ${item.blocks} Task(s)`] : []
    )
    await expect(row.getByText('Not blocking', { exact: true })).toHaveCount(item.blocking ? 0 : 1)
    await expect(row.getByText(/^You can:/)).toHaveText(
      item.actions.length
        ? [`You can: ${item.actions.map((action) => labels[action]).join(', ')}`]
        : []
    )
    for (const action of item.actions) {
      await expect(row.getByRole('button', { name: labels[action], exact: true })).toHaveCount(0)
    }
  }
  return items
}
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

test('M3-09-3a: Mission Home explains a review that blocks two Tasks and opens its actions', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(295_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const { page, mission } = f
      const inspect = () => inspectFixtureMission(f.userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = AxiomIdSchema.parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${f.ledgerPath}.scenario-${taskId}`, 'agent-crash')
      f.releaseWorkers()
      const reviews = async () =>
        VerificationListResponseSchema.parse(
          await desktopCall(page, 'axiom.verification.list', {
            missionId: mission.id,
            taskId,
            status: 'HUMAN_REVIEW'
          })
        ).runs
      await expect.poll(async () => (await reviews()).length, { timeout: 90_000 }).toBe(1)
      const tasks = TaskListResponseSchema.parse(
        await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
      ).tasks
      const reviewed = tasks.find((task) => task.id === taskId)!
      const dependent = tasks.find((task) => task.id !== taskId)!
      expect(reviewed.waitingOn).toMatchObject({
        on: 'human',
        reason: 'acceptance_human',
        person: true
      })
      expect(dependent.waitingOn).toMatchObject({
        on: 'dependency',
        reason: 'upstream_not_integrated',
        person: false
      })
      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list' })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      const home = page.getByRole('region', { name: 'Mission Home', exact: true })
      await expect(home).toBeVisible()
      const items = await assertPending(page, mission.id)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        kind: 'human_review',
        taskId,
        reason: 'acceptance_human',
        blocks: 2,
        blocking: true,
        actions: [
          'axiom.verification.resolve',
          'axiom.verification.rerun',
          'axiom.task.adjust',
          'axiom.task.cancel'
        ]
      })
      await expect(home.getByText('Blocks 2 Task(s)', { exact: true })).toBeVisible()
      await expect(
        home.getByText('Waiting for a person to review or resolve this Task.', { exact: true })
      ).toBeVisible()
      for (const action of items[0].actions) {
        await expect(home.getByRole('button', { name: labels[action], exact: true })).toHaveCount(0)
      }
      const table = page.getByRole('table', { name: 'Tasks', exact: true })
      const reviewedRow = table.locator(`tbody tr[data-task-id="${taskId}"]`)
      const dependentRow = table.locator(`tbody tr[data-task-id="${dependent.id}"]`)
      await expect(reviewedRow).toContainText('human · acceptance_human')
      await expect(reviewedRow.getByText('Needs a person', { exact: true })).toBeVisible()
      await expect(dependentRow).toContainText('dependency · upstream_not_integrated')
      await expect(dependentRow.getByText('Needs a person', { exact: true })).toHaveCount(0)
      await captureDetail(page, testInfo, 'mission-home-review', 'Mission Home')
      await captureDetail(page, testInfo, 'mission-tasks-review', 'Tasks')
      await home.getByRole('button', { name: reviewed.title, exact: true }).click()
      const detail = page.getByRole('region', { name: 'Task detail', exact: true })
      const actions = detail.getByRole('region', { name: 'Task actions', exact: true })
      const actionLabels = ['Resolve review', 'Rerun verification', 'Adjust Task', 'Cancel Task']
      await expect(actions.getByRole('button')).toHaveText(actionLabels)
      await actions.getByRole('button', { name: 'Adjust Task', exact: true }).click()
      const adjustment = actions.getByRole('form', { name: 'Adjust Task', exact: true })
      await adjustment.getByRole('textbox', { name: 'New Attempt limit', exact: true }).fill('4')
      const adjustmentRationale = 'Allow another Attempt while this review remains open.'
      await adjustment
        .getByRole('textbox', { name: 'Rationale', exact: true })
        .fill(adjustmentRationale)
      await adjustment.getByRole('button', { name: 'Apply adjustment', exact: true }).click()
      await expect(adjustment).toHaveCount(0)
      await expect(actions.getByRole('button', { name: 'Adjust Task', exact: true })).toBeFocused()
      await expect(actions.getByRole('button')).toHaveText(actionLabels)
      const audits = inspect().audits.filter(
        (audit) => audit.event === 'task.adjusted' && audit.object_id === taskId
      )
      expect(audits).toHaveLength(1)
      expect(
        z
          .object({ maxAttempts: z.number(), rationale: z.string() })
          .parse(JSON.parse(audits[0].after ?? '{}'))
      ).toEqual({ maxAttempts: 4, rationale: adjustmentRationale })
      const adjusted = TaskResponseSchema.parse(
        await desktopCall(page, 'axiom.task.show', { taskId })
      ).task
      expect(adjusted.spec?.retryPolicy.maxAttempts).toBe(4)
      expect(await assertPending(page, mission.id)).toHaveLength(1)
      await actions.getByRole('button', { name: 'Resolve review', exact: true }).click()
      const resolution = actions.getByRole('form', { name: 'Resolve review', exact: true })
      await resolution.getByRole('radio', { name: 'PASS', exact: true }).click()
      await resolution.getByRole('checkbox', { name: `#1 · ${human.text}`, exact: true }).check()
      await resolution
        .getByRole('textbox', { name: 'Rationale', exact: true })
        .fill('The example is clear and includes entityId.')
      await resolution.getByRole('button', { name: 'Submit resolution', exact: true }).click()
      await expect(home.getByText('0 pending item(s)', { exact: true })).toBeVisible()
      expect(await assertPending(page, mission.id)).toHaveLength(0)
      await expect(reviewedRow).toContainText('integration · integration_queue')
      await expect(reviewedRow.locator('[data-task-stage]')).toHaveAttribute(
        'data-task-stage',
        'VERIFIED'
      )
      await expect(dependentRow).toContainText('dependency · upstream_not_integrated')
      const after = TaskListResponseSchema.parse(
        await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
      ).tasks
      expect(after.find((task) => task.id === taskId)).toMatchObject({
        stage: 'VERIFIED',
        waitingOn: { on: 'integration', reason: 'integration_queue' }
      })
      expect(after.find((task) => task.id === dependent.id)?.waitingOn).toMatchObject({
        on: 'dependency',
        reason: 'upstream_not_integrated'
      })
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

test('M3-09-3a: Mission Home explains the next human step before a Mission runs', async ({
  orcaPage: page,
  seededRepoPath
}) => {
  await waitForSessionReady(page)
  await page.getByRole('button', { name: 'Missions', exact: true }).click()
  await page.getByRole('button', { name: 'Create Mission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create Mission' })
  await dialog.getByLabel('Repository path').fill(seededRepoPath)
  await dialog.getByLabel('Target branch').fill('main')
  await dialog.getByLabel('Goal objective').fill(goal.objective)
  await dialog.getByLabel('Acceptance criteria').fill(goal.acceptanceCriteria.join('\n'))
  await dialog.getByRole('button', { name: 'Create Mission', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const home = page.getByRole('region', { name: 'Mission Home', exact: true })
  await expect(home).toBeVisible()
  const missionId = AxiomIdSchema.parse(
    await page.evaluate(() => window.__store?.getState().selectedMissionId)
  )
  const { mission } = MissionResponseSchema.parse(
    await desktopCall(page, 'axiom.mission.show', { missionId })
  )
  const initial = await assertPending(page, missionId)
  expect(initial).toHaveLength(1)
  expect(initial[0]).toMatchObject({
    kind: 'mission',
    reason: 'ANALYZING',
    actions: ['axiom.mission.plan', 'axiom.mission.cancel']
  })
  await expect(
    home.getByText('You can: Start Planner, Cancel Mission', { exact: true })
  ).toBeVisible()
  const { provenance, ...proposal } = makeProposal()
  PlanResponseSchema.parse(
    await desktopCall(page, 'axiom.plan.propose', {
      missionId,
      planRevision: {
        ...proposal,
        goalRevisionId: AxiomIdSchema.parse(mission.activeGoalRevisionId)
      },
      provenance
    })
  )
  await page.getByRole('button', { name: 'Refresh Missions', exact: true }).click()
  await expect(page.locator('[data-mission-status]')).toHaveText('Plan review')
  const proposed = await assertPending(page, missionId)
  expect(proposed).toHaveLength(1)
  expect(proposed[0]).toMatchObject({
    kind: 'plan_review',
    reason: 'PLAN_REVIEW',
    actions: ['axiom.plan.approve', 'axiom.plan.reject']
  })
  await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(page.locator('[data-mission-status]')).toHaveText('Planned')
  const planned = await assertPending(page, missionId)
  expect(planned).toHaveLength(1)
  expect(planned[0]).toMatchObject({
    kind: 'mission',
    reason: 'PLANNED',
    blocking: true,
    blocks: 12,
    actions: ['axiom.mission.start', 'axiom.mission.cancel']
  })
  await expect(home.getByText('Blocks 12 Task(s)', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('table', { name: 'Tasks', exact: true }).locator('tbody tr')
  ).toHaveCount(12)
  await expect(page.getByRole('button', { name: 'Start Mission', exact: true })).toHaveCount(1)
})
