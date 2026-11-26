import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'

const source = process.env.AXIOM_FIXTURE_REPO
test['skip'](!source || process.platform === 'win32', 'Requires POSIX host and AXIOM_FIXTURE_REPO')

test('M3-09-4c-2c: a person allows a provider from the pending item and the waiting Task is admitted', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
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
      const show = async () =>
        PolicyResponseSchema.parse(
          await desktopCall(page, 'axiom.policy.show', { missionId: mission.id })
        ).policy
      const policyUpdates = () =>
        inspect().audits.filter((audit) => audit.event === 'policy.updated')
      await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
      const started = inspect()
      expect(started.tasks).toHaveLength(2)
      const runningId = z.string().parse(started.bindings[0]?.task_id)
      const waitingId = z
        .string()
        .parse(started.tasks.find((task) => task.task_id !== runningId)?.task_id)
      await expect
        .poll(() => inspect().tasks.find((task) => task.task_id === runningId)?.stage, {
          timeout: 60_000
        })
        .toBe('RUNNING')
      expect(inspect().tasks.find((task) => task.task_id === waitingId)?.stage).toBe('READY')
      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: {
          concurrencyLimit: 2,
          routing: { disallowedProviders: ['codex', 'claude', 'opencode', 'antigravity'] }
        }
      })
      const firstUpdate = policyUpdates().find(
        (audit) => audit.sequence > (started.audits.at(-1)?.sequence ?? 0)
      )
      const sequence = z.number().parse(firstUpdate?.sequence)
      await expect
        .poll(
          () =>
            inspect().audits.some(
              (audit) =>
                audit.event === 'task.admission_refused' &&
                audit.object_id === waitingId &&
                audit.sequence > sequence
            ),
          { timeout: 30_000 }
        )
        .toBe(true)
      const before = await show()
      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list', exact: true })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      const region = page.getByRole('region', { name: 'Providers', exact: true })
      await expect(region).toBeVisible()
      await expect(region.locator('[data-providers-value="disallowed"]')).toContainText('Codex')
      const row = page
        .getByRole('region', { name: 'Mission Home', exact: true })
        .getByRole('list', { name: 'Pending items', exact: true })
        .getByRole('listitem')
        .filter({ hasText: 'no_eligible_provider' })
      await expect(
        row.getByText('You can: Update policy, Cancel Task', { exact: true })
      ).toBeVisible()
      await row.getByRole('button', { name: 'Edit providers', exact: true }).click()
      const form = region.getByRole('form', { name: 'Edit the providers of this Mission' })
      await expect(form).toBeVisible()
      const table = form.getByRole('table', { name: 'Provider availability', exact: true })
      await expect(table).toBeVisible({ timeout: 30_000 })
      const cells = table.locator('[data-provider="codex"]').getByRole('cell')
      await expect(cells).toHaveCount(4)
      for (let index = 0; index < 4; index++) {
        await expect(cells.nth(index)).toContainText('disallowed')
        await expect(cells.nth(index)).toContainText('Not allowed by this policy.')
      }
      await form.getByRole('checkbox', { name: 'Codex', exact: true }).check()
      const updatesBefore = policyUpdates()
      await form.getByRole('button', { name: 'Save providers', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Save policy', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('This changes: Allowed providers.')
      await dialog.getByRole('button', { name: 'Save policy', exact: true }).click()
      await expect(
        region.getByRole('button', { name: 'Edit providers', exact: true })
      ).toBeVisible()
      await expect(region.locator('[data-providers-value="disallowed"]')).not.toContainText('Codex')
      expect((await show()).routing).toEqual({
        ...before.routing,
        disallowedProviders: before.routing.disallowedProviders.filter(
          (provider) => provider !== 'codex'
        )
      })
      expect(policyUpdates()).toHaveLength(updatesBefore.length + 1)
      await expect
        .poll(
          () => {
            const admitted = inspect()
            return (
              admitted.bindings.some(
                (binding) => binding.task_id === waitingId && binding.seq === 1
              ) &&
              admitted.tasks.some((task) => task.task_id === waitingId && task.stage === 'RUNNING')
            )
          },
          { timeout: 60_000 }
        )
        .toBe(true)
      expect(
        inspect()
          .bindings.filter((binding) => binding.task_id === waitingId)
          .map((binding) => binding.seq)
      ).toEqual([1])
    },
    { provider: 'codex', taskIds: ['T01', 'T02'], concurrencyLimit: 1, holdWorkers: true }
  )
})
