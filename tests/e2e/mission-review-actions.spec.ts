import { writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { desktopCall } from './helpers/axiom-desktop-call'
import { withFixtureMission } from './helpers/axiom-fixture-mission'
import { inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { captureDetail } from './helpers/axiom-task-detail-capture'
import {
  AxiomIdSchema,
  type AcceptanceCriterion
} from '../../src/shared/axiom-contract/mission-objects'
import { PolicyResponseSchema } from '../../src/shared/axiom-contract/policy-params'
import { TaskResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { AttemptListResponseSchema } from '../../src/shared/axiom-contract/attempt-params'
import { TaskStageSchema } from '../../src/shared/axiom-contract/lifecycle'
import {
  VerificationListResponseSchema,
  VerificationResolutionSchema,
  VerificationRerunDetailSchema
} from '../../src/shared/axiom-contract/verification-params'
import { readVerdictRecord } from '../../src/shared/axiom-contract/verdict-record'

type Fixture = Parameters<Parameters<typeof withFixtureMission>[2]>[0]
const source = process.env.AXIOM_FIXTURE_REPO
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
const invalid: AcceptanceCriterion = {
  text: 'The requested script passes',
  check: { kind: 'command', command: 'pnpm run no-such-script' }
}

async function readRuns(f: Fixture, taskId: string) {
  return VerificationListResponseSchema.parse(
    await desktopCall(f.page, 'axiom.verification.list', { missionId: f.mission.id, taskId })
  ).runs
}
async function readTask(f: Fixture, taskId: string) {
  return TaskResponseSchema.parse(await desktopCall(f.page, 'axiom.task.show', { taskId })).task
}
async function releaseScenario(f: Fixture, scenario: string, setup = false) {
  const inspect = () => inspectFixtureMission(f.userData, f.mission.id)
  await expect.poll(() => inspect().bindings.length, { timeout: 60_000 }).toBe(1)
  const taskId = AxiomIdSchema.parse(inspect().bindings[0]?.task_id)
  writeFileSync(`${f.ledgerPath}.scenario-${taskId}`, scenario)
  if (setup) {
    PolicyResponseSchema.parse(
      await desktopCall(f.page, 'axiom.policy.update', {
        missionId: f.mission.id,
        patch: {
          verificationRules: { setupCommands: ['pnpm install --frozen-lockfile --prefer-offline'] }
        }
      })
    )
  }
  f.releaseWorkers()
  return taskId
}
async function waitForReview(f: Fixture, taskId: string, reason: string) {
  await expect
    .poll(
      async () => (await readRuns(f, taskId)).filter((run) => run.status === 'HUMAN_REVIEW').length,
      { timeout: 480_000 }
    )
    .toBe(1)
  const run = (await readRuns(f, taskId)).find((entry) => entry.status === 'HUMAN_REVIEW')!
  expect(run.verdictDetail.reason).toBe(reason)
  return run
}
async function openDetail(page: Page, missionId: string, taskId: string) {
  await page.getByRole('button', { name: 'Missions', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Mission list' })
    .getByRole('button')
    .filter({ hasText: missionId })
    .click()
  await expect(page.getByRole('heading', { name: 'Mission Home' })).toBeVisible()
  await page
    .getByRole('table', { name: 'Tasks', exact: true })
    .locator(`tbody tr[data-task-id="${taskId}"]`)
    .click()
  return page.getByRole('region', { name: 'Task detail', exact: true })
}

test('M3-09-2b-2: a person resolves the review the plan asked for from the Task page', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const taskId = await releaseScenario(f, 'agent-crash')
      const run = await waitForReview(f, taskId, 'acceptance_human')
      const detail = await openDetail(f.page, f.mission.id, taskId)
      const actions = detail.getByRole('region', { name: 'Task actions', exact: true })
      await actions.getByRole('button', { name: 'Resolve review', exact: true }).click()
      const form = actions.getByRole('form', { name: 'Resolve review', exact: true })
      await expect(form.getByText('acceptance_human', { exact: true })).toBeVisible()
      await form.getByRole('radio', { name: 'PASS', exact: true }).click()
      await expect(form.getByText('Disposition', { exact: true })).toHaveCount(0)
      await form.getByRole('radio', { name: 'FAIL', exact: true }).click()
      await expect(form.getByText('fixed', { exact: true })).toBeVisible()
      await expect(form.getByRole('radiogroup', { name: 'Disposition' })).toHaveCount(0)
      await form.getByRole('radio', { name: 'PASS', exact: true }).click()
      await form.getByRole('checkbox', { name: `#1 · ${human.text}`, exact: true }).check()
      const rationale = 'The example is clear and includes entityId.'
      await form.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale)
      await form.getByRole('button', { name: 'Submit resolution', exact: true }).click()
      await expect(actions).toHaveCount(0)
      await expect(detail).toBeFocused()
      const resolution = detail.getByRole('region', { name: 'Human resolution', exact: true })
      await expect(resolution).toContainText(rationale)
      await expect(resolution.getByText('Disposition', { exact: false })).toHaveCount(0)
      await expect(
        detail.getByRole('list', { name: 'Acceptance criteria', exact: true })
      ).not.toContainText('Needs a person')
      await expect(detail.getByRole('button', { name: 'Verified', exact: true })).toHaveAttribute(
        'data-task-stage',
        'VERIFIED'
      )
      const stored = (await readRuns(f, taskId)).find((entry) => entry.id === run.id)!
      expect(stored.status).toBe('PASS')
      expect((await readTask(f, taskId)).stage).toBe('VERIFIED')
      const resolved = VerificationResolutionSchema.parse(stored.verdictDetail.resolution)
      expect(resolved).toMatchObject({ verdict: 'PASS', rationale, criteria: [1], by: 'user' })
      expect(resolved).not.toHaveProperty('disposition')
    },
    {
      taskIds: ['T01'],
      acceptanceCriteria: [passing, human],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 3
    }
  )
})

test('M3-09-2b-2: a person records the disposition of a flagged review on the Task page', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const taskId = await releaseScenario(f, 'test-skip', true)
      const run = await waitForReview(f, taskId, 'test_tampering')
      const detail = await openDetail(f.page, f.mission.id, taskId)
      const actions = detail.getByRole('region', { name: 'Task actions', exact: true })
      await actions.getByRole('button', { name: 'Resolve review', exact: true }).click()
      const form = actions.getByRole('form', { name: 'Resolve review', exact: true })
      await expect(form.getByText('test_tampering', { exact: true })).toBeVisible()
      await form.getByRole('radio', { name: 'PASS', exact: true }).click()
      const rationale = 'The skipped test is intentional.'
      await form.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale)
      const submit = form.getByRole('button', { name: 'Submit resolution', exact: true })
      await expect(submit).toBeDisabled()
      await form
        .getByRole('radiogroup', { name: 'Disposition', exact: true })
        .getByRole('radio', { name: 'intentional', exact: true })
        .click()
      await expect(submit).toBeEnabled()
      await captureDetail(f.page, testInfo, 'flagged-review-form')
      await submit.click()
      await expect(actions).toHaveCount(0)
      const resolution = detail.getByRole('region', { name: 'Human resolution', exact: true })
      await expect(resolution.getByText('intentional', { exact: true })).toBeVisible()
      await expect(resolution).toContainText('the flagged change is intended')
      await expect(resolution).toContainText(rationale)
      await captureDetail(f.page, testInfo, 'resolved-review')
      const stored = (await readRuns(f, taskId)).find((entry) => entry.id === run.id)!
      expect(stored.status).toBe('PASS')
      expect((await readTask(f, taskId)).stage).toBe('VERIFIED')
      expect(VerificationResolutionSchema.parse(stored.verdictDetail.resolution)).toMatchObject({
        verdict: 'PASS',
        disposition: 'intentional',
        rationale,
        criteria: []
      })
      const audits = inspectFixtureMission(f.userData, f.mission.id).audits.filter(
        (audit) => audit.object_id === run.id && audit.event === 'verification.resolved'
      )
      expect(audits).toHaveLength(1)
      expect(
        VerificationResolutionSchema.omit({ at: true })
          .extend({ taskId: AxiomIdSchema, candidateId: AxiomIdSchema })
          .parse(JSON.parse(audits[0].after ?? '{}'))
      ).toEqual({
        verdict: 'PASS',
        rationale,
        criteria: [],
        disposition: 'intentional',
        taskId,
        candidateId: run.candidateId,
        by: 'user'
      })
    },
    {
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 1,
      extraAllowedPaths: ['src/domain/date.test.ts']
    }
  )
})

