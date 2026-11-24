import { test, expect } from './helpers/orca-app'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { desktopCall } from './helpers/axiom-desktop-call'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import { VerificationRulesSchema } from '../../src/shared/axiom-contract/verification-rules'

const source = process.env.AXIOM_FIXTURE_REPO
test['skip'](!source || process.platform === 'win32', 'Requires POSIX host and AXIOM_FIXTURE_REPO')

test('M3-09-4c-2b: a person changes the policy on the Mission page', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the background app lifecycle.
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
      await expect
        .poll(() => inspect().tasks.map((task) => task.stage), { timeout: 60_000 })
        .toEqual(['RUNNING'])
      const before = await show()
      await page.getByRole('button', { name: 'Missions', exact: true }).click()
      await page
        .getByRole('navigation', { name: 'Mission list', exact: true })
        .getByRole('button')
        .filter({ hasText: mission.id })
        .click()
      const region = page.getByRole('region', { name: 'Policy', exact: true })
      await expect(region).toBeVisible()
      await expect(region.locator('[data-policy-value="concurrency"]')).toHaveText(
        String(before.concurrencyLimit)
      )
      await expect(region.locator('[data-policy-value="setup"]')).toHaveText('None')

      await region.getByRole('button', { name: 'Edit policy', exact: true }).click()
      const form = region.getByRole('form', { name: 'Edit the policy of this Mission' })
      const setup = ['node --version', 'node -v']
      const low = ['node --version']
      const limit = String(before.concurrencyLimit + 1)
      await form.getByLabel('Setup commands', { exact: true }).fill(setup.join('\n'))
      await form.getByLabel('Gates for low-risk Tasks', { exact: true }).fill(low[0])
      await form.getByLabel('Tasks at once', { exact: true }).fill(limit)
      // Why: the held Worker's Attempt is still writing its own start-up events, so only the events
      // a policy write leaves are compared.
      const policyUpdates = () =>
        inspect().audits.filter((audit) => audit.event === 'policy.updated')
      const updatesBefore = policyUpdates()
      await form.getByRole('button', { name: 'Save policy', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Save policy', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(
        'This changes: Tasks at once, Setup commands, Gates for low-risk Tasks.'
      )
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(await show()).toEqual(before)
      expect(policyUpdates()).toEqual(updatesBefore)
      await expect(form.getByLabel('Tasks at once', { exact: true })).toHaveValue(limit)
      await expect(form.getByLabel('Setup commands', { exact: true })).toHaveValue(setup.join('\n'))
      await expect(form.getByLabel('Gates for low-risk Tasks', { exact: true })).toHaveValue(low[0])

      await form.getByRole('button', { name: 'Save policy', exact: true }).click()
      await dialog.getByRole('button', { name: 'Save policy', exact: true }).click()
      await expect(region.getByRole('button', { name: 'Edit policy', exact: true })).toBeVisible()
      await expect(region.locator('[data-policy-value="concurrency"]')).toHaveText(limit)
      await expect(region.locator('[data-policy-value="setup"]')).toHaveText(setup.join('\n'))
      await expect(region.locator('[data-policy-value="low"]')).toHaveText(low[0])
      const after = await show()
      expect(after.concurrencyLimit).toBe(before.concurrencyLimit + 1)
      expect(after.routing).toEqual(before.routing)
      const rulesBefore = VerificationRulesSchema.parse(before.verificationRules)
      expect(VerificationRulesSchema.parse(after.verificationRules)).toEqual({
        ...rulesBefore,
        setupCommands: setup,
        repositoryGates: { ...rulesBefore.repositoryGates, low }
      })
      expect(policyUpdates()).toHaveLength(updatesBefore.length + 1)

      await region.getByRole('button', { name: 'Edit policy', exact: true }).click()
      await form.getByLabel('Gates for low-risk Tasks', { exact: true }).fill('')
      await form.getByRole('button', { name: 'Save policy', exact: true }).click()
      await dialog.getByRole('button', { name: 'Save policy', exact: true }).click()
      await expect(region.getByRole('button', { name: 'Edit policy', exact: true })).toBeVisible()
      expect(
        VerificationRulesSchema.parse((await show()).verificationRules).repositoryGates
      ).not.toHaveProperty('low')
      await expect(region.locator('[data-policy-value="low"]')).toHaveText('None')
    },
    { taskIds: ['T01'], holdWorkers: true }
  )
})
