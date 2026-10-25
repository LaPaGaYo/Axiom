import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, withFixtureMission, FIXTURE_COMMIT } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import { VerificationListResponseSchema } from '../../src/shared/axiom-contract/verification-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'

test('M3-03b: passing checks cannot hide skipped tests, removed assertions or suppressions', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
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
          scenario: 'test-skip',
          path: 'src/domain/date.test.ts',
          rule: 'test_skip_added'
        },
        {
          id: 'T02',
          scenario: 'assertion-drop',
          path: 'src/domain/guards.test.ts',
          rule: 'assertions_reduced'
        },
        {
          id: 'T03',
          scenario: 'suppression',
          path: 'src/domain/clock.test.ts',
          rule: 'suppression_added'
        }
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
        .poll(
          () =>
            list().filter((run) => ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(run.status)).length,
          {
            timeout: 480_000
          }
        )
        .toBe(3)
      await expect.poll(() => list().filter((run) => run.worktreeId === null).length).toBe(3)
      const runs = list()
      expect(runs).toHaveLength(3)
      const tasks = TaskListResponseSchema.parse(
        cli(userData, ['task', 'list', '--mission', mission.id])
      ).tasks
      for (const expected of assignments) {
        const run = runs.find((run) => run.taskId === expected.taskId)
        if (!run) {
          throw new Error(`Missing VerificationRun for ${expected.id}`)
        }
        const tampering = [{ path: expected.path, rule: expected.rule, count: 1 }]
        expect(run).toMatchObject({
          status: 'INCONCLUSIVE',
          phase: 'verdict',
          claimCount: 1,
          commands: ['pnpm install --frozen-lockfile --prefer-offline', 'pnpm run verify:full'],
          verdictDetail: {
            reason: 'test_tampering',
            escalation: 'human',
            diff: {
              integrationBase: { branch: `axiom/integration/${mission.id}`, sha: FIXTURE_COMMIT },
              mergeBase: FIXTURE_COMMIT,
              changedPaths: 1,
              scopeViolations: [],
              tampering,
              counts: { tampering: 1 },
              patchComplete: true
            }
          }
        })
        const diff = z
          .object({ tampering: z.array(z.unknown()), scopeViolations: z.array(z.string()) })
          .parse(run.verdictDetail.diff)
        expect(diff.tampering).toEqual(tampering)
        expect(diff.scopeViolations).toEqual([])
        const checks = z.array(z.object({ result: z.string() })).parse(run.verdictDetail.checks)
        expect(checks).toHaveLength(2)
        expect(checks.every((check) => check.result === 'pass')).toBe(true)
        expect(tasks.find((task) => task.id === expected.taskId)?.stage).toBe('VERIFYING')
        const audits = inspect().audits.filter(
          (audit) => audit.object_id === run.id && audit.event === 'verification.inconclusive'
        )
        expect(audits).toHaveLength(1)
        const audit = z
          .object({ reason: z.string(), escalation: z.string(), tampering: z.array(z.unknown()) })
          .parse(JSON.parse(audits[0].after ?? '{}'))
        expect(audit).toEqual({ reason: 'test_tampering', escalation: 'human', tampering })
        const evidence = ArtifactReadResponseSchema.parse(
          cli(userData, [
            'mission',
            'artifact',
            'read',
            '--artifact',
            z.string().parse(run.verdictDetail.verdictArtifactId)
          ])
        )
        expect(
          JSON.parse(Buffer.from(evidence.contentBase64, 'base64').toString('utf8'))
        ).toMatchObject({
          reason: 'test_tampering',
          diff: { tampering }
        })
      }
      expect(inspect().bindings).toHaveLength(3)
      expect(inspect().bindings.every((binding) => binding.seq === 1)).toBe(true)
      await expect
        .poll(() => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length)
        .toBe(3)
      expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
    },
    {
      holdWorkers: true,
      runVerification: true,
      maxAttempts: 1,
      extraAllowedPaths: [
        'src/domain/date.test.ts',
        'src/domain/guards.test.ts',
        'src/domain/clock.test.ts'
      ]
    }
  )
})