test('M3-09-2b-2: a person reruns verification of the same Candidate from the Task page', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const taskId = await releaseScenario(f, 'agent-crash')
      const run = await waitForReview(f, taskId, 'plan_invalid')
      const detail = await openDetail(f.page, f.mission.id, taskId)
      const actions = detail.getByRole('region', { name: 'Task actions', exact: true })
      await actions.getByRole('button', { name: 'Rerun verification', exact: true }).click()
      const form = actions.getByRole('form', { name: 'Rerun verification', exact: true })
      const rationale = 'Recheck the same Candidate after inspecting the environment.'
      await form.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale)
      await form.getByRole('button', { name: 'Queue rerun', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await readRuns(f, taskId)).filter(
              (entry) => entry.id !== run.id && entry.status === 'HUMAN_REVIEW'
            ).length,
          { timeout: 90_000 }
        )
        .toBe(1)
      await expect(
        f.page.getByRole('button', { name: 'Refresh Missions', exact: true })
      ).toBeEnabled()
      await f.page.getByRole('button', { name: 'Refresh Missions', exact: true }).click()
      const runs = await readRuns(f, taskId)
      expect(runs).toHaveLength(2)
      const latest = runs.find((entry) => entry.id !== run.id)!
      expect(latest.verdictDetail.reason).toBe('plan_invalid')
      expect(latest.candidateId).toBe(run.candidateId)
      expect(latest.candidateCommitSha).toBe(run.candidateCommitSha)
      const old = runs.find((entry) => entry.id === run.id)!
      expect(old.status).toBe('CANCELED')
      expect(VerificationRerunDetailSchema.parse(old.verdictDetail.rerun)).toMatchObject({
        rationale,
        by: 'user'
      })
      const rows = detail
        .getByRole('table', { name: 'Verification runs', exact: true })
        .locator('tbody tr')
      await expect(rows).toHaveCount(2)
      await expect(rows.first()).toContainText(latest.id)
      await expect(rows.first()).toContainText('HUMAN_REVIEW')
      await expect(rows.nth(1)).toContainText(run.id)
      await expect(rows.nth(1)).toContainText('CANCELED')
      await rows.nth(1).click()
      await expect(detail.getByRole('region', { name: 'Rerun', exact: true })).toContainText(
        rationale
      )
      await expect(
        actions.getByRole('button', { name: 'Resolve review', exact: true })
      ).toBeVisible()
      await expect(
        actions.getByRole('button', { name: 'Rerun verification', exact: true })
      ).toBeVisible()
      expect((await readTask(f, taskId)).stage).toBe('VERIFYING')
    },
    {
      taskIds: ['T01'],
      acceptanceCriteria: [invalid],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 3
    }
  )
})

