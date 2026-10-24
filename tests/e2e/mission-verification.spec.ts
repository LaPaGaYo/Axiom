import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, withFixtureMission, FIXTURE_COMMIT } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import {
  VerificationListResponseSchema,
  VerificationResponseSchema
} from '../../src/shared/axiom-contract/verification-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'

test('M3-02: independent checks reject both broken fixture candidates and verify the unpatched one', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
{}, testInfo) => {
  test.setTimeout(600_000)
  const source = process.env.AXIOM_FIXTURE_REPO
  if (!source) {
    test.skip(true, 'AXIOM_FIXTURE_REPO not set')
    return
  }
  await withFixtureMission(
    testInfo,
    source,
    async ({ mission, userData, ledgerPath, temp, releaseWorkers }) => {
      const inspect = () => inspectFixtureMission(userData, mission.id)
      const list = () =>
        VerificationListResponseSchema.parse(
          cli(userData, ['verification', 'list', '--mission', mission.id])
        ).runs
      await expect
        .poll(() => inspect().tasks.filter((task) => task.stage === 'RUNNING').length, {
          timeout: 60_000
        })
        .toBe(3)
      const roots = inspect().tasks.filter((task) => task.stage === 'RUNNING')
      const scenarios = [
        {
          id: 'T01',
          scenario: 'deterministic-failure',
          verdict: 'FAIL',
          stage: 'BLOCKED',
          failure:
            'src/domain/recurrence.test.ts > advances daily, weekly, interval and clamped monthly dates'
        },
        {
          id: 'T02',
          scenario: 'retry',
          verdict: 'FAIL',
          stage: 'BLOCKED',
          failure:
            'src/services/date-range.test.ts > dateRange accepts inclusive and optional boundaries'
        },
        { id: 'T03', scenario: 'agent-crash', verdict: 'PASS', stage: 'VERIFIED', failure: null }
      ]
      const assignments = scenarios.map((scenario) => {
        const task = roots.find(
          (root) => z.object({ id: z.string() }).parse(JSON.parse(root.spec)).id === scenario.id
        )
        if (!task) {
          throw new Error(`Missing fixture Task ${scenario.id}`)
        }
        writeFileSync(`${ledgerPath}.scenario-${task.task_id}`, scenario.scenario)
        return { ...scenario, taskId: task.task_id }
      })
      const rulesFile = path.join(temp, 'verification-rules.json')
      writeFileSync(
        rulesFile,
        JSON.stringify({ setupCommands: ['pnpm install --frozen-lockfile --prefer-offline'] })
      )
      cli(userData, [
        'mission',
        'policy',
        'update',
        '--mission',
        mission.id,
        '--verification-rules-file',
        rulesFile
      ])
      releaseWorkers()
      await expect
        .poll(() => list().filter((run) => ['PASS', 'FAIL'].includes(run.status)).length, {
          timeout: 480_000
        })
        .toBe(3)
      await expect.poll(() => list().filter((run) => run.worktreeId === null).length).toBe(3)
      const runs = list()
      expect(runs).toHaveLength(3)
      const tasks = TaskListResponseSchema.parse(
        cli(userData, ['task', 'list', '--mission', mission.id])
      ).tasks
      const audits = inspect().audits
      for (const expected of assignments) {
        const run = runs.find((run) => run.taskId === expected.taskId)
        if (!run) {
          throw new Error(`Missing VerificationRun for ${expected.id}`)
        }
        const shown = VerificationResponseSchema.parse(
          cli(userData, ['verification', 'show', '--run', run.id])
        ).run
        expect(shown).toEqual(run)
        expect(shown).toMatchObject({
          status: expected.verdict,
          phase: 'verdict',
          claimCount: 1,
          commands: ['pnpm install --frozen-lockfile --prefer-offline', 'pnpm run verify:full'],
          verdictDetail: {
            verdict: expected.verdict,
            verdictArtifactId: expect.any(String),
            diff: { scopeViolations: [], mergeBase: FIXTURE_COMMIT }
          }
        })
        const checks = z
          .array(z.object({ result: z.string(), failures: z.array(z.string()) }))
          .parse(shown.verdictDetail.checks)
        if (expected.failure) {
          expect(checks.flatMap((check) => check.failures)).toContain(expected.failure)
        } else {
          expect(checks.every((check) => check.result === 'pass')).toBe(true)
        }
        expect(tasks.find((task) => task.id === expected.taskId)?.stage).toBe(expected.stage)
        const stages = audits
          .filter((audit) => audit.object_id === expected.taskId && audit.event === 'task.stage')
          .map((audit) =>
            z
              .object({ stage: z.string(), reason: z.string() })
              .parse(JSON.parse(audit.after ?? '{}'))
          )
        if (expected.verdict === 'FAIL') {
          expect(stages.slice(-2)).toEqual([
            { stage: 'NEEDS_FIX', reason: 'verification_failed' },
            { stage: 'BLOCKED', reason: 'retry_budget_exhausted' }
          ])
        } else {
          expect(stages.at(-1)).toEqual({ stage: 'VERIFIED', reason: 'verification_passed' })
        }
      }
      // maxAttempts=1 is set in the approved test plan: later Attempts cannot race the assertions.
      expect(inspect().bindings).toHaveLength(3)
      expect(inspect().bindings.every((binding) => binding.seq === 1)).toBe(true)
      await expect
        .poll(() => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length)
        .toBe(3)
      expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
      console.log(
        `[M3-02] ${JSON.stringify(runs.map(({ id, taskId, status, verdictDetail }) => ({ id, taskId, status, verdictDetail })))}`
      )
    },
    {
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 1,
      // Why: the frozen D49 stub patches files outside decomposition scopes; this spec tests command verdicts.
      extraAllowedPaths: ['src/domain/recurrence.ts', 'src/services/date-range.ts']
    }
  )
})
