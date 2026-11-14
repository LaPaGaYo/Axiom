import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { captureDetail } from './helpers/axiom-task-detail-capture'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import {
  AxiomIdSchema,
  type AcceptanceCriterion
} from '../../src/shared/axiom-contract/mission-objects'
import { MessageListResponseSchema } from '../../src/shared/axiom-contract/message-params'
import {
  TaskListResponseSchema,
  TaskResponseSchema
} from '../../src/shared/axiom-contract/task-params'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'

type Fixture = Parameters<Parameters<typeof withFixtureMission>[2]>[0]
const source = process.env.AXIOM_FIXTURE_REPO
const testPath = 'src/services/date-range.test.ts'
// Frozen S4 patch 2 moves the empty entityId example to the rejected list, as in mission-task-adjust.
const check = `node -e "process.exit(require('node:fs').readFileSync('src/services/date-range.test.ts','utf8').includes('entityId: \\'\\' }, { from') ? 0 : 1)"`
const scopeText =
  'The Worker asked for paths outside the scope of the Task. Add them and the next Attempt can continue.'
const cancelText =
  'Canceling stops the running Attempt of this Task. Its work is not integrated, and a canceled Task cannot be resumed.'
const dependentText = 'Tasks that depend on it: 1. They wait until a person cancels them too.'
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

async function readTask(f: Fixture, taskId: string) {
  return TaskResponseSchema.parse(await desktopCall(f.page, 'axiom.task.show', { taskId })).task
}
async function pendingMessages(f: Fixture, taskId: string) {
  return MessageListResponseSchema.parse(
    await desktopCall(f.page, 'axiom.message.list', {
      missionId: f.mission.id,
      taskId,
      pendingOnly: true
    })
  ).messages
}
async function releaseScenario(f: Fixture, scenario: string) {
  const inspect = () => inspectFixtureMission(f.userData, f.mission.id)
  await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
  const taskId = AxiomIdSchema.parse(inspect().bindings[0]?.task_id)
  writeFileSync(`${f.ledgerPath}.scenario-${taskId}`, scenario)
  f.releaseWorkers()
  return taskId
}
async function openDetail(page: Page, missionId: string, taskId: string) {
  await page.getByRole('button', { name: 'Missions', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Mission list' })
    .getByRole('button')
    .filter({ hasText: missionId })
    .click()
  await expect(page.getByRole('heading', { name: 'Mission Home' })).toBeVisible()
  await page
    .getByRole('table', { name: 'Tasks', exact: true })
    .locator(`tbody tr[data-task-id="${taskId}"]`)
    .click()
  return page.getByRole('region', { name: 'Task detail', exact: true })
}
const stageAudit = z.object({ stage: z.string(), reason: z.string() })
const adjustmentAudit = z.object({
  addedPaths: z.array(z.string()),
  rationale: z.string(),
  maxAttempts: z.number()
})
const resolvedAudit = z.object({
  decision: z.string(),
  taskId: AxiomIdSchema,
  rationale: z.string()
})

for (const maxAttempts of [3, 2]) {
  test(`M3-09-2b-3: a person adjusts a scope-blocked Task with ${maxAttempts} Attempts`, async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
  {}, testInfo) => {
    test.setTimeout(300_000)
    if (!source || process.platform === 'win32') {
      test.skip(true, 'Requires a POSIX fixture host')
      return
    }
    await withFixtureMission(
      testInfo,
      source,
      async (f) => {
        const taskId = await releaseScenario(f, 'blocked-scope')
        const inspect = () => inspectFixtureMission(f.userData, f.mission.id)
        await expect
          .poll(async () => (await readTask(f, taskId)).stage, { timeout: 180_000 })
          .toBe('BLOCKED')
        const stage = inspect().audits.findLast(
          (a) => a.event === 'task.stage' && a.object_id === taskId
        )!
        expect(stageAudit.parse(JSON.parse(stage.after!))).toMatchObject({
          stage: 'BLOCKED',
          reason: 'scope'
        })
        const messages = await pendingMessages(f, taskId)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({
          taskId,
          type: 'BLOCKED',
          pending: true,
          blocked: { reason: 'blocked_by_scope', paths: [testPath] }
        })
        const before = await readTask(f, taskId)
        expect(before.spec).toBeDefined()
        const detail = await openDetail(f.page, f.mission.id, taskId)
        const actions = detail.getByRole('region', { name: 'Task actions' })
        await expect(actions.getByRole('button')).toHaveText([
          'Adjust Task',
          'Rerun verification',
          'Cancel Task'
        ])
        await actions.getByRole('button', { name: 'Adjust Task', exact: true }).click()
        const form = detail.getByRole('form', { name: 'Adjust Task' })
        for (const path of before.spec!.scope.allowedPaths) {
          await expect(form.getByText(path, { exact: true })).toBeVisible()
        }
        await expect(form.getByText('Attempt limit', { exact: true }).locator('..')).toContainText(
          String(maxAttempts)
        )
        await expect(form.getByText(scopeText, { exact: true })).toBeVisible()
        const paths = form.getByRole('textbox', { name: 'Allowed paths to add', exact: true })
        await expect(paths).toHaveValue(testPath)
        await expect(paths).toBeFocused()
        const rationale = `The failing fixture check needs this path; limit ${maxAttempts}.`
        await form.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale)
        if (maxAttempts === 3) {
          await captureDetail(f.page, testInfo, 'scope-adjust-form')
        }
        await form.getByRole('button', { name: 'Apply adjustment', exact: true }).click()
        if (maxAttempts === 2) {
          await expect(f.page.getByRole('main').getByRole('alert')).toContainText(
            'retry_budget_exhausted'
          )
          await expect(form).toBeVisible()
          await expect(paths).toHaveValue(testPath)
          await expect(form.getByRole('textbox', { name: 'Rationale', exact: true })).toHaveValue(
            rationale
          )
          expect((await readTask(f, taskId)).stage).toBe('BLOCKED')
          expect(
            inspect().audits.filter((a) => a.event === 'task.adjusted' && a.object_id === taskId)
          ).toHaveLength(0)
          expect(await pendingMessages(f, taskId)).toEqual(messages)
          await form.getByRole('textbox', { name: 'New Attempt limit', exact: true }).fill('3')
          await form.getByRole('button', { name: 'Apply adjustment', exact: true }).click()
        }
        await expect(actions).toHaveCount(0)
        await expect(detail).toBeFocused()
        const adjusted = inspect().audits.filter(
          (a) => a.event === 'task.adjusted' && a.object_id === taskId
        )
        expect(adjusted).toHaveLength(1)
        expect(adjustmentAudit.parse(JSON.parse(adjusted[0]!.after!))).toEqual({
          addedPaths: [testPath],
          rationale,
          maxAttempts: 3
        })
        const resolved = inspect().audits.filter(
          (a) => a.event === 'blocked.resolved' && a.object_id === messages[0]!.id
        )
        expect(resolved).toHaveLength(1)
        expect(resolvedAudit.parse(JSON.parse(resolved[0]!.after!))).toEqual({
          decision: 'adjusted',
          taskId,
          rationale
        })
        expect(await pendingMessages(f, taskId)).toEqual([])
        await expect
          .poll(async () => (await readTask(f, taskId)).stage, { timeout: 120_000 })
          .toBe('VERIFIED')
      },
      {
        taskIds: ['T01'],
        holdWorkers: true,
        runVerification: true,
        releaseTerminals: true,
        maxAttempts,
        extraAllowedPaths: ['src/services/date-range.ts'],
        acceptanceCriteria: [
          {
            text: 'The date-range contract rejects an empty entityId',
            check: { kind: 'command', command: check }
          }
        ]
      }
    )
  })
}

