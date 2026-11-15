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
  TaskSpecSchema,
  DEFAULT_MISSION_POLICY
} from '../../src/shared/axiom-contract/mission-objects'
import {
  MissionCreateResponseSchema,
  MissionResponseSchema
} from '../../src/shared/axiom-contract/mission-params'
import {
  PlanListResponseSchema,
  PlanResponseSchema
} from '../../src/shared/axiom-contract/plan-params'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import {
  resolveVerificationPlan,
  VerificationRulesSchema
} from '../../src/shared/axiom-contract/verification-rules'

const timeout = 30_000
async function setDocumentVisibility(page: Page) {
  // The document follows timed reads while the Electron window remains hidden.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('M3-09-4a: the plan card explains verification and compares a rejected revision before approval', async (// oxlint-disable-next-line no-empty-pattern -- The restart session owns the hidden app lifecycle.
{}, testInfo) => {
  test.setTimeout(180_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-mission-plan-card-'))
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
    const setupCommand = 'node --version'
    const gateCommand = 'git diff --check'
    PolicyResponseSchema.parse(
      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: {
          verificationRules: {
            setupCommands: [setupCommand],
            repositoryGates: { [proposal.tasks[0].risk]: [gateCommand] }
          }
        }
      })
    )
    const { planRevision: first } = PlanResponseSchema.parse(
      await desktopCall(page, 'axiom.plan.propose', {
        missionId: mission.id,
        planRevision: proposal,
        provenance: proposal.provenance
      })
    )
    const showPlans = async () =>
      PlanListResponseSchema.parse(
        await desktopCall(page, 'axiom.plan.list', { missionId: mission.id })
      ).planRevisions
    const { policy } = PolicyResponseSchema.parse(
      await desktopCall(page, 'axiom.policy.show', { missionId: mission.id })
    )
    const expectedCommands = resolveVerificationPlan(
      first.tasks[0],
      VerificationRulesSchema.parse(policy.verificationRules)
    )
    expect(expectedCommands[0]).toMatchObject({ source: 'setup', command: setupCommand })
    expect(expectedCommands.at(-1)).toMatchObject({ source: 'gate', command: gateCommand })
    const missions = page.getByRole('button', { name: 'Missions', exact: true })
    await expect(missions).toBeVisible({ timeout })
    await missions.click()
    const selected = page
      .getByRole('navigation', { name: 'Mission list', exact: true })
      .getByRole('button')
      .filter({ hasText: mission.id })
    await expect(selected).toBeVisible({ timeout })
    await selected.click()
    await setDocumentVisibility(page)
    const region = page.getByRole('region', { name: 'Plan review', exact: true })
    await expect(region.getByRole('heading', { level: 2 })).toHaveText(
      'Plan revision 1 · PROPOSED',
      { timeout }
    )
    const task = region.getByRole('listitem', {
      name: `${first.tasks[0].id} · ${first.tasks[0].title}`,
      exact: true
    })
    const commands = task.getByRole('list', { name: 'Verification will run', exact: true })
    await expect(commands).toBeVisible({ timeout })
    await expect(commands.getByRole('listitem')).toHaveCount(expectedCommands.length, { timeout })
    await expect(commands.locator('code')).toHaveText(
      expectedCommands.map((entry) => entry.command),
      { timeout }
    )
    await expect(commands.locator('span')).toHaveText(
      expectedCommands.map((entry) => entry.source),
      { timeout }
    )

    const reason = 'Keep acceptance coverage on the first Task and remove the last Task.'
    await region.getByRole('textbox', { name: 'Reason for rejection', exact: true }).fill(reason)
    await region.getByRole('button', { name: 'Reject plan', exact: true }).click()
    const rejection = page.getByRole('dialog', { name: 'Reject plan', exact: true })
    await expect(rejection).toBeVisible({ timeout })
    await rejection.getByRole('button', { name: 'Reject plan', exact: true }).click()
    await expect
      .poll(async () => (await showPlans())[0], { timeout })
      .toMatchObject({ id: first.id, status: 'REJECTED', rejectedReason: reason })
    await expect(region.getByRole('heading', { level: 2 })).toHaveText(
      'Plan revision 1 · REJECTED',
      { timeout }
    )
    await expect(region.getByText('Rejected because', { exact: true })).toBeVisible({ timeout })
    await expect(region.getByText(reason, { exact: true })).toBeVisible({ timeout })
    await expect(region.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0, {
      timeout
    })

    const removed = TaskSpecSchema.parse(proposal.tasks.at(-1))
    const extraCriterion = {
      text: 'Package manager is available',
      check: { kind: 'command' as const, command: 'pnpm --version' }
    }
    const revised = {
      ...proposal,
      tasks: proposal.tasks
        .slice(0, -1)
        .map((entry, index) =>
          index === 0
            ? { ...entry, acceptanceCriteria: [...entry.acceptanceCriteria, extraCriterion] }
            : entry
        ),
      edges: proposal.edges.filter(
        (edge) => edge.fromTaskId !== removed.id && edge.toTaskId !== removed.id
      )
    }
    const { planRevision: second } = PlanResponseSchema.parse(
      await desktopCall(page, 'axiom.plan.propose', {
        missionId: mission.id,
        planRevision: revised,
        provenance: revised.provenance
      })
    )
    await expect(region).toHaveCount(1, { timeout })
    await expect(region.getByRole('heading', { level: 2 })).toHaveText(
      'Plan revision 2 · PROPOSED',
      { timeout }
    )
    const changes = region.getByRole('group', { name: 'Changes since revision 1', exact: true })
    await expect(changes).toBeVisible({ timeout })
    await expect(changes.getByText(reason, { exact: true })).toBeVisible({ timeout })
    await expect(changes.getByRole('group', { name: 'Removed Tasks', exact: true })).toContainText(
      `${removed.id} · ${removed.title}`,
      { timeout }
    )
    const changed = changes.getByRole('group', { name: 'Changed Tasks', exact: true })
    await expect(changed).toContainText(`${second.tasks[0].id} · ${second.tasks[0].title}`, {
      timeout
    })
    await expect(changed.getByText('Acceptance criteria', { exact: true })).toBeVisible({ timeout })
    await expect(changed.getByText(extraCriterion.text, { exact: true })).toBeVisible({ timeout })
    await expect(changed.locator('code')).toHaveText(extraCriterion.check.command, { timeout })
    await captureDetail(page, testInfo, 'mission-plan-card-revision-2', 'Plan review')

    const approve = region.getByRole('button', { name: 'Approve plan', exact: true })
    await approve.click()
    const approval = page.getByRole('dialog', { name: 'Approve plan', exact: true })
    await expect(approval).toBeVisible({ timeout })
    await approval.getByRole('button', { name: 'Keep reviewing', exact: true }).click()
    await expect(approval).toHaveCount(0, { timeout })
    expect((await showPlans()).find((entry) => entry.id === second.id)?.status).toBe('PROPOSED')
    await expect(region.getByRole('heading', { level: 2 })).toHaveText(
      'Plan revision 2 · PROPOSED',
      { timeout }
    )
    await approve.click()
    await expect(approval).toBeVisible({ timeout })
    await approval.getByRole('button', { name: 'Approve plan', exact: true }).click()
    await expect
      .poll(async () => (await showPlans()).find((entry) => entry.id === second.id)?.status, {
        timeout
      })
      .toBe('APPROVED')
    await expect
      .poll(
        async () =>
          MissionResponseSchema.parse(
            await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
          ).mission.status,
        { timeout }
      )
      .toBe('PLANNED')
    await expect(region.getByRole('heading', { level: 2 })).toHaveText(
      'Plan revision 2 · APPROVED',
      { timeout }
    )
    await expect(approve).toHaveCount(0, { timeout })
  } finally {
    try {
      await session.dispose(app)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})
