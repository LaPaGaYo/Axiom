import { writeFileSync } from 'node:fs'
import type { Page, TestInfo } from '@playwright/test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import type { AcceptanceCriterion } from '../../src/shared/axiom-contract/mission-objects'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'

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
const rationale = 'The example is clear and includes entityId.'

async function captureDetail(page: Page, testInfo: TestInfo, name: string) {
  const detail = page.getByRole('region', { name: 'Task detail', exact: true })
  // The application scrolls inside ancestors. Temporarily expand those ancestors so the
  // element screenshot contains the entire detail; restore all inline styles afterwards.
  const styles = await detail.evaluate((section) => {
    const saved: (string | null)[] = []
    for (let node = section.parentElement; node; node = node.parentElement) {
      saved.push(node.getAttribute('style'))
      node.style.setProperty('overflow', 'visible', 'important')
      node.style.setProperty('height', 'auto', 'important')
      node.style.setProperty('max-height', 'none', 'important')
      node.style.setProperty('min-height', '0', 'important')
    }
    return saved
  })
  try {
    const path = testInfo.outputPath(`${name}.png`)
    const bounds = await detail.boundingBox()
    expect(bounds).not.toBeNull()
    const png = await detail.screenshot({ path, animations: 'disabled' })
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(Math.floor(bounds!.height))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  } finally {
    await detail.evaluate((section, saved) => {
      let index = 0
      for (let node = section.parentElement; node; node = node.parentElement) {
        const style = saved[index++]
        if (style === null) {
          node.removeAttribute('style')
        } else {
          node.setAttribute('style', style)
        }
      }
    }, styles)
  }
}

test('M3-09-2: Task evidence explains human review, acceptance and dependency waits', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
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
    async ({ page, userData, mission, ledgerPath, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const taskId = z.string().parse(inspect().bindings[0]?.task_id)
      writeFileSync(`${ledgerPath}.scenario-${taskId}`, 'agent-crash')
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
      const taskList = TaskListResponseSchema.parse(
        await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
      ).tasks
      const reviewed = taskList.find((entry) => entry.id === taskId)!
      const dependent = taskList.find((entry) => entry.id !== taskId)!

      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list' })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      await expect(page.getByRole('heading', { name: 'Mission Home' })).toBeVisible()
      const tasks = page.getByRole('table', { name: 'Tasks', exact: true })
      await tasks.locator(`tbody tr[data-task-id="${taskId}"]`).click()
      const detail = page.getByRole('region', { name: 'Task detail', exact: true })
      const waiting = detail.getByRole('region', { name: 'Waiting on', exact: true })
      await expect(waiting).toContainText('human · acceptance_human')
      await expect(waiting.getByText('Needs a person', { exact: true })).toBeVisible()
      const verification = detail.getByRole('region', { name: 'Verification', exact: true })
      const runRows = verification
        .getByRole('table', { name: 'Verification runs' })
        .locator('tbody tr')
      await expect(runRows).toHaveCount(1)
      await expect(runRows.first()).toContainText('HUMAN_REVIEW')
      const checks = verification.getByRole('table', { name: 'Checks', exact: true })
      const command = passing.check.kind === 'command' ? passing.check.command : ''
      await expect(checks.getByText(command, { exact: true })).toBeVisible()
      await expect(checks.getByText('pass', { exact: true })).toBeVisible()
      await checks.getByRole('button', { name: 'Show output #0', exact: true }).click()
      await expect(
        checks.getByText('This Artifact holds no excerpt for this check.', { exact: true })
      ).toBeVisible()
      const criteria = verification.getByRole('list', { name: 'Acceptance criteria', exact: true })
      await expect(
        criteria
          .getByRole('listitem')
          .filter({ hasText: passing.text })
          .getByText('pass', { exact: true })
      ).toBeVisible()
      await expect(
        criteria
          .getByRole('listitem')
          .filter({ hasText: human.text })
          .getByText('human · Needs a person', { exact: true })
      ).toBeVisible()
      await captureDetail(page, testInfo, 'human-review')

      await desktopCall(page, 'axiom.verification.resolve', {
        runId,
        verdict: 'PASS',
        rationale,
        criteria: [1]
      })
      await page.getByRole('button', { name: 'Refresh Missions', exact: true }).click()
      const stage = detail.getByRole('button', { name: 'Verified', exact: true })
      await expect(stage).toHaveAttribute('data-task-stage', 'VERIFIED')
      await expect(stage.locator('span')).toHaveClass(/text-status-success/)
      await stage.click()
      await expect(verification).toBeFocused()
      await expect(runRows.first()).toContainText('PASS')
      await expect(runRows.first()).toContainText('Resolved by a person')
      await expect(verification.getByRole('region', { name: 'Human resolution' })).toContainText(
        rationale
      )
      await expect(waiting).toContainText('integration · integration_queue')
      await captureDetail(page, testInfo, 'verified-integration-wait')

      await tasks.locator(`tbody tr[data-task-id="${dependent.id}"]`).click()
      await expect(waiting).toContainText('dependency · upstream_not_integrated')
      await expect(waiting.getByRole('button', { name: reviewed.title, exact: true })).toBeVisible()
      await expect(verification).toContainText('No verification runs yet.')
      await captureDetail(page, testInfo, 'dependency-wait')
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
