import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { AttemptListResponseSchema } from '../../src/shared/axiom-contract/attempt-params'

test('M2-10: Mission Home and Task detail project three submitted fixture Attempts', async (// oxlint-disable-next-line no-empty-pattern -- Restart helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(300_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(testInfo, source, async ({ page, mission }) => {
    const readAttempts = async () =>
      AttemptListResponseSchema.parse(
        await page.evaluate(async (missionId) => {
          const response = await window.api.runtime.call({
            method: 'axiom.attempt.list',
            params: { missionId }
          })
          if (!response.ok) {
            throw new Error(response.error.message)
          }
          return response.result
        }, mission.id)
      ).attempts
    await expect
      .poll(
        async () =>
          (await readAttempts()).filter(
            (attempt) => attempt.role === 'worker' && attempt.state === 'SUBMITTED'
          ).length,
        { timeout: 120_000 }
      )
      .toBe(3)
    const attempts = await readAttempts()
    expect(attempts).toHaveLength(3)

    await page.getByRole('button', { name: 'Missions', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Mission list' })
      .getByRole('button')
      .filter({ hasText: mission.id })
      .click()
    await expect(page.getByRole('heading', { name: 'Mission Home' })).toBeVisible()
    await expect(page.getByTestId('mission-attempt-progress')).toHaveText('0 running / 3 submitted')
    const tasks = page.getByRole('table', { name: 'Tasks', exact: true })
    // Task ids are kernel-generated; select the first submitted row, not a random DEFINED Task.
    const row = tasks
      .locator('tbody tr')
      .filter({ has: page.locator('[data-task-stage="SUBMITTED"]') })
      .first()
    const taskId = await row.getAttribute('data-task-id')
    await row.click()
    await expect(row).toHaveAttribute('aria-selected', 'true')
    const detail = page.getByRole('region', { name: 'Task detail', exact: true })
    await expect(detail).toBeVisible()
    const attemptRows = detail
      .getByRole('table', { name: 'Attempts', exact: true })
      .locator('tbody tr')
    await expect(attemptRows).toHaveCount(1)
    await expect(attemptRows.first()).toContainText('Submitted')
    const candidate = attempts.find((attempt) => attempt.taskId === taskId)?.submission
    if (!candidate) {
      throw new Error('Submitted Attempt is missing Candidate evidence')
    }
    const summary = detail.getByRole('region', { name: 'Submission summary' })
    await expect(
      summary.getByText(candidate.commitSha.slice(0, 7), { exact: true })
    ).toHaveAttribute('title', candidate.commitSha)
    await expect(summary).toContainText(candidate.treeSha)
    await expect(detail.getByRole('list', { name: 'Task messages' })).toContainText('SUBMISSION')
  })
})
