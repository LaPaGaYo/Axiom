import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { captureDetail } from './helpers/axiom-task-detail-capture'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { AttemptListResponseSchema } from '../../src/shared/axiom-contract/attempt-params'
import {
  TaskListResponseSchema,
  TaskResponseSchema
} from '../../src/shared/axiom-contract/task-params'

type Fixture = Parameters<Parameters<typeof withFixtureMission>[2]>[0]
const source = process.env.AXIOM_FIXTURE_REPO
const wait = { timeout: 30_000 }
const cancelText =
  'Canceling stops the running Attempt of this Task. Its work is not integrated, and a canceled Task cannot be resumed.'
const dependentsText = 'Tasks that depend on it wait until a person cancels them too.'
const stageAudit = z.object({ stage: z.string(), reason: z.string() })
const stopAudit = z.object({ taskId: z.string(), reason: z.string() })

async function readTask(f: Fixture, taskId: string) {
  return TaskResponseSchema.parse(await desktopCall(f.page, 'axiom.task.show', { taskId })).task
}
async function readAttempts(f: Fixture) {
  return AttemptListResponseSchema.parse(
    await desktopCall(f.page, 'axiom.attempt.list', { missionId: f.mission.id })
  ).attempts
}
async function openDetail(page: Page, missionId: string, taskId: string) {
  await page.getByRole('button', { name: 'Missions', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Mission list' })
    .getByRole('button')
    .filter({ hasText: missionId })
    .click()
  await expect(page.getByRole('heading', { name: 'Mission Home' })).toBeVisible(wait)
  await page
    .getByRole('table', { name: 'Tasks', exact: true })
    .locator(`tbody tr[data-task-id="${taskId}"]`)
    .click()
  return page.getByRole('region', { name: 'Task detail', exact: true })
}

test('M3-09-2b-4: a person cancels a running Task before its Worker is released', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
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
      try {
        await expect
          .poll(async () => (await readAttempts(f)).map((attempt) => attempt.state), {
            timeout: 60_000
          })
          .toEqual(['RUNNING'])
        const [attempt] = await readAttempts(f)
        const taskId = attempt!.taskId
        const tasks = TaskListResponseSchema.parse(
          await desktopCall(f.page, 'axiom.task.list', { missionId: f.mission.id })
        ).tasks
        expect(tasks).toHaveLength(2)
        const dependentId = tasks.find((task) => task.id !== taskId)!.id
        expect(await readTask(f, taskId)).toMatchObject({
          stage: 'RUNNING',
          spec: { id: 'T01' },
          waitingOn: { on: 'running', reason: 'attempt_running', person: false }
        })
        expect(await readTask(f, dependentId)).toMatchObject({
          spec: { id: 'T04' },
          waitingOn: { on: 'dependency', reason: 'upstream_not_integrated', person: false }
        })
        const detail = await openDetail(f.page, f.mission.id, dependentId)
        const actions = detail.getByRole('region', { name: 'Task actions', exact: true })
        const cancel = detail.getByRole('button', { name: 'Cancel Task', exact: true })
        const waiting = detail.getByRole('region', { name: 'Waiting on', exact: true })
        await expect(waiting).toContainText('dependency · upstream_not_integrated', wait)
        await expect(actions).toHaveCount(0, wait)
        // This must fail on main before the test sends any cancellation.
        await expect(cancel).toHaveCount(1, wait)
        await expect(cancel).toHaveAttribute('data-variant', 'ghost', wait)
        await f.page
          .getByRole('table', { name: 'Tasks', exact: true })
          .locator(`tbody tr[data-task-id="${taskId}"]`)
          .click()
        await expect(waiting).toContainText('running · attempt_running', wait)
        await expect(actions).toHaveCount(0, wait)
        await expect(cancel).toHaveCount(1, wait)
        await expect(cancel).toHaveAttribute('data-variant', 'ghost', wait)
        const attempts = detail.getByRole('table', { name: 'Attempts', exact: true })
        await expect(attempts.locator('tbody tr')).toHaveCount(1, wait)
        await expect(attempts.getByText('Running', { exact: true })).toBeVisible(wait)
        await captureDetail(f.page, testInfo, 'running-task-quiet-cancel')
        await cancel.click()
        const form = detail.getByRole('form', { name: 'Cancel Task', exact: true })
        await expect(form.getByText(cancelText, { exact: true })).toBeVisible(wait)
        await expect(form.getByText(dependentsText, { exact: true })).toBeVisible(wait)
        await expect(form.getByText(/Tasks that depend on it:/)).toHaveCount(0, wait)
        const rationale = 'This running Task is no longer needed; review its dependent separately.'
        const input = form.getByRole('textbox', { name: 'Rationale', exact: true })
        await expect(input).toBeFocused(wait)
        await input.fill(rationale)
        await captureDetail(f.page, testInfo, 'running-task-cancel-form')
        const inspect = () => inspectFixtureMission(f.userData, f.mission.id)
        const before = inspect().audits
        const submit = form.getByRole('button', { name: 'Cancel Task', exact: true })
        await submit.click()
        const dialog = f.page.getByRole('dialog', { name: 'Cancel Task', exact: true })
        await expect(dialog).toContainText(`${cancelText} ${dependentsText}`, wait)
        await dialog.getByRole('button', { name: 'Keep Task', exact: true }).click()
        await expect(dialog).toHaveCount(0, wait)
        expect((await readTask(f, taskId)).stage).toBe('RUNNING')
        expect(inspect().audits).toEqual(before)
        await expect(form).toBeVisible(wait)
        await expect(input).toHaveValue(rationale, wait)
        expect(existsSync(`${f.ledgerPath}.hold`)).toBe(true)
        await submit.click()
        await expect(dialog).toContainText(`${cancelText} ${dependentsText}`, wait)
        await dialog.getByRole('button', { name: 'Cancel Task', exact: true }).click()
        // Mutation reconciliation must supply both changes without a test-driven refresh.
        await expect(detail.locator('[data-task-stage="CANCELED"]')).toHaveText('Canceled', wait)
        await expect(attempts.getByText('Stopped', { exact: true })).toBeVisible(wait)
        await expect(attempts.getByText('Running', { exact: true })).toHaveCount(0, wait)
        await expect(cancel).toHaveCount(0, wait)
        await expect(form).toHaveCount(0, wait)
        expect((await readTask(f, taskId)).stage).toBe('CANCELED')
        expect(await readAttempts(f)).toMatchObject([
          { taskId, attemptId: attempt!.attemptId, state: 'STOPPED' }
        ])
        const audits = inspect().audits
        const stage = audits.findLast(
          (entry) => entry.event === 'task.stage' && entry.object_id === taskId
        )!
        expect(stageAudit.parse(JSON.parse(stage.after!))).toEqual({
          stage: 'CANCELED',
          reason: rationale
        })
        const stopped = audits.filter(
          (entry) => entry.event === 'attempt.stopped' && entry.object_id === attempt!.attemptId
        )
        expect(stopped).toHaveLength(1)
        expect(stopAudit.parse(JSON.parse(stopped[0]!.after!))).toEqual({
          taskId,
          reason: 'mission_canceled'
        })
        expect(existsSync(`${f.ledgerPath}.hold`)).toBe(true)
        await f.page
          .getByRole('table', { name: 'Tasks', exact: true })
          .locator(`tbody tr[data-task-id="${dependentId}"]`)
          .click()
        await expect(waiting).toContainText('dependency · upstream_canceled', wait)
        await expect(actions.getByRole('button')).toHaveText(['Cancel Task'], wait)
        await expect(cancel).toHaveCount(1, wait)
        await expect(form).toHaveCount(0, wait)
        expect((await readTask(f, dependentId)).waitingOn).toMatchObject({
          on: 'dependency',
          reason: 'upstream_canceled',
          person: true
        })
      } finally {
        f.releaseWorkers()
      }
    },
    { taskIds: ['T01', 'T04'], holdWorkers: true }
  )
})
