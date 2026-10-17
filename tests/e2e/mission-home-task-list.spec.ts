import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { makeProposal, goal } from '../../src/shared/axiom-contract/contract-fixtures.test-support'
import { MissionResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../src/shared/protocol-version'

// orca-app seeds the repository via seeded-test-repo and launches windowless over CDP.
test.use({ launchEnv: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_E2E_HEADLESS: '1' } })

test('creates a Mission, reviews its plan and starts twelve authoritative Tasks', async ({
  orcaPage,
  seededRepoPath
}) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.getByRole('button', { name: 'Missions', exact: true }).click()
  await expect(orcaPage.getByRole('heading', { name: 'Missions', exact: true })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Create Mission', exact: true }).click()
  const dialog = orcaPage.getByRole('dialog', { name: 'Create Mission' })
  await dialog.getByLabel('Repository path').fill(seededRepoPath)
  await dialog.getByLabel('Target branch').fill('main')
  await dialog.getByLabel('Goal objective').fill(goal.objective)
  await dialog.getByLabel('Acceptance criteria').fill(goal.acceptanceCriteria.join('\n'))
  await dialog.getByRole('button', { name: 'Create Mission', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(orcaPage.getByRole('heading', { name: 'Mission Home' })).toBeVisible()
  await expect(orcaPage.getByText(goal.objective, { exact: true })).toBeVisible()
  await expect(orcaPage.locator('[data-mission-status]')).toHaveText('Analyzing')

  const missionResponse = await orcaPage.evaluate(async () => {
    const missionId = window.__store?.getState().selectedMissionId
    if (!missionId) {
      throw new Error('Created Mission was not selected')
    }
    const response = await window.api.runtime.call({
      method: 'axiom.mission.show',
      params: { missionId }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result
  })
  const { mission } = MissionResponseSchema.parse(missionResponse)
  if (!mission.activeGoalRevisionId) {
    throw new Error('Missing active Goal')
  }
  const { provenance, ...proposal } = makeProposal()
  const planResponse = await orcaPage.evaluate(
    async ({ missionId, planRevision, provenance, version }) => {
      const response = await window.api.runtime.call({
        method: 'axiom.plan.propose',
        params: { missionId, planRevision, provenance },
        envelope: {
          orchestrationContractVersion: version,
          orchestrationRequestId: crypto.randomUUID()
        }
      })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    {
      missionId: mission.id,
      planRevision: { ...proposal, goalRevisionId: mission.activeGoalRevisionId },
      provenance,
      version: ORCHESTRATION_CONTRACT_VERSION
    }
  )
  PlanResponseSchema.parse(planResponse)

  await orcaPage.getByRole('button', { name: 'Refresh Missions' }).click()
  await expect(orcaPage.locator('[data-mission-status]')).toHaveText('Plan review')
  await expect(orcaPage.getByRole('region', { name: 'Plan review' })).toContainText('T01 → T04')
  await orcaPage.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(orcaPage.locator('[data-mission-status]')).toHaveText('Planned')
  await orcaPage.getByRole('button', { name: 'Start Mission', exact: true }).click()
  await expect(orcaPage.locator('[data-mission-status]')).toHaveText('Executing')
  const tasks = orcaPage.getByRole('table', { name: 'Tasks', exact: true })
  await expect(tasks.locator('tbody tr')).toHaveCount(12)
  await expect(tasks.locator('[data-task-stage="READY"]')).toHaveCount(3)
  await expect(tasks.locator('[data-task-stage="READY"]').first()).toHaveText('Ready')
  await expect(tasks.getByText('Execution projection: ready', { exact: true })).toHaveCount(12)
  await expect(tasks).not.toContainText(/\bdone\b|completed/i)
  await expect(orcaPage.getByTestId('mission-progress')).toHaveText('0 / 12 Tasks integrated')
})
