import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { desktopCall } from './helpers/axiom-desktop-call'
import { captureDetail } from './helpers/axiom-task-detail-capture'
import { FIXTURE_COMMIT, git } from './helpers/axiom-fixture-mission'
import { fixturePlanProposal } from './helpers/fixture-plan-proposal'
import { readGoalFile } from '../../src/cli/handlers/axiom/input-files'
import {
  AxiomIdSchema,
  DEFAULT_MISSION_POLICY
} from '../../src/shared/axiom-contract/mission-objects'
import { MissionCreateResponseSchema } from '../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import {
  SupervisionShowResponse,
  SupervisionUpdateResponse
} from '../../src/shared/axiom-contract/supervision'

const timeout = 30_000

async function setDocumentVisibility(page: Page) {
  // Only page visibility changes; the Electron window remains hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('M3-09-3c: Mission supervision settings follow the Control Plane', async (// oxlint-disable-next-line no-empty-pattern -- The restart session owns the hidden app lifecycle.
{}, testInfo) => {
  test.setTimeout(180_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-mission-home-supervision-'))
  const session = createRestartSession(testInfo, { ORCA_BACKGROUND_LAUNCH: '1' })
  let app: ElectronApplication | undefined
  try {
    const clone = path.join(temp, 'fixture')
    git(['clone', '--no-hardlinks', '--branch', 'main', realpathSync(source), clone])
    expect(git(['-C', clone, 'rev-parse', 'HEAD'])).toBe(FIXTURE_COMMIT)
    expect(git(['-C', clone, 'rev-parse', 'fixture-v1^{commit}'])).toBe(FIXTURE_COMMIT)
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const { repo } = z
      .object({ repo: z.object({ id: z.string() }) })
      .parse(await desktopCall(page, 'repo.add', { path: clone }))
    const { mission } = MissionCreateResponseSchema.parse(
      await desktopCall(page, 'axiom.mission.create', {
        repo: `id:${repo.id}`,
        targetBranch: 'main',
        goal: await readGoalFile(clone, 'GOAL.md'),
        policy: DEFAULT_MISSION_POLICY
      })
    )
    const proposal = fixturePlanProposal(
      JSON.parse(readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')),
      AxiomIdSchema.parse(mission.activeGoalRevisionId)
    )
    PlanResponseSchema.parse(
      await desktopCall(page, 'axiom.plan.propose', {
        missionId: mission.id,
        planRevision: proposal,
        provenance: proposal.provenance
      })
    )
    const missions = page.getByRole('button', { name: 'Missions', exact: true })
    await expect(missions).toBeVisible({ timeout })
    await missions.click()
    const list = page.getByRole('navigation', { name: 'Mission list', exact: true })
    const selected = list.getByRole('button').filter({ hasText: mission.id })
    await expect(selected).toBeVisible({ timeout })
    await selected.click()
    await setDocumentVisibility(page)

    const region = page.getByRole('region', { name: 'Supervision', exact: true })
    await expect(region).toBeVisible({ timeout })
    const fact = (label: string) =>
      region.getByText(label, { exact: true }).locator('..').locator('dd')
    const effective = fact('In effect for this Mission')
    const ownSetting = fact("This Mission's setting")
    const globalSetting = fact('Default for all Missions')
    await expect(region.getByRole('heading', { name: 'Stalled Workers', exact: true })).toBeVisible(
      { timeout }
    )
    await expect(effective.getByText('observe', { exact: true })).toBeVisible({ timeout })
    await expect(ownSetting).toHaveText('default', { timeout })
    await expect(globalSetting).toHaveText('observe · built in', { timeout })
    await expect(region.getByRole('region', { name: 'Upgrade proposal', exact: true })).toHaveCount(
      0,
      { timeout }
    )
    const missionChange = region.getByRole('button', {
      name: 'Change for this Mission',
      exact: true
    })
    const defaultChange = region.getByRole('button', { name: 'Change the default', exact: true })
    const missionForm = region.getByRole('radiogroup', {
      name: 'Stall mode for this Mission',
      exact: true
    })
    const defaultForm = region.getByRole('radiogroup', {
      name: 'Default stall mode for all Missions',
      exact: true
    })
    const save = region.getByRole('button', { name: 'Save stall mode', exact: true })
    await missionChange.click()
    await expect(missionForm.getByRole('radio', { name: 'default', exact: true })).toBeChecked({
      timeout
    })
    await expect(save).toBeDisabled({ timeout })
    await captureDetail(page, testInfo, 'mission-home-supervision-form', 'Supervision')

    const show = async (missionId?: string) =>
      SupervisionShowResponse.parse(
        await desktopCall(page, 'axiom.supervision.show', missionId ? { missionId } : {})
      )
    await missionForm.getByRole('radio', { name: 'notify', exact: true }).click()
    await save.click()
    await expect
      .poll(async () => (await show(mission.id)).rules[0], { timeout })
      .toMatchObject({
        missionMode: 'notify',
        effectiveMode: 'notify',
        globalMode: 'observe',
        globalSource: 'built_in'
      })
    await expect(ownSetting).toHaveText('notify', { timeout })
    await expect(effective.getByText('notify', { exact: true })).toBeVisible({ timeout })
    await expect(globalSetting).toHaveText('observe · built in', { timeout })
    await expect(missionForm).toHaveCount(0, { timeout })

    await missionChange.click()
    await missionForm.getByRole('radio', { name: 'stop', exact: true }).click()
    await save.click()
    const dialog = page.getByRole('dialog', {
      name: 'Stop stalled Workers automatically',
      exact: true
    })
    await expect(dialog).toBeVisible({ timeout })
    await expect(dialog).toContainText('this Mission', { timeout })
    await dialog.getByRole('button', { name: 'Keep the current mode', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout })
    expect((await show(mission.id)).rules[0]).toMatchObject({
      missionMode: 'notify',
      effectiveMode: 'notify'
    })
    await expect(ownSetting).toHaveText('notify', { timeout })
    await expect(missionForm.getByRole('radio', { name: 'stop', exact: true })).toBeChecked({
      timeout
    })
    await save.click()
    await expect(dialog).toBeVisible({ timeout })
    await dialog
      .getByRole('button', { name: 'Stop stalled Workers automatically', exact: true })
      .click()
    await expect
      .poll(async () => (await show(mission.id)).rules[0], { timeout })
      .toMatchObject({ missionMode: 'stop', effectiveMode: 'stop' })
    await expect(ownSetting).toHaveText('stop', { timeout })
    await expect(effective.getByText('stop', { exact: true })).toBeVisible({ timeout })
    await expect(missionForm).toHaveCount(0, { timeout })

    await defaultChange.click()
    await defaultForm.getByRole('radio', { name: 'notify', exact: true }).click()
    await save.click()
    await expect
      .poll(async () => (await show()).rules[0], { timeout })
      .toMatchObject({ globalMode: 'notify', globalSource: 'user' })
    await expect(globalSetting).toHaveText('notify · set by you', { timeout })
    await expect(defaultForm).toHaveCount(0, { timeout })
    await missionChange.click()
    await missionForm.getByRole('radio', { name: 'default', exact: true }).click()
    await save.click()
    await expect
      .poll(async () => (await show(mission.id)).rules[0], { timeout })
      .toMatchObject({ missionMode: null, effectiveMode: 'notify' })
    await expect(ownSetting).toHaveText('default', { timeout })
    await expect(effective.getByText('notify', { exact: true })).toBeVisible({ timeout })
    await expect(missionForm).toHaveCount(0, { timeout })

    SupervisionUpdateResponse.parse(
      await desktopCall(page, 'axiom.supervision.update', {
        rule: 'stalled',
        missionId: mission.id,
        mode: 'observe'
      })
    )
    await expect(ownSetting).toHaveText('observe', { timeout })
    await expect(effective.getByText('observe', { exact: true })).toBeVisible({ timeout })
  } finally {
    try {
      await session.dispose(app)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})