test('M3-09-2b-2: a failed check and its verified fix stay readable on the Task page', async (// oxlint-disable-next-line no-empty-pattern -- Fixture owns the hidden background app lifecycle.
{}, testInfo) => {
  test.setTimeout(900_000)
  if (!source || process.platform === 'win32') {
    test.skip(true, 'Requires a POSIX fixture host')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async (f) => {
      const taskId = await releaseScenario(f, 'deterministic-failure', true)
      await expect
        .poll(async () => (await readTask(f, taskId)).stage, { timeout: 780_000 })
        .toBe('VERIFIED')
      const runs = await readRuns(f, taskId)
      expect(runs.map((run) => run.status)).toEqual(['FAIL', 'PASS'])
      const [failed, passed] = runs
      expect(failed.verdictDetail.reason).toBe('checks_failed')
      const failure =
        'src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates'
      const check = readVerdictRecord(failed.verdictDetail).checks.find(
        (entry) => entry.result === 'fail' && entry.failures.includes(failure)
      )!
      expect(check.command).toBe('pnpm run verify:full')
      const detail = await openDetail(f.page, f.mission.id, taskId)
      const rows = detail
        .getByRole('table', { name: 'Verification runs', exact: true })
        .locator('tbody tr')
      await expect(rows).toHaveCount(2)
      await expect(rows.first()).toContainText(passed.id)
      await expect(rows.first()).toContainText('PASS')
      await expect(rows.nth(1)).toContainText(failed.id)
      await expect(rows.nth(1)).toContainText('FAIL')
      await rows.nth(1).click()
      const checks = detail.getByRole('table', { name: 'Checks', exact: true })
      const failing = checks.locator('tbody tr').filter({ hasText: failure })
      await expect(failing.getByText(check.command, { exact: true })).toBeVisible()
      await expect(failing.getByText('fail', { exact: true })).toBeVisible()
      await expect(failing).toContainText(failure)
      await captureDetail(f.page, testInfo, 'failed-run')
      const stage = detail.getByRole('button', { name: 'Verified', exact: true })
      await expect(stage).toHaveAttribute('data-task-stage', 'VERIFIED')
      await expect(stage.locator('span')).toHaveClass(/text-status-success/)
      await stage.click()
      await expect(detail.getByRole('region', { name: 'Verification', exact: true })).toBeFocused()
      await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
      await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false')
      await expect(detail.getByRole('region', { name: 'Task actions', exact: true })).toHaveCount(0)
      const attempts = AttemptListResponseSchema.parse(
        await desktopCall(f.page, 'axiom.attempt.list', { missionId: f.mission.id, taskId })
      ).attempts
      expect(attempts.map((attempt) => attempt.seq)).toEqual([1, 2])
      expect(attempts.every((attempt) => attempt.submission !== undefined)).toBe(true)
      const stages = inspectFixtureMission(f.userData, f.mission.id)
        .audits.filter((audit) => audit.event === 'task.stage' && audit.object_id === taskId)
        .map(
          (audit) =>
            z.object({ stage: TaskStageSchema }).parse(JSON.parse(audit.after ?? '{}')).stage
        )
      expect(stages).toContain('NEEDS_FIX')
      expect(stages.at(-1)).toBe('VERIFIED')
    },
    {
      taskIds: ['T01'],
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 2,
      extraAllowedPaths: ['src/domain/recurrence.ts']
    }
  )
})
