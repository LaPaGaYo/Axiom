import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from '../../src/main/sqlite/sync-database'
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
import { TUI_AGENT_CONFIG } from '../../src/shared/tui-agent-config'
import {
  AxiomIdSchema,
  DEFAULT_MISSION_POLICY
} from '../../src/shared/axiom-contract/mission-objects'
import {
  MissionCreateResponseSchema,
  MissionResponseSchema
} from '../../src/shared/axiom-contract/mission-params'
import { PlanResponseSchema } from '../../src/shared/axiom-contract/plan-params'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import {
  MissionPendingResponseSchema,
  type MissionPendingItem
} from '../../src/shared/axiom-contract/mission-pending'

const timeout = 30_000
const RefusalSchema = z.object({
  sequence: z.number().int().positive(),
  taskId: AxiomIdSchema,
  since: z.string().datetime()
})

function readRefusals(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    return z.array(RefusalSchema).parse(
      db
        .prepare(`SELECT sequence, object_id AS taskId,
        strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS since FROM audit_events
        WHERE mission_id = ? AND object_kind = 'task' AND event = 'task.admission_refused'
        ORDER BY sequence ASC`)
        .all(missionId)
    )
  } finally {
    db.close()
  }
}

async function pending(page: Page, missionId: string) {
  return MissionPendingResponseSchema.parse(
    await desktopCall(page, 'axiom.mission.pending', { missionId })
  ).items
}

async function assertRows(page: Page, items: MissionPendingItem[]) {
  const home = page.getByRole('region', { name: 'Mission Home', exact: true })
  await expect(home.getByText('3 pending item(s)', { exact: true })).toBeVisible({ timeout })
  const rows = home.getByRole('list', { name: 'Pending items', exact: true }).getByRole('listitem')
  await expect(rows).toHaveCount(3, { timeout })
  for (const [index, item] of items.entries()) {
    const row = rows.nth(index)
    const time = row.locator('time')
    // Keep this first: the baseline must fail on the missing row time, before audit comparison.
    await expect(time).toHaveCount(1, { timeout })
    await expect(time).toHaveAttribute('datetime', item.since, { timeout })
    await expect(time).toHaveText(item.since, { timeout })
    await expect(time.locator('..')).toHaveText(`Since ${item.since}`, { timeout })
    await expect(time.locator('..').locator('+ p')).toHaveText(
      'You can: Update policy, Cancel Task',
      { timeout }
    )
    await expect(row.getByText('Blocked Task', { exact: true })).toBeVisible({ timeout })
    await expect(row.getByText('no_eligible_provider', { exact: true })).toBeVisible({ timeout })
  }
  return rows.allTextContents()
}

test('M3-09-3b-1: three provider waits keep their start after pause and resume', async (// oxlint-disable-next-line no-empty-pattern -- The restart session owns the hidden app lifecycle.
{}, testInfo) => {
  test.setTimeout(180_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'axiom-mission-home-since-'))
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
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
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
    const disallowedProviders = Object.keys(TUI_AGENT_CONFIG)
    const { policy } = PolicyResponseSchema.parse(
      await desktopCall(page, 'axiom.policy.update', {
        missionId: mission.id,
        patch: { routing: { disallowedProviders } }
      })
    )
    expect(policy.routing.disallowedProviders).toEqual(disallowedProviders)
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
    expect(
      PlanResponseSchema.parse(
        await desktopCall(page, 'axiom.plan.approve', {
          planRevisionId: planRevision.id,
          resolver: 'e2e'
        })
      ).planRevision.status
    ).toBe('APPROVED')
    expect(
      MissionResponseSchema.parse(
        await desktopCall(page, 'axiom.mission.start', { missionId: mission.id })
      ).mission.status
    ).toBe('EXECUTING')
    await expect.poll(async () => (await pending(page, mission.id)).length, { timeout }).toBe(3)
    const before = await pending(page, mission.id)
    const { tasks } = TaskListResponseSchema.parse(
      await desktopCall(page, 'axiom.task.list', { missionId: mission.id })
    )
    const ready = tasks.filter((task) => task.stage === 'READY')
    expect(ready).toHaveLength(3)
    expect(before.map((item) => item.taskId).sort()).toEqual(ready.map((task) => task.id).sort())
    for (const item of before) {
      expect(item).toMatchObject({ kind: 'task_blocked', reason: 'no_eligible_provider' })
      expect(ready.find((task) => task.id === item.taskId)?.waitingOn).toEqual({
        on: 'admission',
        reason: 'no_eligible_provider',
        person: true
      })
    }
    await page.getByRole('button', { name: 'Missions', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh Missions', exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Mission list' })
      .getByRole('button')
      .filter({ hasText: mission.id })
      .click()
    const beforeRows = await assertRows(page, before)
    const audits = readRefusals(userData, mission.id)
    const first = before.map((item) => {
      const audit = audits.find((entry) => entry.taskId === item.taskId)
      expect(audit).toBeDefined()
      expect(item.since).toBe(audit!.since)
      return audit!
    })
    await captureDetail(page, testInfo, 'mission-home-provider-since', 'Mission Home')

    const home = page.getByRole('region', { name: 'Mission Home', exact: true })
    const pause = home.getByRole('button', { name: 'Pause Mission', exact: true })
    await expect(pause).toHaveAttribute('aria-disabled', 'false', { timeout })
    await pause.click()
    await expect(home.locator('[data-mission-status]')).toHaveText('Paused', { timeout })
    await expect
      .poll(
        async () =>
          MissionResponseSchema.parse(
            await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
          ).mission.status,
        { timeout }
      )
      .toBe('PAUSED')
    const pausedSequence = Math.max(
      ...readRefusals(userData, mission.id).map((audit) => audit.sequence)
    )
    // Audit timestamps have one-second precision. Assert the next second before resuming.
    await expect
      .poll(() => Date.now(), { timeout })
      .toBeGreaterThan(Math.max(...first.map((audit) => Date.parse(audit.since))) + 1000)
    const resume = home.getByRole('button', { name: 'Resume Mission', exact: true })
    await expect(resume).toHaveAttribute('aria-disabled', 'false', { timeout })
    await resume.click()
    await expect(home.locator('[data-mission-status]')).toHaveText('Executing', { timeout })
    await expect
      .poll(
        async () =>
          MissionResponseSchema.parse(
            await desktopCall(page, 'axiom.mission.show', { missionId: mission.id })
          ).mission.status,
        { timeout }
      )
      .toBe('EXECUTING')
    await expect
      .poll(
        () => {
          const newer = readRefusals(userData, mission.id)
          return first.every((original) =>
            newer.some(
              (audit) =>
                audit.taskId === original.taskId &&
                audit.sequence > pausedSequence &&
                audit.since > original.since
            )
          )
        },
        { timeout }
      )
      .toBe(true)
    const after = await pending(page, mission.id)
    expect(after).toEqual(before)
    await page.getByRole('button', { name: 'Refresh Missions', exact: true }).click()
    await expect(pause).toHaveAttribute('aria-disabled', 'false', { timeout })
    expect(await assertRows(page, after)).toEqual(beforeRows)
  } finally {
    try {
      await session.dispose(app)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }
})