test('M3-09-2b-3: a person cancels a Task and sees what its dependent Task needs', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const taskId = await releaseScenario(f, 'agent-crash')
      const reviews = async () =>
        VerificationListResponseSchema.parse(
          await desktopCall(f.page, 'axiom.verification.list', {
            missionId: f.mission.id,
            taskId,
            status: 'HUMAN_REVIEW'
          })
        ).runs
      await expect.poll(async () => (await reviews()).length, { timeout: 120_000 }).toBe(1)
      expect((await reviews())[0]?.verdictDetail.reason).toBe('acceptance_human')
      const tasks = TaskListResponseSchema.parse(
        await desktopCall(f.page, 'axiom.task.list', { missionId: f.mission.id })
      ).tasks
      const dependent = tasks.find((task) => task.id !== taskId)!
      const detail = await openDetail(f.page, f.mission.id, taskId)
      const actions = detail.getByRole('region', { name: 'Task actions' })
      await expect(actions.getByRole('button')).toHaveText([
        'Resolve review',
        'Rerun verification',
        'Adjust Task',
        'Cancel Task'
      ])
      await actions.getByRole('button', { name: 'Cancel Task', exact: true }).click()
      const form = detail.getByRole('form', { name: 'Cancel Task' })
      await expect(form.getByText(cancelText, { exact: true })).toBeVisible()
      await expect(form.getByText(dependentText, { exact: true })).toBeVisible()
      const rationale = 'This Task is no longer needed; review the dependent Task separately.'
      await form.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale)
      await captureDetail(f.page, testInfo, 'cancel-task-form')
      const before = inspectFixtureMission(f.userData, f.mission.id)
      await form.getByRole('button', { name: 'Cancel Task', exact: true }).click()
      const dialog = f.page.getByRole('dialog', { name: 'Cancel Task', exact: true })
      await expect(dialog).toContainText(`${cancelText} ${dependentText}`)
      await dialog.getByRole('button', { name: 'Keep Task', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect((await readTask(f, taskId)).stage).toBe('VERIFYING')
      expect(inspectFixtureMission(f.userData, f.mission.id).audits).toEqual(before.audits)
      await expect(form.getByRole('textbox', { name: 'Rationale', exact: true })).toHaveValue(
        rationale
      )
      await form.getByRole('button', { name: 'Cancel Task', exact: true }).click()
      await dialog.getByRole('button', { name: 'Cancel Task', exact: true }).click()
      await expect(actions).toHaveCount(0)
      expect((await readTask(f, taskId)).stage).toBe('CANCELED')
      const stage = inspectFixtureMission(f.userData, f.mission.id).audits.findLast(
        (a) => a.event === 'task.stage' && a.object_id === taskId
      )!
      expect(stageAudit.parse(JSON.parse(stage.after!))).toEqual({
        stage: 'CANCELED',
        reason: rationale
      })
      await f.page
        .getByRole('table', { name: 'Tasks', exact: true })
        .locator(`tbody tr[data-task-id="${dependent.id}"]`)
        .click()
      await expect(detail.getByRole('region', { name: 'Waiting on', exact: true })).toContainText(
        'dependency · upstream_canceled'
      )
      await expect(actions.getByRole('button')).toHaveText(['Cancel Task'])
      await captureDetail(f.page, testInfo, 'dependent-upstream-canceled')
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
