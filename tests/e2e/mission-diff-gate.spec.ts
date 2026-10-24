import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { test, expect } from './helpers/orca-app'
import { cli, invoke, withFixtureMission, FIXTURE_COMMIT } from './helpers/axiom-fixture-mission'
import { fixtureLedger, inspectFixtureMission } from './helpers/axiom-fixture-inspection'
import {
  VerificationListResponseSchema,
  VerificationResponseSchema
} from '../../src/shared/axiom-contract/verification-params'
import { TaskListResponseSchema } from '../../src/shared/axiom-contract/task-params'
import { ArtifactReadResponseSchema } from '../../src/shared/axiom-contract/artifact-params'

test('M3-03: scope and secret gates reject green Candidates while an unchanged Candidate passes', async (// oxlint-disable-next-line no-empty-pattern -- Fixture helper owns the background app lifecycle.
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
          scenario: 'scope-violation',
          verdict: 'FAIL',
          reason: 'scope_violation',
          stage: 'BLOCKED'
        },
        {
          id: 'T02',
          scenario: 'secret-line',
          verdict: 'FAIL',
          reason: 'secret_detected',
          stage: 'BLOCKED'
        },
        {
          id: 'T03',
          scenario: 'agent-crash',
          verdict: 'PASS',
          reason: 'checks_passed',
          stage: 'VERIFIED'
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
      for (const expected of assignments) {
        const run = runs.find((run) => run.taskId === expected.taskId)
        if (!run) {
          throw new Error(`Missing VerificationRun for ${expected.id}`)
        }
        const output = invoke(userData, ['verification', 'show', '--run', run.id])
        expect(output.status).toBe(0)
        const token = `gh` + `p_${'Z'.repeat(36)}`
        expect(output.stdout.includes(token)).toBe(false)
        const shown = VerificationResponseSchema.parse(
          z.object({ result: z.unknown() }).parse(JSON.parse(output.stdout)).result
        ).run
        expect(shown).toEqual(run)
        expect(shown).toMatchObject({
          status: expected.verdict,
          phase: 'verdict',
          claimCount: 1,
          commands: ['pnpm install --frozen-lockfile --prefer-offline', 'pnpm run verify:full'],
          verdictDetail: {
            reason: expected.reason,
            verdictArtifactId: expect.any(String),
            diff: {
              integrationBase: { branch: `axiom/integration/${mission.id}`, sha: FIXTURE_COMMIT },
              mergeBase: FIXTURE_COMMIT,
              scopeViolations: expected.id === 'T01' ? ['README.md'] : [],
              secrets:
                expected.id === 'T02'
                  ? [{ path: 'src/services/csv.ts', pattern: 'provider_token' }]
                  : [],
              ...(expected.id === 'T03' ? { changedPaths: 0 } : {}),
              patchComplete: true
            }
          }
        })
        const checks = z.array(z.object({ result: z.string() })).parse(shown.verdictDetail.checks)
        expect(checks).toHaveLength(2)
        expect(checks.every((check) => check.result === 'pass')).toBe(true)
        const artifactId = z.string().parse(shown.verdictDetail.verdictArtifactId)
        const evidence = ArtifactReadResponseSchema.parse(
          cli(userData, ['mission', 'artifact', 'read', '--artifact', artifactId])
        )
        const content = Buffer.from(evidence.contentBase64, 'base64').toString('utf8')
        expect(content.includes(token)).toBe(false)
        expect(JSON.parse(content)).toMatchObject({
          reason: expected.reason,
          diff: shown.verdictDetail.diff
        })
        expect(tasks.find((task) => task.id === expected.taskId)?.stage).toBe(expected.stage)
        const stages = inspect()
          .audits.filter(
            (audit) => audit.object_id === expected.taskId && audit.event === 'task.stage'
          )
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
      expect(inspect().bindings).toHaveLength(3)
      expect(inspect().bindings.every((binding) => binding.seq === 1)).toBe(true)
      await expect
        .poll(() => fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'submission').length)
        .toBe(3)
      expect(fixtureLedger(ledgerPath).filter((entry) => entry.kind === 'error')).toEqual([])
    },
    { holdWorkers: true, runVerification: true, maxAttempts: 1 }
  )
})
