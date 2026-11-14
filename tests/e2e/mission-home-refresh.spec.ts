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

const timeout = 30_000

async function setDocumentVisibility(page: Page, visibility: 'visible' | 'hidden') {
  // Match the page-side fixture override; the native window remains hidden.
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visibility)
}

test('M3-09-3b-2: Mission reads follow visibility and preserve a typed reason', async (// oxlint-disable-next-line no-empty-pattern -- The restart session owns the hidden app lifecycle.
{}, testInfo) => {
  test.setTimeout(180_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-mission-home-refresh-'))
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
    const params = {
      repo: `id:${repo.id}`,
      targetBranch: 'main',
      goal: await readGoalFile(clone, 'GOAL.md'),
      policy: DEFAULT_MISSION_POLICY
    }
    const { mission } = MissionCreateResponseSchema.parse(
      await desktopCall(page, 'axiom.mission.create', params)
    )
    const proposal = fixturePlanProposal(
      JSON.parse(readFileSync(path.join(clone, 'scenarios', 'goal', 'decomposition.json'), 'utf8')),
      AxiomIdSchema.parse(mission.activeGoalRevisionId)
    )
    const { planRevision } = PlanResponseSchema.parse(
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
    const first = list.getByRole('button').filter({ hasText: mission.id })
    await expect(first).toBeVisible({ timeout })
    await first.click()
    const review = page.getByRole('region', { name: 'Plan review', exact: true })
    const reason = review.getByRole('textbox', { name: 'Reason for rejection', exact: true })
    await expect(reason).toBeEnabled({ timeout })
    await setDocumentVisibility(page, 'visible')
    const typedReason = 'Please cover the recovery path before approval.'
    await reason.fill(typedReason)
    await expect(reason).toBeFocused({ timeout })

    const second = MissionCreateResponseSchema.parse(
      await desktopCall(page, 'axiom.mission.create', params)
    ).mission
    await expect(list.getByRole('button').filter({ hasText: second.id })).toBeVisible({ timeout })
    await expect(reason).toHaveValue(typedReason, { timeout })
    await expect(reason).toBeFocused({ timeout })
    await expect(review.getByRole('button', { name: 'Approve plan', exact: true })).toBeEnabled({
      timeout
    })
    await captureDetail(page, testInfo, 'mission-home-refresh-reason', 'Plan review')

    await setDocumentVisibility(page, 'hidden')
    const third = MissionCreateResponseSchema.parse(
      await desktopCall(page, 'axiom.mission.create', params)
    ).mission
    // This negative observation spans two and a half real polling intervals.
    await page.waitForTimeout(12_500)
    const thirdRow = list.getByRole('button').filter({ hasText: third.id })
    await expect(thirdRow).toHaveCount(0, { timeout })
    await setDocumentVisibility(page, 'visible')
    await expect(thirdRow).toBeVisible({ timeout })

    expect(
      PlanResponseSchema.parse(
        await desktopCall(page, 'axiom.plan.approve', {
          planRevisionId: planRevision.id,
          resolver: 'e2e'
        })
      ).planRevision.status
    ).toBe('APPROVED')
    await expect(review.getByRole('heading', { level: 2 })).toHaveText(
      `Plan revision ${planRevision.revision} · APPROVED`,
      { timeout }
    )
    await expect(reason).toHaveCount(0, { timeout })
  } finally {
    try {
      await session.dispose(app)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})
